// In-engine captures of a review-only .glb (assemble_review.py's assembled kit) or of any reviewable spec, from named
// shots: a light case, a LOD, and the review API's far view, an orbit, or an explicit camera.
//
//   npx tsx assets/blend/stations/_authoring/review_assembled.ts (--glb <file.glb> | --spec <family>/<file>[:<asset>])
//       --out <dir> --shot <shot> [--shot <shot> ...]
//   a shot is comma-separated key=value: name=<png name>, light=noon-lush|night-exotic|open-space, lod=0..3, and one of
//     far=<m>[,from=bounds]        the review's far view: the camera m metres from the centre at the orbit's angles (with
//                                  from=bounds, m metres beyond the bounding sphere: an assembly's centre is inside it)
//     az=<deg>,el=<deg>,dist=<radii>  an orbit (clear=1 raises the elevation in 2° steps until the ground is out of the way)
//     eye=x/y/z,target=x/y/z       an explicit camera in the asset's Blender axes (Z up), metres
//   plus wire=1 for wireframe, perf=1..5 for paired performance readouts, and fov=<deg> for vertical field of view.
//
// A --glb is copied to packages/client/public/models/stations/_review_<pid>.glb for the run and deleted after it, so
// neither the validator nor an export ever sees it. Writes <out>/<name>.png per shot and <out>/shots.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const capture = await import(pathToFileURL(join(ROOT, 'packages/tools/src/capture/capture.ts')).href);
const req = createRequire(join(ROOT, 'packages/tools/package.json'));
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

type Shot = Record<string, string>;
const argv = process.argv.slice(2).filter((a) => a !== '--');
const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const shots: Shot[] = argv
  .flatMap((a, i) => (a === '--shot' ? [argv[i + 1]] : []))
  .map((s) => Object.fromEntries(s.split(',').map((kv) => kv.split('=') as [string, string])));
const out = resolve(opt('--out') ?? '.');
const glb = opt('--glb');
let spec = opt('--spec');
if ((!glb === !spec) || !shots.length || shots.some((s) => !s.name || !s.light)) {
  console.error('usage: review_assembled.ts (--glb <file.glb> | --spec <family>/<file>[:<asset>]) --out <dir> --shot name=..,light=..,lod=..[,far=..|,az=..,el=..,dist=..[,clear=1]|,eye=x/y/z,target=x/y/z][,wire=1][,fov=..]');
  process.exit(2);
}
const tmpName = `_review_${process.pid}`;
const tmpGlb = join(ROOT, 'packages/client/public/models/stations', `${tmpName}.glb`);
if (glb) spec = `stations/${tmpName}`;
const cleanup = () => existsSync(tmpGlb) && rmSync(tmpGlb);
process.on('SIGINT', () => (cleanup(), process.exit(130)));
process.on('SIGTERM', () => (cleanup(), process.exit(143)));

