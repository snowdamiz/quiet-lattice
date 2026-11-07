// One fauna screen through the unchanged captureUi entry. No capture package imports until admission.
/* global window, innerWidth, innerHeight */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const writeFile = fs.writeFileSync.bind(fs);
export const sha = (data) => createHash('sha256').update(data).digest('hex');
export const requireFact = (ok, message) => {
  if (!ok) throw Error(message);
};

export function outputPlan(aspect, kind = 'correction') {
  requireFact(kind === 'correction' || (kind === 'broad' && aspect === '16x9'), 'Unexpected capture inventory');
  const result = [];
  for (const tag of ['16x9', '21x9']) {
    const names = kind === 'broad' ? ['', '-numbers', '-kill', '-flash', '-analysis', '-offscreen', '-start'] : ['', '-kill', '-offscreen', '-start'];
    for (const name of names) result.push(`${tag}${name}.png`);
    if (tag === aspect) {
      for (let i = 0; i < (kind === 'broad' ? 204 : 72); i++) result.push(`_frames/${String(i).padStart(3, '0')}.jpg`);
      result.push('readout.txt', 'clip-sheet.png');
    }
  }
  return result;
}

export function controlledWrite(output, plan, writes, file, data, maximum = 16 * 1024 * 1024) {
  const relative = path.relative(output, path.resolve(file));
  requireFact(relative === plan[writes.length] && !relative.startsWith('..'), 'Unexpected/reordered output');
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  requireFact(bytes.length <= (relative === 'readout.txt' ? 16384 : maximum), 'Controlled output exceeds per-file cap');
  writeFile(file, bytes, { flag: 'wx' });
  writes.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
}

export function describe(error) {
  const seen = new Map();
  const raw = (value, location = '$') => {
    if (value === undefined) return { type: 'undefined' };
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return { type: typeof value, value: String(value) };
    if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value) };
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return { reference: seen.get(value) };
    seen.set(value, location);
    if (ArrayBuffer.isView(value))
      return { type: value.constructor.name, base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
    if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', base64: Buffer.from(value).toString('base64') };
    if (Array.isArray(value)) return value.map((item, index) => raw(item, `${location}[${index}]`));
    const fields = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)))
      fields[key] = 'value' in descriptor ? raw(descriptor.value, `${location}.${key}`) : { accessor: true };
    return fields;
  };
  const details = raw(error);
  return {
    name: error?.name ?? typeof error,
    message: error?.message ?? String(error),
    ...(details && Object.hasOwn(details, 'code') ? { code: details.code } : {}),
    raw: details,
  };
}

function installAudit(kind) {
  const w = window,
    g = w.game,
    feed = w.__feed;
  const audit = (w.__faunaPacketAudit = { kind, phase: 'base', events: [], takes: [], identities: new WeakMap(), next: 0 });
  audit.identity = (r) => {
    if (!r) return null;
    if (!audit.identities.has(r)) audit.identities.set(r, ++audit.next);
    return audit.identities.get(r);
  };
  const stamp = () => ({
    phase: audit.phase,
    frame: w.__hitTurn?.frames.length ?? null,
    clipTime: w.__clip?.t ?? null,
    gameTime: g.time,
    hudTime: g.hud.now(),
  });
  const event = feed.event;
  feed.event = function (e) {
    const returned = event.call(this, e);
    const target = e.kind === 'combat' ? g.remotes.get(e.target) : null;
    audit.events.push({
      ...stamp(),
      event: { ...e },
      incarnation: audit.identity(target),
      queued: this.dealt.map((x) => ({ target: x.target, amount: x.amount, killed: x.killed, at: x.at })),
      queues: Object.fromEntries(['dealt', 'taken', 'gained'].map((key) => [key, this[key].map((x) => ({ ...x }))])),
    });
    if (audit.events.length > 32) throw Error('Unexpected extra fauna combat/reward events');
    return returned;
  };
  const take = feed.take;
  feed.take = function () {
    const returned = take.call(this);
    if (returned.dealt.length || returned.taken.length || returned.gained.length) audit.takes.push({ ...stamp(), returned });
    if (audit.takes.length > 32) throw Error('Unexpected extra fauna combat-feed consumption');
    return returned;
  };
  return {
    'HUD.hitNumber': g.hud.hitNumber.toString(),
    'HUD.hitAnchor': g.hud.hitAnchor.toString(),
    'Fauna.update': g.fauna.update.toString(),
    'Fauna.hitAnchor': g.fauna.hitAnchor.toString(),
    'CombatFeed.event': event.toString(),
    'CombatFeed.take': take.toString(),
  };
}

