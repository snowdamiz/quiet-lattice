// The Edge following the Count (DESIGN 16.3; P2.E22.T02): where the Edge stands and which stations are dark, as functions
// of the meter and of the map the season opened with (`opening`, rules.ts). The tiers are tierOf(system, edge) with the
// Edge this gives. Pure: the world service applies it, and a client can work out the same from a `world` message.
import { EDGE_X } from '../world/edge.ts';
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
  if (count > FED_FROM) return (Math.min(count, COUNT_TOP) - FED_FROM) / (COUNT_TOP - FED_FROM) * COUNT_EDGE_SHIFT_LY;
  if (count < BROKEN_BELOW) return -((BROKEN_BELOW - Math.max(count, 0)) / BROKEN_BELOW) * COUNT_EDGE_SHIFT_LY;
  return 0;
}

/** x (ly) of the Edge's wall on the X axis with the Count at `count` in a season that opened with `opening`: EDGE_X, the
 * opening's shift and the Count's. */
export function edgeAt(count: number, opening: Pick<SeasonOpening, 'edgeShiftLy'>): number {
  return EDGE_X + opening.edgeShiftLy + countShiftLy(count);
}

/** The systems whose stations are dark with the Count at `count` in a season that opened with `opening`: the ones the
 * season opened dark, until the Count climbs back to FED_FROM and they relight (DESIGN 16.3 "High (700+): dark stations
 * relight"). Ascending. */
export function darkAt(count: number, opening: Pick<SeasonOpening, 'dark'>): readonly number[] {
  if (!Number.isFinite(count)) throw new RangeError(`the Count is a number of measures, not ${count}`);
  return count >= FED_FROM ? [] : opening.dark;
}
