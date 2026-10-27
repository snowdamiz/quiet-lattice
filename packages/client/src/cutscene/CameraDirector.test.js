// The camera-glide system with a cutscene: taking the camera glides from the player's view into the cutscene's (eased,
// the field of view blended), or cuts behind a dip when the two are more than GLIDE_REACH apart or the player sits in the
// cockpit seat, or cuts outright when the player's camera has not been placed; giving it back glides from the
// cutscene's last pose to the player's view, never a snap, and ends exactly on it, the hidden views back.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FrameState } from '../universe/Body.js';
import { CameraDirector, CUT_DIP, GLIDE_REACH } from './CameraDirector.js';

/** Just what the director reads of the game. */
function stubGame() {
  const cam = new FrameState();
  cam.frame = null;
  cam.pos.set(0, 0, 0);
  return {
    cam,
    mode: 'ship',
    ship: { state: new FrameState(), inCockpit: false, canopyParts: [], setCockpitVisual(on) { this.cockpitVisual = on; } },
    engine: { gradePass: { uniforms: { uFlash: { value: new THREE.Vector4(0, 0, 0, 0) } } }, viewScene: { visible: true } },
  };
}

/** A cutscene camera standing at `pos` (inertial frame), looking down -z, with vertical fov `fov`. */
const source = (pos, fov = 30) => ({
  pose(out) {
    out.frame = null;
    out.pos.set(...pos);
    out.quat.identity();
    return fov;
  },
});

/** Steps the director `n` frames of 1/60 s, the views holding the player's camera at the origin. */
function run(d, n) {
  for (let i = 0; i < n; i++) d.update(1 / 60);
}

describe('CameraDirector with a cutscene', () => {
  it('glides into a cutscene camera nearby, eased, blending the field of view', () => {
    const g = stubGame();
    const d = new CameraDirector(g);
    d.takeOver(source([100, 0, 0], 30), { dur: 1.6 });
    expect(d.cine.phase).toBe('in');
    expect(g.engine.gradePass.uniforms.uFlash.value.w).toBe(0);
    expect(g.cam.pos.x).toBeCloseTo(0, 9);
    expect(d.fov(70)).toBeCloseTo(70, 9);
    expect(g.engine.viewScene.visible).toBe(false);
    const xs = [];
    for (let i = 0; i < 96; i++) {
      d.update(1 / 60);
      xs.push(g.cam.pos.x);
    }
    // eased: slow away, fast through the middle, slow in; never back; arrives
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-9)).toBe(true);
    expect(xs[47]).toBeCloseTo(50, 0);
    expect(xs[4]).toBeLessThan(100 * (5 / 96) * 0.25);
    expect(xs[95]).toBeCloseTo(100, 6);
    expect(d.cine.phase).toBe('on');
    expect(d.fov(70)).toBeCloseTo(30, 9);
  });

  it('cuts behind a dip from a camera too far to glide from, or from the cockpit seat; cuts when nothing placed it', () => {
    for (const [why, setUp, far] of [
      ['far', () => {}, GLIDE_REACH + 50],
      ['seated', (g) => (g.ship.inCockpit = true), 100],
    ]) {
      const g = stubGame();
      setUp(g);
      const d = new CameraDirector(g);
      d.takeOver(source([far, 0, 0]));
      expect(d.dip, why).not.toBeNull();
      expect(d.dip.dur).toBe(CUT_DIP);
      expect(g.engine.gradePass.uniforms.uFlash.value.w, why).toBe(1);
      expect(g.cam.pos.x, why).toBeCloseTo(far, 9);
      expect(d.cine.phase, why).toBe('on');
    }
    const g = stubGame();
    g.cam.frame = undefined;
    const d = new CameraDirector(g);
    d.takeOver(source([100, 0, 0]));
    expect(d.dip).toBeNull();
    expect(g.cam.pos.x).toBeCloseTo(100, 9);
  });

  it('gives the camera back by gliding to the player’s view, not snapping, and ends exactly on it', () => {
    const g = stubGame();
    const d = new CameraDirector(g);
    d.takeOver(source([0, 0, 200], 30), { dur: 1.6 });
    run(d, 120);
    expect(g.cam.pos.z).toBeCloseTo(200, 6);
    // the views keep the player's camera at the origin meanwhile, in the copy the director gave them
    expect(d.viewTarget()).toBe(d.cine.view);
    d.release({ dur: 1.5 });
    expect(d.dip).toBeNull();
    expect(g.cam.pos.z).toBeCloseTo(200, 6);
    const zs = [];
    for (let i = 0; i < 90; i++) {
      d.update(1 / 60);
      zs.push(g.cam.pos.z);
    }
    // halfway it is halfway, eased (slow away); every frame moves it home
    expect(zs[0]).toBeGreaterThan(199.9);
    expect(zs[44]).toBeCloseTo(100, -1);
    expect(zs.every((z, i) => i === 0 || z <= zs[i - 1] + 1e-9)).toBe(true);
    expect(d.fov(70)).toBeCloseTo(70, 9);
    expect(d.cine).toBeNull();
    expect(g.cam.pos.z).toBeCloseTo(0, 9);
    expect(g.engine.viewScene.visible).toBe(true);
    expect(d.viewTarget()).toBe(g.cam);
  });

  it('gives the camera back behind a dip from far away, and blends the field of view from what was shown', () => {
    const g = stubGame();
    const d = new CameraDirector(g);
    d.takeOver(source([0, 0, GLIDE_REACH + 100]));
    d.release();
    expect(d.dip).not.toBeNull();
    expect(d.cine).toBeNull();
    expect(g.cam.pos.z).toBeCloseTo(0, 9);

    // skipped halfway through the glide in: the glide out leaves from the field of view then shown
    const h = stubGame();
    const e = new CameraDirector(h);
    e.takeOver(source([100, 0, 0], 30), { dur: 1.6 });
    run(e, 48);
    const shown = e.fov(70);
    expect(shown).toBeGreaterThan(30);
    expect(shown).toBeLessThan(70);
    e.release({ dur: 1.5 });
    expect(e.fov(70)).toBeCloseTo(shown, 9);
  });
});
