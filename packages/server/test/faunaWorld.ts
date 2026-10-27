// A world to test fauna on: a zone of galaxy system 0 at a chosen tier, a body whose species fit the test, a player on
// foot on dry, open ground, and helpers to place things on the ground around it and run the zone's clock.
import { faunaSpecies, frameId, type BodySpec, type FaunaSpecies, type PlanetParams, type Tier } from '@astra/shared/world';
import type { Vec3 } from '../src/fauna/cells.ts';
import { tangents } from '../src/fauna/herds.ts';
import type { FaunaOptions, HerdRequest } from '../src/fauna/sim.ts';
import { groundOf, planHere, type Ground } from '../src/fauna/terrain.ts';
import { describeZoneSystem } from '../src/zones/system.ts';
import { Zone, type ZoneViewer } from '../src/zones/zone.ts';

export const SYSTEM = 0;

/** The first rocky body of system 0 whose species at `tier` pass `want`. */
export function findWorld(tier: Tier, want: (species: readonly FaunaSpecies[]) => boolean): BodySpec {
  const system = describeZoneSystem(SYSTEM);
  const body = system.bodies.find((b) => b.type !== 'gas' && want(faunaSpecies(b.params as PlanetParams, tier)));
  if (!body) throw new Error(`no world in system ${SYSTEM} has the species wanted at tier ${tier}`);
  return body;
}

/** A spot on dry land, well above the sea, with ground about as high all round it (no cliff) for 80 m; within `band` of
 * the world's equator (|y| of the unit direction, its spin axis being +Y) if given, where day and night take turns
 * whatever the season. */
export function openGround(ground: Ground, band = 1): Vec3 {
  for (let i = 0; i < 20000; i++) {
    const a = i * 0.618034 * Math.PI * 2;
    const y = 1 - (2 * (i + 0.5)) / 20000;
    if (Math.abs(y) > band) continue;
    const r = Math.sqrt(1 - y * y);
    const dir: Vec3 = [Math.cos(a) * r, y, Math.sin(a) * r];
    const h = ground.sample(dir);
    if (h < 20) continue;
    const [t, b] = tangents(dir);
    let flat = true;
    for (const [e, n] of [
      [80, 0],
      [-80, 0],
      [0, 80],
      [0, -80],
      [40, 40],
      [-40, -40],
    ] as const) {
      const d = along(dir, t, b, e, n, ground.radius);
      const hd = ground.sample(d);
      if (hd < 10 || Math.abs(hd - h) > 12) flat = false;
    }
    if (flat) return dir;
  }
  throw new Error('no open ground found');
}

/** The unit direction `east` and `north` metres from a unit direction along its tangents `t` and `b`. */
export function along(dir: Readonly<Vec3>, t: Readonly<Vec3>, b: Readonly<Vec3>, east: number, north: number, radius: number): Vec3 {
  const x = dir[0] * radius + t[0] * east + b[0] * north;
  const y = dir[1] * radius + t[1] * east + b[1] * north;
  const z = dir[2] * radius + t[2] * east + b[2] * north;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export interface FaunaWorld {
  zone: Zone;
  body: BodySpec;
  species: readonly FaunaSpecies[];
  ground: Ground;
  frame: string;
  viewer: ZoneViewer;
  /** the player's entity id */
  player: number;
  /** the spot the player starts on (a unit direction) */
  home: Vec3;
  time: number;
  /** a point on the ground `east` and `north` metres from the player's start */
  at(east: number, north: number): Vec3;
  /** the point on the ground below (or above) a position */
  onGround(pos: readonly number[]): Vec3;
  /** a way out from the player's start (a unit vector along the ground) with dry land under it for `length` metres */
  dryWay(length: number): Vec3;
  /** moves the player (on foot unless `mode` says otherwise) to a point on the ground */
  movePlayer(pos: Readonly<Vec3>, mode?: string): void;
  /** runs the zone for `seconds` at 20 Hz, calling `each` after every tick */
  run(seconds: number, each?: () => void): void;
  /** spawnHerd, which must find room */
  spawn(req: HerdRequest): { herd: number; creatures: number[] };
}

export function faunaWorld(opts: {
  tier: Tier;
  want: (species: readonly FaunaSpecies[]) => boolean;
  spawner?: boolean;
  fauna?: Omit<FaunaOptions, 'tier' | 'spawner'>;
}): FaunaWorld {
  const system = describeZoneSystem(SYSTEM);
  const body = findWorld(opts.tier, opts.want);
  const zone = new Zone({
    id: 'fauna-test',
    systemIndex: SYSTEM,
    system,
    fauna: { tier: opts.tier, spawner: opts.spawner ?? false, grounds: planHere, ...opts.fauna },
  });
  const ground = groundOf(body.params as PlanetParams);
  const home = openGround(ground);
  const [t, b] = tangents(home);
  const frame = frameId(system.seed, body.index);
  const onGround = (dir: Readonly<Vec3>): Vec3 => {
    const r = ground.radius + ground.sample(dir);
    return [dir[0] * r, dir[1] * r, dir[2] * r];
  };
  const viewer: ZoneViewer = { id: 1, sendBinary: () => {} };
  const player = zone.join(viewer, { kind: 'player', frame, pos: onGround(home), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  const w: FaunaWorld = {
    zone,
    body,
    species: faunaSpecies(body.params as PlanetParams, opts.tier),
    ground,
    frame,
    viewer,
    player,
    home,
    time: 1000,
    at: (east, north) => onGround(along(home, t, b, east, north, ground.radius)),
    onGround: (pos: readonly number[]) => {
      const l = Math.hypot(pos[0], pos[1], pos[2]);
      return onGround([pos[0]! / l, pos[1]! / l, pos[2]! / l]);
    },
    dryWay(length) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        let dry = true;
        for (let d = 0; d <= length && dry; d += 10) dry = ground.sample(along(home, t, b, Math.cos(a) * d, Math.sin(a) * d, ground.radius)) > 3;
        if (dry) return [t[0] * Math.cos(a) + b[0] * Math.sin(a), t[1] * Math.cos(a) + b[1] * Math.sin(a), t[2] * Math.cos(a) + b[2] * Math.sin(a)];
      }
      throw new Error(`no dry way ${length} m long`);
    },
    movePlayer: (pos, mode = 'foot') => zone.patch(player, { pos: [pos[0], pos[1], pos[2]], mode }),
    spawn(req) {
      const r = zone.fauna!.spawnHerd(req);
      if (!r) throw new Error('no room for the herd');
      return r;
    },
    run(seconds, each) {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        w.time += 0.05;
        zone.step(w.time);
        each?.();
      }
    },
  };
  w.run(0.1);
  return w;
}

export const dist = (a: Readonly<Vec3>, b: Readonly<Vec3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
