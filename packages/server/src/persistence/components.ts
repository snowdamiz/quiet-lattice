// The character state components Phase 1 has so far (docs/ARCHITECTURE.md §8), in load order: progress (level, xp and
// home system, in the row's columns), the ship loadout, the inventory (its layout re-derived from the ship on load) and
// where the character is (system, pose, frame and movement mode read from its zone entity, and on foot, where it left its
// ship; a saved pose movement authority would not accept is not restored). Skills (P1.E07.T01) and quests (P1.E09.T01)
// register theirs the same way; see ARCHITECTURE §8.
//
// Ships and progress have no service of their own yet, so the two small holders here keep each character's live value
// until the tasks that own them (P1.E12 ship swaps and fitting, combat XP) replace them with theirs.
import { applyLayout, inventorySchema, layoutFor, startingInventory, type Inventory } from '@astra/shared/inventory';
import { MoveMode, Pose } from '@astra/shared/protocol';
import { shipLoadoutSchema, shipStats, type ShipLoadout } from '@astra/shared/ships';
import { z } from 'zod';
import { DEFAULT_LOADOUT, type InventoryService } from '../inventory/service.ts';
import { padPose, poseProblem as movementProblem } from '../sim/movement/index.ts';
import type { ServerClock } from '../world/clock.ts';
import { stationFrame, systemSeed } from '../world/home.ts';
import type { ZoneManager } from '../zones/manager.ts';
import { describeZoneSystem } from '../zones/system.ts';
import { INPUT_LIMITS } from '../zones/zone.ts';
import { ComponentRegistry, type CharacterComponent, type PersistenceLog } from './registry.ts';

export const PROGRESS = 'progress';
export const SHIP = 'ship';
export const INVENTORY = 'inventory';
export const POSE = 'pose';

// ---------- progress: level, xp, home system ----------

export const progressSchema = z.strictObject({
  level: z.int().min(1).max(50),
  xp: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** Galaxy system index (DESIGN 5.1). */
  homeSystem: z.int().min(0).max(1023),
});
export type Progress = z.infer<typeof progressSchema>;

/** Each character in play's level, xp and home system. */
export class CharacterProgress {
  private readonly held = new Map<string, Progress>();

  get(characterId: string): Progress | undefined {
    return this.held.get(characterId);
  }

  set(characterId: string, progress: Progress): void {
    this.held.set(characterId, { ...progress });
  }

  delete(characterId: string): void {
    this.held.delete(characterId);
  }
}

export function progressComponent(progress: CharacterProgress): CharacterComponent<Progress> {
  return {
    key: PROGRESS,
    v: 1,
    schema: progressSchema,
    columns: { read: ({ level, xp, homeSystem }) => ({ level, xp, homeSystem }), write: ({ level, xp, homeSystem }) => ({ level, xp, homeSystem }) },
    onInvalid: 'refuse',
    default: (ctx) => ({ level: 1, xp: 0, homeSystem: ctx.character.homeSystem }),
    load: (value, ctx) => progress.set(ctx.character.id, value),
    save: ({ characterId }) => progress.get(characterId),
    unload: (characterId) => progress.delete(characterId),
  };
}

// ---------- the ship loadout ----------

/** Each character in play's ship, or null when it has none (the ship died and no other is flown yet). */
export class ShipLoadouts {
  private readonly held = new Map<string, ShipLoadout | null>();

  /** Undefined when the character is not held. */
  get(characterId: string): ShipLoadout | null | undefined {
    return this.held.get(characterId);
  }

  set(characterId: string, ship: ShipLoadout | null): void {
    this.held.set(characterId, ship && structuredClone(ship));
  }

  delete(characterId: string): void {
    this.held.delete(characterId);
  }
}

/** A new character's ship: the Lark (DESIGN 10.2), as the inventory's starting layout assumes. */
export const DEFAULT_SHIP: ShipLoadout = DEFAULT_LOADOUT.ship!;

