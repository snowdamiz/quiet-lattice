// Ships (`@astra/shared/ships`, DESIGN 10): a ship is a hull id plus fitted modules (`ShipLoadout`); `shipStats` reads every
// number it flies with from the data tables and the pilot's skill web; `flightCaps` gives the speeds the server enforces per
// movement mode; `effectiveSignature` how detectable it is, and `detects` whether a detector's sensors pick it up.
// `walkerStats` and `walkerCaps` are the same for a player on foot, and `airDensity` and `pulseClearance` read a ship's
// surroundings as its flight model does, so the server's movement authority (P1.E03.T04) holds both to one set of rules.
export * from './loadout.ts';
export * from './stats.ts';
export * from './flight.ts';
export * from './signature.ts';
export * from './walker.ts';
export * from './environment.ts';
