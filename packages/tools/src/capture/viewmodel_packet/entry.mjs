/* global process, Buffer, console, window */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports, createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ENTRY_ENABLED = false;
const HERE = dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const need = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function metadata(path, expected, cap = 2 * 1024 * 1024) {
  need(typeof path === 'string' && resolve(path) === path && fs.realpathSync(path) === path, 'Noncanonical metadata');
  const s = fs.lstatSync(path);
  need(s.isFile() && s.size <= cap, 'Metadata cap/type');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    need(opened.isFile() && opened.size <= cap, 'Opened metadata cap/type');
    need(opened.ino === s.ino && opened.dev === s.dev && opened.size === s.size, 'Metadata replaced');
    const bytes = Buffer.alloc(cap + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!n) break;
      offset += n;
    }
    need(offset === s.size && offset <= cap, 'Metadata growth/truncation');
    const data = bytes.subarray(0, offset);
    need(!expected || digest(data) === expected, 'Metadata authentication');
    const value = JSON.parse(data.toString());
    need(value && typeof value === 'object' && !Array.isArray(value), 'Metadata object');
    return { value, sha256: digest(data) };
  } finally {
    fs.closeSync(fd);
  }
}
export function errorFacts(error) {
  const seen = new Set();
  function value(v) {
    if (v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)) return v;
    if (typeof v === 'bigint') return { bigint: String(v) };
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { base64: Buffer.from(v).toString('base64'), bytes: v.length };
    if (seen.has(v)) return '[cycle]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(value);
    return Object.fromEntries(Object.getOwnPropertyNames(v).map((k) => [k, value(v[k])]));
  }
  return value(error);
}

export async function execute(context, ports) {
  const record = { accepted: false, checksPassed: false, primaryFailure: null, secondaryFailures: [], writes: [], resources: [] };
  const cleanups = [];
  try {
    await ports.capture(context, record, cleanups);
    record.checksPassed = true;
  } catch (error) {
    const failure = errorFacts(error);
    record.primaryFailure = record.firstCaptureFailure ?? failure;
    if (record.firstCaptureFailure && JSON.stringify(failure) !== JSON.stringify(record.firstCaptureFailure))
      record.secondaryFailures.push({ phase: 'capture-finally', error: failure });
  }
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      record.secondaryFailures.push({ phase: 'cleanup', error: errorFacts(error) });
    }
  }
  record.checksPassed &&= record.secondaryFailures.length === 0;
  let durable = false;
  for (const name of ['entry-result.json', 'entry-fallback.json']) {
    try {
      await ports.receipt(name, record);
      durable = true;
      break;
    } catch (error) {
      record.secondaryFailures.push({ phase: name, error: errorFacts(error) });
      record.checksPassed = false;
    }
  }
  if (!durable) {
    try {
      ports.emit(JSON.stringify(record));
    } catch (error) {
      record.secondaryFailures.push({ phase: 'stderr', error: errorFacts(error) });
    }
  }
  return { code: record.checksPassed && durable ? 0 : 1, durable, record };
}

