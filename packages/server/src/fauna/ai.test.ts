// Each behaviour of the herd AI (DESIGN 12.2), run through a zone's fauna sim on a real world of system 0: a player on
// foot on open ground, a herd placed near it with spawnHerd, and the zone ticked at 20 Hz.
import { describe, expect, it } from 'vitest';
import type { FaunaSpecies } from '@astra/shared/world';
import { dist, faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import { AI, RULES } from './ai.ts';
import type { CreatureInfo } from './sim.ts';

const walker = (s: FaunaSpecies) => s.kind !== 'flyer';
const find = (w: FaunaWorld, t: (s: FaunaSpecies) => boolean) => w.species.find(t)!;
const of = (w: FaunaWorld, ids: readonly number[]): CreatureInfo[] => w.zone.fauna!.creatures().filter((c) => ids.includes(c.id));
const one = (w: FaunaWorld, id: number): CreatureInfo => of(w, [id])[0]!;
const living = (w: FaunaWorld) => w.zone.fauna!.creatures();
const playerPos = (w: FaunaWorld) => w.zone.entity(w.player)!.fields.pos;
/** Moves the player `lead` metres ahead of a creature along `way` (a unit vector along the ground). */
const keepAhead = (w: FaunaWorld, c: CreatureInfo, way: readonly number[], lead: number) =>
  w.movePlayer(w.onGround([c.pos[0] + way[0]! * lead, c.pos[1] + way[1]! * lead, c.pos[2] + way[2]! * lead]));
const groundDist = (a: readonly number[], b: readonly number[]) => {
  const up = a.map((x) => x / Math.hypot(...a));
  const d = b.map((x, i) => x - a[i]!);
  const along = d.reduce((n, x, i) => n + x * up[i]!, 0);
  return Math.hypot(...d.map((x, i) => x - up[i]! * along));
};

/** Height of a creature above the ground under it. */
const aboveGround = (w: FaunaWorld, c: CreatureInfo) => Math.hypot(...c.pos) - w.ground.radius - w.ground.sample(c.pos);

describe('docile herds', () => {
  it('idle and wander about their home, on the ground', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'docile' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'docile' && walker(x));
    const at = w.at(40, 0);
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at, count: 3 });
    const seen = new Set<string>();
    let far = 0;
    w.run(90, () => {
      for (const c of of(w, creatures)) {
        seen.add(c.state);
        far = Math.max(far, dist(c.pos, at));
      }
    });
    expect([...seen].sort()).toEqual(['idle', 'wander']);
    // they wander, but home pulls them back
    expect(far).toBeGreaterThan(8);
    expect(far).toBeLessThan(AI.wanderLeashM + 30);
    for (const c of of(w, creatures)) expect(Math.abs(aboveGround(w, c))).toBeLessThan(0.5);
  });

  it('do not flee a player on foot beside them', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'docile' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'docile' && walker(x));
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(0, 6), count: 2 });
    w.run(10, () => {
      for (const c of of(w, creatures)) expect(c.state).not.toBe('flee');
    });
  });
});

describe('skittish herds', () => {
  const want = (s: readonly FaunaSpecies[]) => s.some((x) => x.temperament === 'skittish' && walker(x));

  it('flee a player on foot within 14 m + 3 m × size, and calm down after', () => {
    const w = faunaWorld({ tier: 0, want });
    const sp = find(w, (x) => x.temperament === 'skittish' && walker(x));
    const r = RULES.fleeBaseM + RULES.fleePerSizeM * sp.size;
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(r + 25, 0), count: 1 });
    w.run(3);
    expect(one(w, creatures[0]!).state).not.toBe('flee');
    const c0 = one(w, creatures[0]!);
    // step up to it
    const toward = c0.pos.map((x, i) => playerPos(w)[i]! + (x - playerPos(w)[i]!) * (1 - (r * 0.5) / dist(c0.pos, playerPos(w)))) as [number, number, number];
    w.movePlayer(toward);
    w.run(0.2);
    expect(one(w, creatures[0]!).state).toBe('flee');
    const d0 = dist(one(w, creatures[0]!).pos, playerPos(w));
    w.run(2);
    expect(dist(one(w, creatures[0]!).pos, playerPos(w))).toBeGreaterThan(d0 + 5);
    w.run(10);
    expect(one(w, creatures[0]!).state).not.toBe('flee');
  });

  it('ignore a player passing in a ship', () => {
    const w = faunaWorld({ tier: 0, want });
    const sp = find(w, (x) => x.temperament === 'skittish' && walker(x));
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(30, 0), count: 1 });
    w.run(1);
    w.movePlayer(one(w, creatures[0]!).pos, 'ship');
    w.run(3, () => expect(one(w, creatures[0]!).state).not.toBe('flee'));
  });
});

