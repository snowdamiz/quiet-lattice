// Wire messages between client and server (docs/ARCHITECTURE.md §5). Control messages are JSON objects tagged by `t`;
// zone snapshots are binary (see snapshot.ts). Every message is a zod schema so both ends validate what they receive.
import { z } from 'zod';

/** Bumped whenever a message changes shape; the server refuses a client that speaks another version. */
export const PROTOCOL_VERSION = 1;

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
/** A body's frame: "<systemSeed>:<bodyIndex>", "<systemSeed>:station", or null for the system's inertial frame. */
export const FrameId = z
  .string()
  .regex(/^\d+:(\d+|station)$/)
  .nullable();
export const Pose = z.object({ frame: FrameId, pos: Vec3, quat: Quat, vel: Vec3 });
export type Vec3 = z.infer<typeof Vec3>;
export type Quat = z.infer<typeof Quat>;
export type FrameId = z.infer<typeof FrameId>;
export type Pose = z.infer<typeof Pose>;

export const EntityId = z.number().int().nonnegative();

// ---------- HTTP: accounts and characters ----------

export const Username = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/);
export const Credentials = z.object({ username: Username, password: z.string().min(8).max(128) });
export const AuthResponse = z.object({ token: z.string(), accountId: z.string() });

export const PeopleId = z.enum(['thalune', 'ixari', 'ulgani']);
/** Look choices within a people's palette (DESIGN 5.1): colour cells, crystal pattern or spore-frond colour, head, suit. */
export const CharacterLook = z.object({
  palette: z.number().int().min(0).max(15),
  pattern: z.number().int().min(0).max(15),
  head: z.number().int().min(0).max(5),
  suit: z.number().int().min(0).max(3),
});
export const CharacterName = z
  .string()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z][A-Za-z' -]*[A-Za-z]$/);
export const CharacterCreate = z.object({ name: CharacterName, people: PeopleId, look: CharacterLook });
export const CharacterSummary = z.object({
  id: z.string(),
  name: CharacterName,
  people: PeopleId,
  look: CharacterLook,
  level: z.number().int().min(1).max(50),
  homeSystem: z.number().int().nonnegative(),
});
export type Credentials = z.infer<typeof Credentials>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type PeopleId = z.infer<typeof PeopleId>;
export type CharacterLook = z.infer<typeof CharacterLook>;
export type CharacterCreate = z.infer<typeof CharacterCreate>;
export type CharacterSummary = z.infer<typeof CharacterSummary>;

// ---------- client → server ----------

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

export const Hello = z.object({ t: z.literal('hello'), version: z.number().int(), token: z.string() });
export const Join = z.object({ t: z.literal('join'), characterId: z.string() });
export const Input = z.object({
  t: z.literal('input'),
  seq: z.number().int().nonnegative(),
  time: z.number(),
  mode: MoveMode,
  pose: Pose,
  buttons: z.number().int().nonnegative(),
  aim: Quat.optional(),
});
export const Cast = z.object({
  t: z.literal('cast'),
  seq: z.number().int().nonnegative(),
  slot: z.number().int().min(0).max(5),
  aim: Vec3,
  target: EntityId.optional(),
});
export const Interact = z.object({ t: z.literal('interact'), target: z.string().max(64) });
export const ChatChannel = z.enum(['shard', 'system', 'party']);
export const ChatSend = z.object({ t: z.literal('chat'), channel: ChatChannel, text: z.string().min(1).max(280) });
export const Ack = z.object({ t: z.literal('ack'), tick: z.number().int().nonnegative() });
export const Ping = z.object({ t: z.literal('ping'), id: z.number().int(), clientTime: z.number() });

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Input, Cast, Interact, ChatSend, Ack, Ping]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- server → client ----------

export const ZoneRef = z.object({ id: z.string(), systemSeed: z.number().int() });
export const Welcome = z.object({
  t: z.literal('welcome'),
  accountId: z.string(),
  character: CharacterSummary,
  entityId: EntityId,
  serverTime: z.number(),
  zone: ZoneRef,
  pose: Pose,
  mode: MoveMode,
});
export const RefusedCode = z.enum(['version', 'auth', 'character', 'full', 'invalid', 'kicked']);
export const Refused = z.object({ t: z.literal('refused'), code: RefusedCode, reason: z.string() });
export const Correction = z.object({ t: z.literal('correction'), seq: z.number().int().nonnegative(), pose: Pose, mode: MoveMode });
export const ZoneChange = z.object({ t: z.literal('zone'), zone: ZoneRef, pose: Pose });
export const Pong = z.object({ t: z.literal('pong'), id: z.number().int(), clientTime: z.number(), serverTime: z.number() });
export const WorldState = z.object({
  t: z.literal('world'),
  season: z.number().int().nonnegative(),
  count: z.number().min(0).max(1000),
  edgeX: z.number(),
  /** tier (0–5) per galaxy system index */
  tiers: z.array(z.number().int().min(0).max(5)),
  serverTime: z.number(),
});

export const CombatEvent = z.object({
  kind: z.literal('combat'),
  source: EntityId.nullable(),
  target: EntityId,
  amount: z.number(),
  damageType: z.string().max(24),
  ability: z.string().max(48).optional(),
  killed: z.boolean(),
});
export const QuestEvent = z.object({
  kind: z.literal('quest'),
  questId: z.string().max(64),
  step: z.number().int().nonnegative(),
  status: z.enum(['offered', 'accepted', 'progress', 'step', 'completed', 'failed']),
  counters: z.record(z.string(), z.number()).optional(),
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
  count: z.number().int(),
  from: EntityId.nullable(),
});
export const NoticeEvent = z.object({ kind: z.literal('notice'), text: z.string().max(280), tone: z.enum(['info', 'good', 'warn']) });
export const GameEvent = z.discriminatedUnion('kind', [CombatEvent, QuestEvent, ChatEvent, LootEvent, NoticeEvent]);
export const EventMessage = z.object({ t: z.literal('event'), event: GameEvent });

export const ServerMessage = z.discriminatedUnion('t', [Welcome, Refused, Correction, ZoneChange, Pong, WorldState, EventMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type GameEvent = z.infer<typeof GameEvent>;
