// Character progression (DESIGN 14.9): the XP curve and what a kill is worth. Levels themselves are COMBAT.level (1–50).
import { deepFreeze } from './common.ts';

/** XP to reach level n = 100 × n^1.6 (per level, not cumulative: ≈ 4k for 10, 23k for 30, 52k for 50, about 1.0M to the
 * cap); kills give the mob's level × 10. */
export const XP_CURVE = deepFreeze({ base: 100, exponent: 1.6, perKillLevel: 10 });
