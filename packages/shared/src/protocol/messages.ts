// Wire messages between client and server (docs/ARCHITECTURE.md §5). Control messages are JSON objects tagged by `t`;
// zone snapshots are binary (see snapshot.ts). Every message is a zod schema so both ends validate what they receive.
// Client → server schemas are the trust boundary: every string has a length cap and every number a finite range.
import { z } from 'zod';
import { inventoryErrorCodeSchema, inventoryOpSchema, inventorySchema } from '../inventory/index.ts';
import { questErrorCodeSchema, questIdSchema, questOpSchema, questViewSchema } from '../quests/schema.ts';
import { skillErrorCodeSchema, skillOpSchema, skillViewSchema } from '../skills/index.ts';

/** Bumped whenever a message changes shape; the server refuses a client that speaks another version. */
export const PROTOCOL_VERSION = 11;
// History. A branch that changes a message takes the next number and adds its line here (protocol.test.ts checks it):
// 1: the first protocol (P1.E02.T08)
// 2: inventory requests and state (P1.E06.T04)
// 3: social: chat and party requests, party state, denied, party news, chat lines held to the client's rules (P1.E15.T01)
// 4: creatures' attack field (P1.E08.T01)
// 5: skill web requests (unlock, buy, slot, unslot, respec) and skill state (P1.E07.T01)
// 6: cutscenes: request and done, play, ended and refused with the story phase (P1.E09.T04)
// 7: quests: quest requests (accept, abandon, choose) and quest state; a cutscene done says how it ended (P1.E09.T01)
// 8: mining: hits on resource nodes and their answers, and the nodes' state per cell (P1.E13.T01)
// 9: meters: heat and Charge state (P1.E07.T02)
// 10: combat: fire requests and their answers, combat events with the target's health, XP events (P1.E06.T02)
// 11: call-for-aid beacons: raise, lower, watch and answer; the shard's beacon list, beacon news, beacon refusals (P1.E15.T02)

/** Generous bounds that still keep NaN, Infinity and absurd magnitudes out (positions are metres in a body's frame or a
 * system's inertial frame; interstellar cruise runs far faster than light). */
const MAX_POS = 1e18;
const MAX_VEL = 1e16;
const coord = z.number().min(-MAX_POS).max(MAX_POS);
const speed = z.number().min(-MAX_VEL).max(MAX_VEL);

export const Vec3 = z.tuple([coord, coord, coord]);
export const Velocity = z.tuple([speed, speed, speed]);
/** A unit quaternion as [x, y, z, w]; anything far from unit length (or all zeros) is refused rather than normalised. */
export const Quat = z
  .tuple([z.number().min(-2).max(2), z.number().min(-2).max(2), z.number().min(-2).max(2), z.number().min(-2).max(2)])
  .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) < 0.01, 'quaternion must be unit length');
/** A non-zero direction (normalised by the receiver). */
export const Direction = z
  .tuple([z.number().min(-1e6).max(1e6), z.number().min(-1e6).max(1e6), z.number().min(-1e6).max(1e6)])
  .refine(([x, y, z]) => Math.hypot(x, y, z) > 1e-6, 'direction must be non-zero');
/** A body's frame: "<systemSeed>:<bodyIndex>", "<systemSeed>:station", or null for the system's inertial frame. */
export const FrameId = z
  .string()
  .regex(/^(0|[1-9]\d{0,9}):(0|[1-9]\d{0,2}|station)$/)
  .refine((f) => Number(f.split(':')[0]) <= 0xffffffff, 'system seeds are 32-bit')
  .nullable();
export const Pose = z.object({ frame: FrameId, pos: Vec3, quat: Quat, vel: Velocity });
export type Vec3 = z.infer<typeof Vec3>;
export type Quat = z.infer<typeof Quat>;
export type FrameId = z.infer<typeof FrameId>;
export type Pose = z.infer<typeof Pose>;

export const EntityId = z.number().int().nonnegative().max(0xffffffff);
export const SystemSeed = z.number().int().nonnegative().max(0xffffffff);
/** C0 and C1 controls, DEL, zero-width and directional marks, line and paragraph separators, the bidirectional
 * embeddings, overrides and isolates, and the byte-order mark. */
