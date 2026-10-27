// The codex service (P1.E08.T04): a species recorded the first time earns its XP into the character's progress (a level
// gained refreshes the skill view), a repeat records and earns nothing, a full codex records nothing, and Bond's rule
// reads the codex and Big Game.
import { totalXpFor } from '@astra/shared/combat';
import { CODEX_LIMITS, emptyCodex, SPECIES_XP, type Codex } from '@astra/shared/codex';
import { describe, expect, it } from 'vitest';
import { CharacterProgress } from '../persistence/components.ts';
import type { PersistenceLog } from '../persistence/registry.ts';
import { CodexNotHeldError, CodexService, type AnalyzedSpecies } from './service.ts';

const W = '424242:3';
const grazer: AnalyzedSpecies = { system: 3, world: W, index: 0, temperament: 'skittish', bodyPlan: 'quad_grazer' };
const bull: AnalyzedSpecies = { system: 3, world: W, index: 4, temperament: 'territorial', bodyPlan: 'quad_heavy' };

function setup(level = 1, xp = 0) {
  const progress = new CharacterProgress();
  progress.set('c1', { level, xp, homeSystem: 3 });
  const refreshed: string[] = [];
  let owned: string[] = [];
  const lines: { level: string; msg: string }[] = [];
  const at = (lvl: string) => (_: object, msg: string) => lines.push({ level: lvl, msg });
  const log: PersistenceLog = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  const codex = new CodexService({ progress, skills: { refresh: (id) => refreshed.push(id), owned: () => owned }, log });
  codex.open('c1');
  return { progress, codex, refreshed, lines, own: (nodes: string[]) => (owned = nodes) };
}

describe('the codex service', () => {
  it('records a species the first time with its XP, and a repeat as known, earning nothing', () => {
    const { codex, progress, refreshed } = setup(3, totalXpFor(3));
    const first = codex.record('c1', grazer, 1234.5);
    expect(first).toEqual({
      result: 'new',
      entry: { temperament: 'skittish', threat: 1, bodyPlan: 'quad_grazer', bond: 'eligible', at: 1234.5 },
      xp: SPECIES_XP,
      level: null,
    });
    expect(progress.get('c1')).toEqual({ level: 3, xp: totalXpFor(3) + 300, homeSystem: 3 });
    const again = codex.record('c1', grazer, 2000);
    expect(again).toEqual({ result: 'known', entry: { temperament: 'skittish', threat: 1, bodyPlan: 'quad_grazer', bond: 'eligible', at: 1234.5 } });
    expect(progress.get('c1')!.xp).toBe(totalXpFor(3) + 300);
    expect(refreshed).toEqual([]);
    expect(codex.get('c1')).toEqual({ worlds: { [W]: { system: 3, species: { 0: first.result === 'new' && first.entry } } } });
  });

  it('levels the character up when the XP takes it over a level, and refreshes the skill view that reads the level', () => {
    const { codex, progress, refreshed } = setup(1, totalXpFor(2) - 100);
    const r = codex.record('c1', grazer, 1);
    expect(r).toMatchObject({ result: 'new', level: 2 });
    expect(progress.get('c1')).toMatchObject({ level: 2, xp: totalXpFor(2) + 200 });
    expect(refreshed).toEqual(['c1']);
  });

  it('records nothing and grants nothing once the codex is full', () => {
    const { codex, progress, lines } = setup();
    const full: Codex = emptyCodex();
    for (let i = 0; i < CODEX_LIMITS.species; i++) {
      const w = `1:${Math.floor(i / CODEX_LIMITS.perWorld)}`;
      (full.worlds[w] ??= { system: 0, species: {} }).species[String(i % CODEX_LIMITS.perWorld)] = {
        temperament: 'docile',
        threat: 1,
        bodyPlan: 'biped',
        bond: 'eligible',
        at: 0,
      };
    }
    codex.open('c1', full);
    expect(codex.record('c1', grazer, 1)).toEqual({ result: 'full' });
    expect(progress.get('c1')!.xp).toBe(0);
    expect(lines).toContainEqual({ level: 'error', msg: 'codex is at its bounds; an analysis was not recorded' });
  });

  it('answers Bond’s rule: an analyzed species, a heavy quadruped or flyer only with Big Game', () => {
    const { codex, own } = setup();
    expect(codex.canBond('c1', W, 0)).toBe(false);
    codex.record('c1', grazer, 1);
    codex.record('c1', bull, 1);
    expect(codex.canBond('c1', W, 0)).toBe(true);
    expect(codex.canBond('c1', W, 4)).toBe(false);
    own(['bond', 'big_game']);
    expect(codex.canBond('c1', W, 4)).toBe(true);
    expect(codex.entry('c1', W, 4)).toMatchObject({ bodyPlan: 'quad_heavy', threat: 2, bond: 'big_game' });
  });

  it('holds only characters in play, a copy of what it was opened with', () => {
    const { codex } = setup();
    const stored = emptyCodex();
    codex.open('c2', stored);
    codex.record('c2', grazer, 1);
    expect(stored).toEqual(emptyCodex());
    expect(codex.close('c2')).toBe(true);
    expect(codex.close('c2')).toBe(false);
    expect(codex.holds('c2')).toBe(false);
    expect(() => codex.record('c2', grazer, 1)).toThrow(CodexNotHeldError);
    expect(codex.get('c2')).toBeUndefined();
  });

  it('records the species without XP for a character whose progress is not held, and says so', () => {
    const { codex, lines } = setup();
    codex.open('c3');
    expect(codex.record('c3', grazer, 1)).toMatchObject({ result: 'new', xp: SPECIES_XP, level: null });
    expect(lines).toContainEqual({ level: 'warn', msg: 'analysis XP for a character whose progress is not held; not granted' });
  });
});
