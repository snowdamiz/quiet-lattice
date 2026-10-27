// temporary: A/B of a remote Lark against a plain clone of the local ship at the same distances
import { chromium } from '@playwright/test';
import { glArgs, startVite } from './capture/capture.ts';

const OUT = '/private/tmp/claude-501/-Users-andreyyurlov-Documents-dev-space/8853f679-475f-4619-aa7a-8289e2676875/scratchpad';
const vite = await startVite();
const browser = await chromium.launch({ args: glArgs().args });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => m.type() === 'error' && console.log('page error:', m.text()));
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
    await w.step(60);
    g.hud.clearBanners();
    const url = '/src/remote/replay.js';
    const replay = await import(/* @vite-ignore */ url);
    const s = g.ship.state;
    const q = s.quat;
    // a remote Lark side-on at three distances, left half; a clone of the local model beside each, right half
    const dists = [90, 180, 320];
    const ticks = [];
    for (let k = 0; k < 400; k++) {
      const t = g.time + k * 0.05;
      const entities = dists.map((d, i) => {
        const v = s.pos.constructor;
        const p = new v(-0.18 * d, 6 + i * 0.05 * d, -d).applyQuaternion(q).add(s.pos);
        const yaw = q.clone().multiply(new q.constructor().setFromAxisAngle(new v(0, 1, 0), Math.PI / 2 + 0.3));
        return { id: 300 + i, kind: 'player', mode: 'ship', frame: `${g.system.seed}:station`, pos: p.toArray(), quat: yaw.toArray(), vel: [0, 0, 0] };
      });
      ticks.push({ time: t, entities });
    }
    g.remotes.replay = new replay.SnapshotReplay(replay.encodeStream(ticks));
    // plain clones (as Traffic makes them), parked beside each
    w.__clones = dists.map((d, i) => {
      const obj = g.ship.model.clone(true);
      const v = s.pos.constructor;
      obj.userData.local = new v(0.18 * d, 6 + i * 0.05 * d, -d).applyQuaternion(q).add(s.pos);
      obj.userData.quat = q.clone().multiply(new q.constructor().setFromAxisAngle(new v(0, 1, 0), Math.PI / 2 + 0.3));
      g.station.root.add(obj);
      return obj;
    });
    const frame = g.frame.bind(g);
    g.frame = (dt: number) => {
      for (const o of w.__clones) {
        o.position.copy(o.userData.local);
        o.quaternion.copy(o.userData.quat);
      }
      frame(dt);
    };
    await w.step(60);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/aa.png` });
} finally {
  await browser.close();
  await vite.stop();
}
