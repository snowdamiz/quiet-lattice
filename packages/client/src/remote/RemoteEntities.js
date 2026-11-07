// Remote players and NPC ships, drawn from zone snapshots (DESIGN 17; docs/ARCHITECTURE.md §4, §5, §9 "Remote entities").
//
// Each snapshot Net applies adds a sample per entity to that entity's PoseBuffer, in the entity's own frame of reference
// (a sample in another frame re-expresses the ones held, at their own times). Each frame the layer reads every buffer at
// the render time (PlaybackClock: world time less the snapshots' trip and a 100 ms delay), and places the pose through
// its frame as the frame stands now (game.time): an entity riding a moon stays on the moon as drawn, wherever the camera
// is. What would make a drawn entity jump (a frame change: the two frames have moved apart over the delay; a late sample
// that ends an extrapolation) is caught as the sample arrives and taken up by an offset that dies away, critically damped
// with time constant BLEND_S, from where and as fast as the entity was being drawn; a teleport or a change of what the
// entity is (a cut) is shown as the jump it is.
//
// Drawn: players flying, landed or docked as their ship, and `ship` entities (NPC ships, cutscene actors), by hull
// (RemoteShips; a snapshot without one is the Lark every pilot starts in). Players on foot are hidden until the body rig
// (P1.E05.T04); creatures (`mob` entities) are drawn by Fauna (P1.E08.T09), from the same pose buffers; npcs (walkers) and
// props wait for the body rig and a prop catalog, loot and pods for P1.E06.T03: none of them is followed here.
import * as THREE from 'three';
import { detectionDistance, effectiveSignature, movementSignals, shipStats } from '@astra/shared/ships';
import { coverAtObjects } from '@astra/shared/world';
import { SnapshotStore } from '../net/snapshots.js';
import { networkFrameOf } from '../net/pose.js';
import { PoseBuffer } from './buffer.js';
import { framesApartAt } from './frames.js';
import { PlaybackClock } from './clock.js';
import { RemoteShips } from './RemoteShips.js';

/** The entity kinds this layer follows. */
export const FOLLOWED = new Set(['player', 'ship', 'mob']);
/** The time constant (s) a drawn jump is blended out with (critically damped: mostly gone in 4 of them). */
export const BLEND_S = 0.2;
/** A drawn jump larger than this (m) is no motion to blend: it is shown... */
export const SNAP_M = 2000;
/** ...unless it is within this many seconds of the entity's speed, or (at a frame change) of how fast its old and new
 * frames move apart where it is: the render delay and the trip, and the up to a second a hitch can leave a client's
 * world time behind the server's before it steps (a planet's frame and the system's part at up to ~5 km/s at the edge of
 * the planet's sphere, its orbit and its spin together). */
export const SNAP_S = 1.2;

/** The largest drawn jump blended rather than shown, for an entity at `speed` (m/s) or frames `apart` (m/s). */
export const snapLimit = (speed, apart = 0) => Math.max(SNAP_M, SNAP_S * Math.max(speed, apart));
/** The box a ship fills (its own space, m) for its marker while its hull's model is not yet loaded: about a Lark's. */
const DEFAULT_BOX = new THREE.Box3(new THREE.Vector3(-6, -2, -7), new THREE.Vector3(6, 2, 7));
const nearer = (a, b) => a.markerDist - b.markerDist;
/** A pilot once picked up stays marked out to this many times its reach (and is picked up again only within it), and
 * for PICKUP_HOLD_S after it last was (a ship easing off its boost does not drop out and back as its speed wavers). */
export const PICKUP_KEEP = 1.05;
export const PICKUP_HOLD_S = 0.5;
/** The hull of a player or ship whose snapshot names none: the Lark every pilot starts in (DESIGN 10.1). */
export const DEFAULT_HULL = 'lark';

const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _rate = new THREE.Vector3();
const _k = new THREE.Vector3();

/** One remote entity as this client follows it. */
class Remote {
  constructor(id) {
    this.id = id;
    this.kind = null;
    this.name = null;
    this.people = null;
    this.hull = DEFAULT_HULL;
    /** a creature's species (its index in its world's list), level, health (0-1) and attack phase, as last sent */
    this.species = null;
    this.level = null;
    this.hp = null;
    this.attack = null;
    this.buf = new PoseBuffer();
    /** the buffer's pose at the render time (frame, pos, quat, vel, mode, since) */
    this.pose = { frame: null, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), mode: null, since: -Infinity };
    /** what the buffer last said ('empty', 'early', 'interpolate', 'extrapolate', 'hold') */
    this.status = 'empty';
    /** added to the pose's position, in its frame's axes: a jump being blended out, and its rate */
    this.offset = new THREE.Vector3();
    this.offsetRate = new THREE.Vector3();
    this.cutSince = -Infinity;
    /** as drawn: the frame, the position in it, and the world position and orientation */
    this.frame = null;
    this.pos = new THREE.Vector3();
    this.world = new THREE.Vector3();
    this.worldQuat = new THREE.Quaternion();
    /** whether it is to be seen (its kind, mode, hull and frame allow it), and whether it was drawn (in view) */
    this.shown = false;
    this.drawn = false;
    /** the snapshot it was last in, and the server time it left the snapshots at (null while in them) */
    this.seen = 0;
    this.goneAt = null;
    /** the view's own state for it (gear, engines) */
    this.vis = null;
  }
}

