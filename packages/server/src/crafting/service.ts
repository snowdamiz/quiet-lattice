// Fabricators (DESIGN 15.7; P1.E13.T05; ARCHITECTURE §23): a client asks to `make` a recipe at the station's or the
// ship's fabricator, or to `learn` one from its item, and the server checks the request cheapest first before anything
// changes:
// - its number (above the session's last), the character in play (its recipes and inventory held), its rate
//   (CRAFT_BURST at once, CRAFT_PER_S after; a refused request spends it too, so no client probes faster);
// - the recipe in the table (`unknown`), and for `make`: known (`not_known`); a recipe that fabricator makes in this
//   system (`fabricator`: a Waystation's its line's Tier 0–2 recipes, the ship's only ammo and cartridges, torpedoes
//   from Tier 2); the player where that fabricator is (`place`), as movement authority believes it (its zone entity's
//   frame, mode and position): the station's docked at the zone's Waystation, or on foot within reach of its fabricator
//   terminal (STATION_FABRICATOR); the ship's aboard its ship in any mode, or on foot beside the ship it left
//   (movement authority's `parkedOf`, within the boarding reach);
// - then the craft itself, all or nothing through the inventory service (`transact`): every material taken from the
//   suit and the cargo pods, the output added; short of a material (`materials`) or with no room for the output even
//   in the room the materials leave (`no_room`), nothing is used up.
// A `learn` needs no fabricator: the recipe not known yet (`known`: the item is kept) and its item held (`no_item`),
// which is used up as the recipe is written into the book for good.
//
// Crafting is instant (a choice, DECISIONS P1.E13.T05): nothing is held server-side between the request and the result,
// so a craft cannot be interrupted half-way, and the rate bounds it as the analyzer's is bounded.
import { craft, learn, makesAt, recipeById, type CraftRefusal, type FabricatorKind } from '@astra/shared/crafting';
import { STATION_FABRICATOR, WALKER } from '@astra/shared/data';
import { fail } from '@astra/shared/inventory';
import type { ClientMessage, Pose, ServerMessage } from '@astra/shared/protocol';
import { tierOfGalaxySystem, type Tier } from '@astra/shared/world';
import { TokenBucket } from '../gateway/rateLimit.ts';
import type { InventoryService } from '../inventory/service.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import type { RecipeBook } from './book.ts';

type CraftRequest = Extract<ClientMessage, { t: 'craft' }>;
type CraftState = Extract<ServerMessage, { t: 'craft' }>;
type Vec3 = readonly [number, number, number];

/** Requests a character may make at once, and a second after that (a request makes up to CRAFT_MAX crafts). */
export const CRAFT_BURST = 4;
export const CRAFT_PER_S = 2;
/** A character that has not asked for this long is forgotten (its rate), s. */
export const CRAFTER_IDLE_S = 600;
/** On foot, how far past the client's boarding reach (WALKER.boardRangeM) the ship's fabricator still answers, m. */
export const SHIP_FABRICATOR_SLACK_M = 5;

/** Modes in which the player is aboard its ship (movement authority's believed mode). */
const ABOARD: ReadonlySet<string> = new Set(['ship', 'pulse', 'landed', 'docked']);

/** A zone, as the crafting service uses it. */
export type CraftingZone = Pick<Zone, 'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity'> & {
  readonly movement: { parkedOf(id: number): Pose | null } | null;
};

/** Where the service finds a session's zone and a zone's tier (the ZoneManager). */
export interface CraftingZones {
  zoneOf(viewer: ZoneViewer): CraftingZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

export interface CraftingServiceOptions {
  zones: CraftingZones;
  inventory: InventoryService;
  /** every character in play's recipes (the `recipes` component's book) */
  book: RecipeBook;
  /** world time, s (the server clock) */
  now: () => number;
  log?: ZoneLog;
}

/** What the service has done, for tests and metrics. */
export interface CraftingStats {
  asked: number;
  made: number;
  learned: number;
  refused: Partial<Record<CraftRefusal, number>>;
}

export class CraftingService {
  private readonly zones: CraftingZones;
  private readonly inventory: InventoryService;
  private readonly book: RecipeBook;
  private readonly now: () => number;
  private readonly log?: ZoneLog;
  /** each session's last request number */
  private readonly lastSeq = new WeakMap<ZoneViewer, number>();
  /** each character's rate, and when it last asked */
  private readonly crafters = new Map<string, { bucket: TokenBucket; seen: number }>();
  private readonly counts: CraftingStats = { asked: 0, made: 0, learned: 0, refused: {} };
  private lastPrune = -Infinity;

  constructor(opts: CraftingServiceOptions) {
    this.zones = opts.zones;
    this.inventory = opts.inventory;
    this.book = opts.book;
    this.now = opts.now;
    this.log = opts.log;
  }

  stats(): CraftingStats {
    return { ...this.counts, refused: { ...this.counts.refused } };
  }

