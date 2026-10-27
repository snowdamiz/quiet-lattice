// WebSocket gateway (docs/ARCHITECTURE.md §2, §5): `ws` in noServer mode on the HTTP server's upgrade event, path /ws.
// The first message must be `hello` with the protocol version and a session token, within HELLO_TIMEOUT_MS; then
// `join {characterId}` puts one of the account's characters in play, within JOIN_TIMEOUT_MS: persistence loads its saved
// state (§8) and its player entity enters the world where it was saved (or docked at its home Waystation when that pose
// is unusable, or for a new character), and `welcome` names the zone, the entity and that pose, followed at once by
// `world` (the world service's state, sent again to every joined session whenever it changes), the character's
// `inventory` and its `skills`. From then on `input` and `ack` go to the zone, which sends the session a binary snapshot
// every tick (an input movement authority refuses is answered with `correction`, and a client corrected too often is
// kicked), and closing the socket saves the character and takes the entity out. Inventory requests go to the inventory
// service and skill requests to the skill service, which answer each with the authoritative state (ARCHITECTURE §7, §14).
// Chat, party and call-for-aid beacon requests go to the social service (social/), which hears of every character that
// joins and every connection that closes. Cutscene requests go to the cutscene service (cutscenes/), which forgets a session as it
// leaves; a cutscene done ends the quest step that played it. Quest requests go to the quest runtime (quests/), which
// hears of every character once it has joined (after its party is known, so it can put it back in a quest step's
// phase) and answers each request, and whose own changes reach the session as `quests` state and quest events (§17).
// Mining hits go to the resource service (resources/), which answers each, keeps every player on a world up to date
// with the resource nodes round it, and tells the quest runtime of each share of a node broken (§18). Malformed or
// out-of-place messages are dropped and counted, never thrown.
//
// Every connection's cost is bounded: sockets per IP and per account are capped, each socket has one budget (token
// bucket) for every frame it sends (messages and control pings and pongs alike) and an invalid-message allowance, and a
// client that stops reading is dropped once its outbound queue passes MAX_BUFFERED_BYTES (Session.send, Session.pong).
// ws's automatic pong is off: an answer to a ping is sent only when the ping fits the budget.
import type { IncomingMessage, Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { decodeClientMessage, peekVersion, PROTOCOL_VERSION, type ClientMessage } from '@astra/shared/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { TokenService } from '../accounts/tokens.ts';
import { getOwnedCharacter, isUuid, toSummary } from '../characters/characters.ts';
import type { Db } from '../db/client.ts';
import type { CharacterRow } from '../db/schema.ts';
import type { InventoryService } from '../inventory/service.ts';
import { groundForRestore, POSE, PROGRESS, type PoseState, type Progress } from '../persistence/components.ts';
import { CharacterLoadError } from '../persistence/registry.ts';
import { doneEndsQuestStep } from '../quests/cutscenes.ts';
import type { QuestRuntime } from '../quests/runtime.ts';
import type { CharacterPersistence } from '../persistence/service.ts';
import { CutsceneService } from '../cutscenes/service.ts';
import { questMineEvent, ResourceService } from '../resources/service.ts';
import { CloseCode, Session, SessionRegistry } from '../session/session.ts';
import { skillServiceIn } from '../skills/component.ts';
import type { SkillService } from '../skills/service.ts';
import { SocialService } from '../social/service.ts';
import type { ServerClock } from '../world/clock.ts';
import type { WorldSource } from '../world/service.ts';
import type { ZoneManager } from '../zones/manager.ts';
import { clientKey, TokenBucket } from './rateLimit.ts';

export const WS_PATH = '/ws';
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30_000;

/** Per-socket message limits. */
export const MESSAGE_LIMITS = {
  /**
   * Budget: an honest client sends 40 messages a second on its own (input at 20 Hz and an ack per snapshot, one per
   * tick), plus its pings, casts, interactions and chat; 60/s leaves 20/s for those, and a burst of 120 absorbs the
   * backlog after a network stall (about 3 s of input and acks).
   */
  burst: 120,
  perSecond: 60,
  /** Messages over budget are dropped; this many overflows (refilled at 1/s) are forgiven before the socket is closed. */
  strikes: 20,
  strikesPerSecond: 1,
  /** Invalid or out-of-place messages tolerated before the socket is closed. */
  maxInvalid: 50,
} as const;

/** What a socket's message budget makes of one incoming frame: take it, drop it, or drop it and close the socket. */
export type Admission = 'take' | 'drop' | 'close';

/**
 * One socket's message budget (MESSAGE_LIMITS): a token bucket every incoming frame spends from, and a bucket of strikes
 * that each frame over budget spends; a socket out of strikes is closed. Times are milliseconds.
 */
export class MessageBudget {
  private readonly budget: TokenBucket;
  private readonly strikes: TokenBucket;

  constructor(now: number, limits: Pick<typeof MESSAGE_LIMITS, 'burst' | 'perSecond' | 'strikes' | 'strikesPerSecond'> = MESSAGE_LIMITS) {
    this.budget = new TokenBucket(limits.burst, limits.perSecond, now);
    this.strikes = new TokenBucket(limits.strikes, limits.strikesPerSecond, now);
  }

  admit(now: number): Admission {
    if (this.budget.take(now)) return 'take';
    return this.strikes.take(now) ? 'drop' : 'close';
  }
}

export interface WsLimits {
  helloTimeoutMs: number;
  joinTimeoutMs: number;
  maxPerIp: number;
  maxPerAccount: number;
}

export interface WsGatewayDeps {
  db: Db;
  tokens: TokenService;
  clock: ServerClock;
  world: Pick<WorldSource, 'message' | 'subscribe'>;
  zones: ZoneManager;
  log: FastifyBaseLogger;
  limits: WsLimits;
  /** Every character's inventory in play (the one persistence loads into and saves from). */
  inventory: InventoryService;
  /** Loads a character on join and saves it on leave. */
  persistence: CharacterPersistence;
  /** Reads a character's row when it belongs to the account (getOwnedCharacter on `db`; tests stand in for it). */
  ownedCharacter?: (accountId: string, characterId: string) => Promise<CharacterRow | null>;
  /** Chat and parties; the gateway makes (and starts and stops) its own when none is given. */
  social?: SocialService;
  /** Every character's skill web in play; when none is given, the one persistence's registry loads into. */
  skills?: SkillService;
  /** Every character in play's quests (its component registered with persistence); without one, quest requests are
   * dropped. */
  quests?: QuestRuntime;
  /** Cutscenes in story phases; the gateway makes its own (a production one: no client starts any) when none is given. */
  cutscenes?: CutsceneService;
  /** Mining and resource nodes; the gateway makes (and starts and stops) its own when none is given. */
  resources?: ResourceService;
}

export interface WsStats {
  sessions: number;
  invalidMessages: number;
  rateLimitedMessages: number;
}

export interface WsGateway {
  readonly registry: SessionRegistry;
  readonly inventory: InventoryService;
  readonly skills: SkillService;
  readonly social: SocialService;
  readonly cutscenes: CutsceneService;
  readonly resources: ResourceService;
  stats(): WsStats;
  /** Refuses new upgrades, closes every session with 1001 and waits (briefly) for the sockets to go. */
  close(): Promise<void>;
}

/** One connection: its session and the gateway's bookkeeping for it. */
interface Conn {
  s: Session;
  ws: WebSocket;
  budget: MessageBudget;
  /** The hello or join deadline. */
  deadline?: NodeJS.Timeout;
  /** Messages are handled one at a time, in order, even though hello and join await the database. */
  chain: Promise<void>;
}

export function attachWsGateway(server: Server, deps: WsGatewayDeps): WsGateway {
  const { log, limits } = deps;
  // autoPong off: ws would otherwise answer every client ping frame itself, outside the budget and the buffer cap.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, autoPong: false });
  const registry = new SessionRegistry();
  const cutscenes = deps.cutscenes ?? new CutsceneService({ zones: deps.zones, log });
  if (!deps.cutscenes) cutscenes.startSweeping();
  deps.zones.onViewerRemoved = (viewer) => {
    cutscenes.forget(viewer);
    if (!(viewer instanceof Session)) return;
    log.debug({ session: viewer.id, zone: viewer.zoneId, entity: viewer.entityId }, 'session out of its zone');
    viewer.entityId = null;
    viewer.zoneId = null;
  };
  const conns = new Set<Conn>();
  const unsubscribeWorld = deps.world.subscribe(() => {
    const world = deps.world.message();
    for (const c of conns) if (c.s.state === 'joined') c.s.send(world);
  });
  const openPerIp = new Map<string, number>();
  let nextSessionId = 1;
  let invalidTotal = 0;
  let rateLimitedTotal = 0;
  let closing = false;
  const { inventory, persistence } = deps;
  const ownedCharacter = deps.ownedCharacter ?? ((accountId: string, characterId: string) => getOwnedCharacter(deps.db, accountId, characterId));
  // server-side changes (loot, mining, trade, the Recall) reach the session holding the character
  const unsubscribeInventory = inventory.subscribe((characterId, reply) => {
    for (const c of conns) if (c.s.state === 'joined' && c.s.characterId === characterId) c.s.send({ t: 'inventory', ...reply });
  });
  // quest changes the server made (a step reached, a reward) and quest notices reach the session holding the character
  const unsubscribeQuests = deps.quests?.subscribe((characterId, push) => {
    for (const c of conns) {
      if (c.s.state !== 'joined' || c.s.characterId !== characterId) continue;
      for (const event of push.events) c.s.send({ t: 'event', event });
      if (push.state) c.s.send({ t: 'quests', ...push.state });
    }
  });
  const skills = deps.skills ?? needSkills(persistence);
  // fragments, points, unlocks from the world, a level or a hull reach the session holding the character (requests are answered)
  const unsubscribeSkills = skills.subscribe((characterId, reply, change) => {
    if (change !== 'server') return;
    for (const c of conns) if (c.s.state === 'joined' && c.s.characterId === characterId) c.s.send({ t: 'skills', ...reply });
  });
  const social = deps.social ?? new SocialService({ zones: deps.zones, clock: deps.clock, log });
  if (!deps.social) social.start();
  const resources = deps.resources ?? new ResourceService({ zones: deps.zones, inventory, skills, now: () => deps.clock.now(), log });
  if (!deps.resources) resources.start();
  // each share of a node broken counts for the character's quests' `mine` steps (flora's carbon counts through `collect`)
  const quests = deps.quests;
  const unsubscribeMining = quests
    ? resources.subscribe((e) => {
        const q = questMineEvent(e);
        if (q) quests.event(e.characterId, q);
      })
    : undefined;

  function rejectUpgrade(socket: Duplex, status: string): void {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (closing) return rejectUpgrade(socket, '503 Service Unavailable');
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== WS_PATH) return rejectUpgrade(socket, '404 Not Found');
    const ip = clientKey(req.socket.remoteAddress ?? 'unknown');
    const open = openPerIp.get(ip) ?? 0;
    if (open >= limits.maxPerIp) {
      log.warn({ ip }, 'too many sockets from one address');
      return rejectUpgrade(socket, '429 Too Many Requests');
    }
    // Counted from the upgrade request until the TCP socket closes, whether or not the handshake completes.
    openPerIp.set(ip, open + 1);
    socket.once('close', () => {
      const n = (openPerIp.get(ip) ?? 1) - 1;
      if (n > 0) openPerIp.set(ip, n);
      else openPerIp.delete(ip);
    });
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.s.alive) {
        c.s.drop('heartbeat timeout');
        continue;
      }
      c.s.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const now = performance.now();
    const c: Conn = {
      s: new Session(nextSessionId++, ws, clientKey(req.socket.remoteAddress ?? 'unknown')),
      ws,
      budget: new MessageBudget(now),
      chain: Promise.resolve(),
    };
    const { s } = c;
    conns.add(c);
    registry.add(s);
    log.debug({ session: s.id, remote: s.remote }, 'socket open');
    setDeadline(c, limits.helloTimeoutMs, () => s.refuse('auth', `No hello within ${seconds(limits.helloTimeoutMs)} s.`));

    ws.on('message', (data: RawData, isBinary: boolean) => {
      // The budget is checked before anything is queued, so a flood cannot grow the handler chain.
      if (!admit(c)) return;
      c.chain = c.chain
        .then(() => handle(c, data, isBinary))
        .catch((err: unknown) => {
          log.error({ err, session: s.id }, 'message handler failed');
          // No refusal code means "server error"; 'full' (try again later) is the closest, and blames nothing the client sent.
          s.refuse('full', 'Server error. Try again in a moment.');
        });
    });
    // Control frames spend the same budget. Browsers never send pings (the app has its own `ping` message), but other
    // clients may, and RFC 6455 asks for an answer, so a ping within budget gets its pong.
    ws.on('ping', (data: Buffer) => {
      if (admit(c)) s.pong(data);
    });
    ws.on('pong', () => {
      if (admit(c)) s.alive = true;
    });
    ws.on('error', (err) => log.debug({ session: s.id, err: err.message }, 'socket error'));
    ws.on('close', (code) => {
      clearTimeout(c.deadline);
      s.state = 'closed';
      // Saved before its entity leaves the zone: the pose is read from the entity. (There is no logout message yet, so
      // every close is a dropped connection: its phase keeps its place for a while.)
      persistence.leave(s, closing ? 'shutdown' : 'logout');
      deps.zones.leave(s, 'disconnected');
      cutscenes.forget(s);
      social.left(s);
      conns.delete(c);
      registry.remove(s);
      log.debug({ session: s.id, code, invalid: s.invalidMessages, rateLimited: s.rateLimited, reason: s.endReason }, 'socket closed');
    });
  });

  /**
   * Spends one token of the socket's budget on an incoming frame. Over budget the frame is dropped and costs a strike;
   * a socket out of strikes is refused. False means: ignore the frame.
   */
  function admit(c: Conn): boolean {
    const { s } = c;
    if (s.state === 'closed') return false;
    const verdict = c.budget.admit(performance.now());
    if (verdict === 'take') return true;
    s.rateLimited++;
    rateLimitedTotal++;
    if (verdict === 'close') {
      log.warn({ session: s.id, remote: s.remote, account: s.accountId }, 'frame flood; closing');
      s.refuse('invalid', 'Too many messages.');
    }
    return false;
  }

  function setDeadline(c: Conn, ms: number, onExpire: () => void): void {
    clearTimeout(c.deadline);
    c.deadline = setTimeout(onExpire, ms);
  }

  function invalid(s: Session, why: string): void {
    s.invalidMessages++;
    invalidTotal++;
    log.debug({ session: s.id, why }, 'dropped message');
    if (s.invalidMessages > MESSAGE_LIMITS.maxInvalid) s.refuse('invalid', 'Too many invalid messages.');
  }

  async function handle(c: Conn, data: RawData, isBinary: boolean): Promise<void> {
    const { s } = c;
    if (s.state === 'closed') return;
    // Clients send only JSON control messages; binary frames are server → client snapshots.
    const text = isBinary ? null : rawToString(data);
    if (s.state === 'hello') {
      // Read the version before full validation: another version's hello may not parse, and still deserves a reason.
      const version = text === null ? null : peekVersion(text);
      if (version !== null && version !== PROTOCOL_VERSION) {
        s.refuse('version', `This client speaks protocol ${version} and the server speaks ${PROTOCOL_VERSION}. Reload the page to update.`);
        return;
      }
      const msg = text === null ? null : decodeClientMessage(text);
      if (!msg || msg.t !== 'hello') {
        invalid(s, msg ? `${msg.t} before hello` : 'invalid hello');
        s.refuse('invalid', 'The first message must be hello.');
        return;
      }
      return onHello(c, msg);
    }
    const msg = text === null ? null : decodeClientMessage(text);
    if (!msg) return invalid(s, 'invalid');
    switch (msg.t) {
      case 'join':
        if (s.state !== 'authed') return invalid(s, 'join after join');
        return onJoin(c, msg);
      case 'ping':
        s.send({ t: 'pong', id: msg.id, clientTime: msg.clientTime, serverTime: deps.clock.now() });
        return;
      case 'hello':
        return invalid(s, 'second hello');
      case 'inventory':
        if (s.state !== 'joined') return invalid(s, 'inventory before join');
        s.send({ t: 'inventory', ...inventory.request(s.characterId!, msg.seq, msg.op) });
        return;
      case 'skills':
        if (s.state !== 'joined') return invalid(s, 'skills before join');
        s.send({ t: 'skills', ...skills.request(s.characterId!, msg.seq, msg.op) });
        return;
      case 'input': {
        if (s.state !== 'joined') return invalid(s, 'input before join');
        const r = deps.zones.input(s, msg);
        // 'unknown': the session's entity was taken out of its zone (onViewerRemoved), which is no fault of the client's
        if (r === 'stale' || r === 'frame') invalid(s, `input ${r}`);
        // refused by movement authority (which logged it): the correction, and the end of a client corrected too often
        else if (typeof r === 'object') {
          if (r.correction) s.send({ t: 'correction', ...r.correction });
          if (r.kick) s.refuse('kicked', 'Your ship or suit kept moving in ways the server could not accept.');
        }
        return;
      }
      case 'ack':
        // An ack of a tick the zone no longer holds (or never sent) changes nothing; it is not worth a strike.
        if (s.state !== 'joined') return invalid(s, 'ack before join');
        deps.zones.ack(s, msg.tick);
        return;
      case 'chat':
        if (s.state !== 'joined') return invalid(s, 'chat before join');
        social.chat(s, msg);
        return;
      case 'party':
        if (s.state !== 'joined') return invalid(s, 'party before join');
        social.party(s, msg.op);
        return;
      case 'beacon':
        if (s.state !== 'joined') return invalid(s, 'beacon before join');
        social.beacon(s, msg.op);
        return;
      case 'quest':
        if (s.state !== 'joined') return invalid(s, 'quest before join');
        if (!deps.quests) return invalid(s, 'no quest runtime');
        s.send({ t: 'quests', ...deps.quests.request(s.characterId!, msg.seq, msg.op) });
        return;
      case 'cutscene':
        if (s.state !== 'joined') return invalid(s, 'cutscene before join');
        {
          const r = cutscenes.handle(s, msg);
          s.send(r);
          // (a cutscene it was watching ended, played or skipped: the quest step that played it ends; given back, it does not)
          if (doneEndsQuestStep(msg, r)) deps.quests?.cutsceneEnded(s, msg.id);
        }
        return;
      case 'mine':
        if (s.state !== 'joined') return invalid(s, 'mine before join');
        s.send(resources.mine(s, msg));
        return;
      default:
        // cast and interact belong to later tasks; before join they are out of place.
        if (s.state !== 'joined') invalid(s, `${msg.t} before join`);
        return;
    }
  }

  async function onHello(c: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    const { s } = c;
    const accountId = await deps.tokens.verify(msg.token);
    if (s.state !== 'hello') return; // timed out or closed while verifying
    if (!accountId || !isUuid(accountId)) {
      s.refuse('auth', 'Your session is invalid or has expired. Sign in again.');
      return;
    }
    // At the cap, the newest connection wins and the account's oldest is closed: a choice, so a player reconnecting while
    // dead sockets linger is never locked out (logged in DECISIONS by the orchestrator).
    const open = registry.openForAccount(accountId);
    for (const old of open.slice(0, Math.max(0, open.length - limits.maxPerAccount + 1))) {
      old.refuse('kicked', `This account opened more than ${limits.maxPerAccount} connections; the oldest was closed.`);
    }
    registry.bindAccount(s, accountId);
    s.state = 'authed';
    setDeadline(c, limits.joinTimeoutMs, () => {
      if (s.state === 'authed') s.refuse('character', `No character joined within ${seconds(limits.joinTimeoutMs)} s.`);
    });
  }

  async function onJoin(c: Conn, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const { s } = c;
    // Character ids are uuids, which Postgres compares without regard to case and returns in lower case; persistence
    // keys characters by the row's id. The pin and the lookup use that one spelling.
    const characterId = msg.characterId.toLowerCase();
    // While the row is read, a save of this character still being written (it left a moment ago) is held, not evicted:
    // the row may not have it yet, and persistence loads from what it holds.
    const unpin = persistence.pin(characterId);
    try {
      const row = await ownedCharacter(s.accountId!, characterId);
      // the ground a saved pose on a world stands on, planned in the worker first, so its check reads it there
      if (row) await groundForRestore(row.state);
      if (s.state !== 'authed') return;
      // (a row under another spelling of the id would have been read without the pin holding it)
      if (!row || row.id !== characterId) {
        s.refuse('character', 'That character does not exist on this account.');
        return;
      }
      clearTimeout(c.deadline);
      const previous = registry.bindCharacter(s, row.id);
      if (previous) {
        // Saved, and its entity gone, now rather than when its socket finishes closing, so the character is never in
        // the world twice and the new session loads what the old one left. This is the character reconnecting, so its
        // phase keeps its place for this connection to find.
        persistence.leave(previous, 'kicked');
        deps.zones.leave(previous, 'disconnected');
        cutscenes.forget(previous);
        previous.refuse('kicked', 'This character entered the world from another connection.');
      }
      let loaded;
      try {
        loaded = persistence.join(s, row);
      } catch (err) {
        if (!(err instanceof CharacterLoadError)) throw err;
        log.error({ session: s.id, account: s.accountId, character: row.id, component: err.component, reason: err.reason }, 'character could not be loaded');
        s.refuse('full', 'Your character could not be loaded. Try again later.');
        return;
      }
      const at = loaded.get<PoseState>(POSE);
      const progress = loaded.get<Progress>(PROGRESS);
      const joined = deps.zones.join(s, { ...row, level: progress.level, homeSystem: progress.homeSystem }, at);
      if (joined.fellBack) log.warn({ character: row.id, saved: at, reason: joined.fellBack }, 'saved pose unusable; docked at the home Waystation');
      s.entityId = joined.entityId;
      s.zoneId = joined.zone.id;
      s.state = 'joined';
      s.send({
        t: 'welcome',
        accountId: s.accountId!,
        character: toSummary({ ...row, level: progress.level, homeSystem: progress.homeSystem }),
        entityId: joined.entityId,
        serverTime: deps.clock.now(),
        zone: { id: joined.zone.id, systemSeed: joined.zone.system.seed },
        pose: joined.pose,
        mode: joined.mode,
      });
      s.send(deps.world.message());
      // the inventory persistence loaded (its layout re-derived from the ship), request numbering from 0
      s.send({ t: 'inventory', ...inventory.state(row.id) });
      s.send({ t: 'skills', ...skills.state(row.id) });
      social.joined(s, row.name);
      // (after the party is known: a player back in a quest step's place goes back to its party's phase)
      if (deps.quests) s.send({ t: 'quests', ...deps.quests.joined(s) });
      log.info({ session: s.id, account: s.accountId, character: row.id, zone: s.zoneId }, 'joined');
    } finally {
      unpin();
    }
  }

  return {
    registry,
    inventory,
    skills,
    social,
    cutscenes,
    resources,
    stats: () => ({ sessions: registry.size, invalidMessages: invalidTotal, rateLimitedMessages: rateLimitedTotal }),
    async close() {
      closing = true;
      clearInterval(heartbeat);
      if (!deps.social) social.stop();
      if (!deps.cutscenes) cutscenes.stopSweeping();
      if (!deps.resources) await resources.close();
      unsubscribeInventory();
      unsubscribeSkills();
      unsubscribeQuests?.();
      unsubscribeMining?.();
      unsubscribeWorld();
      server.off('upgrade', onUpgrade);
      const sockets = [...conns].map((c) => c.ws);
      const gone = Promise.all(
        sockets.map((ws) => new Promise<void>((resolve) => (ws.readyState === ws.CLOSED ? resolve() : ws.once('close', () => resolve())))),
      );
      for (const ws of sockets) ws.close(CloseCode.goingAway, 'server shutting down');
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([gone, new Promise((resolve) => (timer = setTimeout(resolve, 2000)))]);
      clearTimeout(timer);
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

function needSkills(persistence: CharacterPersistence): SkillService {
  const skills = skillServiceIn(persistence.registry);
  if (!skills) throw new Error('the gateway needs a skill service: give one, or a persistence registry with the skills component');
  return skills;
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
