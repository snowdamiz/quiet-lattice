// The phase manager (DESIGN 17 "Phases are first class", 14.1, 16.6; docs/ARCHITECTURE.md §6.1): a zone's private
// layers at shared places. A phase is opened at a location (a key naming the place, and a sphere in one of the system's
// frames, which moves with it) for a kind with a cap (kinds.ts), filled by presence and closed once it has no members.
//
// Every entity in a zone has a phase or none (the shared world). Members are sessions' players placed by phaseFor (or put
// in one phase by name with enter, under the same caps and party rule: answering a call for aid, social/beacons.ts); a
// phase's own entities (its actors: NPCs, bosses, props) are spawned through it and go with it when it closes. What a
// session sees is decided here (visibleTo, which the zone applies to every interest set):
// - everything in the shared world and in its own phase;
// - never another phase's own entities;
// - another phase's players unless either is sealed: a member is sealed while inside its phase's volume, in a phase whose
//   kind isolates players (a bay, an event, a raid). A sealed member sees no player outside its phase, the shared
//   world's included, and none of them sees it; a story phase's members stay in sight of everyone.
// A member who leaves the volume goes back to the shared world after the kind's grace period (coming back before then
// keeps its place). One whose connection drops keeps its place for the same grace, by character, and finds it again
// through phaseFor when it reconnects; a phase does not close while such a place is kept. One whose entity leaves the
// zone any other way (a handoff, a logout) goes at once.
//
// Party membership is the zone's party tag, which the party service (social/parties.ts) keeps on every member's entity,
// or the party phaseFor is given, which the member keeps: a story phase holds one party, and placement puts a player in a
// party member's phase at that place whenever it has room. A place kept across a dropped connection is reclaimed only
// under the party it was kept for.
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
  /** characters whose connection dropped, whose places it keeps for the grace (they count towards its cap) */
  readonly held: ReadonlySet<string>;
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
  readonly held = new Set<string>();
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

  /** members and kept places: what counts towards its cap, and keeps it open */
  get size(): number {
    return this.members.size + this.held.size;
  }
}

/** An entity in a phase. */
interface Placement {
  readonly phase: PhaseState;
  /** a member (a session's player) rather than one of the phase's own entities */
  readonly member: boolean;
  /** the party it was placed under (phaseFor's partyId); undefined: its entity's party tag, read when needed */
  party: string | null | undefined;
  /** its session's character, whose place is kept when its connection drops; null for anything else */
  readonly character: string | null;
  /** inside the volume as of the last tick, with hysteresis; a new member counts as inside until the next tick */
  inside: boolean;
  /** world time it was first outside the volume; null while inside */
  outsideSince: number | null;
}

/**
 * A disconnected member's kept place. It lasts the kind's grace from when the member left the volume if it was outside
 * then, else from the disconnect, and a reclaim carries that time back, so dropping and coming back never extends it.
 */
interface Hold {
  readonly phase: PhaseState;
  /** the party it was in when its connection dropped */
  readonly party: string | null;
  /** world time its connection dropped */
  readonly since: number;
  /** world time it left the volume, if it was outside when its connection dropped */
  readonly outsideSince: number | null;
}

