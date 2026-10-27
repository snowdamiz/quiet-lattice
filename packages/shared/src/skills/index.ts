// A character's skill web (`@astra/shared/skills`, DESIGN 9.1): points, unlocks, owned nodes, the fragment ledger, the two
// action bars and respec, as a zod-schema'd value and pure rules over it. The server is the authority (packages/server/src/
// skills); the client predicts with the same rules (ARCHITECTURE §7). The node table itself is `@astra/shared/data`.
export * from './schema.ts';
export * from './rules.ts';
