// Where the player is in the universe. The cluster's systems sit at their map positions, light
// years apart, and only the one being visited is built. World coordinates are metres from an
// anchor: inside a system the anchor is its star, so nothing there changes; out in deep space the
// anchor rides along with the ship (moved up to it whenever it strays more than a few thousand
// km), so coordinates stay small and exact however far the ship goes. Flying out past a system's
// edge leaves it dormant (hidden and not updated, ready if the ship turns back); flying into
// another builds that one in its place as the ship crosses into it.
import * as THREE from 'three';
import { LY, cosmosClearance } from '@astra/shared/world';

// metres from a star: past LEAVE its system goes dormant; inside ENTER a system is built or woken
// (both beyond the camera's far plane, so neither is ever seen to happen)
export const LEAVE = 6e9;
export const ENTER = 4.5e9;
// metres from a star at which its system starts being built, a few milliseconds a frame (on
// the approach that leaves some minutes to finish before ENTER)
const PREPARE = 2e13;
const PREP_BUDGET = 4;
const REBASE = 1e7;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class Universe {
  constructor(game) {
    this.game = game;
    // galactic position (ly) of the world origin
    this.anchor = new THREE.Vector3();
    this.deep = false;
    this.dormant = false;
    // the system being readied ahead of arrival: { sys, it, out, built }
    this.prep = null;
  }

  // world point (m) -> galactic position (ly), and back
  toLy(world, out = new THREE.Vector3()) {
    return out.copy(world).divideScalar(LY).add(this.anchor);
  }

  toWorld(ly, out = new THREE.Vector3()) {
    return out.copy(ly).sub(this.anchor).multiplyScalar(LY);
  }

  sysWorld(sys, out = new THREE.Vector3()) {
    return this.toWorld(_v3.set(sys.x, sys.y, sys.z), out);
  }

  // a freshly built system: its star is the origin
  reset(sys) {
    this.anchor.set(sys.x, sys.y, sys.z);
    this.deep = false;
    this.setDormant(false);
  }

  // galactic position of the ship (or of whoever is about: on foot, the ship is close by)
  hereLy(out = new THREE.Vector3()) {
    return this.toLy(this.game.ship.state.worldPosition(_v1), out);
  }

  update() {
    const g = this.game;
    if (g.mode === 'title') return;
    const s = g.ship.state;
    if (!this.deep && g.mode === 'ship' && !s.frame && s.pos.distanceTo(g.system.star.position) > LEAVE) this.leave();
    if (this.deep) {
      if (s.pos.lengthSq() > REBASE * REBASE) this.rebase(_v1.copy(s.pos));
      const here = this.toLy(s.pos, _v2);
      const { s: near, d } = g.galaxy.nearest(here);
      if (near !== g.system.info && d * LY < PREPARE) this.prepare(near);
      this.stepPrep();
      if (d * LY < ENTER) this.arrive(near);
    }
    const h = this.hereLy(_v2);
    const gh = g.galaxy.here;
    gh.x = h.x;
    gh.y = h.y;
    gh.z = h.z;
  }

  leave() {
    const g = this.game;
    this.deep = true;
    this.setDormant(true);
    g.pirates.clear();
    g.audio.play('pulse');
  }

  // move the world origin up to the ship (in deep space only the ship and the camera live in it)
  rebase(shift) {
    const g = this.game;
    this.anchor.addScaledVector(shift, 1 / LY);
    g.ship.state.pos.sub(shift);
    if (!g.cam.frame) g.cam.pos.sub(shift);
    this.sysWorld(g.system.info, g.system.star.position);
  }

  // start building the system ahead (dropping one readied for somewhere the ship turned from)
  prepare(sys) {
    if (this.prep?.sys === sys) return;
    this.dropPrep();
    const out = {};
    this.prep = { sys, out, it: this.game.buildSystem(sys, out), built: null };
  }

  stepPrep() {
    const p = this.prep;
    if (!p || p.built) return;
    const t0 = performance.now();
    do {
      const r = p.it.next();
      if (r.done) {
        p.built = r.value;
        this.precompile(p.built);
        return;
      }
    } while (performance.now() - t0 < PREP_BUDGET);
  }

  // compile its shaders in the background (parallel compile, where the browser has it), so none
  // is compiled on the frame it first comes into the scene
  precompile({ system, station }) {
    const e = this.game.engine;
    const roots = [...system.bodies.map((b) => b.root), station.root];
    for (const r of roots) e.renderer.compileAsync(r, e.camera, e.scene).catch(() => {});
  }

  dropPrep() {
    if (this.prep) this.game.disposeSystem(this.prep.out.system, this.prep.out.station);
    this.prep = null;
  }

  // the system readied for `sys`, finished off now if the approach was too quick for that (any
  // other one is dropped)
  takePrep(sys) {
    const p = this.prep;
    if (!p || p.sys !== sys) {
      this.dropPrep();
      return null;
    }
    this.prep = null;
    while (!p.built) {
      const r = p.it.next();
      if (r.done) p.built = r.value;
    }
    return p.built;
  }

  arrive(sys) {
    const g = this.game;
    // the old origin, seen from the new one
    const shift = _v3.set(sys.x, sys.y, sys.z).negate().add(this.anchor).multiplyScalar(LY).clone();
    const fresh = sys !== g.system.info;
    if (fresh) {
      g.galaxy.setCurrent(sys);
      g.discovered.clear();
      g.loadSystem(sys, { seamless: true });
    } else {
      this.reset(sys);
      g.system.star.position.set(0, 0, 0);
    }
    g.ship.state.pos.add(shift);
    if (!g.cam.frame) g.cam.pos.add(shift);
    g.galaxy.setCurrent(sys);
    if (fresh) {
      g.hud.showBanner(g.system.name.toUpperCase(), 'Star System');
      g.audio.play('discovery');
      g.save();
    }
  }

  // a system out of reach is hidden and left alone until the ship comes back
  setDormant(on) {
    const g = this.game;
    this.dormant = on;
    if (!g.system) return;
    for (const b of g.system.bodies) b.root.visible = !on;
    if (g.station) g.station.root.visible = !on;
    g.asteroids.group.visible = !on;
  }

  // metres to the nearest thing the drive must slow for beyond the visited system: other stars
  // (their arrival radius), other galaxies, the edge
  clearance() {
    const g = this.game;
    const here = this.hereLy(_v2);
    let d = cosmosClearance(here) * LY;
    for (const s of g.galaxy.systems) {
      if (!this.deep && s === g.system.info) continue;
      d = Math.min(d, Math.max(0, g.galaxy.distance(s, here) * LY - ENTER * 0.5));
    }
    return d;
  }

  // the star lighting the ship: the visited one, or out in deep space the brightest in the sky.
  // Returns its direction from the camera (world) and how strongly it lights things (1 inside a
  // system, falling with distance beyond it).
  keyLight(camWorld, outDir) {
    const g = this.game;
    if (!this.deep) {
      outDir.copy(g.system.star.position).sub(camWorld);
      const d = outDir.length();
      outDir.divideScalar(d || 1);
      const R0 = g.system.outerOrbit * 2;
      return Math.min(1, (R0 / Math.max(d, 1)) ** 2);
    }
    const here = this.toLy(camWorld, _v2);
    let best = null;
    let bf = 0;
    for (const s of g.galaxy.systems) {
      const d = g.galaxy.distance(s, here);
      const f = s.lum / (d * d);
      if (f > bf) {
        bf = f;
        best = s;
      }
    }
    outDir.set(best.x, best.y, best.z).sub(here).normalize();
    const R0 = g.system.outerOrbit * 2;
    return Math.min(1, best.lum * (R0 / (g.galaxy.distance(best, here) * LY)) ** 2);
  }
}
