// What abilities do to how creatures act (Resonance, P1.E07.T06): Pulse's stun, Harmonic's calm and Veil's concealment, through
// a zone's fauna sim on a real world, the herds the AI tests use.
import { describe, expect, it } from 'vitest';
import type { FaunaSpecies } from '@astra/shared/world';
import { dist, faunaWorld, type FaunaWorld } from '../../test/faunaWorld.ts';
import { RULES } from './ai.ts';
import type { CreatureInfo } from './sim.ts';

const walker = (s: FaunaSpecies) => s.kind !== 'flyer';
const find = (w: FaunaWorld, t: (s: FaunaSpecies) => boolean) => w.species.find(t)!;
const of = (w: FaunaWorld, ids: readonly number[]): CreatureInfo[] => w.zone.fauna!.creatures().filter((c) => ids.includes(c.id));
const one = (w: FaunaWorld, id: number): CreatureInfo => of(w, [id])[0]!;
const territorial = () => faunaWorld({ tier: 3, want: (s) => s.some((x) => x.temperament === 'territorial') });
/** A territorial herd 14 m from the player, which charges 5 s after it is noticed. */
function herd(w: FaunaWorld, count = 2): number[] {
  const sp = find(w, (x) => x.temperament === 'territorial');
  return w.spawn({ body: w.body.index, species: sp.index, at: w.at(RULES.territorialM - 6, 0), count }).creatures;
}
const states = (w: FaunaWorld, ids: number[], seconds: number): Set<string> => {
  const seen = new Set<string>();
  w.run(seconds, () => of(w, ids).forEach((c) => seen.add(c.state)));
  return seen;
};

describe('stun', () => {
  it('holds a creature still, strikes nothing and ends a charge in progress, for as long as it lasts', () => {
    const w = territorial();
    const ids = herd(w);
    w.run(RULES.territorialS + 0.6);
    expect(of(w, ids).map((c) => c.state)).toContain('charge');
    for (const id of ids) expect(w.zone.fauna!.stun(id, 2)).toBe(true);
    w.run(0.1);
    const held = of(w, ids).map((c) => c.pos);
    const seen = states(w, ids, 1.5);
    expect([...seen]).toEqual(['idle']);
    of(w, ids).forEach((c, i) => {
      expect(dist(c.pos, held[i]!)).toBeLessThan(0.01);
      expect(c.attack).toBeNull();
    });
  });

  it('lets the creature carry on afterwards, and a longer stun is never cut short by a shorter', () => {
    const w = territorial();
    const ids = herd(w, 1);
    w.run(RULES.territorialS + 0.6);
    const sim = w.zone.fauna!;
    sim.stun(ids[0]!, 3);
    sim.stun(ids[0]!, 1);
    expect(one(w, ids[0]!).stunUntil).toBeCloseTo(w.time + 3, 1);
    w.run(2);
    expect(one(w, ids[0]!).state).toBe('idle');
    const after = states(w, ids, 3);
    expect(after.has('charge') || after.has('attack')).toBe(true);
  });

  it('is refused for what is not a living creature', () => {
    const w = territorial();
    expect(w.zone.fauna!.stun(w.player, 2)).toBe(false);
    expect(w.zone.fauna!.stun(999_999, 2)).toBe(false);
  });
});