  /** The recipes a character in play knows, as the client is sent them (`recipes`), or null when it is not held. */
  recipes(characterId: string): Extract<ServerMessage, { t: 'recipes' }> | null {
    const k = this.book.get(characterId);
    return k ? { t: 'recipes', known: [...k.known] } : null;
  }

  /** A client's fabricator request, answered (see the header). After a `learned` answer the gateway sends the new
   * `recipes`. */
  craft(viewer: ZoneViewer, msg: CraftRequest): CraftState {
    const op = msg.op;
    const base = { t: 'craft' as const, seq: msg.seq, op: op.op, recipe: op.recipe };
    const refuse = (reason: CraftRefusal): CraftState => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return { ...base, result: 'refused', reason };
    };
    this.counts.asked++;
    if (msg.seq <= (this.lastSeq.get(viewer) ?? 0)) return refuse('stale_seq');
    this.lastSeq.set(viewer, msg.seq);
    const characterId = viewer.characterId;
    if (!characterId || !this.book.holds(characterId) || !this.inventory.get(characterId)) return refuse('zone');
    const now = this.now();
    if (!this.crafter(characterId, now).take(now * 1000)) return refuse('rate');
    const recipe = recipeById(op.recipe);
    if (!recipe) return refuse('unknown');

    if (op.op === 'learn') {
      if (this.book.knows(characterId, recipe.id)) return refuse('known');
      const known = this.book.get(characterId)!;
      // (the item is used up in the change the lesson is checked against, so it is never spent twice)
      const lesson: { refused?: 'unknown' | 'known' | 'no_item' } = {};
      this.inventory.transact(characterId, (inv) => {
        const l = learn(inv, known, recipe.id);
        if (l.ok) return { ok: true, inv: l.inv };
        lesson.refused = l.reason;
        return fail('not_enough', l.reason);
      });
      if (lesson.refused) return refuse(lesson.refused);
      this.book.learn(characterId, recipe.id);
      this.counts.learned++;
      this.log?.info({ character: characterId, recipe: recipe.id }, 'recipe learned');
      return { ...base, result: 'learned' };
    }

    if (!this.book.knows(characterId, recipe.id)) return refuse('not_known');
    const zone = this.zones.zoneOf(viewer);
    const self = zone?.entityOf(viewer);
    const player = zone && self !== undefined ? zone.entity(self) : undefined;
    if (!zone || self === undefined || !player) return refuse('zone');
    if (!makesAt(recipe, op.at, this.tierOf(zone))) return refuse('fabricator');
    if (!this.at(zone, self, player.fields, op.at)) return refuse('place');
    const result: { made?: { item: string; count: number }; refused?: 'materials' | 'no_room' } = {};
    this.inventory.transact(characterId, (inv) => {
      const c = craft(inv, recipe, op.count);
      if (!c.ok) {
        result.refused = c.reason;
        return fail(c.reason === 'no_room' ? 'no_room' : 'not_enough', c.reason);
      }
      result.made = { item: c.item, count: c.made };
      return { ok: true, inv: c.inv };
    });
    if (!result.made) return refuse(result.refused ?? 'materials');
    this.counts.made++;
    this.log?.debug({ character: characterId, zone: zone.id, recipe: recipe.id, at: op.at, count: op.count }, 'crafted');
    return { ...base, result: 'made', ...result.made };
  }

  /** Whether the player is where fabricator `at` is (see the header), as the zone believes it. */
  private at(zone: CraftingZone, self: number, f: { frame: string | null; pos: Vec3; mode?: string }, at: FabricatorKind): boolean {
    if (at === 'station') {
      if (f.frame !== `${zone.system.seed}:station`) return false;
      if (f.mode === 'docked') return true;
      const u = STATION_FABRICATOR.use;
      return f.mode === 'foot' && Math.hypot(f.pos[0] - u.x, f.pos[1] - u.y, f.pos[2] - u.z) <= STATION_FABRICATOR.reachM;
    }
    if (f.mode !== undefined && ABOARD.has(f.mode)) return true;
    if (f.mode !== 'foot') return false;
    const parked = zone.movement?.parkedOf(self);
    if (!parked || parked.frame !== f.frame) return false;
    const p = parked.pos;
    return Math.hypot(f.pos[0] - p[0], f.pos[1] - p[1], f.pos[2] - p[2]) <= WALKER.boardRangeM + SHIP_FABRICATOR_SLACK_M;
  }

  /** The zone's tier (the world service's, as the zone manager keeps it). */
  private tierOf(zone: CraftingZone): Tier {
    return this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex);
  }

  private crafter(characterId: string, now: number): TokenBucket {
    if (now - this.lastPrune >= 60) {
      this.lastPrune = now;
      for (const [id, c] of this.crafters) if (now - c.seen > CRAFTER_IDLE_S) this.crafters.delete(id);
    }
    let c = this.crafters.get(characterId);
    if (!c) this.crafters.set(characterId, (c = { bucket: new TokenBucket(CRAFT_BURST, CRAFT_PER_S, now * 1000), seen: now }));
    c.seen = now;
    return c.bucket;
  }
}
