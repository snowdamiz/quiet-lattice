// WebSocket gateway (docs/ARCHITECTURE.md §2, §5): `ws` in noServer mode on the HTTP server's upgrade event, path /ws.
// The first message must be `hello` with the protocol version and a session token, within HELLO_TIMEOUT_MS; then
// `join {characterId}` puts one of the account's characters in play, within JOIN_TIMEOUT_MS, and is answered with
// `welcome`. Malformed or out-of-place messages are dropped and counted, never thrown.
//
// Every connection's cost is bounded: sockets per IP and per account are capped, each socket has a message budget
// (token bucket) and an invalid-message allowance, and a client that stops reading is dropped once its outbound queue
// passes MAX_BUFFERED_BYTES (Session.send).
import type { IncomingMessage, Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { decodeClientMessage, peekVersion, PROTOCOL_VERSION, type ClientMessage } from '@astra/shared/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { TokenService } from '../accounts/tokens.ts';
import { getOwnedCharacter, isUuid, toSummary } from '../characters/characters.ts';
import type { Db } from '../db/client.ts';
import { CloseCode, Session, SessionRegistry } from '../session/session.ts';
import type { ServerClock } from '../world/clock.ts';
import { stationFrame, systemSeed, systemZoneId } from '../world/home.ts';
import { clientKey, TokenBucket } from './rateLimit.ts';

export const WS_PATH = '/ws';
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30_000;

/** Per-socket message limits. */
export const MESSAGE_LIMITS = {
  /** Budget: 20 Hz input plus acks, pings and chat fit with room to spare; 60 absorbs a burst after a network stall. */
  burst: 60,
  perSecond: 40,
  /** Messages over budget are dropped; this many overflows (refilled at 1/s) are forgiven before the socket is closed. */
  strikes: 20,
  strikesPerSecond: 1,
  /** Invalid or out-of-place messages tolerated before the socket is closed. */
  maxInvalid: 50,
} as const;

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
  log: FastifyBaseLogger;
  limits: WsLimits;
}

export interface WsStats {
  sessions: number;
  invalidMessages: number;
  rateLimitedMessages: number;
}

export interface WsGateway {
  readonly registry: SessionRegistry;
  stats(): WsStats;
  /** Refuses new upgrades, closes every session with 1001 and waits (briefly) for the sockets to go. */
  close(): Promise<void>;
}

/** One connection: its session and the gateway's bookkeeping for it. */
interface Conn {
  s: Session;
  ws: WebSocket;
  budget: TokenBucket;
  strikes: TokenBucket;
  /** The hello or join deadline. */
  deadline?: NodeJS.Timeout;
  /** Messages are handled one at a time, in order, even though hello and join await the database. */
  chain: Promise<void>;
}

export function attachWsGateway(server: Server, deps: WsGatewayDeps): WsGateway {
  const { log, limits } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const registry = new SessionRegistry();
  const conns = new Set<Conn>();
  const openPerIp = new Map<string, number>();
  let nextSessionId = 1;
  let invalidTotal = 0;
  let rateLimitedTotal = 0;
  let closing = false;

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
      budget: new TokenBucket(MESSAGE_LIMITS.burst, MESSAGE_LIMITS.perSecond, now),
      strikes: new TokenBucket(MESSAGE_LIMITS.strikes, MESSAGE_LIMITS.strikesPerSecond, now),
      chain: Promise.resolve(),
    };
    const { s } = c;
    conns.add(c);
    registry.add(s);
    log.debug({ session: s.id, remote: s.remote }, 'socket open');
    setDeadline(c, limits.helloTimeoutMs, () => s.refuse('auth', `No hello within ${seconds(limits.helloTimeoutMs)} s.`));

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (s.state === 'closed') return;
      // The budget is checked before anything is queued, so a flood cannot grow the handler chain.
      const t = performance.now();
      if (!c.budget.take(t)) {
        s.rateLimited++;
        rateLimitedTotal++;
        if (!c.strikes.take(t)) {
          log.warn({ session: s.id, remote: s.remote, account: s.accountId }, 'message flood; closing');
          s.refuse('invalid', 'Too many messages.');
        }
        return;
      }
      c.chain = c.chain
        .then(() => handle(c, data, isBinary))
        .catch((err: unknown) => {
          log.error({ err, session: s.id }, 'message handler failed');
          // No refusal code means "server error"; 'full' (try again later) is the closest, and blames nothing the client sent.
          s.refuse('full', 'Server error. Try again in a moment.');
        });
    });
    ws.on('pong', () => {
      s.alive = true;
    });
    ws.on('error', (err) => log.debug({ session: s.id, err: err.message }, 'socket error'));
    ws.on('close', (code) => {
      clearTimeout(c.deadline);
      s.state = 'closed';
      conns.delete(c);
      registry.remove(s);
      log.debug({ session: s.id, code, invalid: s.invalidMessages, rateLimited: s.rateLimited, reason: s.endReason }, 'socket closed');
    });
  });

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
      default:
        // input, cast, interact, chat and ack belong to the zone (P1.E03.T02 onwards); before join they are out of place.
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
    if (registry.countForAccount(accountId) >= limits.maxPerAccount) {
      s.refuse('full', `This account already has ${limits.maxPerAccount} connections open.`);
      return;
    }
    registry.bindAccount(s, accountId);
    s.state = 'authed';
    setDeadline(c, limits.joinTimeoutMs, () => {
      if (s.state === 'authed') s.refuse('character', `No character joined within ${seconds(limits.joinTimeoutMs)} s.`);
    });
  }

  async function onJoin(c: Conn, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const { s } = c;
    const row = await getOwnedCharacter(deps.db, s.accountId!, msg.characterId);
    if (s.state !== 'authed') return;
    if (!row) {
      s.refuse('character', 'That character does not exist on this account.');
      return;
    }
    clearTimeout(c.deadline);
    const previous = registry.bindCharacter(s, row.id);
    previous?.refuse('kicked', 'This character entered the world from another connection.');
    s.entityId = registry.allocateEntityId();
    s.zoneId = systemZoneId(row.homeSystem);
    s.state = 'joined';
    // Until zones exist (P1.E03.T02) every character starts docked at its home Waystation.
    s.send({
      t: 'welcome',
      accountId: s.accountId!,
      character: toSummary(row),
      entityId: s.entityId,
      serverTime: deps.clock.now(),
      zone: { id: s.zoneId, systemSeed: systemSeed(row.homeSystem) },
      pose: { frame: stationFrame(row.homeSystem), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      mode: 'docked',
    });
    log.info({ session: s.id, account: s.accountId, character: row.id, zone: s.zoneId }, 'joined');
  }

  return {
    registry,
    stats: () => ({ sessions: registry.size, invalidMessages: invalidTotal, rateLimitedMessages: rateLimitedTotal }),
    async close() {
      closing = true;
      clearInterval(heartbeat);
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

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