function samplePage() {
  const w = window,
    g = w.game,
    a = w.__faunaPacketAudit;
  const broadTarget = { base: 601, numbers: 601, kill: 601, flash: 601, analysis: 605, offscreen: 602, start: 603, fight: 603 };
  const r = g.remotes.get(a.kind === 'broad' ? broadTarget[a.phase] : a.phase === 'kill' ? 606 : 602);
  return {
    phase: a.phase,
    viewport: [innerWidth, innerHeight],
    canvas: [g.engine.renderer.domElement.width, g.engine.renderer.domElement.height],
    gameTime: g.time,
    clipTime: w.__clip?.t ?? null,
    hudTime: g.hud.now(),
    feedTime: w.__feed.net.now(),
    actor: w.__feed.net.entityId,
    traceFrame: w.__hitTurn?.frames.at(-1) ?? null,
    target: r && {
      id: r.id,
      incarnation: a.identity(r),
      mode: r.pose.mode,
      drawn: r.drawn,
      speciesKind: g.fauna.speciesOf(r).kind,
      visible: !!g.hud.hitAnchor(r),
    },
    numbers: g.hud.hitLive
      .filter((x) => x.el.isConnected)
      .map((x) => ({ value: x.el.textContent, target: x.target.id, incarnation: a.identity(x.target), sameRecord: g.remotes.get(x.target.id) === x.target })),
    events: a.events,
    takes: a.takes,
    flyer: a.phase === 'kill' ? w.__flyerKill : null,
  };
}

export function validateSample(raw, relative, aspect, kind = 'correction') {
  const width = relative.startsWith('21x9') || (relative.startsWith('_frames/') && aspect === '21x9') ? 2520 : 1920;
  requireFact(
    JSON.stringify(raw.viewport) === JSON.stringify([width, 1080]) && JSON.stringify(raw.canvas) === JSON.stringify(raw.viewport),
    'Actual viewport/canvas mismatch',
  );
  requireFact(
    raw.numbers.every((x) => x.sameRecord === true && Number.isInteger(x.incarnation)),
    'Number attached to a different record',
  );
  if (relative.includes('-offscreen')) {
    const events = raw.events.filter((x) => x.phase === 'offscreen' && x.event.kind === 'combat');
    const taken = raw.takes.filter((x) => x.phase === 'offscreen').flatMap((x) => x.returned.dealt);
    requireFact(
      JSON.stringify(events.map((x) => [x.event.target, x.event.amount])) === '[[602,17],[603,23],[602,9]]' &&
        taken.length === 3 &&
        raw.numbers.length === 0 &&
        !raw.target.visible,
      'Offscreen events/consumption/suppression missing',
    );
  }
  if (kind === 'broad') {
    requireFact(Number.isFinite(raw.gameTime) && Number.isFinite(raw.hudTime) && Number.isFinite(raw.feedTime), 'Nonfinite broad sample clock');
    requireFact(raw.actor === 1 && Array.isArray(raw.events) && Array.isArray(raw.takes), 'Incomplete broad feed journal');
    if (relative.startsWith('_frames/')) {
      const frame = Number(path.basename(relative, '.jpg'));
      requireFact(raw.phase === 'fight' && Math.abs(raw.clipTime - (frame + 1) / 60) < 0.000001, 'Actual broad frame/time mismatch');
    }
    return; // Broad stills deliberately hold DOM clones; independent visual grading inspects their pixels.
  }
  if (relative.includes('-kill')) {
    requireFact(
      raw.flyer?.offlineReplay === true && raw.flyer.target === 606 && raw.flyer.mode === 'dead' && raw.target.speciesKind === 'flyer',
      'Actual replay flyer death missing',
    );
    requireFact(raw.numbers.length === 1 && raw.numbers[0].value === '26' && raw.numbers[0].target === 606, 'Live flyer killing blow missing');
  }
  if (relative.startsWith('_frames/')) {
    const frame = Number(path.basename(relative, '.jpg'));
    requireFact(
      raw.phase === 'turn' && raw.traceFrame?.frame === frame && Math.abs(raw.traceFrame.ms - ((frame + 1) * 1000) / 60) < 0.001,
      'Actual manual frame/time mismatch',
    );
    requireFact(raw.target.id === 602 && (raw.target.visible || raw.numbers.length === 0), 'Live turn feedback lost target association');
    requireFact(
      raw.numbers.every((x) => x.target === 602 && x.incarnation === raw.target.incarnation),
      'Turn number changed target/incarnation',
    );
    if (frame === 10) requireFact(JSON.stringify(raw.numbers.map((x) => x.value)) === '["17","23","9"]', 'Three live pre-turn numbers missing');
    if (frame === 30) requireFact(!raw.target.visible && raw.numbers.length === 0, 'Offscreen turn hits visible');
    if (frame === 52) requireFact(raw.target.visible && raw.numbers.length === 0, 'Return did not expire old numbers');
    if (frame === 60) requireFact(raw.target.visible && JSON.stringify(raw.numbers.map((x) => x.value)) === '["11"]', 'Fresh return hit missing');
  }
}

