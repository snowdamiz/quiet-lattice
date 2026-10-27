import { expect, test } from '@playwright/test';
import { SCREENS } from '../capture/screens.ts';

// Other pilots' markers (P1.E04.T02) through every frame of each remote-ships capture's clip, staged as `pnpm capture`
// stages it (offline: a recorded snapshot stream through the remote layer): no pilot's mark or label on the fixed HUD
// (the compass, its heading and EDGE readouts, the speed, altitude and mode readouts, the reticle, the location line, the
// vitals, a prompt) or on the local ship, and no pilot's label on another mark or another label. The local ship's bounds
// are worked out here on their own (its meshes' boxes in its own space, projected), not taken from the HUD.

const SCENES = ['remote-ships', 'remote-ships-crowd', 'remote-ships-pads', 'remote-ships-surface', 'remote-ships-bay'];
const metal = (process.env.SMOKE_GL ?? (process.platform === 'darwin' && !process.env.CI ? 'metal' : 'swiftshader')) === 'metal';
// (as captured, where a GPU makes that cheap)
if (metal) test.use({ viewport: { width: 1920, height: 1080 } });

interface Issue {
  frame: number;
  what: string;
}

for (const scene of SCENES)
  test(`${scene}: pilots' marks and labels keep off the HUD, the local ship and each other in every frame`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const def = SCREENS[scene]!;
    await page.goto(`/${def.hash ?? ''}`);
    await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
    await page.evaluate(() => {
      const E = window.game.engine;
      E.adapt = () => {};
      E.maxPixelRatio = 1;
      E.pixelRatio = 1;
      E.renderer.setPixelRatio(1);
      E.resize();
    });
    await def.open(page);
    const frames = Math.round((def.clipSeconds ?? 1) * 60);
    const result = await page.evaluate(async (frames) => {
      const g = window.game;
      const issues: Issue[] = [];
      let pilots = 0;
      let labels = 0;
      type Box = { x0: number; y0: number; x1: number; y1: number; what: string };
      const boxOf = (e: Element, what: string): Box | null => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        let o: Element | null = e;
        while (o) {
          const s = getComputedStyle(o);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return null;
          o = o.parentElement;
        }
        return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, what };
      };
      const overlap = (a: Box, b: Box) => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;
      // the local ship's box in its own space, from its meshes' boxes
      const model = g.ship.model;
      model.updateMatrixWorld(true);
      const toModel = model.matrixWorld.clone().invert();
      const V = model.position.constructor;
      const lo = new V(Infinity, Infinity, Infinity);
      const hi = new V(-Infinity, -Infinity, -Infinity);
      model.traverse((o: { isMesh?: boolean; geometry?: { boundingBox: unknown; computeBoundingBox(): void }; matrixWorld: unknown }) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const { min, max } = o.geometry.boundingBox as { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
        for (let k = 0; k < 8; k++) {
          const c = new V(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z).applyMatrix4(o.matrixWorld).applyMatrix4(toModel);
          lo.min(c);
          hi.max(c);
        }
      });
      const shipBox = (): Box | null => {
        if (g.mode !== 'ship') return null;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, what: 'the local ship' };
        for (let k = 0; k < 8; k++) {
          const c = new V(k & 1 ? hi.x : lo.x, k & 2 ? hi.y : lo.y, k & 4 ? hi.z : lo.z).applyMatrix4(model.matrixWorld).project(g.engine.camera);
          if (c.z > 1) return null;
          const x = (c.x * 0.5 + 0.5) * W;
          const y = (-c.y * 0.5 + 0.5) * H;
          b.x0 = Math.min(b.x0, x);
          b.x1 = Math.max(b.x1, x);
          b.y0 = Math.min(b.y0, y);
          b.y1 = Math.max(b.y1, y);
        }
        return b;
      };
      const HUD = '.ec-ball, .ec-hdg, .ec-dist, .r-speed, .r-alt, .r-mode, .ship-reticle > b, .crosshair > b, .location, .vitals, .prompt';
      const frame = g.frame.bind(g);
      for (let f = 0; f < frames; f++) {
        frame(1 / 60);
        const keepOut = [...document.querySelectorAll(HUD)].map((e) => boxOf(e, e.className || e.tagName)).filter((b): b is Box => !!b);
        const ship = shipBox();
        if (ship) keepOut.push(ship);
        const marks: Box[] = [];
        const texts: Box[] = [];
        for (const m of document.querySelectorAll('.marker')) {
          const name = m.querySelector('.lbl')?.textContent ?? '';
          const icon = boxOf(m.querySelector('.icon')!, `the mark of ${name || m.className}`);
          if (!icon) continue;
          const pilot = m.classList.contains('player');
          const lbl = name ? boxOf(m.querySelector('.lbl')!, `"${name}"`) : null;
          marks.push(icon);
          if (lbl) texts.push(lbl);
          if (!pilot) continue;
          pilots++;
          if (lbl) labels++;
          for (const k of keepOut) {
            if (overlap(icon, k)) issues.push({ frame: f, what: `${icon.what} on ${k.what}` });
            if (lbl && overlap(lbl, k)) issues.push({ frame: f, what: `${lbl.what} on ${k.what}` });
          }
          (icon as Box & { pilot?: boolean }).pilot = true;
          if (lbl) (lbl as Box & { pilot?: boolean; icon?: Box }).icon = icon;
        }
        for (const t of texts) {
          const own = (t as Box & { icon?: Box }).icon;
          if (!own) continue;
          for (const o of marks) if (o !== own && overlap(t, o)) issues.push({ frame: f, what: `${t.what} on ${o.what}` });
          for (const o of texts) if (o !== t && overlap(t, o)) issues.push({ frame: f, what: `${t.what} on ${o.what}` });
        }
        if (f % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      return { issues, pilots, labels };
    }, frames);
    // (the scene has pilots marked, and most named)
    expect(result.pilots).toBeGreaterThan(frames);
    expect(result.labels).toBeGreaterThan(0);
    expect(result.issues.slice(0, 12), `${result.issues.length} overlaps`).toEqual([]);
    expect(errors).toEqual([]);
  });
