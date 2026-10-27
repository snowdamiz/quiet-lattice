// The ship's base gun and what it can hit (DESIGN 9.1 "ship lasers stay on LMB as the base gun", 10.3; ARCHITECTURE §20).
// Its numbers are the fitted weapon's, from the data through `shipStats` (Pilot and Thermal modifiers applied), never
// written here: P1.E12.T04 turns this into the Pulse Lasers hardpoint module beside the Mining Laser.
import { getWeapon, type WeaponId } from '@astra/shared/data';
import type { ShipStats } from '@astra/shared/ships';

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

/** How far off the ship's nose the guns may be aimed, degrees: the lasers fire along it, and the server's pose is up to an
 * input old (50 ms, about 5° at the fastest turn) and the client's aim a frame newer. */
export const AIM_CONE_DEG = 30;
/** How far the server carries its believed pose on along its velocity to the shot's time, at most, s (two inputs). */
export const LEAD_MAX_S = 0.1;
/** Slack on a creature's hit sphere, m: it moves on between the snapshot the client aimed at and the server's tick. */
export const HIT_SLACK_M = 1;

export interface Gun {
  hardpoint: string;
  weapon: WeaponId;
  /** per shot (a pair's volley) */
  damage: number;
  cooldownS: number;
  rangeM: number;
}

/** The base gun: the first hardpoint whose fitted weapon is hitscan and has a damage, cooldown and range per shot (the
 * Lark's Pulse Lasers on `s1`), or null when none is fitted. */
export function baseGun(stats: ShipStats): Gun | null {
  for (const h of stats.hardpoints) {
    if (!h.weapon || h.damage === null || h.cooldownS === null || h.rangeM === null) continue;
    if (!getWeapon(h.weapon).params.hitscan) continue;
    return { hardpoint: h.id, weapon: h.weapon, damage: h.damage, cooldownS: h.cooldownS, rangeM: h.rangeM };
  }
  return null;
}

/** The unit direction a ship with orientation `q` points its nose (its −z), as the client's lasers fire. */
export function noseOf(q: Quat): [number, number, number] {
  const [x, y, z, w] = q;
  // −(the rotated +z axis)
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** Whether `aim` (any length) is within `coneDeg` of the nose of a ship with orientation `q`. */
export function aimWithin(aim: Vec3, q: Quat, coneDeg = AIM_CONE_DEG): boolean {
  const len = Math.hypot(aim[0], aim[1], aim[2]);
  if (!(len > 0)) return false;
  const n = noseOf(q);
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const cos = (aim[0] * n[0] + aim[1] * n[1] + aim[2] * n[2]) / (len * nl);
  return cos >= Math.cos((coneDeg * Math.PI) / 180);
}

/** A creature's hit sphere: round its body (a walker's centre stands its half height over its feet), the rig's 1 m at
 * size 1, with HIT_SLACK_M. `pos` is in its world's frame. */
export function creatureSphere(c: { pos: Vec3; scale: number; species: { size: number; kind: string } }): { pos: [number, number, number]; radius: number } {
  const size = c.species.size * c.scale;
  const radius = size * 0.6 + HIT_SLACK_M;
  if (c.species.kind === 'flyer') return { pos: [c.pos[0], c.pos[1], c.pos[2]], radius };
  const l = Math.hypot(c.pos[0], c.pos[1], c.pos[2]) || 1;
  const up = size * 0.5;
  return { pos: [c.pos[0] + (c.pos[0] / l) * up, c.pos[1] + (c.pos[1] / l) * up, c.pos[2] + (c.pos[2] / l) * up], radius };
}