export class PhaseManager {
  private readonly phases = new Map<number, PhaseState>();
  /** open phases by kind and location key, oldest first */
  private readonly byPlace = new Map<string, Set<PhaseState>>();
  /** every entity in a phase, members and phases' own entities alike; anything else is in the shared world */
  private readonly placed = new Map<number, Placement>();
  /** kept places, by character id */
  private readonly held = new Map<string, Hold>();
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
   * Puts the session's player in a phase of `kind` at `location` and returns it: the one it is already in there, or
   * whose place was kept for its character since its connection dropped, when it comes back under the party the place was
   * kept for (else the place is given up); else a party member's that has room; else the
   * fullest that has room (the oldest of equals); else a new one. It leaves any other phase it was in, or had a place
   * kept in. `partyId` is the party it is placed under and keeps; without one its entity's party tag counts, as it
   * stands each time. A player in no party fills a story phase alone, and a story phase never holds two parties: a
   * player there (or coming back to a kept place) under a party the others are not in goes to another phase.
   */
  phaseFor(viewer: ZoneViewer, kind: PhaseKind, location: PhaseLocation, partyId?: string | null): Phase {
    if (!Object.hasOwn(PHASE_KINDS, kind)) throw new RangeError(`unknown phase kind ${String(kind)}`);
    this.checkLocation(location);
    const id = this.zone.entityOf(viewer);
    if (id === undefined) throw new Error(`session ${viewer.id} is not in zone ${this.zone.id}`);
    const tag = this.zone.entity(id)!.party;
    const party = partyId === undefined ? tag : partyId;
    const place = placeKey(kind, location.key);

    const current = this.placed.get(id);
    if (current?.member && current.phase.place === place) {
      // (placed under a party a story phase's others are not in, it goes to another phase, below)
      if (partyId === undefined || this.fits(current.phase, partyId, id)) {
        if (partyId !== undefined) current.party = partyId;
        return current.phase;
      }
    }

    let chosen: PhaseState | undefined;
    let outsideSince: number | null = null;
    const character = viewer.characterId ?? null;
    const hold = character === null ? undefined : this.held.get(character);
    if (hold && hold.phase.place === place) {
      // back after a dropped connection, under the party it is in now (the partyId given, else its new entity's tag, which
      // the party service sets as it joins): the place is its own only under the party it was kept for; one that left or
      // was kicked from that party meanwhile gives the place up and is placed afresh
      const back = partyId !== undefined ? partyId : tag;
      this.held.delete(character!);
      hold.phase.held.delete(character!);
      if (back === hold.party && this.fits(hold.phase, back, id)) {
        chosen = hold.phase;
        outsideSince = hold.outsideSince;
      } else {
        this.log?.debug({ zone: this.zone.id, phase: hold.phase.id, character, reason: 'party' }, 'phase place given up');
        if (hold.phase.size === 0) this.shut(hold.phase, 'empty');
      }
    } else if (hold) {
      this.dropHold(character!, 'moved');
    }
    if (!chosen && party !== null) {
      for (const p of this.byPlace.get(place) ?? []) {
        if (this.admits(p, party) && this.hasPartyMember(p, party)) {
          chosen = p;
          break;
        }
      }
    }
    if (!chosen) {
      for (const p of this.byPlace.get(place) ?? []) if (this.admits(p, party) && (!chosen || p.size > chosen.size)) chosen = p;
    }
    chosen ??= this.openPhase(kind, location);

    if (current) this.detach(id, current, 'moved');
    chosen.members.add(id);
    this.placed.set(id, { phase: chosen, member: true, party: partyId, character, inside: outsideSince === null, outsideSince });
    this.log?.debug({ zone: this.zone.id, phase: chosen.id, kind, location: location.key, entity: id, members: chosen.members.size }, 'phase member joined');
    return chosen;
  }