const toWorld = (frame, local, out) => (frame ? frame.localToWorld(local, out) : out.copy(local));
const toLocal = (frame, world, out) => (frame ? frame.worldToLocal(world, out) : out.copy(world));
/** Direction `v`, in frame `from`'s axes, in frame `to`'s, in place. */
function turn(v, from, to) {
  if (from === to) return v;
  if (from) from.dirToWorld(v, v);
  return to ? to.dirToLocal(v, v) : v;
}

export class RemoteEntities {
  /** `view` draws the ships (RemoteShips; tests give a stand-in) and `fauna` the creatures (the game's Fauna). */
  constructor(game, { view = new RemoteShips(game), fauna = game.fauna ?? null } = {}) {
    this.game = game;
    this.view = view;
    this.fauna = fauna;
    this.group = view.group;
    this.byId = new Map();
    this.list = [];
    this.clock = new PlaybackClock();
    /** the time (on the snapshots' server clock) entities are drawn at this frame */
    this.renderTime = -Infinity;
    /** the server's clock as this client reads it, which snapshot arrivals are timed by (Net's estimate when attached,
     * else world time) */
    this.serverNow = () => game.time;
    /** the system the buffered frames belong to */
    this.system = null;
    this.stamp = 0;
    /** the store of snapshots fed without a server (feed) */
    this.offline = null;
    /** a recorded stream played into feed() as world time passes (replay.js), for the dev captures */
    this.replay = null;
    this.detach = null;
    /** hull id → its stats (signature) as markers read them */
    this.stats = new Map();
    /** the pilots markers() picks up this frame, and what it tells their signature (kept, to allocate nothing) */
    this.seen = [];
    this.signals = { detector: 'player', inCover: false, boosting: false, pulsing: false };
  }

  /** Follows `net`'s snapshots (and forgets everything at each welcome and zone change, where entity ids start over). */
  attach(net) {
    this.detach?.();
    this.reset();
    const offs = [
      net.on('snapshot', () => this.ingest(net.store.entities, net.store.time, net.serverTime() ?? this.game.time, net.entityId)),
      net.on('welcome', () => this.reset()),
      net.on('zone', () => this.reset()),
    ];
    this.serverNow = () => net.serverTime() ?? this.game.time;
    // (the hull every pilot starts in, made ready before the first other pilot comes into view)
    this.view.prepare?.(DEFAULT_HULL);
    this.detach = () => {
      for (const off of offs) off();
      this.serverNow = () => this.game.time;
      this.detach = null;
    };
  }

  reset() {
    this.byId.clear();
    this.list.length = 0;
    this.clock.reset();
    this.renderTime = -Infinity;
    this.offline = null;
  }

  /** The entity with zone id `id`, as followed (undefined when it is not). */
  get(id) {
    return this.byId.get(id);
  }

  /**
   * The other pilots' ships a ship's sensors at world position `here`, of range `range`, pick up (DESIGN 10.1, as for
   * any ship: within the range × the ship's signature as a player reads it, halved in cover, doubled boosting or on the
   * pulse drive): `add(name, world, box, quat, id)` for each, nearest first (the HUD gives the nearer the room for its
   * name): where the ship is, the box it fills in its own space and how it is turned, from which the HUD sets the marker
   * on its bounds on screen, and its id (the HUD fades a marker in and out by it). A ship once picked up is kept until
   * PICKUP_KEEP past its reach and PICKUP_HOLD_S after, so one at the edge of it is not marked and unmarked frame by
   * frame; a hidden one (signature 0) goes at once. Pilots on foot have no marker. Each pilot's `sense` says how its sensors read it (the dev captures show it).
   */
  markers(here, range, add) {
    const seen = this.seen;
    seen.length = 0;
    for (const r of this.list) {
      if (r.kind !== 'player' || !r.shown || !this.sense(r, here, range)) continue;
      seen.push(r);
    }
    seen.sort(nearer);
    for (const r of seen) add(r.name ?? 'Pilot', r.world, this.view.boxOf?.(r.hull) ?? DEFAULT_BOX, r.worldQuat, r.id);
  }

