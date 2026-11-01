// The Edge following the Count in the world service (DESIGN 16.3, P2.E22.T02) against an in-memory shard, the clocks run by
// hand: the published Edge, tier map and dark stations are functions of the Count and the season's opening, a season's roll
// moves them once and a restart finds them where they were; zones read the new tiers.
import {
  BROKEN_BELOW,
  darkAt,
  darkSystems,
  edgeAt,
  SEASON_DAY_S,
  SEASON_EDGE_SHIFT_LY,
  SMALL_SEASON_LENGTH_S,
  type SeasonOpening,
} from '@astra/shared/seasons';
import { EDGE_X, galaxyTiers } from '@astra/shared/world';
import { describe, expect, it } from 'vitest';
import { MemoryShard } from '../../test/memoryShard.ts';
import { DAY_S } from '../count/meter.ts';
import { ZoneManager, type ZoneCharacter } from '../zones/manager.ts';
import { DEFAULT_SHARD_EPOCH_MS } from './clock.ts';
import { WorldService, type WorldChange } from './service.ts';
import { newShardRecord, type ShardRecord } from './shard.ts';

const HOUR_MS = 3_600_000;
const DAY = 300;
/** 06:00 on meter day 300. */
const WALL = DEFAULT_SHARD_EPOCH_MS + (DAY * DAY_S + 6 * 3600) * 1000;
const BASELINE: SeasonOpening = { from: null, edgeShiftLy: 0, dark: [] };

const tiersAt = (edge: number) => galaxyTiers(edge).map((t) => t.tier);

/** A shard in a season (season 2, four weeks) that ends at midnight on day 301, with the Count at `count`; a server on it. */
function shard(count: number, record: Partial<ShardRecord> = {}) {
  const store = new MemoryShard('test', WALL);
  store.record = {
    ...newShardRecord('test', DEFAULT_SHARD_EPOCH_MS, WALL),
    season: 2,
    seasonStart: (DAY + 1) * SEASON_DAY_S - SMALL_SEASON_LENGTH_S,
    seasonLength: SMALL_SEASON_LENGTH_S,
    seasonActives: 3,
    seasonOpening: BASELINE,
    count,
    ...record,
  };
  let mono = 0;
  let wall = WALL;
  return {
    store,
    open: () => {
      mono = 0;
      return WorldService.open({ store, wallNow: () => wall, monoNow: () => mono });
    },
    hours(h: number) {
      mono += h * HOUR_MS;
      wall += h * HOUR_MS;
    },
    downFor(h: number) {
      wall += h * HOUR_MS;
    },
  };
}

/** The changes that moved the Edge. */
const moves = (changes: WorldChange[]) => changes.filter((c) => c.state.edgeX !== c.previous.edgeX);

