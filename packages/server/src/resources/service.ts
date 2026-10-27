// Resources on the server (DESIGN 15.3, 16.6 "Resources", 17; ARCHITECTURE §18): mining hits resolve here, and every
// player near a world's touched nodes is kept up to date with them.
//
// - Nodes are the shared spec's (`scatterNodes` over `drawnGround`, ARCHITECTURE §12): the server computes a cell's nodes
//   only when a hit names one of them (cached, a few thousand cells), and holds state only for nodes touched (nodes.ts):
//   their damage, who did it, and when they heal or grow back. Every player sees the same node state: shared per cell.
// - A hit (`mine {seq, frame, node | flora, tool, time}`) is checked cheapest first, so a client spamming far nodes costs
//   little: its number, the character's hit rate, its clock, the player (on foot, on that world), the id (a node type the
//   world carries, a cell within reach of the player) and only then the scatter (is there such a node, is it standing),
//   the range from the player's believed pose (its zone entity's: movement authority's, P1.E03.T04, once it lands) and a
//   coarse line of sight over the drawn ground. The beam's time is measured here: a hit is worth the time since the
//   character's last one, at most HIT_CREDIT_MAX_S, so however fast a client sends, it mines no faster than one beam held
//   on continuously (and Heat, P1.E07.T02, cuts that further through `beam`).
// - A node broken: its yield is rolled once and shared by the damage each character did (nobody's work is taken by a
//   last hit, and a crowd does not multiply it), each share scaled by that character's `mining.yield` and granted into
//   its inventory (what does not fit is reported, not kept); listeners (the quest engine's `mine` steps, P1.E09.T01) hear
//   each share; the node grows back after RESPAWN_S.
// - Common flora (trees, shrubs, ferns, crystal growths, rocks: carbon and ferrite) is each client's own scatter, not
//   shared: a hit on one names its kind, the client's key for it and where it stands; the server checks that the world
//   grows that kind, that it stands on the ground in reach and sight, and breaks it on the same measured beam time, then
//   grants its yield. Its place cannot be checked against a scatter the server does not have, but its rate is bounded as
//   a node's is, so carbon and ferrite are never the client's to grant (DECISIONS P1.E13.T01).
// - Players are told: every SWEEP_MS each session on a world is sent the state of the touched cells within NODE_VIEW_M of
//   it that it does not hold yet or that changed (`nodes`), an empty entry for one that went back to the scatter or that
//   it left behind (beyond NODE_FORGET_M), and `reset` as it arrives on a world, so what it holds is exactly what it was
//   sent. Nothing is sent to anyone while no node near them is touched.
import { applyStatMods, modsOfNodes } from '@astra/shared/combat';
import { getSkillNode } from '@astra/shared/data';
import { NodeCellState as NodeCellSchema, type ClientMessage, type ServerMessage } from '@astra/shared/protocol';
import {
  FLORA_HARVEST,
  floraGrows,
  frameId,
  hashInts,
  nodeCellCenter,
  nodeCellLevel,
  nodeCellMeters,
  nodeCellsNear,
  nodeType,
  parseNodeKey,
  planetNodeLayers,
  Random,
  scatterNodes,
  tierOfGalaxySystem,
  type NodeCell,
  type NodeGround,
  type NodeLayer,
  type NodeType,
  type PlanetParams,
  type ResourceNode,
  type Tier,
} from '@astra/shared/world';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { InventoryNotHeldError, type InventoryService } from '../inventory/service.ts';
import type { Zone, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { nodeGrounds, type NodeGroundSource } from './ground.ts';
import { lineOfSight } from './los.ts';
import { BUCKET_SHIFT, cellKey, NodeStore, RESPAWN_S, type CellState, type NodeState } from './nodes.ts';

type MineRequest = Extract<ClientMessage, { t: 'mine' }>;
type MineState = Extract<ServerMessage, { t: 'mine' }>;
type NodesState = Extract<ServerMessage, { t: 'nodes' }>;
type CellWire = NodesState['cells'][number];
export type MineRefusal = NonNullable<MineState['reason']>;
type FloraKind = keyof typeof FLORA_HARVEST;
type Vec3 = [number, number, number];

/** The multitool's mining power: hp a second of beam (the client's 1.6). */
export const MULTITOOL_POWER = 1.6;
/** Its power on minerals (deposits, formations, rocks) with a node that makes deposits break faster (Hot Hands, the
 * demo's Optical Drill: 2.4). */
export const FAST_BREAK = 1.5;
/** How far the beam reaches (the client's 30 m from the eye), m, and the slack the server allows past it for the node's
 * size, the eye's height and a pose a tick or two old at a sprint. */
export const MINE_RANGE_M = 30;
export const RANGE_SLACK_M = 5;
/** The eye's height above the walker's position, where the beam starts, m. */
export const EYE_M = 1.6;
/** How often an honest client sends a hit while its beam stays on, s, and the most beam time one hit is worth, s (twice
 * that, for jitter). */
export const HIT_INTERVAL_S = 0.25;
export const HIT_CREDIT_MAX_S = 0.5;
/** Hits a character may send at once, and a second after that; past it a hit is refused `rate` before anything else. */
export const HIT_BURST = 8;
export const HIT_PER_S = 8;
/** A hit stamped further than this from the server's clock is refused `stale`, s. */
export const HIT_STALE_S = 3;
/** Players are kept up to date with the touched cells within this of them (the client draws nodes to 420 m), m, until
 * they are this far from one; the cells round a player are worked out again once it has moved RESCAN_M. */
export const NODE_VIEW_M = 500;
export const NODE_FORGET_M = 600;
export const RESCAN_M = 32;
/** How often players are brought up to date and nodes heal or grow back, ms. */
export const SWEEP_MS = 250;
/** Cells whose scattered nodes are kept (over every world), most recently used. */
export const MAX_SCATTER_CELLS = 4096;
/** A flora target must stand within this of the ground under it, m (a giant growth's base is on it). */
export const FLORA_GROUND_M = 8;
/** Flora keys a character broke that are remembered, so the same plant is not broken twice. */
export const FLORA_REMEMBERED = 256;
/** A budget on flora per patch of ground, since its places cannot be checked: a character breaks at most
 * FLORA_HP_PER_PATCH hp of plants and rocks an hour (FLORA_PATCH_S) in any FLORA_PATCH_M-metre patch (a cube of the
 * world's space). Counted in hp, not plants, so naming giant growths or boulders buys nothing over rocks: every kind
 * gives about the same per hp (FLORA_HARVEST). The client's flora holds about 6 hp to a 10 m patch, up to about 18 in
 * a clump, so an honest player is never refused; one standing still and naming plants that are not there soon runs
 * dry. The patches of the last FLORA_PATCHES_KEPT are kept per character. */
export const FLORA_PATCH_M = 10;
export const FLORA_HP_PER_PATCH = 24;
export const FLORA_PATCH_S = 3600;
export const FLORA_PATCHES_KEPT = 128;
/** A character that has not mined for this long is forgotten (its rate, beam clock and flora), s: the flora budget's hour. */
export const MINER_IDLE_S = FLORA_PATCH_S;
/** Cells per `nodes` message (the schema's cap). */
export const CELLS_PER_MESSAGE = 128;

/** A zone, as the service uses it. */
export type ResourceZone = Pick<Zone, 'id' | 'systemIndex' | 'system' | 'entityOf' | 'entity' | 'viewers'>;

/** Where the service finds zones and their tiers (the ZoneManager). */
export interface ResourceZones {
  readonly zones: readonly ResourceZone[];
  zoneOf(viewer: ZoneViewer): ResourceZone | undefined;
  tier(zoneId: string): Tier | undefined;
}

/** A share of a broken node or plant, as listeners hear it. */
export interface MinedEvent {
  characterId: string;
  zone: string;
  frame: string;
  /** the node, or null for the client's flora */
  node: string | null;
  /** the node's type id, or the flora's kind */
  what: string;
  resource: string;
  /** this character's share (after its yield modifiers) and what of it its inventory took */
  count: number;
  added: number;
  /** whether this character's hit broke it */
  broke: boolean;
}
export type MinedListener = (e: MinedEvent) => void;

/**
 * A share as the quest engine's `mine` steps hear it (P1.E09.T01's `{type: 'mine', node, id}`): the node's type, and the
 * node itself on its world as the distinct thing mined, for a character whose damage earned it a share. Null for the
 * client's flora (carbon and ferrite count through `collect` steps, which read the inventory) and for a share of
 * nothing (a few thousandths of a node). Wired as `resources.subscribe((e) => { const q = questMineEvent(e); if (q)
 * quests.event(e.characterId, q); })`.
 */
export function questMineEvent(e: MinedEvent): { type: 'mine'; node: string; id: string } | null {
  if (e.node === null || e.count <= 0) return null;
  return { type: 'mine', node: e.what, id: `${e.frame}/${e.node}` };
}

export interface ResourceServiceOptions {
  zones: ResourceZones;
  inventory: Pick<InventoryService, 'grant'>;
  /** world time, s (the server clock) */
  now: () => number;
  /** the skill service, for `mining.yield` and faster-breaking nodes */
  skills?: { owned(characterId: string): readonly string[] };
  /** where worlds' node grounds come from: fauna's worker planner by default (one plan per world for both) */
  grounds?: NodeGroundSource;
  /** sends a session a message (by default the session's own send(), or for `nodes` its sendText() with the message
   * put together from cells each checked and encoded once) */
  notify?: (viewer: ZoneViewer, msg: ServerMessage) => void;
  log?: ZoneLog;
  /** Heat (P1.E07.T02's meter service): when given, the multitool fires only while it says the character's beam is
   * firing (the beam button held, on foot, out of the overheat lockout); `beam` asks it */
  meters?: { beamActive(characterId: string, now: number): boolean };
  /** seeds the yield rolls (tests) */
  seed?: number;
  /** touched nodes kept at most (MAX_NODE_STATES) */
  maxNodes?: number;
}

/** What the service has done, for tests, the bench and metrics. */
export interface ResourceStats {
  hits: number;
  refused: Partial<Record<MineRefusal, number>>;
  broken: number;
  /** cells scattered (each costs terrain samples) */
  scattered: number;
  losSamples: number;
  /** `nodes` messages sent */
  pushed: number;
  /** touched nodes held, and cells whose scatter is kept */
  nodes: number;
  scatterCells: number;
}

interface Miner {
  readonly bucket: TokenBucket;
  /** world time of its last hit that counted */
  lastBeam: number;
  /** world time of its last hit */
  lastSeen: number;
  /** the plant or rock it is breaking */
  flora: { ref: string; kind: FloraKind; hp: number } | null;
  /** the keys of the flora it broke lately, oldest first */
  readonly floraDone: Set<string>;
  /** the hp of flora broken per patch of ground (FLORA_PATCH_M), and when each patch's hour began */
  readonly floraPatches: Map<string, { hp: number; since: number }>;
}

interface View {
  frame: string;
  /** where the player was when `buckets` were worked out */
  at: Vec3 | null;
  /** it was further than NODE_VIEW_M above the ground there */
  high: boolean;
  /** the buckets of touched cells (nodes.ts) that may hold cells within NODE_VIEW_M of it */
  buckets: number[];
  /** what it holds: each cell sent, its id and the version sent */
  sent: Map<number, { id: string; version: number }>;
  /** a reset is due (it has just arrived on the world) */
  reset: boolean;
  /** its world's version when it last looked (0: the world had no touched nodes) */
  checked: number;
}

interface ViewerState {
  lastSeq: number;
  view: View | null;
}

/** A rocky world of a zone's system. */
interface World {
  frame: string;
  params: PlanetParams;
  R: number;
  level: number;
  cellM: number;
  /** its touched cells' buckets: their grid level and size, m */
  bucketLevel: number;
  bucketM: number;
  layers: Map<number, { list: NodeLayer[]; ids: Set<string> }>;
}

export class ResourceService {
  /** How long a broken node takes to grow back, s (RESPAWN_S by kind; tests and the dev CLI shorten it). */
  respawnSeconds: (type: NodeType) => number = (t) => RESPAWN_S[t.kind];
  /** Whether the multitool may fire `seconds` more for the character: with Heat's meters (`opts.meters`, P1.E07.T02),
   * only while they say its beam is firing (held, out of the lockout; Heat itself adds the beam's heat from the held
   * button); without them, always. */
  beam: (characterId: string, seconds: number) => boolean;
  readonly store: NodeStore;
  private readonly zones: ResourceZones;
  private readonly inventory: Pick<InventoryService, 'grant'>;
  private readonly now: () => number;
  private readonly skills?: ResourceServiceOptions['skills'];
  private readonly grounds: NodeGroundSource;
  private readonly notify: (viewer: ZoneViewer, msg: ServerMessage) => void;
  /** `nodes` go out as text put together from cells encoded once (no `notify` was given) */
  private readonly asText: boolean;
  private readonly log?: ZoneLog;
  private readonly rng: Random;
  private readonly listeners = new Set<MinedListener>();
  private readonly viewers = new WeakMap<ZoneViewer, ViewerState>();
  private readonly miners = new Map<string, Miner>();
  private readonly worlds = new Map<string, World | null>();
  private readonly scattered = new Map<string, ResourceNode[]>();
  /** each touched cell's state as sent, for the version it was worked out for */
  private readonly wires = new WeakMap<CellState, { version: number; wire: Wire }>();
  private readonly counts: Omit<ResourceStats, 'nodes' | 'scatterCells'> = { hits: 0, refused: {}, broken: 0, scattered: 0, losSamples: 0, pushed: 0 };
  private readonly los = { samples: 0 };
  private readonly scratch: Vec3 = [0, 0, 0];
  private timer: NodeJS.Timeout | null = null;
  private lastPrune = -Infinity;

  constructor(opts: ResourceServiceOptions) {
    this.zones = opts.zones;
    this.inventory = opts.inventory;
    this.now = opts.now;
    this.skills = opts.skills;
    this.grounds = opts.grounds ?? nodeGrounds;
    this.notify = opts.notify ?? ((viewer, msg) => (viewer as { send?: (m: ServerMessage) => void }).send?.(msg));
    this.asText = !opts.notify;
    this.log = opts.log;
    this.rng = new Random(opts.seed ?? hashInts(Date.now() & 0x7fffffff, process.pid));
    this.store = new NodeStore(opts.maxNodes);
    const meters = opts.meters;
    this.beam = meters
      ? (characterId) => {
          try {
            return meters.beamActive(characterId, this.now());
          } catch {
            // (a character the meters do not hold is not firing)
            return false;
          }
        }
      : () => true;
  }

  /** Listens to every share of every node or plant broken (the quest engine's `mine` steps). */
  subscribe(fn: MinedListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Starts bringing players up to date (and nodes back) every SWEEP_MS. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'resource sweep failed');
      }
    }, SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops (the planner is fauna's, which the process keeps). */
  async close(): Promise<void> {
    this.stop();
  }

  stats(): ResourceStats {
    return { ...this.counts, refused: { ...this.counts.refused }, losSamples: this.los.samples, nodes: this.store.size, scatterCells: this.scattered.size };
  }

  /** A touched node's state on a world, or undefined while it is as the scatter places it. */
  nodeState(frame: string, id: string): { hp: number; respawnAt: number | null; by: ReadonlyMap<string, number> } | undefined {
    const level = this.worldByFrame(frame)?.level;
    const ref = level === undefined ? null : parseNodeKey(id, level);
    const n = ref ? this.store.get(frame, ref.cell, `${ref.type}_${ref.k}`) : undefined;
    return n && { hp: n.hp, respawnAt: n.respawnAt, by: n.by };
  }

  // ---------- hits ----------

  /** A client's mining hit, answered (see the header). */
  mine(viewer: ZoneViewer, msg: MineRequest): MineState {
    const base =
      msg.node !== undefined
        ? { t: 'mine' as const, seq: msg.seq, frame: msg.frame, node: msg.node }
        : { t: 'mine' as const, seq: msg.seq, frame: msg.frame, flora: msg.flora!.ref };
    const refuse = (reason: MineRefusal): MineState => {
      this.counts.refused[reason] = (this.counts.refused[reason] ?? 0) + 1;
      return { ...base, result: 'refused', reason };
    };
    this.counts.hits++;
    const v = this.viewer(viewer);
    if (msg.seq <= v.lastSeq) return refuse('stale_seq');
    v.lastSeq = msg.seq;
    const characterId = viewer.characterId;
    if (!characterId) return refuse('zone');
    const now = this.now();
    const miner = this.miner(characterId, now);
    if (!miner.bucket.take(now * 1000)) return refuse('rate');
    if (!(Math.abs(msg.time - now) <= HIT_STALE_S)) return refuse('stale');
    const zone = this.zones.zoneOf(viewer);
    const entityId = zone?.entityOf(viewer);
    const e = zone && entityId !== undefined ? zone.entity(entityId) : undefined;
    if (!zone || !e) return refuse('zone');
    if (e.fields.mode !== 'foot') return refuse('mode');
    if (e.fields.frame !== msg.frame) return refuse('world');
    const world = this.worldOf(zone, msg.frame);
    if (!world) return refuse('world');
    const tier = this.tierOf(zone);
    const pos = e.fields.pos;
    let r: MineState | MineRefusal;
    if (msg.node !== undefined) r = this.hitNode(zone, world, tier, pos, characterId, miner, msg.node, now, base);
    else r = this.hitFlora(world, tier, pos, characterId, miner, msg.flora!, now, base, zone.id);
    return typeof r === 'string' ? refuse(r) : r;
  }

  private hitNode(
    zone: ResourceZone,
    world: World,
    tier: Tier,
    pos: Readonly<Vec3>,
    characterId: string,
    miner: Miner,
    id: string,
    now: number,
    base: Pick<MineState, 't' | 'seq' | 'frame' | 'node'>,
  ): MineState | MineRefusal {
    const layers = this.layersOf(world, tier);
    const ref = parseNodeKey(id, world.level);
    if (!ref || !layers.ids.has(ref.type)) return 'unknown';
    // a cell too far for any node in it to be in reach: refused before any terrain is sampled
    const c = nodeCellCenter(ref.cell, this.scratch);
    const r = Math.hypot(pos[0], pos[1], pos[2]);
    if (!(Math.hypot(pos[0] / r - c[0], pos[1] / r - c[1], pos[2] / r - c[2]) * world.R <= MINE_RANGE_M + RANGE_SLACK_M + world.cellM)) return 'range';
    const ground = this.grounds.ground(world.params, tier);
    if (!ground) return 'busy';
    const node = this.scatter(world, tier, layers.list, ground, ref.cell).find((n) => n.type === ref.type && n.k === ref.k);
    if (!node) return 'unknown';
    const sub = `${ref.type}_${ref.k}`;
    if (this.store.get(world.frame, ref.cell, sub)?.respawnAt != null) return 'harvested';
    const type = nodeType(ref.type);
    const up = type.place.sink + 0.5;
    const blocked = this.reach(ground, pos, [node.x + node.nx * up, node.y + node.ny * up, node.z + node.nz * up]);
    if (blocked) return blocked;
    const credit = this.credit(characterId, miner, now);
    if (credit === null) return 'heat';
    const n = this.store.touch(world.frame, world.params, ref.cell, type, ref.k, now);
    if (!this.store.damage(n, characterId, this.power(characterId, type.kind !== 'plant') * credit, now)) {
      return { ...base, result: 'hit', hp: n.hp / type.hp };
    }
    return this.harvest(zone, world, n, characterId, now, base);
  }

  /** The node broke: its yield, rolled once, shared by damage; it grows back after respawnSeconds. */
  private harvest(
    zone: ResourceZone,
    world: World,
    n: NodeState,
    breaker: string,
    now: number,
    base: Pick<MineState, 't' | 'seq' | 'frame' | 'node'>,
  ): MineState {
    const type = n.type;
    const shares = splitByDamage(this.rng.int(type.yield[0], type.yield[1]), [...n.by]);
    this.store.broke(n, now + this.respawnSeconds(type));
    this.counts.broken++;
    let mine = { count: 0, added: 0 };
    for (const [cid, share] of shares) {
      const got = this.grant(cid, type.resource, Math.round(share * this.yieldMult(cid)));
      this.emit({ characterId: cid, zone: zone.id, frame: world.frame, node: n.id, what: type.id, resource: type.resource, ...got, broke: cid === breaker });
      if (cid === breaker) mine = got;
      else this.tell(zone, cid, { t: 'mine', seq: 0, frame: world.frame, node: n.id, result: 'depleted', item: type.resource, ...got });
    }
    return { ...base, result: 'depleted', item: type.resource, ...mine };
  }

  private hitFlora(
    world: World,
    tier: Tier,
    pos: Readonly<Vec3>,
    characterId: string,
    miner: Miner,
    target: NonNullable<MineRequest['flora']>,
    now: number,
    base: Pick<MineState, 't' | 'seq' | 'frame' | 'flora'>,
    zoneId: string,
  ): MineState | MineRefusal {
    const kind = target.kind;
    const spec = FLORA_HARVEST[kind];
    if (!floraGrows(kind, world.params)) return 'unknown';
    if (miner.floraDone.has(target.ref)) return 'harvested';
    const at = target.at;
    const patch = this.patchOf(miner, at, now);
    if (patch.hp + spec.hp > FLORA_HP_PER_PATCH) return 'harvested';
    // within reach of the player before the ground is sampled
    if (!(Math.hypot(at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]) <= MINE_RANGE_M + RANGE_SLACK_M)) return 'range';
    const ground = this.grounds.ground(world.params, tier);
    if (!ground) return 'busy';
    const ar = Math.hypot(at[0], at[1], at[2]);
    if (!(Math.abs(ar - world.R - ground.sampler.height(at[0] / ar, at[1] / ar, at[2] / ar)) <= FLORA_GROUND_M)) return 'unknown';
    const blocked = this.reach(ground, pos, [at[0] + (at[0] / ar) * 1, at[1] + (at[1] / ar) * 1, at[2] + (at[2] / ar) * 1]);
    if (blocked) return blocked;
    const credit = this.credit(characterId, miner, now);
    if (credit === null) return 'heat';
    if (miner.flora?.ref !== target.ref || miner.flora.kind !== kind) miner.flora = { ref: target.ref, kind, hp: spec.hp };
    const f = miner.flora;
    f.hp -= this.power(characterId, spec.resource === 'ferrite') * credit;
    if (f.hp > spec.hp * 1e-9) return { ...base, result: 'hit', hp: f.hp / spec.hp };
    miner.flora = null;
    patch.hp += spec.hp;
    miner.floraDone.add(target.ref);
    if (miner.floraDone.size > FLORA_REMEMBERED) miner.floraDone.delete(miner.floraDone.values().next().value!);
    this.counts.broken++;
    const got = this.grant(characterId, spec.resource, Math.round(this.rng.int(spec.yield[0], spec.yield[1]) * this.yieldMult(characterId)));
    this.emit({ characterId, zone: zoneId, frame: world.frame, node: null, what: kind, resource: spec.resource, ...got, broke: true });
    return { ...base, result: 'depleted', item: spec.resource, ...got };
  }

  /** The hp of flora the character broke in the patch of ground holding `at`, its hour started over when it is past. */
  private patchOf(miner: Miner, at: Readonly<Vec3>, now: number): { hp: number; since: number } {
    const key = `${Math.floor(at[0] / FLORA_PATCH_M)}:${Math.floor(at[1] / FLORA_PATCH_M)}:${Math.floor(at[2] / FLORA_PATCH_M)}`;
    let p = miner.floraPatches.get(key);
    if (p && now - p.since >= FLORA_PATCH_S) {
      p.hp = 0;
      p.since = now;
    }
    if (!p) {
      miner.floraPatches.set(key, (p = { hp: 0, since: now }));
      if (miner.floraPatches.size > FLORA_PATCHES_KEPT) miner.floraPatches.delete(miner.floraPatches.keys().next().value!);
    }
    return p;
  }

  /** Whether the beam reaches `target` from the player's eye: in range, then in sight over the ground. */
  private reach(ground: NodeGround, pos: Readonly<Vec3>, target: Readonly<Vec3>): 'range' | 'los' | null {
    if (!(Math.hypot(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]) <= MINE_RANGE_M + RANGE_SLACK_M)) return 'range';
    const r = Math.hypot(pos[0], pos[1], pos[2]);
    const eye: Vec3 = [pos[0] + (pos[0] / r) * EYE_M, pos[1] + (pos[1] / r) * EYE_M, pos[2] + (pos[2] / r) * EYE_M];
    return lineOfSight(ground.sampler, eye, target, this.los) ? null : 'los';
  }

  /** The beam time this hit is worth (at most HIT_CREDIT_MAX_S since the last that counted), or null when the multitool
   * may not fire (Heat). */
  private credit(characterId: string, miner: Miner, now: number): number | null {
    const credit = Math.min(HIT_CREDIT_MAX_S, Math.max(0, now - miner.lastBeam));
    if (!this.beam(characterId, credit)) return null;
    miner.lastBeam = Math.max(miner.lastBeam, now);
    return credit;
  }

  private owned(characterId: string): readonly string[] {
    try {
      return this.skills?.owned(characterId) ?? [];
    } catch {
      return [];
    }
  }

  /** The character's `mining.yield` (Optical Drill, Hot Hands: ×1.5 each). */
  private yieldMult(characterId: string): number {
    return applyStatMods(1, 'mining.yield', modsOfNodes(this.owned(characterId)));
  }

  /** The beam's power for the character, on a mineral or not. */
  private power(characterId: string, mineral: boolean): number {
    const fast = mineral && this.owned(characterId).some((id) => getSkillNode(id).flags.includes('deposits_break_faster'));
    return MULTITOOL_POWER * (fast ? FAST_BREAK : 1);
  }

  /** Grants into the character's inventory; what did not fit (or a character no longer in play) is reported, not kept. */
  private grant(characterId: string, item: string, count: number): { count: number; added: number } {
    if (count <= 0) return { count: 0, added: 0 };
    try {
      const r = this.inventory.grant(characterId, item, count);
      if (!r.ok) this.log?.warn({ character: characterId, item, count, err: r.error.code }, 'mining grant refused');
      return { count, added: r.ok ? r.added : 0 };
    } catch (err) {
      if (!(err instanceof InventoryNotHeldError)) throw err;
      this.log?.debug({ character: characterId, item, count }, 'mining share for a character out of play; lost');
      return { count, added: 0 };
    }
  }

  private emit(e: MinedEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        this.log?.warn({ err: String(err) }, 'mining listener failed');
      }
    }
  }

  /** Sends a message to the session of a character in the zone, if it has one there. */
  private tell(zone: ResourceZone, characterId: string, msg: ServerMessage): void {
    for (const [viewer] of zone.viewers()) if (viewer.characterId === characterId) this.send(viewer, msg);
  }

  private send(viewer: ZoneViewer, msg: ServerMessage): void {
    try {
      this.notify(viewer, msg);
      if (msg.t === 'nodes') this.counts.pushed++;
    } catch (err) {
      this.log?.warn({ session: viewer.id, err: String(err) }, 'resource message not sent');
    }
  }

  // ---------- keeping players up to date ----------

  /** Heals and grows back the nodes due, and brings every player on a world up to date with the touched cells round it.
   * The timer calls it every SWEEP_MS; tests and the bench call it by hand. */
  sweep(): void {
    const now = this.now();
    this.store.advance(now);
    for (const zone of this.zones.zones) {
      let tier: Tier | undefined;
      for (const [viewer, entityId] of zone.viewers()) {
        const v = this.viewer(viewer);
        const f = zone.entity(entityId)?.fields;
        const world = f?.frame ? this.worldOf(zone, f.frame) : null;
        if (!f || !world) {
          v.view = null;
          continue;
        }
        this.look(viewer, v, world, (tier ??= this.tierOf(zone)), f.pos);
      }
    }
    if (now - this.lastPrune >= 10) {
      this.lastPrune = now;
      for (const [id, m] of this.miners) if (now - m.lastSeen > MINER_IDLE_S) this.miners.delete(id);
    }
  }

  /** Brings one player on a world up to date. */
  private look(viewer: ZoneViewer, v: ViewerState, world: World, tier: Tier, pos: Readonly<Vec3>): void {
    let view = v.view;
    if (!view || view.frame !== world.frame) {
      view = v.view = { frame: world.frame, at: null, high: false, buckets: [], sent: new Map(), reset: true, checked: -1 };
      // (its ground is wanted from the moment a player is on the world, so the first hit finds it ready)
      this.grounds.ground(world.params, tier);
    }
    const nodes = this.store.world(world.frame);
    // (a player whose world's touched nodes have not changed since it last looked, and who has not moved far, is done)
    const version = nodes?.version ?? 0;
    if (!nodes && !view.sent.size) {
      if (view.reset) this.sendNodes(viewer, world.frame, true, []);
      view.reset = false;
      view.checked = version;
      return;
    }
    const r = Math.hypot(pos[0], pos[1], pos[2]);
    if (!(r > 0)) return;
    const dir: Vec3 = [pos[0] / r, pos[1] / r, pos[2] / r];
    let moved = false;
    if (!view.at || Math.hypot(dir[0] - view.at[0], dir[1] - view.at[1], dir[2] - view.at[2]) * world.R > RESCAN_M) {
      const ground = this.grounds.ground(world.params, tier);
      if (!ground) return;
      view.at = dir;
      // high above the ground nothing is in view
      view.high = r - world.R - ground.sampler.height(dir[0], dir[1], dir[2]) > NODE_VIEW_M;
      view.buckets = view.high ? [] : nodeCellsNear(dir[0], dir[1], dir[2], NODE_VIEW_M + world.bucketM / 2, world.R, world.bucketLevel).map(cellKey);
      moved = true;
    }
    if (!moved && !view.reset && view.checked === version) return;
    view.checked = version;
    const out: Wire[] = [];
    const high = view.high;
    const far = (c: CellState, m: number) => high || Math.hypot(dir[0] - c.center[0], dir[1] - c.center[1], dir[2] - c.center[2]) * world.R > m;
    // touched cells come into view
    if (nodes) {
      for (const b of view.buckets) {
        for (const c of nodes.buckets.get(b) ?? []) {
          if (view.sent.has(c.key) || far(c, NODE_VIEW_M)) continue;
          out.push(this.cellState(c));
          view.sent.set(c.key, { id: c.id, version: c.version });
        }
      }
    }
    // those it holds change, go back to the scatter, or are left behind
    for (const [key, sent] of view.sent) {
      const c = nodes?.cells.get(key);
      if (!c || far(c, NODE_FORGET_M)) {
        out.push(wireOf({ cell: sent.id, gone: [], hurt: [] }));
        view.sent.delete(key);
      } else if (sent.version !== c.version) {
        out.push(this.cellState(c));
        sent.version = c.version;
      }
    }
    if (!out.length && !view.reset) return;
    for (let i = 0; i < out.length || (i === 0 && view.reset); i += CELLS_PER_MESSAGE) {
      this.sendNodes(viewer, world.frame, i === 0 && view.reset, out.slice(i, i + CELLS_PER_MESSAGE));
    }
    view.reset = false;
  }

  /** Sends a `nodes` message: as text put together from its cells' own checked encodings (Session.sendText, as a chat
   * line goes to many), or through `notify`. */
  private sendNodes(viewer: ZoneViewer, frame: string, reset: boolean, cells: readonly Wire[]): void {
    const sendText = this.asText ? (viewer as { sendText?: (text: string) => void }).sendText : undefined;
    if (!sendText) {
      const msg: NodesState = { t: 'nodes', frame, cells: cells.map((c) => c.state) };
      if (reset) msg.reset = true;
      return this.send(viewer, msg);
    }
    try {
      sendText.call(viewer, `{"t":"nodes","frame":${JSON.stringify(frame)}${reset ? ',"reset":true' : ''},"cells":[${cells.map((c) => c.text).join(',')}]}`);
      this.counts.pushed++;
    } catch (err) {
      this.log?.warn({ session: viewer.id, err: String(err) }, 'resource message not sent');
    }
  }

  /** A cell's state as players are sent it, worked out (and checked and encoded) once for each of its versions. */
  private cellState(c: CellState): Wire {
    const known = this.wires.get(c);
    if (known?.version === c.version) return known.wire;
    const gone: string[] = [];
    const hurt: [string, number][] = [];
    for (const n of c.nodes.values()) {
      if (n.respawnAt !== null) gone.push(n.sub);
      else if (n.shown < 1) hurt.push([n.sub, n.shown]);
    }
    let wire: Wire;
    try {
      wire = wireOf({ cell: c.id, gone: gone.slice(0, 128), hurt: hurt.slice(0, 128) });
    } catch (err) {
      // (a server bug: the cell is sent as the scatter has it rather than holding up everyone's updates)
      this.log?.warn({ cell: c.id, err: String(err) }, 'node cell not sent');
      wire = wireOf({ cell: c.id, gone: [], hurt: [] });
    }
    this.wires.set(c, { version: c.version, wire });
    return wire;
  }

  // ---------- worlds, cells and characters ----------

  private viewer(viewer: ZoneViewer): ViewerState {
    let v = this.viewers.get(viewer);
    if (!v) this.viewers.set(viewer, (v = { lastSeq: 0, view: null }));
    return v;
  }

  private miner(characterId: string, now: number): Miner {
    let m = this.miners.get(characterId);
    if (!m) {
      m = {
        bucket: new TokenBucket(HIT_BURST, HIT_PER_S, now * 1000),
        lastBeam: now - HIT_INTERVAL_S,
        lastSeen: now,
        flora: null,
        floraDone: new Set(),
        floraPatches: new Map(),
      };
      this.miners.set(characterId, m);
    }
    m.lastSeen = now;
    return m;
  }

  private tierOf(zone: ResourceZone): Tier {
    return this.zones.tier(zone.id) ?? tierOfGalaxySystem(zone.systemIndex);
  }

  /** The rocky world a frame of the zone's system names, or null (the Waystation's, a gas giant, another system's). */
  private worldOf(zone: ResourceZone, frame: string): World | null {
    const known = this.worlds.get(frame);
    if (known !== undefined) return known;
    const [seed, index] = frame.split(':').map(Number) as [number, number];
    const body = seed === zone.system.seed ? zone.system.bodies[index] : undefined;
    let world: World | null = null;
    if (body && body.type !== 'gas' && frameId(seed, body.index) === frame) {
      const params = body.params as PlanetParams;
      const level = nodeCellLevel(params.radius);
      const bucketLevel = Math.max(0, level - BUCKET_SHIFT);
      world = {
        frame,
        params,
        R: params.radius,
        level,
        cellM: nodeCellMeters(params.radius, level),
        bucketLevel,
        bucketM: nodeCellMeters(params.radius, bucketLevel),
        layers: new Map(),
      };
    }
    this.worlds.set(frame, world);
    return world;
  }

  private worldByFrame(frame: string): World | undefined {
    return this.worlds.get(frame) ?? undefined;
  }

  private layersOf(world: World, tier: Tier): { list: NodeLayer[]; ids: Set<string> } {
    let l = world.layers.get(tier);
    if (!l) {
      const list = planetNodeLayers(world.params, tier);
      world.layers.set(tier, (l = { list, ids: new Set(list.map((x) => x.type)) }));
    }
    return l;
  }

  /** A cell's nodes, scattered once and kept (MAX_SCATTER_CELLS, most recently used). */
  private scatter(world: World, tier: Tier, layers: readonly NodeLayer[], ground: NodeGround, cell: NodeCell): ResourceNode[] {
    const key = `${world.frame}:${tier}:${cellKey(cell)}`;
    let nodes = this.scattered.get(key);
    if (nodes) {
      this.scattered.delete(key);
    } else {
      nodes = scatterNodes(ground, layers, cell);
      this.counts.scattered++;
      if (this.scattered.size >= MAX_SCATTER_CELLS) this.scattered.delete(this.scattered.keys().next().value!);
    }
    this.scattered.set(key, nodes);
    return nodes;
  }
}

