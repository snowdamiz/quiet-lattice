import * as THREE from 'three';
import { Game } from './Game.js';

const game = new Game(document.getElementById('app'), document.getElementById('hud'));
window.game = game;
game.start();

// Test helper: advance the simulation manually (works even when rAF is throttled).
window.step = async (frames = 60, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) {
    game.frame(dt);
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
  }
};

// Dev scenarios: open with #foot, #fly, #land, #station, #space to jump straight into a situation, #cutscene:<id> to
// play a cutscene.
const scenario = location.hash.slice(1);
if (scenario) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    const btn = document.querySelector('.title-screen [data-act="start"]');
    while (btn.disabled) await wait(200);
    btn.click();
    await wait(300);
    const home = game.system.homePlanet;
    const [name, arg] = scenario.split(':');
    // #review:<family>/<file>[:<asset>[/<variant>]] — the asset review scene (src/dev/review.js); `review.ready` resolves
    // once it has settled
    if (name === 'review' && import.meta.env.DEV) {
      const { startReview } = await import('./dev/review.js');
      startReview(game, decodeURIComponent(scenario.slice('review:'.length)));
      return;
    }
    // #cutscene:<id> — plays public/cutscenes/<id>.json (src/cutscene/), the ship first put where the cutscene staged it
    if (name === 'cutscene') {
      const def = await game.cutscenes.load(arg);
      game.cutscenes.stage(def);
      await wait(1500);
      game.cutscenes.play(arg);
      return;
    }
    const planet = arg !== undefined ? game.system.planets[+arg] : home;
    if (name === 'fly') game.debugGoto(planet, { sunAngle: 50, alt: 400, azimuth: 40 });
    if (name === 'land' || name === 'foot') game.debugGoto(planet, { sunAngle: 40, alt: 0, azimuth: 20 });
    if (name === 'foot') {
      await wait(1500);
      game.exitShip();
      game.player.heading.applyAxisAngle(game.player.state.pos.clone().normalize(), Math.PI);
    }
    if (name === 'station') {
      const s = game.ship.state;
      s.frame = game.station;
      s.pos.set(0, 20, 200);
      s.quat.identity();
      game.ship.speed = 30;
    }
    if (name === 'dock') {
      const s = game.ship.state;
      s.frame = game.station;
      s.pos.set(30, 2.4, 22);
      s.quat.identity();
      game.ship.mode = 'landed';
      game.station.pads[3].occupied = game.ship;
      await wait(500);
      game.exitShip();
    }
    if (name === 'space') {
      const s = game.ship.state;
      s.frame = null;
      s.pos.copy(planet.position).add(new THREE.Vector3(planet.radius * 3, planet.radius * 0.5, 0));
      const m = new THREE.Matrix4().lookAt(s.pos, planet.position, new THREE.Vector3(0, 1, 0));
      s.quat.setFromRotationMatrix(m);
    }
    game.cam.frame = undefined;
  })();
}

