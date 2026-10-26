// Conjunctions (need Tier II in both branches), DESIGN 9.9.
import { conjunctionNodes } from './schema.ts';

export const CONJUNCTIONS = conjunctionNodes([
  {
    id: 'collapse_star',
    name: 'Collapse Star',
    branches: ['gravitic', 'thermal'],
    text: 'Flare cast into your Well detonates it',
    discovery: { kind: 'mine', resource: 'gold', world: 'inferno' },
    refs: ['flare', 'well'],
  },
  {
    id: 'beastsong',
    name: 'Beastsong',
    branches: ['resonance', 'symbiotic'],
    text: 'Harmonic tames instead of calms, no analysis needed',
    discovery: { kind: 'analyze_species', count: 30 },
    refs: ['harmonic'],
    flags: ['harmonic_tames'],
  },
  {
    id: 'standing_wave',
    name: 'Standing Wave',
    branches: ['gravitic', 'resonance'],
    text: 'Pulse inside a Well stuns 6 s',
    discovery: { kind: 'attune', world: 'storm' },
    refs: ['pulse', 'well'],
    params: { stunS: 6 },
  },
  {
    id: 'cold_fire',
    name: 'Cold Fire',
    branches: ['thermal', 'void'],
    text: 'Lance costs health instead of heat while overheated',
    discovery: { kind: 'kill_boss', boss: 'wardens' },
    refs: ['lance'],
    flags: ['lance_costs_health_when_overheated'],
  },
  {
    id: 'grave_pull',
    name: 'Grave Pull',
    branches: ['gravitic', 'void'],
    text: "Rift also pulls the Hollow's husks apart (bonus damage)",
    discovery: { kind: 'survive_event', event: 'hollow_tide' },
    refs: ['rift'],
    flags: ['bonus_damage_vs_hollow'],
  },
  {
    id: 'green_hull',
    name: 'Green Hull',
    branches: ['symbiotic', 'pilot'],
    text: 'Repair Drones also heal party ships within 500 m',
    discovery: { kind: 'escort_convoys', count: 10 },
    refs: ['repair_drones'],
    params: { radiusM: 500 },
  },
]);
