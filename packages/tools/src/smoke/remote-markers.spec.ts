import { expect, test } from './harness.ts';
import { SCREENS } from '../capture/screens.ts';
import { smokeGl } from './gl.ts';

// Other pilots' markers (P1.E04.T02) through every frame of each remote-ships capture's clip, staged as `pnpm capture`
// stages it (offline: a recorded snapshot stream through the remote layer), on the HUD's own clock at 60 frames a second:
// every pilot the sensors pick up and in view has its mark; no pilot's mark or label on the fixed HUD (the compass, its
// heading and EDGE readouts, the speed, altitude and mode readouts, the reticle, the location line, the vitals, a prompt)
// or on the local ship (any vertex of it on screen); no pilot's label on another mark or label, or more than a few px
// from its mark; no mark or name flickering in and out, or a name from side to side, faster than its fade; no name fading
// out over the HUD, the local ship or another name (its first 50 ms, after which it is gone); and no mark jumping across
// the screen faster than its ship moves (3x and 48 px a frame). The local ship is worked out here on its own (its meshes'
// vertices, projected), not taken from the HUD.

const SCENES = ['remote-ships', 'remote-ships-crowd', 'remote-ships-pads', 'remote-ships-surface', 'remote-ships-bay'];
// (as captured, where a GPU makes that cheap)
if (smokeGl === 'metal') test.use({ viewport: { width: 1920, height: 1080 } });

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
    // (both casting bars full, whichever the scene's mode casts from: the marks keep clear of it too)
    await page.evaluate(async () => {
      const slots = {
        ground: ['pulse', 'pull', 'flare', 'well', 'regrow', 'veil'],
        ship: ['tractor_beam', 'deep_sweep', 'repair_drones', 'inertial_brake', null],
      };
      (window.game as unknown as { abilities: { skills(v: unknown): void } }).abilities.skills({ state: { slots }, shipSlots: 4 });
      await window.step(2);
    });
    // (its fade-in runs on the page's own clock, which the stepped frames do not advance)
    await page.waitForTimeout(600);
    const frames = Math.round((def.clipSeconds ?? 1) * 60);
    const result = await page.evaluate(async (frames) => {
      const g = window.game;
      const issues: Issue[] = [];
      let pilots = 0;
      let labels = 0;
      let barFrames = 0;
      const gaps: number[] = [];
      type Box = { x0: number; y0: number; x1: number; y1: number; what: string };
      const boxOf = (e: Element, what: string): Box | null => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        let o: Element | null = e;
        while (o) {
          const s = getComputedStyle(o);
          if (o.classList.contains('out') || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return null;
          o = o.parentElement;
        }
        return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, what };
      };
      const overlap = (a: Box, b: Box) => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;
      // the local ship as drawn: every vertex of its meshes on screen (in a grid of 16 px cells), which no pilot's mark or
      // label may lie on
      const model = g.ship.model;
      const V = model.position.constructor;
      const verts: { pos: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }; m: unknown }[] = [];
      model.traverse((o: { isMesh?: boolean; geometry?: { attributes: { position: (typeof verts)[number]['pos'] } }; matrixWorld: unknown }) => {
        if (o.isMesh && o.geometry) verts.push({ pos: o.geometry.attributes.position, m: o.matrixWorld });
      });
      const shipCells = (): Map<string, number[]> | null => {
        if (g.mode !== 'ship' || !model.visible) return null;
        model.updateMatrixWorld(true);
        const W = window.innerWidth;
        const H = window.innerHeight;
        const cells = new Map<string, number[]>();
        const c = new V();
        for (const { pos, m } of verts)
          for (let i = 0; i < pos.count; i++) {
            c.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m).project(g.engine.camera);
            if (c.z > 1) continue;
            const x = (c.x * 0.5 + 0.5) * W;
            const y = (-c.y * 0.5 + 0.5) * H;
            const k = `${Math.floor(x / 16)},${Math.floor(y / 16)}`;
            const list = cells.get(k);
            if (list) list.push(x, y);
            else cells.set(k, [x, y]);
          }
        return cells;
      };
      const onShip = (b: Box, cells: Map<string, number[]> | null) => {
        if (!cells) return false;
        for (let cx = Math.floor(b.x0 / 16); cx <= Math.floor(b.x1 / 16); cx++)
          for (let cy = Math.floor(b.y0 / 16); cy <= Math.floor(b.y1 / 16); cy++) {
            const list = cells.get(`${cx},${cy}`);
            if (!list) continue;
            for (let j = 0; j < list.length; j += 2)
              if (list[j] > b.x0 + 1 && list[j] < b.x1 - 1 && list[j + 1] > b.y0 + 1 && list[j + 1] < b.y1 - 1) return true;
          }
        return false;
      };
      const HUD = '.ec-ball, .ec-hdg, .ec-dist, .r-speed, .r-alt, .r-mode, .ship-reticle > b, .crosshair > b, .location, .vitals, .prompt, .abilities';
      const frame = g.frame.bind(g);
      // (the HUD's fades and waits on the frames' clock, as in the captures)
      const base = g.hud.now();
      let clock = 0;
      g.hud.now = () => base + clock;
      const cam = g.engine.camera;
      const W = window.innerWidth;
      const H = window.innerHeight;
      type Seen = { mark: boolean; markAt: number; shown: boolean; shownAt: number; ever: boolean; side: string | null; sideAt: number };
      const history = new Map<number, Seen & { vis: boolean; outAt: number; at: { x: number; y: number; cx: number; cy: number } | null }>();
      // where a pilot's ship's middle is on screen (null behind the camera)
      const centre = (id: number) => {
        const r = g.remotes.get(id);
        if (!r) return null;
        const v = r.world.clone().sub(g.camWorld).applyQuaternion(g.camWorldQuatInv);
        if (v.z > 0) return null;
        v.applyMatrix4(cam.projectionMatrix);
        return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
      };
      let jumps = 0;
      let switches = 0;
      let toggles = 0;
      let markToggles = 0;
      let unmarked = 0;
      for (let f = 0; f < frames; f++) {
        frame(1 / 60);
        clock += 1000 / 60;
        // every pilot picked up and in view has its mark
        for (const r of g.remotes.list) {
          if (!r.shown || !r.sense?.detected) continue;
          const v = r.world.clone().sub(g.camWorld).applyQuaternion(g.camWorldQuatInv);
          if (v.z > 0) continue;
          v.applyMatrix4(cam.projectionMatrix);
          const x = (v.x * 0.5 + 0.5) * W;
          const y = (-v.y * 0.5 + 0.5) * H;
          if (x < 40 || x > W - 40 || y < 40 || y > H - 40) continue;
          const mark = document.querySelector(`.marker.player[data-id="${r.id}"]`);
          if (!mark || mark.classList.contains('out')) {
            unmarked++;
            issues.push({ frame: f, what: `${r.name}, picked up at ${Math.round(r.sense.distance)} m and in view, unmarked` });
          }
        }
        // marks and names: none back and forth faster than their fade (a name's first showing, and a name going with its
        // mark, aside); no mark jumping across the screen faster than its ship moves
        const fading: { lbl: Element; name: string }[] = [];
        const named = [...document.querySelectorAll('.marker.player:not(.out) .lbl:not(.out)')].filter((lbl) => lbl.firstChild?.nodeType === Node.TEXT_NODE);
        if (named.length > 9) issues.push({ frame: f, what: `${named.length} pilot names shown, above nearest eight plus crosshair budget` });
        for (const m of document.querySelectorAll('.marker.player')) {
          const id = Number((m as HTMLElement).dataset.id);
          const lbl = m.querySelector('.lbl')!;
          const name = lbl.firstChild?.textContent ?? '';
          const mark = !m.classList.contains('out');
          const shown = mark && !lbl.classList.contains('out');
          const st = (lbl as HTMLElement).style;
          const side = shown ? (st.right ? 'left' : st.transform ? 'above' : 'right') : null;
          const h = history.get(id);
          const icon = m.querySelector('.icon')!.getBoundingClientRect();
          const c = mark ? centre(id) : null;
          const at = c ? { x: (icon.left + icon.right) / 2, y: (icon.top + icon.bottom) / 2, cx: c.x, cy: c.y } : null;
          if (!h) {
            // (since when, before the clip: not known)
            history.set(id, { mark, markAt: -Infinity, shown, shownAt: -Infinity, ever: shown, side, sideAt: -Infinity, vis: shown, outAt: -Infinity, at });
            continue;
          }
          if (at && h.at) {
            const moved = Math.hypot(at.x - h.at.x, at.y - h.at.y);
            const ship = Math.hypot(at.cx - h.at.cx, at.cy - h.at.cy);
            if (moved > 3 * ship + 48) {
              jumps++;
              issues.push({ frame: f, what: `the mark of ${name} jumped ${moved.toFixed(0)} px (its ship ${ship.toFixed(0)} px)` });
            }
          }
          h.at = at;
          // (a name going out, by itself or with its mark, fades where it was: for its first 50 ms, nearly whole, it is
          // checked as one shown)
          if (h.vis && !shown) h.outAt = clock;
          h.vis = shown;
          if (!shown && clock - h.outAt <= 50 && name) fading.push({ lbl, name });
          if (mark !== h.mark) {
            markToggles++;
            if (clock - h.markAt < 149)
              issues.push({
                frame: f,
                what: `the mark of ${name} ${mark ? 'back' : 'gone'} ${Math.round(clock - h.markAt)} ms after it ${mark ? 'went' : 'came'}`,
              });
            h.mark = mark;
            h.markAt = clock;
          }
          if (!mark) continue;
          if (shown !== h.shown) {
            toggles++;
            // (within a frame of it, as the clock adds up)
            if (h.ever && clock - h.shownAt < 149)
              issues.push({
                frame: f,
                what: `${name} ${shown ? 'back' : `gone (${g.hud.pilots.get(id)?.why})`} ${Math.round(clock - h.shownAt)} ms after it ${shown ? 'went' : 'came back'}`,
              });
            h.shown = shown;
            h.shownAt = clock;
            h.ever ||= shown;
          }
          if (side && h.side && side !== h.side) {
            switches++;
            if (clock - h.sideAt < 149) issues.push({ frame: f, what: `${name} ${h.side} to ${side} ${Math.round(clock - h.sideAt)} ms after its last move` });
          }
          if (side && side !== h.side) {
            h.side = side;
            h.sideAt = clock;
          }
        }
        const keepOut = [...document.querySelectorAll(HUD)].map((e) => boxOf(e, e.className || e.tagName)).filter((b): b is Box => !!b);
        if (keepOut.some((b) => b.what.startsWith('abilities'))) barFrames++;
        const ship = shipCells();
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
          if (onShip(icon, ship)) issues.push({ frame: f, what: `${icon.what} on the local ship` });
          if (lbl && onShip(lbl, ship)) issues.push({ frame: f, what: `${lbl.what} on the local ship` });
          (icon as Box & { pilot?: boolean }).pilot = true;
          if (lbl) (lbl as Box & { pilot?: boolean; icon?: Box }).icon = icon;
        }
        for (const { lbl, name } of fading) {
          const r = lbl.getBoundingClientRect();
          const b = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, what: `"${name}" fading out` };
          for (const k of keepOut) if (overlap(b, k)) issues.push({ frame: f, what: `${b.what} on ${k.what}` });
          if (onShip(b, ship)) issues.push({ frame: f, what: `${b.what} on the local ship` });
          for (const o of texts) if (overlap(b, o)) issues.push({ frame: f, what: `${b.what} under ${o.what}` });
        }
        for (const t of texts) {
          const own = (t as Box & { icon?: Box }).icon;
          if (!own) continue;
          // its name and range a fixed few px from its mark (beside it, or above)
          const gap = Math.max(t.x0 - own.x1, own.x0 - t.x1, own.y0 - t.y1, t.y0 - own.y1);
          gaps.push(gap);
          if (gap < 5 || gap > 11) issues.push({ frame: f, what: `${t.what} ${gap.toFixed(1)} px from its mark` });
          for (const o of marks) if (o !== own && overlap(t, o)) issues.push({ frame: f, what: `${t.what} on ${o.what}` });
          for (const o of texts) if (o !== t && overlap(t, o)) issues.push({ frame: f, what: `${t.what} on ${o.what}` });
        }
        if (f % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      return {
        issues,
        pilots,
        labels,
        barFrames,
        switches,
        toggles,
        markToggles,
        unmarked,
        jumps,
        gap: gaps.length ? [Math.min(...gaps), Math.max(...gaps)] : [],
      };
    }, frames);
    // (the scene has pilots marked, and most named)
    expect(result.pilots).toBeGreaterThan(frames);
    expect(result.labels).toBeGreaterThan(0);
    console.log(
      `${scene}: ${result.pilots} pilot marks and ${result.labels} labels in ${frames} frames, ${result.gap.map((g) => g.toFixed(1)).join('..')} px from their marks; ${result.switches} side moves, ${result.toggles} names and ${result.markToggles} marks in or out; ${result.unmarked} picked up and unmarked; ${result.jumps} marks jumping; the ability bar up in ${result.barFrames}`,
    );
    expect(result.issues.slice(0, 40), `${result.issues.length} overlaps`).toEqual([]);
    expect(errors).toEqual([]);
  });
