// The character state components Phase 1 has so far (docs/ARCHITECTURE.md §8), in load order: progress (level, xp and
// home system, in the row's columns), the skill web (P1.E07.T01, src/skills), the ship loadout, the inventory (its layout
// re-derived from the ship and the owned nodes on load), heat and Charge (P1.E07.T02, src/meters: their capacities from
// the ship and the owned nodes), where the character is (system, pose, frame and movement mode, read from its zone
// entity) and its quests (held by the quest runtime, P1.E09.T01); see ARCHITECTURE §8.
//
// Ships and progress have no service of their own yet, so the two small holders here keep each character's live value
// until the tasks that own them (P1.E12 ship swaps and fitting, combat XP) replace them with theirs.
import { applyLayout, inventorySchema, layoutFor, startingInventory, type Inventory } from '@astra/shared/inventory';
import { MoveMode, Pose } from '@astra/shared/protocol';
import { emptyQuestLog, migrateQuestLogV1, questLogProblem, questLogSchema, type QuestLog, type QuestLogV1 } from '@astra/shared/quests';
import { shipLoadoutSchema, shipStats, type ShipLoadout } from '@astra/shared/ships';
import type { SkillState } from '@astra/shared/skills';
import { z } from 'zod';
import { DEFAULT_LOADOUT, type InventoryService } from '../inventory/service.ts';
import { METERS, metersComponent } from '../meters/component.ts';
import { MeterService } from '../meters/service.ts';
import { SKILLS, skillsComponent } from '../skills/component.ts';
import { SkillService } from '../skills/service.ts';
import type { QuestRuntime } from '../quests/runtime.ts';
import { stationFrame, systemSeed } from '../world/home.ts';
import type { ZoneManager } from '../zones/manager.ts';
import { INPUT_LIMITS } from '../zones/zone.ts';
import { ComponentRegistry, type CharacterComponent, type LoadContext, type PersistenceLog } from './registry.ts';

export const PROGRESS = 'progress';
export { SKILLS };
export const SHIP = 'ship';
export const INVENTORY = 'inventory';
export { METERS };
export const POSE = 'pose';
export const QUESTS = 'quests';

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

/** The nodes a character owns, from its decoded skills (the skills component loads before the ship and the inventory). */
function ownedNodes(ctx: LoadContext): readonly string[] {
  return ctx.get<SkillState>(SKILLS).bought;
}