export function admit(env = process.env, enabled = ENTRY_ENABLED) {
  need(enabled, 'Viewmodel capture entry disabled');
  need(
    env.VIEWMODEL_READY && env.VIEWMODEL_CONSUMPTION && env.VIEWMODEL_ENTRY_TOKEN && env.VIEWMODEL_SOURCE_HEAD && env.VIEWMODEL_CONSUMPTION_SHA256,
    'Missing consumed parent grant',
  );
  const { value: consumption } = metadata(env.VIEWMODEL_CONSUMPTION, env.VIEWMODEL_CONSUMPTION_SHA256);
  need(
    consumption.entryToken === env.VIEWMODEL_ENTRY_TOKEN && consumption.unit === env.VIEWMODEL_UNIT && consumption.sourceHead === env.VIEWMODEL_SOURCE_HEAD,
    'Wrong entry claim',
  );
  const { value: ready, sha256 } = metadata(env.VIEWMODEL_READY, consumption.readySha256);
  const { value: grant } = metadata(consumption.grantPath, consumption.grantSha256);
  need(
    grant.authorizationId === consumption.authorizationId && grant.authorizedHead === consumption.sourceHead && grant.unit === consumption.unit,
    'Wrong grant identity',
  );
  need(ready.runtimeEnabled === true && ready.entryEnabled === true && grant.enabled === true && grant.readySha256 === sha256, 'Disabled grant/readiness');
  const plan = metadata(resolve(HERE, 'inventory.json')).value;
  need(plan.runtimeEnabled === true && plan.entryEnabled === true, 'Disabled inventory');
  const spec = plan.units.find((unit) => unit.id === consumption.unit);
  need(spec && ready.paths[spec.id].consumption === env.VIEWMODEL_CONSUMPTION && ready.paths[spec.id].ready === env.VIEWMODEL_READY, 'Wrong unit paths');
  need(process.execPath === ready.bindings.node, 'Wrong actual Node launcher');
  need(
    execFileSync('git', ['-C', ready.bindings.root, 'rev-parse', 'HEAD'], { timeout: 5000, encoding: 'utf8' }).trim() === consumption.sourceHead,
    'Source HEAD drift',
  );
  for (const pin of ready.bindings.bindings) {
    need(fs.realpathSync(pin.path) === pin.realpath, 'Binding route drift');
    const info = fs.statSync(pin.realpath);
    need(info.size === pin.bytes && info.size <= 512 * 1024 * 1024, 'Binding size drift');
    need(digest(fs.readFileSync(pin.realpath)) === pin.sha256, 'Binding bytes drift');
  }
  return { ready, spec, consumption, paths: ready.paths[spec.id] };
}