  /**
   * Puts the session's player in open phase `phaseId` itself, rather than whichever phase phaseFor would pick at its place:
   * how a player answering a call for aid (social/beacons.ts) joins the caller's instance. The phase must have room for it
   * under `partyId` by the rules phaseFor places by (below its player cap, or a story phase's one party); else nothing
   * changes and the answer is 'full' ('closed': no such open phase). A place kept for its character in this phase is taken
   * back as phaseFor takes it back (under the party it was kept for; under another it is given up first). Placed, it
   * leaves any other phase it was in or had a place kept in, and keeps `partyId` (without one, its entity's party tag
   * counts) as phaseFor's members do. Asked for the phase it is in already, it stays and takes `partyId` when the phase's
   * others are all of it ('full' otherwise). Its entity does not move, so movement authority judges its inputs as before.
   */
  enter(viewer: ZoneViewer, phaseId: number, partyId?: string | null): Phase | 'closed' | 'full' {
    const phase = this.phases.get(phaseId);
    if (!phase) return 'closed';
    const id = this.zone.entityOf(viewer);
    if (id === undefined) throw new Error(`session ${viewer.id} is not in zone ${this.zone.id}`);
    const party = partyId === undefined ? this.zone.entity(id)!.party : partyId;
    const current = this.placed.get(id);
    if (current?.member && current.phase === phase) {
      if (partyId === undefined) return phase;
      if (!this.fits(phase, partyId, id)) return 'full';
      current.party = partyId;
      return phase;
    }
    const character = viewer.characterId ?? null;
    let hold = character === null ? undefined : this.held.get(character);
    if (hold?.phase === phase && (hold.party !== party || !this.fits(phase, party, id))) {
      // back under another party: the place kept here is given up, as phaseFor gives it up
      this.dropHold(character!, 'moved');
      hold = undefined;
      if (!phase.open) return 'closed';
    }
    // (a place kept here counts towards the cap already)
    if (hold?.phase !== phase && !this.admits(phase, party)) return 'full';
    if (hold) {
      this.held.delete(character!);
      hold.phase.held.delete(character!);
      if (hold.phase !== phase && hold.phase.size === 0) this.shut(hold.phase, 'empty');
    }
    if (current) this.detach(id, current, 'moved');
    const outsideSince = hold?.phase === phase ? hold.outsideSince : null;
    phase.members.add(id);
    this.placed.set(id, { phase, member: true, party: partyId, character, inside: outsideSince === null, outsideSince });
    this.log?.debug(
      { zone: this.zone.id, phase: phase.id, kind: phase.kind, location: phase.location.key, entity: id, members: phase.members.size, via: 'enter' },
      'phase member joined',
    );
    return phase;
  }

  /**
   * Takes the session's player out of its phase, back to the shared world, and gives up any place kept for its
   * character. False when it was in none and had none kept.
   */
  leave(viewer: ZoneViewer): boolean {
    const id = this.zone.entityOf(viewer);
    const p = id === undefined ? undefined : this.placed.get(id);
    const character = viewer.characterId ?? null;
    const kept = character !== null && this.held.has(character);
    if (p?.member) this.detach(id!, p, 'left');
    if (kept) this.dropHold(character, 'left');
    return !!p?.member || kept;
  }

  /**
   * The session's connection dropped; the zone calls this before taking its entity out. Its player's place in its phase
   * is kept for the kind's grace, for its character to find again through phaseFor. A session with no character, or
   * none in a phase, has nothing kept.
   */
  disconnected(viewer: ZoneViewer): void {
    const id = this.zone.entityOf(viewer);
    const p = id === undefined ? undefined : this.placed.get(id);
    if (!p?.member || p.character === null) return;
    const { phase, character } = p;
    const party = this.partyOf(id!, p);
    this.placed.delete(id!);
    phase.members.delete(id!);
    if (this.held.has(character)) this.dropHold(character, 'moved');
    this.held.set(character, { phase, party, since: this.zone.time, outsideSince: p.outsideSince });
    phase.held.add(character);
    this.log?.debug(
      { zone: this.zone.id, phase: phase.id, kind: phase.kind, entity: id, character, members: phase.members.size },
      'phase member disconnected; place kept',
    );
  }

  /** Spawns one of the phase's own entities, which only its members see and which goes when it closes. */
  spawn(phaseId: number, init: EntityInit): number {
    const phase = this.phases.get(phaseId);
    if (!phase) throw new Error(`no open phase ${phaseId} in zone ${this.zone.id}`);
    const id = this.zone.spawn(init);
    phase.entities.add(id);
    this.placed.set(id, { phase, member: false, party: undefined, character: null, inside: true, outsideSince: null });
    return id;
  }

  /** Closes the phase now: its members go back to the shared world, kept places go, and its own entities are despawned. */
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