export function shipComponent(ships: ShipLoadouts): CharacterComponent<ShipLoadout | null> {
  return {
    key: SHIP,
    v: 1,
    schema: shipLoadoutSchema.nullable(),
    onInvalid: 'refuse',
    default: () => structuredClone(DEFAULT_SHIP),
    check: (ship, ctx) => {
      if (!ship) return null;
      try {
        // the pilot's nodes count: Pack Mule's cargo bay holds a pod
        shipStats(ship, { skills: ownedNodes(ctx) });
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
 * ship loadout and the owned nodes (the pods aboard, Pack Mule's stack cap), as DECISIONS P1.E06.T04 asks; a saved
 * inventory the new layout cannot hold keeps its saved layout and is logged.
 */
export function inventoryComponent(inventory: InventoryService, opts: { log?: PersistenceLog } = {}): CharacterComponent<Inventory> {
  return {
    key: INVENTORY,
    v: 1,
    schema: inventorySchema,
    onInvalid: 'refuse',
    default: (ctx) => startingInventory(layoutFor({ ship: ctx.get<ShipLoadout | null>(SHIP), skills: ownedNodes(ctx) })),
    load: (saved, ctx) => {
      const id = ctx.character.id;
      const r = applyLayout(saved, layoutFor({ ship: ctx.get<ShipLoadout | null>(SHIP), skills: ownedNodes(ctx) }));
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
});
export type PoseState = z.infer<typeof poseStateSchema>;

/** Docked at the home Waystation: where a new character starts, and where one whose saved pose is unusable goes. */
export function dockedAtHome(homeSystem: number): PoseState {
  return { system: homeSystem, pose: { frame: stationFrame(homeSystem), pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, mode: 'docked' };
}

/**
 * Why a saved pose cannot be used, or null: the system must exist, the frame must be one of its own (its bodies are
 * checked when the zone opens, ZoneManager.join), and the pose within the magnitudes a zone accepts (INPUT_LIMITS).
 * Terrain and station collision belong to movement authority (P1.E03.T04), which can extend this check.
 */
export function poseProblem(at: PoseState): string | null {
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
  return null;
}

/** Where the character is: read from its entity in its zone while in play; on load, the gateway places it there. */
export function poseComponent(zones: Pick<ZoneManager, 'zoneOf'>): CharacterComponent<PoseState> {
  return {
    key: POSE,
    v: 1,
    schema: poseStateSchema,
    onInvalid: 'default',
    default: (ctx) => dockedAtHome(ctx.character.homeSystem),
    check: poseProblem,
    save: ({ viewer }) => {
      const zone = viewer ? zones.zoneOf(viewer) : undefined;
      const id = viewer && zone?.entityOf(viewer);
      const e = id === undefined || id === null ? undefined : zone?.entity(id);
      if (!zone || !e) return undefined;
      const f = e.fields;
      return {
        system: zone.systemIndex,
        pose: { frame: f.frame, pos: [...f.pos], quat: [...f.quat], vel: [...f.vel] },
        mode: (f.mode ?? 'docked') as PoseState['mode'],
      };
    },
  };
}

// ---------- quests ----------

/**
 * The character's quests (DESIGN 14.1: quest id → its step and counters, what it has finished, its flags, rewards owed,
 * what was paid), held by the quest runtime while it is in play. v2 keeps steps by id (v1 kept indices, migrated through
 * the catalog). A catalog that no longer has a quest or a step is the runtime's to reconcile on load, never a refused
 * join; a state that cannot be right whatever the catalog says (questLogProblem), like an unreadable one, is refused
 * rather than replaced: it is earned.
 */
export function questsComponent(quests: QuestRuntime): CharacterComponent<QuestLog> {
  return {
    key: QUESTS,
    v: 2,
    schema: questLogSchema,
    migrations: { 1: (data) => migrateQuestLogV1(data as QuestLogV1, quests.catalog) },
    onInvalid: 'refuse',
    default: () => emptyQuestLog(),
    check: (log) => questLogProblem(log),
    load: (log, ctx) => quests.open(ctx.character, log),
    save: ({ characterId }) => quests.stateOf(characterId),
    unload: (characterId) => quests.close(characterId),
  };
}

// ---------- the registry ----------

export interface CoreComponentDeps {
  zones: Pick<ZoneManager, 'zoneOf'>;
  inventory: InventoryService;
  ships: ShipLoadouts;
  progress: CharacterProgress;
  /** The skill web's service; when none is given, one is made over this inventory, ships and progress (the gateway finds
   * it in the registry: `skillServiceIn`). */
  skills?: SkillService;
  /** Heat and Charge; when none is given, one is made over these ships, the skill service and the zones (the gateway finds
   * it in the registry: `meterServiceIn`). */
  meters?: MeterService;
  /** the quest runtime; without one (tests of the other components), no quests component */
  quests?: QuestRuntime;
  log?: PersistenceLog;
}

/** A registry holding Phase 1's components in load order: the skills read the level; the ship and the inventory read the
 * owned nodes; the inventory reads the ship; the meters read the ship and the owned nodes; the quests come last. */
export function coreRegistry(deps: CoreComponentDeps): ComponentRegistry {
  const skills = deps.skills ?? new SkillService({ inventory: deps.inventory, ships: deps.ships, progress: deps.progress });
  const meters = deps.meters ?? new MeterService({ ships: deps.ships, skills, zones: deps.zones });
  const registry = new ComponentRegistry()
    .register(progressComponent(deps.progress))
    .register(skillsComponent(skills, { log: deps.log }))
    .register(shipComponent(deps.ships))
    .register(inventoryComponent(deps.inventory, { log: deps.log }))
    .register(metersComponent(meters, { log: deps.log }))
    .register(poseComponent(deps.zones));
  return deps.quests ? registry.register(questsComponent(deps.quests)) : registry;
}