export async function productionCapture(context, record, cleanups) {
  const { ready, spec, paths } = context;
  // Observe operations before captureReview's frozen finally can replace their error.
  function observeOperation(operation) {
    const failed = (error) => {
      record.firstCaptureFailure ??= errorFacts(error);
      throw error;
    };
    return function (...args) {
      try {
        const value = operation.apply(this, args);
        return value?.then ? value.catch(failed) : value;
      } catch (error) {
        return failed(error);
      }
    };
  }
  const rawWrite = fs.writeFileSync.bind(fs);
  const originalWrite = fs.writeFileSync;
  let attemptedBytes = 0;
  const written = new Set();
  let page, reviewFacts;
  function write(path, data, options) {
    path = String(path);
    if (path !== paths.output && !path.startsWith(paths.output + sep)) return rawWrite(path, data, options);
    const name = path.slice(paths.output.length + 1);
    need(spec.files.includes(name) && !written.has(name), `Unexpected/repeated output ${name}`);
    if (name === 'perf.json') {
      const native = JSON.parse(String(data));
      need(reviewFacts?.captures.length === 10, 'Missing actual review capture facts');
      native.packet = {
        version: 1,
        unit: spec.id,
        people: spec.people,
        materials: reviewFacts.materials,
        captures: reviewFacts.captures.map((fact, i) => ({
          file: spec.files.filter((f) => f.endsWith('.png') && f !== 'sheet.png')[i],
          requestedLOD: fact.requestedLOD,
          selectedLOD: fact.selectedLOD,
          far: fact.far,
        })),
        overlayMarkers: ['Muzzle'],
        gripOverlay: false,
      };
      data = JSON.stringify(native);
    }
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    attemptedBytes += bytes.length;
    record.writes.push({ file: name, bytes: bytes.length, attemptedBytes });
    need(bytes.length <= (name.endsWith('.png') ? 16777216 : spec.readoutCap) && attemptedBytes <= spec.outputCap, 'Output byte ceiling');
    need(fs.realpathSync(dirname(path)) === paths.output && !fs.existsSync(path), 'Output path changed');
    rawWrite(path, bytes, { flag: 'wx' });
    written.add(name);
  }
  fs.writeFileSync = (...args) => {
    try {
      return write(...args);
    } catch (error) {
      record.firstCaptureFailure ??= errorFacts(error);
      throw error;
    }
  };
  syncBuiltinESMExports();
  cleanups.push(() => {
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
  });
  const { register } = createRequire(import.meta.url)(ready.bindings.tsxApi);
  const unregister = register();
  cleanups.push(unregister);
  const { chromium } = await import(pathToFileURL(ready.bindings.playwright).href);
  const fixture = await import('./fixture.mjs');
  const launch = chromium.launch;
  let launches = 0;
  chromium.launch = async (options) => {
    need(++launches === 1 && options.args.includes('--use-angle=metal'), 'One existing Metal launch only');
    const attempt = { operation: 'chromium.launch', executable: ready.bindings.browserBinary, args: options.args, state: 'attempting' };
    record.resources.push(attempt);
    const browser = await launch.call(chromium, { ...options, executablePath: ready.bindings.browserBinary });
    attempt.state = 'launched';
    cleanups.push(() => browser.close());
    const newPage = browser.newPage.bind(browser);
    browser.newPage = observeOperation(async (options) => {
      need(!page, 'Only one capture page');
      record.resources.push({ operation: 'browser.newPage', viewport: options.viewport, deviceScaleFactor: 1 });
      page = await newPage({ ...options, deviceScaleFactor: 1 });
      for (const name of ['on', 'addInitScript', 'goto', 'waitForFunction', 'waitForTimeout', 'setViewportSize', 'route']) {
        if (typeof page[name] === 'function') page[name] = observeOperation(page[name].bind(page));
      }
      await page.addInitScript(fixture.installPageFixture);
      if (spec.kind === 'review') {
        const evaluate = page.evaluate.bind(page);
        let instrumented = false;
        page.evaluate = observeOperation(async (fn, arg) => {
          let result;
          try {
            result = await evaluate(fn, arg);
          } catch (error) {
            record.firstCaptureFailure ??= errorFacts(error);
            throw error;
          }
          if (!instrumented && String(fn).includes('window.review.select')) {
            instrumented = true;
            await fixture.instrumentReview(page, spec.people);
          }
          if (instrumented && (String(fn).includes('window.review.capture') || String(fn).includes('window.review.stats'))) {
            reviewFacts = await evaluate(() => ({ captures: window.__viewmodelPacket.state.captures, materials: window.__viewmodelPacket.state.materials }));
          }
          return result;
        });
      }
      return page;
    });
    return browser;
  };
  cleanups.push(() => {
    chromium.launch = launch;
  });
  const capture = await import('../capture.ts');
  record.resources.push({
    operation: spec.kind === 'review' ? 'captureReview' : 'offline-first-person',
    unit: spec.id,
    output: paths.output,
    viteHelper: 'capture.ts:startVite',
  });
  if (spec.kind === 'review') await capture.captureReview(spec.asset, { outDir: paths.output });
  else
    await fixture.captureView({
      capture,
      chromium,
      spec,
      resources: cleanups,
      write: (name, data) => write(resolve(paths.output, name), name.endsWith('.png') ? Buffer.from(data.slice(data.indexOf(',') + 1), 'base64') : data),
    });
  need(written.size === spec.files.length, 'Incomplete output inventory');
}

export async function main() {
  const context = admit(); // No helper imports, allocations, or launch before this gate.
  fs.mkdirSync(resolve(context.paths.evidence, 'entry-claim'));
  let metadataBytes = 0;
  return execute(context, {
    capture: productionCapture,
    receipt: (name, record) => {
      const data = Buffer.from(JSON.stringify(record));
      metadataBytes += data.length;
      need(metadataBytes <= 8 * 1024 * 1024 && data.length <= 2 * 1024 * 1024, 'Entry metadata ceiling');
      fs.writeFileSync(resolve(context.paths.evidence, name), data, { flag: 'wx' });
    },
    emit: (data) => process.stderr.write(data),
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (result) => {
      process.exitCode = result.code;
    },
    (error) => {
      console.error(errorFacts(error));
      process.exitCode = 1;
    },
  );
}
