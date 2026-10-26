// The phase manager (DESIGN 17 "Phases are first class", 14.1, 16.6; docs/ARCHITECTURE.md §6.1): a zone's private
// layers at shared places. A phase is opened at a location (a key naming the place, and a sphere in one of the system's
// frames, which moves with it) for a kind with a cap (kinds.ts), filled by presence and closed once it has no members.
//
// Every entity in a zone has a phase or none (the shared world). Members are sessions' players placed by phaseFor; a
// phase's own entities (its actors: NPCs, bosses, props) are spawned through it and go with it when it closes. What a
// session sees is decided here (visibleTo, which the zone applies to every interest set):
// - everything in the shared world and in its own phase;
// - never another phase's own entities;
// - another phase's players unless either is sealed: a member is sealed while inside its phase's volume, in a phase whose
//   kind isolates players (a bay, an event, a raid). A sealed member sees no player outside its phase, the shared
//   world's included, and none of them sees it; a story phase's members stay in sight of everyone.
// A member who leaves the volume goes back to the shared world after the kind's grace period (coming back before then
// keeps its place); one whose entity leaves the zone goes at once.
//
// Party membership is the zone's party tag until the party system (P1.E15.T01): a story phase holds one party, and
// placement puts a player in a party member's phase at that place whenever it has room.
import type { FrameId } from '@astra/shared/protocol';
import type { EntityInit, ZoneEntity, ZoneLog, ZoneViewer } from '../zones/zone.ts';
import { PHASE_KINDS, PHASE_VOLUME_HYSTERESIS, type PhaseKind } from './kinds.ts';

type Vec3 = [number, number, number];

/** A shared place to open phases at. Phases of one kind at one key are reused and filled together. */
export interface PhaseLocation {
  /** names the place (a quest step's site, a Waystation's hangar), 1–128 characters */
  key: string;
  /** the frame the volume is in and moves with */
  frame: FrameId;
  /** the volume's centre in that frame, metres */
  center: Vec3;
  /** the volume's radius, metres */
  radius: number;
}

export interface Phase {
  /** unique in its zone, never reused */
  readonly id: number;
  readonly kind: PhaseKind;
  readonly location: Readonly<PhaseLocation>;
  /** world time it opened */
  readonly opened: number;
  /** false once it has closed */
  readonly open: boolean;
  /** its members: sessions' player entities */
  readonly members: ReadonlySet<number>;
  /** its own entities, which only its members see */
  readonly entities: ReadonlySet<number>;
}

/** What a phase manager needs of its zone. */
export interface PhaseZone {
  readonly id: string;
  /** world time of the last tick */
  readonly time: number;
  entity(id: number): ZoneEntity | undefined;
  entityOf(viewer: ZoneViewer): number | undefined;
  hasFrame(frame: FrameId): boolean;
  toWorld(frame: FrameId, pos: Readonly<Vec3>): Vec3;
  spawn(init: EntityInit): number;
  despawn(id: number): boolean;
}

/** Why a member left: it asked to, went to another phase, stayed outside the volume past the grace, or left the zone. */
type LeaveReason = 'left' | 'moved' | 'outside' | 'despawned';

class PhaseState implements Phase {
  open = true;
  readonly members = new Set<number>();
  readonly entities = new Set<number>();
  /** the volume's centre in world coordinates at the last tick */
  center: Vec3 = [0, 0, 0];

  constructor(
    readonly id: number,
    readonly kind: PhaseKind,
    readonly location: Readonly<PhaseLocation>,
    readonly opened: number,
  ) {}

  get place(): string {
    return placeKey(this.kind, this.location.key);
  }
}

/** An entity in a phase. */
interface Placement {
  readonly phase: PhaseState;
  /** a member (a session's player) rather than one of the phase's own entities */
  readonly member: boolean;
  /** inside the volume as of the last tick, with hysteresis; a new member counts as inside until the next tick */
  inside: boolean;
  /** world time it was first outside the volume; null while inside */
  outsideSince: number | null;
}

export class PhaseManager {
  private readonly phases = new Map<number, PhaseState>();
  /** open phases by kind and location key, oldest first */
  private readonly byPlace = new Map<string, Set<PhaseState>>();
  /** every entity in a phase, members and phases' own entities alike; anything else is in the shared world */
  private readonly placed = new Map<number, Placement>();
  private nextId = 1;

  constructor(
    private readonly zone: PhaseZone,
    private readonly log?: ZoneLog,
  ) {}

  /** Open phases. */
  get count(): number {
    return this.phases.size;
  }

  phase(id: number): Phase | undefined {
    return this.phases.get(id);
  }

  /** Every open phase, oldest first. */
  all(): IterableIterator<Phase> {
    return this.phases.values();
  }

