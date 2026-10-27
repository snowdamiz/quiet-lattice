// The call-for-aid beacon (DESIGN 16.6 "Social", 17; docs/ARCHITECTURE.md §21). A player in an instance with open slots
// raises a beacon, which lists the instance to the whole shard (its kind, star system, place and what the place is called,
// its open slots, who raised it and when) until the instance fills, closes or is left by its caller, the caller lowers it,
// or it lapses (beaconTtlS, ten minutes). Anyone online may watch the list: the whole of it as it starts watching, then
// its changes, each change encoded once for every watcher.
//
// Answering a beacon puts the answering player in that instance, through the phase manager's own placement (its caps,
// party rule and visibility: PhaseManager.enter), once the server has checked again, then and there, that it may join:
// - the beacon is still up (its instance open, its caller there, not lapsed) and is not its own;
// - the player is in the instance's star system (`elsewhere`), in no instance already (`in_phase`), and inside the
//   instance's place (`far`). The server never moves a player to answer, so its entity stays where movement authority
//   has it and its inputs are judged as before; getting there is the player's to do (the beacon says where).
// - there is a slot for it: below an event's or a raid's player cap (`full`, checked by the phase manager as it places);
//   for a quest step's story phase, which holds one party, a place in the caller's party, which answering joins as an
//   invite accepted would (`full`, `in_party`), its caller being in the instance to lead it (`gone`). A helper needs no
//   quest of its own: it fights beside the party in the caller's chapter, and the quest runtime leaves alone a player in a
//   phase it did not put it in.
// Bays (a hangar's interior) and cutscenes' story phases are not instances anyone calls aid to (`kind`).
//
// Beacons live in memory, like parties: Phase 1 runs the shard in one process (ARCHITECTURE §1), so nothing needs to
// see them from elsewhere, and a restart drops them. Raising, answering and every end are logged.
import { BeaconPlace, BeaconView, type BeaconOp, type ServerMessage } from '@astra/shared/protocol';
import { getQuest, questIdSchema } from '@astra/shared/quests';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { PHASE_KINDS, PHASE_VOLUME_HYSTERESIS } from '../phases/kinds.ts';
import type { Phase } from '../phases/manager.ts';
import type { Zone } from '../zones/zone.ts';
import { deny, fanOut, type SocialContext } from './context.ts';
import type { Parties } from './parties.ts';
import type { Online } from './roster.ts';

type BeaconKind = BeaconView['kind'];
export type BeaconEnd = NonNullable<Extract<ServerMessage, { t: 'beacon' }>['why']>;

interface Beacon {
  readonly id: number;
  /** its caller's character id, and name */
  readonly caller: string;
  readonly name: string;
  readonly zone: Zone;
  readonly phase: Phase;
  readonly kind: BeaconKind;
  /** a story instance's quest */
  readonly quest: string | null;
  /** what its place is called */
  readonly place: string;
  readonly cap: number;
  /** world times it was raised and lapses */
  readonly at: number;
  readonly until: number;
  /** open slots as last listed */
  open: number;
}

/** Where an online character's entity is: its zone, its entity, and the phase it is in (undefined: the shared world). */
interface Whereabouts {
  readonly zone: Zone;
  readonly entity: number;
  readonly phase: Phase | undefined;
}

export class Beacons {
  /** up now, oldest first */
  private readonly beacons = new Map<number, Beacon>();
  private readonly byCaller = new Map<string, Beacon>();
  /** by zone and phase (`<zone>/<phase>`): one beacon per instance */
  private readonly byPhase = new Map<string, Beacon>();
  /** who watches the list, by character */
  private readonly watchers = new Map<string, Online>();
  /** raising allowances, by account */
  private readonly allowances = new Map<string, TokenBucket>();
  /** changes the watchers have not been sent yet: a beacon to list afresh, or null for one that ended */
  private readonly pending = new Map<number, Beacon | null>();
  /** the whole list, encoded, as a new watcher is sent it; null when it changed since */
  private listText: string | null = null;
  private nextId = 1;

  constructor(
    private readonly ctx: SocialContext,
    private readonly parties: Parties,
  ) {}

  /** Beacons up. */
  get count(): number {
    return this.beacons.size;
  }

  /** Sessions watching the list. */
  get watching(): number {
    return this.watchers.size;
  }

  /** Every beacon up, as the shard sees it, oldest first. */
  list(): BeaconView[] {
    return [...this.beacons.values()].map(view);
  }

