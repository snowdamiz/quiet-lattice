// The meter service (P1.E07.T02, DESIGN 9.1, ARCHITECTURE §16): the server's copy of every character in play's heat and
// Charge, which is the truth. The client predicts both with the same shared rules (`@astra/shared/meters`); this service
// decides them from what it can judge itself.
//
// The meters run lazily, from timestamps: each input from the character's session advances them to the server's time
// with what the character was doing since its last input (the beam held, the pulse drive) where it was (its world, day or
// night, under the sea, in sunlight, in the habitable band), then takes up what this input says. A client's buttons are
// requests: the beam heats only while the server believes the character is on foot (the zone's mode for its entity) and
// the meter is out of the lockout, at the beam's own rate per second of server time however fast inputs arrive; it holds
// at most ACTIVITY_HOLD_S past the last input, so a client that stops sending goes idle. The pulse drive burns Charge only
// in the believed mode `pulse`, and `gate` refuses that mode while Charge is empty (movement authority applies the mode the
// server believes, P1.E03.T04).
//
// Every call takes the server's world time `now`; the service keeps no clock. Persistence (the `meters` component) opens a
// character's meters on join, stores `get()` (the meters as of the last time they were advanced, with that time) and closes
// them once it has left. Listeners (the gateway) hear the meters to push: after an overheat, a recovery, Charge running
// out, a refused pulse, a server-side change, and every METER_PUSH_S while either meter moves.
import { Buttons, type ClientMessage } from '@astra/shared/protocol';
import {
  NOWHERE,
  addHeat,
  canEngagePulse,
  clampMeters,
  meterConditions,
  meterEnvironment,
  meterProfile,
  refillCharge,
  spendCharge,
  stepMeters,
  type MeterActivity,
  type MeterEnvironment,
  type MeterEvent,
  type MeterProfile,
  type MeterResult,
  type MeterSave,
  type MeterState,
  type MeterView,
} from '@astra/shared/meters';
import type { ShipLoadout } from '@astra/shared/ships';
import { frameKeyOf, systemPoses, type SystemPoses } from '@astra/shared/world';
import type { ZoneManager } from '../zones/manager.ts';
import type { Zone, ZoneViewer } from '../zones/zone.ts';

type InputMessage = Extract<ClientMessage, { t: 'input' }>;
type MoveMode = InputMessage['mode'];

/** While a meter moves, its session hears it at most this often (s of world time); events go at once. */
export const METER_PUSH_S = 0.5;
/** What an input says the character is doing (the beam held, the pulse drive) holds this long past it, then lapses. */
export const ACTIVITY_HOLD_S = 1;
/** The entity's `heat` wire field (the glow on its multitool others see, DESIGN 9.10) moves in steps of this. */
const HEAT_GLOW_STEP = 0.02;

/** A toast for the character along with its meters (a refused pulse). */
export interface MeterNotice {
  text: string;
  tone: 'info' | 'good' | 'warn';
}

export type MeterListener = (characterId: string, view: MeterView, notice?: MeterNotice) => void;

export interface MeterServiceDeps {
  /** Each character in play's ship (persistence's holder): its hull's Charge and perks. */
  ships: { get(characterId: string): ShipLoadout | null | undefined };
  /** The nodes each character in play owns (the skill service): Tempered Core, Reserve Tank and the rest. */
  skills: { owned(characterId: string): readonly string[] };
  /** Where each session's entity is. Without it every character is nowhere in particular (unit tests). */
  zones?: Pick<ZoneManager, 'zoneOf'>;
  /** Hears a listener that threw (the gateway logs it). */
  onListenerError?: (err: unknown) => void;
}

/** A change for a character whose meters the service does not hold (it is not in play). */
export class MetersNotHeldError extends Error {
  constructor(readonly characterId: string) {
    super(`the meters of ${characterId} are not held: the character is not in play`);
    this.name = 'MetersNotHeldError';
  }
}

