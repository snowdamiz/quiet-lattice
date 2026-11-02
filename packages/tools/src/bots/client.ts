import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  AuthResponse,
  CharacterSummary,
  FrameId,
  MoveMode,
  Pose,
  PROTOCOL_VERSION,
  Vec3,
  Buttons,
  decodeServerMessage,
  encodeClientMessage,
  type ClientMessage,
  type PeopleId,
  type ServerMessage,
} from '@astra/shared/protocol';
import { Galaxy, GALAXY_SEED, describeGalaxySystem, frameKeyOf, reframe, settleFrame, systemPoses, type SystemDescription } from '@astra/shared/world';
import { BotSnapshots } from './snapshots.ts';

type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
type Input = Extract<ClientMessage, { t: 'input' }>;
type MineTarget = Pick<Extract<ClientMessage, { t: 'mine' }>, 'frame' | 'node' | 'flora'>;
export type Destination = Pick<Pose, 'frame' | 'pos'>;
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BotRefusal extends Error {
  constructor(
    readonly action: string,
    readonly reason: string,
  ) {
    super(`${action} refused: ${reason}`);
  }
}

export function noseTo(direction: Vec3): Pose['quat'] {
  const length = Math.hypot(...direction);
  if (length === 0) throw new Error('a bot cannot aim in a zero direction');
  const [x, y, z] = direction.map((n) => n / length);
  if (z > 0.999999) return [0, 1, 0, 0];
  const n = Math.hypot(y, x, 1 - z);
  return [y / n, -x / n, 0, (1 - z) / n];
}

const galaxy = new Galaxy(GALAXY_SEED);
function systemOf(seed: number): SystemDescription {
  const info = galaxy.systems.find((system) => system.seed === seed);
  if (!info) throw new Error(`unknown bot system seed ${seed}`);
  return describeGalaxySystem(info);
}

