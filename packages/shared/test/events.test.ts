// World events as data and their pure rules (P2.E21.T01, DESIGN 14.6, 16.6): the catalog, presence scaling 1–12, the
// schedule's windows, contribution shares and the reward pool.
import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../src/data/index.ts';
import { itemInfo } from '../src/inventory/index.ts';
import {
  contributionShares,
  ELIGIBLE_FRACTION,
  EVENT_PLAYERS_MAX,
  eventApplies,
  eventDefSchema,
  EVENTS,
  eventScaling,
  eventWindow,
  getEvent,
  rewardPool,
  scalingLevel,
  windowOffset,
  type Contribution,
  type EventDef,
} from '../src/events/index.ts';
import { BeaconView } from '../src/protocol/index.ts';

const tide = getEvent('hollow_tide')!;
const c = (damage: number, presence = 0, objective = 0): Contribution => ({ damage, objective, presence });

describe('events: the catalog', () => {
  it('holds valid definitions with unique ids, known items and factions, and names the beacon listing can show', () => {
    expect(EVENTS.length).toBeGreaterThan(0);
    expect(new Set(EVENTS.map((d) => d.id)).size).toBe(EVENTS.length);
    for (const d of EVENTS) {
      expect(eventDefSchema.parse(d)).toEqual(d);
      for (const { item } of d.rewards.items) expect(itemInfo(item), item).not.toBeNull();
      for (const { faction } of d.rewards.rep)
        expect(
          FACTIONS.map((f) => f.id),
          faction,
        ).toContain(faction);
      // an event phase's key is its name, which the call-for-aid listing shows as the place (ARCHITECTURE §21)
      const listed = {
        id: 1,
        kind: 'event',
        system: 0,
        frame: null,
        center: [0, 0, 0],
        radius: 1,
        place: d.name,
        from: 'Ana',
        open: 1,
        cap: 12,
        at: 0,
        until: 1,
      };
      expect(BeaconView.safeParse(listed).success, d.name).toBe(true);
    }
  });

  it('has the Hollow tide as DESIGN 14.6 and 16.3 time it: hourly at Tier 5, twenty minutes long', () => {
    expect(tide).toMatchObject({ name: 'Hollow tide', tiers: [5, 5], schedule: { everyS: 3600, durationS: 1200 } });
    expect(eventApplies(tide, 5)).toBe(true);
    expect(eventApplies(tide, 4)).toBe(false);
    expect(getEvent('nothing')).toBeUndefined();
  });

  it('refuses a definition whose waves cannot fit its window, or that pays presence alone', () => {
    const bad = (patch: Partial<EventDef>) => eventDefSchema.safeParse({ ...tide, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ waves: { ...tide.waves, count: 20, gapS: 600 } })).toBe(false);
    expect(bad({ contribution: { damage: 0, objective: 0, presence: 1 } })).toBe(false);
    expect(bad({ schedule: { ...tide.schedule, durationS: 3600 } })).toBe(false);
    expect(bad({ name: 'Tide <b>' })).toBe(false);
    expect(bad({ tiers: [4, 2] })).toBe(false);
  });
});

describe('events: presence scaling', () => {
  it('runs from level 1 to 12 with the players an instance holds, never past them', () => {
    expect(EVENT_PLAYERS_MAX).toBe(12);
    expect([0, 1, 2, 7, 12, 13, 40].map(scalingLevel)).toEqual([1, 1, 2, 7, 12, 12, 12]);
  });

  it('grows each wave and its enemies’ health with every player, so an instance of 3 and one of 12 differ', () => {
    const one = eventScaling(tide, 1);
    const three = eventScaling(tide, 3);
    const twelve = eventScaling(tide, 12);
    expect(one).toEqual({ level: 1, waveSize: 3, health: 1 });
    expect(three).toEqual({ level: 3, waveSize: 6, health: 1.2 });
    expect(twelve.level).toBe(12);
    expect(twelve.waveSize).toBe(20);
    expect(twelve.health).toBeCloseTo(2.1, 12);
    // above 12 nothing grows: a 13th opens another instance instead
    expect(eventScaling(tide, 15)).toEqual(twelve);
    // every level is harder than the one below it
    for (let n = 2; n <= 12; n++) {
      const [a, b] = [eventScaling(tide, n - 1), eventScaling(tide, n)];
      expect(b.waveSize * b.health).toBeGreaterThan(a.waveSize * a.health);
    }
  });
});

