// The combat service (P1.E06.T02) on a real zone of system 0 with its fauna and a hand-driven clock: shots of the base gun
// resolved from the pose the zone believes and checked cheapest first (rate, clock, mode, frame, aim), the ray against the
// creatures within the gun's range, line of sight over the ground, and a kill's XP and loot shared by damage and told.
import { killLoot, killXp, totalXpFor } from '@astra/shared/combat';
import { getWeapon } from '@astra/shared/data';
import type { ServerMessage } from '@astra/shared/protocol';
import type { QuestWorldEvent } from '@astra/shared/quests';
import type { ShipLoadout } from '@astra/shared/ships';
import { Random, type FaunaSpecies, type NodeGround } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { faunaWorld } from '../../test/faunaWorld.ts';
import { noseTo } from '../../test/pilot.ts';
import { tangents } from '../fauna/herds.ts';
import { DEFAULT_LOADOUT, InventoryService } from '../inventory/service.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { nodeGroundsHere, type NodeGroundSource } from '../resources/ground.ts';
import { splitByDamage } from '../resources/service.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { creatureSphere, LEAD_MAX_S } from './gun.ts';
import { CombatService, FIRE_BURST, IN_COMBAT_S, killTags, type CombatServiceOptions } from './service.ts';

type Vec3 = [number, number, number];
const LARK = DEFAULT_LOADOUT.ship!;
const GUN = getWeapon('pulse_lasers').params;
const docile = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'docile' && x.kind !== 'flyer')!;
const predator = (s: readonly FaunaSpecies[]) => s.find((x) => x.temperament === 'predator' && x.kind !== 'flyer')!;
const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Readonly<Vec3>, b: Readonly<Vec3>, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (v: Readonly<Vec3>): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** No ground anywhere in the way. */
const openSky: NodeGroundSource = { ground: () => ({ sampler: { R: 1, height: () => -1e12 }, nodeClear: [] }) as unknown as NodeGround };

