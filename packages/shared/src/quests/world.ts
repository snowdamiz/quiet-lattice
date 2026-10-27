// What the quest engine hears from the world (ARCHITECTURE "Quests"): where the character is, and the events gameplay
// reports (a kill, a pickup, an interaction, a cutscene ending…). The server's quest runtime turns zone state and its
// systems' calls into these; the client's sandbox turns its own state into the same ones, so both ends advance quests
// with one engine. Places and positions are resolved here against a system's shared description and its worlds' shared
// city plans (planCities, the ground levelled under them), so the server and every client agree on where "the market of
// Belost" is.
import { cityFrame, cityPads, cityPoint, planCities, streetPlan, type City } from '../world/cities.ts';
import { TerrainSampler, type PlanetParams } from '../world/planetgen.ts';
import type { BodySpec, SystemDescription } from '../world/system.ts';
import { tierOfGalaxySystem } from '../world/tiers.ts';
import type { BodyRef, CityPlace, Place, QuestMoveMode, SystemRef, TargetId } from './schema.ts';

type Vec3 = [number, number, number];

/** Where a character is: its system, frame (wire frame id) and position in it, which body that frame is, its height above
 * that body's radius, whether it is above the body's atmosphere (or in no body's frame), and its movement mode. */
export interface AtInfo {
  system: number;
  frame: string | null;
  /** the body index of its frame, 'station' in the Waystation's, null in the system's inertial frame */
  body: number | 'station' | null;
  /** its body is the system's habitable world (the one the Waystation orbits) */
  home: boolean;
  pos: Vec3;
  /** metres above its body's radius; null outside a body's frame */
  alt: number | null;
  /** above its body's atmosphere, or in no body's frame */
  space: boolean;
  mode: QuestMoveMode;
}

/** A place resolved in a system: the frame its sphere is in, its centre there and its radius; on a world's ground, also
 * the ground's tangent frame there and the world's surface, for actors to stand on (`actorPosition`). */
export interface ResolvedPlace {
  system: number;
  frame: string | null;
  center: Vec3;
  radius: number;
  ground?: SurfaceFrame;
}

/** The ground round a place on a world: its up, east and north, and the radius of the world's ground in any direction. */
export interface SurfaceFrame {
  up: Vec3;
  east: Vec3;
  north: Vec3;
  surface(dir: Readonly<Vec3>): number;
}

/** The events quests advance on. `tick` comes from the runtime itself, a few times a second, with where the character is;
 * `held` whenever its inventory changes; the rest from the systems that see them happen. */
export type QuestWorldEvent =
  | { type: 'tick'; dt: number; at: AtInfo | null }
  | { type: 'held'; items: Readonly<Record<string, number>> }
  | { type: 'enter'; place: TargetId }
  | { type: 'interact'; target: TargetId }
  | { type: 'mine'; node: string; id?: string }
  | { type: 'analyze'; species: string }
  | { type: 'scan'; sites: readonly TargetId[] }
  | { type: 'kill'; tags: readonly string[]; entity?: number }
  | { type: 'wave'; cleared: number }
  | { type: 'defend_lost' }
  | { type: 'escort'; npc: TargetId; status: 'moving' | 'arrived' | 'lost'; progress?: number }
  | { type: 'delivered'; item: string; count: number; to: TargetId }
  | { type: 'died' }
  | { type: 'touch'; monolith: TargetId }
  | { type: 'cutscene_end'; cutscene: string };
export type QuestEventType = QuestWorldEvent['type'];

/** A system as the quest engine sees it: its galaxy index, shared description and tier (default: at the Edge's
 * starting place; the server passes the world service's, for rewards at tier). */
export interface QuestSystem {
  index: number;
  description: SystemDescription;
  tier?: number;
}

/** A system's tier as the quest engine takes it. */
export function questTier(system: QuestSystem): number {
  return system.tier ?? tierOfGalaxySystem(system.index);
}

/** The galaxy index a system reference names for a character in `current` whose home is `home` (null: any). */
export function systemIndexOf(ref: SystemRef | undefined, home: number): number | null {
  if (ref === undefined || ref === 'home') return home;
  if (ref === 'any') return null;
  return ref;
}

/** Whether a body reference names the body of frame `body` in its system (`home`: the system's habitable world). */
export function bodyMatches(ref: BodyRef, body: number | 'station' | null, description: Pick<SystemDescription, 'home'>): boolean {
  if (body === null) return false;
  if (ref === 'any') return body !== 'station';
  if (ref === 'station') return body === 'station';
  if (ref === 'home') return body === description.home;
  return body === ref;
}

/** Height of a body's air above its radius: its atmosphere's, else a twentieth of its radius (airless worlds, where the
 * client's own rule for being off the ground is 5% of the radius). */
export function atmosphereTop(body: Pick<BodySpec, 'radius' | 'params'>): number {
  const air = (body.params as { atmosphere?: { height: number } | null }).atmosphere;
  return air ? air.height : body.radius * 0.05;
}

/** Where a character is, from its wire pose (frame id, position in that frame) and mode, in system `system`. */
export function atInfo(system: QuestSystem, frame: string | null, pos: readonly number[], mode: QuestMoveMode): AtInfo {
  const p: Vec3 = [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0];
  const tail = frame === null ? null : frame.slice(frame.indexOf(':') + 1);
  const body = tail === null ? null : tail === 'station' ? 'station' : Number(tail);
  const spec = typeof body === 'number' ? system.description.bodies[body] : undefined;
  const alt = spec ? Math.hypot(p[0], p[1], p[2]) - spec.radius : null;
  return {
    system: system.index,
    frame,
    body,
    home: typeof body === 'number' && body === system.description.home,
    pos: p,
    alt,
    space: spec === undefined || alt! >= atmosphereTop(spec),
    mode,
  };
}