describe('grazers and predators', () => {
  it('a predator hunts a grazer herd, and the grazers flee it', () => {
    const w = faunaWorld({
      tier: 3,
      want: (s) => s.some((x) => x.temperament === 'predator' && walker(x)) && s.some((x) => x.tier === 0 && walker(x)),
    });
    const pred = find(w, (x) => x.temperament === 'predator' && walker(x));
    const graze = find(w, (x) => x.tier === 0 && walker(x));
    // far from the player (beyond the predator's senses), close to each other
    const grazers = w.spawn({ body: w.body.index, species: graze.index, at: w.at(150, 0), count: 3 }).creatures;
    const hunters = w.spawn({ body: w.body.index, species: pred.index, at: w.at(150, 35), count: 1 }).creatures;
    const states = new Set<string>();
    let fled = false;
    w.run(20, () => {
      const h = one(w, hunters[0]!);
      states.add(h.state);
      if (h.target !== null && grazers.includes(h.target) && of(w, grazers).some((g) => g.state === 'flee')) fled = true;
    });
    expect(states.has('stalk') || states.has('rush')).toBe(true);
    expect(fled).toBe(true);
  });
});

describe('territorial herds', () => {
  it('stand alert while a player stays within 20 m, charge after 5 s, strike once and return to the herd', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'territorial') });
    const sp = find(w, (x) => x.temperament === 'territorial');
    const at = w.at(RULES.territorialM - 6, 0);
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at, count: 2 });
    const timeline: { t: number; states: string[]; attack: (number | null)[] }[] = [];
    const t0 = w.time;
    w.run(12, () => timeline.push({ t: w.time - t0, states: of(w, creatures).map((c) => c.state), attack: of(w, creatures).map((c) => c.attack) }));
    const first = (s: string) => timeline.find((x) => x.states.includes(s))?.t ?? Infinity;
    expect(first('alert')).toBeLessThan(1);
    expect(first('charge')).toBeGreaterThanOrEqual(RULES.territorialS - 0.1);
    expect(first('charge')).toBeLessThan(RULES.territorialS + 0.5);
    expect(first('attack')).toBeGreaterThan(first('charge'));
    // the attack phase runs from 0 towards 1, and is only sent while attacking
    const phases = timeline.flatMap((x) => x.attack.filter((a): a is number => a !== null));
    expect(Math.max(...phases)).toBeGreaterThan(0.5);
    for (const x of timeline) x.states.forEach((s, i) => expect(x.attack[i] !== null).toBe(s === 'attack'));
    expect(first('return')).toBeGreaterThan(first('attack'));
    // the player walks off: back to the herd and grazing
    w.movePlayer(w.at(-150, 0));
    w.run(20);
    for (const c of of(w, creatures)) {
      expect(['idle', 'wander']).toContain(c.state);
      expect(dist(c.pos, at)).toBeLessThan(AI.wanderLeashM + 15);
    }
  });

  it('give up a charge 60 m from the herd and go back to it', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'territorial') });
    const sp = find(w, (x) => x.temperament === 'territorial');
    const way = w.dryWay(AI.territorialLeashM + 60);
    const home = w.onGround(w.at(0, 0).map((x, i) => x - way[i]! * 12));
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: home, count: 1 });
    const id = creatures[0]!;
    // stand by the herd until it charges, then run, always 10 m ahead of it
    w.run(RULES.territorialS + 0.5);
    expect(one(w, id).state).toBe('charge');
    const states = new Set<string>();
    let farthest = 0;
    w.run(15, () => {
      const c = one(w, id);
      states.add(c.state);
      farthest = Math.max(farthest, groundDist(home, c.pos));
      if (c.state === 'charge') keepAhead(w, c, way, 10);
    });
    expect(states.has('attack')).toBe(false);
    expect(states.has('return')).toBe(true);
    expect(farthest).toBeGreaterThan(AI.territorialLeashM - 5);
    // (it coasts a few metres as it pulls up)
    expect(farthest).toBeLessThan(AI.territorialLeashM + 6);
    expect(groundDist(home, one(w, id).pos)).toBeLessThan(10);
  });

  it('let a player pass at a distance', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'territorial') });
    const sp = find(w, (x) => x.temperament === 'territorial');
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(RULES.territorialM + 25, 0), count: 2 });
    w.run(10, () => {
      for (const c of of(w, creatures)) expect(['idle', 'wander']).toContain(c.state);
    });
  });
});