  /** The id of the entity's phase, or null when it is in the shared world. */
  phaseOf(entity: number): number | null {
    return this.placed.get(entity)?.phase.id ?? null;
  }

  /**
   * Puts the session's player in a phase of `kind` at `location` and returns it: the one it is already in there; else a
   * party member's that has room; else the fullest that has room (the oldest of equals); else a new one. It leaves any
   * other phase it was in. `partyId` defaults to the entity's party tag; a player in no party fills a story phase alone.
   */
  phaseFor(viewer: ZoneViewer, kind: PhaseKind, location: PhaseLocation, partyId?: string | null): Phase {
    if (!Object.hasOwn(PHASE_KINDS, kind)) throw new RangeError(`unknown phase kind ${String(kind)}`);
    this.checkLocation(location);
    const id = this.zone.entityOf(viewer);
    if (id === undefined) throw new Error(`session ${viewer.id} is not in zone ${this.zone.id}`);
    const party = partyId === undefined ? this.zone.entity(id)!.party : partyId;

    const current = this.placed.get(id);
    if (current?.member && current.phase.kind === kind && current.phase.location.key === location.key) return current.phase;

    const candidates = this.byPlace.get(placeKey(kind, location.key)) ?? new Set<PhaseState>();
    let chosen: PhaseState | undefined;
    if (party !== null) {
      for (const p of candidates) {
        if (this.admits(p, party) && this.hasPartyMember(p, party)) {
          chosen = p;
          break;
        }
      }
    }
    if (!chosen) {
      for (const p of candidates) if (this.admits(p, party) && (!chosen || p.members.size > chosen.members.size)) chosen = p;
    }
    chosen ??= this.openPhase(kind, location);

    if (current) this.detach(id, current, 'moved');
    chosen.members.add(id);
    this.placed.set(id, { phase: chosen, member: true, inside: true, outsideSince: null });
    this.log?.debug({ zone: this.zone.id, phase: chosen.id, kind, location: location.key, entity: id, members: chosen.members.size }, 'phase member joined');
    return chosen;
  }

  /** Takes the session's player out of its phase, back to the shared world. False when it was in none. */
  leave(viewer: ZoneViewer): boolean {
    const id = this.zone.entityOf(viewer);
    const p = id === undefined ? undefined : this.placed.get(id);
    if (!p?.member) return false;
    this.detach(id!, p, 'left');
    return true;
  }

  /** Spawns one of the phase's own entities, which only its members see and which goes when it closes. */
  spawn(phaseId: number, init: EntityInit): number {
    const phase = this.phases.get(phaseId);
    if (!phase) throw new Error(`no open phase ${phaseId} in zone ${this.zone.id}`);
    const id = this.zone.spawn(init);
    phase.entities.add(id);
    this.placed.set(id, { phase, member: false, inside: true, outsideSince: null });
    return id;
  }

  /** Closes the phase now: its members go back to the shared world and its own entities are despawned. */
  close(phaseId: number): boolean {
    const phase = this.phases.get(phaseId);
    if (!phase) return false;
    this.shut(phase, 'closed');
    return true;
  }

  /** Whether the session whose entity is `viewer` may see entity `id`, phases considered (not distance). */
  canSee(viewer: number, id: number): boolean {
    return id === viewer || this.sees(this.placed.get(viewer), id);
  }

  // ---------- the zone's hooks ----------

  /**
   * Each tick, once every entity's world position is current: who is inside its phase's volume, and who has been
   * outside for longer than the grace.
   */
  update(time: number): void {
    if (this.phases.size === 0) return;
    for (const phase of [...this.phases.values()]) {
      const { frame, center, radius } = phase.location;
      phase.center = this.zone.toWorld(frame, center);
      const enter2 = radius ** 2;
      const exit2 = (radius * PHASE_VOLUME_HYSTERESIS) ** 2;
      const grace = PHASE_KINDS[phase.kind].graceS;
      let expired: number[] | undefined;
      for (const id of phase.members) {
        const p = this.placed.get(id)!;
        const w = this.zone.entity(id)!.world;
        const d2 = (w[0] - phase.center[0]) ** 2 + (w[1] - phase.center[1]) ** 2 + (w[2] - phase.center[2]) ** 2;
        // (a position that is not finite compares false: outside)
        p.inside = d2 <= (p.inside ? exit2 : enter2);
        if (p.inside) {
          p.outsideSince = null;
          continue;
        }
        p.outsideSince ??= time;
        if (time - p.outsideSince >= grace) (expired ??= []).push(id);
      }
      for (const id of expired ?? []) this.detach(id, this.placed.get(id)!, 'outside');
    }
  }

