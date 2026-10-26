// The cutscenes the server plays (DESIGN 8 "Cutscenes in-engine", 14.1 "Cutscenes are always instanced"; docs/
// ARCHITECTURE.md §14). Where each plays and what it spawns come from its .blend (assets/blend/cutscenes/), exported by
// packages/tools/blender/export_cutscene.py into placements/<id>.json beside this file: its space (the frame it is
// authored in and its anchor), its phase's radius and its actors, so the server and the client's cameras share one
// source. What a cutscene shows is the client's (public/cutscenes/<id>.json). Who may start one is the service's `may`
// (the quest engine's rule, P1.E09.T01); `dev` marks a cutscene a development server lets a client ask for by itself.
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const ID = /^[a-z0-9][a-z0-9_]{0,47}$/;
const num = z.number().finite();
const Vec3 = z.tuple([num, num, num]);
const Quat = z.tuple([num, num, num, num]).refine(([x, y, zz, w]) => Math.abs(Math.hypot(x, y, zz, w) - 1) < 1e-3, 'quaternion must be unit length');

const Actor = z.object({
  id: z.string().regex(ID),
  kind: z.enum(['npc', 'ship', 'prop']),
  name: z.string().min(1).max(32),
  hull: z.string().max(24).optional(),
  pos: Vec3,
  quat: Quat,
});

export const Placement = z.object({
  format: z.literal('astra.cutscene.place'),
  version: z.literal(1),
  id: z.string().regex(ID),
  source: z.string(),
  space: z
    .object({
      frame: z.string().regex(/^(station|player|inertial|home|body:(0|[1-9]\d{0,2}))$/),
      anchor: z.enum(['origin', 'player']),
    })
    .refine((s) => s.anchor === 'player' || (s.frame !== 'inertial' && s.frame !== 'player'), 'the inertial and player frames anchor on the player'),
  radius: z.number().min(10).max(50_000),
  actors: z.array(Actor).max(64),
});

export type CutsceneActor = z.infer<typeof Actor>;
export type CutscenePlacement = z.infer<typeof Placement>;

export interface CutsceneEntry {
  /** where it plays and what it spawns, as exported from its .blend */
  placement: CutscenePlacement;
  /** a development cutscene: a development server lets a client ask for it without a quest step */
  dev?: boolean;
}

/** The exported placement of cutscene `id` (placements/<id>.json), checked. */
export function loadPlacement(id: string): CutscenePlacement {
  if (!ID.test(id)) throw new RangeError(`no cutscene ${id}`);
  const raw: unknown = JSON.parse(readFileSync(new URL(`./placements/${id}.json`, import.meta.url), 'utf8'));
  const p = Placement.parse(raw);
  if (p.id !== id) throw new Error(`placements/${id}.json is cutscene ${p.id}`);
  return p;
}

export const CUTSCENES: Readonly<Record<string, CutsceneEntry>> = Object.freeze({
  // the pipeline's test (assets/blend/cutscenes/test_cutscene.blend): the Waystation hails a dark ship and sends a tug
  test: { placement: loadPlacement('test'), dev: true },
});
