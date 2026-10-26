// Zone snapshots (docs/ARCHITECTURE.md §5): a binary WebSocket frame whose first byte is the kind and whose rest is
// msgpack. Positions stay float64: in a system's inertial frame they reach 1e9 m, where float32 would lose tens of metres.
import { decode, encode } from '@msgpack/msgpack';
import { z } from 'zod';
import { EntityId, FrameId, Quat, Vec3 } from './messages.ts';

export const BinaryKind = { snapshot: 1 } as const;

export const EntityKind = z.enum(['player', 'ship', 'npc', 'mob', 'loot', 'pod', 'prop']);

/**
 * One entity's state. In a full snapshot every field is present; in a delta only `id` and the fields that changed since the
 * acknowledged snapshot.
 */
export const EntityState = z.object({
  id: EntityId,
  kind: EntityKind.optional(),
  frame: FrameId.optional(),
  pos: Vec3.optional(),
  quat: Quat.optional(),
  vel: Vec3.optional(),
  /** movement or behaviour state: 'ship', 'foot', 'idle', 'flee', 'attack' … */
  mode: z.string().max(16).optional(),
  /** display data, sent when first seen or when it changes */
  name: z.string().max(32).optional(),
  hull: z.string().max(24).optional(),
  people: z.string().max(12).optional(),
  species: z.number().int().optional(),
  level: z.number().int().min(1).max(50).optional(),
  hp: z.number().min(0).max(1).optional(),
  shield: z.number().min(0).max(1).optional(),
  heat: z.number().min(0).max(1).optional(),
  anim: z.number().int().nonnegative().optional(),
  owner: EntityId.optional(),
});

export const Snapshot = z.object({
  tick: z.number().int().nonnegative(),
  time: z.number(),
  /** the last input seq the server applied for this client, for reconciliation */
  ack: z.number().int().nonnegative(),
  /** true when this snapshot is not a delta (first one, or the client fell too far behind) */
  full: z.boolean(),
  entities: z.array(EntityState),
  removed: z.array(EntityId),
});
export type EntityKind = z.infer<typeof EntityKind>;
export type EntityState = z.infer<typeof EntityState>;
export type Snapshot = z.infer<typeof Snapshot>;

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const body = encode(s, { ignoreUndefined: true });
  const out = new Uint8Array(body.length + 1);
  out[0] = BinaryKind.snapshot;
  out.set(body, 1);
  return out;
}

/** Decodes and validates a binary frame; returns null for anything that is not a well-formed snapshot. */
export function decodeSnapshot(buf: Uint8Array): Snapshot | null {
  if (buf.length < 2 || buf[0] !== BinaryKind.snapshot) return null;
  let raw: unknown;
  try {
    raw = decode(buf.subarray(1));
  } catch {
    return null;
  }
  const r = Snapshot.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * The fields of `next` that differ from `prev` (always with the id); null when nothing changed. Vectors compare
 * element-wise with an epsilon so float noise does not resend a resting entity.
 */
export function diffEntity(prev: EntityState | undefined, next: EntityState, eps = 1e-4): EntityState | null {
  if (!prev) return next;
  const out: EntityState = { id: next.id };
  let changed = false;
  for (const key of Object.keys(next) as (keyof EntityState)[]) {
    if (key === 'id') continue;
    const a = prev[key];
    const b = next[key];
    if (!same(a, b, eps)) {
      (out as Record<string, unknown>)[key] = b;
      changed = true;
    }
  }
  return changed ? out : null;
}

/** Applies a delta onto a stored full state (in place) and returns it. */
export function applyEntityDelta(base: EntityState, delta: EntityState): EntityState {
  return Object.assign(base, delta);
}

function same(a: unknown, b: unknown, eps: number): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Math.abs((x as number) - (b[i] as number)) <= eps);
  return a === b;
}
