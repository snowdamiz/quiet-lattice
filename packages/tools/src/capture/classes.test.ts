import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { farRanges, globRegExp, loadClassRules, reviewClass, reviewFamily } from './classes.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const rules = loadClassRules(ROOT);

describe('capture: review classes', () => {
  it('reads globs as fnmatchcase does', () => {
    expect(globRegExp('*landmark*').test('thalune_landmark_spire')).toBe(true);
    expect(globRegExp('anchor_*').test('anchor_stone')).toBe(true);
    expect(globRegExp('anchor_*').test('Anchor_stone')).toBe(false);
    expect(globRegExp('wall?').test('wall2')).toBe(true);
    expect(globRegExp('wall?').test('wall')).toBe(false);
    expect(globRegExp('kit_[ab]*').test('kit_b_door')).toBe(true);
    expect(globRegExp('kit_[!ab]*').test('kit_b_door')).toBe(false);
    expect(globRegExp('a.b').test('axb')).toBe(false);
  });

  it('finds the family of a spec, the demo models through "legacy"', () => {
    expect(reviewFamily(rules, 'ship')).toEqual({ family: 'hulls', legacyClass: null });
    expect(reviewFamily(rules, 'structures')).toEqual({ family: 'sites', legacyClass: null });
    expect(reviewFamily(rules, 'multitool')).toEqual({ family: 'characters', legacyClass: 'viewmodel' });
    expect(reviewFamily(rules, 'cities/thalune_kit').family).toBe('cities');
    expect(reviewFamily(rules, 'nope').family).toBe(null);
  });

  it('gives heroes a second far view at 200 m', () => {
    expect(reviewClass(rules, 'ship', 'Ship')).toBe('hero');
    expect(reviewClass(rules, 'structures', 'outpost_0')).toBe('building');
    expect(reviewClass(rules, 'cities/kit', 'anchor_stone')).toBe('hero');
    expect(reviewClass(rules, 'cities/kit', 'wall_a')).toBe('kit');
    expect(reviewClass(rules, 'multitool', 'Multitool')).toBe('viewmodel');
    expect(reviewClass(rules, 'nope', 'x')).toBe(null);
    expect(farRanges('hero')).toEqual([100, 200]);
    expect(farRanges('building')).toEqual([100]);
    expect(farRanges(null)).toEqual([100]);
  });
});
