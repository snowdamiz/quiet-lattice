import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KTX_RELEASES, KTX_VERSION, findKtx, ktxDir, ktxRelease, sha256 } from './ktx.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the KTX2 encoder (KTX-Software ktx)', () => {
  it('has a pinned release for macOS and Linux on both architectures', () => {
    for (const p of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) {
      const r = KTX_RELEASES[p]!;
      expect(r.file).toContain(KTX_VERSION);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(ktxRelease('linux', 'x64').kind).toBe('tar');
    expect(ktxRelease('darwin', 'arm64').kind).toBe('pkg');
    expect(() => ktxRelease('win32', 'x64')).toThrow(/set KTX/);
  });

  it('prefers KTX, then the fetched release, and reports none when neither is there', () => {
    const root = '/repo';
    const fetched = join(ktxDir(root), 'bin', 'ktx');
    expect(ktxDir(root)).toBe(join(root, 'node_modules', '.cache', `ktx-software-${KTX_VERSION}`));
    expect(findKtx({ KTX: '/opt/ktx' }, root, () => true)).toBe('/opt/ktx');
    expect(findKtx({}, root, (p) => p === fetched)).toBe(fetched);
    expect(findKtx({}, root, () => false)).toBeNull();
  });

  it('hashes with SHA-256', () => {
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe("the client's Basis transcoder", () => {
  // public/basis is a copy of three's own transcoder: the KTX2Loader of the installed three must find its own version.
  const three = createRequire(join(ROOT, 'packages/client/package.json'));
  for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    it(`public/basis/${file} is the installed three.js's copy`, () => {
      const ours = readFileSync(join(ROOT, 'packages/client/public/basis', file));
      const theirs = readFileSync(three.resolve(`three/examples/jsm/libs/basis/${file}`));
      expect(sha256(ours), 'copy node_modules/three/examples/jsm/libs/basis/* to packages/client/public/basis/').toBe(sha256(theirs));
    });
  }
});
