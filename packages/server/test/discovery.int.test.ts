// First finders over the wire (P2.E29.T01, ARCHITECTURE §26), against the dockerised Postgres and Redis on a shard of the
// test's own (nothing found yet): two players race to land on the same world, to analyze the same new species and to
// reach the same site, and each time one is the finder, paid 2000 XP once and told so, and both hear who found it. The
// finder names a find (a blocked name refused, a good one taken and heard by the other player, a second refused); a
// find whose window has lapsed keeps its procedural name; and after a restart, rejoining players see the names, and
// nothing is paid twice. Under it all, claims racing on the store itself have one winner, whichever process makes them.
import { SPECIES_XP, speciesKey } from '@astra/shared/codex';
import { FIRST_FINDER_XP, NAME_WINDOW_S, siteKey } from '@astra/shared/discovery';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import { faunaSpecies, frameId, type FaunaSpecies, type PlanetParams } from '@astra/shared/world';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYZE_RANGE_M, hitRadius } from '../src/codex/analysis.ts';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters, discoveries } from '../src/db/schema.ts';
import { plateBookIn } from '../src/discovery/plates.ts';
import { pgDiscoveryStore } from '../src/discovery/store.ts';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import { groundOf } from '../src/fauna/terrain.ts';
import { lineOfSight } from '../src/resources/los.ts';
import { EYE_M } from '../src/resources/service.ts';
import type { RunningServer } from '../src/server.ts';
import { homeSystemOf } from '../src/world/home.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { along, dist } from './faunaWorld.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, uniqueShard, waitFor } from './helpers.ts';

type Discoveries = Extract<ServerMessage, { t: 'discoveries' }>;
type Named = Extract<ServerMessage, { t: 'named' }>;
type View = Discoveries['entries'][number];

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
/** A world of the home system with sites and a walker species (a docile one if it has one: it stays put). */
const body = system.bodies.find(
  (b) =>
    b.type !== 'gas' &&
    faunaSpecies(b.params as PlanetParams, 0).some((s) => s.kind !== 'flyer') &&
    groundOf(b.params as PlanetParams, 0).nodes?.nodeClear.length,
)!;
const params = body.params as PlanetParams;
const FRAME = frameId(system.seed, body.index);
const walkers = faunaSpecies(params, 0).filter((s) => s.kind !== 'flyer');
const walker: FaunaSpecies = walkers.find((s) => s.temperament === 'docile') ?? walkers[0]!;
const SPECIES = speciesKey(FRAME, walker.index);
const g = groundOf(params, 0);
const clear = g.nodes!.nodeClear;
const SITE = siteKey(FRAME, 0);

const unitOf = (p: Readonly<Vec3>): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
};
const lift = (p: Readonly<Vec3>, by: number): Vec3 => {
  const u = unitOf(p);
  return [p[0] + u[0] * by, p[1] + u[1] * by, p[2] + u[2] * by];
};
const onGround = (d: Readonly<Vec3>): Vec3 => {
  const u = unitOf(d);
  const r = g.radius + g.sample(u);
  return [u[0] * r, u[1] * r, u[2] * r];
};
/** Whether a point is well clear of every site (so standing there reaches none). */
const clearOfSites = (p: Readonly<Vec3>) => {
  for (let i = 0; i < clear.length; i += 4) if (dist(unitOf(p), [clear[i]!, clear[i + 1]!, clear[i + 2]!]) * g.radius < 400) return false;
  return true;
};
/** Site 0's middle, on its levelled ground. */
const SITE_AT = onGround([clear[0]!, clear[1]!, clear[2]!]);

