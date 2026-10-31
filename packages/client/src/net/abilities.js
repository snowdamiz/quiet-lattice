// The client's side of abilities (docs/ARCHITECTURE.md §28): casts are the server's to decide. A key press sends a `cast`
// for the node the player sees in that slot of the bar its mode casts from (the ground bar on foot, the ship's in flight),
// with where it looks and, for an ability that names one, the entity it is looking at. The bars come with the `skills`
// view, the cooldowns and toggles as the server's `abilities` state, and its answers say why a cast did nothing. Every
// cast the server carried out that the player can see arrives as a `cast` event, which plays the effect a branch
// registered for its node (`registerAbilityFx`). Nothing here decides a cooldown, a cost or a hit.
import * as THREE from 'three';
import { ABILITIES, barOfMode, cooldownOf, reachOf } from '@astra/shared/abilities';
import { getSkillNode } from '@astra/shared/data';
import { BAR_SLOTS } from '@astra/shared/skills';
import { frameIdOfFrame, moveModeOf } from './pose.js';

const _aim = new THREE.Vector3();
const _up = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Keys 1–6: a bar's slots in order (DESIGN 9.1: six on the ground, the hull's two to five in flight). */
export const CAST_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
/** How long a cast shows as sent while its answer has not come, ms. */
export const ANSWER_WAIT_MS = 3000;
/** How long the slot a refusal answered shows it, ms. */
export const REFUSAL_SHOWN_MS = 1600;
/** How far off the aim an `entity` cast looks for what it names, degrees. */
export const TARGET_CONE_DEG = 8;
/** The eye over a walker's feet, m (Player's EYE_HEIGHT, the server's EYE_M). */
const EYE_M = 1.6;

/** Effects by node: what a branch draws when a cast of its node is seen. Each is `{ cast(event, game), end?(event, game) }`. */
const FX = new Map();

/** Registers what a node's cast looks like (P1.E07.T04–T10, art P1.E07.T14). One effect a node. */
export function registerAbilityFx(node, fx) {
  if (FX.has(node)) throw new Error(`${node} has an effect already`);
  FX.set(node, fx);
  return () => FX.delete(node);
}

/** Plays a cast event's effect, if its node has one registered. */
export function playAbilityFx(game, event) {
  const fx = FX.get(event.node);
  const fn = event.phase === 'end' ? fx?.end : fx?.cast;
  fn?.call(fx, event, game);
}

/** A node's cooldown as the HUD reads it: the node whose clock it runs on, and its length, s (null: none it can show). */
function cooldownFor(node) {
  try {
    return cooldownOf(getSkillNode(node));
  } catch {
    return null;
  }
}

/** The character's bars, cooldowns and toggles as the server last said, and its casts on their way. */
export class Abilities {
  constructor({ now = () => performance.now() } = {}) {
    this.now = now;
    this.net = null;
    this.unlink = null;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.bars = { ground: Array(BAR_SLOTS.ground).fill(null), ship: Array(BAR_SLOTS.ship).fill(null) };
    /** the ship bar's working slots (the flown hull's ability slots) */
    this.shipSlots = 0;
    /** node (the clock it runs on) → world time it is ready again */
    this.cooldowns = new Map();
    this.on = new Set();
    /** seq → { bar, slot, node, at } */
    this.pending = new Map();
    /** the last refusal: { bar, slot, node, reason, at } */
    this.refusal = null;
    /** the last cast carried out: { bar, slot, node, at } */
    this.lastCast = null;
    this.seq = 0;
  }

  /** Follows a connection's messages (null: none). Each session numbers its casts from 1. */
  link(net) {
    this.unlink?.();
    this.net = net;
    this.reset();
    if (!net) return;
    const offs = [
      net.on('welcome', () => this.reset()),
      net.on('skills', (m) => this.skills(m.skills)),
      net.on('abilities', (m) => this.state(m)),
      net.on('cast', (m) => this.answer(m)),
      net.on('event', ({ event }) => event.kind === 'cast' && this.event(event)),
    ];
    this.unlink = () => offs.forEach((off) => off());
  }

