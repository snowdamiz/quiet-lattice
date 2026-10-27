// The discovery service (P2.E29.T01, ARCHITECTURE §26) over a store in memory with the Postgres store's rules, a real
// star system and its drawn ground: first finds by analysis, landing and site visit, one finder of two racing, paid once
// (as found, and on join for a find made out of play), named once within the window through the filter, renamed or
// cleared by a moderator, and every player in the system told.
import { FIRST_FINDER_XP, NAME_WINDOW_S, SITE_REACH_M, siteKey } from '@astra/shared/discovery';
import type { ServerMessage } from '@astra/shared/protocol';
import { frameId, SITE_NODE_CLEARANCE, type PlanetParams } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { CodexService } from '../codex/service.ts';
import { groundOf } from '../fauna/terrain.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { homeSystemOf } from '../world/home.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { proceduralName, sitesReached } from './places.ts';
import { PlateBook, platesComponent } from './plates.ts';
import { DiscoveryService, type DiscoverySession, type DiscoveryZone } from './service.ts';
import { memoryDiscoveryStore } from './store.ts';

type Vec3 = [number, number, number];

const HOME = homeSystemOf('thalune');
const system = describeZoneSystem(HOME);
const OTHER = HOME === 0 ? 1 : 0;
const other = describeZoneSystem(OTHER);
const body = system.bodies.find((b) => b.type !== 'gas' && groundOf(b.params as PlanetParams, 0).nodes?.nodeClear.length)!;
const params = body.params as PlanetParams;
const FRAME = frameId(system.seed, body.index);
const ground = groundOf(params, 0);
const clear = ground.nodes!.nodeClear;
/** Site 0's middle, on its levelled ground. */
const siteDir: Vec3 = [clear[0]!, clear[1]!, clear[2]!];
const siteR = params.radius + ground.sample(siteDir);
const SITE: Vec3 = [siteDir[0] * siteR, siteDir[1] * siteR, siteDir[2] * siteR];
const SPECIES = `${FRAME}/0`;

const flush = () => new Promise((r) => setTimeout(r, 5));

/** A connection on a character, recording what it was sent. */
class Bot implements DiscoverySession {
  static next = 1;
  readonly id = Bot.next++;
  state = 'joined';
  readonly got: ServerMessage[] = [];
  entity = { frame: FRAME as string | null, pos: [0, 0, 0] as Vec3, mode: 'ship', level: 1 };
  zone: DiscoveryZone;
  constructor(
    readonly characterId: string,
    readonly name: string,
    zone: DiscoveryZone,
  ) {
    this.zone = zone;
  }
  send(m: ServerMessage) {
    this.got.push(m);
  }
  sendText(text: string) {
    this.got.push(JSON.parse(text) as ServerMessage);
  }
  sendBinary() {}
  /** The finds this bot holds, as its client would: reset, then each update. */
  finds(): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const m of this.got) {
      if (m.t !== 'discoveries') continue;
      if (m.reset) out.clear();
      for (const e of m.entries) out.set(`${e.kind}|${e.key}`, e);
    }
    return out;
  }
  events(kind: string) {
    return this.got.flatMap((m) => (m.t === 'event' && m.event.kind === kind ? [m.event] : []));
  }
}

function zoneOf(d: typeof system, index: number, bots: () => Bot[]): DiscoveryZone {
  const zone = {
    id: `system:${index}`,
    systemIndex: index,
    system: d,
    fauna: { tier: 0 as const, grounds: { ground: (p: PlanetParams) => groundOf(p, 0) } },
    entityOf: (v: { id: number }) => bots().find((b) => b.id === v.id)?.id,
    entity: (id: number) => {
      const b = bots().find((x) => x.id === id);
      return b ? ({ id, fields: { kind: 'player', quat: [0, 0, 0, 1], vel: [0, 0, 0], ...b.entity } } as unknown as ReturnType<DiscoveryZone['entity']>) : undefined;
    },
    patch: (id: number, set: { level?: number }) => {
      const b = bots().find((x) => x.id === id);
      if (b && set.level) b.entity.level = set.level;
    },
  };
  return zone as unknown as DiscoveryZone;
}

