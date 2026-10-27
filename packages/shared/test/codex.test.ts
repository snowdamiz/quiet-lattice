// The codex (P1.E08.T04, DESIGN 14.5): entries made from a species (threat by temperament, Bond's reach by body plan),
// added once and known after, bounded, counted per world for the survey, checked by its schema, and reconciled with the
// species data as it is now.
import { describe, expect, it } from 'vitest';
import { BODY_PLAN_IDS, TEMPERAMENTS } from '../src/data/index.ts';
import {
  addToCodex,
  analyzedEvery,
  analyzedOn,
  bondEligibility,
  bondLine,
  canBond,
  CODEX_LIMITS,
  CODEX_TEMPERAMENTS,
  codexEntry,
  codexEntryFor,
  codexLine,
  codexSchema,
  codexSize,
  codexSpecies,
  codexSpeciesSchema,
  emptyCodex,
  parseSpeciesKey,
  reconcileCodex,
  SPECIES_XP,
  speciesKey,
  type Codex,
  type CodexSpeciesSource,
} from '../src/codex/index.ts';
import { describeGalaxySystem, faunaSpecies, FAUNA_MAX_TIER, frameId, Galaxy, GALAXY_SEED, type PlanetParams } from '../src/world/index.ts';

const W = '424242:3';
/** The n-th of many made-up worlds' frame ids. */
const worldN = (n: number) => `${1 + Math.floor(n / 1000)}:${n % 1000}`;

describe('codex entries', () => {
  it('knows every temperament and body plan the data tables do', () => {
    expect([...CODEX_TEMPERAMENTS]).toEqual(TEMPERAMENTS.map((t) => t.id));
  });

  it('rates threat by temperament (DESIGN 12.1) and gives Bond heavy quadrupeds and flyers only with Big Game (9.5)', () => {
    expect(codexEntryFor({ temperament: 'skittish', bodyPlan: 'quad_grazer' }, 12)).toEqual({
      temperament: 'skittish',
      threat: 1,
      bodyPlan: 'quad_grazer',
      bond: 'eligible',
      at: 12,
    });
    expect(codexEntryFor({ temperament: 'apex', bodyPlan: 'quad_heavy' }, 0)).toMatchObject({ threat: 5, bond: 'big_game' });
    expect(codexEntryFor({ temperament: 'predator', bodyPlan: 'flyer' }, 0)).toMatchObject({ threat: 3, bond: 'big_game' });
    expect(codexEntryFor({ temperament: 'territorial', bodyPlan: 'quad_heavy' }, 0)).toMatchObject({ threat: 2, bond: 'big_game' });
    expect(Object.fromEntries(BODY_PLAN_IDS.map((p) => [p, bondEligibility(p)]))).toEqual({
      quad_heavy: 'big_game',
      quad_grazer: 'eligible',
      quad_small: 'eligible',
      biped: 'eligible',
      flyer: 'big_game',
    });
    expect(canBond({ bond: 'eligible' }, [])).toBe(true);
    expect(canBond({ bond: 'big_game' }, ['bond'])).toBe(false);
    expect(canBond({ bond: 'big_game' }, ['bond', 'big_game'])).toBe(true);
    // (a temperament never paired with that body plan has no row to rate it by)
    expect(() => codexEntryFor({ temperament: 'apex', bodyPlan: 'flyer' }, 0)).toThrow();
  });

  it('gives every species of every world in the galaxy an entry, within the bounds', () => {
    const galaxy = new Galaxy(GALAXY_SEED);
    let species = 0;
    let worlds = 0;
    for (const info of galaxy.systems) {
      const d = describeGalaxySystem(info);
      for (const b of d.bodies) {
        if (b.type === 'gas') continue;
        const list = faunaSpecies(b.params as PlanetParams, FAUNA_MAX_TIER);
        if (!list.length) continue;
        worlds++;
        species += list.length;
        expect(list.length).toBeLessThanOrEqual(CODEX_LIMITS.perWorld);
        for (const sp of list)
          expect(codexSpeciesSchema.safeParse(codexSpecies(frameId(d.seed, b.index), sp.index, sp.name, codexEntryFor(sp, 1))).success).toBe(true);
      }
    }
    expect(species).toBeLessThanOrEqual(CODEX_LIMITS.species);
    expect(worlds).toBeLessThanOrEqual(CODEX_LIMITS.worlds);
  });

  it('reads the way the banner shows it', () => {
    const e = codexEntryFor({ temperament: 'predator', bodyPlan: 'biped' }, 0);
    expect(codexLine(e)).toBe('Biped · Predator · ★★★☆☆');
    expect(bondLine(e)).toBe('Bond: eligible');
    expect(bondLine({ bond: 'big_game' })).toBe('Bond: with Big Game');
    expect(bondLine({ bond: 'big_game' }, ['big_game'])).toBe('Bond: eligible');
    expect(SPECIES_XP).toBe(300);
  });
});