/** A creature's spot and a stand some 30 m off on dry land in sight of it, both well clear of the sites. */
function spotAndStand(): { feet: Vec3; stand: Vec3 } {
  const middleOf = (feet: Readonly<Vec3>) => lift(feet, hitRadius(walker) * 0.8);
  const sight = (stand: Readonly<Vec3>, feet: Readonly<Vec3>) =>
    lineOfSight({ R: g.radius, height: (x, y, z) => g.sample([x, y, z]) }, lift(stand, EYE_M), middleOf(feet));
  for (let i = 0; i < 8000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 8000;
    const a = i * 2.399963229728653;
    const rr = Math.sqrt(1 - y * y);
    const d: Vec3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    if (g.sample(d) < 5) continue;
    const feet = onGround(d);
    if (!clearOfSites(feet)) continue;
    const [t, b] = tangents(d);
    for (let k = 0; k < 12; k++) {
      const sd = along(d, t, b, Math.cos((k / 12) * Math.PI * 2) * 30, Math.sin((k / 12) * Math.PI * 2) * 30, g.radius);
      if (g.sample(sd) < 3) continue;
      const stand = onGround(sd);
      if (dist(lift(stand, EYE_M), middleOf(feet)) > ANALYZE_RANGE_M - 15) continue;
      if ([-1, 0, 2].every((up) => sight(stand, lift(feet, up))) && sight(stand, onGround(along(d, t, b, 3, 3, g.radius)))) return { feet, stand };
    }
  }
  throw new Error('no spot found');
}
const open = spotAndStand();

const SHARD = uniqueShard();
const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;

