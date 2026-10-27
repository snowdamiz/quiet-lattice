// Where a teleport puts a character (P1.E03.T07): a galaxy system, a frame in it and a pose there, from the CLI's words.
// A frame is `station`, `inertial`, a body index or a full frame id; a pose is a preset or a position in the frame:
//   docked              at the Waystation (its frame only), mode docked
//   orbit[:<alt>]       above a body's sea level along the frame's +x (default a quarter of its radius, at least 2 km),
//                       or that far out from the Waystation along its +z, mode ship
//   surface[:<lat>,<lon>] on a rocky body's drawn ground (§12), 2 m up, at latitude/longitude in degrees in the body's
//                       frame (y is the pole; default 20, 0), mode foot
//   <x>,<y>,<z>         metres in the frame, mode ship
// A `mode` given with the command overrides the preset's. The result is checked against the system and its frames and the
// magnitudes a zone accepts (poseShapeProblem); movement authority (P1.E03.T04) judges the rest where it lands: in play,
// the zone re-seats its mover there (a docked one on a free pad); saved, the join restores it only where movement
// authority would accept it (else docked at home), as any saved pose.
import type { Pose } from '@astra/shared/protocol';
import { frameId, tierOfGalaxySystem, type BodySpec, type PlanetParams, type SystemDescription, type Tier } from '@astra/shared/world';
import { groundOf } from '../fauna/terrain.ts';
import { poseShapeProblem, type PoseState } from '../persistence/components.ts';
import { padPose } from '../sim/movement/index.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { AdminError, vec3 } from './commands.ts';

type MoveMode = PoseState['mode'];

/** Metres above the ground a `surface` teleport stands a character. */
export const SURFACE_CLEARANCE_M = 2;
/** The least altitude of an `orbit` teleport, and its distance from the Waystation. */
export const ORBIT_MIN_M = 2000;

export interface PlaceRequest {
  system: number;
  frame: string;
  pose: string;
  mode?: MoveMode;
}

export interface PlaceOptions {
  /** the system a galaxy index hosts (describeZoneSystem) */
  describe?: (system: number) => SystemDescription;
  /** a system's tier, which plans its drawn ground (the world service's, else the Edge at its default) */
  tierOf?: (system: number) => Tier;
}

/** A frame named on the command line: its id, and the body or Waystation it is (both null for the inertial frame). */
interface NamedFrame {
  id: Pose['frame'];
  body: BodySpec | null;
  station: boolean;
}

