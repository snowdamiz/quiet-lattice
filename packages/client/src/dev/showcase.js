// Scripted-take helpers for the features showcase video (dev only): jump to a world, pick the hour,
// put the ship somewhere with a heading and a speed, caption the shot, and record frames while the
// terrain workers keep up. `install()` puts them on window.show for the browser console.
import * as THREE from 'three';
import { cityFrame, cityPoint } from '../terrain/cities.js';

export function install() {
  const game = window.game;
  const dev = window.dev;
  const V = THREE.Vector3;

  // advance without capturing until the chunk queue is empty (or `ms` runs out)
  const settle = async (ms = 15000) => {
    const t0 = performance.now();
    let k = 0;
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 20));
      await dev.sim(1);
      if (++k > 10 && game.pool.pending() === 0) break;
    }
    return game.pool.pending();
  };

  const load = (si, name) => {
    const sys = game.galaxy.systems[si];
    let built = null;
    if (sys !== game.system.info) {
      const it = game.buildSystem(sys);
      let r;
      while (!(r = it.next()).done);
      built = r.value;
    }
    const planets = (built ? built.system : game.system).planets;
    const i = planets.findIndex((p) => p.name === name);
    return { sys, i, built, planet: planets[i] };
  };

  const go = async (si, name, where = 'above') => {
    const L = load(si, name);
    game.teleport(L.sys, L.i, where, L.built);
    game.nextBolt = 99;
    await settle();
    return game.system.planets[L.i];
  };

  // the hour at which a planet-local direction sees the sun `dot` above its horizon (rising side)
  const sunTime = (P, dir, dot = 0.6) => {
    let best = game.time;
    let err = 9;
    const t0 = game.time;
    const sunDot = (t) => {
      game.system.update(t);
      return game.system.star.position.clone().sub(P.position).normalize().applyQuaternion(P.quaternionInv).dot(dir);
    };
    for (let k = 0; k < 720; k++) {
      const t = t0 + (k / 720) * P.rotationPeriod;
      const d = sunDot(t);
      // (rising: the sun stands a little higher a minute later)
      if (sunDot(t + 60) > d && Math.abs(d - dot) < err) {
        err = Math.abs(d - dot);
        best = t;
      }
    }
    game.time = best;
    game.system.update(best);
    return best;
  };

  // the ship at a planet-local direction, `alt` m above the ground, nose along `fwd` (tangent),
  // pitched by `pitch` rad, flying at `speed` m/s
  const placeShip = (P, dir, fwd, alt, speed = 0, pitch = 0) => {
    const s = game.ship.state;
    const up = dir.clone().normalize();
    const f = fwd.clone().addScaledVector(up, -fwd.dot(up)).normalize();
    s.frame = P;
    s.pos.copy(up).multiplyScalar(P.groundRadius(up) + alt);
    const right = new V().crossVectors(f, up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
    s.quat.setFromRotationMatrix(m);
    if (pitch) s.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new V(1, 0, 0), pitch));
    s.vel.copy(f).multiplyScalar(speed);
    game.ship.speed = speed;
    game.ship.mode = 'flying';
    if (game.mode !== 'ship') game.mode = 'ship';
    game.cam.frame = undefined;
    game.sky.reset();
  };

  // a city's frame and a point in it (u east, v north of the plaza, h above its ground)
  const city = (P, k = 0) => {
    const c = P.cities[k];
    const f = cityFrame(c);
    return { c, f, at: (u, v, h = 0) => cityPoint(c, f, P.radius, u, v, h).normalize() };
  };

  // a title over the shot, drawn into the frames with the rest of the HUD
  let cap = null;
  const caption = (title, sub = '') => {
    if (!cap) {
      cap = document.createElement('div');
      cap.style.cssText =
        'position:absolute;left:56px;bottom:64px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.65);pointer-events:none;transition:none;';
      game.hud.root.appendChild(cap);
    }
    cap.style.display = title ? 'block' : 'none';
    cap.innerHTML = title
      ? `<div style="font-family:Michroma,sans-serif;font-weight:400;font-size:30px;letter-spacing:.06em">${title}</div>` +
        (sub ? `<div style="font-family:Barlow,sans-serif;font-weight:400;font-size:16px;opacity:.85;margin-top:8px">${sub}</div>` : '')
      : '';
  };

  // record `n` frames, calling each(i) before every one; keeps the chunk queue from running away
  const rec = async (n, each = null, { stride = 2, wait = 60 } = {}) => {
    for (let i = 0; i < n; i++) {
      if (each) await each(i);
      await dev.tick(stride);
      let w = 0;
      while (game.pool.pending() > wait && w++ < 12) {
        game.pool.update();
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    await dev.flush();
    return dev.rec.n;
  };

  // no stale arrival banners left over from the jumps between shots
  const quiet = () => {
    const H = game.hud;
    H.bannerQueue = [];
    H.bannerUntil = 0;
    H.banner.classList.remove('show');
    H.toasts.innerHTML = '';
  };

  // the most broken-up ground within `range` m of a planet-local direction: where the relief is
  // (spires, peaks, canyon walls), as a direction
  const rugged = (P, dir, range = 15000, n = 40) => {
    const up = dir.clone().normalize();
    const t = new V(0, 1, 0).cross(up).normalize();
    const b = new V().crossVectors(up, t);
    const at = (x, y) => up.clone().multiplyScalar(P.radius).addScaledVector(t, x).addScaledVector(b, y).normalize();
    let best = null;
    let score = -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = ((i + 0.5) / n - 0.5) * 2 * range;
        const y = ((j + 0.5) / n - 0.5) * 2 * range;
        const d = at(x, y);
        const h = P.heightAt(d);
        if (h < 5) continue;
        let lo = h;
        for (const [dx, dy] of [[90, 0], [-90, 0], [0, 90], [0, -90]]) lo = Math.min(lo, P.heightAt(at(x + dx, y + dy)));
        if (h - lo > score) {
          score = h - lo;
          best = d;
        }
      }
    }
    return { dir: best, drop: score };
  };

  // nose toward a world-space point (no roll: up stays as near the old up as it can)
  const aimAt = (world) => {
    const s = game.ship.state;
    const wp = s.worldPosition(new V());
    const fwd = world.clone().sub(wp).normalize();
    const parentInv = s.frame ? s.frame.quaternionInv ?? s.frame.quaternion.clone().invert() : new THREE.Quaternion();
    const f = fwd.clone().applyQuaternion(parentInv);
    const up0 = new V(0, 1, 0).applyQuaternion(s.quat);
    const right = new V().crossVectors(f, up0).normalize();
    const up = new V().crossVectors(right, f).normalize();
    s.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f.clone().negate()));
  };

  // cruise toward a star system without drawing (the sky catches up over the next few frames):
  // `until(d)` gets the remaining distance in ly and ends the run when it returns true
  const cruise = (sys, until, maxSteps = 40000) => {
    const ship = game.ship;
    const draw = game.renderFrame;
    game.renderFrame = function () {
      this.pool.update();
    };
    let d = 0;
    try {
      for (let k = 0; k < maxSteps; k++) {
        aimAt(game.universe.sysWorld(sys));
        if (ship.mode !== 'pulse') ship.tryPulse();
        dev.realFrame(0.25);
        d = game.universe.hereLy().distanceTo(new V(sys.x, sys.y, sys.z));
        if (until(d)) break;
      }
    } finally {
      game.renderFrame = draw;
    }
    return d;
  };

  window.show = { settle, load, go, sunTime, placeShip, city, caption, rec, quiet, rugged, aimAt, cruise, V, THREE };
  return window.show;
}