export function shipComponent(ships: ShipLoadouts): CharacterComponent<ShipLoadout | null> {
  return {
    key: SHIP,
    v: 1,
    schema: shipLoadoutSchema.nullable(),
    onInvalid: 'refuse',
    default: () => structuredClone(DEFAULT_SHIP),
    check: (ship) => {
      if (!ship) return null;
      try {
        shipStats(ship);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    load: (ship, ctx) => ships.set(ctx.character.id, ship),
    save: ({ characterId }) => ships.get(characterId),
    unload: (characterId) => ships.delete(characterId),
  };
}

// ---------- the inventory ----------

/**
 * The inventory, held by the inventory service while the character is in play. On load its layout is re-derived from the
 * ship loadout (the pods aboard, the stack cap), as DECISIONS P1.E06.T04 asks; a saved inventory the new layout cannot
 * hold keeps its saved layout and is logged. Skills count for the stack cap once P1.E07.T01 registers them.
 */
export function inventoryComponent(inventory: InventoryService, opts: { log?: PersistenceLog } = {}): CharacterComponent<Inventory> {
  return {
    key: INVENTORY,
    v: 1,
    schema: inventorySchema,
    onInvalid: 'refuse',
    default: (ctx) => startingInventory(layoutFor({ ship: ctx.get<ShipLoadout | null>(SHIP) })),
    load: (saved, ctx) => {
      const id = ctx.character.id;
      const r = applyLayout(saved, layoutFor({ ship: ctx.get<ShipLoadout | null>(SHIP) }));
      if (!r.ok) ctx.warn({ error: r.error.code }, 'saved inventory does not fit its ship; keeping its saved layout');
      // What is stored is the truth: anything the service still holds for a character not in play is a leftover.
      if (inventory.close(id)) opts.log?.warn({ character: id }, 'inventory held for a character out of play; replaced by the stored one');
      inventory.open(id, { saved: r.ok ? r.inv : saved });
    },
    save: ({ characterId }) => inventory.get(characterId) ?? undefined,
    unload: (characterId) => void inventory.close(characterId),
  };
}

// ---------- where the character is ----------

export const poseStateSchema = z.strictObject({
  /** The galaxy system whose zone it is in. */
  system: z.int().min(0).max(1023),
  pose: Pose,
  mode: MoveMode,
  /** On foot: where its ship rests (landed or docked), the one ship it may board. */
  parked: Pose.optional(),
});
export type PoseState = z.infer<typeof poseStateSchema>;

/** Docked at the home Waystation: where a new character starts, and where one whose saved pose is unusable goes (the zone
 * docks it on whichever pad is free, ZoneManager.join). */
export function dockedAtHome(homeSystem: number): PoseState {
  return { system: homeSystem, pose: padPose(stationFrame(homeSystem), 0), mode: 'docked' };
}

/**
 * Why a saved pose cannot be used, or null: the system must exist, the frame must be one of its own, the pose within the
 * magnitudes a zone accepts (INPUT_LIMITS), and the pose somewhere movement authority would accept it in its mode at
 * server world time `now` (P1.E03.T04: its frame by the shared rule, not in the ground or the hangar's shell, landed on
 * dry ground, docked on a pad, on the pulse drive out of the air, on foot on the ground and with a ship of its own at
 * `parked` to board). `ship` is the ship it flies (the default Lark when it has none).
 */
export function poseProblem(at: PoseState, now: number, ship: ShipLoadout | null = null): string | null {
  let seed: number;
  try {
    seed = systemSeed(at.system);
  } catch {
    return `no system ${at.system}`;
  }
  const frame = at.pose.frame;
  if (frame !== null && Number(frame.split(':')[0]) !== seed) return `frame ${frame} is not in system ${at.system}`;
  if (Math.hypot(...at.pose.pos) > INPUT_LIMITS.maxDistance) return 'position out of range';
  if (Math.hypot(...at.pose.vel) > INPUT_LIMITS.maxSpeed) return 'velocity out of range';
  const v = movementProblem(describeZoneSystem(at.system), at.pose, at.mode, now, { ship: ship ?? DEFAULT_SHIP }, at.parked);
  return v ? `${v.rule}${v.detail ? `: ${v.detail}` : ''}` : null;
}

/** Where the character is: read from its entity in its zone while in play; on load, the gateway places it there, unless
 * movement authority would not accept it there (`clock` is the server's, for where the bodies are). */
export function poseComponent(zones: Pick<ZoneManager, 'zoneOf'>, clock: Pick<ServerClock, 'now'>): CharacterComponent<PoseState> {
  return {
    key: POSE,
    v: 2,
    // version 2 adds where a character on foot left its ship
    migrations: { 1: (data) => data },
    schema: poseStateSchema,
    onInvalid: 'default',
    default: (ctx) => dockedAtHome(ctx.character.homeSystem),
    check: (at, ctx) => poseProblem(at, clock.now(), ctx.get<ShipLoadout | null>(SHIP)),
    save: ({ viewer }) => {
      const zone = viewer ? zones.zoneOf(viewer) : undefined;
      const id = viewer && zone?.entityOf(viewer);
      const e = id === undefined || id === null ? undefined : zone?.entity(id);
      if (!zone || !e) return undefined;
      const f = e.fields;
      const mode = (f.mode ?? 'docked') as PoseState['mode'];
      const parked = mode === 'foot' ? zone.movement?.parkedOf(e.id) : null;
      return {
        system: zone.systemIndex,
        pose: { frame: f.frame, pos: [...f.pos], quat: [...f.quat], vel: [...f.vel] },
        mode,
        ...(parked ? { parked } : {}),
      };
    },
  };
}

// ---------- the registry ----------

export interface CoreComponentDeps {
  zones: Pick<ZoneManager, 'zoneOf'>;
  /** the server's clock (where the bodies are, for a saved pose's check) */
  clock: Pick<ServerClock, 'now'>;
  inventory: InventoryService;
  ships: ShipLoadouts;
  progress: CharacterProgress;
  log?: PersistenceLog;
}

/** A registry holding Phase 1's components in load order (the inventory reads the ship; skills and quests come after). */
export function coreRegistry(deps: CoreComponentDeps): ComponentRegistry {
  return new ComponentRegistry()
    .register(progressComponent(deps.progress))
    .register(shipComponent(deps.ships))
    .register(inventoryComponent(deps.inventory, { log: deps.log }))
    .register(poseComponent(deps.zones, deps.clock));
}