function setup(opts: { delayMs?: number } = {}) {
  let clock = 1000;
  const bots: Bot[] = [];
  const store = memoryDiscoveryStore('test', opts);
  const progress = new CharacterProgress();
  const plates = new PlateBook();
  const codex = new CodexService({ progress });
  const saved: string[] = [];
  const home = zoneOf(system, HOME, () => bots);
  const away = zoneOf(other, OTHER, () => bots);
  const service = new DiscoveryService({
    store,
    zones: { zoneOf: (v) => bots.find((b) => b.id === v.id)?.zone, tier: () => 0 },
    plates,
    xp: codex,
    saveNow: (id) => saved.push(id),
    now: () => clock,
  });
  const join = (name: string, zone = home) => {
    const id = `c-${name.toLowerCase().replace(/ /g, '-')}`;
    const b = new Bot(id, name, zone);
    bots.push(b);
    progress.set(id, { level: 1, xp: 0, homeSystem: HOME });
    plates.open(id);
    service.joined(b, name);
    return b;
  };
  /** scans until the store's calls have landed */
  const settle = async () => {
    service.scan();
    await flush();
    await flush();
    await new Promise((r) => setTimeout(r, (opts.delayMs ?? 0) * 3));
  };
  return {
    store,
    progress,
    plates,
    service,
    saved,
    home,
    away,
    join,
    settle,
    xp: (b: Bot) => progress.get(b.characterId)!.xp,
    tick: (s: number) => (clock += s),
    now: () => clock,
  };
}

describe('first finds', () => {
  it('lands one finder of two players landing at once, pays it once, and tells everyone in the system', async () => {
    const t = setup({ delayMs: 10 });
    const a = t.join('Ana Vel');
    const b = t.join('Bo Tran');
    const c = t.join('Cy Rand');
    await t.settle();
    // (each was sent its system's finds: none yet)
    for (const bot of [a, b, c]) expect(bot.got[0]).toMatchObject({ t: 'discoveries', system: HOME, reset: true, entries: [] });
    a.entity = { ...a.entity, mode: 'landed', pos: [params.radius + 500, 0, 0] };
    b.entity = { ...b.entity, mode: 'foot', pos: [0, params.radius + 500, 0] };
    t.service.scan();
    t.service.scan();
    await t.settle();
    const rows = [...t.store.rows.values()].filter((r) => r.kind === 'body');
    expect(rows).toHaveLength(1);
    const winner = rows[0]!.finderId === a.characterId ? a : b;
    const loser = winner === a ? b : a;
    expect(t.xp(winner)).toBe(FIRST_FINDER_XP);
    expect(t.xp(loser)).toBe(0);
    expect(t.plates.get(winner.characterId)!.plates).toEqual([{ kind: 'body', key: FRAME, at: 1000 }]);
    expect(t.plates.get(loser.characterId)!.plates).toEqual([]);
    expect(t.saved).toEqual([winner.characterId]);
    expect(winner.entity.level).toBeGreaterThan(1);
    expect(winner.events('xp')).toEqual([{ kind: 'xp', amount: FIRST_FINDER_XP, from: null, level: winner.entity.level }]);
    expect(winner.events('notice')[0]).toMatchObject({ text: `First to find ${body.name}: name it within 10 min`, tone: 'good' });
    expect(t.service.stats()).toMatchObject({ won: 1, lost: 1, paid: 1 });
    // everyone in the system holds the find, with its finder and its window; scanning on claims and pays nothing more
    for (const bot of [a, b, c])
      expect(bot.finds().get(`body|${FRAME}`)).toEqual({ kind: 'body', key: FRAME, finder: winner.name, at: 1000, until: 1000 + NAME_WINDOW_S });
    await t.settle();
    await t.settle();
    expect(t.service.stats()).toMatchObject({ claims: 2, paid: 1 });
    expect(t.xp(winner)).toBe(FIRST_FINDER_XP);
  });

  it('makes the first analysis of a species the shard’s, even before the system’s finds are loaded', async () => {
    const t = setup({ delayMs: 10 });
    const a = t.join('Ana Vel');
    const b = t.join('Bo Tran');
    t.service.analyzed({ characterId: a.characterId, key: SPECIES });
    t.service.analyzed({ characterId: b.characterId, key: SPECIES });
    t.service.analyzed({ characterId: a.characterId, key: SPECIES });
    await t.settle();
    expect([...t.store.rows.values()].map((r) => [r.kind, r.key])).toEqual([['species', SPECIES]]);
    expect(t.xp(a) + t.xp(b)).toBe(FIRST_FINDER_XP);
    // a later analysis by either claims nothing
    t.service.analyzed({ characterId: b.characterId, key: SPECIES });
    await t.settle();
    expect(t.service.stats().claims).toBe(2);
    expect(a.finds().get(`species|${SPECIES}`)).toMatchObject({ finder: t.xp(a) ? a.name : b.name });
  });

  it('reaches a site within its footprint and the reach, and not from further or from high above', async () => {
    const t = setup();
    const a = t.join('Ana Vel');
    await t.settle();
    const up = (by: number): Vec3 => [SITE[0] + siteDir[0] * by, SITE[1] + siteDir[1] * by, SITE[2] + siteDir[2] * by];
    const reach = clear[3]! - SITE_NODE_CLEARANCE + SITE_REACH_M;
    expect(sitesReached(ground, up(reach + 5), SITE_REACH_M).some((s) => s.index === 0)).toBe(false);
    a.entity = { ...a.entity, mode: 'ship', pos: up(reach + 5) };
    await t.settle();
    expect(t.store.rows.size).toBe(0);
    a.entity = { ...a.entity, pos: up(reach - 2) };
    await t.settle();
    const key = siteKey(FRAME, 0);
    expect([...t.store.rows.values()].map((r) => [r.kind, r.key, r.finderId])).toEqual([['site', key, a.characterId]]);
    expect(t.xp(a)).toBe(FIRST_FINDER_XP);
    expect(a.events('notice')[0]!.text).toContain(proceduralName('site', key, system));
  });

  it('pays a find whose claim landed after its finder left on its next join, once', async () => {
    const t = setup({ delayMs: 20 });
    const a = t.join('Ana Vel');
    t.service.analyzed({ characterId: a.characterId, key: SPECIES });
    // it leaves while the claim is in flight: persistence forgets its plates and progress
    t.service.left(a);
    t.plates.close(a.characterId);
    t.progress.delete(a.characterId);
    await t.settle();
    expect(t.store.rows.size).toBe(1);
    expect(t.service.stats().paid).toBe(0);
    // back, from what it saved (no plate, no XP): paid now, and not again however often it joins
    t.progress.set(a.characterId, { level: 1, xp: 0, homeSystem: HOME });
    t.plates.open(a.characterId);
    t.service.joined(a, a.name);
    await t.settle();
    expect(t.xp(a)).toBe(FIRST_FINDER_XP);
    expect(await t.service.reconcile(a.characterId)).toBe(0);
    t.service.joined(a, a.name);
    await t.settle();
    expect(t.xp(a)).toBe(FIRST_FINDER_XP);
    expect(t.plates.get(a.characterId)!.plates).toHaveLength(1);
  });

  it('sends a player its new system’s finds when its zone changes system', async () => {
    const t = setup();
    const a = t.join('Ana Vel');
    t.service.analyzed({ characterId: a.characterId, key: SPECIES });
    await t.settle();
    const b = t.join('Bo Tran', t.away);
    await t.settle();
    expect(b.finds().size).toBe(0);
    b.zone = t.home;
    await t.settle();
    expect([...b.finds().keys()]).toEqual([`species|${SPECIES}`]);
    expect(b.got.filter((m) => m.t === 'discoveries' && m.reset).map((m) => (m as { system: number }).system)).toEqual([OTHER, HOME]);
  });
});

