// Isolated fake dependency trees only. Never modify an installed package/link or execute a package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileRoute, moduleRoute, assertSame, forbiddenCalls } from './resolve_round4_station_routes.mjs';
if (process.argv[2] === '--query') {
  const query = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  process.stdout.write(JSON.stringify(moduleRoute(query.origin, query.specifier, query.mode)) + '\n');
  process.exit(0);
}
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'station-route-unit-'));
const results = [];
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function test(name, run) {
  const root = path.join(base, name); fs.mkdirSync(root);
  run(root); results.push({ name, status: 'PASS' });
}
function fakePackage(directory, esm = 'index.mjs', cjs = 'index.cjs') {
  write(path.join(directory, 'package.json'), JSON.stringify({ name: 'fake-route', exports: { import: './' + esm, require: './' + cjs } }));
  write(path.join(directory, esm), 'throw Error("fixture package must never execute");');
  write(path.join(directory, cjs), 'throw Error("fixture package must never execute");');
}
function fixture(root) {
  const origin = path.join(root, 'project/deep/entry.mjs'), packages = path.join(root, 'project/node_modules');
  fs.mkdirSync(path.dirname(origin), { recursive: true }); fs.mkdirSync(packages, { recursive: true });
  const old = path.join(root, 'store/old'), other = path.join(root, 'store/other');
  fakePackage(old); fakePackage(other);
  const logical = path.join(packages, 'fake-route'); fs.symlinkSync(old, logical);
  return { origin, packages, old, other, logical };
}
try {
  test('unchanged-import-and-require', root => {
    const f = fixture(root);
    for (const mode of ['import', 'require']) assertSame(moduleRoute(f.origin, 'fake-route', mode), moduleRoute(f.origin, 'fake-route', mode));
  });
  test('directory-retarget-old-bytes-remain', root => {
    const f = fixture(root), expected = moduleRoute(f.origin, 'fake-route', 'import'), before = fs.readFileSync(path.join(f.old, 'index.mjs'));
    fs.unlinkSync(f.logical); fs.symlinkSync(f.other, f.logical);
    assert.deepEqual(fs.readFileSync(path.join(f.old, 'index.mjs')), before);
    assert.throws(() => assertSame(moduleRoute(f.origin, 'fake-route', 'import'), expected));
  });
  test('ancestor-retarget', root => {
    const first = path.join(root, 'first'), second = path.join(root, 'second');
    write(path.join(first, 'entry.mjs'), 'same bytes'); write(path.join(second, 'entry.mjs'), 'same bytes');
    const link = path.join(root, 'ancestor'); fs.symlinkSync(first, link);
    const expected = fileRoute(path.join(link, 'entry.mjs'));
    fs.unlinkSync(link); fs.symlinkSync(second, link);
    assert.throws(() => assertSame(fileRoute(path.join(link, 'entry.mjs')), expected));
  });
  test('link-text-change-same-real-target', root => {
    const f = fixture(root), expected = fileRoute(f.logical);
    fs.unlinkSync(f.logical); fs.symlinkSync(path.relative(f.packages, f.old), f.logical);
    assert.equal(fileRoute(f.logical).resolved, expected.resolved);
    assert.throws(() => assertSame(fileRoute(f.logical), expected));
  });
  test('new-earlier-shadow-path', root => {
    const f = fixture(root), logical = path.join(root, 'project/deep/node_modules/fake-route');
    const expected = fileRoute(logical); fakePackage(logical);
    assert.throws(() => assertSame(fileRoute(logical), expected));
  });
  test('esm-exports-retarget-old-entry-retained', root => {
    const f = fixture(root), expected = moduleRoute(f.origin, 'fake-route', 'import');
    fakePackage(f.old, 'replacement.mjs');
    assert(fs.existsSync(path.join(f.old, 'index.mjs')));
    assert.throws(() => assertSame(moduleRoute(f.origin, 'fake-route', 'import'), expected));
  });
  test('require-entry-bytes-changed', root => {
    const f = fixture(root), expected = moduleRoute(f.origin, 'fake-route', 'require');
    write(path.join(f.old, 'index.cjs'), 'changed fixture bytes');
    assert.throws(() => assertSame(moduleRoute(f.origin, 'fake-route', 'require'), expected));
  });
  test('shim-byte-change', root => {
    const shim = path.join(root, '.bin/tsx'); write(shim, '#!/bin/sh\n# first fixture');
    const expected = fileRoute(shim); write(shim, '#!/bin/sh\n# replacement fixture');
    assert.throws(() => assertSame(fileRoute(shim), expected));
  });
  test('previously-absent-bin-node', root => {
    const file = path.join(root, '.bin/node'); fs.mkdirSync(path.dirname(file)); const expected = fileRoute(file);
    write(file, 'fixture only'); assert.throws(() => assertSame(fileRoute(file), expected));
  });
  test('missing-entry-fails', root => {
    const f = fixture(root); fs.unlinkSync(path.join(f.old, 'index.cjs'));
    assert.throws(() => moduleRoute(f.origin, 'fake-route', 'require'));
  });
  test('generated-vite-cache-children-not-topology', root => {
    const f = fixture(root), expected = moduleRoute(f.origin, 'fake-route', 'import');
    write(path.join(f.packages, '.vite/deps/generated.js'), 'mutable generated bytes');
    write(path.join(f.packages, '.vite-temp/config.timestamp-123.mjs'), 'mutable config bundle');
    assertSame(moduleRoute(f.origin, 'fake-route', 'import'), expected);
  });
  test('all-execution-and-network-attempts-absent', () => assert.deepEqual(forbiddenCalls, []));
} finally {
  fs.rmSync(base, { recursive: true });
}
assert(!fs.existsSync(base));
process.stdout.write(JSON.stringify({ mode: 'CPU_FAKE_ROUTES_ONLY', results, fixtureRoot: base,
  fixtureRootAbsent: true, realDependencyMutation: false, forbiddenCalls }, null, 2) + '\n');
