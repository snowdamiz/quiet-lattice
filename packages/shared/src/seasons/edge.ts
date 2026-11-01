// The Edge following the Count (DESIGN 16.3; P2.E22.T02): where the Edge stands and which stations are dark, as functions
// of the meter and of the map the season opened with (`opening`, rules.ts). The tiers are tierOf(system, edge) with the
// Edge this gives. Pure: the world service applies it, and a client can work out the same from a `world` message.
import { EDGE_X } from '../world/edge.ts';
import { galaxyTiers } from '../world/tiers.ts';
import { BROKEN_BELOW, FED_FROM, type SeasonOpening } from './schema.ts';

/** The most the Count alone moves the Edge, in light years, at 1,000 (out) or 0 (in): the same as a season's opening
 * (SEASON_EDGE_SHIFT_LY), so a Fed season that keeps feeding recedes it 20 ly in all and a Broken one that keeps
 * breaking advances it as far. At seed 424242 the Edge-ward fringe runs from 1 system at 10 ly out to 10 at 10 ly in. */
export const COUNT_EDGE_SHIFT_LY = 10;
/** The most the Count is. */
const COUNT_TOP = 1000;

/**
 * How far the Count moves the Edge from where the season opened it, in light years along +X: out (positive) from FED_FROM
 * up, none through the middle (DESIGN 16.3 "Middle (300–700): baseline"), in (negative) below BROKEN_BELOW, each in a straight
 * line to COUNT_EDGE_SHIFT_LY at the ends of the meter. Continuous, so a measure never jumps the Edge.
 */
export function countShiftLy(count: number): number {
  if (!Number.isFinite(count)) throw new RangeError(`the Count is a number of measures, not ${count}`);
  if (count > FED_FROM) return ((Math.min(count, COUNT_TOP) - FED_FROM) / (COUNT_TOP - FED_FROM)) * COUNT_EDGE_SHIFT_LY;
  if (count < BROKEN_BELOW) return -((BROKEN_BELOW - Math.max(count, 0)) / BROKEN_BELOW) * COUNT_EDGE_SHIFT_LY;
  return 0;
}

/** x (ly) of the Edge's wall on the X axis with the Count at `count` in a season that opened with `opening`: EDGE_X, the
 * opening's shift and the Count's. */
export function edgeAt(count: number, opening: Pick<SeasonOpening, 'edgeShiftLy'>): number {
  return EDGE_X + opening.edgeShiftLy + countShiftLy(count);
}

/** The systems on the Edge-ward fringe (Tier 5 by the Edge alone, never a home system) with the Edge at `edge`. */
function fringeAt(edge: number): Set<number> {
  return new Set(
    galaxyTiers(edge)
      .filter((s) => s.edgeWard && s.tier !== 0)
      .map((s) => s.id),
  );
}

/** The systems whose stations are dark with the Count at `count` in a season that opened with `opening` (DESIGN 16.3):
 * the ones the season opened dark, and below BROKEN_BELOW the systems the Count itself has pushed Edge-ward (the Low row:
 * "Edge-ward systems flip to Tier 5; their Waystations go dark"), those on the fringe at edgeAt(count, opening) but not at
 * edgeAt(BROKEN_BELOW, opening), the Edge the middle of the meter leaves. All of them relight as the Count climbs (at
 * FED_FROM, "dark stations relight"; the Count's own as the fringe goes back out). Ascending. */
export function darkAt(count: number, opening: Pick<SeasonOpening, 'dark' | 'edgeShiftLy'>): readonly number[] {
  if (!Number.isFinite(count)) throw new RangeError(`the Count is a number of measures, not ${count}`);
  if (count >= FED_FROM) return [];
  if (count >= BROKEN_BELOW) return opening.dark;
  const held = fringeAt(edgeAt(BROKEN_BELOW, opening));
  const pushed = [...fringeAt(edgeAt(count, opening))].filter((id) => !held.has(id));
  return [...new Set([...opening.dark, ...pushed])].sort((a, b) => a - b);
}
