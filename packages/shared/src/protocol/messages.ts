// Wire messages between client and server (docs/ARCHITECTURE.md §5). Control messages are JSON objects tagged by `t`;
// zone snapshots are binary (see snapshot.ts). Every message is a zod schema so both ends validate what they receive.
// Client → server schemas are the trust boundary: every string has a length cap and every number a finite range.
import { z } from 'zod';
import { inventoryErrorCodeSchema, inventoryOpSchema, inventorySchema } from '../inventory/index.ts';

/** Bumped whenever a message changes shape; the server refuses a client that speaks another version. */
export const PROTOCOL_VERSION = 4;
// History. A branch that changes a message takes the next number and adds its line here (protocol.test.ts checks it):
// 1: the first protocol (P1.E02.T08)
// 2: inventory requests and state (P1.E06.T04)
// 3: social: chat and party requests, party state, denied, party news, chat lines held to the client's rules (P1.E15.T01)
// 4: creatures' attack field (P1.E08.T01)

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
/** `time` is the client's estimate of server time when the pose was sampled: movement authority judges the pose at that
 * time, bounded by the server's own clock (ARCHITECTURE §7). The tag `t` is the message type, hence `time`. */
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

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Input, Cast, Interact, ChatSend, PartyRequest, Ack, Ping, InventoryRequest]);
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

/** Why a chat message or party request was not carried out. */
export const DeniedCode = z.enum([
  /** this account sends chat or invites too fast; `retryS` */
  'rate',
  /** the shard channel (or the invitee's pending invites) is full right now; `retryS` when it is the channel */
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
  /** the inviter has gone (offline, in no party) */
  'gone',
]);
/** A chat message or party request the server did not carry out, sent to its sender only. `of` is what was asked. */
export const Denied = z.object({
  t: z.literal('denied'),
  of: z.enum(['chat', 'invite', 'accept', 'decline', 'leave', 'kick', 'promote']),
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

export const ServerMessage = z.discriminatedUnion('t', [
  Welcome,
  Refused,
  Correction,
  ZoneChange,
  Pong,
  WorldState,
  EventMessage,
  InventoryState,
  PartyState,
  Denied,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type GameEvent = z.infer<typeof GameEvent>;
