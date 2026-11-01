// Season awards in play and their persistence component (P2.E22.T03): one award a season, in season order, given only to
// a character in play, its subscribers told; stored as the `seasonAwards` entry, and an unreadable one refuses the join.
import { seasonAward, type SeasonAward } from '@astra/shared/seasons';
import { describe, expect, it } from 'vitest';
import { ComponentRegistry, CharacterLoadError, type StoredCharacter } from '../persistence/registry.ts';
import { SeasonAwards } from './awards.ts';
import { SEASON_AWARDS, seasonAwardsComponent, seasonAwardsIn } from './component.ts';

const CHARACTER = { id: 'c1', name: 'Tess Arlo', people: 'ixari', homeSystem: 0 };

function stored(state: StoredCharacter['state']): StoredCharacter {
  return { revision: 1, columns: { level: 1, xp: 0, homeSystem: 0 }, state };
}

describe('season awards in play', () => {
  it('gives a character in play the awards it lacks, one a season, in season order, and tells the subscribers', () => {
    const awards = new SeasonAwards();
    const heard: [string, readonly SeasonAward[], readonly SeasonAward[]][] = [];
    const unsubscribe = awards.subscribe((id, added, all) => heard.push([id, [...added], [...all]]));
    expect(awards.grant('c1', [seasonAward(1, 'fed')])).toBeNull();
    awards.open('c1', { awards: [seasonAward(2, 'held')] });
    expect(awards.grant('c1', [seasonAward(3, 'broken'), seasonAward(1, 'fed'), seasonAward(2, 'fed')])).toEqual([
      seasonAward(3, 'broken'),
      seasonAward(1, 'fed'),
    ]);
    expect(awards.get('c1')).toEqual([seasonAward(1, 'fed'), seasonAward(2, 'held'), seasonAward(3, 'broken')]);
    expect(heard).toEqual([['c1', [seasonAward(3, 'broken'), seasonAward(1, 'fed')], awards.get('c1')]]);
    // nothing new: nothing told
    expect(awards.grant('c1', [seasonAward(3, 'broken')])).toEqual([]);
    expect(heard).toHaveLength(1);
    unsubscribe();
    awards.grant('c1', [seasonAward(4, 'fed')]);
    expect(heard).toHaveLength(1);
    expect(awards.close('c1')).toBe(true);
    expect(awards.get('c1')).toBeUndefined();
  });

  it('keeps telling the other subscribers when one throws, and reports it', () => {
    const errors: unknown[] = [];
    const awards = new SeasonAwards((err) => errors.push(err));
    const heard: string[] = [];
    awards.subscribe(() => {
      throw new Error('boom');
    });
    awards.subscribe((id) => heard.push(id));
    awards.open('c1');
    awards.grant('c1', [seasonAward(1, 'held')]);
    expect(heard).toEqual(['c1']);
    expect(errors).toHaveLength(1);
  });
});

describe('the seasonAwards component', () => {
  const setup = () => {
    const awards = new SeasonAwards();
    const registry = new ComponentRegistry().register(seasonAwardsComponent(awards));
    return { awards, registry, component: registry.get(SEASON_AWARDS)! };
  };

  it('gives a character with none stored no awards, and loads and saves what it holds', () => {
    const { awards, registry, component } = setup();
    expect(seasonAwardsIn(registry)).toBe(awards);
    expect(registry.decode(stored({}), CHARACTER).values.get(SEASON_AWARDS)).toEqual({ awards: [] });
    const value = { awards: [seasonAward(1, 'fed'), seasonAward(3, 'broken')] };
    const d = registry.decode(stored({ [SEASON_AWARDS]: { v: 1, data: value } }), CHARACTER);
    expect(d.asStored.has(SEASON_AWARDS)).toBe(true);
    component.load!(d.values.get(SEASON_AWARDS), registry.context(d, CHARACTER, SEASON_AWARDS));
    expect(awards.get('c1')).toEqual(value.awards);
    awards.grant('c1', [seasonAward(4, 'held')]);
    expect(component.save({ characterId: 'c1', viewer: null })).toEqual({ awards: [...value.awards, seasonAward(4, 'held')] });
    component.unload!('c1');
    expect(component.save({ characterId: 'c1', viewer: null })).toBeUndefined();
  });

  it('refuses the join rather than replace awards it cannot read', () => {
    const { registry } = setup();
    for (const data of [
      { awards: [seasonAward(3, 'fed'), seasonAward(1, 'fed')] },
      { awards: [{ ...seasonAward(1, 'fed'), bucket: 'lost' }] },
      { awards: [], worn: 'Seedbearer' },
    ]) {
      expect(() => registry.decode(stored({ [SEASON_AWARDS]: { v: 1, data } }), CHARACTER), JSON.stringify(data)).toThrow(CharacterLoadError);
    }
    expect(() => registry.decode(stored({ [SEASON_AWARDS]: { v: 2, data: { awards: [] } } }), CHARACTER)).toThrow(CharacterLoadError);
  });
});