  /** The character's beacon, when it has one up. */
  of(characterId: string): BeaconView | undefined {
    const b = this.byCaller.get(characterId);
    return b && view(b);
  }

  /** Carries out a beacon request, or tells the asker why not; watchers hear of what changed. */
  request(o: Online, op: BeaconOp): void {
    switch (op.op) {
      case 'raise':
        this.raise(o);
        break;
      case 'lower': {
        const b = this.byCaller.get(o.characterId);
        if (b) this.end(b, 'lowered');
        else deny(o, 'lower', 'unknown');
        break;
      }
      case 'watch':
        // (changes still to go out go first, so the list it is sent is the one they lead to)
        this.flush();
        this.watchers.set(o.characterId, o);
        this.listText ??= this.ctx.encode({ t: 'beacons', reset: true, beacons: this.list(), gone: [] });
        o.session.sendText(this.listText);
        break;
      case 'unwatch':
        if (this.watchers.get(o.characterId) === o) this.watchers.delete(o.characterId);
        break;
      case 'answer':
        this.answer(o, op.id);
        break;
    }
    this.flush();
  }

  /** The character came online (joined, or entered again): a beacon it raised that is still up is sent to it again. */
  joined(o: Online): void {
    const b = this.byCaller.get(o.characterId);
    if (b) o.session.send({ t: 'beacon', op: 'raised', id: b.id, beacon: view(b) });
  }

  /** The character's connection closed: it watches no longer. A beacon it raised stays while its place is kept. */
  left(o: Online): void {
    if (this.watchers.get(o.characterId) === o) this.watchers.delete(o.characterId);
  }

  /**
   * Checks every beacon (its instance open, its caller there, not lapsed, a slot open) and sends the watchers what
   * changed. The social service's timer calls it every tick.
   */
  sweep(): void {
    for (const b of [...this.beacons.values()]) this.refresh(b);
    this.flush();
  }

  /** Forgets raising allowances that have refilled (they behave exactly like a missing one). */
  forget(now: number): void {
    for (const [account, a] of this.allowances) if (a.level(now) >= a.burst) this.allowances.delete(account);
  }

  // ---------- requests ----------

  private raise(o: Online): void {
    const { ctx } = this;
    if (this.byCaller.has(o.characterId)) return deny(o, 'raise', 'raised');
    const now = ctx.mono();
    let allowance = this.allowances.get(o.accountId);
    if (!allowance) this.allowances.set(o.accountId, (allowance = new TokenBucket(ctx.limits.beaconBurst, ctx.limits.beaconPerSecond, now)));
    if (!allowance.take(now)) return deny(o, 'raise', 'rate', { retryS: allowance.retryAfterSeconds(now) });
    const at = this.where(o);
    if (!at?.phase) return deny(o, 'raise', 'no_phase');
    const { zone, phase } = at;
    const quest = questOf(phase);
    const kind = phase.kind === 'event' || phase.kind === 'raid' ? phase.kind : phase.kind === 'story' && quest !== null ? 'story' : null;
    if (kind === null) return deny(o, 'raise', 'kind');
    if (this.byPhase.has(phaseKey(zone, phase))) return deny(o, 'raise', 'raised');
    if (this.beacons.size >= ctx.limits.beaconMax) return deny(o, 'raise', 'busy');
    const time = ctx.clock.now();
    const b: Beacon = {
      id: this.nextId++,
      caller: o.characterId,
      name: o.name,
      zone,
      phase,
      kind,
      quest: kind === 'story' ? quest : null,
      place: placeName(kind, phase, quest),
      cap: kind === 'story' ? ctx.limits.partyMax : PHASE_KINDS[kind].cap.players,
      at: time,
      until: time + ctx.limits.beaconTtlS,
      open: 0,
    };
    b.open = this.openSlots(b);
    if (b.open < 1) return deny(o, 'raise', 'full');
    // (only its open slots change from here, within 1 to cap − 1: a beacon listed once is always listable)
    const listed = BeaconView.safeParse(view(b));
    if (!listed.success) {
      ctx.log?.error({ character: b.caller, zone: zone.id, phase: phase.id, issues: listed.error.message }, 'beacon not raised: its instance cannot be listed');
      return deny(o, 'raise', 'kind');
    }
    this.beacons.set(b.id, b);
    this.byCaller.set(b.caller, b);
    this.byPhase.set(phaseKey(zone, phase), b);
    this.changed(b.id, b);
    o.session.send({ t: 'beacon', op: 'raised', id: b.id, beacon: view(b) });
    ctx.log?.info(
      { beacon: b.id, character: b.caller, account: o.accountId, zone: zone.id, phase: phase.id, kind, quest: b.quest, open: b.open, cap: b.cap },
      'beacon raised',
    );
  }

