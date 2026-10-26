// Ships (`@astra/shared/ships`, DESIGN 10): a ship is a hull id plus fitted modules (`ShipLoadout`); `shipStats` reads every
// number it flies with from the data tables and the pilot's skill web; `flightCaps` gives the speeds the server enforces per
// movement mode; `effectiveSignature` how detectable it is.
export * from './loadout.ts';
export * from './stats.ts';
export * from './flight.ts';
export * from './signature.ts';
