// Game data tables (`@astra/shared/data`): each module exports a zod schema, its inferred type, the frozen table
// transcribed from docs/DESIGN.md, and a lookup by id that throws on an unknown id. The data suite in
// packages/shared/test/data.test.ts parses every table and checks every cross-reference.
export * from './common.ts';
export * from './modifiers.ts';
export * from './resources.ts';
export * from './items.ts';
export * from './weapons.ts';
export * from './hulls.ts';
export * from './sensors.ts';
export * from './meters.ts';
export * from './trainers.ts';
export * from './factions.ts';
export * from './peoples.ts';
export * from './skills/index.ts';
export * from './recipes.ts';
export * from './mobs.ts';
export * from './bosses.ts';
export * from './progression.ts';
export * from './walker.ts';
export * from './station.ts';