describe('calm', () => {
  it('stops a territorial herd from charging someone who stays within 20 m, until the calm ends', () => {
    const w = territorial();
    const ids = herd(w);
    for (const id of ids) expect(w.zone.fauna!.calm(id, 20)).toBe(true);
    const seen = states(w, ids, 19);
    expect(seen.has('charge') || seen.has('attack')).toBe(false);
    // (it has grazed about its home all the while: the player walks up to it again)
    w.run(2);
    w.movePlayer(w.onGround(one(w, ids[0]!).pos));
    const later = states(w, ids, RULES.territorialS + 1);
    expect(later.has('charge')).toBe(true);
  });

  it('is broken by any damage: the creature turns on whoever hurt it', () => {
    const w = territorial();
    const [id] = herd(w, 1);
    w.zone.fauna!.calm(id!, 20);
    w.run(1);
    expect(one(w, id!).calmUntil).not.toBeNull();
    w.zone.fauna!.hurt(id!, w.player, 3);
    w.run(0.2);
    expect(one(w, id!).calmUntil).toBeNull();
    expect(['charge', 'attack']).toContain(one(w, id!).state);
  });

  it('makes a skittish creature stop fleeing, and not start', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'skittish' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'skittish' && walker(x));
    const r = RULES.fleeBaseM + RULES.fleePerSizeM * sp.size;
    const [id] = w.spawn({ body: w.body.index, species: sp.index, at: w.at(r * 0.5, 0), count: 1 }).creatures;
    w.run(0.3);
    expect(one(w, id!).state).toBe('flee');
    expect(w.zone.fauna!.calm(id!, 8)).toBe(true);
    w.run(0.2);
    expect(one(w, id!).state).not.toBe('flee');
    // (the player is still close, and it neither flees nor is it hunted)
    const seen = states(w, [id!], 6);
    expect(seen.has('flee')).toBe(false);
    w.run(4);
    expect(one(w, id!).calmUntil!).toBeLessThan(w.time);
  });
});

describe('veil', () => {
  it('makes a herd forget a player standing in its midst, who is noticed again once the veil ends', () => {
    const w = territorial();
    const ids = herd(w);
    w.zone.fauna!.veil(w.player, 9);
    const seen = states(w, ids, 8.5);
    expect(seen.has('alert') || seen.has('charge') || seen.has('attack')).toBe(false);
    const later = states(w, ids, RULES.territorialS + 3);
    expect(later.has('charge')).toBe(true);
  });

  it('drops the threat of a creature already after the player', () => {
    const w = territorial();
    const ids = herd(w, 1);
    w.run(RULES.territorialS + 0.6);
    expect(one(w, ids[0]!).target).toBe(w.player);
    w.zone.fauna!.veil(w.player, 5);
    w.run(0.2);
    expect(one(w, ids[0]!).target).toBeNull();
  });
});

// Gravitic (P1.E07.T04): Pull's carry, Slam's knockdown and Well's slow.
describe('pull', () => {
  it('carries a creature to the ground under a point over the time given, doing nothing meanwhile, and lets it go on', () => {
    const w = territorial();
    const ids = herd(w, 1);
    w.run(RULES.territorialS + 0.6);
    expect(of(w, ids).map((c) => c.state)).toContain('charge');
    const to = w.at(-30, 0);
    expect(w.zone.fauna!.pull(ids[0]!, to, 0.5)).toBe(true);
    expect(one(w, ids[0]!)).toMatchObject({ pulled: true, attack: null });
    const from = one(w, ids[0]!).pos;
    w.run(0.25);
    const mid = one(w, ids[0]!).pos;
    expect(dist(mid, from)).toBeGreaterThan(5);
    expect(dist(mid, w.onGround(to))).toBeGreaterThan(5);
    w.run(0.3);
    expect(one(w, ids[0]!).pulled).toBe(false);
    expect(dist(one(w, ids[0]!).pos, w.onGround(to))).toBeLessThan(3);
    // (the charge it was making is over: it is on the player again at once)
    w.run(0.5);
    expect(['charge', 'attack', 'idle', 'alert']).toContain(one(w, ids[0]!).state);
  });

  it('brings a flyer down to head height on the way', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.kind === 'flyer') });
    const sp = find(w, (x) => x.kind === 'flyer');
    const [id] = w.spawn({ body: w.body.index, species: sp.index, at: w.at(20, 0), count: 1 }).creatures;
    w.run(0.2);
    const to = w.at(2, 0);
    w.zone.fauna!.pull(id!, to, 0.4);
    w.run(0.5);
    expect(dist(one(w, id!).pos, w.onGround(to))).toBeLessThan(4);
  });

  it('is refused for what is not a living creature', () => {
    const w = territorial();
    expect(w.zone.fauna!.pull(w.player, w.at(5, 0), 0.4)).toBe(false);
    expect(w.zone.fauna!.pull(999_999, w.at(5, 0), 0.4)).toBe(false);
  });
});