  /** Whether entity `id` is out of the shared world's sight: a member sealed in its phase (a bay, event or raid), or one
   * of a phase's own entities. The shared world's systems (fauna) leave such an entity alone. */
  hiddenFromShared(id: number): boolean {
    return !this.sees(undefined, id);
  }

  // ---------- the zone's hooks ----------

  /**
   * Each tick, once every entity's world position is current: who is inside its phase's volume, who has been outside
   * for longer than the grace, and whose kept place has run out.
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
      let lapsed: string[] | undefined;
      for (const character of phase.held) {
        const h = this.held.get(character)!;
        if (time - (h.outsideSince ?? h.since) >= grace) (lapsed ??= []).push(character);
      }
      // (the phase closes once the last of them goes)
      for (const id of expired ?? []) this.detach(id, this.placed.get(id)!, 'outside');
      for (const character of lapsed ?? []) this.dropHold(character, 'expired');
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

  /** A member's party: the one it was placed under, else its entity's tag as it stands. */
  private partyOf(id: number, p: Placement): string | null {
    return p.party !== undefined ? p.party : (this.zone.entity(id)?.party ?? null);
  }

  /** The party of each member and kept place. */
  private *partiesIn(p: PhaseState, except?: number): Generator<string | null> {
    for (const m of p.members) if (m !== except) yield this.partyOf(m, this.placed.get(m)!);
    for (const character of p.held) yield this.held.get(character)!.party;
  }

  /**
   * Whether entity `id` may be in phase `p` under `party`: always in a phase with a player cap; in a story phase only
   * when everyone else in it (members and kept places) is of that party, or nobody else is.
   */
  private fits(p: PhaseState, party: string | null, id: number): boolean {
    if ('players' in PHASE_KINDS[p.kind].cap) return true;
    for (const q of this.partiesIn(p, id)) if (party === null || q !== party) return false;
    return true;
  }

  /** Whether a phase has room for a player of `party`: below its player cap, or (one party) holding only that party. */
  private admits(p: PhaseState, party: string | null): boolean {
    const { cap } = PHASE_KINDS[p.kind];
    if ('players' in cap) return p.size < cap.players;
    if (party === null) return false;
    for (const q of this.partiesIn(p)) if (q !== party) return false;
    return true;
  }

  private hasPartyMember(p: PhaseState, party: string): boolean {
    for (const q of this.partiesIn(p)) if (q === party) return true;
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

  /** Takes an entity out of its phase; a phase left with no members and no kept places closes. */
  private detach(id: number, p: Placement, reason: LeaveReason): void {
    this.placed.delete(id);
    const { phase } = p;
    if (!p.member) {
      phase.entities.delete(id);
      return;
    }
    phase.members.delete(id);
    this.log?.debug({ zone: this.zone.id, phase: phase.id, kind: phase.kind, entity: id, reason, members: phase.members.size }, 'phase member left');
    if (phase.size === 0) this.shut(phase, 'empty');
  }

  /** Gives up a character's kept place; a phase left with no members and no kept places closes. */
  private dropHold(character: string, reason: 'expired' | 'left' | 'moved'): void {
    const { phase } = this.held.get(character)!;
    this.held.delete(character);
    phase.held.delete(character);
    this.log?.debug({ zone: this.zone.id, phase: phase.id, kind: phase.kind, character, reason, members: phase.members.size }, 'phase place given up');
    if (phase.size === 0) this.shut(phase, 'empty');
  }

  private shut(phase: PhaseState, reason: 'empty' | 'closed'): void {
    if (!phase.open) return;
    phase.open = false;
    this.phases.delete(phase.id);
    const place = this.byPlace.get(phase.place)!;
    place.delete(phase);
    if (place.size === 0) this.byPlace.delete(phase.place);
    const members = phase.members.size;
    const held = phase.held.size;
    const own = [...phase.entities];
    for (const id of phase.members) this.placed.delete(id);
    for (const character of phase.held) this.held.delete(character);
    for (const id of own) this.placed.delete(id);
    phase.members.clear();
    phase.held.clear();
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
        held,
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
