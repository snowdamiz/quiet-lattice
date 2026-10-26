// The pirates' acquisition rule (P1.E12.T06): a raid starts only when a pirate at the spawn distance detects the ship, and
// holds it only while the nearest pirate still does.
import { describe, expect, it } from 'vitest';
import { effectiveSignature, movementSignals, sensorRange, shipStats } from '@astra/shared/ships';
import {
  CONTACT_START,
  RAID_SEARCH_S,
  RAID_SENSOR,
  RAID_SPAWN_M,
  contactLost,
  raidCanStart,
  raidSpawnDistance,
  trackContact,
} from '../src/entities/pirateContact.js';

const stats = (hull) => shipStats({ hull, modules: {}, cargoPods: 0, livery: 0 });
const lark = stats('lark');
/** A ship's signature as pirates read it. */
const sig = (s, context = {}) => effectiveSignature(s, { detector: 'pirate', ...context });
const SPAWNS = [0, 0.25, 0.5, 0.75, 0.999].map(raidSpawnDistance);
/** A step, s: exact in binary, so the search's seconds add up exactly. */
const DT = 0.125;

describe('raid rolls', () => {
  it('spawn distances span the demo’s 1800–2600 m', () => {
    expect(raidSpawnDistance(0)).toBe(RAID_SPAWN_M.min);
    expect(raidSpawnDistance(1)).toBe(RAID_SPAWN_M.max);
    expect(RAID_SPAWN_M).toEqual({ min: 1800, max: 2600 });
  });

  it('a Lark in open space is found at any spawn distance; in a belt it is not, unless it boosts', () => {
    for (const d of SPAWNS) {
      expect(raidCanStart(sig(lark), d), `${d}`).toBe(true);
      expect(raidCanStart(sig(lark, { inCover: true }), d), `${d}`).toBe(false);
      expect(raidCanStart(sig(lark, { inCover: true, boosting: true }), d), `${d}`).toBe(true);
    }
  });

  it('stealthier hulls are found less: a Swift by near spawns only, a Ghost or a Dart never, a Mule always', () => {
    const swift = sig(stats('swift'));
    expect(SPAWNS.map((d) => raidCanStart(swift, d))).toEqual([true, true, false, false, false]);
    for (const hull of ['ghost', 'dart']) for (const d of SPAWNS) expect(raidCanStart(sig(stats(hull)), d), hull).toBe(false);
    for (const d of SPAWNS) expect(raidCanStart(sig(stats('mule'), { inCover: true }), d)).toBe(d <= sensorRange(RAID_SENSOR) * 0.7);
  });

  it('a cloaked or silently running ship never draws a raid', () => {
    for (const stealth of [['cloak'], ['silent_running']]) for (const d of SPAWNS) expect(raidCanStart(sig(lark, { stealth }), d)).toBe(false);
    // Veil alone hides from the Hollow, not from pirates
    expect(raidCanStart(sig(lark, { stealth: ['veil'] }), RAID_SPAWN_M.min)).toBe(true);
  });
});

describe('holding the ship', () => {
  it('a raid starts in contact and keeps it while the nearest pirate is within detection distance', () => {
    let c = CONTACT_START;
    for (let i = 0; i < 100; i++) c = trackContact(c, sig(lark), 3400, DT);
    expect(c).toEqual({ seen: true, lostFor: 0 });
    expect(contactLost(c)).toBe(false);
  });

  it('slipping into a belt beyond the halved distance loses the raid after its search', () => {
    let c = CONTACT_START;
    let t = 0;
    while (!contactLost(c) && t < 60) {
      c = trackContact(c, sig(lark, { inCover: true }), 2000, DT);
      t += DT;
    }
    expect(contactLost(c)).toBe(true);
    expect(t).toBe(RAID_SEARCH_S);
  });

  it('seen again during the search, the search starts over', () => {
    let c = CONTACT_START;
    for (let i = 0; i < 120; i++) c = trackContact(c, sig(lark, { inCover: true }), 2000, DT);
    expect(c).toEqual({ seen: false, lostFor: 15 });
    c = trackContact(c, sig(lark, { inCover: true }), 1500, DT);
    expect(c).toEqual({ seen: true, lostFor: 0 });
    for (let i = 0; i < 120; i++) c = trackContact(c, sig(lark, { inCover: true }), 2000, DT);
    expect(contactLost(c)).toBe(false);
  });

  it('outrunning them: loud while boosting away, lost once it cruises on out of reach', () => {
    // the demo's pirates chase at up to 700 m/s; the Lark boosts away for 5 s (1560 m/s), then cruises at 600 m/s
    let c = CONTACT_START;
    let gap = 1500;
    let seenWhileBoosting = true;
    let t = 0;
    for (; t < 80 && !contactLost(c); t += DT) {
      const boosting = t < 5;
      const v = boosting ? lark.speed.space * lark.boost : lark.speed.space;
      gap += (v - 700) * DT;
      c = trackContact(c, sig(lark, movementSignals(lark, 'space', v)), gap, DT);
      if (boosting) seenWhileBoosting &&= c.seen;
    }
    // doubled while boosting (7 km): never out of sight; cruising, out of the 3.5 km at once and gone after the search
    expect(seenWhileBoosting).toBe(true);
    expect(contactLost(c)).toBe(true);
    expect(t).toBe(5 + RAID_SEARCH_S);
  });

  it('a ship that cloaks mid-raid is lost even alongside', () => {
    let c = CONTACT_START;
    for (let i = 0; i < RAID_SEARCH_S / DT; i++) c = trackContact(c, sig(lark, { stealth: ['cloak'] }), 50, DT);
    expect(contactLost(c)).toBe(true);
  });
});
