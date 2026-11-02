// Task-local concrete station routes; adapted from the frozen, pending-review QA resolver.
// No package code, process launcher, server, browser or GPU is executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import net from 'node:net';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const forbiddenCalls = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = () => { forbiddenCalls.push(name); throw Error('Package execution forbidden in route check'); };
net.connect = net.createConnection = () => { forbiddenCalls.push('network'); throw Error('Network forbidden in route check'); };
syncBuiltinESMExports();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function ancestors(logical) {
  let current = path.parse(logical).root;
  const links = [];
  for (const part of logical.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink()) links.push({ path: current, linkText: fs.readlinkSync(current), resolved: fs.realpathSync(current) });
  }
  return links;
}
export function fileRoute(logical) {
  logical = path.resolve(logical);
  const links = ancestors(logical);
  let stat;
  try { stat = fs.lstatSync(logical); } catch (error) { if (error.code === 'ENOENT') return { logical, exists: false, links }; throw error; }
  const resolved = fs.realpathSync(logical), target = fs.statSync(resolved);
  return { logical, exists: true, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file', resolved, links, sha256: target.isFile() ? hash(resolved) : null };
}
export function moduleRoute(origin, specifier, mode) {
  const request = createRequire(origin);
  const entry = mode === 'import' ? fileURLToPath(import.meta.resolve(specifier, pathToFileURL(origin).href)) : request.resolve(specifier);
  let directory = path.dirname(entry);
  while (!fs.existsSync(path.join(directory, 'package.json'))) { const parent = path.dirname(directory); assert.notEqual(parent, directory); directory = parent; }
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const logicalPackages = (request.resolve.paths(name) ?? []).map((search) => path.join(search, name)).filter((candidate) => {
    try { return fs.realpathSync(candidate) === directory; } catch { return false; }
  }).map(fileRoute);
  return { origin, specifier, mode, logicalPackages, entry: fileRoute(entry), packageJson: fileRoute(path.join(directory, 'package.json')) };
}
function executable(name, searchPath) {
  for (const directory of searchPath.split(path.delimiter)) {
    const candidate = path.resolve(directory, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return fileRoute(candidate); } catch {}
  }
  throw Error('Missing executable ' + name);
}
export function collect(config) {
  const root = config.root, modules = [];
  const add = (origin, specifier, modes = ['import', 'require']) => {
    const rows = modes.map((mode) => moduleRoute(origin, specifier, mode)); modules.push(...rows); return rows[0].entry.resolved;
  };
  const tools = path.join(root, 'packages/tools/package.json'), capture = path.join(root, 'packages/tools/src/capture/capture.ts');
  const tsx = add(path.join(root, 'package.json'), 'tsx/cli');
  add(path.join(root, 'package.json'), 'tsx');
  const esbuild = add(tsx, 'esbuild');
  add(esbuild, '@esbuild/darwin-arm64/bin/esbuild', ['require']);
  const test = add(tools, '@playwright/test'); add(capture, '@playwright/test');
  const playwrightTest = add(test, 'playwright/test');
  const playwright = add(playwrightTest, 'playwright');
  const core = add(playwright, 'playwright-core');
  const vite = add(capture, 'vite'); add(path.join(root, 'packages/client/vite.config.js'), 'vite');
  add(vite, 'rolldown');
  add(path.join(root, 'packages/client/src/core/Engine.js'), 'three');
  const bin = path.join(root, 'node_modules/.bin');
  const pnpm = executable('pnpm', config.pathEnvironment);
  const pnpmBase = path.dirname(pnpm.resolved);
  const pnpmNode = path.resolve(pnpmBase, '../../node/bin/node');
  const pnpmEntry = path.resolve(pnpmBase, '../../node/node_modules/pnpm/bin/pnpm.mjs');
  // This exact installed wrapper was used by proof04. Do not guess a new wrapper ABI.
  const wrapper = fs.readFileSync(pnpm.resolved, 'utf8');
  assert(wrapper.includes('exec "${SCRIPT_DIR}/../../node/bin/node" "${SCRIPT_DIR}/../../node/node_modules/pnpm/bin/pnpm.mjs" "$@"'));
  const shim = executable('tsx', bin + path.delimiter + config.pathEnvironment);
  const shimTarget = fs.readFileSync(shim.resolved, 'utf8').match(/^# cmd-shim-target=(.+)$/m);
  assert(shimTarget, 'Unsupported tsx shim: no concrete installed target receipt');
  const target = path.resolve(path.dirname(shim.resolved), shimTarget[1]);
  assert.equal(fs.realpathSync(target), tsx, 'pnpm-exec shim and root tsx resolver disagree');
  const paths = [config.node, config.pnpm, pnpmNode, pnpmEntry, path.resolve(path.dirname(pnpmEntry), '../dist/pnpm.mjs'),
                 path.join(root, 'node_modules/.bin/tsx'), path.join(bin, 'node'), target, '/bin/sh'];
  for (const relative of ['node_modules/tsx', 'packages/tools/node_modules/@playwright/test',
       'packages/tools/node_modules/vite', 'packages/client/node_modules/vite', 'packages/client/node_modules/three']) paths.push(path.join(root, relative));
  const coreRoot = path.dirname(core);
  const captureCore = fileRoute(path.join(coreRoot, 'lib/coreBundle.js'));
  assert.equal(captureCore.resolved, config.acceptedCoreBundle, 'Logical capture route differs from qualified browser resolver core');
  paths.push(captureCore.logical, path.join(coreRoot, 'browsers.json'), path.join(coreRoot, 'lib/bootstrap.js'));
  // Bound installed source implements this default, and the bound client config has no cacheDir override.
  // The generated cache trees themselves are deliberately never traversed or hashed.
  const viteSource = path.join(path.dirname(vite), 'chunks/node.js');
  const source = fs.readFileSync(viteSource, 'utf8');
  assert(source.includes('else if (pkgDir) cacheDir = path.join(pkgDir, `node_modules/.vite`);'));
  const clientConfig = path.join(root, 'packages/client/vite.config.js');
  assert(!/\bcacheDir\s*:/.test(fs.readFileSync(clientConfig, 'utf8')), 'Explicit cacheDir requires new review');
  const client = path.join(root, 'packages/client');
  assert(fs.existsSync(path.join(client, 'package.json')));
  paths.push(viteSource, clientConfig, path.join(client, 'package.json'));
  return { schema: 'station-remaining8-resolution-routes-v1', config,
    executables: { node: executable('node', bin + path.delimiter + config.pathEnvironment), pnpm,
                   bash: executable('bash', config.pathEnvironment), tsx: shim },
    paths: [...new Set(paths)].map(fileRoute), modules, captureCore,
    cachePolicy: { installedDefaultCacheDir: path.join(client, 'node_modules/.vite'),
                   mutableGeneratedTreesNotBound: [path.join(client, 'node_modules/.vite'), path.join(client, 'node_modules/.vite-temp')],
                   evidence: 'Bound Vite source default with nearest package at packages/client; bound client config has no cacheDir override.' },
    forbiddenCalls };
}
export function assertSame(actual, expected) { assert.deepEqual(actual, expected, 'Station dependency resolution route changed'); }
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [mode, file] = process.argv.slice(2);
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (mode === '--collect') process.stdout.write(JSON.stringify(collect(input), null, 2) + '\n');
  else {
    assert.equal(mode, '--verify');
    assertSame(collect(input.config), input);
    process.stdout.write('Station dependency resolution routes match; no package/process/network execution.\n');
  }
}