/** A cell's state and its encoding, checked against the protocol's schema (the server never sends what a client would
 * refuse; ARCHITECTURE §5). */
interface Wire {
  state: CellWire;
  text: string;
}

function wireOf(state: CellWire): Wire {
  const r = NodeCellSchema.safeParse(state);
  if (!r.success) throw new Error(`refusing to send an invalid node cell ${JSON.stringify(state)}: ${r.error.message}`);
  return { state: r.data, text: JSON.stringify(r.data) };
}

/** Remainders closer than this are a tie (the damage behind them sums hits in floating point). */
const SPLIT_EPS = 1e-9;

/** `total` split by each one's damage, in whole units: largest remainders first, then the order given (remainders within
 * SPLIT_EPS of each other are equal, so float noise in the damage never decides who gets a unit). */
export function splitByDamage(total: number, parts: readonly (readonly [string, number])[]): Map<string, number> {
  const out = new Map<string, number>();
  const live = parts.filter(([, d]) => d > 0);
  const sum = live.reduce((s, [, d]) => s + d, 0);
  if (!(sum > 0)) return out;
  let given = 0;
  const rest: { id: string; frac: number; i: number }[] = [];
  live.forEach(([id, d], i) => {
    const exact = (total * d) / sum;
    const whole = Math.min(total - given, Math.floor(exact + SPLIT_EPS));
    out.set(id, whole);
    given += whole;
    rest.push({ id, frac: Math.max(0, exact - whole), i });
  });
  rest.sort((a, b) => (Math.abs(b.frac - a.frac) > SPLIT_EPS ? b.frac - a.frac : a.i - b.i));
  for (let k = 0; given < total && k < rest.length; k++, given++) out.set(rest[k]!.id, out.get(rest[k]!.id)! + 1);
  return out;
}