/* eslint-disable no-control-regex -- matching control characters is the point */
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\u2800\\u3164\\ufeff]');
/** As CONTROL, but letting the zero-width joiner and non-joiner through: emoji sequences and Persian text need them. */
const TEXT_CONTROL = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2060-\\u2069\\u2800\\u3164\\ufeff]',
);
/* eslint-enable no-control-regex */
/** A string capped in UTF-16 code units (zod counts code points, so emoji would otherwise double the cap). */
const capped = (max: number) => z.string().refine((s) => s.length <= max, `at most ${max} characters`);
const Id = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => !CONTROL.test(s), 'control characters are not allowed');
/** Free text a player typed: not blank, no control, invisible or direction-changing characters, capped in UTF-16 units. */
const PlainText = (max: number) =>
  capped(max)
    .refine((s) => s.replace(/[\u200c\u200d]/g, '').trim().length > 0, 'text may not be blank')
    .refine((s) => !TEXT_CONTROL.test(s), 'control characters are not allowed');

// ---------- HTTP: accounts and characters ----------

export const Username = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/);
export const Credentials = z.object({ username: Username, password: z.string().min(8).max(128) });
/** Usernames starting with this, in any case, belong to the server's dev login (P1.E03.T07): registering one is refused. */
export const DEV_USERNAME_PREFIX = 'dev-';
/** Whether a username is a dev login's (`dev-…`, any case), which registration refuses and only the dev login reaches. */
export function isDevUsername(username: string): boolean {
  return username.toLowerCase().startsWith(DEV_USERNAME_PREFIX);
}
export const AuthResponse = z.object({ token: z.string().max(4096), accountId: Id });

export const PeopleId = z.enum(['thalune', 'ixari', 'ulgani']);
/** Look choices within a people's palette (DESIGN 5.1): colour cells, crystal pattern or spore-frond colour (palette and
 * pattern indices, ranges owned by P1.E05.T05), head or crest variant (6) and suit set (4) per P1.E05.T01. */
export const CharacterLook = z.object({
  palette: z.number().int().min(0).max(15),
  pattern: z.number().int().min(0).max(15),
  head: z.number().int().min(0).max(5),
  suit: z.number().int().min(0).max(3),
});
/** Letters, single spaces, apostrophes and hyphens between letters. */
export const CharacterName = z
  .string()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z]+(?:[' -][A-Za-z]+)*$/);
export const CharacterCreate = z.object({ name: CharacterName, people: PeopleId, look: CharacterLook });
export const CharacterSummary = z.object({
  id: Id,
  name: CharacterName,
  people: PeopleId,
  look: CharacterLook,
  level: z.number().int().min(1).max(50),
  homeSystem: z.number().int().nonnegative().max(1023),
});
/** GET /characters: the account's characters and how many it may have. */
export const CharacterList = z
  .object({ characters: z.array(CharacterSummary).max(16), max: z.number().int().positive().max(16) })
  .refine((l) => l.characters.length <= l.max, 'more characters than the account may have');
export type Credentials = z.infer<typeof Credentials>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type PeopleId = z.infer<typeof PeopleId>;
export type CharacterLook = z.infer<typeof CharacterLook>;
export type CharacterCreate = z.infer<typeof CharacterCreate>;
export type CharacterSummary = z.infer<typeof CharacterSummary>;
export type CharacterList = z.infer<typeof CharacterList>;

// ---------- client → server ----------

/** Movement mode. From the client it is a prediction the server validates like the pose (ARCHITECTURE §7): sending
 * 'docked' does not dock you. */
export const MoveMode = z.enum(['ship', 'pulse', 'landed', 'foot', 'docked']);
/** Input buttons as a bitmask, so an input message stays small at 20 Hz. */
export const Buttons = {
  fire: 1 << 0,
  boost: 1 << 1,
  jet: 1 << 2,
  sprint: 1 << 3,
  beam: 1 << 4,
  interact: 1 << 5,
  up: 1 << 6,
  down: 1 << 7,
} as const;

/** The handshake. Its shape is frozen across protocol versions so an old client can always be told to reload
 * (see `peekVersion`). */
export const Hello = z.object({ t: z.literal('hello'), version: z.number().int(), token: z.string().min(1).max(4096) });
export const Join = z.object({ t: z.literal('join'), characterId: Id });
/** `time` is the client's estimate of server time when the pose was sampled: movement authority judges the pose and its
 * speed on it, crediting no more of it than really passed (ARCHITECTURE §7). A client steps it forward, never back, when
 * it falls more than a second behind; 0 (none) is judged on the input's arrival. The tag `t` is the message type, hence
 * `time`. */
export const Input = z.object({
  t: z.literal('input'),
  seq: z.number().int().nonnegative(),
  time: z.number().min(0).max(1e12),
  mode: MoveMode,
  pose: Pose,
  buttons: z.number().int().min(0).max(255),
  aim: Quat.optional(),
});
export const Cast = z.object({
  t: z.literal('cast'),
  seq: z.number().int().nonnegative(),
  slot: z.number().int().min(0).max(5),
  aim: Direction,
  target: EntityId.optional(),
});
export const Interact = z.object({ t: z.literal('interact'), target: Id });
/** Chat channels (DESIGN 16.6 "Social"): everyone on the shard, everyone in the sender's star system, the sender's party. */
export const ChatChannel = z.enum(['shard', 'system', 'party']);
/** The longest chat message, in UTF-16 units. */
export const CHAT_MAX = 280;
/** Chat text: not blank, no control, invisible or direction-changing characters (PlainText), at most CHAT_MAX units. */
export const ChatText = PlainText(CHAT_MAX);
export const ChatSend = z.object({ t: z.literal('chat'), channel: ChatChannel, text: ChatText });
/** The most characters one party holds (DESIGN is silent; P1.E15.T01). */
export const PARTY_MAX = 6;
/**
 * A party request. Other characters are named as a player types them (names are unique ignoring case): `invite` an
 * online character to your party (or to a new one you lead); `accept` or `decline` the invite `name` sent you; `leave`;
 * and, leader only, `kick` a member or `promote` one to leader.
 */
export const PartyOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('invite'), name: CharacterName }),
  z.object({ op: z.literal('accept'), name: CharacterName }),
  z.object({ op: z.literal('decline'), name: CharacterName }),
  z.object({ op: z.literal('leave') }),
  z.object({ op: z.literal('kick'), name: CharacterName }),
  z.object({ op: z.literal('promote'), name: CharacterName }),
]);
export const PartyRequest = z.object({ t: z.literal('party'), op: PartyOp });
export type PartyOp = z.infer<typeof PartyOp>;
export const Ack = z.object({ t: z.literal('ack'), tick: z.number().int().nonnegative() });
export const Ping = z.object({ t: z.literal('ping'), id: z.number().int().nonnegative(), clientTime: z.number().min(0).max(1e15) });
/** Inventory request (ARCHITECTURE §7): move, split, merge, transfer or compact stacks. The client applies the same shared op
 * to predict and the server answers with `inventory` state. `seq` numbers the session's requests from 1, increasing. */
