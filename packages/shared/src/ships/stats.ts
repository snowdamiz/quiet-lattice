// A ship's numbers (DESIGN 10): the hull sets them, skill-web passives, fitted modules and timed buffs modify them. One function
// for the client's flight model and the server's authority, so both read the same ship. (It imports only the tables it reads,
// so the client bundles no mob, boss or recipe tables.)
import { HAZARDS, deepFreeze, indexById } from '../data/common.ts';
import type { Hazard, HullId, WeaponId, WeaponSize } from '../data/common.ts';
import { getHull } from '../data/hulls.ts';
import { ITEMS } from '../data/items.ts';
import { METERS } from '../data/meters.ts';
import type { Stat, StatMod } from '../data/modifiers.ts';
import { SKILL_NODES, getSkillNode } from '../data/skills/index.ts';
import { getWeapon } from '../data/weapons.ts';
import { fitsHardpoint, hardpointsOf } from './loadout.ts';
import type { ShipLoadout } from './loadout.ts';

/** What a ship's numbers depend on besides its loadout. */
export interface ShipInputs {
  /** Skill nodes the pilot owns. Always-on nodes (passives, and ship forms with no cost) change the stats; actives change
   * them only while cast, and arrive then as buffs. */
  skills?: Iterable<string>;
  /** Timed effects in force: catalysts and the effects of cast actives. */
  buffs?: readonly StatMod[];
  /** Condition ids (CONDITIONS) that hold now; a modifier with `when` applies only while its condition holds. */
  conditions?: Iterable<string>;
}

/** Today's values for ship stats the hull roster does not carry. */
export const SHIP_BASELINE = {
  /** The fastest a ship may be moving to begin a landing, m/s (DESIGN 9.7, Soft Landing: "today 160"). */
  landingSpeedMax: 160,
} as const;

export interface HardpointStats {
  id: string;
  size: WeaponSize;
  /** The module item fitted, or null. */
  module: string | null;
  /** The weapon that module fits as, or null. */
  weapon: WeaponId | null;
  /** The weapon's numbers after modifiers (Gunnery scales every cooldown; laser damage and range reach laser-type weapons
   * only), or null where it has none or nothing is fitted. */
  cooldownS: number | null;
  rangeM: number | null;
  /** Per shot (a multi-barrel weapon's volley). */
  damage: number | null;
  /** While a continuous beam is held. */
  dps: number | null;
}

export interface ShipStats {
  hullId: HullId;
  /** Top speeds on the throttle, m/s (`ship.speed_max` scales both). */
  speed: { space: number; atmo: number };
  /** Boost multiplies the space top speed. */
  boost: number;
  hullMax: number;
  shieldMax: number;
  /** Charge capacity (today's pulse fuel, DESIGN 9.1), or 'count' for the Husk, which draws its Charge from the Count. */
  charge: number | 'count';
  /** Cargo pod bays: how many pods the ship can carry (`ship.cargo_pods`: Pack Mule adds one). */
  cargoPods: number;
  /** Detection multipliers, 1.0 being today's ship; `vsHollow` is how the Hollow read it (the Husk's 0.1, otherwise `base`).
   * See `effectiveSignature`. */
  signature: { base: number; vsHollow: number };
  hardpoints: readonly HardpointStats[];
  /** Ship actives the hull can slot. */
  abilitySlots: number;
  /** Skill nodes the hull carries whether or not the pilot owns them (the Ghost's Cloak), and its plain flags. */
  builtIn: { nodes: readonly string[]; flags: readonly string[] };
  /** The fastest the ship may be moving to begin a landing, m/s. */
  landingSpeedMax: number;
  pulse: {
    /** Charge the pulse drive burns per second near bodies. */
    fuelBurn: number;
    /** Multiplier on the pulse drive's near-body speed limit (Supercruise; see `pulseSpeedLimit`). */
    nearLimit: number;
  };
  /** Multipliers on hazard damage (Thermal Plating's ÷3 is 1/3; the Wayfarer's base resist ×2 is 0.5). */
  hazardDamage: Readonly<Record<Hazard, number>>;
}

/** Why a loadout cannot fly. */
export type FitError =
  /** A module on a hardpoint the hull does not have: more modules than the hull has room for. */
  | { code: 'no_such_hardpoint'; hardpoint: string; module: string }
  | { code: 'unknown_module'; hardpoint: string; module: string }
  /** Only weapon modules go on hardpoints (DESIGN 10.1). */
  | { code: 'not_a_weapon'; hardpoint: string; module: string }
  /** A weapon fits a hardpoint of its own size or larger. */
  | { code: 'too_large'; hardpoint: string; module: string; size: WeaponSize; hardpointSize: WeaponSize }
  | { code: 'too_many_cargo_pods'; pods: number; capacity: number };

export class LoadoutError extends Error {
  constructor(readonly errors: readonly FitError[]) {
    super(`Invalid ship loadout: ${errors.map((e) => e.code).join(', ')}`);
    this.name = 'LoadoutError';
  }
}

const ITEM_BY_ID = indexById(ITEMS);

/** Applies a stat's modifiers to a base value: every add, then every mul, then set (the last set in source order wins). */
export function applyMods(base: number, stat: Stat, mods: readonly StatMod[]): number {
  let v = base;
  for (const m of mods) if (m.stat === stat && m.op === 'add') v += m.value;
  for (const m of mods) if (m.stat === stat && m.op === 'mul') v *= m.value;
  for (const m of mods) if (m.stat === stat && m.op === 'set') v = m.value;
  return v;
}