export async function main() {
  const [, , readyPath, unit, consumedPath] = process.argv;
  const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
  requireFact(ready.runtimeEnabled === true, 'Readiness disabled before capture imports');
  const consumed = JSON.parse(fs.readFileSync(consumedPath, 'utf8'));
  const spec = ready.units[unit];
  requireFact(spec && consumed.unit === unit && consumed.readinessSha256 === sha(fs.readFileSync(readyPath)), 'Consumed one-screen grant mismatch');
  requireFact(
    fs.realpathSync(readyPath) === path.join(ready.root, 'packages/tools/src/capture/fauna_packet/readiness.json') &&
      consumedPath === spec.consumption &&
      JSON.stringify(consumed.spec) === JSON.stringify(spec),
    'Noncanonical readiness/consumption route',
  );
  const evidence = spec.evidence,
    output = spec.output,
    plan = outputPlan(spec.aspect, spec.kind),
    writes = [];
  const result = { accepted: false, primaryFailure: null, cleanupFailures: [], persistenceFailures: [], unit, writes, pages: 0, launched: 0, returned: null };
  const reportingErrors = new Set();
  let metadataBytes = 0;
  let launched = 0,
    pages = 0,
    returned = null,
    unregister = () => {};
  const oldWrite = fs.writeFileSync,
    oldRm = fs.rmSync;
  let restoreBrowser = () => {};
  const metadata = (name, value, append = false) => {
    try {
      const data = Buffer.from(JSON.stringify(value) + '\n');
      metadataBytes += data.length;
      requireFact(data.length <= 1024 * 1024 && metadataBytes <= 32 * 1024 * 1024, 'Controlled metadata cap exceeded');
      const file = path.join(evidence, name);
      if (append) fs.appendFileSync(file, data);
      else writeFile(file, data, { flag: 'wx' });
    } catch (error) {
      reportingErrors.add(error);
      result.persistenceFailures.push({ receipt: name, ...describe(error) });
      throw error;
    }
  };
  const attemptReceipt = (name, value) => {
    try {
      metadata(name, value);
    } catch {
      /* retained independently in result */
    }
  };
  try {
    requireFact(process.cwd() === ready.root && fs.realpathSync(process.execPath) === ready.node, 'Actual cwd/Node path changed');
    requireFact(
      process.execPath === ready.node && process.env.PATH === ready.path && process.env.NODE_OPTIONS === '' && process.env.SMOKE_GL === 'metal',
      'Pinned runtime routes changed',
    );
    for (const b of ready.bindings) requireFact(fs.realpathSync(b.path) === b.realpath && sha(fs.readFileSync(b.path)) === b.sha256, 'Input drift: ' + b.path);
    metadata('entry-controller-before-imports.json', {
      pid: process.pid,
      uid: process.getuid(),
      executable: process.execPath,
      readinessSha256: consumed.readinessSha256,
      unit,
    });
    // The ordinary capture path is imported only after the caller consumed its explicit grant.
    const { register } = await import(pathToFileURL(ready.tsxApi).href);
    unregister = register();
    const { transformSync } = await import(pathToFileURL(ready.esbuild).href);
    const canonical = (s) => sha(transformSync(`({${s}})`, { minifyWhitespace: true, legalComments: 'none', target: 'esnext' }).code);
    const { HUD } = await import(pathToFileURL(path.join(ready.root, 'packages/client/src/ui/HUD.js')).href);
    const { Fauna } = await import(pathToFileURL(path.join(ready.root, 'packages/client/src/gameplay/Fauna.js')).href);
    const { CombatFeed } = await import(pathToFileURL(path.join(ready.root, 'packages/client/src/net/combat.js')).href);
    const expectedMethods = {};
    for (const [name, fn] of Object.entries({
      'HUD.hitNumber': HUD.prototype.hitNumber,
      'HUD.hitAnchor': HUD.prototype.hitAnchor,
      'Fauna.update': Fauna.prototype.update,
      'Fauna.hitAnchor': Fauna.prototype.hitAnchor,
      'CombatFeed.event': CombatFeed.prototype.event,
      'CombatFeed.take': CombatFeed.prototype.take,
    }))
      expectedMethods[name] = canonical(fn.toString());
    metadata('source-methods.json', { unit, productBindings: ready.productBindings, expectedMethods });
    const { default: playwright } = await import(pathToFileURL(ready.playwright).href);
    const launch = playwright.chromium.launch.bind(playwright.chromium);
    restoreBrowser = () => {
      playwright.chromium.launch = launch;
    };
    playwright.chromium.launch = async (options) => {
      requireFact(++launched === 1 && !options.executablePath && !options.channel && !options.recordVideo, 'Nonstandard/duplicate browser launch refused');
      const browser = await launch(options); // Unchanged ordinary launch, observed by default StageReceipts.
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async (options) => {
        requireFact(++pages <= 2 && !options.recordVideo, 'Unexpected page/video request');
        const page = await newPage(options);
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async (options) => {
          const relative = path.relative(output, options.path);
          const before = await page.evaluate(samplePage);
          const bytes = await screenshot({ ...options, path: undefined });
          const after = await page.evaluate(samplePage);
          metadata(
            'capture-observations.jsonl',
            { ordinal: writes.length, path: relative, bytes: bytes.length, sha256: sha(bytes), sourceBindings: ready.productBindings, before, after },
            true,
          );
          requireFact(before.gameTime === after.gameTime && before.clipTime === after.clipTime, 'Game advanced during screenshot');
          validateSample(before, relative, spec.aspect, spec.kind);
          validateSample(after, relative, spec.aspect, spec.kind);
          controlledWrite(output, plan, writes, options.path, bytes);
          return bytes;
        };
        return page;
      };
      return browser;
    };
    fs.writeFileSync = (file, data, options) =>
      path.resolve(String(file)).startsWith(output + path.sep) ? controlledWrite(output, plan, writes, file, data) : oldWrite(file, data, options);
    fs.rmSync = (file, options) => {
      if (path.resolve(String(file)) === path.join(output, '_frames')) requireFact(!fs.existsSync(file), 'Existing frame namespace refused');
      return oldRm(file, options);
    };
    syncBuiltinESMExports();

    const { SCREENS } = await import(pathToFileURL(path.join(ready.root, 'packages/tools/src/capture/screens.ts')).href);
    const def = SCREENS[unit],
      open = def.open,
      motion = def.motion;
    const broad = spec.kind === 'broad';
    requireFact(
      def.clipSeconds === (broad ? 3.4 : 1.2) &&
        (def.clipAspect ?? '16x9') === spec.aspect &&
        JSON.stringify(Object.keys(def.stills)) === (broad ? '["numbers","kill","flash","analysis","offscreen","start"]' : '["kill","offscreen","start"]'),
      'Reviewed work definition changed',
    );
    requireFact(!def.crops?.length && !def.stills16x9 && !def.expectedErrors?.length, 'Unexpected extra capture/error exemptions');
    def.open = async (page) => {
      await open(page);
      const methods = await page.evaluate(installAudit, spec.kind);
      const actual = Object.fromEntries(Object.entries(methods).map(([name, source]) => [name, canonical(source)]));
      metadata(`page-source-${pages}.json`, { expectedMethods, actual });
      requireFact(JSON.stringify(actual) === JSON.stringify(expectedMethods), 'Actual page method identity differs from pinned source');
    };
    for (const [name, pose] of Object.entries(def.stills))
      def.stills[name] = async (page) => {
        await page.evaluate((phase) => {
          window.__faunaPacketAudit.phase = phase;
        }, name);
        await pose(page);
      };
    def.motion = async (page) => {
      await page.evaluate(
        (phase) => {
          window.__faunaPacketAudit.phase = phase;
        },
        broad ? 'fight' : 'turn',
      );
      await motion(page);
    };
    const { captureUi } = await import(pathToFileURL(path.join(ready.root, 'packages/tools/src/capture/capture.ts')).href);
    returned = await captureUi(unit, output);
    metadata('returned-entry-outcome.json', { returned, writes, pages, launched });
    requireFact(writes.length === plan.length && pages === 2 && launched === 1, 'Incomplete one-screen output');
    for (const b of ready.bindings) requireFact(sha(fs.readFileSync(b.path)) === b.sha256, 'Source changed during capture');
  } catch (error) {
    if (!reportingErrors.has(error)) {
      result.captureFailure = describe(error);
      if (error instanceof AggregateError && error.errors.length) {
        result.primaryFailure = describe(error.errors[0]);
        result.cleanupFailures.push(...error.errors.slice(1).map((value, index) => ({ phase: 'captureUi', ordinal: index + 1, ...describe(value) })));
      } else result.primaryFailure = describe(error);
    }
    Object.assign(result, { returned, pages, launched });
    attemptReceipt('returned-entry-failure.json', result);
  } finally {
    for (const [phase, cleanup] of [
      [
        'restore-fs',
        () => {
          fs.writeFileSync = oldWrite;
          fs.rmSync = oldRm;
          syncBuiltinESMExports();
        },
      ],
      ['restore-browser', restoreBrowser],
      ['unregister', () => unregister()],
    ]) {
      try {
        cleanup();
      } catch (error) {
        result.cleanupFailures.push({ phase, ...describe(error) });
      }
    }
  }
  Object.assign(result, { returned, pages, launched });
  result.accepted = !result.primaryFailure && !result.cleanupFailures.length && !result.persistenceFailures.length;
  attemptReceipt('entry-result.json', result);
  if (result.persistenceFailures.length) result.accepted = false;
  if (!result.accepted) {
    // Preserve the complete result in memory even if the final disk and stderr writers both fail.
    try {
      const fallback = JSON.stringify(result) + '\n';
      requireFact(Buffer.byteLength(fallback) <= 1024 * 1024, 'Fallback result exceeds 1 MiB');
      process.stderr.write(fallback);
    } catch (error) {
      result.persistenceFailures.push({ receipt: 'stderr', ...describe(error) });
    }
    throw Object.assign(new Error((result.primaryFailure ?? result.cleanupFailures[0] ?? result.persistenceFailures[0]).message), { entryResult: result });
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ accepted: false, error: e.message }) + '\n');
    process.exitCode = 1;
  });