describe('codex keys', () => {
  it('names a species by its world and index, and reads the name back', () => {
    expect(speciesKey(W, 7)).toBe('424242:3/7');
    expect(parseSpeciesKey('424242:3/7')).toEqual({ world: W, index: 7 });
    for (const bad of ['424242:station/1', '424242:3/07', '424242:3/', '424242:3', 'x/1', '424242:3/100']) expect(parseSpeciesKey(bad), bad).toBeNull();
  });
});

describe('a codex', () => {
  const grazer = codexEntryFor({ temperament: 'docile', bodyPlan: 'quad_grazer' }, 100);
  /** A world's every species index taken. */
  const fullWorld = () => Object.fromEntries(Array.from({ length: CODEX_LIMITS.perWorld }, (_, i) => [i, grazer]));

  it('adds a species once; after that it is known, and nothing changes', () => {
    const c = emptyCodex();
    expect(addToCodex(c, 3, W, 2, grazer)).toEqual({ result: 'added', entry: grazer });
    const again = addToCodex(c, 3, W, 2, { ...grazer, at: 999 });
    expect(again).toEqual({ result: 'known', entry: grazer });
    expect(c).toEqual({ worlds: { [W]: { system: 3, species: { 2: grazer } } } });
    expect(codexEntry(c, W, 2)).toEqual(grazer);
    expect(codexEntry(c, W, 3)).toBeUndefined();
    expect(codexEntry(c, '1:1', 2)).toBeUndefined();
    expect(codexEntry(c, 'constructor', 2)).toBeUndefined();
  });

  it('counts each world’s species for the survey, and knows when every one is in', () => {
    const c = emptyCodex();
    for (const i of [0, 2]) addToCodex(c, 3, W, i, grazer);
    addToCodex(c, 3, '424242:4', 0, grazer);
    expect(analyzedOn(c, W)).toBe(2);
    expect(analyzedOn(c, '424242:4')).toBe(1);
    expect(analyzedOn(c, '1:1')).toBe(0);
    expect(codexSize(c)).toBe(3);
    expect(analyzedEvery(c, W, 3)).toBe(false);
    addToCodex(c, 3, W, 1, grazer);
    expect(analyzedEvery(c, W, 3)).toBe(true);
    // the tier rose and the world carries a fourth species: not every one any more
    expect(analyzedEvery(c, W, 4)).toBe(false);
    expect(analyzedEvery(c, '1:1', 0)).toBe(false);
  });

  it('records nothing past its bounds', () => {
    const c = emptyCodex();
    expect(addToCodex(c, 3, W, CODEX_LIMITS.perWorld, grazer)).toEqual({ result: 'full' });
    for (let w = 0; w < CODEX_LIMITS.worlds; w++) expect(addToCodex(c, 0, worldN(w), 0, grazer).result).toBe('added');
    expect(addToCodex(c, 3, W, 0, grazer)).toEqual({ result: 'full' });
    // a world it holds still takes species, up to the species bound
    for (let i = 1; codexSize(c) < CODEX_LIMITS.species; i++)
      expect(addToCodex(c, 0, worldN(0 + Math.floor(i / 63)), 1 + (i % 63), grazer).result).toBe('added');
    expect(codexSize(c)).toBe(CODEX_LIMITS.species);
    const last = worldN(CODEX_LIMITS.worlds - 1);
    expect(analyzedOn(c, last)).toBe(1);
    expect(addToCodex(c, 0, last, 1, grazer)).toEqual({ result: 'full' });
    // (what it holds is still known)
    expect(addToCodex(c, 0, last, 0, grazer).result).toBe('known');
    expect(codexSchema.safeParse(c).success).toBe(true);
  });

  it('is checked by its schema: worlds by frame id, indices, entries, bounds', () => {
    const ok: Codex = { worlds: { [W]: { system: 3, species: { 0: grazer, 12: grazer } } } };
    expect(codexSchema.parse(ok)).toEqual(ok);
    for (const bad of [
      { worlds: { '424242:station': { system: 3, species: {} } } },
      { worlds: { '424242:03': { system: 3, species: {} } } },
      { worlds: { [W]: { system: 1024, species: {} } } },
      { worlds: { [W]: { system: 3, species: { '01': grazer } } } },
      { worlds: { [W]: { system: 3, species: { 64: grazer } } } },
      { worlds: { [W]: { system: 3, species: { 0: { ...grazer, threat: 0 } } } } },
      { worlds: { [W]: { system: 3, species: { 0: { ...grazer, bond: 'yes' } } } } },
      { worlds: { [W]: { system: 3, species: { 0: { ...grazer, name: 'x' } } } } },
      { worlds: { [W]: { system: 3, species: {}, count: 1 } } },
      { worlds: {}, xp: 300 },
      { worlds: Object.fromEntries(Array.from({ length: CODEX_LIMITS.worlds + 1 }, (_, i) => [worldN(i), { system: 0, species: {} }])) },
      // more species than the bound (every world, and every world's count, within theirs)
      {
        worlds: Object.fromEntries(
          Array.from({ length: CODEX_LIMITS.species / CODEX_LIMITS.perWorld + 1 }, (_, i) => [worldN(i), { system: 0, species: fullWorld() }]),
        ),
      },
    ]) {
      expect(codexSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 100)).toBe(false);
    }
    // at the bound exactly it is fine
    const atBound = {
      worlds: Object.fromEntries(
        Array.from({ length: CODEX_LIMITS.species / CODEX_LIMITS.perWorld }, (_, i) => [worldN(i), { system: 0, species: fullWorld() }]),
      ),
    };
    expect(codexSize(atBound)).toBe(CODEX_LIMITS.species);
    expect(codexSchema.safeParse(atBound).success).toBe(true);
  });
});

