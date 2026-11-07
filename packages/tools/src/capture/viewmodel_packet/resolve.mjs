/* global process, console */
// Resolution only: no browser, bundler, or server launch.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { realpathSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const require = createRequire(import.meta.url);
const playwright = require.resolve('@playwright/test');
const core = createRequire(playwright).resolve('playwright-core/package.json');
const browsers = JSON.parse(readFileSync(join(dirname(core), 'browsers.json'), 'utf8'));
const shell = browsers.browsers.find((b) => b.name === 'chromium-headless-shell');
if (!shell || process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Pinned macOS arm64 browser required');
const esbuildRoot = createRequire(createRequire(require.resolve('tsx/esm/api')).resolve('esbuild')).resolve('@esbuild/darwin-arm64/package.json');
console.log(
  JSON.stringify({
    playwright: realpathSync(playwright),
    tsxApi: realpathSync(require.resolve('tsx/esm/api')),
    esbuild: realpathSync(join(dirname(esbuildRoot), 'bin/esbuild')),
    browserBinary: realpathSync(
      join(homedir(), 'Library/Caches/ms-playwright', `chromium_headless_shell-${shell.revision}`, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
    ),
  }),
);