interface Entry {
  state: MeterState;
  /** World time the state is current to. */
  at: number;
  /** What the character is doing, as of its last input, until `activeUntil`. */
  activity: MeterActivity;
  activeUntil: number;
  /** The mode the server believes, as of the last input it accepted. */
  mode: MoveMode | null;
  env: MeterEnvironment;
  conditions: ReadonlySet<string>;
  profile: MeterProfile;
  /** What the profile was made from (it is made again when either changes). */
  ship: ShipLoadout | null | undefined;
  owned: readonly string[];
  /** Events since the last push. */
  events: MeterEvent[];
  pushed: MeterView | null;
  pushedAt: number;
  /** A refused pulse was told; the next one is told only after the client stops asking. */
  pulseRefused: boolean;
  /** The glow last put on the entity. */
  glow: number;
  /** Not yet in the world since it was opened: the time it was away runs heat (it cools) but never Charge, which regenerates
   * only in play (the Listener's anywhere included). Its first input ends it. */
  away: boolean;
}

const IDLE: MeterActivity = { beam: false, pulse: false };

export class MeterService {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<MeterListener>();
  private readonly ships: MeterServiceDeps['ships'];
  private readonly skills: MeterServiceDeps['skills'];
  private readonly zones?: MeterServiceDeps['zones'];
  private readonly onListenerError: (err: unknown) => void;
  /** Each zone's body poses at its last tick, made once per tick for every character in it. */
  private readonly poses = new WeakMap<Zone, { tick: number; poses: SystemPoses }>();

  constructor(deps: MeterServiceDeps) {
    this.ships = deps.ships;
    this.skills = deps.skills;
    this.zones = deps.zones;
    this.onListenerError = deps.onListenerError ?? (() => {});
  }

  // ---------- in play ----------

  /**
   * Puts a character's meters in play: `saved` as of its time `at`, held to what its ship and nodes allow. Heat goes on
   * cooling from `at` (wherever the character was meanwhile, nowhere in particular to the meters: no world, no sun) and
   * Charge waits, from the first time the meters are advanced. Replaces anything held.
   */
  open(characterId: string, saved: MeterSave): void {
    const ship = this.ships.get(characterId);
    const owned = this.skills.owned(characterId);
    const profile = meterProfile({ ship: ship ?? null, skills: owned });
    this.entries.set(characterId, {
      state: clampMeters({ heat: saved.heat, overheated: saved.overheated, charge: saved.charge }, profile),
      at: saved.at,
      activity: IDLE,
      activeUntil: saved.at,
      mode: null,
      env: NOWHERE,
      conditions: meterConditions(NOWHERE),
      profile,
      ship,
      owned,
      events: [],
      pushed: null,
      pushedAt: -Infinity,
      pulseRefused: false,
      glow: -1,
      away: true,
    });
  }

  /** Forgets a character's meters and returns them (for persistence to store first). */
  close(characterId: string): MeterSave | null {
    const e = this.entries.get(characterId);
    this.entries.delete(characterId);
    return e ? save(e) : null;
  }