  private answer(o: Online, id: number): void {
    const b = this.beacons.get(id);
    if (!b) return deny(o, 'answer', 'unknown');
    if (b.caller === o.characterId) return deny(o, 'answer', 'self');
    const why = this.endOf(b);
    if (why) {
      this.end(b, why);
      return deny(o, 'answer', 'unknown');
    }
    const at = this.where(o);
    if (!at || at.zone !== b.zone) return deny(o, 'answer', 'elsewhere');
    if (at.phase) return deny(o, 'answer', 'in_phase');
    if (!inside(at.zone, at.entity, b.phase)) return deny(o, 'answer', 'far');
    const placed = b.kind === 'story' ? this.joinStory(o, b) : b.zone.phases.enter(o.session, b.phase.id, this.parties.partyIdOf(o.characterId));
    if (placed === 'closed') {
      this.end(b, 'closed');
      return deny(o, 'answer', 'unknown');
    }
    if (typeof placed === 'string') {
      this.ctx.log?.debug({ beacon: b.id, character: o.characterId, code: placed }, 'beacon answer refused');
      return deny(o, 'answer', placed);
    }
    o.session.send({ t: 'beacon', op: 'joined', id: b.id, phase: placed.id });
    this.ctx.roster.get(b.caller)?.session.send({ t: 'beacon', op: 'answered', id: b.id, name: o.name });
    this.ctx.log?.info(
      {
        beacon: b.id,
        character: o.characterId,
        account: o.accountId,
        caller: b.caller,
        zone: b.zone.id,
        phase: placed.id,
        kind: b.kind,
        members: placed.members.size,
      },
      'beacon answered',
    );
    this.refresh(b);
  }

  /**
   * A story phase holds one party, so answering joins the caller's party (or forms the one it leads) and puts the
   * answerer in the phase under it, the caller re-placed under it first: a caller placed before it had a party was placed
   * as a party of one. Nothing changes when the answerer may not join: the party's room (`full`) is checked before
   * anything changes, and a phase holding another party's place (only a party that changed under it leaves one) is `full`.
   */
  private joinStory(o: Online, b: Beacon): Phase | 'full' | 'closed' | 'in_party' | 'gone' {
    const { parties } = this;
    const phases = b.zone.phases;
    const caller = this.ctx.roster.get(b.caller);
    // (it leads the party in its own chapter, so it must be there, connected)
    if (!caller || this.where(caller)?.phase !== b.phase) return 'gone';
    const refusal = parties.joinRefusal(o, b.caller);
    if (refusal) return refusal === 'party_full' ? 'full' : refusal;
    const party = parties.partyIdOf(b.caller);
    if (party === null) {
      // a party of one, alone in its phase: the party answering forms is the phase's at once
      if (b.phase.members.size + b.phase.held.size !== 1) return 'full';
      parties.joinWith(o, b.caller);
      const formed = parties.partyIdOf(b.caller)!;
      phases.enter(caller.session, b.phase.id, formed);
      return phases.enter(o.session, b.phase.id, formed);
    }
    if (phases.enter(caller.session, b.phase.id, party) !== b.phase) return 'full';
    const placed = phases.enter(o.session, b.phase.id, party);
    if (placed === b.phase) parties.joinWith(o, b.caller);
    return placed;
  }

  // ---------- inside ----------

  /** Ends the beacon when its instance closed, it lapsed, its caller left or no slot is open; else lists its slots afresh. */
  private refresh(b: Beacon): void {
    const why = this.endOf(b);
    if (why) return this.end(b, why);
    const open = this.openSlots(b);
    if (open < 1) return this.end(b, 'full');
    if (open === b.open) return;
    b.open = open;
    this.changed(b.id, b);
  }

  /** Why the beacon must end, slots aside: its instance closed, it lapsed, or its caller is no longer in the instance. */
  private endOf(b: Beacon): BeaconEnd | null {
    if (!b.phase.open) return 'closed';
    if (this.ctx.clock.now() >= b.until) return 'expired';
    if (!this.callerIn(b)) return 'left';
    return null;
  }

  /** The caller is in its instance: its entity a member, or its place kept while its connection is down. */
  private callerIn(b: Beacon): boolean {
    const o = this.ctx.roster.get(b.caller);
    const at = o && this.where(o);
    return (at?.zone === b.zone && at.phase === b.phase) || b.phase.held.has(b.caller);
  }