export const InventoryRequest = z.object({ t: z.literal('inventory'), seq: z.number().int().min(1).max(0xffffffff), op: inventoryOpSchema });
/** Skill web request (ARCHITECTURE §7, §14): unlock with fragments, buy, slot, unslot or respec. The client applies the same
 * shared rule to predict and the server answers with `skills` state. `seq` numbers the session's requests from 1, increasing. */
export const SkillsRequest = z.object({ t: z.literal('skills'), seq: z.number().int().min(1).max(0xffffffff), op: skillOpSchema });

/** A cutscene's id: the file it was exported to (public/cutscenes/<id>.json) and the server's catalog key. */
export const CutsceneId = z.string().regex(/^[a-z0-9][a-z0-9_]{0,47}$/);
/** How a cutscene the server placed the player for ended (protocol 7): played to its end, skipped by the player, or given
 * back unplayed (`returned`: another cutscene was on screen, or the play came too late for a request the client gave up
 * on). A quest step ends on the first two, never on a give-back (ARCHITECTURE §17). */
export const CutsceneEnd = z.enum(['finished', 'skipped', 'returned']);
export type CutsceneEnd = z.infer<typeof CutsceneEnd>;
/** Cutscenes (protocol 6, ARCHITECTURE §15): `request` asks to play one where the player is, which the server
 * answers by placing the player in a story phase there; `done` says it ended, or was skipped, and (protocol 7) how:
 * `reason` (absent: `skipped` says finished or skipped). */
export const CutsceneRequest = z
  .object({
    t: z.literal('cutscene'),
    op: z.enum(['request', 'done']),
    id: CutsceneId,
    skipped: z.boolean().optional(),
    reason: CutsceneEnd.optional(),
  })
  .refine((m) => m.op === 'done' || (m.skipped === undefined && m.reason === undefined), 'only a done says how it ended')
  .refine((m) => m.reason === undefined || m.skipped === undefined || m.skipped === (m.reason !== 'finished'), 'skipped and reason agree');