  /** Hears every cast event (the game plays their effects). */
  listen(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  skills(view) {
    this.bars = { ground: [...view.state.slots.ground], ship: [...view.state.slots.ship] };
    this.shipSlots = view.shipSlots;
  }

  state(m) {
    this.cooldowns = new Map(m.cooldowns.map((c) => [c.node, c.readyAt]));
    this.on = new Set(m.on);
  }

  answer(m) {
    const sent = this.pending.get(m.seq);
    this.pending.delete(m.seq);
    const bar = sent?.bar ?? null;
    if (m.result === 'refused') {
      this.refusal = { bar, slot: m.slot, node: m.node, reason: m.reason, at: this.now() };
      // (the server says how long a cooldown has left: the clock the client shows is its)
      if (m.reason === 'cooldown' && m.readyAt !== undefined) this.cooldowns.set(cooldownFor(m.node)?.key ?? m.node, m.readyAt);
    } else if (m.result === 'cast') this.lastCast = { bar, slot: m.slot, node: m.node, at: this.now() };
  }

  event(e) {
    for (const fn of this.listeners) fn(e);
  }

  /** The working slots of a bar: six on the ground, the hull's aboard. */
  count(bar) {
    return bar === 'ground' ? BAR_SLOTS.ground : Math.min(BAR_SLOTS.ship, this.shipSlots);
  }

  /** Sends a cast of what is in a bar's slot, with `intent` (castIntent's). The sent message, or null when there was nothing
   * there to cast or it did not go. */
  cast(bar, slot, intent) {
    const node = slot < this.count(bar) ? this.bars[bar][slot] : null;
    if (!node || !intent || !this.net) return null;
    const ability = ABILITIES.get(node);
    const msg = { t: 'cast', seq: this.seq + 1, time: intent.time, node, slot, frame: intent.frame, aim: intent.aim };
    if (ability?.target === 'entity') {
      const target = intent.pick?.(ability, node);
      if (target !== null && target !== undefined) msg.target = target;
    }
    if (!this.net.send(msg)) return null;
    this.seq = msg.seq;
    this.pending.set(msg.seq, { bar, slot, node, at: this.now() });
    return msg;
  }

  /** What the HUD draws of a bar at world time `time`: each working slot's key, node and name, its cooldown's time left
   * and length, whether its toggle is on, a cast of it on its way, and a refusal just heard. */
  slots(bar, time) {
    const now = this.now();
    for (const [seq, p] of this.pending) if (now - p.at > ANSWER_WAIT_MS) this.pending.delete(seq);
    const out = [];
    for (let i = 0; i < this.count(bar); i++) {
      const node = this.bars[bar][i];
      const cd = node ? cooldownFor(node) : null;
      const readyAt = cd ? this.cooldowns.get(cd.key) : undefined;
      const left = readyAt === undefined ? 0 : Math.max(0, readyAt - time);
      const refused = this.refusal && this.refusal.slot === i && this.refusal.node === node && now - this.refusal.at < REFUSAL_SHOWN_MS ? this.refusal : null;
      const cast = this.lastCast && this.lastCast.slot === i && this.lastCast.node === node ? this.lastCast : null;
      out.push({
        key: i + 1,
        node,
        name: node ? getSkillNode(node).name : null,
        left,
        length: cd?.seconds ?? 0,
        on: !!node && this.on.has(node),
        sending: !!node && [...this.pending.values()].some((p) => p.bar === bar && p.slot === i),
        refused: refused?.reason ?? null,
        castAt: cast?.at ?? null,
      });
    }
    return out;
  }
}

/** The bar the game's mode casts from, as the server will judge it (`barOfMode` of the mode the input sends), or null. */
export function castBar(game) {
  if (game.mode !== 'foot' && game.mode !== 'ship') return null;
  return barOfMode(moveModeOf(game.mode, game.ship.mode, game.ship.state.frame));
}

/** A cast's intent: the world time, the frame of the pose the input sends and the aim in it (the eye's look on foot, the
 * nose in flight), and `pick`, which finds what an `entity` ability is aimed at. Null while there is no input to send (out
 * of the zone's system, between the stars). */
export function castIntent(game, bar) {
  if (!game.net?.zone || game.universe?.deep || game.system?.seed !== game.net.zone.systemSeed) return null;
  const foot = bar === 'ground';
  const st = foot ? game.player.state : game.ship.state;
  const frame = frameIdOfFrame(game.system, game.station, st.frame);
  if (frame === undefined) return null;
  if (foot) game.player.eyeForward(_aim);
  else _aim.set(0, 0, -1).applyQuaternion(st.quat);
  const aim = [_aim.x, _aim.y, _aim.z];
  const eye = foot ? st.pos.clone().addScaledVector(game.player.up(_up), EYE_M) : st.pos.clone();
  return { time: game.time, frame, aim, pick: (ability, node) => pickTarget(game.net, frame, eye, _aim.clone(), ability, getSkillNode(node)) };
}

/** The entity an `entity` cast names: of a kind the ability takes, alive, in the caster's frame and within its reach of
 * the eye, nearest the aim within TARGET_CONE_DEG; null when none is. */
export function pickTarget(net, frame, eye, aim, ability, node) {
  const reach = reachOf(ability, node);
  const cos = Math.cos((TARGET_CONE_DEG * Math.PI) / 180);
  let best = null;
  let bestCos = cos;
  for (const [id, e] of net.store.entities) {
    if (id === net.entityId || e.frame !== frame || !ability.on?.includes(e.kind)) continue;
    if (e.mode === 'dead' || (e.hp !== undefined && !(e.hp > 0))) continue;
    _to.set(e.pos[0] - eye.x, e.pos[1] - eye.y, e.pos[2] - eye.z);
    const d = _to.length();
    if (!(d > 0) || d > reach + 3) continue;
    const c = _to.dot(aim) / (d * aim.length());
    if (c >= bestCos) {
      bestCos = c;
      best = id;
    }
  }
  return best;
}
