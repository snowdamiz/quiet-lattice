// The ground resource nodes are scattered over (ARCHITECTURE §12, §18): a world's drawn ground, `drawnGround(params,
// tier)` planned exactly as every client plans it, as the shared spec's NodeGround (the sampler with its pads levelled,
// and the sites' clearance). The server scatters a cell's nodes over it only when a player mines there.
//
// Planning a world's surface costs 5–100 ms, far more than a tick, so it is never done on the zones' loop: the nodes
// read the ground fauna's planner (fauna/terrain.ts, GroundPlanner) plans in its worker thread, one plan per world for
// both, kept for the 16 worlds most recently asked for, with its rules for a worker that dies or hangs and a world that
// fails. A world's ground is asked for as a player arrives on it, and a hit on a world not yet planned is refused `busy`.
import type { NodeGround, PlanetParams } from '@astra/shared/world';
import { groundPlanner, planHere, type GroundSource } from '../fauna/terrain.ts';

/** Where worlds' node grounds come from. */
export interface NodeGroundSource {
  /** The world's ground for a system of `tier` if it is ready; otherwise it starts planning it (once) and returns null. */
  ground(params: PlanetParams, tier: number): NodeGround | null;
}

/** The node grounds of a fauna ground source: its grounds' `nodes`. */
export function nodeGroundsOf(source: GroundSource): NodeGroundSource {
  return { ground: (params, tier) => source.ground(params, tier)?.nodes ?? null };
}

/** The server's: fauna's worker planner, shared by every zone. */
export const nodeGrounds: NodeGroundSource = nodeGroundsOf(groundPlanner);

/** Plans on the calling thread: always ready (tests and tools). */
export const nodeGroundsHere: NodeGroundSource = nodeGroundsOf(planHere);
