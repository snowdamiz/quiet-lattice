// Dev regression check: the core loop played through the game's own input (synthetic keys and
// mouse, no teleports): out of the station, pulse to the home world, down through the air, land,
// step out, scan, mine, analyze a creature, board, take off, climb to space, pulse back and fly
// into the hangar to dock. Each phase reports what happened; run them one by one from the console:
//   const pt = (await import('/src/dev/playthrough.js')).playthrough(); await pt.leave(); ...
import * as THREE from 'three';

export function playthrough() {
  const game = window.game;
  const dev = window.dev;
  const V = THREE.Vector3;
  const log = [];
  const trace = [];
  const t0 = game.time;
  const I = game.input;
  if (!I.locked) {
    I.fallbackLock = true;
    I.locked = true;
  }
  const note = (m) => {
    log.push(`${(game.time - t0).toFixed(0)}s ${m}`);
    return m;
  };
  // frames in small batches, yielding so worker results come through
  let n = 0;
  const frame = async (dt = 1 / 30) => {
    game.frame(dt);
    if (++n % 6 === 0) await new Promise((r) => setTimeout(r, 0));
  };
  const hold = (code, on) => dev.key(code, on);
  const tap = async (code) => {
    dev.key(code, true);
    await frame();
    dev.key(code, false);
  };
  const prompt = () => document.querySelector('.prompt')?.innerText.replace(/\n/g, ' ') || '';
  const status = () => {
    const s = game.ship;
    return `${game.mode}/${s.mode} in ${s.state.frame?.name ?? 'space'} alt ${isFinite(s.altitude) ? Math.round(s.altitude) : '-'} m, ${Math.round(s.speed)} m/s`;
  };
  const release = () => ['KeyW', 'KeyS', 'ShiftLeft'].forEach((k) => hold(k, false));
  const home = () => game.system.homePlanet;
  const shipWorld = () => game.ship.state.worldPosition(new V());
  // a point on the ground `ang` radians ahead along the ship's track
  const groundAhead = (ang) => {
    const P = home();
    const s = game.ship.state;
    const up = shipWorld().sub(P.position).normalize();
    const fwd = new V(0, 0, -1).applyQuaternion(s.worldQuaternion(new THREE.Quaternion()));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    return P.position.clone().addScaledVector(up.multiplyScalar(Math.cos(ang)).addScaledVector(fwd, Math.sin(ang)), P.radius);
  };
  const waitPool = async (max = 30000) => {
    const t = performance.now();
    while (performance.now() - t < max && game.pool.pending() > 30) {
      game.frame(1 / 60);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  return {
    log,
    trace,
    status,
    // out of the station's space and into the pulse drive, toward the home world
    async leave() {
      // clear of the station first, then round toward the ground
      const st = game.station;
      const away = shipWorld().sub(st.position).normalize().multiplyScalar(20000).add(shipWorld());
      hold('KeyW', true);
      for (let i = 0; i < 30 * 8; i++) {
        dev.shipAim(away, 10, 30);
        await frame();
      }
      let tgt = groundAhead(0.35);
      for (let i = 0; i < 30 * 4; i++) {
        dev.shipAim(tgt, 10, 30);
        await frame();
      }
      hold('KeyW', false);
      await tap('KeyJ');
      note(`J: ${game.ship.mode}`);
      for (let i = 0; i < 30 * 120 && game.ship.mode === 'pulse'; i++) {
        if (i % 15 === 0) tgt = groundAhead(0.2);
        dev.shipAim(tgt, 10, 30);
        await frame();
      }
      return note(`pulse dropped out: ${status()}`);
    },
    // down through the atmosphere, then low and slow over land
    async descend() {
      hold('KeyW', true);
      hold('ShiftLeft', true);
      let peak = 0;
      for (let i = 0; i < 30 * 150; i++) {
        const alt = game.ship.altitude;
        const tgt = alt > 2500 ? groundAhead(alt > 15000 ? 0.12 : 0.05) : dev.ahead(2000, 250);
        dev.shipAim(tgt, 10, 30);
        if (alt < 6000) hold('ShiftLeft', false);
        if (alt < 1800) {
          hold('KeyW', false);
          hold('KeyS', game.ship.speed > 80);
        }
        await frame();
        peak = Math.max(peak, game.ship.reentryPower || 0);
        if (alt < 600 && game.ship.speed < 90) break;
      }
      release();
      return note(`descended (re-entry glow peaked at ${peak.toFixed(2)}): ${status()}`);
    },
    // to the nearest dry land, and land with E
    async land() {
      const P = game.ship.state.frame;
      const up0 = game.ship.state.pos.clone().normalize();
      const t = new V(0, 1, 0).cross(up0).normalize();
      const b = up0.clone().cross(t);
      let dir = null;
      for (let r = 300; r < 30000 && !dir; r += 300) {
        for (let a = 0; a < 6.28; a += 0.15) {
          const d = up0.clone().addScaledVector(t, (Math.cos(a) * r) / P.radius).addScaledVector(b, (Math.sin(a) * r) / P.radius).normalize();
          const h = P.heightAt(d);
          if (h > 12 && h < 700) {
            dir = d;
            break;
          }
        }
      }
      let pressed = false;
      for (let i = 0; i < 30 * 120 && !pressed; i++) {
        const dist = game.ship.state.pos.clone().normalize().angleTo(dir) * P.radius;
        hold('KeyW', dist > 2500 && game.ship.speed < 280);
        hold('KeyS', dist < 1200 && game.ship.speed > 50);
        dev.shipAim(P.localToWorld(dir.clone().multiplyScalar(P.groundRadius(dir) + (dist < 1500 ? 25 : 120)), new V()), 8, 20);
        await frame();
        if (prompt().includes('Land')) {
          release();
          await tap('KeyE');
          pressed = true;
        }
      }
      release();
      for (let i = 0; i < 30 * 30 && game.ship.mode !== 'landed'; i++) await frame();
      return note(`landed: ${status()} (prompt "${prompt()}")`);
    },
    async disembark() {
      await tap('KeyF');
      for (let i = 0; i < 30 * 5; i++) await frame();
      return note(`out of the ship: ${game.mode} on ${game.player.state.frame?.name}`);
    },
    // scan, walk to the nearest deposit and mine it
    async mine() {
      await waitPool();
      await tap('KeyC');
      for (let i = 0; i < 30; i++) await frame();
      const p = game.player;
      const marks = game.scanMarkers.filter((m) => m.frame === p.state.frame).sort((a, b) => a.pos.distanceTo(p.state.pos) - b.pos.distanceTo(p.state.pos));
      const m = marks[0];
      if (!m) return note('scan found no deposits');
      note(`scan: ${marks.length} deposits, nearest ${m.label} ${m.pos.distanceTo(p.state.pos).toFixed(0)} m`);
      hold('KeyW', true);
      for (let i = 0; i < 30 * 60 && p.state.pos.distanceTo(m.pos) > 6; i++) {
        dev.footAim(m.pos, 0.4);
        await frame();
      }
      hold('KeyW', false);
      // aim at the thing itself (the marker floats above it)
      const inst = [...game.flora.instancesNear(m.pos, 6, (sp) => sp.deposit || sp.res)].sort((x, y) => x.pos.distanceTo(m.pos) - y.pos.distanceTo(m.pos))[0];
      const aim = inst ? inst.pos.clone().addScaledVector(inst.pos.clone().normalize(), Math.min(1.2, (inst.sp.height || 1) * inst.scale * 0.4)) : m.pos;
      const before = JSON.stringify(game.inventory.items);
      dev.button(0, true);
      for (let i = 0; i < 30 * 8; i++) {
        dev.footAim(aim, 0.5);
        await frame();
      }
      dev.button(0, false);
      return note(`mined: ${before} -> ${JSON.stringify(game.inventory.items)}`);
    },
    async analyze() {
      const p = game.player;
      const nearest = () => game.fauna.creatures.filter((c) => c.sp.kind !== 'flyer').sort((a, b) => a.pos.distanceTo(p.state.pos) - b.pos.distanceTo(p.state.pos))[0];
      let c = nearest();
      if (!c) return note('no creatures about');
      hold('KeyW', true);
      for (let i = 0; i < 30 * 50; i++) {
        if (c.pos.distanceTo(p.state.pos) < 18) hold('KeyW', false);
        dev.footAim(c.pos.clone().add(c.pos.clone().normalize().multiplyScalar(c.sp.size * c.scale * 0.5)), 0.5);
        await frame();
        if (prompt().includes('Analyze')) {
          await tap('KeyE');
          hold('KeyW', false);
          for (let k = 0; k < 10; k++) await frame();
          return note(`analyzed ${c.sp.name}: ${document.querySelector('.banner')?.innerText.replace(/\n/g, ' / ').slice(0, 60)}`);
        }
        if (i % 90 === 0) c = nearest();
      }
      hold('KeyW', false);
      return note('could not get a creature in sight');
    },
    async board() {
      const p = game.player;
      const sh = game.ship.state;
      hold('KeyW', true);
      for (let i = 0; i < 30 * 60; i++) {
        if (p.state.pos.distanceTo(sh.pos) < 7) hold('KeyW', false);
        dev.footAim(sh.pos, 0.4);
        await frame();
        if (prompt().includes('Board')) {
          hold('KeyW', false);
          await tap('KeyF');
          for (let k = 0; k < 30 * 5; k++) await frame();
          return note(`boarded: ${status()}`);
        }
      }
      hold('KeyW', false);
      return note('could not reach the ship');
    },
    // take off and climb out of the air
    async climb() {
      await tap('Space');
      for (let i = 0; i < 30 * 5; i++) await frame();
      note(`took off: ${status()}`);
      hold('KeyW', true);
      hold('ShiftLeft', true);
      for (let i = 0; i < 30 * 60; i++) {
        const s = game.ship.state;
        const P = s.frame;
        const wp = shipWorld();
        const up = P?.sampler ? wp.clone().sub(P.position).normalize() : new V(0, 1, 0);
        const fwd = new V(0, 0, -1).applyQuaternion(s.worldQuaternion(new THREE.Quaternion()));
        fwd.addScaledVector(up, -fwd.dot(up)).normalize();
        dev.shipAim(wp.clone().addScaledVector(up, 1000).addScaledVector(fwd, 800), 8, 25);
        await frame();
        if (game.ship.atmoDensity < 0.001 && prompt().includes('Pulse')) break;
      }
      release();
      return note(`out of the air: ${status()}`);
    },
    // pulse to the station and fly into the hangar
    async dock() {
      const st = game.station;
      const at = (z, y = 18) => st.localToWorld(new V(0, y, z), new V());
      for (let i = 0; i < 30 * 3; i++) {
        dev.shipAim(at(4000), 8, 25);
        await frame();
      }
      // (the station may be round the far side of the world: arc over it, not through its air)
      const P = st.parent;
      const via = () => {
        const a = shipWorld().sub(P.position);
        const b = at(4000).sub(P.position);
        const ab = b.clone().sub(a);
        const t = THREE.MathUtils.clamp(-a.dot(ab) / ab.lengthSq(), 0, 1);
        if (a.clone().addScaledVector(ab, t).length() > P.radius * P.atmo.top + 8000) return at(4000);
        return P.position.clone().add(a.normalize().add(b.normalize()).normalize().multiplyScalar(P.radius * P.atmo.top + 40000));
      };
      for (let i = 0; i < 30 * 3; i++) {
        dev.shipAim(via(), 8, 25);
        await frame();
      }
      await tap('KeyJ');
      note(`J: ${game.ship.mode}`);
      for (let i = 0; i < 30 * 420; i++) {
        if (game.ship.mode !== 'pulse') {
          if (st.distanceTo(shipWorld()) < 6000) break;
          // dropped out short (round the limb): line up and go again
          for (let k = 0; k < 30 * 2; k++) {
            dev.shipAim(via(), 8, 25);
            await frame();
          }
          await tap('KeyJ');
          if (game.ship.mode !== 'pulse') break;
        }
        const tgt = via();
        // steer as hard as the drive allows; if the target has fallen behind, drop out, turn and
        // go again (what a pilot does: in the pulse the speed builds with distance, so an overshoot
        // runs away)
        const fwdNow = new V(0, 0, -1).applyQuaternion(game.ship.state.worldQuaternion(new THREE.Quaternion()));
        const offNow = fwdNow.angleTo(tgt.clone().sub(shipWorld()));
        if (game.ship.mode === 'pulse' && offNow > 1.6) {
          await tap('KeyJ');
          for (let k = 0; k < 30 * 6 && fwdNow.copy(new V(0, 0, -1).applyQuaternion(game.ship.state.worldQuaternion(new THREE.Quaternion()))).angleTo(via().sub(shipWorld())) > 0.25; k++) {
            dev.shipAim(via(), 30, 50);
            await frame();
          }
          await tap('KeyJ');
          continue;
        }
        dev.shipAim(tgt, 30, 45);
        await frame();
        if (i % 150 === 0) {
          const fwd = new V(0, 0, -1).applyQuaternion(game.ship.state.worldQuaternion(new THREE.Quaternion()));
          const off = THREE.MathUtils.radToDeg(fwd.angleTo(tgt.clone().sub(shipWorld())));
          trace.push(`${(game.time - t0).toFixed(0)}s ${game.ship.mode} d ${(st.distanceTo(shipWorld()) / 1000).toFixed(0)} km, ${(game.ship.speed / 1000).toFixed(1)} km/s, off ${off.toFixed(0)}°, charge ${game.ship.charge.toFixed(0)}, alt ${((shipWorld().distanceTo(P.position) - P.radius) / 1000).toFixed(0)} km`);
        }
      }
      note(`pulse dropped out ${st.distanceTo(shipWorld()).toFixed(0)} m from the station`);
      // round to a point on the hangar's axis 900 m out, slowing, then straight in
      for (const [z, sp, near] of [[1200, 200, 120], [450, 70, 30], [-40, 50, 0]]) {
        for (let i = 0; i < 30 * 90 && game.ship.mode === 'flying'; i++) {
          const lp = st.worldToLocal(shipWorld(), new V());
          if (i % 30 === 0) trace.push(`approach ${z}: at ${lp.toArray().map(Math.round)}, ${Math.round(game.ship.speed)} m/s`);
          if (near && lp.distanceTo(new V(0, 18, z)) < near) break;
          const d = lp.distanceTo(new V(0, 18, z));
          const want = Math.min(sp, 25 + d * 0.25);
          hold('KeyW', game.ship.speed < want);
          hold('KeyS', game.ship.speed > want * 1.25);
          dev.shipAim(at(z), 8, 25);
          await frame();
        }
      }
      release();
      for (let i = 0; i < 30 * 30 && game.ship.mode === 'docking'; i++) await frame();
      return note(`docked: ${status()}, objective "${game.objectives.current ?? ''}"`);
    },
  };
}
