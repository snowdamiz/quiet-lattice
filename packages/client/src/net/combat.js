// The client's side of combat (docs/ARCHITECTURE.md §20): shots are the server's to resolve. The ship fires its tracers at
// once (cosmetic) and asks the server with a `fire` intent: where its guns point, in the frame its pose is in, at the time
// it fired. Damage, deaths and loot come back as events, which the feed keeps for the HUD to show: the damage numbers of
// the player's own hits and the blows it takes, and what a kill gave it. Nothing here changes any health.
import * as THREE from 'three';
import { frameIdOfFrame } from './pose.js';

const _nose = new THREE.Vector3();

/** How long a hit stays in the feed for the HUD to show, ms. */
export const HIT_SHOWN_MS = 1200;

/** A shot of the ship's guns as the server is asked for it: the nose's direction in the frame the ship's pose is in, and
 * the world time it fired at. Null while there is no input to send (out of the zone's system, between the stars). */
export function fireIntent(game, state) {
  if (!game.net?.zone || game.universe?.deep || game.system?.seed !== game.net.zone.systemSeed) return null;
  const frame = frameIdOfFrame(game.system, game.station, state.frame);
  if (frame === undefined) return null;
  _nose.set(0, 0, -1).applyQuaternion(state.quat);
  return { time: game.time, frame, aim: [_nose.x, _nose.y, _nose.z] };
}

/** What the server says the player's shots did and what hit it, for the HUD: hits the player dealt (`dealt`), blows it
 * took (`taken`), and the rewards of its kills (`gained`), each taken by the HUD as it shows them. */
export class CombatFeed {
  constructor(net) {
    this.net = net;
    this.dealt = [];
    this.taken = [];
    this.gained = [];
    /** shots the server refused, by reason (a client bug if any but `rate` after a stall) */
    this.refused = {};
    net.on('event', ({ event }) => this.event(event));
    net.on('fire', (m) => {
      if (m.result === 'refused') this.refused[m.reason] = (this.refused[m.reason] ?? 0) + 1;
    });
    net.on('welcome', () => {
      this.dealt.length = this.taken.length = this.gained.length = 0;
    });
  }

  event(e) {
    const me = this.net.entityId;
    const at = this.net.now();
    if (e.kind === 'combat') {
      if (e.source === me && e.target !== me) this.push(this.dealt, { amount: e.amount, killed: e.killed, hp: e.hp ?? null, target: e.target, at });
      else if (e.target === me) this.push(this.taken, { amount: e.amount, killed: e.killed, hp: e.hp ?? null, source: e.source, at });
    } else if (e.kind === 'xp') this.push(this.gained, { what: 'xp', count: e.amount, level: e.level, at });
    else if (e.kind === 'loot') this.push(this.gained, { what: e.item, count: e.count, at });
  }

  push(list, x) {
    list.push(x);
    // (the HUD takes them each frame; a hidden page's backlog is bounded)
    if (list.length > 32) list.shift();
  }

  /** Takes what arrived since the last call. */
  take() {
    const now = this.net.now();
    const fresh = (x) => now - x.at < HIT_SHOWN_MS;
    const out = { dealt: this.dealt.filter(fresh), taken: this.taken.filter(fresh), gained: this.gained.slice() };
    this.dealt.length = this.taken.length = this.gained.length = 0;
    return out;
  }
}
