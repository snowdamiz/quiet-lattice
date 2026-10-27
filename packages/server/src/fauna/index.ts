// Server-side fauna (DESIGN 12.2, P1.E08.T01): herds in cells round the players on a world's surface, their AI, and
// their creatures as zone entities. The zone ticks a FaunaSim (zones/zone.ts); the rest are its parts.
export * from './sim.ts';
export { AI, RULES, reach, type CreatureState } from './ai.ts';
export { CELL_M, CellGrid } from './cells.ts';
export { densOf, Ground, groundOf, GroundPlanner, groundPlanner, LATTICE_M, planDenList, planHere, type GroundSource } from './terrain.ts';
export { planCellHerd, planNightHerd, TIER_LEVELS, type HerdPlan } from './herds.ts';
export * from './dens.ts';
export * from './sky.ts';
