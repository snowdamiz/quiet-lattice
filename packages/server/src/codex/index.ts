// The codex and analysis (DESIGN 14.5, P1.E08.T04; ARCHITECTURE §22): each character's analyzed species, held while it is
// in play and persisted as the `codex` component, and the server's checks of a client's request to analyze a creature.
export * from './analysis.ts';
export * from './component.ts';
export * from './service.ts';
export * from './species.ts';
