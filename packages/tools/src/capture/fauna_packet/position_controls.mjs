// CPU-only real replay/remote/fauna/HUD/fixture integration. No renderer, browser or native child.
/* global window */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks, createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath, URL } from 'node:url';
import cp from 'node:child_process';
import net from 'node:net';
import { installAudit, samplePage } from './entry.mjs';
const root = fileURLToPath(new URL('../../../../..', import.meta.url));
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
  cp[key] = () => {
    throw Error('FORBIDDEN_CHILD');
  };
net.Server.prototype.listen = net.Socket.prototype.connect = () => {
  throw Error('FORBIDDEN_NETWORK');
};
syncBuiltinESMExports();
const ts = createRequire(root + '/package.json')('typescript');
const loaded = {};
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && spec.startsWith('.') && spec.endsWith('.js')) {
        const url = new URL(spec.slice(0, -3) + '.ts', ctx.parentURL);
        if (fs.existsSync(url)) return next(url.href, ctx);
      }
      throw error;
    }
  },
  load(url, ctx, next) {
    if (url.endsWith('.ts')) {
      const source = fs.readFileSync(new URL(url), 'utf8');
      loaded[url] = createHash('sha256').update(source).digest('hex');
      return {
        format: 'module',
        source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText,
        shortCircuit: true,
      };
    }
    return next(url, ctx);
  },
});
const from = (file) => import(pathToFileURL(path.join(root, file)).href);
const client = createRequire(root + '/packages/client/package.json');
const threeRoot = path.dirname(path.dirname(client.resolve('three')));
const threeEntry = JSON.parse(fs.readFileSync(path.join(threeRoot, 'package.json'), 'utf8')).exports['.'].import;
const THREE = await import(pathToFileURL(path.join(threeRoot, threeEntry)).href);
const { createPlanetParams } = await from('packages/shared/src/world/index.ts');
const { Body } = await from('packages/client/src/universe/Body.js');
const { RemoteEntities } = await from('packages/client/src/remote/RemoteEntities.js');
const { Fauna } = await from('packages/client/src/gameplay/Fauna.js');
const { HUD } = await from('packages/client/src/ui/HUD.js');
const { CombatFeed } = await from('packages/client/src/net/combat.js');
const { play } = await from('packages/client/src/remote/replay.js');
const { faunaFlyerKillPose } = await from('packages/tools/src/capture/screens.ts');
const rows = [];
for (const width of [1920, 2520])
  for (const delayed of [false, true]) {
    const ground = 60000,
      dt = 1 / 60;
    const planet = new Body({ name: 'planet', kind: 'planet', radius: ground });
    planet.params = createPlanetParams(11, 'lush', ground);
    planet.surfaceRadius = () => ground;
    const camera = new THREE.PerspectiveCamera(70, width / 1080, 0.1, 1e5);
    camera.updateMatrixWorld();
    const game = {
      time: 0,
      mode: 'title',
      engine: { camera, renderer: { domElement: { width, height: 1080 } } },
      camWorld: new THREE.Vector3(0, ground + 18, 20),
      camWorldQuatInv: new THREE.Quaternion(),
      audio: { creature() {} },
      system: { seed: 7, planets: [planet] },
      station: new Body({ kind: 'station' }),
      player: { state: { frame: planet, pos: new THREE.Vector3(0, ground + 0.5, 0) }, heading: new THREE.Vector3(0, 0, -1) },
    };
    const fauna = (game.fauna = new Fauna(game));
    const remotes = (game.remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => false, update() {} }, fauna }));
    const element = () => ({
      children: [],
      style: {},
      isConnected: true,
      appendChild(e) {
        e.parent = this;
        this.children.push(e);
      },
      remove() {
        this.isConnected = false;
        if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this);
      },
      animate() {},
      getAnimations() {
        return [{ pause() {}, currentTime: 0 }];
      },
    });
    const h = (game.hud = Object.create(HUD.prototype));
    Object.assign(h, { game, hitsEl: element(), t: 0, now: () => h.t, later: () => 0, toast() {} });
    const feed = new CombatFeed({ on() {}, entityId: 1, now: () => h.t });
    globalThis.window = { innerWidth: width, innerHeight: 1080 };
    globalThis.innerWidth = width;
    globalThis.innerHeight = 1080;
    globalThis.document = { createElement: element, querySelector: () => h.hitsEl.children[0] };
    const replay = play(game, 'herd', { seconds: 12, kills: { 601: 9, 603: 23.6, 606: 9 } });
    if (delayed) {
      let previous = -Infinity;
      for (const row of replay.stream) {
        row.arrival = Math.max(previous, row.arrival + (row.time >= 8.5 && row.time < 9 ? 0.18 : 0));
        previous = row.arrival;
      }
    }
    const step = async (n) => {
      for (let i = 0; i < n; i++) {
        game.time += dt;
        remotes.update(dt);
        h.updateHits(feed);
      }
    };
    const herd = {
      async stepTo(at) {
        await step(Math.max(0, Math.round((at - game.time) * 60)));
      },
      async aim(id, frames) {
        for (let i = 0; i < frames; i++) {
          const r = remotes.get(id),
            mid = r.pos.clone().addScaledVector(r.pos.clone().normalize(), fauna.speciesOf(r).size * 0.55);
          camera.lookAt(mid.sub(game.camWorld));
          camera.updateMatrixWorld();
          game.camWorldQuatInv.copy(camera.quaternion).invert();
          await step(1);
        }
      },
      hit(target, amount, killed) {
        feed.event({ kind: 'combat', source: 1, target, amount, killed, hp: killed ? 0 : 0.5 });
      },
    };
    Object.assign(window, { game, __feed: feed, __herd: herd, step });
    await herd.stepTo(2.4);
    const methods = installAudit('correction');
    assert.equal(methods['Fauna.update'], Fauna.prototype.update.toString());
    window.__faunaPacketAudit.phase = 'kill';
    await faunaFlyerKillPose();
    const sample = samplePage(),
      receipt = sample.flyer,
      calls = receipt.positionAudit.calls;
    assert.equal(calls.length, 44);
    assert.deepEqual(calls[0].after.position, receipt.sourcePosition);
    assert.deepEqual(calls.at(-1).after.position, receipt.sourcePositionAfter);
    for (const call of calls) assert.deepEqual(call.before, call.after);
    for (const call of calls) assert.deepEqual(call.before.authoritative, calls[0].before.authoritative);
    const delta = Math.max(...receipt.sourcePosition.map((v, i) => Math.abs(v - receipt.sourcePositionAfter[i])));
    if (delayed) assert.ok(delta > 1e-9, 'Real delayed snapshots must exercise between-frame settling');
    rows.push({ width, delayed, delta, receipt, sample });
    window.__restoreFaunaHudClock();
    fauna.reset();
  }
const out = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fauna-position-cpu-'));
fs.writeFileSync(
  path.join(out, 'results.json'),
  JSON.stringify({ status: 'PASS_REAL_SOURCE_CPU_ONLY', rows, loaded, nativeLaunches: 0, codecImports: 0 }, null, 2),
);
console.log(JSON.stringify({ out, cases: rows.length, deltas: rows.map(({ width, delayed, delta }) => ({ width, delayed, delta })), nativeLaunches: 0 }));