class Viewer implements ZoneViewer {
  readonly got: ServerMessage[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
  sendText(): void {}
  send(m: ServerMessage): void {
    this.got.push(m);
  }
}

function setup(opts: Partial<CombatServiceOptions> = {}) {
  // (the zone's combat calls the service's hooks, which is made over the zone)
  const made: { service: CombatService | null } = { service: null };
  const w = faunaWorld({ tier: 3, want: (s) => !!s.some((x) => x === docile(s)) && !!predator(s), combat: () => made.service?.hooks ?? null });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const kills: [string, QuestWorldEvent][] = [];
  const refreshed: string[] = [];
  const service = (made.service = new CombatService({
    zones: { zone: (id) => (id === w.zone.id ? w.zone : undefined), zoneOf: (v) => (w.zone.has(v) ? w.zone : undefined), tier: () => 3 },
    inventory,
    now: () => w.time,
    progress,
    skills: { owned: () => [], refresh: (id) => refreshed.push(id) },
    quests: { event: (id, e) => kills.push([id, e]) },
    grounds: openSky,
    seed: 7,
    ...opts,
  }));
  let nextId = 10;
  const r = w.ground.radius;
  const upOf = (p: Readonly<Vec3>) => unit(p);
  return {
    w,
    service,
    inventory,
    progress,
    kills,
    refreshed,
    /** a creature of `species` on the ground `east` of the start, and the centre of its hit sphere */
    creature(species: FaunaSpecies, east = 0, north = 0, level = 5) {
      const [id] = w.spawn({ body: w.body.index, species: species.index, at: w.at(east, north), count: 1, level }).creatures;
      const at = () => creatureSphere(w.zone.fauna!.creature(id!)!).pos;
      return { id: id!, at };
    },
    /** a player in a ship of character `name` at `pos`, its nose toward `toward` */
    pilot(name: string, pos: Readonly<Vec3>, toward: Readonly<Vec3>, ship: ShipLoadout = LARK) {
      const viewer = new Viewer(nextId++, name);
      const entity = w.zone.join(
        viewer,
        { kind: 'player', frame: w.frame, pos: [...pos], quat: noseTo(unit(sub(toward, pos))), vel: [0, 0, 0], mode: 'ship' },
        { profile: { characterId: name, ship, skills: [] }, now: w.time },
      );
      inventory.open(name);
      progress.set(name, { level: 1, xp: 0, homeSystem: 0 });
      let seq = 0;
      return {
        viewer,
        entity,
        /** fires at `at` from where its entity is, at the world's time (`extra` overrides the message's fields) */
        fire(at: Readonly<Vec3> = toward, extra: Record<string, unknown> = {}) {
          const from = w.zone.entity(entity)!.fields.pos;
          return service.fire(viewer, { t: 'fire', seq: ++seq, time: w.time, frame: w.frame, aim: unit(sub(at, from)), ...extra } as never);
        },
        events: (kind: string) => viewer.got.flatMap((m) => (m.t === 'event' && m.event.kind === kind ? [m.event] : [])),
      };
    },
    /** the point `h` metres over `p` */
    over: (p: Readonly<Vec3>, h: number): Vec3 => add(p, upOf(p), h),
    /** a direction along the ground at `p`, `deg` degrees from its east tangent */
    along(p: Readonly<Vec3>, deg = 0): Vec3 {
      const [t, b] = tangents(unit(p));
      const a = (deg * Math.PI) / 180;
      return unit(add(add([0, 0, 0], t, Math.cos(a)), b, Math.sin(a)));
    },
    radius: r,
  };
}

describe('a shot', () => {
  it('hits the creature in its sights for the gun’s damage, and the event follows the tick', () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    const a = s.pilot('a', s.over(c.at(), 60), c.at());
    const max = s.w.zone.combat.creatureHealth(c.id)!.max;
    expect(a.fire(c.at())).toEqual({ t: 'fire', seq: 1, result: 'hit', target: c.id });
    expect(s.w.zone.combat.creatureHealth(c.id)!.hp).toBeCloseTo(max - GUN.damage!, 9);
    expect(s.w.zone.entity(c.id)!.fields.hp).toBeCloseTo((max - GUN.damage!) / max, 9);
    expect(s.service.stats()).toMatchObject({ shots: 1, hits: 1 });
  });

  it('is refused, cheapest first, out of turn, out of a zone, with no gun, too stale, out of a ship, in another frame, or aimed off the nose', () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    const a = s.pilot('a', s.over(c.at(), 60), c.at());
    const reason = (r: { result: string; reason?: string }) => r.reason ?? r.result;
    expect(reason(a.fire())).toBe('hit');
    expect(reason(s.service.fire(a.viewer, { t: 'fire', seq: 1, time: s.w.time, frame: s.w.frame, aim: [0, 0, 1] }))).toBe('stale_seq');
    expect(reason(s.service.fire(new Viewer(1, 'nobody'), { t: 'fire', seq: 1, time: s.w.time, frame: s.w.frame, aim: [0, 0, 1] }))).toBe('zone');
    // (each a second apart: a refused shot spends the gun's rate as a fired one does)
    s.w.time += 1;
    expect(reason(a.fire(c.at(), { time: s.w.time + 10 }))).toBe('stale');
    s.w.time += 1;
    expect(reason(a.fire(c.at(), { frame: s.w.zone.stationFrame }))).toBe('frame');
    // 90° off the nose
    s.w.time += 1;
    const side = s.over(c.at(), 60);
    expect(reason(a.fire(add(side, s.along(c.at()), 100)))).toBe('aim');
    s.w.time += 1;
    s.w.zone.patch(a.entity, { mode: 'landed' });
    expect(reason(a.fire())).toBe('mode');
    const unarmed = s.pilot('b', s.over(c.at(), 70), c.at(), { ...LARK, modules: {} });
    expect(reason(unarmed.fire())).toBe('weapon');
    expect(s.w.zone.combat.creatureHealth(c.id)!.hp).toBeCloseTo(s.w.zone.combat.creatureHealth(c.id)!.max - GUN.damage!, 9);
  });

