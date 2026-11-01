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
