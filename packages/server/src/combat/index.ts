// Combat on the server (P1.E06.T02, ARCHITECTURE §20): each zone's health, damage path, deaths and events (zone.ts), the
// ship's base gun (gun.ts) and its line of sight (sight.ts), and the gateway's service that resolves shots and hands out
// what kills are worth (service.ts).
export * from './zone.ts';
export * from './gun.ts';
export * from './sight.ts';
export * from './service.ts';