  /** How a ship's sensors at `here`, of range `range`, read pilot `r` (its `sense`: distance, reach, signature and what
   * raised or lowered it, detected); whether they pick it up. */
  sense(r, here, range) {
    const stats = this.statsOf(r.hull);
    const s = (r.sense ??= { distance: 0, reach: 0, signature: 0, boosting: false, pulsing: false, inCover: false, detected: false, heldTill: 0 });
    if (!stats) return (s.detected = false);
    const sig = this.signals;
    const mode = r.pose.mode === 'pulse' ? 'pulse' : r.pose.mode === 'landed' || r.pose.mode === 'docked' ? r.pose.mode : 'space';
    const moving = movementSignals(stats, mode, r.pose.vel.length());
    sig.inCover = this.inCover(r.world);
    sig.boosting = moving.boosting;
    sig.pulsing = moving.pulsing;
    s.signature = effectiveSignature(stats, sig);
    s.boosting = sig.boosting;
    s.pulsing = sig.pulsing;
    s.inCover = sig.inCover;
    s.distance = r.world.distanceTo(here);
    s.reach = detectionDistance(range, s.signature);
    const now = this.game.time;
    const inReach = s.signature > 0 && s.distance <= s.reach * (s.detected ? PICKUP_KEEP : 1);
    if (inReach) s.heldTill = now + PICKUP_HOLD_S;
    // (held while the time is within the hold: a clock set back drops it)
    s.detected = inReach || (s.detected && s.signature > 0 && now < s.heldTill && s.heldTill - now <= PICKUP_HOLD_S);
    r.markerDist = s.distance;
    return s.detected;
  }

  // A hull's stats as it leaves the yard (its signature is the hull's own), once per hull; null for no hull known.
  statsOf(hull) {
    if (!this.stats.has(hull)) {
      let stats = null;
      try {
        stats = shipStats({ hull, modules: {}, cargoPods: 0, livery: 0 });
      } catch {
        // (a hull the data does not know)
      }
      this.stats.set(hull, stats);
    }
    return this.stats.get(hull);
  }

  inCover(world) {
    const g = this.game;
    return !g.universe?.deep && !g.universe?.dormant && !!this.system?.description && !!coverAtObjects(this.system.description, this.system.planets, world);
  }

  /** Applies a decoded snapshot without a server (a recorded stream, tests), as Net's store would, `arrival` being the
   * server time it arrived at. False when the store could not apply it. */
  feed(snap, arrival = this.serverNow()) {
    const store = (this.offline ??= new SnapshotStore());
    if (!store.apply(snap)) return false;
    this.ingest(store.entities, store.time, arrival, null);
    return true;
  }

  /** The entities a snapshot taken at server time `time` left in the store (`entities`, id → EntityState), arrived at
   * server time `arrival`; `ownId` is the player's own entity. */
  ingest(entities, time, arrival, ownId) {
    this.checkSystem();
    this.clock.arrived(time, arrival);
    const stamp = ++this.stamp;
    for (const e of entities.values()) {
      if (e.id === ownId || !FOLLOWED.has(e.kind)) continue;
      let r = this.byId.get(e.id);
      if (!r) {
        r = new Remote(e.id);
        this.byId.set(e.id, r);
        this.list.push(r);
      }
      r.seen = stamp;
      r.goneAt = null;
      r.kind = e.kind;
      r.name = e.name ?? null;
      r.people = e.people ?? null;
      r.hull = e.hull ?? DEFAULT_HULL;
      r.species = e.species ?? null;
      r.level = e.level ?? null;
      r.hp = e.hp ?? null;
      r.attack = e.attack ?? null;
      this.addSample(r, e, time);
    }
    for (const r of this.list) if (r.seen !== stamp && r.goneAt === null) r.goneAt = time;
  }

