// Scripted-take helpers (dev only): walking, flying and landing on autopilot for the recorded
// single-take gameplay video. `install()` puts them on window for the browser console.
import * as T from 'three';

export function install() {
  const game = window.game;
  const dev = window.dev;
  // record a frame, then let the worker pool catch up (or not too far behind, when flying fast)
  const tickP = async (stride = 2) => {
    await dev.tick(stride);
    let w = 0;
    while (game.pool.pending() > 40 && w++ < 80) {
      game.pool.update();
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const tickF = async (stride = 2) => {
    await dev.tick(stride);
    let w = 0;
    while (game.pool.pending() > 120 && w++ < 10) {
      game.pool.update();
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const pp = () => game.player.state.pos;
  const onGround = (dir) => dir.clone().normalize().multiplyScalar(game.system.homePlanet.surfaceRadius(dir.clone().normalize()));
  const tallNear = (p, r) => {
    let n = 0;
    for (const inst of game.flora.instancesNear(p, r, (sp) => !sp.grass && (sp.height > 1.2 || sp.rock || sp.deposit || sp.collide))) n++;
    return n;
  };
  // what stands in the way of a straight walk from a to b, nearest first
  const pathBlockers = (a, b, pad = 0.9) => {
    const F = game.flora;
    const up = a.clone().normalize();
    const dir = b.clone().sub(a);
    dir.addScaledVector(up, -dir.dot(up));
    const len = dir.length();
    dir.normalize();
    const out = [];
    const test = (pos, r, inst) => {
      const rel = pos.clone().sub(a);
      const t = rel.dot(dir);
      if (t < -r || t > len + r) return;
      const lat = rel.clone().addScaledVector(dir, -t);
      lat.addScaledVector(up, -lat.dot(up));
      if (lat.length() < r) out.push({ inst: inst || { pos }, r, t, lat });
    };
    for (const inst of F.instancesNear(a.clone().lerp(b, 0.5), len / 2 + 6, (sp) => sp.collide || sp.rock || sp.name === 'bush'))
      test(inst.pos, inst.sp.hitRadius * inst.scale + pad + (inst.sp.name === 'bush' ? 0.8 : 0), inst);
    for (const c of game.fauna.creatures) if (c.sp.kind !== 'flyer' && c.pos.distanceTo(a) < len + 12) test(c.pos, c.sp.size * c.scale * 0.6 + 1.6, { pos: c.pos });
    const sh = game.ship.state;
    if (game.ship.mode === 'landed' && sh.frame === game.system.homePlanet && b.distanceTo(sh.pos) > 12) test(sh.pos, 10, null);
    return out.sort((x, y) => x.t - y.t);
  };
  // walk to tgt, stepping round whatever is in the way; lookAt takes over the view near the end
  const steerWalk = async (tgt, { stop = 2, max = 600, stride = 2, lookAt = null, lookFrom = 0, gain = 0.12 } = {}) => {
    const p = pp();
    let i = 0;
    const last = p.clone();
    let side = 0;
    let sideKey = 'KeyD';
    let best = p.distanceTo(tgt);
    let since = 0;
    dev.key('KeyW', true);
    for (; i < max; i++) {
      const d = p.distanceTo(tgt);
      if (d < stop) break;
      if (d < best - 0.5) {
        best = d;
        since = 0;
      } else if (++since > 45) break;
      const up = p.clone().normalize();
      let way = tgt;
      const ahead = p.clone().lerp(tgt, Math.min(1, 9 / d));
      const bl = pathBlockers(p, ahead);
      if (bl.length) {
        const b = bl[0];
        const away = b.lat.length() > 0.05 ? b.lat.clone().normalize().negate() : tgt.clone().sub(p).cross(up).normalize();
        way = b.inst.pos.clone().addScaledVector(away, b.r + 1.4);
      }
      const look = lookAt && d < lookFrom ? lookAt() : way.clone().addScaledVector(way.clone().normalize(), 1.2);
      dev.footAim(look, gain);
      await tickP(stride);
      if (i % 15 === 14) {
        if (p.distanceTo(last) < 0.6 && !side) {
          side = 25;
          sideKey = sideKey === 'KeyD' ? 'KeyA' : 'KeyD';
          dev.key(sideKey, true);
        }
        last.copy(p);
      }
      if (side && --side === 0) dev.key(sideKey, false);
    }
    dev.key('KeyW', false);
    dev.key('KeyA', false);
    dev.key('KeyD', false);
    return { d: +p.distanceTo(tgt).toFixed(1), i };
  };
  // waypoints round a site on a ring of `radius` from one side to another
  const ringPath = (site, fromPos, toPos, radius) => {
    const P = game.system.homePlanet;
    const up = site.dir.clone();
    const t1 = new T.Vector3(0, 1, 0).cross(up).normalize();
    const t2 = up.clone().cross(t1);
    const ang = (p) => {
      const r = p.clone().sub(site.pos);
      return Math.atan2(r.dot(t2), r.dot(t1));
    };
    const a0 = ang(fromPos);
    let da = ang(toPos) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.45));
    const pts = [];
    for (let i = 1; i <= steps; i++) {
      const a = a0 + (da * i) / steps;
      const d = site.pos.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius).normalize();
      pts.push(d.multiplyScalar(P.surfaceRadius(d)));
    }
    return pts;
  };
  // gliding descent towards window.landTarget, cutting to the cockpit for a while on the way
  const G = { cockpitDone: false, cockpitTicks: -1, done: false };
  const glideStep = async (limitMs) => {
    const P = game.ship.state.frame;
    const t0 = performance.now();
    const tapV = async () => {
      dev.key('KeyV', true);
      await dev.sim(1);
      dev.key('KeyV', false);
      await dev.sim(1);
    };
    let distT = 0;
    dev.key('KeyW', true);
    for (let i = 0; i < 1400 && !G.done; i++) {
      const s = game.ship.state;
      const up = s.pos.clone().normalize();
      distT = Math.acos(Math.min(1, up.dot(window.landTarget))) * P.radius;
      const bearing = window.landTarget.clone().sub(up.clone().multiplyScalar(up.dot(window.landTarget))).normalize();
      const alt = game.ship.altitude;
      const L = Math.min(2500, Math.max(800, distT * 0.4));
      const want = (d) => 260 + Math.max(0, d) * 0.35;
      dev.shipAim(dev.ahead(L, Math.min(alt, want(distT - L)), bearing), 10, 16);
      dev.key('ShiftLeft', alt > 3500 && distT > 6000);
      if (!G.cockpitDone && G.cockpitTicks < 0 && alt < 3200) {
        await tapV();
        await tapV();
        G.cockpitTicks = 0;
        G.cockN = dev.rec.n;
      }
      if (G.cockpitTicks >= 0 && !G.cockpitDone && ++G.cockpitTicks > 110) {
        await tapV();
        G.cockpitDone = true;
        G.outN = dev.rec.n;
      }
      if (alt > 4500) await dev.tick(3);
      else await tickP(2);
      if (G.cockpitDone && distT < 1600) G.done = true;
      if (performance.now() - t0 > limitMs) break;
    }
    dev.key('ShiftLeft', false);
    await dev.flush();
    return { n: dev.rec.n, alt: Math.round(game.ship.altitude), distT: Math.round(distT), spd: Math.round(game.ship.speed), G, cv: game.camView };
  };
  // slow down, settle and press E over window.landTarget
  const L = { pressed: false };
  const landStep = async (limitMs) => {
    const P = game.ship.state.frame;
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const s = game.ship.state;
      const up = s.pos.clone().normalize();
      const dT = Math.acos(Math.min(1, up.dot(window.landTarget))) * P.radius;
      const bearing = window.landTarget.clone().sub(up.clone().multiplyScalar(up.dot(window.landTarget))).normalize();
      const alt = game.ship.altitude;
      const spd = Math.abs(game.ship.speed);
      if (!L.pressed) {
        const tgtAlt = Math.min(alt, 60 + dT * 0.3);
        dev.shipAim(dev.ahead(Math.max(300, dT), Math.max(40, tgtAlt - 25), bearing), 10, 16);
        const want = Math.max(28, Math.min(200, dT * 0.3 + Math.max(0, alt - 140) * 0.12));
        dev.key('KeyW', spd < want - 12);
        dev.key('KeyS', spd > want + 12);
        if (dT < 90 && alt < 170 && spd < 70 && !game.ship.overWater()) {
          dev.key('KeyS', false);
          dev.key('KeyW', false);
          dev.key('KeyE', true);
          await tickP(2);
          dev.key('KeyE', false);
          L.pressed = true;
          L.pressN = dev.rec.n;
        }
      }
      await tickP(2);
      if (game.ship.mode === 'landed') {
        L.landed = true;
        break;
      }
      if (performance.now() - t0 > limitMs) break;
    }
    if (L.landed && !L.settled) {
      L.settled = true;
      dev.key('KeyW', false);
      dev.key('KeyS', false);
      for (let i = 0; i < 25; i++) await tickP(2);
    }
    await dev.flush();
    const up = game.ship.state.pos.clone().normalize();
    return { n: dev.rec.n, mode: game.ship.mode, L, alt: Math.round(game.ship.altitude), dT: Math.round(Math.acos(Math.min(1, up.dot(window.landTarget))) * P.radius), spd: Math.round(game.ship.speed) };
  };
  Object.assign(window, { T, tickP, tickF, pp, onGround, tallNear, pathBlockers, steerWalk, ringPath, G, glideStep, L, landStep });
}