  it(`fires no faster than the gun's cooldown, past a burst of ${FIRE_BURST} that absorbs jitter`, () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30, 0, 50);
    const at = c.at();
    const a = s.pilot('a', s.over(at, 60), at);
    const shot = () => (a.fire(at).reason === 'rate' ? 'rate' : 'fired');
    const results = Array.from({ length: FIRE_BURST + 1 }, shot);
    expect(results).toEqual([...Array<string>(FIRE_BURST).fill('fired'), 'rate']);
    expect(s.service.stats().refused.rate).toBe(1);
    // after a cooldown, one more
    s.w.time += GUN.cooldownS!;
    expect(shot()).toBe('fired');
    // an honest client firing every cooldown is never refused; one firing twice as fast is held to the cooldown
    s.w.time += 1;
    const honest: string[] = [];
    for (let i = 0; i < 40; i++, s.w.time += GUN.cooldownS!) honest.push(shot());
    expect(honest.every((r) => r === 'fired')).toBe(true);
    s.w.time += 1;
    let fast = 0;
    for (let i = 0; i < 40; i++, s.w.time += GUN.cooldownS! / 2) if (shot() === 'fired') fast++;
    expect(fast).toBeLessThanOrEqual(20 + FIRE_BURST);
    expect(fast).toBeGreaterThanOrEqual(20);
  });

  it(`reaches the gun's ${GUN.rangeM} m and no further`, () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    // looking down at it 30° from the horizontal
    const down = unit(add(s.along(c.at(), 45), unit(c.at()), -Math.tan(Math.PI / 6)));
    const near = s.pilot('near', add(c.at(), down, -(GUN.rangeM! - 50)), c.at());
    const far = s.pilot('far', add(c.at(), down, -(GUN.rangeM! + 50)), c.at());
    expect(far.fire(c.at()).result).toBe('miss');
    expect(near.fire(c.at()).result).toBe('hit');
    expect(s.service.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('does not see through the ground, and hits over the drawn ground when nothing is in the way', () => {
    // a wall of ground half-way between the shooter and the creature
    let mid: Vec3 = [0, 0, 1];
    const wall: NodeGroundSource = {
      ground: () =>
        ({
          sampler: { R: 1, height: (x: number, y: number, z: number) => (Math.hypot(x - mid[0], y - mid[1], z - mid[2]) * s.radius < 40 ? 1e9 : -1e12) },
          nodeClear: [],
        }) as unknown as NodeGround,
    };
    const s = setup({ grounds: wall });
    const c = s.creature(docile(s.w.species), 30);
    const from = add(s.over(c.at(), 200), s.along(c.at()), -300);
    mid = unit(add(from, sub(c.at(), from), 0.5));
    const a = s.pilot('a', from, c.at());
    expect(a.fire(c.at()).result).toBe('blocked');
    expect(s.w.zone.combat.creatureHealth(c.id)!.hp).toBe(s.w.zone.combat.creatureHealth(c.id)!.max);
    // the world's own drawn ground, from above
    const t = setup({ grounds: nodeGroundsHere });
    const d = t.creature(docile(t.w.species), 30);
    const b = t.pilot('b', add(t.over(d.at(), 150), t.along(d.at()), 30), d.at());
    expect(b.fire(d.at()).result).toBe('hit');
    expect(t.service.stats().sightSamples).toBeGreaterThan(10);
    // and while that ground is still being planned, a shot that would hit waits
    const u = setup({ grounds: { ground: () => null } });
    const e = u.creature(docile(u.w.species), 30);
    expect(u.pilot('c', u.over(e.at(), 60), e.at()).fire(e.at())).toMatchObject({ result: 'refused', reason: 'busy' });
  });

  it(`is fired from the believed pose carried on along its velocity to the shot's time, ${LEAD_MAX_S} s at most`, () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    const east = s.along(c.at());
    const up = unit(c.at());
    // 100 m over a point 10 m short of the creature, flying east at 200 m/s, guns pointing straight down
    const start = add(s.over(c.at(), 100), east, -10);
    const a = s.pilot('a', start, add(start, up, -1));
    const t0 = s.w.time;
    s.w.zone.input(
      a.viewer,
      {
        t: 'input',
        seq: 1,
        time: t0,
        mode: 'ship',
        pose: { frame: s.w.frame, pos: start, quat: noseTo([-up[0], -up[1], -up[2]]), vel: add([0, 0, 0], east, 200) },
        buttons: 0,
      },
      t0,
    );
    const shot = (time: number) => s.service.fire(a.viewer, { t: 'fire', seq: Math.round(time * 1000), time, frame: s.w.frame, aim: [-up[0], -up[1], -up[2]] });
    expect(shot(t0).result).toBe('miss');
    expect(shot(t0 + 0.05).result).toBe('hit');
    // a shot stamped a second on is carried 20 m, not 200
    expect(shot(t0 + 1).result).toBe('miss');
  });

  it('is never at a player (PvP is P2.E17.T01), nor blocked by one', () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    const a = s.pilot('a', add(s.over(c.at(), 100), s.along(c.at()), -100), c.at());
    const between = s.pilot('b', add(s.over(c.at(), 50), s.along(c.at()), -50), c.at());
    expect(a.fire(c.at())).toMatchObject({ result: 'hit', target: c.id });
    expect(s.w.zone.combat.playerHealth(between.entity)).toMatchObject({ hull: 100, shield: 100 });
    // once it is down, it cannot fire
    const hunter = s.creature(predator(s.w.species), -30);
    s.w.zone.combat.applyDamage(hunter.id, a.entity, { base: 1e5, kind: 'attack' });
    s.w.time += 1;
    expect(a.fire(c.at())).toMatchObject({ result: 'refused', reason: 'down' });
  });
});

