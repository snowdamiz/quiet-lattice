// One standard captureReview call. Disabled CLI imports only Node builtins and allocates nothing.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const RUNTIME_ENABLED = false;
export const requireFact = (ok, message) => {
  if (!ok) throw Error(message);
};
export const sha = (data) => createHash('sha256').update(data).digest('hex');
const originalWrite = fs.writeFileSync.bind(fs);
const same = (a, b) => canonical(a) === canonical(b);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

export function snapshot(file, cap = 2 * 1024 ** 2) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    requireFact(before.isFile() && before.size <= cap, 'JSON type/size cap');
    const buffer = Buffer.alloc(cap + 1);
    let length = 0,
      count;
    do {
      count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      length += count;
    } while (count && length < buffer.length);
    const after = fs.fstatSync(fd);
    requireFact(length <= cap && length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs, 'JSON changed/oversized');
    const data = buffer.subarray(0, length);
    return { path: file, bytes: length, sha256: sha(data), value: JSON.parse(data.toString('utf8')) };
  } finally {
    fs.closeSync(fd);
  }
}

export function outputPlan() {
  return [
    'noon-lush_lod0.png',
    'noon-lush_lod2.png',
    'wireframe_lod0.png',
    'wireframe_lod2.png',
    'overlay.png',
    'far_lod2.png',
    'night-exotic_lod0.png',
    'night-exotic_lod2.png',
    'open-space_lod0.png',
    'open-space_lod2.png',
    'perf.json',
    'sheet.png',
  ].map((n) => 'gravitic_pull/' + n);
}

export function raw(value, seen = new Set()) {
  if (value === undefined) return { type: 'undefined' };
  if (Buffer.isBuffer(value)) return { type: 'Buffer', base64: value.toString('base64') };
  if (value && typeof value === 'object') {
    if (seen.has(value)) return { circular: true };
    seen.add(value);
    const result = Array.isArray(value)
      ? value.map((v) => raw(v, seen))
      : Object.fromEntries(Object.getOwnPropertyNames(value).map((k) => [k, raw(value[k], seen)]));
    seen.delete(value);
    return result;
  }
  return typeof value === 'bigint' ? { bigint: String(value) } : value;
}

export function writeOutput(output, records, file, data, writer = originalWrite) {
  const relative = path.relative(output, path.resolve(file));
  requireFact(relative === outputPlan()[records.length], 'Unexpected/reordered output');
  requireFact(fs.realpathSync(path.dirname(file)) === path.dirname(file), 'Output parent symlink');
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  requireFact(bytes.length > 0 && bytes.length <= (relative.endsWith('/perf.json') ? 16384 : 16 * 1024 ** 2), 'Per-file output cap');
  requireFact(records.reduce((n, row) => n + row.bytes, 0) + bytes.length <= 184565760, 'Aggregate output cap');
  const row = { path: relative, bytes: bytes.length, sha256: sha(bytes), completed: false };
  records.push(row); // Reserve every attempted write, even close failures after actual bytes landed.
  try {
    writer(file, bytes, { flag: 'wx' });
    row.completed = true;
  } catch (error) {
    row.failure = raw(error);
    throw error;
  }
}

