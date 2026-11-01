// Heat and Charge over the socket against the dockerised Postgres and Redis (P1.E07.T02): join sends the meters; a bot on
// foot mines with the beam held until it overheats, is locked out while it holds the beam, and cools out of the lockout;
// a ship regenerates Charge in sunlight inside the habitable band and not in deep space; movement authority refuses the
// pulse drive at 0 Charge with a correction (its rule logged) and a notice, lets it engage after a refill, and corrects
// cruising on past the drop-out's grace; and the meters survive leaving and a restart. Bots that stand anywhere with raw
// poses run without movement authority; the pulse drive's pilot flies out of the Waystation as a client does.
import { STATION_LAYOUT } from '@astra/shared/data';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import { meterEnvironment } from '@astra/shared/meters';
import { dirToLocal, systemPoses, type Vec3 } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf, systemSeed } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';
import { Pilot } from './pilot.ts';

type Meters = Extract<ServerMessage, { t: 'meters' }>;
type Input = Extract<ClientMessage, { t: 'input' }>;

const config = parseConfig(process.env);
let database: Database;
const running = new Set<RunningServer>();

beforeAll(async () => {
  await runMigrations(config.DATABASE_URL);
  database = createDatabase(config.DATABASE_URL, { max: 2 });
});

afterAll(async () => {
  await Promise.all([...running].map((s) => s.close()));
  await database?.close();
});

/** A server; without movement authority unless asked (its bots stand anywhere with raw poses). */
async function start(shard?: string, movement = false): Promise<RunningServer> {
  const server = await startTestServer({}, { movement, ...(shard ? { shard } : {}) });
  running.add(server);
  return server;
}

async function stop(server: RunningServer): Promise<void> {
  await server.close();
  running.delete(server);
}

const HOME = homeSystemOf('thalune');
const SYSTEM = describeZoneSystem(HOME);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(server: RunningServer, token: string, characterId: string) {
  const s = await TestSocket.open(server.wsUrl);
  s.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  s.send({ t: 'join', characterId });
  const welcome = await s.next('welcome');
  const meters = await s.next('meters');
  return { s, welcome, meters, bot: new Bot(s) };
}

/** A scripted client: inputs numbered from 1, at 20 Hz while it holds a pose. */
class Bot {
  private seq = 0;
  constructor(readonly s: TestSocket) {}

  input(mode: Input['mode'], frame: string | null, pos: Vec3, buttons = 0): void {
    this.s.send({ t: 'input', seq: ++this.seq, time: 0, mode, pose: { frame, pos, quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons });
  }

  /** Sends the same input every 50 ms for `ms`, or until `until` holds. */
  async hold(ms: number, mode: Input['mode'], frame: string | null, pos: Vec3, buttons = 0, until: () => boolean = () => false): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end && !until()) {
      this.input(mode, frame, pos, buttons);
      await sleep(50);
    }
  }
}

/** The meters states received so far that have not been taken, oldest first. */
function metersSeen(s: TestSocket): Meters[] {
  return s.received.filter((m): m is Meters => m.t === 'meters');
}

/** The next meters state that satisfies `cond`. */
async function metersWhere(s: TestSocket, cond: (m: Meters['meters']) => boolean, timeoutMs = 15_000): Promise<Meters['meters']> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const m = await s.next('meters', Math.max(1, end - Date.now()));
    if (cond(m.meters)) return m.meters;
  }
}

let pings = 0;
/** Resolves once the server has handled everything this socket sent before. */
async function handled(s: TestSocket): Promise<void> {
  const id = ++pings;
  s.send({ t: 'ping', id, clientTime: 0 });
  for (;;) if ((await s.next('pong')).id === id) return;
}

/** Standing on the home world's day side, `alt` m over its sea level, in its frame, at server world time `t`. */
function onHomeWorld(t: number, alt: number): { frame: string; pos: Vec3 } {
  const body = systemPoses(SYSTEM, t).bodies[SYSTEM.home]!;
  const [x, y, z] = body.position;
  const l = Math.hypot(x, y, z);
  const local = dirToLocal(body, [-x / l, -y / l, -z / l]);
  const r = SYSTEM.bodies[SYSTEM.home]!.radius + alt;
  return { frame: `${systemSeed(HOME)}:${SYSTEM.home}`, pos: [local[0] * r, local[1] * r, local[2] * r] };
}

/** In the system's inertial frame, `frac` of the way from the star to the home world at time t: sunlit, in the band. */
function towardHome(t: number, frac: number): Vec3 {
  const p = systemPoses(SYSTEM, t).bodies[SYSTEM.home]!.position;
  return [p[0] * frac, p[1] * frac, p[2] * frac];
}

const BEAM = 1 << 4;