  addSample(r, e, time) {
    const frame = this.system ? networkFrameOf(this.game, e.frame) : undefined;
    // (a frame of no system this client has: it is not in the zone's system, warped away or between the stars)
    if (frame === undefined) {
      r.buf.clear();
      settle(r);
      return;
    }
    // where it is drawn now and how fast it moves in its frame, so that a change the sample makes there is blended out
    // rather than jumped
    const drawn = r.buf.length > 0 && this.renderTime > -Infinity;
    const was = r.buf.frame;
    if (drawn) {
      rateOf(r, r.buf.sample(this.renderTime, r.pose), _rate).add(r.offsetRate);
      toWorld(was, _l.copy(r.pose.pos).add(r.offset), _w);
    }
    const result = r.buf.push(time, frame, e.pos, e.quat, e.vel, e.mode ?? null);
    if (!drawn || result === 'stale' || result === 'repeat') return;
    const status = r.buf.sample(this.renderTime, r.pose);
    const apart = r.buf.frame === was ? 0 : framesApartAt(was, r.buf.frame, _w);
    const limit = snapLimit(Math.max(_rate.length(), r.buf.newest.vel.length()), apart);
    const off = toLocal(r.buf.frame, _w, _l).sub(r.pose.pos);
    // (what this sample changes, the blend already running aside, is what may be too large to blend)
    const running = turn(_k.copy(r.offset), was, r.buf.frame);
    if (off.distanceTo(running) > limit) return settle(r);
    r.offset.copy(off);
    // (rates in two frames are not comparable: across a frame change the blend keeps the rate it had, turned into the new
    // axes, which is what the drawn motion does there, both frames carrying the entity alike over the delay)
    if (r.buf.frame === was) r.offsetRate.copy(_rate).sub(rateOf(r, status, _l));
    else turn(r.offsetRate, was, r.buf.frame);
  }

  /** Each frame: the render time moves on, every entity is placed and the view draws them. */
  update(dt) {
    this.checkSystem();
    // (on world time, which the bodies stand at; the bodies already stand at this frame's time, so the render time moves
    // on before a recorded stream delivers: a sample's blend is worked out with the frames and the render time of one
    // frame, as a live snapshot's is between frames)
    const now = this.game.time;
    const tr = (this.renderTime = this.clock.advance(now));
    this.replay?.update(now, this);
    const step = Math.max(0, dt);
    const fade = Math.exp(-step / BLEND_S);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (r.goneAt !== null && tr >= r.goneAt) {
        this.remove(i);
        continue;
      }
      const status = (r.status = r.buf.sample(tr, r.pose));
      if (status === 'empty') {
        r.shown = false;
        continue;
      }
      // past a cut it is where the cut put it, with nothing left to blend
      if (r.pose.since > r.cutSince) {
        r.cutSince = r.pose.since;
        settle(r);
      }
      // the offset dies away critically damped: x(t) = (x0 + (v0 + x0/T) t) e^(-t/T), its rate v(t) = (v0 - (v0 + x0/T) t/T) e^(-t/T)
      _k.copy(r.offsetRate).addScaledVector(r.offset, 1 / BLEND_S);
      r.offset.addScaledVector(_k, step).multiplyScalar(fade);
      r.offsetRate.addScaledVector(_k, -step / BLEND_S).multiplyScalar(fade);
      r.frame = r.pose.frame;
      r.pos.copy(r.pose.pos).add(r.offset);
      toWorld(r.frame, r.pos, r.world);
      if (r.frame) r.worldQuat.copy(r.frame.quaternion).multiply(r.pose.quat);
      else r.worldQuat.copy(r.pose.quat);
      r.shown = r.kind === 'mob' ? !!this.fauna?.draws(r) : (r.kind !== 'player' || r.pose.mode !== 'foot') && this.view.draws(r.hull);
      if (r.shown && r.pose.mode === 'landed') this.setDown(r);
    }
    this.view.update(this.list, dt);
    this.fauna?.update(this.list, dt);
  }

  // A ship set down on a world flattens the plants under it, as the player's does (Ship.touchDown), once where it sits.
  setDown(r) {
    const flora = this.game.flora;
    if (!r.frame?.sampler || flora?.planet !== r.frame) return;
    if (r.landedAt && r.landedAt.frame === r.frame && r.landedAt.pos.distanceTo(r.pos) < 5) return;
    r.landedAt = { frame: r.frame, pos: r.pos.clone() };
    flora.clearAround(r.pos, 11, 3.5);
  }

  remove(i) {
    const r = this.list[i];
    this.byId.delete(r.id);
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
  }

  // The buffered frames are the system's bodies: another system (a warp, a jump) leaves none of them in place.
  checkSystem() {
    if (this.game.system === this.system) return;
    this.system = this.game.system ?? null;
    for (const r of this.list) {
      r.buf.clear();
      settle(r);
      r.shown = false;
    }
  }
}

// Nothing left to blend.
function settle(r) {
  r.offset.set(0, 0, 0);
  r.offsetRate.set(0, 0, 0);
}

// How fast the pose the buffer gave (with `status`) moves in its frame: not at all where it is held.
function rateOf(r, status, out) {
  return status === 'interpolate' || status === 'extrapolate' ? out.copy(r.pose.vel) : out.set(0, 0, 0);
}