/** Quest request (ARCHITECTURE §17): accept a quest on offer, abandon one, or answer the current dialogue or choice step.
 * `seq` numbers the session's requests from 1, increasing; the server answers each with `quests` state. */
export const QuestRequest = z.object({ t: z.literal('quest'), seq: z.number().int().min(1).max(0xffffffff), op: questOpSchema });

// ---------- resource nodes (P1.E13.T01, ARCHITECTURE §18) ----------

/** A world's frame: a planet or moon of the system (never the Waystation's, nor the inertial frame). */
export const WorldFrameId = z
  .string()
  .regex(/^(0|[1-9]\d{0,9}):(0|[1-9]\d{0,2})$/)
  .refine((f) => Number(f.split(':')[0]) <= 0xffffffff, 'system seeds are 32-bit');
/** A node's cell on its world: `<face>_<i>_<j>` (the shared spec's cell grid). */
export const NodeCellId = z.string().regex(/^[0-5]_(0|[1-9]\d{0,5})_(0|[1-9]\d{0,5})$/);
/** A node within its cell: `<type>_<k>`, its type and its candidate's number there. */
export const NodeInCell = z
  .string()
  .max(32)
  .regex(/^[a-z]+(?:_[a-z]+)*_(0|[1-9]\d{0,3})$/);
/** A resource node's id on its world (the shared spec's nodeKey): `<face>_<i>_<j>_<type>_<k>`. */
export const NodeId = z
  .string()
  .max(48)
  .regex(/^[0-5]_(0|[1-9]\d{0,5})_(0|[1-9]\d{0,5})_[a-z]+(?:_[a-z]+)*_(0|[1-9]\d{0,3})$/);
/** What mines: the multitool's beam, on foot. (Asteroids and the ship's Mining Laser are not nodes.) */
export const MiningTool = z.enum(['multitool']);
/** The common flora a beam harvests for carbon and ferrite (the client's flora scatter, not shared nodes): trees (a
 * crystal tree gives ferrite), the giant growths, shrubs, ferns, the crystal growths of bare worlds, boulders and rocks. */
export const FloraKind = z.enum(['tree', 'crystal_tree', 'giant', 'bush', 'fern', 'crystal', 'boulder', 'rock']);
/** The client's own key for one plant or rock of its flora. */
export const FloraRef = z.string().regex(/^[A-Za-z0-9_:.-]{1,48}$/);
/** A plant or rock of the client's flora: its kind, the client's key for it, and where it stands (planet-local m). */
export const FloraTarget = z.object({ kind: FloraKind, ref: FloraRef, at: Vec3 });
/**
 * A mining hit (ARCHITECTURE §18): the client's beam is on `node`, a resource node of the world `frame`, or on `flora`,
 * a plant or rock of its own flora there; sent every quarter second or so while the beam stays on it. The server
 * measures the beam's time itself (a hit is worth the time since the last one it took, at most half a second), checks
 * the player and the target and answers with `mine` state. `time` is the world time of the hit, which the server never
 * trusts for speed; a hit stamped seconds away from its clock (a stall's backlog) is refused. `seq` numbers the
 * session's hits from 1, increasing.
 */
export const MineRequest = z
  .object({
    t: z.literal('mine'),
    seq: z.number().int().min(1).max(0xffffffff),
    frame: WorldFrameId,
    node: NodeId.optional(),
    flora: FloraTarget.optional(),
    tool: MiningTool,
    time: z.number().min(0).max(1e12),
  })
  .refine((m) => (m.node === undefined) !== (m.flora === undefined), 'a hit is on a node or on flora');

// ---------- the call-for-aid beacon (P1.E15.T02, ARCHITECTURE §21) ----------

/** The most beacons the shard lists at once (DESIGN 16.6 "Social"); raising one past it is refused `busy`. */
export const BEACON_MAX = 256;
/** A beacon: unique on the shard, never reused while its server runs. */
export const BeaconId = z.number().int().min(1).max(0xffffffff);
/**
 * A beacon request (DESIGN 16.6 "Social"): `raise` a beacon for the instance you are in, which lists its open slots to the
 * whole shard; `lower` yours; `watch` the shard's beacons (the whole list at once, then its changes at most once a tick;
 * asking again while watching does nothing) or `unwatch` them; `answer` one, which puts you in its instance when the
 * server finds you may join it there and then.
 */
