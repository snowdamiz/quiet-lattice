// Seasons (`@astra/shared/seasons`, DESIGN 16.4; P2.E22.T03; ARCHITECTURE §27): a season's length, end and bucket, the
// map the next one opens with, the titles and glyphs it awards, and its chronicle. The server's world service rolls
// seasons with these rules; the client reads them to show what the server sent.
export * from './schema.ts';
export * from './rules.ts';
export * from './edge.ts';