describe('predators', () => {
  const want = (role: string) => (s: readonly FaunaSpecies[]) => s.some((x) => x.temperament === 'predator' && x.role === role);

  it('stalk to 30 m, rush, attack, and chase a player who runs', () => {
    const w = faunaWorld({ tier: 3, want: want('stalker') });
    const sp = find(w, (x) => x.temperament === 'predator' && x.role === 'stalker');
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(50, 0), count: 1 });
    const id = creatures[0]!;
    const seen: { state: string; d: number }[] = [];
    w.run(20, () => {
      const c = one(w, id);
      seen.push({ state: c.state, d: dist(c.pos, playerPos(w)) });
    });
    const firstStalk = seen.findIndex((s) => s.state === 'stalk');
    const firstRush = seen.findIndex((s) => s.state === 'rush');
    const firstAttack = seen.findIndex((s) => s.state === 'attack');
    expect(firstStalk).toBeGreaterThanOrEqual(0);
    expect(firstRush).toBeGreaterThan(firstStalk);
    expect(firstAttack).toBeGreaterThan(firstRush);
    expect(seen[firstRush]!.d).toBeLessThanOrEqual(RULES.stalkM + 3);
    expect(seen.slice(firstStalk, firstRush).every((s) => s.d > RULES.stalkM - 3)).toBe(true);
    expect(one(w, id).target).toBe(w.player);
    // the player runs 60 m; the predator follows and is on it again
    w.movePlayer(w.at(-60, 0));
    let rushed = false;
    w.run(15, () => (rushed ||= one(w, id).state === 'rush'));
    expect(rushed).toBe(true);
    expect(one(w, id).state).toBe('attack');
    expect(dist(one(w, id).pos, playerPos(w))).toBeLessThan(5);
  });

  it('give up past their leash and go home', () => {
    const w = faunaWorld({ tier: 3, want: want('stalker') });
    const sp = find(w, (x) => x.temperament === 'predator' && x.role === 'stalker');
    const home = w.at(40, 0);
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: home, count: 1 });
    w.run(6);
    expect(one(w, creatures[0]!).target).toBe(w.player);
    // the player boards a ship: no longer prey
    w.movePlayer(playerPos(w), 'ship');
    w.run(1);
    expect(one(w, creatures[0]!).target).toBeNull();
    expect(['return', 'idle', 'wander']).toContain(one(w, creatures[0]!).state);
    w.run(30);
    expect(dist(one(w, creatures[0]!).pos, home)).toBeLessThan(AI.wanderLeashM + 15);
  });

  it('chase no further than 200 m from home, then go all the way home before hunting again', () => {
    const w = faunaWorld({ tier: 3, want: want('stalker') });
    const sp = find(w, (x) => x.temperament === 'predator' && x.role === 'stalker');
    const way = w.dryWay(AI.huntLeashM + 80);
    const home = w.onGround(w.at(0, 0).map((x, i) => x - way[i]! * 40));
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: home, count: 1 });
    const id = creatures[0]!;
    w.run(8);
    expect(one(w, id).target).toBe(w.player);
    // the player runs along the way, always 15 m ahead of it
    const seen: string[] = [];
    let farthest = 0;
    let gaveUpAt = Infinity;
    w.run(40, () => {
      const c = one(w, id);
      if (seen.at(-1) !== c.state) seen.push(c.state);
      farthest = Math.max(farthest, groundDist(home, c.pos));
      if (c.state === 'rush' || c.state === 'stalk' || c.state === 'attack') keepAhead(w, c, way, 15);
      else if (gaveUpAt === Infinity) gaveUpAt = groundDist(home, c.pos);
    });
    expect(farthest).toBeGreaterThan(AI.huntLeashM - 5);
    // (it coasts a few metres as it pulls up)
    expect(farthest).toBeLessThan(AI.huntLeashM + 6);
    expect(gaveUpAt).toBeGreaterThan(AI.huntLeashM - 2);
    expect(seen).toContain('return');
    // home again, and the player (left standing 15 m past the leash) is out of its senses
    expect(groundDist(home, one(w, id).pos)).toBeLessThan(AI.wanderLeashM + 5);
    expect(one(w, id).target).toBeNull();
  });

  it('rest 15 s after going for prey before hunting prey again', () => {
    const w = faunaWorld({
      tier: 3,
      want: (s) => s.some((x) => x.temperament === 'predator' && x.role === 'stalker') && s.some((x) => x.tier === 0 && x.kind !== 'flyer'),
    });
    const pred = find(w, (x) => x.temperament === 'predator' && x.role === 'stalker');
    const graze = find(w, (x) => x.tier === 0 && x.kind !== 'flyer');
    // far from the player, beyond the predator's senses
    w.spawn({ body: w.body.index, species: graze.index, at: w.at(150, 20), count: 4 });
    const hunter = w.spawn({ body: w.body.index, species: pred.index, at: w.at(150, 0), count: 1 }).creatures[0]!;
    const grazers = new Set(
      of(w, [hunter]).length
        ? living(w)
            .filter((c) => c.species.index === graze.index)
            .map((c) => c.id)
        : [],
    );
    let restFrom: number | null = null;
    const huntedPreyAt: number[] = [];
    w.run(90, () => {
      const c = one(w, hunter);
      if (c.target !== null && grazers.has(c.target)) huntedPreyAt.push(w.time);
      if (restFrom === null && c.state === 'return' && huntedPreyAt.length) restFrom = w.time;
    });
    expect(restFrom).not.toBeNull();
    const again = huntedPreyAt.find((t) => t > restFrom!);
    // it hunted prey again later, but not within its rest
    expect(again).toBeDefined();
    expect(again! - restFrom!).toBeGreaterThanOrEqual(AI.preyRestS - 0.1);
  });

  it('hunt as a pack: one flanks while one feints', () => {
    const w = faunaWorld({ tier: 3, want: want('pack') });
    const sp = find(w, (x) => x.temperament === 'predator' && x.role === 'pack');
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(45, 0), count: 3 });
    const [leader, flanker, feinter] = creatures as [number, number, number];
    const states = new Map<number, Set<string>>(creatures.map((id) => [id, new Set()]));
    let rushFrom: Record<number, [number, number, number]> = {};
    w.run(25, () => {
      for (const c of of(w, creatures)) {
        if (c.state === 'rush' && !states.get(c.id)!.has('rush')) rushFrom = { ...rushFrom, [c.id]: c.pos };
        states.get(c.id)!.add(c.state);
      }
    });
    expect(states.get(feinter)!.has('feint')).toBe(true);
    expect(states.get(leader)!.has('attack')).toBe(true);
    // the flanker went in from the side: its line to the player meets the leader's at a wide angle
    const p = playerPos(w);
    const v = (id: number) => rushFrom[id]!.map((x, i) => x - p[i]!);
    const [a, b] = [v(leader), v(flanker)];
    const cos = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(...a) * Math.hypot(...b));
    expect(cos).toBeLessThan(Math.cos(Math.PI / 4));
  });

  it('divers circle lower over their prey, dive, strike and climb', () => {
    const w = faunaWorld({ tier: 3, want: want('diver') });
    const sp = find(w, (x) => x.temperament === 'predator' && x.role === 'diver');
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(40, 0), count: 1 });
    const order: string[] = [];
    let lowest = Infinity;
    let circlingHigh = 0;
    w.run(40, () => {
      const c = one(w, creatures[0]!);
      if (order.at(-1) !== c.state) order.push(c.state);
      if (c.state === 'attack') lowest = Math.min(lowest, aboveGround(w, c));
      if (c.state === 'circle') circlingHigh = Math.max(circlingHigh, aboveGround(w, c));
    });
    const seq = order.join(' ');
    expect(seq).toMatch(/circle dive attack climb/);
    expect(lowest).toBeLessThan(3.5);
    expect(circlingHigh).toBeGreaterThan(AI.circleLowM + 5);
  });
});