/** The modifiers in force on a ship, in source order: the hull's perks, the always-on nodes it and the pilot own (in the web's
 * order), its modules, then buffs. Modifiers scoped to one branch's or named nodes' effects are left out: they change those
 * abilities, not the ship. */
function shipMods(loadout: ShipLoadout, inputs: ShipInputs): StatMod[] {
  const hull = getHull(loadout.hull);
  const owned = new Set<string>(hull.builtIn.nodes);
  for (const id of inputs.skills ?? []) owned.add(getSkillNode(id).id);
  const mods: StatMod[] = [...hull.builtIn.mods];
  for (const n of SKILL_NODES) if (owned.has(n.id) && n.slot === null) mods.push(...n.mods);
  for (const id of Object.values(loadout.modules)) mods.push(...(ITEM_BY_ID.get(id)?.mods ?? []));
  mods.push(...(inputs.buffs ?? []));
  const holds = new Set(inputs.conditions ?? []);
  return mods.filter((m) => !m.branch && !m.nodes && (!m.when || holds.has(m.when)));
}

/** Every reason a loadout cannot fly; empty when it can. */
export function validateLoadout(loadout: ShipLoadout, inputs: ShipInputs = {}): FitError[] {
  return fitErrors(loadout, shipMods(loadout, inputs));
}

function fitErrors(loadout: ShipLoadout, mods: readonly StatMod[]): FitError[] {
  const errors: FitError[] = [];
  const hardpoints = new Map(hardpointsOf(loadout.hull).map((h) => [h.id, h]));
  for (const [hardpoint, module] of Object.entries(loadout.modules)) {
    const at = hardpoints.get(hardpoint);
    const item = ITEM_BY_ID.get(module);
    if (!at) errors.push({ code: 'no_such_hardpoint', hardpoint, module });
    else if (!item) errors.push({ code: 'unknown_module', hardpoint, module });
    else if (item.kind !== 'module' || !item.weapon) errors.push({ code: 'not_a_weapon', hardpoint, module });
    else {
      const size = getWeapon(item.weapon).size;
      if (!fitsHardpoint(size, at.size)) errors.push({ code: 'too_large', hardpoint, module, size, hardpointSize: at.size });
    }
  }
  const capacity = cargoCapacity(loadout.hull, mods);
  if (loadout.cargoPods > capacity) errors.push({ code: 'too_many_cargo_pods', pods: loadout.cargoPods, capacity });
  return errors;
}

function cargoCapacity(hull: HullId, mods: readonly StatMod[]): number {
  return Math.max(0, Math.round(applyMods(getHull(hull).cargoPods, 'ship.cargo_pods', mods)));
}

/** A ship's numbers. Throws a LoadoutError if the loadout cannot fly, and on an unknown skill node. */
export function shipStats(loadout: ShipLoadout, inputs: ShipInputs = {}): ShipStats {
  const mods = shipMods(loadout, inputs);
  const errors = fitErrors(loadout, mods);
  if (errors.length) throw new LoadoutError(errors);
  const hull = getHull(loadout.hull);
  const mod = (stat: Stat, base: number) => applyMods(base, stat, mods);
  const hazardDamage = Object.fromEntries(HAZARDS.map((h) => [h, mod(`ship.hazard_damage_${h}`, 1)])) as Record<Hazard, number>;
  return deepFreeze({
    hullId: hull.id,
    speed: { space: mod('ship.speed_max', hull.speed.space), atmo: mod('ship.speed_max', hull.speed.atmo) },
    boost: hull.boost,
    hullMax: mod('ship.hull_max', hull.hull),
    shieldMax: mod('ship.shield_max', hull.shield),
    charge: hull.charge,
    cargoPods: cargoCapacity(hull.id, mods),
    signature: { base: hull.signature.base, vsHollow: hull.signature.vsHollow ?? hull.signature.base },
    hardpoints: hardpointsOf(hull.id).map(({ id, size }): HardpointStats => {
      const module = loadout.modules[id] ?? null;
      const weaponId = (module && ITEM_BY_ID.get(module)?.weapon) || null;
      if (!weaponId) return { id, size, module, weapon: null, cooldownS: null, rangeM: null, damage: null, dps: null };
      const { laser, params: p } = getWeapon(weaponId);
      const laserMod = (stat: Stat, v: number | undefined) => (v === undefined ? null : laser ? mod(stat, v) : v);
      return {
        id,
        size,
        module,
        weapon: weaponId,
        cooldownS: p.cooldownS === undefined ? null : mod('ship.weapon_cooldown', p.cooldownS),
        rangeM: laserMod('ship.laser_range', p.rangeM),
        damage: laserMod('ship.laser_damage', p.damage),
        dps: laserMod('ship.laser_damage', p.dps),
      };
    }),
    abilitySlots: hull.abilitySlots,
    builtIn: { nodes: [...hull.builtIn.nodes], flags: [...hull.builtIn.flags] },
    landingSpeedMax: mod('ship.landing_speed_max', SHIP_BASELINE.landingSpeedMax),
    pulse: {
      fuelBurn: mod('ship.pulse_fuel_burn', METERS.charge.pulseBurnNearBodiesPerS),
      nearLimit: mod('ship.pulse_limit_near_bodies', 1),
    },
    hazardDamage,
  });
}