describe('the Edge following the Count', () => {
  it('publishes the Edge, the tier map and the dark systems as functions of the Count', async () => {
    const s = shard(500);
    const world = await s.open();
    expect(world.state()).toMatchObject({ edgeX: EDGE_X, count: 500, dark: [] });
    expect(world.state().tiers).toEqual(tiersAt(EDGE_X));

    const changes: WorldChange[] = [];
    world.subscribe((c) => changes.push(c));
    for (const count of [0, 150, 300, 700, 850, 1000, 500]) {
      world.update({ count });
      const edge = edgeAt(count, BASELINE);
      expect(world.state().edgeX).toBe(edge);
      expect(world.state().tiers).toEqual(tiersAt(edge));
      expect(world.message()).toMatchObject({ count, edgeX: edge, tiers: tiersAt(edge), dark: darkAt(count, BASELINE) });
    }
    // 0 and 1000 are the farthest the Count alone takes it; the middle of the meter is the baseline
    expect(changes.map((c) => c.state.edgeX)).toEqual([EDGE_X - 10, EDGE_X - 5, EDGE_X, EDGE_X, EDGE_X + 5, EDGE_X + 10, EDGE_X]);
    // 150 → 300 → 700 → 850 lie in a straight line out of the dead zone, so only the ends of it flip tiers
    expect(changes.map((c) => c.flipped.length > 0)).toEqual([true, true, true, false, true, true, true]);
    await world.close();
  });

  it("moves the Edge with the burn and the day's drift of the meter itself", async () => {
    // a Count of 703 burns below 700 and the Edge, receding 1 ly at 703, comes back to the baseline
    const s = shard(703);
    const world = await s.open();
    const changes: WorldChange[] = [];
    world.subscribe((c) => changes.push(c));
    expect(world.state().edgeX).toBe(edgeAt(703, BASELINE));
    expect(world.state().edgeX).toBeGreaterThan(EDGE_X);
    s.hours(15); // three burns (a measure every 4.8 hours)
    world.advance();
    expect(world.state().count).toBe(700);
    expect(world.state().edgeX).toBe(EDGE_X);
    expect(moves(changes)).toHaveLength(1);
    await world.close();
  });

  it("moves the Edge once at a Fed season's roll, applies the opening, and finds it there after a restart", async () => {
    const s = shard(800);
    const world = await s.open();
    const changes: WorldChange[] = [];
    world.subscribe((c) => changes.push(c));
    const before = world.state();
    expect(before.edgeX).toBe(edgeAt(800, BASELINE));

    s.hours(18); // to midnight on day 301
    world.advance();
    s.hours(12); // and on into the next season: nothing more moves it
    world.advance();

    const rolls = changes.filter((c) => c.season);
    expect(rolls).toHaveLength(1);
    expect(moves(changes)).toEqual([rolls[0]]);
    const after = world.state();
    expect(after).toMatchObject({ season: 3, opening: { from: 'fed', edgeShiftLy: SEASON_EDGE_SHIFT_LY, dark: [] } });
    // (the Count is back near 500 in the dead zone, so the Edge stands where the opening puts it)
    expect(after.count).toBeGreaterThan(300);
    expect(after.count).toBeLessThan(700);
    expect(after.edgeX).toBe(EDGE_X + SEASON_EDGE_SHIFT_LY);
    expect(after.tiers).toEqual(tiersAt(EDGE_X + SEASON_EDGE_SHIFT_LY));
    // the roll's own tier flips are the whole difference between the two tier maps, and a receding Edge only lowers tiers
    const expected = tiersAt(EDGE_X + SEASON_EDGE_SHIFT_LY).flatMap((to, system) =>
      to === before.tiers[system] ? [] : [{ system, from: before.tiers[system]!, to }],
    );
    expect(rolls[0]!.flipped).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.every((f) => f.to < f.from)).toBe(true);
    await world.close();

    // a restart finds the same Edge, tier map and dark stations, and moves nothing
    const again = await s.open();
    const restarted: WorldChange[] = [];
    again.subscribe((c) => restarted.push(c));
    expect(again.state().edgeX).toBe(after.edgeX);
    expect(again.state().tiers).toEqual(after.tiers);
    expect(again.state().dark).toEqual(after.dark);
    again.advance();
    expect(restarted).toEqual([]);
    await again.close();
  });

  it('flags the systems a Broken season opens dark, advances the Edge, and relights them when the Count climbs to Fed', async () => {
    const s = shard(100, { season: 6 });
    const world = await s.open();
    const changes: WorldChange[] = [];
    world.subscribe((c) => changes.push(c));
    s.hours(18);
    world.advance();

    const dark = darkSystems(7);
    expect(dark.length).toBeGreaterThanOrEqual(2);
    expect(moves(changes).filter((c) => c.season)).toHaveLength(1);
    const state = world.state();
    expect(state).toMatchObject({ season: 7, count: 500, edgeX: EDGE_X - SEASON_EDGE_SHIFT_LY, dark });
    expect(state.tiers).toEqual(tiersAt(EDGE_X - SEASON_EDGE_SHIFT_LY));
    for (let system = 0; system < state.tiers.length; system++) expect(world.isDark(system)).toBe(dark.includes(system));
    for (const system of dark) expect(world.tierOf(system)).toBe(5);
    expect(() => world.isDark(1000)).toThrow(RangeError);
    expect(() => world.isDark(-1)).toThrow(RangeError);

    // the Count climbing to 700 relights them, and falling back darkens them again; the opening's Edge stays
    world.update({ count: 700 });
    expect(world.state().dark).toEqual([]);
    expect(world.isDark(dark[0]!)).toBe(false);
    expect(world.state().edgeX).toBe(EDGE_X - SEASON_EDGE_SHIFT_LY);
    world.update({ count: 699 });
    expect(world.state().dark).toEqual(dark);
    await world.flush();
    await world.close();

    // after a restart (the saved Count is 699) they are still dark and the Edge is where the Count and the opening put it
    const again = await s.open();
    expect(again.state()).toMatchObject({ count: 699, edgeX: edgeAt(699, state.opening), dark });
    expect(again.state().tiers).toEqual(state.tiers);
    await again.close();
  });

  it('darkens the stations the Count itself pushed Edge-ward below Broken, tells the clients, and relights them as the Count climbs', async () => {
    const s = shard(500);
    const world = await s.open();
    const heard: WorldChange[] = [];
    world.subscribe((c) => heard.push(c));
    expect(world.state().dark).toEqual([]);

    world.update({ count: 0 });
    const dark = darkAt(0, BASELINE);
    expect(dark.length).toBeGreaterThanOrEqual(2);
    expect(world.state().dark).toEqual(dark);
    expect(world.message().dark).toEqual(dark);
    // (the same systems the Count flipped to Tier 5: Edge-ward at 10 ly in and not at the baseline)
    const [home, low] = [tiersAt(EDGE_X), world.state().tiers];
    for (const id of dark) {
      expect(home[id]).not.toBe(5);
      expect(world.tierOf(id)).toBe(5);
      expect(world.isDark(id)).toBe(true);
    }
    expect(heard.at(-1)?.flipped.map((f) => f.system)).toEqual(expect.arrayContaining([...dark]));

    // half way back up they are fewer, and above the threshold they are all relit
    world.update({ count: 150 });
    const half = world.state().dark;
    expect(half.length).toBeLessThan(dark.length);
    for (const id of half) expect(dark).toContain(id);
    world.update({ count: BROKEN_BELOW });
    expect(world.state().dark).toEqual([]);
    for (const id of dark) expect(world.isDark(id)).toBe(false);
    expect(world.state().tiers).toEqual(home);

    // and after a restart at Count 0 they are dark again, with nothing saved but the Count
    world.update({ count: 0 });
    await world.flush();
    await world.close();
    const again = await s.open();
    expect(again.state().dark).toEqual(dark);
    expect(again.state().tiers).toEqual(low);
    await again.close();
  });

  it("adds the Count-pushed stations to a Broken season's own, and the roll that ends the season keeps them dark only while the Count is low", async () => {
    const s = shard(100, { season: 6 });
    const world = await s.open();
    s.hours(18);
    world.advance();
    const opened = world.state().dark;
    expect(opened).toEqual(darkSystems(7));
    world.update({ count: 0 });
    const low = world.state().dark;
    expect(low).toEqual(darkAt(0, world.state().opening));
    expect(low.length).toBeGreaterThan(opened.length);
    for (const id of opened) expect(low).toContain(id);
    world.update({ count: 500 });
    expect(world.state().dark).toEqual(opened);
    await world.close();
  });

  it("plays a season's roll that passed while the server was down once, on boot, and keeps the Edge after it", async () => {
    const s = shard(900);
    const first = await s.open();
    expect(first.state().edgeX).toBe(edgeAt(900, BASELINE));
    await first.close();

    s.downFor(30); // back at noon on day 302: the season ended at midnight on day 301
    const second = await s.open();
    expect(second.state()).toMatchObject({ season: 3, opening: { from: 'fed' } });
    expect(second.state().edgeX).toBe(edgeAt(second.state().count, second.state().opening));
    expect(second.state().edgeX).toBe(EDGE_X + SEASON_EDGE_SHIFT_LY);
    expect(second.state().tiers).toEqual(tiersAt(EDGE_X + SEASON_EDGE_SHIFT_LY));
    expect(s.store.chronicles.map((c) => c.season)).toEqual([2]);
    await second.flush();
    await second.close();

    const third = await s.open();
    expect(third.state().edgeX).toBe(second.state().edgeX);
    expect(third.state().tiers).toEqual(second.state().tiers);
    expect(s.store.chronicles.map((c) => c.season)).toEqual([2]);
    await third.close();
  });

  it("makes zones read the new tiers, at a season's roll as at any other change", async () => {
    const s = shard(100, { season: 6 });
    const world = await s.open();
    const zones = new ZoneManager({ clock: world.clock, world });
    const character = (homeSystem: number, name: string): ZoneCharacter => ({ id: `c-${name}`, name, people: 'thalune', level: 4, homeSystem });
    const sink = (id: number) => ({ id, sendBinary() {} });
    // (the Count at 100 already holds the Edge in a little; the Broken opening takes it further, to 10 ly in)
    const before = tiersAt(edgeAt(100, BASELINE));
    const after = tiersAt(EDGE_X - SEASON_EDGE_SHIFT_LY);
    const flips = after.findIndex((t, i) => t !== before[i]);
    expect(flips).toBeGreaterThan(0);
    zones.join(sink(1), character(flips, 'Ves'));
    expect(zones.tier(`sys:${flips}`)).toBe(before[flips]);
    expect(before[flips]).not.toBe(after[flips]);

    s.hours(18);
    world.advance();
    expect(zones.tier(`sys:${flips}`)).toBe(after[flips]);
    expect(zones.tier(`sys:${flips}`)).toBe(5);
    await world.close();
  });
});