describe('ambushers', () => {
  it('lie still until a player is within 8 m, strike, and go back to lie in wait', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'ambusher') });
    const sp = find(w, (x) => x.temperament === 'ambusher');
    const spot = w.at(15, 0);
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: spot, count: 1 });
    const id = creatures[0]!;
    const start = one(w, id).pos;
    w.run(8, () => {
      expect(one(w, id).state).toBe('lurk');
      expect(dist(one(w, id).pos, start)).toBe(0);
    });
    w.movePlayer(w.at(15 - RULES.ambushM + 2, 0));
    let attacked = false;
    w.run(4, () => (attacked ||= one(w, id).attack !== null));
    expect(attacked).toBe(true);
    w.movePlayer(w.at(-120, 0));
    w.run(20);
    expect(one(w, id).state).toBe('lurk');
    expect(dist(one(w, id).pos, start)).toBeLessThan(3);
  });
});

describe('the apex', () => {
  const want = (s: readonly FaunaSpecies[]) => s.some((x) => x.temperament === 'apex') && s.some((x) => x.temperament === 'predator' && walker(x));

  it('charges whoever enters its 200 m territory, its pack with it, and lets them go when they leave', () => {
    const w = faunaWorld({ tier: 3, want });
    const sp = find(w, (x) => x.temperament === 'apex');
    const lair = w.at(150, 0);
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: lair, count: 1 });
    expect(creatures.length).toBeGreaterThanOrEqual(3); // the apex and a pack of 2–4
    const [apex, ...pack] = creatures as [number, ...number[]];
    expect(one(w, apex).species.temperament).toBe('apex');
    for (const id of pack) expect(one(w, id).species.temperament).toBe('predator');
    const seen = new Map<number, Set<string>>(creatures.map((id) => [id, new Set()]));
    w.run(30, () => {
      for (const c of of(w, creatures)) seen.get(c.id)!.add(c.state);
    });
    expect(seen.get(apex)!.has('charge')).toBe(true);
    expect(seen.get(apex)!.has('attack')).toBe(true);
    expect(one(w, apex).target).toBe(w.player);
    expect(pack.some((id) => seen.get(id)!.has('attack'))).toBe(true);
    // out of its territory: the apex goes home and its pack follows it
    w.movePlayer(w.at(150 - RULES.apexTerritoryM * 1.3, 0));
    w.run(60);
    expect(one(w, apex).target).toBeNull();
    expect(dist(one(w, apex).pos, lair)).toBeLessThan(AI.wanderLeashM + 20);
    for (const id of pack) {
      expect(['follow', 'idle']).toContain(one(w, id).state);
      expect(dist(one(w, id).pos, one(w, apex).pos)).toBeLessThan(30);
    }
  });

  it('ignores a player outside its territory', () => {
    const w = faunaWorld({ tier: 3, want });
    const sp = find(w, (x) => x.temperament === 'apex');
    const { creatures } = w.spawn({ body: w.body.index, species: sp.index, at: w.at(RULES.apexTerritoryM + 60, 0), count: 1 });
    w.run(10, () => expect(one(w, creatures[0]!).target).toBeNull());
  });
});

describe('hurt', () => {
  it('turns a territorial beast on whoever hurt it, and makes grazers bolt', () => {
    const w = faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'territorial') && s.some((x) => x.tier === 0 && walker(x)) });
    const beast = w.spawn({ body: w.body.index, species: find(w, (x) => x.temperament === 'territorial').index, at: w.at(45, 0), count: 1 });
    const grazer = w.spawn({ body: w.body.index, species: find(w, (x) => x.tier === 0 && walker(x)).index, at: w.at(-45, 0), count: 1 });
    w.run(1);
    expect(w.zone.fauna!.hurt(beast.creatures[0]!, w.player, 20)).toBe(true);
    expect(w.zone.fauna!.hurt(grazer.creatures[0]!, w.player, 20)).toBe(true);
    w.run(0.2);
    expect(one(w, beast.creatures[0]!).state).toBe('charge');
    expect(one(w, beast.creatures[0]!).target).toBe(w.player);
    expect(one(w, grazer.creatures[0]!).state).toBe('flee');
    expect(w.zone.fauna!.hurt(999_999, w.player, 1)).toBe(false);
  });
});