export const BeaconOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('raise') }),
  z.object({ op: z.literal('lower') }),
  z.object({ op: z.literal('watch') }),
  z.object({ op: z.literal('unwatch') }),
  z.object({ op: z.literal('answer'), id: BeaconId }),
]);
export const BeaconRequest = z.object({ t: z.literal('beacon'), op: BeaconOp });
export type BeaconOp = z.infer<typeof BeaconOp>;

export const ClientMessage = z.discriminatedUnion('t', [
  Hello,
  Join,
  Input,
  Cast,
  Interact,
  ChatSend,
  PartyRequest,
  Ack,
  Ping,
  InventoryRequest,
  SkillsRequest,
  CutsceneRequest,
  QuestRequest,
  MineRequest,
  BeaconRequest,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- server → client ----------

export const ZoneRef = z.object({ id: Id, systemSeed: SystemSeed });
export const Welcome = z.object({
  t: z.literal('welcome'),
  accountId: Id,
  character: CharacterSummary,
  entityId: EntityId,
  serverTime: z.number(),
  zone: ZoneRef,
  pose: Pose,
  mode: MoveMode,
});
export const RefusedCode = z.enum(['version', 'auth', 'character', 'full', 'invalid', 'kicked']);
export const Refused = z.object({ t: z.literal('refused'), code: RefusedCode, reason: z.string().max(280) });
/** The authoritative pose for the input `seq`; the client rewinds to it and replays later inputs. */
export const Correction = z.object({ t: z.literal('correction'), seq: z.number().int().nonnegative(), pose: Pose, mode: MoveMode });
/** Zone handoff (P1.E04.T04): the client now belongs to another zone, at this pose. */
export const ZoneChange = z.object({ t: z.literal('zone'), zone: ZoneRef, pose: Pose });
export const Pong = z.object({ t: z.literal('pong'), id: z.number().int().nonnegative(), clientTime: z.number(), serverTime: z.number() });
export const WorldState = z.object({
  t: z.literal('world'),
  season: z.number().int().nonnegative(),
  count: z.number().min(0).max(1000),
  edgeX: z.number(),
  /** tier (0–5) per galaxy system index */
  tiers: z.array(z.number().int().min(0).max(5)).max(1024),
  serverTime: z.number(),
});

export const CombatEvent = z.object({
  kind: z.literal('combat'),
  source: EntityId.nullable(),
  target: EntityId,
  amount: z.number().min(0).max(1e6),
  damageType: z.string().max(24),
  ability: z.string().max(48).optional(),
  killed: z.boolean(),
});
export const QuestEvent = z.object({
  kind: z.literal('quest'),
  questId: z.string().max(64),
  step: z.number().int().nonnegative(),
  status: z.enum(['offered', 'accepted', 'progress', 'step', 'completed', 'failed']),
  counters: z.record(z.string().max(48), z.number()).optional(),
});
/** A chat line as the server relays it: the sender's name as the server knows it, never as the client claimed. `at` is
 * world time. The text follows the same rules as the client's, so nothing the server relays can carry control
 * characters. */
export const ChatEvent = z.object({
  kind: z.literal('chat'),
  channel: ChatChannel,
  from: CharacterName,
  text: ChatText,
  at: z.number(),
});
export const LootEvent = z.object({
  kind: z.literal('loot'),
  item: z.string().max(48),
  count: z.number().int().positive(),
  from: EntityId.nullable(),
});
/** A toast for the player (docking granted, pulse drive interrupted …). */
export const NoticeEvent = z.object({ kind: z.literal('notice'), text: z.string().max(280), tone: z.enum(['info', 'good', 'warn']) });
/**
 * Party news, for the chat log and toasts; the party itself arrives as `party` state. `name` is the other character:
 * `invite` (it invites you; answer with accept or decline within the minute), `invited` (your invite reached it),
 * `declined` (it declined your invite), `expired` (an invite between you and it lapsed), `joined`, `left` (it left, or
 * its connection stayed down past the grace), `kicked` (by the leader; your own name when it was you), `leader` (it now
 * leads); `disbanded` (one member was left, so the party is gone) names nobody.
 */
export const PartyNews = z.enum(['invite', 'invited', 'declined', 'expired', 'joined', 'left', 'kicked', 'leader', 'disbanded']);
export const PartyEvent = z.object({ kind: z.literal('party'), what: PartyNews, name: CharacterName.optional() });
export const GameEvent = z.discriminatedUnion('kind', [CombatEvent, QuestEvent, ChatEvent, LootEvent, NoticeEvent, PartyEvent]);
export const EventMessage = z.object({ t: z.literal('event'), event: GameEvent });

/** One member as its party sees it: cheap on purpose (a party frame needs no more). */
export const PartyMember = z.object({
  name: CharacterName,
  /** connected; a member whose connection dropped keeps its place for a grace */
  online: z.boolean(),
  /** the galaxy system it is in; null while offline */
  system: z.number().int().nonnegative().max(1023).nullable(),
  /** health in tenths of full (0–10), coarse so it changes rarely; null while offline */
  health: z.number().int().min(0).max(10).nullable(),
});
export const PartyView = z
  .object({ leader: CharacterName, members: z.array(PartyMember).min(2).max(PARTY_MAX) })
  .refine((p) => p.members.some((m) => m.name === p.leader), 'the leader must be a member');
/**
 * The character's party (null: none), in join order: sent after `welcome`, to every online member whenever it changes
 * (members, leader, who is online, a member's system or coarse health), and null to one who leaves it.
 */
export const PartyState = z.object({ t: z.literal('party'), party: PartyView.nullable() });
export type PartyView = z.infer<typeof PartyView>;

/** Why a chat message, party request or beacon request was not carried out. */
export const DeniedCode = z.enum([
  /** this account sends chat, invites or beacons, or asks for the beacon list, too fast; `retryS` */
  'rate',
  /** the shard channel (or the invitee's pending invites, or the shard's beacons) is full right now; `retryS` when it is the channel */
  'busy',
  /** this account may not chat until `retryS` from now */
  'muted',
  /** system chat while in no zone */
  'no_zone',
  /** party chat or a party request while in no party */
  'no_party',
  /** kick or promote by a member who is not the leader */
  'not_leader',
  /** no character by that name is online */
  'not_found',
  /** the request names its own sender */
  'self',
  /** the invitee is in a party already (or, accepting, you are) */
  'in_party',
  /** the party has PARTY_MAX members */
  'party_full',
  /** an invite to that character from you is pending already */
  'pending',
  /** no invite from that character is pending */
  'no_invite',
  /** that character is not in your party */
  'not_member',
  /** promote names a member whose connection is down */
  'offline',
  /** the inviter has gone (offline, in no party); or a story beacon's caller is not in its instance just now */
  'gone',
  /** raising a beacon while in no instance */
  'no_phase',
  /** raising a beacon in an instance no beacon calls aid to (a hangar bay, a phase a cutscene plays in) */
  'kind',
  /** raising a beacon while yours (or one for your instance) is up already */
  'raised',
  /** no such beacon is up (it ended, or never was); lowering with none up */
  'unknown',
  /** answering a beacon from another star system */
  'elsewhere',
  /** answering a beacon from outside its instance's place: go there first */
  'far',
  /** answering a beacon while in an instance already */
  'in_phase',
  /** the instance has no open slot (raising, or answering) */
  'full',
]);
/** A chat message, party request or beacon request the server did not carry out, sent to its sender only. `of` is what
 * was asked (`raise`, `lower`, `answer` and `watch` are beacon requests; a `watch` is refused only for `rate`). */
export const Denied = z.object({
  t: z.literal('denied'),
  of: z.enum(['chat', 'invite', 'accept', 'decline', 'leave', 'kick', 'promote', 'raise', 'lower', 'answer', 'watch']),
  code: DeniedCode,
  /** seconds before asking again may succeed (rate, busy, muted) */
  retryS: z
    .number()
    .int()
    .min(1)
    .max(7 * 86400)
    .optional(),
  /** the character the request named */
  name: CharacterName.optional(),
});
export type DeniedCode = z.infer<typeof DeniedCode>;

/** The character's authoritative inventory: after join, in answer to every inventory request, and whenever the server
 * changes it (loot, mining, trade, the Recall). `seq` is the last request the server has handled this session (0: none);
 * the client drops its predictions up to it and replays the rest. `error` says why that request was refused. */
export const InventoryState = z.object({
  t: z.literal('inventory'),
  seq: z.number().int().min(0).max(0xffffffff),
  inventory: inventorySchema,
  error: inventoryErrorCodeSchema.optional(),
});

/** A cutscene's answer: `play` it now, in story phase `phase` (the client is in that phase until `ended`); `ended` when
 * the server has taken the player out of the phase; `refused` with why: `unknown` cutscene, `denied` (no quest step
 * plays it now), `cooldown` (asked again too soon), `busy` (another is playing), `place` (the player is not where it
 * plays), `phase` (the player is in another phase), `zone` (in no zone). The ops differ from the request's, so one
 * `cutscene` type serves both directions (encodeMessage). */
export const CutsceneState = z.object({
  t: z.literal('cutscene'),
  op: z.enum(['play', 'ended', 'refused']),
  id: CutsceneId,
  phase: z.number().int().positive().nullable(),
  reason: z.enum(['unknown', 'denied', 'cooldown', 'busy', 'place', 'phase', 'zone']).optional(),
});

/** The character's place on the skill web, with the level, ship slots and standing gates the rules read: after join, in
 * answer to every skills request, and whenever the server changes it (fragments, points, a trainer's unlock, a level).
 * `seq` and `error` work as `inventory`'s do. */
export const SkillsState = z.object({
  t: z.literal('skills'),
  seq: z.number().int().min(0).max(0xffffffff),
  skills: skillViewSchema,
  error: skillErrorCodeSchema.optional(),
});

/** The character's quest state: after join (`seq` 0), in answer to every quest request (`seq` the last one handled this
 * session, `error` why it was refused), and whenever the server moves a quest (`seq` unchanged). Always the whole state. */
export const QuestsState = z.object({
  t: z.literal('quests'),
  seq: z.number().int().min(0).max(0xffffffff),
  quests: questViewSchema,
  error: questErrorCodeSchema.optional(),
});

/** Why a mining hit did nothing: `stale_seq` (its number is not above the last), `rate` (hits too fast), `stale` (stamped
 * too far from the server's clock), `zone` (the player is in no zone), `mode` (not on foot), `world` (the frame is not the
 * world the player is on, or it has no nodes), `unknown` (no such node there, or no such flora on this world), `busy`
 * (the world's ground is still being planned: try again), `harvested` (it is waiting to grow back, or that plant was
 * harvested already), `range` (too far), `los` (the ground is in the way), `heat` (the multitool is overheated). */
export const MineRefusal = z.enum(['stale_seq', 'rate', 'stale', 'zone', 'mode', 'world', 'unknown', 'busy', 'harvested', 'range', 'los', 'heat']);
/**
 * A mining hit's answer, and a share of a node's yield: `hit` with `hp`, the fraction of the node (or plant) left (0–1);
 * `depleted` when it broke, with `item` and `count`, this character's share of its yield (by the damage it did; all of a
 * plant's) and `added`, what of it the inventory held (less when it was full); `refused` with `reason`, and nothing
 * changed. It names the node hit, or the client's key for the flora hit. `seq` is the hit answered, or 0 for a share of a
 * node another player broke. The fields differ from the request's, so one `mine` type serves both directions
 * (encodeMessage).
 */
export const MineState = z
  .object({
    t: z.literal('mine'),
    seq: z.number().int().min(0).max(0xffffffff),
    frame: WorldFrameId,
    node: NodeId.optional(),
    flora: FloraRef.optional(),
    result: z.enum(['hit', 'depleted', 'refused']),
    hp: z.number().min(0).max(1).optional(),
    reason: MineRefusal.optional(),
    item: z.string().max(48).optional(),
    count: z.number().int().min(0).max(1_000_000).optional(),
    added: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((m) => (m.node === undefined) !== (m.flora === undefined), 'an answer names the node or the flora hit')
  .refine((m) => (m.result === 'refused') === (m.reason !== undefined), 'a refusal, and only a refusal, says why')
  .refine((m) => (m.result === 'hit') === (m.hp !== undefined), 'a hit, and only a hit, says what is left')
  .refine(
    (m) => (m.result === 'depleted') === (m.item !== undefined && m.count !== undefined && m.added !== undefined) && (m.added ?? 0) <= (m.count ?? 0),
    'a depletion, and only a depletion, names the share and what of it was added',
  );
/** The state of one cell's touched nodes: those harvested and waiting to grow back (`gone`), and those damaged with the
 * fraction of each left (`hurt`). A cell with neither is as the scatter places it: the client forgets what it held. */
export const NodeCellState = z.object({
  cell: NodeCellId,
  gone: z.array(NodeInCell).max(128),
  hurt: z.array(z.tuple([NodeInCell, z.number().min(0).max(1)])).max(128),
});
/**
 * Resource nodes as the server holds them (ARCHITECTURE §18), for the cells round the player on world `frame`: pushed
 * whenever a cell in view changes, as one comes into view and (empty) as one is forgotten. `reset` starts the world over:
 * every cell the client held for it goes, and these are all it now holds (sent as the player arrives on a world).
 */
export const NodesState = z.object({
  t: z.literal('nodes'),
  frame: WorldFrameId,
  reset: z.boolean().optional(),
  cells: z.array(NodeCellState).max(128),
});

/** The instances a beacon calls aid to: a quest step's story phase (answering joins the caller's party), an event, a raid. */
export const BeaconKind = z.enum(['story', 'event', 'raid']);
/** What a beacon's place is called, as the server names it: plain text, at most 64 UTF-16 units. */
export const BeaconPlace = PlainText(64);
/**
 * A beacon as the shard sees it (ARCHITECTURE §21): its instance's kind, star system (galaxy index) and place (a sphere in
 * one of the system's frames, which answering needs you inside), what the place is called (a quest's title, an event's
 * site), who raised it, its open slots of `cap`, and the world times it was raised and lapses.
 */
export const BeaconView = z
  .object({
    id: BeaconId,
    kind: BeaconKind,
    system: z.number().int().nonnegative().max(1023),
    frame: FrameId,
    center: Vec3,
    radius: z.number().positive().max(MAX_POS),
    place: BeaconPlace,
    /** a story instance's quest */
    quest: questIdSchema.optional(),
    from: CharacterName,
    open: z.number().int().min(1).max(64),
    cap: z.number().int().min(2).max(64),
    at: z.number().min(0),
    until: z.number().min(0),
  })
  .refine((b) => b.open < b.cap, 'the caller holds a slot of its own')
  .refine((b) => b.until > b.at, 'a beacon lapses after it is raised');
export type BeaconView = z.infer<typeof BeaconView>;
/**
 * The shard's beacons, to a session that watches them: `reset` (sent as it starts watching) replaces whatever it held
 * with `beacons`; otherwise `beacons` are new or changed ones (their open slots) and `gone` the ids of those that ended.
 */
export const BeaconsState = z.object({
  t: z.literal('beacons'),
  reset: z.boolean().optional(),
  beacons: z.array(BeaconView).max(BEACON_MAX),
  gone: z.array(BeaconId).max(BEACON_MAX),
});
/** Why a beacon ended: its caller lowered it, its instance filled, closed or was left by the caller, or it lapsed. */
export const BeaconEnd = z.enum(['lowered', 'full', 'closed', 'left', 'expired']);
/**
 * Beacon news, to whom it concerns (refusals are `denied`): `raised` (your beacon is up, as `beacon`: when you raise it,
 * and again when your character enters the world while it is), `answered` (`name`
 * joined your instance through it), `joined` (your answer put you in its instance, phase `phase`), `ended` (your beacon
 * ended, and `why`). The fields differ from the request's, so one `beacon` type serves both directions (encodeMessage).
 */
export const BeaconNews = z
  .object({
    t: z.literal('beacon'),
    op: z.enum(['raised', 'answered', 'joined', 'ended']),
    id: BeaconId,
    beacon: BeaconView.optional(),
    name: CharacterName.optional(),
    phase: z.number().int().positive().optional(),
    why: BeaconEnd.optional(),
  })
  .refine(
    (m) => (m.op === 'raised') === (m.beacon !== undefined) && (m.beacon === undefined || m.beacon.id === m.id),
    'a raise, and only a raise, carries the beacon',
  )
  .refine((m) => (m.op === 'answered') === (m.name !== undefined), 'an answer, and only an answer, names who')
  .refine((m) => (m.op === 'joined') === (m.phase !== undefined), 'a join, and only a join, names the phase')
  .refine((m) => (m.op === 'ended') === (m.why !== undefined), 'an end, and only an end, says why');

export const ServerMessage = z.discriminatedUnion('t', [
  Welcome,
  Refused,
  Correction,
  ZoneChange,
  Pong,
  WorldState,
  EventMessage,
  InventoryState,
  SkillsState,
  PartyState,
  Denied,
  CutsceneState,
  QuestsState,
  MineState,
  NodesState,
  BeaconsState,
  BeaconNews,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type GameEvent = z.infer<typeof GameEvent>;