describe('reconciling a codex with the species data', () => {
  const entry = (temperament: 'docile' | 'territorial', bodyPlan: 'quad_grazer' | 'quad_heavy', at: number) => codexEntryFor({ temperament, bodyPlan }, at);
  const stored: Codex = {
    worlds: {
      [W]: { system: 3, species: { 0: entry('docile', 'quad_grazer', 10), 1: entry('territorial', 'quad_grazer', 20), 4: entry('docile', 'quad_grazer', 30) } },
      '424242:5': { system: 3, species: { 0: entry('docile', 'quad_grazer', 40) } },
    },
  };

  it('leaves a codex in line with the data as it is, the very same value', () => {
    const source: CodexSpeciesSource = (_, w) =>
      w === W
        ? [
            { temperament: 'docile', bodyPlan: 'quad_grazer' },
            { temperament: 'territorial', bodyPlan: 'quad_grazer' },
            { temperament: 'docile', bodyPlan: 'quad_grazer' },
            { temperament: 'docile', bodyPlan: 'quad_grazer' },
            { temperament: 'docile', bodyPlan: 'quad_grazer' },
          ]
        : [{ temperament: 'docile', bodyPlan: 'quad_grazer' }];
    const r = reconcileCodex(stored, source);
    expect(r.changes).toEqual([]);
    expect(r.codex).toBe(stored);
  });

  it('drops a world without fauna and species past the list, and updates what changed, keeping when it was analyzed', () => {
    const source: CodexSpeciesSource = (system, w) => {
      if (w !== W) return null;
      expect(system).toBe(3);
      return [
        { temperament: 'docile', bodyPlan: 'quad_grazer' },
        { temperament: 'territorial', bodyPlan: 'quad_heavy' },
      ];
    };
    const r = reconcileCodex(stored, source);
    expect(r.changes).toEqual([
      { change: 'updated', key: '424242:3/1', fields: ['bodyPlan', 'bond'] },
      { change: 'species_gone', key: '424242:3/4' },
      { change: 'world_gone', world: '424242:5', species: 1 },
    ]);
    expect(r.codex).toEqual({ worlds: { [W]: { system: 3, species: { 0: stored.worlds[W]!.species[0], 1: entry('territorial', 'quad_heavy', 20) } } } });
    // (the stored value is left as it was)
    expect(Object.keys(stored.worlds)).toHaveLength(2);
    // a source that throws for a world is a world gone
    expect(
      reconcileCodex(stored, () => {
        throw new Error('no such system');
      }).codex,
    ).toEqual({ worlds: {} });
  });
});
