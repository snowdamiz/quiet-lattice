// Combat math (`@astra/shared/combat`, DESIGN 12.1): levels and XP, a mob's numbers at a level, resistances and the damage
// pipeline, hit shapes and the aggro model. Pure and deterministic, with numbers from `@astra/shared/data`; the server runs
// it to decide every hit, and the client may run it to predict one for feel.
export * from './level.ts';
export * from './stats.ts';
export * from './damage.ts';
export * from './mobs.ts';
export * from './hits.ts';
export * from './aggro.ts';