  /** What the session whose entity is `viewer` may see, as a test per entity id; null when it may see everything. */
  visibleTo(viewer: number): ((id: number) => boolean) | null {
    if (this.placed.size === 0) return null;
    const v = this.placed.get(viewer);
    return (id) => id === viewer || this.sees(v, id);
  }

  /** An entity left the zone: a member leaves its phase at once, a phase's own entity is forgotten. */
  removed(id: number): void {
    const p = this.placed.get(id);
    if (p) this.detach(id, p, 'despawned');
  }

  // ---------- inside ----------

  /** The visibility rule (see the header), for a viewer placed at `v` (undefined: the shared world). */
  private sees(v: Placement | undefined, id: number): boolean {
    const e = this.placed.get(id);
    const viewerSealed = v !== undefined && sealed(v);
    if (e === undefined) return !(viewerSealed && this.zone.entity(id)?.fields.kind === 'player');
    if (e.phase === v?.phase) return true;
    return e.member && !sealed(e) && !viewerSealed;
  }

  /** Whether a phase has room for a player of `party`: below its player cap, or (one party) holding only that party. */
  private admits(p: PhaseState, party: string | null): boolean {
    const { cap } = PHASE_KINDS[p.kind];
    if ('players' in cap) return p.members.size < cap.players;
    if (party === null) return false;
    for (const m of p.members) if (this.zone.entity(m)?.party !== party) return false;
    return true;
  }

  private hasPartyMember(p: PhaseState, party: string): boolean {
    for (const m of p.members) if (this.zone.entity(m)?.party === party) return true;
    return false;
  }

  private openPhase(kind: PhaseKind, location: PhaseLocation): PhaseState {
    const loc: PhaseLocation = { key: location.key, frame: location.frame, center: [...location.center], radius: location.radius };
    const phase = new PhaseState(this.nextId++, kind, Object.freeze(loc), this.zone.time);
    phase.center = this.zone.toWorld(loc.frame, loc.center);
    this.phases.set(phase.id, phase);
    let place = this.byPlace.get(phase.place);
    if (!place) this.byPlace.set(phase.place, (place = new Set()));
    place.add(phase);
    this.log?.info(
      { zone: this.zone.id, phase: phase.id, kind, location: loc.key, cap: PHASE_KINDS[kind].cap, atPlace: place.size, open: this.phases.size },
      'phase opened',
    );
    return phase;
  }

  /** Takes an entity out of its phase; a phase left with no members closes. */
  private detach(id: number, p: Placement, reason: LeaveReason): void {
    this.placed.delete(id);
    const { phase } = p;
    if (!p.member) {
      phase.entities.delete(id);
      return;
    }
    phase.members.delete(id);
    this.log?.debug({ zone: this.zone.id, phase: phase.id, kind: phase.kind, entity: id, reason, members: phase.members.size }, 'phase member left');
    if (phase.members.size === 0) this.shut(phase, 'empty');
  }

  private shut(phase: PhaseState, reason: 'empty' | 'closed'): void {
    if (!phase.open) return;
    phase.open = false;
    this.phases.delete(phase.id);
    const place = this.byPlace.get(phase.place)!;
    place.delete(phase);
    if (place.size === 0) this.byPlace.delete(phase.place);
    const members = phase.members.size;
    const own = [...phase.entities];
    for (const id of phase.members) this.placed.delete(id);
    for (const id of own) this.placed.delete(id);
    phase.members.clear();
    phase.entities.clear();
    // (each despawn calls removed(), which finds nothing placed)
    for (const id of own) this.zone.despawn(id);
    this.log?.info(
      {
        zone: this.zone.id,
        phase: phase.id,
        kind: phase.kind,
        location: phase.location.key,
        reason,
        members,
        entities: own.length,
        openS: Math.round((this.zone.time - phase.opened) * 10) / 10,
      },
      'phase closed',
    );
  }

  private checkLocation(l: PhaseLocation): void {
    if (typeof l.key !== 'string' || l.key.length === 0 || l.key.length > 128) throw new RangeError('a phase location key must be 1–128 characters');
    if (!this.zone.hasFrame(l.frame)) throw new RangeError(`frame ${l.frame} is not in zone ${this.zone.id}`);
    if (!Array.isArray(l.center) || l.center.length !== 3 || !l.center.every(Number.isFinite)) {
      throw new RangeError(`a phase location's centre must be 3 finite numbers, not ${JSON.stringify(l.center)}`);
    }
    if (!(Number.isFinite(l.radius) && l.radius > 0)) throw new RangeError(`a phase location's radius must be positive, not ${l.radius}`);
  }
}

/** A member inside its phase's volume, in a phase whose kind isolates players. */
function sealed(p: Placement): boolean {
  return p.member && p.inside && PHASE_KINDS[p.phase.kind].isolates;
}

function placeKey(kind: PhaseKind, key: string): string {
  return `${kind}:${key}`;
}
