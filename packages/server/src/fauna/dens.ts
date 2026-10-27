// Dens (DESIGN 12.2 "Spawning", P1.E08.T03): the lairs the shared site plan places on a world with its cities and sites
// (planSurface's dens at the system's tier, each naming which of the world's species lives in it), where packs
// are anchored and respawn, the apex keeps its lair and ambushers wait. Predators also come from the herd spawner round
// the players (herds.ts); dens add packs that live at known places.
//
// A den lives in the cell it stands in (sim.ts): while that cell is active, the den keeps its occupants out, each a herd
// of the cell whose home is the den, so packs hunt out from it and go back to it, and ambushers lie still beside it.
//
// - A predator den keeps one pack out (the species' herd, 2–4), and at night a second (night doubles predator spawns,
//   DESIGN 12.2 and 12.8), once a night.
// - An ambusher's burrow beside a site keeps its one or two ambushers out, lurking on it until a player comes within 8 m.
// - The apex's lair, in the world's landmark grove (the most wooded of the places a lair could go, sites.ts), sends the
//   apex and its pack out at night only (TEMPERAMENTS: nightOnly); at dawn it heads home once it has no one to fight and
//   goes into its lair.
// - A den's herd that loses its occupant (every animal of the den's species despawned by someone else: killed, once
//   combat lands; the apex killed, though its pack lives on and hunts on as an ordinary herd of the cell) is replaced
//   after DEN_RESPAWN_S (the apex after APEX_RESPAWN_S), a timer kept while the zone runs, even when the den's cell
//   unloads; a pack that only unloads with its cell comes out again when the cell next loads.
// - A night pack comes out once a night: it is due again from the first day after it, its cell awake or asleep.
// - Nothing comes out of a den within SPAWN_CLEAR_M of a player (the herd spawner's nearest, DESIGN 12.2), and a den
//   spawns only when the zone has room (MAX_CREATURES), trying again at each scan.
//
// A den spawns whether or not dens are drawn yet (DENS_DRAWN, P1.E14.T10): it is a spawn anchor, not geometry.
import { FAUNA_SPAWNING, TEMPERAMENTS } from '@astra/shared/data';
import { hashInts, Random, type Den, type FaunaSpecies, type Tier } from '@astra/shared/world';
import type { Herd } from './ai.ts';
import type { CellGrid, Vec3 } from './cells.ts';
import { animal, HERD_SPREAD_M, levelFor, type HerdPlan } from './herds.ts';

/** A den's pack, wiped out, is replaced after this long, s (DESIGN does not say: long enough that clearing a den holds
 * for a while, short enough that its packs are back before the players have gone far). */
export const DEN_RESPAWN_S = 300;
/** The apex, killed, comes out again after this long (and only at night), s: about half a world's day. */
export const APEX_RESPAWN_S = 1800;
/** Nothing spawns at a den, nor a cell's night herd, nearer a player than this, m (the herd spawner's 70 m). */
export const SPAWN_CLEAR_M = FAUNA_SPAWNING.spawnM.min;
/** At dawn the apex goes into its lair once it is this near it, m. */
export const LAIR_M = 10;
/** Temperaments that come out at night only (the apex). */
export const NIGHT_ONLY: ReadonlySet<string> = new Set(TEMPERAMENTS.filter((t) => t.params.nightOnly).map((t) => t.id));

/** A den as the sim keeps it: its place in the world's den list, where it stands, and the cell it lives in. */
export interface DenSite {
  index: number;
  den: Den;
  /** planet-local unit direction */
  dir: Vec3;
  /** the cell it stands in */
  cell: number;
}

/** A den's occupants and timers (kept by the zone's fauna while it runs, beyond its cell's life). */
export interface DenState {
  /** its pack (the apex and its pack, an ambusher's one or two, a predator den's pack) while out */
  pack: Herd | null;
  /** a predator den's night pack while out */
  night: Herd | null;
  /** world time it may send its pack out again after losing it */
  respawnAt: number;
  /** it has sent out its night pack this night */
  nightDone: boolean;
}

export const newDenState = (): DenState => ({ pack: null, night: null, respawnAt: -Infinity, nightDone: false });

/** Whether a den's state holds nothing a fresh one would not. */
export const idleDen = (s: DenState, now: number) => !s.pack && !s.night && s.respawnAt <= now && !s.nightDone;

/** A world's dens, by index and by the cell each stands in. */
export function denSites(dens: readonly Den[], cells: CellGrid): { sites: DenSite[]; byCell: Map<number, DenSite[]> } {
  const byCell = new Map<number, DenSite[]>();
  const sites = dens.map((den, index) => {
    const dir: Vec3 = [den.dir[0], den.dir[1], den.dir[2]];
    const site: DenSite = { index, den, dir, cell: cells.keyOf(dir[0], dir[1], dir[2]) };
    const list = byCell.get(site.cell);
    if (list) list.push(site);
    else byCell.set(site.cell, [site]);
    return site;
  });
  return { sites, byCell };
}

/** Who lives in a den at the world's tier: its occupant from the world's species, if the world has it yet and it is of
 * the den's role; else null (an empty den). */
export function occupantOf(den: Den, species: readonly FaunaSpecies[]): FaunaSpecies | null {
  const sp = den.species >= 0 ? species[den.species] : undefined;
  return sp && sp.temperament === den.role ? sp : null;
}

/** A den's herd, as planned for its `slot` (0 its pack, 1 its night pack): the same herd every time it comes out, from
 * the world's seed and the den. Ambushers keep within their burrow's footprint. */
export function planDenHerd(worldSeed: number, site: DenSite, sp: FaunaSpecies, tier: Tier, slot: number): HerdPlan {
  const rng = denRandom(worldSeed, site, slot, 0);
  const count = rng.int(sp.herd.min, sp.herd.max);
  const spread = sp.temperament === 'ambusher' ? Math.min(HERD_SPREAD_M, site.den.footprint) : HERD_SPREAD_M;
  return {
    species: sp,
    center: site.dir,
    heading: rng.float(0, Math.PI * 2),
    level: levelFor(rng, tier),
    animals: Array.from({ length: count }, (_, k) => animal(rng, k, spread)),
  };
}

/** A den's random stream for a slot: `part` 0 plans its herd, 1 makes its animals (and the apex's pack). */
export function denRandom(worldSeed: number, site: DenSite, slot: number, part: number): Random {
  return new Random(hashInts(worldSeed, 0xde70 + part, site.index, slot));
}

/** A den as tests and tools see it. */
export interface DenInfo {
  index: number;
  den: Den;
  /** who lives there at the zone's tier, if anyone */
  species: FaunaSpecies | null;
  /** the creature ids of its pack and of its night pack, while out */
  pack: number[];
  night: number[];
  /** world time it may send its pack out again (−Infinity: as soon as it may) */
  respawnAt: number;
}
