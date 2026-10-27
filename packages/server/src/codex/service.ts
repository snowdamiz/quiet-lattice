// Every character in play's codex (DESIGN 14.5, P1.E08.T04; ARCHITECTURE §22): persistence opens it on join (the `codex`
// component), saves it and closes it, and the analysis service records the species its checked analyses show. A species
// recorded for the first time earns its XP (DESIGN 14.9: 300) into the character's progress, levelling it up as quest XP
// does; one already recorded earns nothing and changes nothing. Nothing a client sends reaches it directly.
import { levelForXp } from '@astra/shared/combat';
import {
  addToCodex,
  canBond,
  codexEntry,
  codexEntryFor,
  emptyCodex,
  SPECIES_XP,
  type Codex,
  type CodexEntry,
  type CodexTemperament,
} from '@astra/shared/codex';
import type { BodyPlanId } from '@astra/shared/data';
import type { CharacterProgress } from '../persistence/components.ts';
import type { PersistenceLog } from '../persistence/registry.ts';

/** A species analyzed: its world (frame id and galaxy system), its index there, and what it is. */
export interface AnalyzedSpecies {
  system: number;
  world: string;
  index: number;
  temperament: CodexTemperament;
  bodyPlan: BodyPlanId;
}

/** What recording an analysis did: a `new` entry with the XP it earned and the level it raised the character to (null when
 * it did not), a `known` entry (nothing earned), or nothing at all, the codex being `full`. */
export type Recorded = { result: 'new'; entry: CodexEntry; xp: number; level: number | null } | { result: 'known'; entry: CodexEntry } | { result: 'full' };

export interface CodexServiceOptions {
  /** where XP goes: each character in play's level and xp (the `progress` component's holder) */
  progress: CharacterProgress;
  /** the skill service: its view reads the level, so a level gained refreshes it; Bond reads its owned nodes */
  skills?: { refresh(characterId: string): void; owned(characterId: string): readonly string[] };
  log?: PersistenceLog;
}

/** A character the service does not hold (out of play). */
export class CodexNotHeldError extends Error {
  constructor(readonly characterId: string) {
    super(`the codex of ${characterId} is not held: the character is not in play`);
    this.name = 'CodexNotHeldError';
  }
}

export class CodexService {
  private readonly held = new Map<string, Codex>();
  private readonly progress: CharacterProgress;
  private readonly skills?: CodexServiceOptions['skills'];
  private readonly log?: PersistenceLog;

  constructor(opts: CodexServiceOptions) {
    this.progress = opts.progress;
    this.skills = opts.skills;
    this.log = opts.log;
  }

  /** Puts a character's codex in play (persistence, on join). */
  open(characterId: string, codex: Codex = emptyCodex()): void {
    this.held.set(characterId, structuredClone(codex));
  }

  /** Forgets a character (persistence, once its last save is captured); true when it was held. */
  close(characterId: string): boolean {
    return this.held.delete(characterId);
  }

  holds(characterId: string): boolean {
    return this.held.has(characterId);
  }

  /** The live codex of a character in play (what persistence saves), or undefined. */
  get(characterId: string): Readonly<Codex> | undefined {
    return this.held.get(characterId);
  }

  get size(): number {
    return this.held.size;
  }

  /** A species' entry in a character's codex, if it holds it. */
  entry(characterId: string, world: string, index: number): CodexEntry | undefined {
    return codexEntry(this.must(characterId), world, index);
  }

  /** Whether Bond tames a species for a character in play (P1.E07.T07's rule, DESIGN 9.5): it has analyzed the species,
   * and the species is one Bond takes as it is or the character owns Big Game. */
  canBond(characterId: string, world: string, index: number): boolean {
    const e = this.entry(characterId, world, index);
    return !!e && canBond(e, this.owned(characterId));
  }

  /**
   * Records a species a character analyzed at world time `now` (the analysis service has checked the analysis itself): a
   * first time, its codex entry and SPECIES_XP; after that, nothing. Throws for a character not in play.
   */
  record(characterId: string, species: AnalyzedSpecies, now: number): Recorded {
    const codex = this.must(characterId);
    const r = addToCodex(codex, species.system, species.world, species.index, codexEntryFor(species, now));
    if (r.result === 'full') {
      this.log?.error({ character: characterId, world: species.world, species: species.index }, 'codex is at its bounds; an analysis was not recorded');
      return r;
    }
    if (r.result === 'known') return { result: 'known', entry: r.entry };
    return { result: 'new', entry: r.entry, xp: SPECIES_XP, level: this.grantXp(characterId, SPECIES_XP) };
  }

  /** Adds XP to a character's progress: the level it rose to, or null. */
  private grantXp(characterId: string, xp: number): number | null {
    const p = this.progress.get(characterId);
    if (!p) {
      this.log?.warn({ character: characterId, xp }, 'analysis XP for a character whose progress is not held; not granted');
      return null;
    }
    const total = Math.min(Number.MAX_SAFE_INTEGER, p.xp + xp);
    const level = Math.max(p.level, levelForXp(total));
    this.progress.set(characterId, { ...p, xp: total, level });
    if (level === p.level) return null;
    try {
      this.skills?.refresh(characterId);
    } catch (err) {
      this.log?.error({ err, character: characterId }, 'skill view not refreshed after a level gained by analysis');
    }
    return level;
  }

  private owned(characterId: string): readonly string[] {
    try {
      return this.skills?.owned(characterId) ?? [];
    } catch {
      return [];
    }
  }

  private must(characterId: string): Codex {
    const c = this.held.get(characterId);
    if (!c) throw new CodexNotHeldError(characterId);
    return c;
  }
}