export function treeBinding(root) {
  const digest = createHash('sha256');
  let entries = 0,
    bytes = 0;
  function visit(directory) {
    const children = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((d) => !d.isDirectory() || !['.vite', '.vite-temp'].includes(d.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      const file = path.join(directory, child.name);
      let record;
      if (child.isSymbolicLink()) record = ['link', path.relative(root, file), fs.readlinkSync(file)];
      else if (child.isFile()) {
        const data = fs.readFileSync(file);
        bytes += data.length;
        record = ['file', path.relative(root, file), data.length, sha(data)];
      } else continue;
      digest.update(JSON.stringify(record) + '\n');
      entries++;
    }
    for (const child of children) if (child.isDirectory()) visit(path.join(directory, child.name));
  }
  visit(root);
  return { path: root, sha256: digest.digest('hex'), entries, bytes };
}

function verifyBindings(ready) {
  requireFact(process.execPath === ready.node && process.cwd() === ready.root, 'Node/CWD route changed');
  requireFact(
    process.env.SMOKE_GL === 'metal' &&
      !process.env.NODE_OPTIONS &&
      !process.env.NODE_PATH &&
      !process.env.ESBUILD_BINARY_PATH &&
      !process.env.PLAYWRIGHT_BROWSERS_PATH,
    'Native runtime environment mismatch',
  );
  for (const row of ready.bindings) {
    requireFact(
      fs.realpathSync(row.path) === row.realpath && fs.statSync(row.path).size === row.bytes && sha(fs.readFileSync(row.path)) === row.sha256,
      'Bound source changed: ' + row.path,
    );
  }
  for (const tree of ready.dependencyTrees) requireFact(same(treeBinding(tree.path), tree), 'Dependency bytes/routes changed: ' + tree.path);
}

async function loadCapture(ready) {
  const { tsImport } = await import(pathToFileURL(ready.tsxApi).href);
  return (await tsImport(pathToFileURL(path.join(ready.root, 'packages/tools/src/capture/capture.ts')).href, import.meta.url)).captureReview;
}

export async function execute({
  enabled = RUNTIME_ENABLED,
  readyPath,
  verify = verifyBindings,
  captureLoader = loadCapture,
  metadataWriter = originalWrite,
  stderr = (data) => fs.writeSync(2, data),
} = {}) {
  if (!enabled) return { accepted: false, state: 'DISABLED', nativeImports: 0, launches: 0, allocations: 0 };
  const readySnapshot = snapshot(readyPath),
    ready = readySnapshot.value,
    pilot = ready.pilot;
  requireFact(ready.runtimeEnabled === true && process.env.EFFECTS_READY_SHA256 === readySnapshot.sha256, 'Disabled/mismatched readiness');
  requireFact(
    pilot.file === 'effects/gravitic' &&
      pilot.asset === 'gravitic_pull' &&
      pilot.gl === 'metal' &&
      same(pilot.viewport, [1920, 1080]) &&
      same(pilot.files, outputPlan()),
    'Pilot scope mismatch',
  );
  const grant = snapshot(pilot.grant),
    consumption = snapshot(pilot.consumption),
    g = grant.value,
    c = consumption.value;
  requireFact(
    g.purpose === 'EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT' && g.oneUse === true && g.nativeReservesAccepted === true && new Date(g.expiresAt) > new Date(),
    'Missing/expired one-use grant',
  );
  requireFact(
    g.authorizationId === pilot.authorizationId &&
      g.authorizationId === process.env.EFFECTS_AUTHORIZATION &&
      same(g.pilot, pilot) &&
      g.readinessSha256 === readySnapshot.sha256,
    'Grant identity/scope mismatch',
  );
  requireFact(
    c.state === 'CONSUMED' &&
      c.accepted === false &&
      c.grantSha256 === grant.sha256 &&
      c.readinessSha256 === readySnapshot.sha256 &&
      same(c.pilot, pilot) &&
      same(c.source, g.source) &&
      g.source.clean === true &&
      c.authorizationId === pilot.authorizationId,
    'Consumption binding mismatch',
  );
  const source = snapshot(path.join(pilot.evidence, 'prelaunch-source.json'));
  requireFact(same(source.value, g.source), 'Clean prelaunch source binding missing');
  const review = snapshot(g.callerReview.path);
  requireFact(
    review.sha256 === g.callerReview.sha256 &&
      review.value.verdict === 'PASS' &&
      same(review.value.source, g.source) &&
      review.value.scope === 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW',
    'Caller review receipt binding',
  );
  verify(ready);
  requireFact(fs.realpathSync(pilot.output) === pilot.output && fs.readdirSync(pilot.output).length === 0, 'Fresh caller-owned output required');
  // Entry itself is one-use too. An attempted sentinel cannot be reused after a crash or late write failure.
  const result = {
    accepted: false,
    checksPassed: false,
    errors: [],
    writes: [],
    source: source.value,
    readinessSha256: readySnapshot.sha256,
    consumption: c,
    grantSnapshot: grant,
    reviewSnapshot: review,
  };
  let metadataBytes = 0;
  const persist = (file, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    requireFact(bytes.length <= 1024 ** 2 && metadataBytes + bytes.length <= 32 * 1024 ** 2, 'Node metadata cap');
    metadataBytes += bytes.length;
    metadataWriter(file, bytes, { flag: 'wx' });
  };
  const savedWrite = fs.writeFileSync;
  try {
    persist(path.join(pilot.evidence, 'entry-consumed.json'), { state: 'CONSUMED', readinessSha256: readySnapshot.sha256, consumption });
    fs.writeFileSync = (file, data, ...options) =>
      path.resolve(file).startsWith(pilot.output + path.sep) ? writeOutput(pilot.output, result.writes, file, data) : savedWrite(file, data, ...options);
    syncBuiltinESMExports();
    const captureReview = await captureLoader(ready);
    const paths = await captureReview(pilot.file, { asset: pilot.asset, outDir: pilot.output });
    requireFact(
      same(
        paths,
        outputPlan().map((p) => path.join(pilot.output, p)),
      ) &&
        result.writes.length === 12 &&
        result.writes.every((w) => w.completed),
      'Capture return/write inventory mismatch',
    );
    result.checksPassed = true;
  } catch (error) {
    result.errors.push({ phase: 'entry-capture', error: raw(error) });
  } finally {
    fs.writeFileSync = savedWrite;
    syncBuiltinESMExports();
  }
  try {
    persist(path.join(pilot.evidence, 'entry.json'), result);
  } catch (error) {
    result.checksPassed = false;
    result.errors.push({ phase: 'entry-final-write', error: raw(error) });
    try {
      persist(path.join(pilot.output, 'failed-entry.json'), result);
    } catch (secondary) {
      result.errors.push({ phase: 'entry-packet-fallback', error: raw(secondary) });
      try {
        const bytes = Buffer.from(JSON.stringify(result) + '\n');
        requireFact(bytes.length <= 1024 ** 2 && metadataBytes + bytes.length <= 32 * 1024 ** 2, 'Node stderr metadata cap');
        metadataBytes += bytes.length;
        stderr(bytes);
      } catch (last) {
        result.errors.push({ phase: 'entry-stderr-fallback', error: raw(last) });
      }
    }
    return result;
  }
  result.accepted = result.checksPassed && result.errors.length === 0;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await execute({ readyPath: process.argv[2] });
    process.exitCode = result.accepted ? 0 : result.state === 'DISABLED' ? 78 : 1;
  } catch (error) {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  }
}
