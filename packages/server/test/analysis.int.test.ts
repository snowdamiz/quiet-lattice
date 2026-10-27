// Analysis over the wire (P1.E08.T04, ARCHITECTURE §22), against the dockerised Postgres and Redis: a bot on foot on a
// world of its home system analyzes a creature of the server's fauna and is answered with the species' codex entry and
// its XP; its quest's `analyze` step moves on; a second analysis (of the same creature, or another of its species) is
// known and earns nothing; a creature out of range, behind a hill or asked about from a ship is refused. The codex and
// the XP are written to the character's row as it leaves, and survive a server restart: the species is known on rejoin.
import { SPECIES_XP, speciesKey } from '@astra/shared/codex';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { faunaSpecies, frameId, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYZE_RANGE_M, hitRadius } from '../src/codex/analysis.ts';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import { lineOfSight } from '../src/resources/los.ts';
import { EYE_M } from '../src/resources/service.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { along, dist } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';

type Answer = Extract<ServerMessage, { t: 'analyze' }>;

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
/** A world of the home system whose own species include a walker (a docile one if it has one: it stays put). */
const body = system.bodies.find((b) => b.type !== 'gas' && faunaSpecies(b.params as PlanetParams, 0).some((s) => s.kind !== 'flyer'))!;
const params = body.params as PlanetParams;
const FRAME = frameId(system.seed, body.index);
const walkers = faunaSpecies(params, 0).filter((s) => s.kind !== 'flyer');
const walker: FaunaSpecies = walkers.find((s) => s.temperament === 'docile') ?? walkers[0]!;
const g = groundOf(params, 0);

const lift = (p: Readonly<Vec3>, by: number): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] + (p[0] / l) * by, p[1] + (p[1] / l) * by, p[2] + (p[2] / l) * by];
};
const unitOf = (p: Readonly<Vec3>): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
};
/** The point on the ground at a direction from the world's centre. */
const onGround = (d: Readonly<Vec3>): Vec3 => {
  const u = unitOf(d);
  const r = g.radius + g.sample(u);
  return [u[0] * r, u[1] * r, u[2] * r];
};
/** The point on the ground `east` metres along it from a position. */
const east = (p: Readonly<Vec3>, m: number): Vec3 => onGround(along(unitOf(p), ...tangents(unitOf(p)), m, 0, g.radius));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What a codex stores of a species the protocol carried. */
const stored = (s: NonNullable<Answer['species']>) => ({ temperament: s.temperament, threat: s.threat, bodyPlan: s.bodyPlan, bond: s.bond, at: s.at });
const eyeOf = (stand: Readonly<Vec3>) => lift(stand, EYE_M);
const middleOf = (feet: Readonly<Vec3>) => lift(feet, hitRadius(walker) * 0.8);
const sight = (stand: Readonly<Vec3>, feet: Readonly<Vec3>) =>
  lineOfSight({ R: g.radius, height: (x, y, z) => g.sample([x, y, z]) }, eyeOf(stand), middleOf(feet));

/** A creature's spot on dry land and a stand on dry land some 30–55 m off, the ground between out of the way (or, with
 * `hill`, in it), with a margin either way for a creature that wanders a little. */
function spotAndStand(hill: boolean, skip = 0): { feet: Vec3; stand: Vec3 } {
  for (let i = 0; i < 8000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 8000;
    const a = i * 2.399963229728653;
    const rr = Math.sqrt(1 - y * y);
    const d: Vec3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    if (g.sample(d) < 5) continue;
    const feet = onGround(d);
    const [t, b] = tangents(d);
    for (const dd of hill ? [35, 45, 55] : [30]) {
      for (let k = 0; k < 12; k++) {
        const sd = along(d, t, b, Math.cos((k / 12) * Math.PI * 2) * dd, Math.sin((k / 12) * Math.PI * 2) * dd, g.radius);
        if (g.sample(sd) < 3) continue;
        const stand = onGround(sd);
        if (dist(eyeOf(stand), middleOf(feet)) > ANALYZE_RANGE_M - 15) continue;
        const ok = hill
          ? [0, 2, 4].every((up) => !sight(stand, lift(feet, up)))
          : [-1, 0, 2].every((up) => sight(stand, lift(feet, up))) && sight(stand, onGround(along(d, t, b, 3, 3, g.radius)));
        if (ok && skip-- <= 0) return { feet, stand };
      }
    }
  }
  throw new Error('no spot found');
}

const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;
const open = spotAndStand(false);
const hill = spotAndStand(true);

