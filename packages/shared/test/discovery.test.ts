// First finders (P2.E29.T01): the moderation filter over its data-driven lists, the finds' keys, and codex plates.
import { describe, expect, it } from 'vitest';
import { DISCOVERY_NAME_RULES, FACTIONS, NAME_BLOCKED_FRAGMENTS, NAME_BLOCKED_WORDS, NAME_RESERVED, NAME_RESERVED_WORDS, PEOPLES } from '../src/data/index.ts';
import {
  addPlate,
  checkDiscoveryName,
  discoveryKeyOk,
  displayName,
  emptyPlates,
  hasPlate,
  nameSkeleton,
  parseSiteKey,
  PLATES_MAX,
  platesSchema,
  siteKey,
  systemSeedOfKey,
  tidyName,
  worldOfKey,
} from '../src/discovery/index.ts';

const reason = (raw: string, opts?: { reserved?: boolean }) => {
  const r = checkDiscoveryName(raw, opts);
  return r.ok ? null : r.reason;
};

describe('the moderation filter', () => {
  it('takes ordinary names, tidied', () => {
    for (const name of [
      'Halcyon',
      "Vel'ka's Rest",
      'New Hope 2',
      'Kepler-22',
      'Ébène',
      'Ålborg Rise',
      'Big Sky',
      'Scunthorpe',
      'Cockatoo',
      'Assam',
      'Grapevine',
      'Saltwater',
      'Essex',
      'Count Ilya',
    ]) {
      expect(checkDiscoveryName(name), name).toEqual({ ok: true, name });
    }
    expect(checkDiscoveryName('  Big    Sky ')).toEqual({ ok: true, name: 'Big Sky' });
    expect(tidyName('Ébène')).toBe('Ébène');
  });

  it('refuses a name too short or too long', () => {
    expect(reason('Al')).toBe('length');
    expect(reason('   Al   ')).toBe('length');
    expect(reason('x'.repeat(DISCOVERY_NAME_RULES.maxLength))).toBeNull();
    expect(reason('x'.repeat(DISCOVERY_NAME_RULES.maxLength + 1))).toBe('length');
  });

  it('refuses characters a name may not hold, and names of too few letters', () => {
    for (const name of [
      'Hal_cyon',
      'Hal!',
      'Hal  -cyon',
      '-Halcyon',
      "Halcyon'",
      'Hal--cyon',
      '12345',
      'A 1 2',
      'Ηalcyon',
      'Hаlcyon',
      'Hal😀cyon',
      'Hal‮cyon',
      '<b>Hi</b>',
    ]) {
      expect(reason(name), name).toBe('characters');
    }
  });

  it('refuses blocked words however they are dressed up, and not words that merely hold them', () => {
    for (const name of [
      'Fuck',
      'Fuckton',
      'F u c k',
      'Fuuuck Rock',
      'Fück',
      'Sh1t',
      'Big Shit',
      'Shiiit',
      'Ass',
      'A55 Rock',
      'Dick Rock',
      'Cum',
      'Nazi Moon',
      'N4zi',
      'S E X',
    ]) {
      expect(reason(name), name).toBe('blocked');
    }
    expect(reason('Dickens')).toBeNull();
    expect(reason('Passage Rock')).toBeNull();
  });

  it('refuses names that pass for the game’s own, unless a moderator gives them', () => {
    for (const name of [
      'Admin',
      'Admin Rock',
      'Dev Moon',
      'Official Spire',
      'GM Base',
      'Sarelun',
      'Thalune',
      'Waystation Compact',
      'The Count',
      'TheCount',
      'Th3 C0unt',
      'Free Reaches',
    ]) {
      expect(reason(name), name).toBe('reserved');
    }
    expect(reason('Sarelun', { reserved: false })).toBeNull();
    // (blocked words stay blocked, whoever names it)
    expect(reason('Fuck', { reserved: false })).toBe('blocked');
    expect(reason("Sarelun's Echo")).toBeNull();
  });

  it('reads its lists from the data tables, every entry one the filter can match', () => {
    for (const w of [...NAME_BLOCKED_FRAGMENTS, ...NAME_BLOCKED_WORDS, ...NAME_RESERVED_WORDS]) expect(nameSkeleton(w), w).toBe(w);
    for (const p of PEOPLES) expect(NAME_RESERVED).toContain(p.name);
    for (const f of FACTIONS) expect(reason(f.name), f.name).toBe('reserved');
    for (const w of NAME_BLOCKED_WORDS) expect(reason(`${w} Rock`), w).toBe('blocked');
    for (const f of NAME_BLOCKED_FRAGMENTS) expect(reason(`Big${f}`), f).toBe('blocked');
  });
});

describe('finds’ keys', () => {
  it('names a species, a body and a site, each by its world and system', () => {
    expect(discoveryKeyOk('species', '424242:3/4')).toBe(true);
    expect(discoveryKeyOk('body', '424242:3')).toBe(true);
    expect(discoveryKeyOk('site', siteKey('424242:3', 17))).toBe(true);
    expect(discoveryKeyOk('body', '424242:station')).toBe(false);
    expect(discoveryKeyOk('site', '424242:3/4')).toBe(false);
    expect(parseSiteKey('424242:3#17')).toEqual({ world: '424242:3', index: 17 });
    expect(parseSiteKey('424242:3')).toBeNull();
    expect(worldOfKey('species', '424242:3/4')).toBe('424242:3');
    expect(worldOfKey('site', '424242:3#17')).toBe('424242:3');
    expect(worldOfKey('body', '424242:3')).toBe('424242:3');
    for (const k of ['424242:3/4', '424242:3', '424242:3#17']) expect(systemSeedOfKey(k)).toBe(424242);
  });

  it('shows the finder’s name, or the procedural one', () => {
    expect(displayName({ name: 'Halcyon' }, 'Vexmir III')).toBe('Halcyon');
    expect(displayName({}, 'Vexmir III')).toBe('Vexmir III');
    expect(displayName(undefined, 'Vexmir III')).toBe('Vexmir III');
  });
});

describe('codex plates', () => {
  it('holds one plate a find, up to its bound', () => {
    const p = emptyPlates();
    expect(addPlate(p, { kind: 'body', key: '1:2', at: 5 })).toBe('added');
    expect(addPlate(p, { kind: 'body', key: '1:2', at: 9 })).toBe('known');
    expect(addPlate(p, { kind: 'site', key: '1:2#0', at: 9 })).toBe('added');
    expect(hasPlate(p, 'body', '1:2')).toBe(true);
    expect(hasPlate(p, 'species', '1:2/0')).toBe(false);
    expect(platesSchema.safeParse(p).success).toBe(true);
    expect(platesSchema.safeParse({ plates: [p.plates[0], p.plates[0]] }).success).toBe(false);
    const full = { plates: Array.from({ length: PLATES_MAX }, (_, i) => ({ kind: 'site' as const, key: `1:2#${i}`, at: 0 })) };
    expect(platesSchema.safeParse(full).success).toBe(true);
    expect(addPlate(full, { kind: 'body', key: '1:2', at: 0 })).toBe('full');
  });
});
