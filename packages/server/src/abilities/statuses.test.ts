// Statuses on entities (ARCHITECTURE §28): kept per caster, ended on the world clock, shared by none.
import { describe, expect, it } from 'vitest';
import { GRACE_S, Statuses } from './statuses.ts';

describe('statuses', () => {
  const setup = () => {
    let now = 100;
    const s = new Statuses(() => now);
    return { s, at: (t: number) => void (now = t) };
  };

  it('puts a status on a target for a time, fresh once, and refreshes it to the later end at the greater power', () => {
    const { s, at } = setup();
    expect(s.apply('z', 'a', 7, 'burning', 4, 6)).toBe(true);
    expect(s.get('z', 'a', 7, 'burning')).toEqual({ until: 104, power: 6 });
    at(102);
    expect(s.apply('z', 'a', 7, 'burning', 8, 5)).toBe(false);
    expect(s.get('z', 'a', 7, 'burning')).toEqual({ until: 110, power: 6 });
    expect(s.apply('z', 'a', 7, 'burning', 1, 9)).toBe(false);
    expect(s.get('z', 'a', 7, 'burning')).toEqual({ until: 110, power: 9 });
  });

  it('keeps each caster’s own and asks whether anyone’s runs', () => {
    const { s, at } = setup();
    s.apply('z', 'a', 7, 'burning', 4, 6);
    expect(s.apply('z', 'b', 7, 'burning', 2, 3)).toBe(true);
    expect(s.get('z', 'b', 7, 'burning')).toEqual({ until: 102, power: 3 });
    expect(s.get('z', 'c', 7, 'burning')).toBeNull();
    at(103);
    expect(s.active('z', 7, 'burning')).toBe(true);
    s.remove('z', 'a', 7, 'burning');
    expect(s.active('z', 7, 'burning')).toBe(false);
    expect(s.active('z', 8, 'burning')).toBe(false);
    expect(s.active('y', 7, 'burning')).toBe(false);
  });

  it('is over for `active` at its end, still answers to its effect for a grace after, and then is gone and fresh again', () => {
    const { s, at } = setup();
    s.apply('z', 'a', 7, 'burning', 4, 6);
    at(104);
    expect(s.active('z', 7, 'burning')).toBe(false);
    expect(s.get('z', 'a', 7, 'burning')).not.toBeNull();
    expect(s.apply('z', 'a', 7, 'burning', 4, 2)).toBe(false);
    expect(s.get('z', 'a', 7, 'burning')).toEqual({ until: 108, power: 2 });
    at(108 + GRACE_S);
    expect(s.get('z', 'a', 7, 'burning')).toBeNull();
    expect(s.apply('z', 'a', 7, 'burning', 1, 1)).toBe(true);
  });

  it('forgets what ended', () => {
    const { s, at } = setup();
    for (let i = 0; i < 50; i++) s.apply('z', 'a', i, 'burning', 1);
    expect(s.size).toBe(50);
    at(110);
    s.apply('z', 'a', 99, 'burning', 1);
    expect(s.size).toBe(1);
  });
});
