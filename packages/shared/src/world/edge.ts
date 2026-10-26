// The edge of space: where the universe stops, on the +X side, in light years. Its shape is shared by the galaxy map,
// the sky seen in flight and the cosmos (what a ship may run into out there); the client draws it (ui/map/EdgeOfSpace).

/** Far past our galaxy and its neighbours, about 3 million ly out. */
export const EDGE_X = 3.1e6;
/** The membrane bows back gently towards the galaxy, a wall seen from inside a sphere this big (ly). */
export const EDGE_CURVE_R = 2600 * 1e4;

/** x of the membrane at a height y and depth z. */
export function edgeX(y: number, z: number): number {
  return EDGE_X - (y * y + z * z) / (2 * EDGE_CURVE_R);
}