describe('heat and Charge over the socket', () => {
  it('sends the meters on join; mines until overheated, holds the lockout with the beam held, and cools out of it', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token, { people: 'thalune' });
    const { s, meters, bot } = await join(server, acct.token, character.id);
    expect(meters).toMatchObject({ t: 'meters', meters: { heat: 0, heatMax: 100, overheated: false, charge: 100, chargeMax: 100 } });

    const at = onHomeWorld(server.world.clock.now(), 2);
    // the beam held on foot: 24/s on a lush world by day, overheated in about 4.2 s
    const started = Date.now();
    await bot.hold(9000, 'foot', at.frame, at.pos, BEAM, () => metersSeen(s).some((m) => m.meters.overheated));
    const over = await metersWhere(s, (m) => m.overheated);
    expect((Date.now() - started) / 1000).toBeGreaterThan(3.5);
    expect(over.heat).toBeGreaterThan(95);
    const id = character.id;
    expect(server.ws.meters.beamActive(id, server.world.clock.now())).toBe(false);
    // held through the lockout the meter only cools, at 20/s, until it is under 25
    await bot.hold(1000, 'foot', at.frame, at.pos, BEAM);
    await handled(s);
    const cooling = server.ws.meters.view(id, server.world.clock.now());
    expect(cooling.overheated).toBe(true);
    expect(cooling.heat).toBeLessThan(over.heat - 10);
    await bot.hold(6000, 'foot', at.frame, at.pos, BEAM, () => metersSeen(s).some((m) => !m.meters.overheated));
    const recovered = await metersWhere(s, (m) => !m.overheated);
    // the lockout ends at 25, and the beam, still held, heats again for what is left of that input's interval (inputs go
    // every 50 ms; the socket can bunch them)
    expect(recovered.heat).toBeGreaterThanOrEqual(25);
    expect(recovered.heat).toBeLessThan(25 + 24 * 0.15);
    // the beam, still held, heats again
    await bot.hold(500, 'foot', at.frame, at.pos, BEAM);
    await handled(s);
    expect(server.ws.meters.beamActive(id, server.world.clock.now())).toBe(true);
    s.close();
  }, 40_000);

  it('regenerates Charge in sunlight inside the habitable band, not in deep space', async () => {
    const server = await start();
    const acct = await newAccount(server);
    const character = await newCharacter(server, acct.token, { people: 'thalune' });
    const id = character.id;
    const { s, bot } = await join(server, acct.token, id);
    const clock = () => server.world.clock.now();

    // ship actives' Charge (P1.E07.T03) is the server's to spend
    expect(server.ws.meters.spendCharge(id, 60, clock())).toMatchObject({ ok: true });
    expect((await metersWhere(s, (m) => m.charge <= 40)).charge).toBe(40);

    const band = towardHome(clock(), 0.9);
    expect(meterEnvironment(SYSTEM, systemPoses(SYSTEM, clock()).bodies, { frame: null, world: band })).toMatchObject({ sunlight: true, habitableBand: true });
    bot.input('ship', null, band);
    await handled(s);
    const c0 = server.ws.meters.view(id, clock()).charge;
    await bot.hold(2000, 'ship', null, band);
    await handled(s);
    const c1 = server.ws.meters.view(id, clock()).charge;
    // 2/s for about two seconds
    expect(c1 - c0).toBeGreaterThan(3);
    expect(c1 - c0).toBeLessThan(5);
    const pushed = metersSeen(s).map((m) => m.meters.charge);
    expect(pushed.length).toBeGreaterThanOrEqual(2);
    expect(pushed.at(-1)!).toBeGreaterThan(c0);

    // beyond the system's reach: nothing
    const deep: Vec3 = [SYSTEM.outerOrbit * 1.5, 0, 0];
    bot.input('ship', null, deep);
    await handled(s);
    const d0 = server.ws.meters.view(id, clock()).charge;
    await bot.hold(2000, 'ship', null, deep);
    await handled(s);
    expect(server.ws.meters.view(id, clock()).charge).toBeCloseTo(d0, 6);
    s.close();
  }, 40_000);

  it('under movement authority, corrects a pulse drive engaged with Charge empty, logging its rule, and engages it with Charge', async () => {
    const server = await start(undefined, true);
    const p = await Pilot.join(server);
    const id = p.characterId;
    const clock = () => server.world.clock.now();
    const zone = server.zones.zone(p.welcome.zone.id)!;
    // off the pad, out of the hangar's mouth and on, well clear of the Waystation
    const [x, y, z] = p.welcome.pose.pos;
    const out: Vec3 = [0, 30, STATION_LAYOUT.hangar.z1 + 60];
    await p.hold('docked', 300);
    await p.fly([[x, y, z], [x, 14, z], [x, 14, 40], out], [10, 40, 60]);
    const clear: Vec3 = [0, 30, out[2] + 1500];
    await p.fly([out, clear], [500]);
    expect(p.corrections).toEqual([]);

    // Charge run out (the meters as a character joins with them empty: no regeneration before the zone takes an input
    // again), everything sent before handled first
    await handled(p.sock);
    server.ws.meters.open(id, { heat: 0, overheated: false, charge: 0, at: clock() });
    expect(server.ws.meters.allowsMode(id, 'pulse', clock())).toBe(false);
    // the drive engaged where the ship is: corrected back to the ship it was, the rule logged, and the pilot told why
    const at = p.last;
    const seq = p.send(at, 'pulse');
    await waitFor(() => p.corrections.length > 0, 5000, 'the correction');
    const correction = p.corrections[0]!;
    expect(correction).toMatchObject({ seq, mode: 'ship', pose: { frame: at.frame } });
    expect(Math.hypot(...correction.pose.pos.map((v, i) => v - at.pos[i]!))).toBeLessThan(1e-3);
    expect(zone.movement!.recent.filter((r) => r.characterId === id)).toEqual([
      expect.objectContaining({ rule: 'pulse_charge', unit: 'charge', detail: 'engaging with Charge empty', mode: 'ship', kicked: false }),
    ]);
    expect(zone.entity(p.entityId)!.fields.mode).toBe('ship');
    const notices = () => p.sock.received.filter((m) => m.t === 'event' && m.event.kind === 'notice');
    await waitFor(() => notices().length > 0, 5000, 'the notice');
    expect(notices()).toEqual([{ t: 'event', event: { kind: 'notice', text: 'Charge empty: the pulse drive will not engage', tone: 'warn' } }]);

    // refilled at a Waystation (the station's terminal takes its price, P1.E11/P1.E13): back where it was corrected to, it
    // engages and cruises on (under the drive's limit so near the Waystation, about 1 km/s), with no more corrections
    expect(server.ws.meters.refillCharge(id, clock()).charge).toBe(100);
    p.send(at, 'ship');
    await p.fly([clear, [0, 30, clear[2] + 800]], [800], 'pulse');
    await handled(p.sock);
    await waitFor(() => zone.entity(p.entityId)?.fields.mode === 'pulse', 5000, 'the drive engaged');
    expect(p.corrections).toHaveLength(1);
    expect(notices()).toHaveLength(1);
    expect(server.ws.meters.allowsMode(id, 'pulse', clock())).toBe(true);

    // on the drive with Charge run out long ago as far as the meters know (as a character comes back on it with an empty
    // meter): cruising on is past the drop-out's grace, and corrected too
    await handled(p.sock);
    server.ws.meters.open(id, { heat: 0, overheated: false, charge: 0, at: clock() });
    const cruising = p.last;
    p.send({ ...cruising, pos: [cruising.pos[0], cruising.pos[1], cruising.pos[2] + 40] }, 'pulse');
    await waitFor(() => p.corrections.length === 2, 5000, 'the second correction');
    expect(p.corrections[1]).toMatchObject({ mode: 'pulse' });
    expect(zone.movement!.recent.filter((r) => r.characterId === id).at(-1)).toMatchObject({
      rule: 'pulse_charge',
      detail: 'cruising on past the drop-out',
      mode: 'pulse',
    });
    p.close();
  }, 60_000);

  it('keeps Charge and heat across leaving and a restart, heat cooling for the time away', async () => {
    const shard = uniqueShard();
    const first = await start(shard);
    const acct = await newAccount(first);
    const character = await newCharacter(first, acct.token, { people: 'thalune' });
    const id = character.id;
    const a = await join(first, acct.token, id);
    const clock = () => first.world.clock.now();
    expect(first.ws.meters.spendCharge(id, 63, clock())).toMatchObject({ ok: true });
    expect(first.ws.meters.addHeat(id, 90, clock())).toMatchObject({ ok: true });
    a.bot.input('ship', null, [SYSTEM.outerOrbit * 1.5, 0, 0]);
    await handled(a.s);
    a.s.close();
    await a.s.closed;

    // back at once: Charge as it was, heat a little cooler
    const b = await join(first, acct.token, id);
    expect(b.meters.meters.charge).toBeCloseTo(37, 3);
    expect(b.meters.meters.heat).toBeLessThan(90);
    b.s.close();
    await b.s.closed;

    await stop(first); // graceful: every character in play is saved
    const [row] = await database.db.select().from(characters).where(eq(characters.id, id));
    const stored = row!.state.meters as { v: number; data: { charge: number } };
    expect(stored.v).toBe(1);
    expect(stored.data.charge).toBeCloseTo(37, 3);

    const second = await start(shard);
    const c = await join(second, acct.token, id);
    expect(c.meters.meters).toMatchObject({ overheated: false, chargeMax: 100 });
    expect(c.meters.meters.charge).toBeCloseTo(37, 3);
    expect(c.meters.meters.heat).toBeLessThan(90);
    c.s.close();
    await stop(second);
  }, 60_000);
});