mkdirSync(out, { recursive: true });
if (glb) copyFileSync(resolve(glb), tmpGlb);
const log: unknown[] = existsSync(join(out, 'shots.json')) ? JSON.parse(readFileSync(join(out, 'shots.json'), 'utf8')) : [];
const { args, gl } = capture.glArgs();
let vite: { url: string; stop(): Promise<void> } | null = null;
let browser: { close(): Promise<void>; newPage(o: unknown): Promise<any> } | null = null;
let failed = false;
try {
  vite = await capture.startVite();
  browser = await chromium.launch({ args });
  const page = await browser!.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(m.text()));
  // (tsx's esbuild wraps named functions in __name(), which the page lacks)
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  // capture mode (no live loop) and a seeded Math.random, as pnpm capture runs it
  await page.addInitScript(() => {
    (window as unknown as { __reviewCapture: boolean }).__reviewCapture = true;
    let s = 0x9e3779b9;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(`${vite.url}/#review:${encodeURIComponent(spec!)}`);
  await page.waitForFunction(() => !!(window as any).review?.ready, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).review.ready);
  // an explicit camera: eye and target in the asset's frame, applied after the review's own orbit framing
  await page.evaluate(() => {
    const r = (window as any).review;
    const orig = r.updateView.bind(r);
    r.updateView = () => {
      orig();
      if (!r.__cam) return;
      const V = r.eyeLocal.constructor;
      const M = r.root.matrix.constructor;
      const origin = r.frame ? r.root.position : (r.spaceSpot ?? r.root.position);
      const toFrame = new M().compose(origin, r.root.quaternion, new V(1, 1, 1));
      const [e, t] = r.__cam;
      r.eyeLocal.set(e[0], e[2], -e[1]).applyMatrix4(toFrame);
      r.targetLocal.set(t[0], t[2], -t[1]).applyMatrix4(toFrame);
      r.viewQuat.setFromRotationMatrix(new M().lookAt(r.eyeLocal, r.targetLocal, r.upLocal));
      if (r.game.flora) r.game.flora.dirty = true;
    };
  });
  let current = '';
  for (const s of shots) {
    if (s.light !== current) {
      await page.evaluate((l: string) => (window as any).review.light(l), s.light);
      current = s.light;
    }
    const rec = await page.evaluate(async (s: Shot) => {
      const r = (window as any).review;
      const E = r.game.engine;
      const lod = Number(s.lod ?? 0);
      const v3 = (x: string) => x.split('/').map(Number);
      r.__cam = s.eye ? [v3(s.eye), v3(s.target)] : null;
      if (s.fov) {
        E.camera.fov = Number(s.fov);
        E.camera.updateProjectionMatrix();
      }
      let far = null;
      if (s.far) far = await r.far(Number(s.far) + (s.from === 'bounds' ? r.size : 0), { lod });
      else {
        await r.near();
        r.lod(lod);
        if (!s.eye) r.view(Number(s.az ?? r.orbit.azimuth), Number(s.el ?? r.orbit.elevation), Number(s.dist ?? r.orbit.distance));
        else r.updateView();
        if (s.clear === '1' && !s.eye) {
          while (r.groundBlocks() && r.orbit.elevation < 70) r.view(r.orbit.azimuth, r.orbit.elevation + 2, r.orbit.distance);
        }
        await r.serial(() => r.settle(90));
      }
      r.wireframe(s.wire === '1');
      const png = r.capture();
      const calls = E.renderer.info.render.calls;
      r.wireframe(false);
      const st = r.stats();
      const glContext = E.renderer.getContext();
      const debugRenderer = glContext.getExtension('WEBGL_debug_renderer_info');
      const perfRuns = Number(s.perf ?? 0);
      if (!Number.isInteger(perfRuns) || perfRuns < 0 || perfRuns > 5) throw new Error('perf must be a run count from 0 to 5');
      const perf = [];
      for (let run = 0; run < perfRuns; run++) perf.push(await r.perf({ pairs: 120 }));
      const res = {
        name: s.name,
        renderer: glContext.getParameter(debugRenderer ? debugRenderer.UNMASKED_RENDERER_WEBGL : glContext.RENDERER),
        viewport: [E.renderer.domElement.width, E.renderer.domElement.height],
        shot: s,
        far,
        orbit: { ...r.orbit },
        groundBlocks: r.groundBlocks(),
        fov: E.camera.fov,
        shown: r.shown,
        calls,
        triangles: st.triangles,
        meshes: st.meshes,
        pointLights: r.content.getObjectsByProperty('isPointLight', true).filter((o: { visible: boolean }) => o.visible).length,
        perf,
        png,
      };
      r.__cam = null;
      return res;
    }, s);
    const file = join(out, `${s.name}.png`);
    writeFileSync(file, Buffer.from(rec.png.slice(rec.png.indexOf(',') + 1), 'base64'));
    delete (rec as { png?: string }).png;
    log.push({ ...rec, spec: glb ? basename(glb) : spec, gl, at: new Date().toISOString() });
    console.log(`wrote ${file}  (ground blocks: ${rec.groundBlocks}, elevation ${rec.orbit.elevation}${rec.far ? `, far lift ${rec.far.lift}` : ''})`);
  }
  writeFileSync(join(out, 'shots.json'), JSON.stringify(log, null, 2) + '\n');
  if (errors.length) {
    console.error(`review page logged errors:\n${errors.join('\n')}`);
    failed = true;
  }
} finally {
  cleanup();
  await browser?.close();
  await vite?.stop();
}
process.exit(failed ? 1 : 0);