/** A place resolved in `system` for a character whose home system is `home`: null when the place is in another system,
 * names a body (or a city) the system does not have, or a city on a world without ground (a gas giant). */
export function resolvePlace(place: Place, system: QuestSystem, home: number): ResolvedPlace | null {
  const want = systemIndexOf(place.system, home);
  if (want !== null && want !== system.index) return null;
  const d = system.description;
  const seed = d.seed;
  let frame: string | null = null;
  let body: BodySpec | undefined;
  if (place.body === 'any') return null;
  if (place.body === 'station') frame = `${seed}:station`;
  else if (place.body !== null) {
    body = d.bodies[place.body === 'home' ? d.home : place.body];
    if (!body) return null;
    frame = `${seed}:${body.index}`;
  }
  if (place.city) return body ? cityPlace(place.city, place.radius, system, body, frame!) : null;
  let center: Vec3 = [0, 0, 0];
  if (place.pos) center = [...place.pos];
  else if (place.dir) {
    const [x, y, z] = place.dir;
    const k = ((body?.radius ?? 0) + (place.alt ?? 0)) / Math.hypot(x, y, z);
    center = [x * k, y * k, z * k];
  }
  return { system: system.index, frame, center, radius: place.radius };
}

/** Where an actor `offset` from a place's centre stands: on a world's ground, `offset` is metres east, up (above the
 * ground) and north of the centre, set down on the ground there; elsewhere it is the offset in the place's frame. */
export function actorPosition(place: ResolvedPlace, offset: Readonly<Vec3>): Vec3 {
  const c = place.center;
  const g = place.ground;
  if (!g) return [c[0] + offset[0], c[1] + offset[1], c[2] + offset[2]];
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) p[i] = c[i]! + g.east[i]! * offset[0] + g.north[i]! * offset[2];
  const len = Math.hypot(p[0], p[1], p[2]);
  const dir: Vec3 = [p[0] / len, p[1] / len, p[2] / len];
  const r = g.surface(dir) + offset[1];
  return [dir[0] * r, dir[1] * r, dir[2] * r];
}

// ---------- cities ----------

/** A world's cities and its ground levelled under them, as the shared plan makes them (drawnGround's first step; its
 * sites lie outside the cities, so within a city this is the ground every machine draws). */
export interface CityGround {
  cities: City[];
  sampler: TerrainSampler;
}

/** Each world's city ground, the few most recently used (planning one takes milliseconds to tens of them, once). */
const GROUNDS = new Map<string, CityGround>();
const GROUNDS_KEPT = 8;

/** A rocky world's cities and the ground levelled under them; null for a gas giant. */
export function cityGround(system: QuestSystem, body: BodySpec): CityGround | null {
  if (body.params.type === 'gas') return null;
  const key = `${system.description.seed}:${body.index}`;
  let g = GROUNDS.get(key);
  if (g) GROUNDS.delete(key);
  else {
    // (planned on the world's own natural ground: a copy of its params without pads)
    const params = clone(body.params as PlanetParams);
    delete params.pads;
    const sampler = new TerrainSampler(params);
    const cities = planCities(params, sampler);
    sampler.setPads(cityPads(cities));
    g = { cities, sampler };
  }
  GROUNDS.set(key, g);
  while (GROUNDS.size > GROUNDS_KEPT) GROUNDS.delete(GROUNDS.keys().next().value!);
  return g;
}

/** The point of a city's plan a city place names: its plaza, or its market (the trade post, on the plaza east of the
 * landmark: a plaza radius × 0.62 out, where the client's Cities draws it). */
function spotOf(city: City, spot: CityPlace['spot']): [number, number] {
  return spot === 'market' ? [streetPlan(city).plaza * 0.62, 0] : [0, 0];
}

function cityPlace(where: CityPlace, radius: number, system: QuestSystem, body: BodySpec, frame: string): ResolvedPlace | null {
  const ground = cityGround(system, body);
  const city = ground && (where.city === 'capital' ? (ground.cities.find((c) => c.capital) ?? ground.cities[0]) : ground.cities[where.city]);
  if (!ground || !city) return null;
  const R = body.radius;
  const f = cityFrame(city);
  const [su, sv] = spotOf(city, where.spot);
  const p = cityPoint(city, f, R, su + (where.u ?? 0), sv + (where.v ?? 0), 0);
  const surface = (dir: Readonly<Vec3>) => R + ground.sampler.height(dir[0], dir[1], dir[2]);
  const len = p.length();
  const dir: Vec3 = [p.x / len, p.y / len, p.z / len];
  const r = surface(dir);
  return {
    system: system.index,
    frame,
    center: [dir[0] * r, dir[1] * r, dir[2] * r],
    radius,
    ground: { up: dir, east: [f.east.x, f.east.y, f.east.z], north: [f.north.x, f.north.y, f.north.z], surface },
  };
}

/** A deep copy (shared code is typed without the DOM's or Node's structuredClone, which every engine it runs in has). */
function clone<T>(value: T): T {
  return (globalThis as unknown as { structuredClone<V>(v: V): V }).structuredClone(value);
}

/** Whether a character at `at` is inside a resolved place. */
export function inside(at: AtInfo, place: ResolvedPlace): boolean {
  if (at.system !== place.system || at.frame !== place.frame) return false;
  const dx = at.pos[0] - place.center[0];
  const dy = at.pos[1] - place.center[1];
  const dz = at.pos[2] - place.center[2];
  return dx * dx + dy * dy + dz * dz <= place.radius * place.radius;
}