describe('a kill', () => {
  it('shares its XP and loot by damage, levels its killers, tells them and their quests', () => {
    const s = setup();
    const sp = docile(s.w.species);
    const c = s.creature(sp, 30, 0, 8);
    const a = s.pilot('a', s.over(c.at(), 60), c.at());
    const b = s.pilot('b', s.over(c.at(), 80), c.at());
    // a is a point short of level 2
    s.progress.set('a', { level: 1, xp: totalXpFor(2) - 1, homeSystem: 0 });
    const max = s.w.zone.combat.creatureHealth(c.id)!.max;
    expect(a.fire(c.at()).result).toBe('hit');
    s.w.zone.combat.applyDamage(b.entity, c.id, { base: max, kind: 'weapon', what: 'pulse_lasers', source: { weapon: 'pulse_lasers' } });
    const parts: [string, number][] = [
      ['a', GUN.damage!],
      ['b', max - GUN.damage!],
    ];
    const xp = splitByDamage(killXp(8), parts);
    const rng = new Random(7);
    const loot = killLoot({ kind: 'fauna', bodyPlan: sp.bodyPlan, temperament: sp.temperament }, 8, () => rng.next());
    const units = splitByDamage(loot.units, parts);
    expect(s.progress.get('a')).toEqual({ level: 2, xp: totalXpFor(2) - 1 + xp.get('a')!, homeSystem: 0 });
    expect(s.progress.get('b')!.xp).toBe(xp.get('b'));
    expect(s.w.zone.entity(a.entity)!.fields.level).toBe(2);
    expect(s.refreshed).toEqual(['a']);
    expect(a.events('xp')).toEqual([{ kind: 'xp', amount: xp.get('a'), from: c.id, level: 2 }]);
    expect(b.events('xp')).toEqual([{ kind: 'xp', amount: xp.get('b'), from: c.id, level: 1 }]);
    for (const [who, p] of [
      ['a', a],
      ['b', b],
    ] as const) {
      const u = units.get(who)!;
      expect(s.inventory.get(who)!.units).toBe(2500 + u);
      expect(p.events('loot')).toEqual(u > 0 ? [{ kind: 'loot', item: 'units', count: u, from: c.id }] : []);
    }
    expect(s.kills).toEqual([
      ['a', { type: 'kill', tags: killTags({ species: sp }), entity: c.id }],
      ['b', { type: 'kill', tags: ['fauna', 'docile', sp.bodyPlan], entity: c.id }],
    ]);
    expect(s.service.stats().kills).toBe(1);
  });

  it('keeps a character in combat while it deals or takes damage, and a while after', () => {
    const s = setup();
    const c = s.creature(docile(s.w.species), 30);
    const a = s.pilot('a', s.over(c.at(), 60), c.at());
    expect(s.service.inCombat('a')).toBe(false);
    a.fire(c.at());
    expect(s.service.inCombat('a')).toBe(true);
    s.w.time += IN_COMBAT_S + 0.5;
    expect(s.service.inCombat('a')).toBe(false);
  });
});