/** The placement a teleport asks for, or an AdminError ('invalid') saying what is wrong with it. */
export function resolvePlacement(req: PlaceRequest, opts: PlaceOptions = {}): PoseState {
  let desc: SystemDescription;
  try {
    desc = (opts.describe ?? describeZoneSystem)(req.system);
  } catch {
    throw new AdminError('invalid', `no system ${req.system}`);
  }
  const frame = namedFrame(desc, req.frame);
  const tier = (opts.tierOf ?? tierOfGalaxySystem)(req.system);
  const [preset, arg] = splitPreset(req.pose);
  let pos: [number, number, number];
  let quat: [number, number, number, number] = [0, 0, 0, 1];
  let mode: MoveMode;
  switch (preset) {
    case 'docked': {
      if (!frame.station) throw new AdminError('invalid', 'docked is a pose in the station frame');
      if (arg !== undefined) throw new AdminError('invalid', 'docked takes no argument');
      // on a pad (the first; the zone docks it on whichever is free)
      const pad = padPose(frame.id!, 0);
      pos = [...pad.pos];
      quat = [...pad.quat];
      mode = 'docked';
      break;
    }
    case 'orbit': {
      const alt = arg === undefined ? undefined : Number(arg);
      if (alt !== undefined && !(Number.isFinite(alt) && alt > 0))
        throw new AdminError('invalid', `orbit's altitude must be a positive number of metres, not ${arg}`);
      if (frame.station) pos = [0, 0, alt ?? ORBIT_MIN_M];
      else if (frame.body) pos = [frame.body.radius + (alt ?? Math.max(ORBIT_MIN_M, Math.round(frame.body.radius / 4))), 0, 0];
      else throw new AdminError('invalid', 'orbit needs a body or the station frame');
      mode = 'ship';
      break;
    }
    case 'surface': {
      const body = frame.body;
      if (!body) throw new AdminError('invalid', 'surface needs a body frame');
      if (body.type === 'gas') throw new AdminError('invalid', `${body.name} is a gas giant: it has no surface`);
      const [lat, lon] = arg === undefined ? [20, 0] : latLon(arg);
      const dir = direction(lat, lon);
      const params = body.params as PlanetParams;
      // the ground every client draws (§12), cities levelled; under a sea, its surface
      const ground = groundOf(params, tier).sample(dir);
      const height = params.hasOcean ? Math.max(0, ground) : ground;
      const r = body.radius + height + SURFACE_CLEARANCE_M;
      pos = [dir[0] * r, dir[1] * r, dir[2] * r];
      mode = 'foot';
      break;
    }
    default: {
      if (arg !== undefined) throw new AdminError('invalid', `unknown pose ${req.pose}`);
      const p = vec3(preset);
      if (!p.every(Number.isFinite)) throw new AdminError('invalid', `a pose is docked, orbit[:alt], surface[:lat,lon] or x,y,z metres, not ${req.pose}`);
      pos = p;
      mode = 'ship';
    }
  }
  const at: PoseState = { system: req.system, pose: { frame: frame.id, pos, quat, vel: [0, 0, 0] }, mode: req.mode ?? mode };
  const problem = poseShapeProblem(at);
  if (problem) throw new AdminError('invalid', problem);
  return at;
}

/** The frame `arg` names in the system. */
function namedFrame(desc: SystemDescription, arg: string): NamedFrame {
  const a = arg.trim().toLowerCase();
  if (a === 'inertial' || a === 'null' || a === 'none') return { id: null, body: null, station: false };
  if (a === 'station') return { id: frameId(desc.seed, 'station'), body: null, station: true };
  let body: string;
  if (/^\d{1,3}$/.test(a)) body = a;
  else {
    const m = /^(\d{1,10}):(\d{1,3}|station)$/.exec(a);
    if (!m) throw new AdminError('invalid', `a frame is station, inertial, a body index or <seed>:<body>, not ${arg}`);
    if (Number(m[1]) !== desc.seed) throw new AdminError('invalid', `frame ${arg} is not in this system (its seed is ${desc.seed})`);
    if (m[2] === 'station') return { id: frameId(desc.seed, 'station'), body: null, station: true };
    body = m[2]!;
  }
  const spec = desc.bodies[Number(body)];
  if (!spec) throw new AdminError('invalid', `system ${desc.name} has no body ${body} (it has ${desc.bodies.length})`);
  return { id: frameId(desc.seed, spec.index), body: spec, station: false };
}

function splitPreset(pose: string): [string, string | undefined] {
  const s = pose.trim();
  const i = s.indexOf(':');
  return i < 0 ? [s.toLowerCase(), undefined] : [s.slice(0, i).toLowerCase(), s.slice(i + 1)];
}

function latLon(arg: string): [number, number] {
  const parts = arg.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite) || Math.abs(parts[0]!) > 90 || Math.abs(parts[1]!) > 360) {
    throw new AdminError('invalid', `surface takes <lat>,<lon> in degrees, not ${arg}`);
  }
  return [parts[0]!, parts[1]!];
}

/** A unit direction in a body's frame from latitude and longitude in degrees, y being the pole. */
function direction(lat: number, lon: number): [number, number, number] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  return [Math.cos(φ) * Math.cos(λ), Math.sin(φ), Math.cos(φ) * Math.sin(λ)];
}
