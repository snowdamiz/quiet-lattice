// A world to test mining on (P1.E13.T01): a galaxy system's home world (system 0's is lush: sodium and oxygen plants and
// two mineral deposits), its drawn ground planned on this thread, and finders for resource nodes with a place to stand
// near them on dry ground: in reach with the ground out of the way, or in reach with a hill between.
import {
  frameId,
  nodeCellLevel,
  nodeCellsNear,
  nodeKey,
  nodeType,
  planetNodeLayers,
  scatterNodes,
  type BodySpec,
  type NodeGround,
  type NodeLayer,
  type NodeTypeId,
  type PlanetParams,
  type ResourceNode,
  type Tier,
} from '@astra/shared/world';
import { nodeGroundsHere } from '../src/resources/ground.ts';
import { lineOfSight } from '../src/resources/los.ts';
import { EYE_M } from '../src/resources/service.ts';
import { describeZoneSystem } from '../src/zones/system.ts';

export type Vec3 = [number, number, number];

/** A node and a place to stand near it. */
export interface NodeSpot {
  node: ResourceNode;
  /** its id (nodeKey) */
  id: string;
  /** where a player stands, planet-local, on the ground */
  stand: Vec3;
  /** the point of the node the beam aims at */
  target: Vec3;
}

/** Two unit vectors along the ground at a direction. */
export function tangentsOf(d: Readonly<Vec3>): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t = norm([d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]]);
  const b = norm([d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]]);
  return [t, b];
}

export function norm(v: Readonly<Vec3>): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function miningWorld(systemIndex = 0, tier: Tier = 0) {
  const system = describeZoneSystem(systemIndex);
  const body: BodySpec = system.bodies[system.home]!;
  const params = body.params as PlanetParams;
  const frame = frameId(system.seed, body.index);
  const ground: NodeGround = nodeGroundsHere.ground(params, tier)!;
  const R = params.radius;
  const level = nodeCellLevel(R);
  const layers: NodeLayer[] = planetNodeLayers(params, tier);
  const dry = params.hasOcean ? 2 : -Infinity;
  const height = (d: Readonly<Vec3>) => ground.sampler.height(d[0], d[1], d[2]);

  /** The point on the ground `east` and `north` metres along it from direction `d`. */
  function onGround(d: Readonly<Vec3>, east = 0, north = 0): Vec3 {
    const [t, b] = tangentsOf(d);
    const dir = norm([d[0] * R + t[0] * east + b[0] * north, d[1] * R + t[1] * east + b[1] * north, d[2] * R + t[2] * east + b[2] * north]);
    const r = R + height(dir);
    return [dir[0] * r, dir[1] * r, dir[2] * r];
  }

  /** What the beam aims at on a node (as the service does). */
  function targetOf(n: ResourceNode): Vec3 {
    const up = nodeType(n.type).place.sink + 0.5;
    return [n.x + n.nx * up, n.y + n.ny * up, n.z + n.nz * up];
  }

  /** The beam from a stand to a target is clear of the ground. */
  function clear(stand: Readonly<Vec3>, target: Readonly<Vec3>): boolean {
    const u = norm(stand);
    return lineOfSight(ground.sampler, [stand[0] + u[0] * EYE_M, stand[1] + u[1] * EYE_M, stand[2] + u[2] * EYE_M], target);
  }

  /**
   * The first node (of the types `want` takes) with a stand `dist` metres from it on dry ground whose line to it is clear
   * (or, with `blocked`, runs through a hill), searching the world from a spread of directions.
   */
  function findNode(opts: { want?: (t: NodeTypeId) => boolean; dist?: number; blocked?: boolean; skip?: number } = {}): NodeSpot {
    const want = opts.want ?? (() => true);
    const dists = opts.blocked ? [14, 18, 22, 26] : [opts.dist ?? 6];
    let skip = opts.skip ?? 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const a = i * 2.399963229728653;
      const rr = Math.sqrt(1 - y * y);
      const d: Vec3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
      if (height(d) < dry + 3) continue;
      for (const cell of nodeCellsNear(d[0], d[1], d[2], 40, R, level)) {
        for (const node of scatterNodes(ground, layers, cell)) {
          if (!want(node.type)) continue;
          const target = targetOf(node);
          const nd = norm([node.x, node.y, node.z]);
          for (const dist of dists) {
            for (let k = 0; k < 8; k++) {
              const ang = (k / 8) * Math.PI * 2;
              const stand = onGround(nd, Math.cos(ang) * dist, Math.sin(ang) * dist);
              if (height(norm(stand)) < dry) continue;
              if (clear(stand, target) === !!opts.blocked) continue;
              if (skip-- > 0) continue;
              return { node, id: nodeKey(cell, node.type, node.k), stand, target };
            }
          }
        }
      }
    }
    throw new Error('no node found to test on');
  }

  return { system, body, params, frame, ground, R, level, layers, height, onGround, targetOf, clear, findNode };
}