describe('knockdown', () => {
  it('lays a creature down where it is, striking nothing, for as long as given, then lets it up', () => {
    const w = territorial();
    const ids = herd(w, 2);
    w.run(RULES.territorialS + 0.6);
    expect(of(w, ids).map((c) => c.state)).toContain('charge');
    for (const id of ids) expect(w.zone.fauna!.knockdown(id, 2)).toBe(true);
    w.run(0.1);
    const held = of(w, ids).map((c) => c.pos);
    const seen = states(w, ids, 1.5);
    expect([...seen]).toEqual(['down']);
    of(w, ids).forEach((c, i) => {
      expect(dist(c.pos, held[i]!)).toBeLessThan(0.01);
      expect(c.attack).toBeNull();
    });
    w.run(1);
    expect(of(w, ids).every((c) => c.state !== 'down')).toBe(true);
  });

  it('is never cut short by a shorter one, and is refused for a flyer', () => {
    const w = territorial();
    const [id] = herd(w, 1);
    w.zone.fauna!.knockdown(id!, 3);
    w.zone.fauna!.knockdown(id!, 1);
    expect(one(w, id!).downUntil).toBeCloseTo(w.time + 3, 1);
    const f = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.kind === 'flyer') });
    const sp = find(f, (x) => x.kind === 'flyer');
    const [bird] = f.spawn({ body: f.body.index, species: sp.index, at: f.at(10, 0), count: 1 }).creatures;
    expect(f.zone.fauna!.knockdown(bird!, 2)).toBe(false);
  });
});

describe('slow field', () => {
  it('has a creature keep the share of its speed given while it is in the bubble, and not outside it or after it ends', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'docile' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'docile' && walker(x));
    const ids = [4, 20].flatMap((east) => w.spawn({ body: w.body.index, species: sp.index, at: w.at(east, 0), count: 1 }).creatures);
    w.run(0.1);
    w.zone.fauna!.slowField(w.frame, w.onGround(w.at(0, 0)), 12, 0.4, 3);
    w.run(0.1);
    expect(of(w, ids).map((c) => c.slow)).toEqual([0.4, 1]);
    w.run(3);
    expect(of(w, ids).map((c) => c.slow)).toEqual([1, 1]);
  });

  it('takes the slowest where bubbles overlap, and skips the creatures it does not affect', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'docile' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'docile' && walker(x));
    const ids = w.spawn({ body: w.body.index, species: sp.index, at: w.at(4, 0), count: 2 }).creatures;
    w.run(0.1);
    const sim = w.zone.fauna!;
    sim.slowField(w.frame, w.onGround(w.at(0, 0)), 12, 0.7, 5);
    sim.slowField(w.frame, w.onGround(w.at(0, 0)), 12, 0.4, 5, (id) => id === ids[0]);
    sim.slowField('another-frame', w.onGround(w.at(0, 0)), 12, 0.1, 5);
    w.run(0.1);
    expect(of(w, ids).map((c) => c.slow)).toEqual([0.4, 0.7]);
  });

  it('shows in the creature’s velocity: it moves as slowly as it is slowed', () => {
    const w = faunaWorld({ tier: 0, want: (s) => s.some((x) => x.temperament === 'docile' && walker(x)) });
    const sp = find(w, (x) => x.temperament === 'docile' && walker(x));
    const [id] = w.spawn({ body: w.body.index, species: sp.index, at: w.at(4, 0), count: 1 }).creatures;
    w.zone.fauna!.hurt(id!, w.player, 1);
    w.run(1.5);
    const speed = () => Math.hypot(...(w.zone.entity(id!)!.fields.vel as [number, number, number]));
    const free = speed();
    expect(free).toBeGreaterThan(1);
    w.zone.fauna!.slowField(w.frame, w.onGround(w.zone.fauna!.creatures().find((c) => c.id === id)!.pos), 12, 0.4, 5);
    w.run(0.1);
    expect(speed()).toBeCloseTo(free * 0.4, 1);
  });
});