describe('events: windows on the world clock', () => {
  const def = { id: 'drill', schedule: { everyS: 3600, durationS: 600, announceS: 60, stagger: false } };

  it('finds the window running, else the next, as whole multiples of the period', () => {
    expect(eventWindow(def, 4, 0)).toEqual({ k: 0, announce: -60, starts: 0, ends: 600 });
    expect(eventWindow(def, 4, 599.9)).toEqual({ k: 0, announce: -60, starts: 0, ends: 600 });
    expect(eventWindow(def, 4, 600)).toEqual({ k: 1, announce: 3540, starts: 3600, ends: 4200 });
    expect(eventWindow(def, 4, 3599)).toMatchObject({ k: 1, starts: 3600 });
    expect(eventWindow(def, 4, 7.2e6 + 100)).toMatchObject({ k: 2000, starts: 7.2e6, ends: 7.2e6 + 600 });
  });

  it('staggers systems by a fixed share of the period, so not every system runs an event at once', () => {
    const staggered = { ...def, schedule: { ...def.schedule, stagger: true } };
    const offsets = Array.from({ length: 64 }, (_, s) => windowOffset(staggered, s));
    for (const o of offsets) expect(o >= 0 && o < 3600 && Number.isInteger(o)).toBe(true);
    expect(new Set(offsets).size).toBeGreaterThan(48);
    // the same for every server and every call
    expect(windowOffset(staggered, 17)).toBe(offsets[17]);
    const w = eventWindow(staggered, 17, 1e7);
    expect((w.starts - offsets[17]!) % 3600).toBe(0);
    expect(w.ends - w.starts).toBe(600);
    expect(1e7 < w.ends).toBe(true);
  });
});

describe('events: contribution', () => {
  const weights = tide.contribution;

  it('shares by damage, not by who landed the killing blow, and presence moves only what fighters earn', () => {
    // a dealt 70% of the damage; b 30% and every last hit (which no share counts)
    const s = contributionShares(weights, [
      ['a', c(700, 100)],
      ['b', c(300, 100)],
    ]);
    expect(s.get('a')! + s.get('b')!).toBeCloseTo(1, 12);
    expect(s.get('a')!).toBeCloseTo((0.6 * 0.7 + 0.15 * 0.5) / 0.75, 12);
    expect(s.get('a')!).toBeGreaterThan(s.get('b')!);
  });

  it('pays nothing for presence alone, nor below a quarter of an even share, and keeps such players out of the pool', () => {
    const s = contributionShares(weights, [
      ['main', c(1000, 600)],
      ['idle1', c(0, 600)],
      ['idle2', c(0, 600)],
      ['token', c(5, 600)],
    ]);
    expect([...s.keys()]).toEqual(['main']);
    expect(s.get('main')).toBe(1);
    // two fighters: one under a quarter of an even share (1/2 × 1/4 of the total) is out
    const t = contributionShares(weights, [
      ['a', c(900)],
      ['b', c(100)],
    ]);
    expect([...t.keys()]).toEqual(['a']);
    const u = contributionShares(weights, [
      ['a', c(870)],
      ['b', c(130)],
    ]);
    expect([...u.keys()]).toEqual(['a', 'b']);
    expect(ELIGIBLE_FRACTION).toBe(0.25);
    expect(contributionShares(weights, [['x', c(0, 900)]]).size).toBe(0);
    expect(contributionShares(weights, []).size).toBe(0);
  });

  it('counts objective actions as active contribution, weighed beside damage', () => {
    const s = contributionShares(weights, [
      ['gunner', c(1000, 300)],
      ['runner', c(0, 300, 10)],
    ]);
    // damage 0.6 all the gunner's, objectives 0.25 all the runner's, presence 0.15 even
    expect(s.get('gunner')!).toBeCloseTo(0.675, 12);
    expect(s.get('runner')!).toBeCloseTo(0.325, 12);
  });

  it('pools the per-player rewards for every player paid, all of it when completed and the waves cleared when expired', () => {
    expect(rewardPool(tide, 1, 'completed', 5)).toEqual({
      xp: 9000,
      units: 1500,
      items: [{ item: 'count_residue', count: 4 }],
      rep: [{ faction: 'chorus', amount: 25 }],
    });
    expect(rewardPool(tide, 3, 'completed', 5).units).toBe(4500);
    expect(rewardPool(tide, 2, 'expired', 2)).toEqual({
      xp: 7200,
      units: 1200,
      items: [{ item: 'count_residue', count: 3 }],
      rep: [{ faction: 'chorus', amount: 20 }],
    });
    expect(rewardPool(tide, 4, 'expired', 0)).toEqual({ xp: 0, units: 0, items: [], rep: [] });
    expect(rewardPool(tide, 0, 'completed', 5).xp).toBe(0);
  });
});