  /** Slots open: below an event's or a raid's player cap (members and kept places), or in a story instance's party. */
  private openSlots(b: Beacon): number {
    if (b.kind === 'story') return b.cap - (this.parties.of(b.caller)?.members.length ?? 1);
    return b.cap - (b.phase.members.size + b.phase.held.size);
  }

  private end(b: Beacon, why: BeaconEnd): void {
    this.beacons.delete(b.id);
    this.byCaller.delete(b.caller);
    this.byPhase.delete(phaseKey(b.zone, b.phase));
    this.changed(b.id, null);
    this.ctx.roster.get(b.caller)?.session.send({ t: 'beacon', op: 'ended', id: b.id, why });
    this.ctx.log?.info({ beacon: b.id, character: b.caller, zone: b.zone.id, phase: b.phase.id, kind: b.kind, why }, 'beacon ended');
  }

  private changed(id: number, b: Beacon | null): void {
    this.pending.set(id, b);
    this.listText = null;
  }

  /** Sends the watchers what changed since the last flush, encoded once. */
  private flush(): void {
    if (this.pending.size === 0) return;
    const beacons: BeaconView[] = [];
    const gone: number[] = [];
    for (const [id, b] of this.pending) {
      if (b) beacons.push(view(b));
      else gone.push(id);
    }
    this.pending.clear();
    if (this.watchers.size > 0) fanOut(this.ctx, this.watchersOnline(), { t: 'beacons', beacons, gone });
  }

  /** The watchers still online on the session that asked (a character entering again watches only once it asks). */
  private *watchersOnline(): Generator<Online> {
    for (const [characterId, o] of this.watchers) {
      if (this.ctx.roster.get(characterId) === o) yield o;
      else this.watchers.delete(characterId);
    }
  }

  private where(o: Online): Whereabouts | undefined {
    const zone = this.ctx.zones.zoneOf(o.session);
    const entity = zone?.entityOf(o.session);
    if (!zone || entity === undefined) return undefined;
    const id = zone.phases.phaseOf(entity);
    return { zone, entity, phase: id === null ? undefined : zone.phases.phase(id) };
  }
}

/** A beacon as the shard sees it. */
function view(b: Beacon): BeaconView {
  const { location } = b.phase;
  return {
    id: b.id,
    kind: b.kind,
    system: b.zone.systemIndex,
    frame: location.frame,
    center: [location.center[0], location.center[1], location.center[2]],
    radius: location.radius,
    place: b.place,
    ...(b.quest === null ? {} : { quest: b.quest }),
    from: b.name,
    open: b.open,
    cap: b.cap,
    at: b.at,
    until: b.until,
  };
}

/** The quest whose step a story phase is: the quest runtime keys them `quest:<quest>:<scene or step>` (ARCHITECTURE §17). */
function questOf(phase: Phase): string | null {
  if (phase.kind !== 'story') return null;
  const id = /^quest:([^:]+):/.exec(phase.location.key)?.[1];
  return id !== undefined && questIdSchema.safeParse(id).success ? id : null;
}

/** What a beacon's place is called: its quest's title, else its location's key; the kind's name when neither is plain text. */
function placeName(kind: BeaconKind, phase: Phase, quest: string | null): string {
  const name = clip(((quest === null ? undefined : getQuest(quest)?.title) ?? quest ?? phase.location.key).trim(), 64).trim();
  return BeaconPlace.safeParse(name).success ? name : kind[0]!.toUpperCase() + kind.slice(1);
}

/** `text` cut to at most `max` UTF-16 units, never inside a character. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Whether the entity is inside the phase's place, with the phase manager's hysteresis (its members' rule for inside): its
 * pose as it stands now (a player that joined since the last tick has no world position yet), with the place's, in the
 * frames as of the last tick.
 */
function inside(zone: Zone, entity: number, phase: Phase): boolean {
  const e = zone.entity(entity);
  if (!e) return false;
  const w = zone.toWorld(e.fields.frame, e.fields.pos);
  const { frame, center, radius } = phase.location;
  const c = zone.toWorld(frame, center);
  const r = radius * PHASE_VOLUME_HYSTERESIS;
  return (w[0] - c[0]) ** 2 + (w[1] - c[1]) ** 2 + (w[2] - c[2]) ** 2 <= r * r;
}

function phaseKey(zone: Zone, phase: Phase): string {
  return `${zone.id}/${phase.id}`;
}
