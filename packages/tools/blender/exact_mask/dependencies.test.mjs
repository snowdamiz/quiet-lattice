// Pure CPU import regression for the actual parameter-property module reached by Engine.
// No Blender, meshopt, GLTFLoader, renderer, service or generated asset.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const loader = process.argv[2] ?? new URL('./dependencies.mjs', import.meta.url).pathname;
const sites = new URL('../../../shared/src/world/sites.ts', import.meta.url).href;
const child = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '--eval', `
  import assert from 'node:assert/strict';
  const sites = await import(${JSON.stringify(sites)});
  assert.deepEqual(sites.SITE_TYPES, ['outpost', 'monolith', 'crash', 'beacon']);
  assert.equal(sites.FOOTPRINT.outpost, 16.5);
  assert.deepEqual(sites.denCounts(0, 1), { predator: 0, ambusher: 0, apex: 0 });
`], { encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' } });
assert.equal(child.error, undefined);
assert.equal(child.status, 0, child.stderr);
console.log('PASS: source sites.ts imports through the exact-mask resolver without strip-only failure');
