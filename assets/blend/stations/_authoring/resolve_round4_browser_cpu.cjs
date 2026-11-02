// Pure installed resolver. Every child_process execution path is blocked before Playwright loads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const spawnCalls = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  cp[name] = () => { spawnCalls.push(name); throw Error('Execution forbidden in CPU resolver'); };
}
// The reviewed worker passes only explicit environment keys; it does not inherit PWDEBUG.
delete process.env.PWDEBUG;
const root = path.resolve(__dirname, '../../../..');
const bundle = path.join(root, 'node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/lib/coreBundle.js');
const core = require(bundle);
const browserType = core.server.createPlaywright({ sdkLanguage: 'javascript', isInternalPlaywright: true }).chromium;
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const options = browserType._validateLaunchOptions({ args });
const selectedRegistryName = browserType.getExecutableName(options);
const selectedExecutable = core.registry.registry.findExecutable(selectedRegistryName).executablePath();
const binding = (p) => ({ path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), bytes: fs.statSync(p).size });
const directory = path.dirname(selectedExecutable);
const binaryCandidates = fs.readdirSync(directory).sort().map(n => path.join(directory, n))
  .filter(p => fs.statSync(p).isFile() && (p === selectedExecutable || p.endsWith('.dylib'))).map(binding);
console.log(JSON.stringify({ mode: 'CPU_ONLY_NO_LAUNCH', launchCall: 'chromium.launch({args})', args,
  validatedHeadless: options.headless, selectedRegistryName, selectedExecutable: binding(selectedExecutable),
  installedBinaryAndLibraryCandidates: binaryCandidates, helperNamesDoNotClaimObservedProcesses: true,
  installedPlaywrightBundle: binding(bundle), spawnCalls }, null, 2));
