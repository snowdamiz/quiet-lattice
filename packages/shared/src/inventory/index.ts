// The character's inventory (`@astra/shared/inventory`, DESIGN 10.1): suit stacks that stay with the character, the ship's
// cargo pods that drop where it dies, and units. A zod-schema'd value and pure, deterministic operations on it, used by the
// server as the authority and by the client to predict (IMPLEMENTATION_PLAN 0.3, ARCHITECTURE §7).
export * from './schema.ts';
export * from './ops.ts';
export * from './layout.ts';