describe('naming a find', () => {
  async function found() {
    const t = setup();
    const a = t.join('Ana Vel');
    const b = t.join('Bo Tran');
    t.service.analyzed({ characterId: a.characterId, key: SPECIES });
    await t.settle();
    const ask = (bot: Bot, name: string, key = SPECIES) => t.service.request(bot, { t: 'name', kind: 'species', key, name });
    return { ...t, a, b, ask };
  }

  it('takes its finder’s name within the window, once, tidied, and tells the system', async () => {
    const t = await found();
    expect(await t.ask(t.b, 'Halcyon')).toEqual({ t: 'named', kind: 'species', key: SPECIES, result: 'refused', reason: 'not_finder' });
    expect(await t.ask(t.a, '  Big   Halcyon ')).toEqual({ t: 'named', kind: 'species', key: SPECIES, result: 'named', name: 'Big Halcyon' });
    expect(t.b.finds().get(`species|${SPECIES}`)).toEqual({ kind: 'species', key: SPECIES, finder: 'Ana Vel', at: 1000, name: 'Big Halcyon' });
    expect(await t.ask(t.a, 'Other Name')).toMatchObject({ result: 'refused', reason: 'named' });
    expect(t.store.rows.get(`species|${SPECIES}`)).toMatchObject({ name: 'Big Halcyon', nameState: 'named' });
  });

  it('refuses what the filter refuses, and asking too fast', async () => {
    const t = await found();
    expect(await t.ask(t.a, 'Fuck Rock')).toMatchObject({ result: 'refused', reason: 'blocked' });
    expect(await t.ask(t.a, 'Admin')).toMatchObject({ result: 'refused', reason: 'reserved' });
    expect(await t.ask(t.a, 'Hal_cyon')).toMatchObject({ result: 'refused', reason: 'characters' });
    expect(await t.ask(t.a, 'x'.repeat(40))).toMatchObject({ result: 'refused', reason: 'rate' });
    expect(t.store.rows.get(`species|${SPECIES}`)).toMatchObject({ name: null, nameState: 'open' });
    t.tick(6);
    expect(await t.ask(t.a, 'x'.repeat(40))).toMatchObject({ result: 'refused', reason: 'length' });
    t.tick(6);
    expect(await t.ask(t.a, 'Halcyon', `${FRAME}/7`)).toMatchObject({ result: 'refused', reason: 'unknown' });
  });

  it('refuses a name after the window, and the procedural name stays', async () => {
    const t = await found();
    t.tick(NAME_WINDOW_S + 1);
    expect(await t.ask(t.a, 'Halcyon')).toMatchObject({ result: 'refused', reason: 'lapsed' });
    expect(t.store.rows.get(`species|${SPECIES}`)).toMatchObject({ name: null });
    expect(t.service.view(t.store.rows.get(`species|${SPECIES}`)!)).toEqual({ kind: 'species', key: SPECIES, finder: 'Ana Vel', at: 1000 });
  });

  it('leaves the window to the store: a find its row says has lapsed is refused whatever the service held', async () => {
    const t = await found();
    // (the row's window closed behind the service's back: another process, a moderator's edit)
    t.store.rows.get(`species|${SPECIES}`)!.nameUntil = 999;
    expect(t.service.known('species', SPECIES)!.nameUntil).toBe(1000 + NAME_WINDOW_S);
    expect(await t.ask(t.a, 'Halcyon')).toMatchObject({ result: 'refused', reason: 'lapsed' });
    expect(t.store.rows.get(`species|${SPECIES}`)).toMatchObject({ name: null });
    // and the system hears the window has closed
    expect(t.b.finds().get(`species|${SPECIES}`)).toEqual({ kind: 'species', key: SPECIES, finder: 'Ana Vel', at: 1000 });
  });

  it('lets a moderator rename or clear a find, reserved names and all, never past the blocklist', async () => {
    const t = await found();
    expect(await t.service.rename('species', SPECIES, 'Sarelun', 'admin:ops')).toMatchObject({ ok: true, find: { name: 'Sarelun', finder: 'Ana Vel' } });
    expect(t.b.finds().get(`species|${SPECIES}`)).toMatchObject({ name: 'Sarelun' });
    expect(await t.service.rename('species', SPECIES, 'Fuck Rock', 'admin:ops')).toMatchObject({ ok: false, error: 'invalid' });
    expect(await t.service.rename('species', `${FRAME}/7`, 'Halcyon', 'admin:ops')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await t.service.rename('site', SPECIES, 'Halcyon', 'admin:ops')).toMatchObject({ ok: false, error: 'invalid' });
    const cleared = await t.service.rename('species', SPECIES, null, 'admin:ops');
    expect(cleared).toEqual({ ok: true, find: { kind: 'species', key: SPECIES, finder: 'Ana Vel', at: 1000, procedural: proceduralName('species', SPECIES, system) } });
    expect(t.b.finds().get(`species|${SPECIES}`)).toEqual({ kind: 'species', key: SPECIES, finder: 'Ana Vel', at: 1000 });
    expect(await t.ask(t.a, 'Halcyon')).toMatchObject({ result: 'refused', reason: 'closed' });
  });
});

describe('the plates component', () => {
  it('saves and loads a character’s plates, and refuses ones it cannot read', () => {
    const book = new PlateBook();
    const c = platesComponent(book);
    expect(c.schema.safeParse(c.default({} as never)).success).toBe(true);
    const stored = { plates: [{ kind: 'body' as const, key: FRAME, at: 5 }] };
    c.load(stored, { character: { id: 'c1' } } as never);
    expect(book.has('c1', 'body', FRAME)).toBe(true);
    expect(c.save({ characterId: 'c1' } as never)).toEqual(stored);
    expect(c.onInvalid).toBe('refuse');
    expect(c.schema.safeParse({ plates: [{ kind: 'body', key: FRAME }] }).success).toBe(false);
    c.unload!('c1');
    expect(book.holds('c1')).toBe(false);
  });
});
