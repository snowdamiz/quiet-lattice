// WebSocket gateway (docs/ARCHITECTURE.md §2, §5): `ws` in noServer mode on the HTTP server's upgrade event, path /ws.
// The first message must be `hello` with the protocol version and a session token, within HELLO_TIMEOUT_MS; then
// `join {characterId}` puts one of the account's characters in play and is answered with `welcome`. Malformed or
// out-of-place messages are dropped and counted, never thrown.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { decodeClientMessage, PROTOCOL_VERSION, type ClientMessage } from '@astra/shared/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { TokenService } from '../accounts/tokens.ts';
import { getOwnedCharacter, isUuid, toSummary } from '../characters/characters.ts';
import type { Db } from '../db/client.ts';
import { CloseCode, Session, SessionRegistry } from '../session/session.ts';
import type { ServerClock } from '../world/clock.ts';
import { stationFrame, systemSeed, systemZoneId } from '../world/home.ts';

export const WS_PATH = '/ws';
const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30_000;

export interface WsGatewayDeps {
  db: Db;
  tokens: TokenService;
  clock: ServerClock;
  log: FastifyBaseLogger;
  helloTimeoutMs: number;
}

export interface WsStats {
  sessions: number;
  invalidMessages: number;
}

export interface WsGateway {
  readonly registry: SessionRegistry;
  stats(): WsStats;
  /** Refuses new upgrades, closes every session with 1001 and waits (briefly) for the sockets to go. */
  close(): Promise<void>;
}

export function attachWsGateway(server: Server, deps: WsGatewayDeps): WsGateway {
  const { log } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const registry = new SessionRegistry();
  let nextSessionId = 1;
  let invalidTotal = 0;
  let closing = false;

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH || closing) {
      socket.end(`HTTP/1.1 ${closing ? '503 Service Unavailable' : '404 Not Found'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const s of registry.sessions) {
      if (!s.alive) {
        s.socket.terminate();
        continue;
      }
      s.alive = false;
      s.socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const session = new Session(nextSessionId++, ws, req.socket.remoteAddress ?? 'unknown');
    registry.add(session);
    const slog = log.child({ session: session.id });
    slog.debug({ remote: session.remote }, 'socket open');

    const helloTimer = setTimeout(() => {
      if (session.state === 'hello') session.refuse('auth', `No hello within ${Math.round(deps.helloTimeoutMs / 1000)} s`);
    }, deps.helloTimeoutMs);

    // Messages are handled one at a time, in order, even though hello and join await the database.
    let chain = Promise.resolve();
    ws.on('message', (data: RawData, isBinary: boolean) => {
      chain = chain
        .then(() => handle(session, data, isBinary))
        .catch((err: unknown) => {
          slog.error({ err }, 'message handler failed');
          session.refuse('kicked', 'Server error; please reconnect');
        });
    });
    ws.on('pong', () => {
      session.alive = true;
    });
    ws.on('error', (err) => slog.debug({ err: err.message }, 'socket error'));
    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      session.state = 'closed';
      registry.remove(session);
      slog.debug({ code, invalid: session.invalidMessages }, 'socket closed');
    });
  });

  function drop(s: Session, why: string): void {
    s.invalidMessages++;
    invalidTotal++;
    log.debug({ session: s.id, why }, 'dropped message');
  }

  async function handle(s: Session, data: RawData, isBinary: boolean): Promise<void> {
    if (s.state === 'closed') return;
    // Clients send only JSON control messages; binary frames are server → client snapshots.
    const msg = isBinary ? null : decodeClientMessage(rawToString(data));
    if (s.state === 'hello') {
      if (!msg || msg.t !== 'hello') {
        drop(s, msg ? `${msg.t} before hello` : 'invalid');
        s.refuse('invalid', 'The first message must be hello');
        return;
      }
      return onHello(s, msg);
    }
    if (!msg) return drop(s, 'invalid');
    switch (msg.t) {
      case 'join':
        if (s.state !== 'authed') return drop(s, 'join after join');
        return onJoin(s, msg);
      case 'ping':
        s.send({ t: 'pong', id: msg.id, clientTime: msg.clientTime, serverTime: deps.clock.now() });
        return;
      case 'hello':
        return drop(s, 'second hello');
      default:
        // input, cast, interact, chat and ack belong to the zone (P1.E03.T02 onwards); before join they are out of place.
        if (s.state !== 'joined') drop(s, `${msg.t} before join`);
        return;
    }
  }

  async function onHello(s: Session, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (msg.version !== PROTOCOL_VERSION) {
      s.refuse('version', `This client speaks protocol ${msg.version} and the server speaks ${PROTOCOL_VERSION}. Reload the page to update.`);
      return;
    }
    const accountId = await deps.tokens.verify(msg.token);
    if (s.state !== 'hello') return; // timed out or closed while verifying
    if (!accountId || !isUuid(accountId)) {
      s.refuse('auth', 'Your session is invalid or has expired. Sign in again.');
      return;
    }
    s.accountId = accountId;
    s.state = 'authed';
  }

  async function onJoin(s: Session, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const row = await getOwnedCharacter(deps.db, s.accountId!, msg.characterId);
    if (s.state !== 'authed') return;
    if (!row) {
      s.refuse('character', 'That character does not exist on this account.');
      return;
    }
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
    stats: () => ({ sessions: registry.size, invalidMessages: invalidTotal }),
    async close() {
      closing = true;
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      const sockets = [...registry.sessions].map((s) => s.socket);
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

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