beforeAll(async () => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  // (its bots stand on the world with raw poses, straight from the Waystation: no movement authority here; an analysis
  // reads the mode movement authority believes, as mining does)
  server = await startTestServer({}, { movement: false });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** A bot of a character, joined: it stands anywhere on the world, asks for analyses and hears the answers. */
async function join(token: string, characterId: string) {
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  await sock.next('quests');
  const zone = server.zones.zone(welcome.zone.id)!;
  const sentAt = Date.now();
  const time = () => welcome.serverTime + (Date.now() - sentAt) / 1000;
  let inputSeq = 0;
  let seq = 0;
  return {
    sock,
    zone,
    /** stands at a point of the world, on foot (or in a ship), once the server has it there */
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'ship' = 'foot') {
      sock.send({ t: 'input', seq: ++inputSeq, time: time(), mode, pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === FRAME && dist(f.pos, pos) < 1e-6;
      });
    },
    /** a creature of the walker species on the ground at `feet`, a second and a bit after the last ask (within the
     * rate), so the ask that follows at once finds it about where it was put (creatures wander) */
    async creature(feet: Readonly<Vec3>): Promise<number> {
      await sleep(1100);
      const r = zone.fauna!.spawnHerd({ body: body.index, species: walker.index, at: feet, count: 1 });
      return r!.creatures[0]!;
    },
    /** asks to analyze `target`; the server's answer */
    async analyze(target: number): Promise<Answer> {
      const s = ++seq;
      sock.send({ t: 'analyze', seq: s, time: time(), target });
      for (;;) {
        const m = await sock.next('analyze');
        if (m.seq === s) return m;
      }
    },
  };
}

async function row(id: string) {
  const [r] = await database.db.select().from(characters).where(eq(characters.id, id));
  return r!;
}

describe('analysis over the wire', () => {
  it('records a species once with its XP, refuses out of range, through a hill and from a ship, and keeps the codex', async () => {
    const acct = await newAccount(server);
    const characterId = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
    let bot = await join(acct.token, characterId);
    const key = speciesKey(FRAME, walker.index);
    // the auto-started First Jobs, put at its `analyze` step: the server's analysis moves it on
    expect(server.quests.setStep(characterId, 'first_jobs', 3)).toBeNull();
    let quests = await bot.sock.next('quests');
    while (quests.quests.active.first_jobs?.step !== 'analyze') quests = await bot.sock.next('quests');

    // out of range (but in the open), from a ship, through a hill: refused, nothing recorded
    await bot.stand(east(open.feet, 250));
    expect(await bot.analyze(await bot.creature(open.feet))).toMatchObject({ result: 'refused', reason: 'range' });
    await bot.stand(open.stand, 'ship');
    expect(await bot.analyze(await bot.creature(open.feet))).toMatchObject({ result: 'refused', reason: 'mode' });
    await bot.stand(hill.stand);
    expect(await bot.analyze(await bot.creature(hill.feet))).toMatchObject({ result: 'refused', reason: 'los' });
    expect(server.ws.codex.get(characterId)).toEqual({ worlds: {} });

    // in range and in sight: the species' entry and its XP
    await bot.stand(open.stand);
    const id = await bot.creature(open.feet);
    const first = await bot.analyze(id);
    expect(first).toMatchObject({
      result: 'new',
      target: id,
      xp: SPECIES_XP,
      species: { key, world: FRAME, index: walker.index, name: walker.name, temperament: walker.temperament, bodyPlan: walker.bodyPlan },
    });
    expect(first.species!.threat).toBeGreaterThanOrEqual(1);
    expect(first.species!.bond).toBe(walker.bodyPlan === 'quad_heavy' ? 'big_game' : 'eligible');
    // the quest heard it from the server and moved on
    quests = await bot.sock.next('quests');
    while (quests.quests.active.first_jobs?.step === 'analyze') quests = await bot.sock.next('quests');
    expect(quests.quests.active.first_jobs!.step).toBe('orbit');

    // again, and another of its species: known, nothing earned
    await sleep(1100);
    expect(await bot.analyze(id)).toMatchObject({ result: 'known', species: { key, at: first.species!.at } });
    const again = await bot.analyze(await bot.creature(open.feet));
    expect(again).toMatchObject({ result: 'known', species: { key } });
    expect(again.xp).toBeUndefined();

    // leaving writes the codex and the XP to the character's row
    bot.sock.close();
    await waitFor(() => server.persistence.status(characterId)?.inPlay !== true, 5000, 'the character out of play');
    expect(await server.persistence.flush()).toBe(true);
    const saved = await row(characterId);
    expect(saved.xp).toBe(SPECIES_XP);
    expect((saved.state as Record<string, { v: number; data: unknown }>).codex).toEqual({
      v: 1,
      data: { worlds: { [FRAME]: { system: HOME, species: { [walker.index]: stored(first.species!) } } } },
    });

    // a new server on the same database: the species is known on rejoin, and earns nothing
    await server.close();
    server = await startTestServer({}, { movement: false });
    bot = await join(acct.token, characterId);
    expect(server.ws.codex.entry(characterId, FRAME, walker.index)).toMatchObject({ at: first.species!.at });
    await bot.stand(open.stand);
    const back = await bot.analyze(await bot.creature(open.feet));
    expect(back).toMatchObject({ result: 'known', species: { key, at: first.species!.at } });
    expect(back.xp).toBeUndefined();
    bot.sock.close();
    await waitFor(() => server.persistence.status(characterId)?.inPlay !== true, 5000, 'the character out of play');
    expect(await server.persistence.flush()).toBe(true);
    expect((await row(characterId)).xp).toBe(SPECIES_XP);
  });
});
