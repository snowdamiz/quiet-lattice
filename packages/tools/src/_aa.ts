// temporary: crawl measurement of remote Larks (levels of detail on, then off) against plain clones of the ship model
import { chromium } from '@playwright/test';
import { glArgs, startVite } from './capture/capture.ts';

const OUT = '/private/tmp/claude-501/-Users-andreyyurlov-Documents-dev-space/8853f679-475f-4619-aa7a-8289e2676875/scratchpad';
const vite = await startVite();
const browser = await chromium.launch({ args: glArgs().args });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/PCFSoft/.test(m.text()) && console.log('page:', m.text()));
  await page.goto(`${vite.url}/`);
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 120_000 });
  await page.evaluate(async () => {
    const w = window as any;
    await w.dev.boot();
    const raf = window.requestAnimationFrame.bind(window);
    w.__hold = true;
    window.requestAnimationFrame = (cb) => (w.__hold ? 0 : raf(cb));
    await new Promise((r) => setTimeout(r, 100));
    const g = w.game;
    g.engine.adapt = () => {};
    g.engine.maxPixelRatio = 1;
    g.engine.pixelRatio = 1;
    g.engine.renderer.setPixelRatio(1);
    g.engine.resize();
    g.traffic.station = null;
    for (const s of g.traffic.ships) s.obj.visible = false;
    g.ship.speed = 0;
    await g.remotes.view.prepare('lark');
    await w.step(60);
    g.hud.clearBanners();
    g.hud.setVisible(false);
    const replay = await import(/* @vite-ignore */ '/src/remote/replay.js');
    const s = g.ship.state;
    const q = s.quat;
    const V = s.pos.constructor;
    const Q = q.constructor;
    const dists = [120, 180, 260];
    w['__turn'] = (t: number) => q.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), Math.PI / 2 + 0.3 + 0.4 * t)).multiply(new Q().setFromAxisAngle(new V(1, 0, 0), 0.25));
    w['__at'] = (d: number, i: number, side: number) => new V(side * 0.16 * d, 6 + i * 0.04 * d, -d).applyQuaternion(q).add(s.pos);
    const t0 = (w.__t0 = g.time);
    const ticks = [];
    for (let k = 0; k < 1200; k++) {
      const t = t0 + k * 0.05;
      ticks.push({ time: t, entities: dists.map((d, i) => ({ id: 300 + i, kind: 'player', mode: 'ship', frame: `${g.system.seed}:station`, pos: w.__at(d, i, -1).toArray(), quat: w.__turn(t - t0).toArray(), vel: [0, 0, 0] })) });
    }
    g.remotes.replay = new replay.SnapshotReplay(replay.encodeStream(ticks, { latency: 0, jitter: 0 }));
    w.__clones = dists.map((d, i) => {
      const obj = g.ship.model.clone(true);
      obj.position.copy(w.__at(d, i, 1));
      g.station.root.add(obj);
      return obj;
    });
    w.__dists = dists;
    await w.step(90);
  });
  const measure = async (label: string, forceModel: boolean) =>
    page.evaluate(
      ({ label, forceModel }) => {
        const w = window as any;
        const g = w.game;
        const kit = g.remotes.view.kits.get('lark');
        const levels = kit.levels;
        if (forceModel) kit.levels = 1;
        const gl = g.engine.renderer.domElement;
        const c = document.createElement('canvas');
        c.width = gl.width;
        c.height = gl.height;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        const cam = g.engine.camera;
        const N = 24;
        const lum: number[][][] = [];
        let boxes: number[][] = [];
        for (let k = 0; k < N; k++) {
          // (render the clones as the remotes are: at the render time's pose)
          for (const o of w.__clones) o.quaternion.copy(w.__turn(g.remotes.renderTime - w.__t0 + 0.05 / 60));
          g.frame(1 / 60);
          ctx.drawImage(gl, 0, 0);
          if (k === 0) {
            // each ship's box on screen: both sides at each distance
            boxes = [];
            for (const side of [-1, 1])
              w.__dists.forEach((d: number, i: number) => {
                const p = w.__at(d, i, side);
                const wp = g.station.localToWorld(p, p.clone()).sub(g.camWorld).applyQuaternion(g.camWorldQuatInv).applyMatrix4(cam.projectionMatrix);
                const x = ((wp.x + 1) / 2) * c.width;
                const y = ((1 - wp.y) / 2) * c.height;
                const half = (16 / d) * (c.height / (2 * Math.tan((cam.fov * Math.PI) / 360))) * 0.6;
                boxes.push([Math.round(x - half), Math.round(y - half * 0.6), Math.round(half * 2), Math.round(half * 1.2)]);
              });
          }
          lum.push(
            boxes.map(([x, y, bw, bh]) => {
              const d = ctx.getImageData(x, y, bw, bh).data;
              const out = new Array(bw * bh);
              for (let j = 0; j < bw * bh; j++) out[j] = 0.2126 * d[j * 4] + 0.7152 * d[j * 4 + 1] + 0.0722 * d[j * 4 + 2];
              return out;
            }),
          );
        }
        kit.levels = levels;
        // per box: the mean |second temporal difference| over its pixels and frames, against its mean brightness change
        return {
          label,
          boxes,
          flicker: boxes.map((_, b) => {
            let sum = 0;
            let n = 0;
            for (let k = 1; k < N - 1; k++)
              for (let j = 0; j < lum[k][b].length; j++) {
                sum += Math.abs(lum[k][b][j] - (lum[k - 1][b][j] + lum[k + 1][b][j]) / 2);
                n++;
              }
            return +(sum / n).toFixed(3);
          }),
        };
      },
      { label, forceModel },
    );
  const a = await measure('remote with levels | clones', false);
  const b = await measure('remote at the model | clones', true);
  for (const m of [a, b]) console.log(m.label, 'remote 120/180/260:', m.flicker.slice(0, 3).join(' '), ' clone:', m.flicker.slice(3).join(' '));
  await page.screenshot({ path: `${OUT}/aa3.png` });
} finally {
  await browser.close();
  await vite.stop();
}