/** Ordinary HTTP account/character creation, with the same response schemas the game uses. */
export async function registerBot(url: string, people: PeopleId = 'thalune'): Promise<{ token: string; characterId: string }> {
  const suffix = randomBytes(8).toString('hex');
  async function post(path: string, body: unknown, token?: string): Promise<unknown> {
    const response = await fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`bot ${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  }
  const auth = AuthResponse.parse(await post('/auth/register', { username: `bot_${suffix}`, password: randomBytes(20).toString('hex') }));
  const letters = [...randomBytes(10)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('');
  const character = CharacterSummary.parse(
    await post('/characters', { name: `Bot ${letters}`, people, look: { palette: 3, pattern: 1, head: 2, suit: 0 } }, auth.token),
  );
  return { token: auth.token, characterId: character.id };
}

/** A renderer-free protocol client. All observed inventory, combat and quest results come from the server. */
export class BotClient {
  readonly snapshots = new BotSnapshots();
  readonly stats = { inputs: 0, snapshots: 0, corrections: 0, handoffs: 0, frameChanges: 0, messages: 0, maxPoseErrorM: 0 };
  readonly latest = new Map<ServerMessage['t'], ServerMessage>();
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly sent = new Map<number, Input>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private failure: Error | undefined;
  private closing = false;
  private welcomed: Welcome | undefined;
  private state: { pose: Pose; mode: Input['mode']; zone: string; entityId: number; system: SystemDescription } | undefined;
  private clock = { time: 0, at: 0 };
  private previousTick = performance.now();
  private lastSnapshotAt = performance.now();
  private inputSeq = 0;
  private handledSeq = 0;
  private revision = 0;
  private requestSeq = { mine: 0, fire: 0, quests: 0, warp: 0, ping: 0 };
  private buttons = 0;
  private steer: ((dt: number) => void) | undefined;

  private constructor(
    private readonly socket: WebSocket,
    readonly timeoutMs: number,
  ) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      try {
        if (typeof event.data === 'string') {
          const message = decodeServerMessage(event.data);
          if (!message) throw new Error('invalid bot control message');
          this.receive(message);
        } else if (event.data instanceof ArrayBuffer) this.receiveSnapshot(new Uint8Array(event.data));
        else throw new Error('unexpected bot binary message');
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.addEventListener('error', () => this.fail(new Error('bot socket error')));
    socket.addEventListener('close', (event) => {
      if (!this.closing) this.fail(new Error(`bot socket closed ${event.code}: ${event.reason}`));
    });
  }

  static async connect(options: { url: string; token: string; characterId: string; timeoutMs?: number }): Promise<BotClient> {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('invalid bot response timeout');
    const hello = encodeClientMessage({ t: 'hello', version: PROTOCOL_VERSION, token: options.token });
    const join = encodeClientMessage({ t: 'join', characterId: options.characterId });
    const url = new URL('/ws', options.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    const bot = new BotClient(socket, options.timeoutMs ?? 10_000);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bot socket open timed out')), bot.timeoutMs);
        socket.addEventListener(
          'open',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          'error',
          () => {
            clearTimeout(timer);
            reject(new Error('bot socket open failed'));
          },
          { once: true },
        );
      });
      const welcome = bot.next((message): message is Welcome => message.t === 'welcome');
      socket.send(hello);
      socket.send(join);
      await welcome;
      bot.previousTick = performance.now();
      bot.timer = setInterval(() => bot.tick(), 50);
      return bot;
    } catch (error) {
      await bot.close();
      throw error;
    }
  }

  get welcome(): Welcome {
    if (!this.welcomed) throw new Error('bot has not joined');
    return this.welcomed;
  }
  private get joined(): NonNullable<BotClient['state']> {
    if (!this.state) throw new Error('bot has not joined');
    return this.state;
  }
  get pose(): Pose {
    return this.joined.pose;
  }
  get mode(): Input['mode'] {
    return this.joined.mode;
  }
  get zone(): string {
    return this.joined.zone;
  }
  get entityId(): number {
    return this.joined.entityId;
  }
  get system(): SystemDescription {
    return this.joined.system;
  }
  get time(): number {
    return this.clock.time + (performance.now() - this.clock.at) / 1000;
  }
  get healthy(): boolean {
    return this.failure === undefined && !this.closing;
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  assertHealthy(): void {
    if (this.failure) throw this.failure;
    if (this.closing) throw new Error('bot is closed');
  }
  private fail(error: Error): void {
    this.failure ??= error;
  }
  private send(message: ClientMessage): void {
    this.assertHealthy();
    this.socket.send(encodeClientMessage(message));
  }
  private receive(message: ServerMessage): void {
    this.stats.messages++;
    this.latest.set(message.t, message);
    switch (message.t) {
      case 'welcome':
        this.welcomed = message;
        this.lastSnapshotAt = performance.now();
        this.clock = { time: message.serverTime, at: performance.now() };
        this.state = { pose: message.pose, mode: message.mode, zone: message.zone.id, entityId: message.entityId, system: systemOf(message.zone.systemSeed) };
        break;
      case 'zone':
        this.snapshots.reset();
        this.sent.clear();
        this.inputSeq = Math.max(this.inputSeq, message.seq);
        this.handledSeq = message.seq;
        this.state = { pose: message.pose, mode: message.mode, zone: message.zone.id, entityId: message.entityId, system: systemOf(message.zone.systemSeed) };
        if (message.reason === 'warp') this.steer = undefined;
        this.stats.handoffs++;
        break;
      case 'correction':
        this.correct(message.pose, message.mode);
        break;
      case 'refused':
        this.fail(new BotRefusal('session', `${message.code}: ${message.reason}`));
        break;
    }
    for (const listener of this.listeners) listener(message);
  }
  private correct(pose: Pose, mode: Input['mode']): void {
    this.joined.pose = pose;
    this.joined.mode = mode;
    this.sent.clear();
    this.steer = undefined;
    this.buttons = 0;
    this.revision++;
    this.stats.corrections++;
  }
  private receiveSnapshot(bytes: Uint8Array): void {
    const snapshot = this.snapshots.receive(bytes);
    this.lastSnapshotAt = performance.now();
    const state = this.joined;
    const entity = this.snapshots.latest.get(state.entityId);
    const sent = this.sent.get(snapshot.ack);
    if (entity && sent) {
      const authoritative = Pose.safeParse(entity);
      const mode = MoveMode.safeParse(entity.mode);
      if (authoritative.success && mode.success) {
        // The pose is as of this acknowledged input, including at moving frame boundaries.
        const key = frameKeyOf(state.system, sent.pose.frame);
        if (key === undefined) throw new Error('snapshot acknowledged an input from another system');
        const comparable = reframe(state.system, systemPoses(state.system, sent.time), authoritative.data, key);
        const error = Math.hypot(...comparable.pos.map((n, i) => n - sent.pose.pos[i]));
        this.stats.maxPoseErrorM = Math.max(this.stats.maxPoseErrorM, error);
        if (error > 0.5 || mode.data !== sent.mode) this.correct(authoritative.data, mode.data);
      }
    }
    this.handledSeq = Math.max(this.handledSeq, snapshot.ack);
    this.stats.snapshots++;
    this.send({ t: 'ack', zone: state.zone, tick: snapshot.tick });
  }
  private tick(): void {
    try {
      this.assertHealthy();
      const now = performance.now();
      if (now - this.lastSnapshotAt > this.timeoutMs) throw new Error('bot snapshot stream timed out');
      const dt = Math.min(0.1, (now - this.previousTick) / 1000);
      this.previousTick = now;
      const frame = this.pose.frame;
      this.steer?.(dt);
      if (frame !== this.pose.frame) this.stats.frameChanges++;
      this.sendInput();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private sendInput(): number {
    const state = this.joined;
    const message: Input = { t: 'input', zone: state.zone, seq: ++this.inputSeq, time: this.time, mode: state.mode, pose: state.pose, buttons: this.buttons };
    this.sent.set(message.seq, message);
    while (this.sent.size > 64) {
      const oldest = this.sent.keys().next().value;
      if (oldest !== undefined) this.sent.delete(oldest);
    }
    this.send(message);
    this.stats.inputs++;
    return message.seq;
  }
  private next<T extends ServerMessage>(accept: (message: ServerMessage) => message is T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const check = setInterval(() => {
        if (this.failure || this.closing) finish(this.failure ?? new Error('bot closed'));
      }, 25);
      const timer = setTimeout(() => finish(new Error('bot response timed out')), this.timeoutMs);
      const finish = (error?: Error, message?: T) => {
        clearTimeout(timer);
        clearInterval(check);
        this.listeners.delete(listener);
        if (error) reject(error);
        else if (message) resolve(message);
      };
      const listener = (message: ServerMessage) => {
        if (accept(message)) finish(undefined, message);
      };
      this.listeners.add(listener);
    });
  }
  private ask<T extends ServerMessage>(message: ClientMessage, accept: (message: ServerMessage) => message is T): Promise<T> {
    this.assertHealthy();
    const encoded = encodeClientMessage(message);
    const response = this.next(accept);
    try {
      this.socket.send(encoded);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return response;
  }
  private async until(condition: () => boolean, timeoutMs = this.timeoutMs): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
      this.assertHealthy();
      if (performance.now() >= deadline) throw new Error('bot action timed out');
      await sleep(10);
    }
    this.assertHealthy();
  }
  async settled(): Promise<void> {
    const seq = this.sendInput();
    await this.until(() => this.handledSeq >= seq);
  }
  async wait(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('bot wait must be finite and nonnegative');
    const end = performance.now() + ms;
    await this.until(() => performance.now() >= end, ms + this.timeoutMs);
  }
  /** An action ends only after an authoritative snapshot has acknowledged its final input. */
  async moveTo(destination: Destination, mode: 'ship' | 'foot', speed = mode === 'foot' ? 4 : 30, timeoutMs = 60_000): Promise<void> {
    const target = { frame: FrameId.parse(destination.frame), pos: Vec3.parse(destination.pos), quat: this.pose.quat, vel: [0, 0, 0] satisfies Vec3 };
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid bot move bounds');
    const revision = this.revision;
    this.joined.mode = mode;
    let arrived = false;
    this.steer = (dt) => {
      const poses = systemPoses(this.system, this.time);
      const key = frameKeyOf(this.system, this.pose.frame);
      if (key === undefined) throw new Error('bot pose frame is outside its zone');
      const local = reframe(this.system, poses, target, key);
      const delta: Vec3 = [local.pos[0] - this.pose.pos[0], local.pos[1] - this.pose.pos[1], local.pos[2] - this.pose.pos[2]];
      const distance = Math.hypot(...delta);
      const step = Math.min(distance, speed * dt);
      const velocity: Vec3 = distance > 0 ? [(delta[0] / distance) * speed, (delta[1] / distance) * speed, (delta[2] / distance) * speed] : [0, 0, 0];
      const pose = {
        frame: this.pose.frame,
        pos: [
          this.pose.pos[0] + (distance ? (delta[0] / distance) * step : 0),
          this.pose.pos[1] + (distance ? (delta[1] / distance) * step : 0),
          this.pose.pos[2] + (distance ? (delta[2] / distance) * step : 0),
        ] satisfies Vec3,
        quat: distance > 0 ? noseTo(delta) : this.pose.quat,
        vel: velocity,
      };
      this.joined.pose = settleFrame(this.system, poses, pose);
      if (distance <= step) {
        arrived = true;
        this.joined.pose = { ...this.pose, vel: [0, 0, 0] };
        this.steer = undefined;
      }
    };
    try {
      await this.until(() => arrived || this.revision !== revision, timeoutMs);
      await this.settled();
      if (this.revision !== revision) throw new BotRefusal(mode === 'foot' ? 'walk' : 'fly', 'authoritative correction or zone handoff');
    } finally {
      this.steer = undefined;
      this.joined.pose = { ...this.pose, vel: [0, 0, 0] };
    }
  }
  fly(destination: Destination, speed = 30, timeoutMs = 60_000): Promise<void> {
    return this.moveTo(destination, 'ship', speed, timeoutMs);
  }
  /** Flies a bounded straight course, turning velocity with each shared frame change, without adding frame velocity. */
  async flyFor(options: { direction: Vec3; speed: number; durationMs: number }): Promise<void> {
    if (!Number.isFinite(options.speed) || options.speed <= 0 || !Number.isFinite(options.durationMs) || options.durationMs <= 0)
      throw new Error('invalid bot flight bounds');
    const direction = Vec3.parse(options.direction);
    const length = Math.hypot(...direction);
    const revision = this.revision;
    const quat = noseTo(direction);
    const vel: Vec3 = [(direction[0] / length) * options.speed, (direction[1] / length) * options.speed, (direction[2] / length) * options.speed];
    this.joined.mode = 'ship';
    this.joined.pose = { ...this.pose, quat, vel };
    this.steer = (dt) => {
      const pose: Pose = {
        ...this.pose,
        pos: [this.pose.pos[0] + this.pose.vel[0] * dt, this.pose.pos[1] + this.pose.vel[1] * dt, this.pose.pos[2] + this.pose.vel[2] * dt],
      };
      this.joined.pose = settleFrame(this.system, systemPoses(this.system, this.time), pose);
    };
    try {
      await this.wait(options.durationMs);
      await this.settled();
      if (revision !== this.revision) throw new BotRefusal('fly', 'authoritative correction');
    } finally {
      this.steer = undefined;
      this.joined.pose = { ...this.pose, vel: [0, 0, 0] };
    }
  }
  walk(destination: Destination, speed = 4, timeoutMs = 60_000): Promise<void> {
    return this.moveTo(destination, 'foot', speed, timeoutMs);
  }
  async setMode(mode: Input['mode'], pose = this.pose): Promise<void> {
    const revision = this.revision;
    this.joined.pose = Pose.parse({ ...pose, vel: [0, 0, 0] });
    this.joined.mode = MoveMode.parse(mode);
    await this.settled();
    if (revision !== this.revision || this.mode !== mode) throw new BotRefusal(mode, 'authoritative correction');
  }
  land(): Promise<void> {
    return this.setMode('landed');
  }
  dock(): Promise<void> {
    return this.setMode('docked');
  }
  /** The caller supplies the ordinary exit feet position; the server checks the ship, range and terrain. */
  disembark(feet: Vec3): Promise<void> {
    return this.setMode('foot', { ...this.pose, pos: feet });
  }
  board(parkedShip: Pose): Promise<void> {
    return this.setMode('ship', parkedShip);
  }
  async mine(target: MineTarget, beamMs = 300): Promise<Extract<ServerMessage, { t: 'mine' }>> {
    if (!Number.isFinite(beamMs) || beamMs < 250 || beamMs > 500) throw new Error('bot beam interval must be 250–500 ms');
    this.buttons = Buttons.beam;
    try {
      await this.settled();
      await this.wait(beamMs);
      const seq = ++this.requestSeq.mine;
      const result = await this.ask(
        { t: 'mine', seq, time: this.time, tool: 'multitool', ...target },
        (m): m is Extract<ServerMessage, { t: 'mine' }> => m.t === 'mine' && m.seq === seq,
      );
      if (result.result === 'refused') throw new BotRefusal('mine', result.reason ?? 'unknown');
      return result;
    } finally {
      this.buttons = 0;
    }
  }
  async fight(aim: Vec3): Promise<Extract<ServerMessage, { t: 'fire' }>> {
    this.joined.pose = { ...this.pose, quat: noseTo(aim) };
    await this.settled();
    const seq = ++this.requestSeq.fire;
    const result = await this.ask(
      { t: 'fire', seq, time: this.time, frame: this.pose.frame, aim },
      (m): m is Extract<ServerMessage, { t: 'fire' }> => m.t === 'fire' && m.seq === seq,
    );
    if (result.result === 'refused') throw new BotRefusal('fight', result.reason ?? 'unknown');
    return result;
  }
  async acceptQuest(quest: string): Promise<Extract<ServerMessage, { t: 'quests' }>> {
    const seq = ++this.requestSeq.quests;
    const result = await this.ask(
      { t: 'quest', seq, op: { op: 'accept', quest } },
      (m): m is Extract<ServerMessage, { t: 'quests' }> => m.t === 'quests' && m.seq === seq,
    );
    if (result.error) throw new BotRefusal('acceptQuest', result.error);
    return result;
  }
  async warp(system: number): Promise<void> {
    const seq = ++this.requestSeq.warp;
    const result = await this.ask(
      { t: 'warp', seq, system },
      (m): m is Extract<ServerMessage, { t: 'zone' | 'warp' }> => m.t === 'zone' || (m.t === 'warp' && m.seq === seq),
    );
    if (result.t === 'warp') throw new BotRefusal('warp', result.reason);
  }
  async syncClock(): Promise<void> {
    const id = ++this.requestSeq.ping;
    const at = performance.now();
    const pong = await this.ask({ t: 'ping', id, clientTime: at }, (m): m is Extract<ServerMessage, { t: 'pong' }> => m.t === 'pong' && m.id === id);
    const now = performance.now();
    this.clock = { time: Math.max(this.time, pong.serverTime + (now - at) / 2000), at: now };
  }
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      this.socket.addEventListener(
        'close',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.socket.close();
    });
  }
}
