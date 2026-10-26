// Zone snapshots (docs/ARCHITECTURE.md §5): a binary WebSocket frame whose first byte is the kind and whose rest is
// msgpack. Positions stay float64: in a system's inertial frame they reach 1e9 m, where float32 would lose tens of metres.
//
// A delta snapshot names its baseline: the tick of the snapshot the client last acknowledged, which the server diffed
// against. The client keeps the states it was sent per tick, applies the delta onto `base`, and stores the result as
// `tick`. Each entity delta carries the changed fields and, in `clear`, the fields that no longer exist.
import { Encoder, decode } from '@msgpack/msgpack';
import { z } from 'zod';
import { EntityId, FrameId, PeopleId, Quat, Vec3, Velocity } from './messages.ts';

export const BinaryKind = { snapshot: 1 } as const;

export const EntityKind = z.enum(['player', 'ship', 'npc', 'mob', 'loot', 'pod', 'prop']);

const unit = z.number().min(0).max(1);

const fields = {
  kind: EntityKind,
  frame: FrameId,
  pos: Vec3,
  quat: Quat,
  vel: Velocity,
  /** movement state for players and ships ('ship', 'foot' …), behaviour state for mobs ('idle', 'flee', 'attack' …) */
  mode: z.string().max(16),
  /** display data, sent when first seen or when it changes */
  name: z.string().max(32),
  hull: z.string().max(24),
  people: PeopleId,
  species: z.number().int().nonnegative(),
  level: z.number().int().min(1).max(50),
  hp: unit,
  shield: unit,
  heat: unit,
  anim: z.number().int().nonnegative(),
  owner: EntityId,
};
export type EntityField = keyof typeof fields;
export const ENTITY_FIELDS = Object.keys(fields) as EntityField[];

/**
 * One entity's state. In a full snapshot every field the entity has is present; in a delta only `id`, the fields that
 * changed since the baseline, and `clear` listing fields that were removed.
 */
export const EntityState = z
  .object({
    id: EntityId,
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    clear: z
      .array(z.enum(ENTITY_FIELDS as [EntityField, ...EntityField[]]))
      .max(ENTITY_FIELDS.length)
      .optional(),
  })
  // a field is either set or cleared in one delta, never both
  .refine(
    (e) => !e.clear || e.clear.every((k) => (e as Record<string, unknown>)[k] === undefined),
    'a delta may not set and clear the same field',
  ) as unknown as z.ZodType<EntityState>;
export type EntityState = { id: number; clear?: EntityField[] } & { [K in EntityField]?: z.infer<(typeof fields)[K]> };

const Envelope = z.object({
  tick: z.number().int().nonnegative(),
  time: z.number(),
  /** the last input seq the server applied for this client, for reconciliation */
  ack: z.number().int().nonnegative(),
  /** true when this snapshot is not a delta (the first one, or the client fell too far behind) */
  full: z.boolean(),
  /** for a delta: the tick of the acknowledged snapshot it was diffed against */
  base: z.number().int().nonnegative().optional(),
  entities: z.array(z.unknown()).max(20000),
  removed: z.array(EntityId).max(20000),
});
export interface Snapshot {
  tick: number;
  time: number;
  ack: number;
  full: boolean;
  base?: number;
  entities: EntityState[];
  removed: number[];
}

const encoder = new Encoder({ ignoreUndefined: true });

/**
 * Encodes a snapshot. Entities are sanitised first: unit fields are clamped to [0, 1] and any non-finite number drops its
 * field (with the field listed in `dropped` for the caller to log), so one bad value never poisons a whole frame.
 */
export function encodeSnapshot(s: Snapshot, dropped: string[] = []): Uint8Array {
  if (!s.full && s.base === undefined) throw new Error('a delta snapshot needs its baseline tick');
  const clean = { ...s, entities: s.entities.map((e) => sanitizeEntity(e, dropped)) };
  const body = encoder.encode(clean);
  const out = new Uint8Array(body.length + 1);
  out[0] = BinaryKind.snapshot;
  out.set(body, 1);
  return out;
}

/** Decodes a binary frame. Returns null when the frame or its envelope is malformed; an entity that fails validation is
 * dropped on its own (its id goes to `rejected` when it has one) and the rest of the snapshot survives. The server's
 * encoder never produces such an entity; if a client still sees one it must not store or acknowledge that tick, and
 * keeps acknowledging its last good one so the next delta (or a full snapshot) repairs it. */
export function decodeSnapshot(buf: Uint8Array, rejected: number[] = []): Snapshot | null {
  if (buf.length < 2 || buf[0] !== BinaryKind.snapshot) return null;
  let raw: unknown;
  try {
    raw = decode(buf.subarray(1));
  } catch {
    return null;
  }
  const env = Envelope.safeParse(raw);
  if (!env.success) return null;
  if (!env.data.full && env.data.base === undefined) return null;
  const entities: EntityState[] = [];
  for (const e of env.data.entities) {
    const r = EntityState.safeParse(e);
    if (r.success) entities.push(r.data);
    else if (e && typeof e === 'object' && Number.isInteger((e as { id?: unknown }).id)) rejected.push((e as { id: number }).id);
  }
  return { ...env.data, entities };
}

function sanitizeEntity(e: EntityState, dropped: string[]): EntityState {
  // Only the listed fields go out (a wider server object never leaks), and each one is checked against its own schema:
  // a field the client would reject is dropped here and reported, rather than making the client drop the entity and
  // then acknowledge a tick it never fully applied.
  const out: Record<string, unknown> = { id: e.id };
  for (const k of ENTITY_FIELDS) {
    let v = e[k] as unknown;
    if (v === undefined) continue;
    if (k === 'hp' || k === 'shield' || k === 'heat') v = typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v;
    if (fields[k].safeParse(v).success) out[k] = v;
    else dropped.push(`${e.id}.${k}`);
  }
  if (e.clear?.length) out.clear = [...new Set(e.clear)].filter((k) => out[k] === undefined);
  return out as EntityState;
}

/**
 * The delta from `prev` to `next`: changed fields plus `clear` for fields `next` no longer has; null when nothing changed.
 * Numbers and number arrays compare with an epsilon so float noise does not resend a resting entity. The server must
 * diff against the state it last sent (not the true state), or slow motion under the epsilon would never be sent.
 */
export function diffEntity(prev: EntityState | undefined, next: EntityState, eps = 1e-4): EntityState | null {
  if (!prev) return clone(next);
  const out: EntityState = { id: next.id };
  let changed = false;
  for (const key of ENTITY_FIELDS) {
    const a = prev[key];
    const b = next[key];
    if (b === undefined) {
      if (a !== undefined) {
        (out.clear ??= []).push(key);
        changed = true;
      }
    } else if (!same(a, b, eps)) {
      (out as Record<string, unknown>)[key] = clone(b);
      changed = true;
    }
  }
  return changed ? out : null;
}

/** Returns `base` with `delta` applied, as a new object (stored states for other ticks are never mutated). */
export function applyEntityDelta(base: EntityState, delta: EntityState): EntityState {
  if (base.id !== delta.id) throw new Error(`delta for entity ${delta.id} applied to entity ${base.id}`);
  const out = clone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(delta)) if (k !== 'clear' && v !== undefined) out[k] = clone(v);
  for (const k of delta.clear ?? []) delete out[k];
  return out as EntityState;
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}

function same(a: unknown, b: unknown, eps: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps || a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i], eps));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], eps));
  }
  return a === b;
}
