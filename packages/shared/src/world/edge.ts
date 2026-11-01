// The edge of space: where the universe stops, on the +X side, in light years. Its shape is shared by the galaxy map,
// the sky seen in flight and the cosmos (what a ship may run into out there); the client draws it (ui/map/EdgeOfSpace).

/** Far past our galaxy and its neighbours, about 3 million ly out. */
export const EDGE_X = 3.1e6;
/** The membrane bows back gently towards the galaxy, a wall seen from inside a sphere this big (ly). */
export const EDGE_CURVE_R = 2600 * 1e4;

/**
 * How far the drawn wall moves for each light year the Edge moves (P2.E22.T02). The Edge the tiers follow moves by tens of
 * light years, because the cluster is about 110 ly across; the wall 3.1 million ly out would not move a pixel by that,
 * so the map and the sky draw it moving this much further. The wall stays beyond the farthest galaxy (0.8 × EDGE_X, see
 * cosmos.ts) at the most the Count and a season's opening move it together (20 ly).
 */
export const EDGE_WALL_LY_PER_LY = 2e4;

/** Where the drawn wall stands on the X axis with the Edge at `edge` (EDGE_X by default): the wall's own x, not the tiers'. */
export function wallX(edge: number = EDGE_X): number {
  return EDGE_X + (edge - EDGE_X) * EDGE_WALL_LY_PER_LY;
}

/** x of the membrane at a height y and depth z, with the Edge at `edge` (EDGE_X by default, as the world service
 * publishes it: `world.edgeX`). */
export function edgeX(y: number, z: number, edge: number = EDGE_X): number {
  return wallX(edge) - (y * y + z * z) / (2 * EDGE_CURVE_R);
}
