// Pure task-local routes. The retained collector refuses process and network calls.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fileRoute, moduleRoute, forbiddenCalls } from './retained-station/resolve_round4_station_routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const modules = [];
const add = (origin, specifier, mode = 'import') => {
  const row = moduleRoute(origin, specifier, mode);
  modules.push(row);
  return row.entry.resolved;
};
const tsx = add(root + '/package.json', 'tsx');
const esbuild = add(tsx, 'esbuild', 'require');
const esbuildBinary = add(esbuild, '@esbuild/darwin-arm64/bin/esbuild', 'require');
const test = add(root + '/packages/tools/package.json', '@playwright/test', 'require');
const pwtest = add(test, 'playwright/test', 'require');
const pw = add(pwtest, 'playwright', 'require');
const core = add(pw, 'playwright-core', 'require');
const vite = add(root + '/packages/tools/src/capture/capture.ts', 'vite');
add(vite, 'rolldown');
for (const name of ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/loaders/KTX2Loader.js', 'three/addons/libs/meshopt_decoder.module.js']) {
  add(root + '/packages/client/src/core/Engine.js', name);
}
const files = [
  'package.json',
  'pnpm-lock.yaml',
  'packages/tools/package.json',
  'packages/client/package.json',
  'packages/client/vite.config.js',
  'packages/tools/src/capture/capture.ts',
  'packages/tools/src/capture/classes.ts',
  'packages/tools/src/capture/screens.ts',
  'packages/client/public/basis/basis_transcoder.js',
  'packages/client/public/basis/basis_transcoder.wasm',
].map((p) => fileRoute(root + '/' + p));
const bundle = fs.realpathSync(path.join(path.dirname(core), 'lib/coreBundle.js'));
const source = fs.readFileSync(path.join(path.dirname(vite), 'chunks/node.js'), 'utf8');
if (
  !source.includes('else if (pkgDir) cacheDir = path.join(pkgDir, `node_modules/.vite`);') ||
  /\bcacheDir\s*:/.test(fs.readFileSync(root + '/packages/client/vite.config.js', 'utf8'))
)
  throw Error('Vite cache route needs review');
process.stdout.write(
  JSON.stringify(
    {
      root,
      node: fileRoute(process.execPath),
      tsxImport: tsx,
      esbuildBinary,
      bundle,
      modules,
      files,
      cachePaths: [root + '/packages/client/node_modules/.vite', root + '/packages/client/node_modules/.vite-temp'],
      forbiddenCalls,
    },
    null,
    2,
  ) + '\n',
);