beforeAll(async () => {
  database = createDatabase(config.DATABASE_URL, { max: 4 });
  // (its bots stand on the world with raw poses, straight from the Waystation: no movement authority here; landings and
  // site visits read the pose and mode the zone believes)
  server = await startTestServer({}, { movement: false, shard: SHARD, discovery: true });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** Resolves with the first message received (past or future) that `pred` takes, removing it. */
async function waitMsg<M extends ServerMessage>(sock: TestSocket, pred: (m: ServerMessage) => m is M, what: string, timeoutMs = 10_000): Promise<M> {
  let found: M | undefined;
  await waitFor(
    () => {
      const i = sock.received.findIndex(pred);
      if (i >= 0) found = sock.received.splice(i, 1)[0] as M;
      return found !== undefined;
    },
    timeoutMs,
    what,
  );
  return found!;
}

/** A bot of a character, joined: it holds the finds it is told of, as a client would. */
async function join(token: string, characterId: string, name: string) {
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const zone = server.zones.zone(welcome.zone.id)!;
  const sentAt = Date.now();
  const time = () => welcome.serverTime + (Date.now() - sentAt) / 1000;
  const finds = new Map<string, View>();
  /** takes every `discoveries` message received so far into `finds` */
  const read = () => {
    for (let i = 0; i < sock.received.length;) {
      const m = sock.received[i]!;
      if (m.t !== 'discoveries') {
        i++;
        continue;
      }
      sock.received.splice(i, 1);
      if (m.reset) finds.clear();
      for (const e of m.entries) finds.set(`${e.kind}|${e.key}`, e);
    }
    return finds;
  };
  let inputSeq = 0;
  let seq = 0;
  return {
    sock,
    zone,
    name,
    characterId,
    entityId: welcome.entityId,
    read,
    /** waits until it holds a find that `pred` takes */
    async holds(kind: string, key: string, pred: (v: View) => boolean = () => true, what = `${kind} ${key}`): Promise<View> {
      await waitFor(
        () => {
          const v = read().get(`${kind}|${key}`);
          return !!v && pred(v);
        },
        10_000,
        `${name} to hold ${what}`,
      );
      return finds.get(`${kind}|${key}`)!;
    },
    /** puts itself at a point of the world in a mode, once the server has it there */
    async stand(pos: Readonly<Vec3>, mode: 'foot' | 'landed' | 'ship' = 'foot') {
      sock.send({ t: 'input', seq: ++inputSeq, time: time(), mode, pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === FRAME && dist(f.pos, pos) < 1e-6;
      });
    },
    sendStand(pos: Readonly<Vec3>, mode: 'foot' | 'landed') {
      sock.send({ t: 'input', seq: ++inputSeq, time: time(), mode, pose: { frame: FRAME, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
    },
    analyze(target: number) {
      sock.send({ t: 'analyze', seq: ++seq, time: time(), target });
    },
    async give(kind: 'body' | 'species' | 'site', key: string, name: string): Promise<Named> {
      sock.send({ t: 'name', kind, key, name } satisfies ClientMessage);
      return waitMsg(sock, (m): m is Named => m.t === 'named' && m.kind === kind && m.key === key, `named ${key}`);
    },
    xpEvents: () => sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'xp' ? [m.event.amount] : [])),
    notices: () => sock.received.flatMap((m) => (m.t === 'event' && m.event.kind === 'notice' ? [m.event.text] : [])),
  };
}
type Bot = Awaited<ReturnType<typeof join>>;

async function rows() {
  return database.db.select().from(discoveries).where(eq(discoveries.shardId, SHARD));
}
async function row(kind: 'body' | 'species' | 'site', key: string) {
  const [r] = await database.db
    .select()
    .from(discoveries)
    .where(and(eq(discoveries.shardId, SHARD), eq(discoveries.kind, kind), eq(discoveries.key, key)));
  return r;
}
async function xpOf(id: string) {
  const [r] = await database.db.select({ xp: characters.xp }).from(characters).where(eq(characters.id, id));
  return r!.xp;
}

describe('first finders over the wire', () => {
  const players: { token: string; id: string; name: string }[] = [];
  let a: Bot;
  let b: Bot;
  const finderOf = async (kind: 'body' | 'species' | 'site', key: string) => {
    const r = await row(kind, key);
    return r!.finderId === a.characterId ? a : b;
  };

  it('has one finder of two players racing to land, to analyze and to reach a site, each paid 2000 XP once', async () => {
    for (let i = 0; i < 2; i++) {
      const acct = await newAccount(server);
      const c = await newCharacter(server, acct.token, { people: 'thalune' });
      players.push({ token: acct.token, id: c.id, name: c.name });
    }
    a = await join(players[0]!.token, players[0]!.id, players[0]!.name);
    b = await join(players[1]!.token, players[1]!.id, players[1]!.name);
    // each is sent its system's finds: none yet on this shard
    for (const bot of [a, b]) {
      const reset = await waitMsg(bot.sock, (m): m is Discoveries => m.t === 'discoveries', 'the system’s finds');
      expect(reset).toEqual({ t: 'discoveries', system: HOME, reset: true, entries: [] });
    }

    // both land on the world at once (well clear of its sites)
    a.sendStand(lift(open.stand, 0.5), 'landed');
    b.sendStand(lift(open.feet, 0.5), 'landed');
    const landed = await a.holds('body', FRAME);
    await b.holds('body', FRAME);
    const bodyFinder = await finderOf('body', FRAME);
    expect(landed).toEqual({ kind: 'body', key: FRAME, finder: bodyFinder.name, at: expect.any(Number), until: landed.at + NAME_WINDOW_S });

    // both analyze one creature of a species nobody has analyzed (once the server has planned the world's ground, which
    // its analyses and its site visits read)
    const fauna = a.zone.fauna!;
    await waitFor(() => fauna.grounds.ground(params, fauna.tier) !== null, 30_000, 'the world’s ground planned');
    await Promise.all([a.stand(open.stand), b.stand(open.stand)]);
    await new Promise((r) => setTimeout(r, 1100));
    const creature = a.zone.fauna!.spawnHerd({ body: body.index, species: walker.index, at: open.feet, count: 1 })!.creatures[0]!;
    a.analyze(creature);
    b.analyze(creature);
    for (const bot of [a, b]) {
      const answer = await waitMsg(bot.sock, (m): m is Extract<ServerMessage, { t: 'analyze' }> => m.t === 'analyze', 'an analysis');
      expect(answer).toMatchObject({ result: 'new', xp: SPECIES_XP, species: { key: SPECIES } });
    }
    await a.holds('species', SPECIES);
    await b.holds('species', SPECIES);
    const speciesFinder = await finderOf('species', SPECIES);

    // both reach the same site
    a.sendStand(lift(SITE_AT, 1), 'foot');
    b.sendStand(lift(SITE_AT, 1), 'foot');
    await a.holds('site', SITE);
    await b.holds('site', SITE);
    const siteFinder = await finderOf('site', SITE);

    // one row each, its finder one of the two; each find paid to its finder alone, once, with a plate
    const all = await rows();
    expect(all.map((r) => `${r.kind}|${r.key}`).sort()).toEqual([`body|${FRAME}`, `site|${SITE}`, `species|${SPECIES}`].sort());
    const plates = plateBookIn(server.persistence.registry)!;
    const found = { [a.characterId]: 0, [b.characterId]: 0 };
    for (const f of [bodyFinder, speciesFinder, siteFinder]) found[f.characterId]!++;
    for (const bot of [a, b]) {
      expect(plates.get(bot.characterId)!.plates).toHaveLength(found[bot.characterId]!);
      await waitFor(() => bot.xpEvents().filter((x) => x === FIRST_FINDER_XP).length === found[bot.characterId], 5000, `${bot.name}'s xp events`);
      expect(bot.notices().filter((n) => n.startsWith('First to find'))).toHaveLength(found[bot.characterId]!);
    }
    expect(server.ws.discovery!.stats()).toMatchObject({ won: 3, paid: 3 });
  });

  it('takes a finder’s name within the window and tells the other player; refuses a bad name and a second name', async () => {
    const finder = await finderOf('body', FRAME);
    const other = finder === a ? b : a;
    expect(await other.give('body', FRAME, 'Halcyon Prime')).toMatchObject({ result: 'refused', reason: 'not_finder' });
    expect(await finder.give('body', FRAME, 'Fuck Rock')).toMatchObject({ result: 'refused', reason: 'blocked' });
    expect(await finder.give('body', FRAME, 'Waystation')).toMatchObject({ result: 'refused', reason: 'reserved' });
    expect(await finder.give('body', FRAME, ' Halcyon   Prime ')).toEqual({ t: 'named', kind: 'body', key: FRAME, result: 'named', name: 'Halcyon Prime' });
    expect(await other.holds('body', FRAME, (v) => v.name === 'Halcyon Prime', 'the name')).toEqual({
      kind: 'body',
      key: FRAME,
      finder: finder.name,
      at: expect.any(Number),
      name: 'Halcyon Prime',
    });
    await new Promise((r) => setTimeout(r, 5100));
    expect(await finder.give('body', FRAME, 'Second Name')).toMatchObject({ result: 'refused', reason: 'named' });
    expect(await row('body', FRAME)).toMatchObject({ name: 'Halcyon Prime', nameState: 'named', namedBy: 'finder' });
  });

  it('keeps the procedural name of a find whose window has lapsed', async () => {
    const finder = await finderOf('site', SITE);
    // (the window, as the shard's row holds it, has run out: the store refuses whatever the server held)
    await database.db
      .update(discoveries)
      .set({ nameUntil: 1 })
      .where(and(eq(discoveries.shardId, SHARD), eq(discoveries.kind, 'site'), eq(discoveries.key, SITE)));
    await new Promise((r) => setTimeout(r, 5100));
    expect(await finder.give('site', SITE, 'Lost Signal')).toMatchObject({ result: 'refused', reason: 'lapsed' });
    expect(await row('site', SITE)).toMatchObject({ name: null, nameState: 'open' });
    for (const bot of [a, b]) {
      const v = await bot.holds('site', SITE, (x) => x.until === undefined, 'the lapsed window');
      expect(v.name).toBeUndefined();
    }
  });

  it('shows the names to players rejoining after a restart, and pays nothing twice', async () => {
    const found = new Map<string, number>();
    for (const r of await rows()) found.set(r.finderId!, (found.get(r.finderId!) ?? 0) + 1);
    for (const bot of [a, b]) bot.sock.close();
    await waitFor(() => [a, b].every((bot) => server.persistence.status(bot.characterId)?.inPlay !== true), 5000, 'both out of play');
    expect(await server.persistence.flush()).toBe(true);
    for (const bot of [a, b]) expect(await xpOf(bot.characterId)).toBe(SPECIES_XP + FIRST_FINDER_XP * (found.get(bot.characterId) ?? 0));

    await server.close();
    server = await startTestServer({}, { movement: false, shard: SHARD, discovery: true });
    a = await join(players[0]!.token, players[0]!.id, players[0]!.name);
    b = await join(players[1]!.token, players[1]!.id, players[1]!.name);
    for (const bot of [a, b]) {
      expect(await bot.holds('body', FRAME, (v) => v.name === 'Halcyon Prime', 'the name')).toMatchObject({ name: 'Halcyon Prime' });
      const finds = bot.read();
      expect([...finds.keys()].sort()).toEqual([`body|${FRAME}`, `site|${SITE}`, `species|${SPECIES}`].sort());
      expect(finds.get(`site|${SITE}`)!.name).toBeUndefined();
    }
    // standing at the finds again claims and pays nothing; the plates came back with the characters
    await a.stand(lift(SITE_AT, 1));
    await b.stand(lift(SITE_AT, 1), 'landed');
    await new Promise((r) => setTimeout(r, 1200));
    expect(server.ws.discovery!.stats()).toMatchObject({ won: 0, paid: 0 });
    const plates = plateBookIn(server.persistence.registry)!;
    for (const bot of [a, b]) expect(plates.get(bot.characterId)!.plates).toHaveLength(found.get(bot.characterId) ?? 0);
    for (const bot of [a, b]) bot.sock.close();
    await waitFor(() => [a, b].every((bot) => server.persistence.status(bot.characterId)?.inPlay !== true), 5000, 'both out of play');
    expect(await server.persistence.flush()).toBe(true);
    for (const bot of [a, b]) expect(await xpOf(bot.characterId)).toBe(SPECIES_XP + FIRST_FINDER_XP * (found.get(bot.characterId) ?? 0));
  });

  it('has one winner of claims racing on the store, from as many stores (processes) as race', async () => {
    const second = createDatabase(config.DATABASE_URL, { max: 4 });
    const stores = [pgDiscoveryStore(database.db, SHARD), pgDiscoveryStore(second.db, SHARD)];
    const key = siteKey(FRAME, 1);
    const claims = Array.from({ length: 12 }, (_, i) =>
      stores[i % 2]!.claim({
        kind: 'site',
        key,
        systemSeed: system.seed,
        finderId: players[i % 2]!.id,
        finderName: players[i % 2]!.name,
        at: 100 + i,
        nameUntil: 700 + i,
      }),
    );
    const results = await Promise.all(claims);
    expect(results.filter((r) => r.won)).toHaveLength(1);
    const winner = results.find((r) => r.won)!.record;
    for (const r of results) expect(r.record).toEqual(winner);
    expect((await rows()).filter((r) => r.key === key)).toHaveLength(1);
    // the window holds at the store: a name at its end is taken, one after it is not, and the finder's alone
    const finder = winner.finderId!;
    const loser = players.find((p) => p.id !== finder)!.id;
    expect(await stores[0]!.name('site', key, loser, 'Wrong Hands', winner.nameUntil - 1)).toBeNull();
    expect(await stores[0]!.name('site', key, finder, 'Too Late', winner.nameUntil + 0.001)).toBeNull();
    expect(await stores[1]!.name('site', key, finder, 'Just In Time', winner.nameUntil)).toMatchObject({ name: 'Just In Time', nameState: 'named' });
    expect(await stores[0]!.name('site', key, finder, 'Again', winner.nameUntil - 1)).toBeNull();
    await second.close();
  });
});