// Dev helpers for scripted screenshots: start a fresh silent game, and frame a planet from orbit.
if (import.meta.env.DEV) {
  // F2: teleport to any planet in any system
  import('./dev/TeleportPanel.js').then(({ TeleportPanel }) => (window.teleporter = new TeleportPanel(game)));
  window.dev = {
    async boot() {
      Object.keys(localStorage).filter((k) => k.startsWith('next-horizon') || k.startsWith('astra-nullius')).forEach((k) => localStorage.removeItem(k));
      game.audio.start = () => {};
      const btn = document.querySelector('.title-screen [data-act="start"]');
      // step frames ourselves: in a hidden tab the rAF loop that readies the title is throttled
      while (btn.disabled) {
        await window.step(2);
        await new Promise((r) => setTimeout(r, 50));
      }
      btn.click();
      await window.step(10);
    },
    async settle(n = 20) {
      for (let i = 0; i < n; i++) {
        await window.step(6);
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    async orbitView(planet, { dist = 2.6, sunAngle = 60, side = 0.55 } = {}) {
      game.debugGoto(planet, { sunAngle, alt: planet.radius * (dist - 1), land: false });
      const s = game.ship.state;
      const up = s.pos.clone().normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const look = right.clone().multiplyScalar(planet.radius * side);
      s.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(s.pos, look, up.clone().cross(right).normalize()));
      game.cam.frame = undefined;
      await this.settle();
    },
    // Synthetic input, as a player would give it: keys, mouse look, and steering toward a point.
    key(code, down) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    },
    mouse(dx, dy) {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: Math.round(dx), movementY: Math.round(dy) }));
    },
    button(b, down) {
      window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: b }));
    },
    shipAim(world, k = 22, c = 40) {
      const s = game.ship.state;
      const wp = s.worldPosition(new THREE.Vector3());
      const local = world.clone().sub(wp).applyQuaternion(s.worldQuaternion(new THREE.Quaternion()).invert());
      const yaw = Math.atan2(local.x, -local.z);
      const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
      this.mouse(THREE.MathUtils.clamp(yaw * k, -c, c), THREE.MathUtils.clamp(-pitch * k, -c, c));
    },
    footAim(local, gain = 0.5) {
      const p = game.player;
      const up = p.state.pos.clone().normalize();
      const to = local.clone().sub(p.state.pos.clone().addScaledVector(up, 1.7));
      const h = to.clone().addScaledVector(up, -to.dot(up)).normalize();
      const right = p.heading.clone().cross(up).normalize();
      const yaw = Math.atan2(h.dot(right), h.dot(p.heading));
      const pitch = Math.asin(THREE.MathUtils.clamp(to.clone().normalize().dot(up), -1, 1));
      this.mouse(THREE.MathUtils.clamp((yaw / 0.0021) * gain, -60, 60), THREE.MathUtils.clamp((-(pitch - p.pitch) / 0.0021) * gain, -60, 60));
    },
    // world-space point `dist` m ahead along the ground track (or `bearing`), `alt` m above ground
    ahead(dist, alt, bearing = null) {
      const P = game.ship.state.frame;
      const s = game.ship.state;
      const up = s.pos.clone().normalize();
      const fwd = bearing ? bearing.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      const dir = up.multiplyScalar(P.radius).addScaledVector(fwd, dist).normalize();
      return P.localToWorld(dir.clone().multiplyScalar(P.groundRadius(dir) + alt), new THREE.Vector3());
    },
    // Deterministic capture: stop the rAF loop, render at a fixed size and post JPEG frames
    // to a local frame server (see README › Recording), with the HUD drawn in.
    record({ width = 1280, height = 720, url = 'http://localhost:5199/frame/', hud = true } = {}) {
      const E = game.engine;
      const realFrame = (this.realFrame ||= game.frame.bind(game));
      game.frame = () => {};
      E.adapt = () => {};
      E.renderer.setPixelRatio(1);
      E.pixelRatio = 1;
      E.renderer.setSize(width, height, false);
      E.composer.setPixelRatio(1);
      E.composer.setSize(width, height);
      for (const c of [E.camera, E.viewCamera]) {
        c.aspect = width / height;
        c.updateProjectionMatrix();
      }
      const rec = (this.rec = { n: 0, pending: [], t: 0, timers: [], tid: 0, cap: null });
      // the HUD's messages and fades run on the recording's clock: real time passes several
      // times slower than the game's here, and a toast would flash by in a few frames
      const H = game.hud;
      H.now = () => rec.t * 1000;
      H.later = (fn, ms) => {
        rec.timers.push({ id: ++rec.tid, at: rec.t * 1000 + ms, fn });
        return rec.tid;
      };
      H.cancel = (id) => (rec.timers = rec.timers.filter((x) => x.id !== id));
      const advance = (dt) => {
        realFrame(dt);
        rec.t += dt;
        const now = rec.t * 1000;
        const due = rec.timers.filter((x) => x.at <= now);
        if (!due.length) return;
        rec.timers = rec.timers.filter((x) => x.at > now);
        for (const x of due) x.fn();
      };
      const capReady = hud ? import('./dev/hudCapture.js').then((m) => m.createHudCapture(H.root, width, height)) : null;
      this.flush = async () => {
        await Promise.all(rec.pending);
        rec.pending = [];
      };
      this.sim = async (n) => {
        for (let i = 0; i < n; i++) {
          advance(1 / 60);
          if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
        }
      };
      this.tick = async (stride = 2) => {
        if (capReady && !rec.cap) rec.cap = await capReady;
        for (let i = 0; i < stride; i++) advance(1 / 60);
        // (the HUD capture copies the WebGL frame before it awaits anything)
        const frame = rec.cap ? await rec.cap.draw(E.renderer.domElement, rec.t) : E.renderer.domElement;
        const data = frame.toDataURL('image/jpeg', 0.9);
        const id = rec.n++;
        rec.pending.push(fetch(data).then((r) => r.blob()).then((b) => fetch(url + id, { method: 'POST', body: b })));
        if (rec.pending.length > 8) {
          await Promise.all(rec.pending);
          rec.pending = [];
        }
      };
    },
  };
}
