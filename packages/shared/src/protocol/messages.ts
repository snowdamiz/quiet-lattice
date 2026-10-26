// Wire messages between client and server (docs/ARCHITECTURE.md §5). Control messages are JSON objects tagged by `t`;
// zone snapshots are binary (see snapshot.ts). Every message is a zod schema so both ends validate what they receive.
// Client → server schemas are the trust boundary: every string has a length cap and every number a finite range.
import { z } from 'zod';

/** Bumped whenever a message changes shape; the server refuses a client that speaks another version. */
export const PROTOCOL_VERSION = 1;

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
  .regex(/^\d{1,10}:(\d{1,3}|station)$/)
  .nullable();
export const Pose = z.object({ frame: FrameId, pos: Vec3, quat: Quat, vel: Velocity });
export type Vec3 = z.infer<typeof Vec3>;
export type Quat = z.infer<typeof Quat>;
export type FrameId = z.infer<typeof FrameId>;
export type Pose = z.infer<typeof Pose>;

export const EntityId = z.number().int().nonnegative().max(0xffffffff);
export const SystemSeed = z.number().int().nonnegative().max(0xffffffff);
const Id = z.string().min(1).max(64);
/** C0 controls, DEL, and the bidirectional embeddings, overrides and isolates (U+202A–202E, U+2066–2069). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]');
/** Free text a player typed: no control or bidirectional-override characters. */
const PlainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL.test(s), 'control characters are not allowed');

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
  homeSystem: z.number().int().nonnegative(),
});
export const CharacterList = z.object({ characters: z.array(CharacterSummary).max(16) });
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
/** `time` is the client's estimate of server time when the pose was sampled; the server never uses it for speed checks
 * (it measures elapsed time itself). The tag `t` is the message type, hence `time`. */
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
export const ChatChannel = z.enum(['shard', 'system', 'party']);
export const ChatSend = z.object({ t: z.literal('chat'), channel: ChatChannel, text: PlainText(280) });
export const Ack = z.object({ t: z.literal('ack'), tick: z.number().int().nonnegative() });
export const Ping = z.object({ t: z.literal('ping'), id: z.number().int().nonnegative(), clientTime: z.number().min(0).max(1e15) });

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Input, Cast, Interact, ChatSend, Ack, Ping]);
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
export const ChatEvent = z.object({
  kind: z.literal('chat'),
  channel: ChatChannel,
  from: z.string().max(32),
  text: z.string().max(280),
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
export const GameEvent = z.discriminatedUnion('kind', [CombatEvent, QuestEvent, ChatEvent, LootEvent, NoticeEvent]);
export const EventMessage = z.object({ t: z.literal('event'), event: GameEvent });

export const ServerMessage = z.discriminatedUnion('t', [Welcome, Refused, Correction, ZoneChange, Pong, WorldState, EventMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type GameEvent = z.infer<typeof GameEvent>;