  /** The meters as of the last time they were advanced, with that time; null when the character is not held. */
  get(characterId: string): MeterSave | null {
    const e = this.entries.get(characterId);
    return e ? save(e) : null;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The meters at `now`, as the client is sent them. (A view taken this way is not a push: the character's first input
   * after it is pushed the meters, so a client that joined hears them once it is in the world.) */
  view(characterId: string, now: number): MeterView {
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    return viewOf(e);
  }

  /** The profile the meters run on now (capacities, modifiers). */
  profile(characterId: string): MeterProfile {
    const e = this.entry(characterId);
    this.reprofile(e, characterId);
    return e.profile;
  }

  /** Listens to every push: what to send, and a toast to go with it. */
  subscribe(fn: MeterListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- inputs ----------

  /**
   * Movement authority's question (P1.E03.T04): may the character be in `mode` now? Everything but the pulse drive, which
   * needs Charge.
   */
  allowsMode(characterId: string, mode: MoveMode, now: number): boolean {
    if (mode !== 'pulse') return true;
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    return canEngagePulse(e.state, e.profile);
  }

  /**
   * An input as the meters judge it, before the zone applies it: the meters advance to `now`, and a claim of the pulse drive
   * with Charge empty is refused, the character staying in the mode the server believed (a ship's `ship` when that was the
   * drive). The character hears why once, until it stops asking.
   */
  gate(characterId: string, msg: InputMessage, now: number): InputMessage {
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    if (msg.mode !== 'pulse') {
      e.pulseRefused = false;
      return msg;
    }
    if (canEngagePulse(e.state, e.profile)) return msg;
    const notice = e.pulseRefused ? undefined : { text: 'Charge empty: the pulse drive will not engage', tone: 'warn' as const };
    e.pulseRefused = true;
    if (notice) this.push(characterId, e, now, notice);
    return { ...msg, mode: e.mode && e.mode !== 'pulse' ? e.mode : 'ship' };
  }

  /**
   * An input the zone has applied: from now the character does what it says in the mode the zone believes (its entity's),
   * where its entity now is. Pushes the meters when they are due, and puts the heat glow on its entity.
   */
  input(characterId: string, viewer: ZoneViewer, msg: InputMessage, now: number): void {
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    const zone = this.zones?.zoneOf(viewer);
    const id = zone?.entityOf(viewer);
    const entity = id === undefined ? undefined : zone!.entity(id);
    const mode = (entity?.fields.mode ?? msg.mode) as MoveMode;
    e.mode = mode;
    e.activity = { beam: mode === 'foot' && (msg.buttons & Buttons.beam) !== 0, pulse: mode === 'pulse' };
    e.activeUntil = now + ACTIVITY_HOLD_S;
    e.away = false;
    e.env = zone && entity ? this.environment(zone, entity.fields.frame, entity.fields.pos, mode === 'foot') : NOWHERE;
    e.conditions = meterConditions(e.env);
    if (zone && id !== undefined) {
      const glow = Math.round(e.state.heat / e.profile.heatCapacity / HEAT_GLOW_STEP) * HEAT_GLOW_STEP;
      if (glow !== e.glow) {
        e.glow = glow;
        zone.patch(id, { heat: glow });
      }
    }
    this.maybePush(characterId, e, now);
  }

  /** Whether the server believes the character's beam is firing now: held, on foot, out of the lockout. What server-side
   * mining (P1.E13) judges yield by. */
  beamActive(characterId: string, now: number): boolean {
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    return e.activity.beam && !e.state.overheated && now < e.activeUntil;
  }

  // ---------- server-side changes (abilities, P1.E07.T03; the Waystation's refill) ----------

  /** An ability's heat: refused in the lockout. */
  addHeat(characterId: string, amount: number, now: number): MeterResult {
    return this.change(characterId, now, (s, p) => addHeat(s, p, amount));
  }

  /** A ship active's Charge: refused unless the meter holds it. */
  spendCharge(characterId: string, amount: number, now: number): MeterResult {
    return this.change(characterId, now, (s) => spendCharge(s, amount));
  }

  /** Charge to the brim (the paid refill at a Waystation; its price is the caller's to take). */
  refillCharge(characterId: string, now: number): MeterView {
    this.change(characterId, now, (s, p) => ({ ok: true, state: refillCharge(s, p), events: [] }));
    return viewOf(this.entry(characterId));
  }

  private change(characterId: string, now: number, fn: (s: MeterState, p: MeterProfile) => MeterResult): MeterResult {
    const e = this.entry(characterId);
    this.advance(characterId, e, now);
    const r = fn(e.state, e.profile);
    if (!r.ok) return r;
    e.state = r.state;
    e.events.push(...r.events);
    this.push(characterId, e, now);
    return r;
  }

  // ---------- the meters over time ----------

  /** Runs the meters from where they stand to `now`: the activity until it lapses, then idle. */
  private advance(characterId: string, e: Entry, now: number): void {
    this.reprofile(e, characterId);
    if (!(now > e.at)) return;
    const busyTo = Math.min(now, Math.max(e.at, e.activeUntil));
    if (busyTo > e.at) this.run(e, e.activity, busyTo - e.at);
    if (now > busyTo) this.run(e, IDLE, now - busyTo);
    e.at = now;
  }

  private run(e: Entry, act: MeterActivity, dt: number): void {
    const step = stepMeters(e.state, e.profile, e.env, act, dt, e.conditions);
    // (away, Charge stands as the ship was left)
    e.state = e.away ? { ...step.state, charge: e.state.charge } : step.state;
    e.events.push(...(e.away ? step.events.filter((ev) => ev !== 'charge_empty') : step.events));
    // the drive dropped out: it stays out until an input claims it again
    if (act.pulse && !step.pulse) e.activity = { ...e.activity, pulse: false };
  }

  /** Makes the profile again when the ship or the owned nodes changed (a hull swap, a node bought or refunded). */
  private reprofile(e: Entry, characterId: string): void {
    const ship = this.ships.get(characterId);
    const owned = this.skills.owned(characterId);
    if (ship === e.ship && owned === e.owned) return;
    e.ship = ship;
    e.owned = owned;
    e.profile = meterProfile({ ship: ship ?? null, skills: owned });
    e.state = clampMeters(e.state, e.profile);
  }

  /** The meters' place for an entity: its frame and world position in its zone's system at the zone's last tick. */
  private environment(zone: Zone, frame: string | null, pos: readonly number[], foot: boolean): MeterEnvironment {
    let cached = this.poses.get(zone);
    if (!cached || cached.tick !== zone.tick) this.poses.set(zone, (cached = { tick: zone.tick, poses: systemPoses(zone.system, zone.time) }));
    const key = frameKeyOf(zone.system, frame);
    if (key === undefined) return NOWHERE;
    const world = zone.toWorld(frame, [pos[0]!, pos[1]!, pos[2]!]);
    return meterEnvironment(zone.system, cached.poses.bodies, { frame: key, world, foot });
  }

  // ---------- pushes ----------

  private maybePush(characterId: string, e: Entry, now: number): void {
    if (e.events.length || !e.pushed) return this.push(characterId, e, now);
    const v = viewOf(e);
    const p = e.pushed;
    const moved = Math.abs(v.heat - p.heat) > 0.01 || Math.abs(v.charge - p.charge) > 0.01;
    const capacities = v.heatMax !== p.heatMax || v.chargeMax !== p.chargeMax || v.overheated !== p.overheated;
    if (capacities || (moved && now - e.pushedAt >= METER_PUSH_S)) this.push(characterId, e, now);
  }

  private push(characterId: string, e: Entry, now: number, notice?: MeterNotice): void {
    const view = viewOf(e);
    e.events = [];
    e.pushed = view;
    e.pushedAt = now;
    // one failing listener must neither undo the change nor keep it from the others
    for (const l of this.listeners) {
      try {
        l(characterId, view, notice);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }

  private entry(characterId: string): Entry {
    const e = this.entries.get(characterId);
    if (!e) throw new MetersNotHeldError(characterId);
    return e;
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function save(e: Entry): MeterSave {
  return { heat: e.state.heat, overheated: e.state.overheated, charge: e.state.charge, at: e.at };
}

function viewOf(e: Entry): MeterView {
  const p = e.profile;
  return {
    heat: Math.min(p.heatCapacity, round3(e.state.heat)),
    heatMax: p.heatCapacity,
    overheated: e.state.overheated,
    charge: Math.min(p.chargeCapacity, round3(e.state.charge)),
    chargeMax: p.chargeCapacity,
    at: e.at,
  };
}
