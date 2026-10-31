import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KTX_RELEASES, KTX_VERSION, ensureKtx, findKtx, ktxDir, ktxRelease, sha256 } from './ktx.ts';

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

describe('fetching the pinned release', () => {
  const STEM = `KTX-Software-${KTX_VERSION}-Linux-x86_64`;
  const quiet = () => {};
  const serve = (bytes: Uint8Array, status = 200) => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return { ok: status === 200, status, arrayBuffer: async () => bytes.slice().buffer };
    };
    return { fetch, calls };
  };
  /** A release tarball laid out as Khronos ships it, whose `ktx` reports `version`. */
  const tarball = (version: string): Uint8Array => {
    const work = mkdtempSync(join(tmpdir(), 'ktx-release-'));
    mkdirSync(join(work, STEM, 'bin'), { recursive: true });
    mkdirSync(join(work, STEM, 'lib'), { recursive: true });
    writeFileSync(join(work, STEM, 'bin', 'ktx'), `#!/bin/sh\necho "ktx version: ${version}"\n`);
    chmodSync(join(work, STEM, 'bin', 'ktx'), 0o755);
    writeFileSync(join(work, STEM, 'lib', `libktx.so.${KTX_VERSION}`), 'not a library');
    execFileSync('tar', ['-cjf', join(work, `${STEM}.tar.bz2`), '-C', work, STEM]);
    return new Uint8Array(readFileSync(join(work, `${STEM}.tar.bz2`)));
  };
  const leftovers = (root: string) => (existsSync(join(root, 'node_modules', '.cache')) ? readdirSync(join(root, 'node_modules', '.cache')) : []);

  it('refuses a download whose SHA-256 is not the pinned one, and writes nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ktx-root-'));
    const { fetch } = serve(new TextEncoder().encode('not the release'));
    const release = { ...KTX_RELEASES['linux-x64']! };
    await expect(ensureKtx(root, {}, quiet, { fetch, release })).rejects.toThrow(/SHA-256 .* expected/);
    expect(leftovers(root)).toEqual([]);
    await expect(ensureKtx(root, {}, quiet, { fetch: serve(new Uint8Array(), 404).fetch, release })).rejects.toThrow(/HTTP 404/);
    expect(leftovers(root)).toEqual([]);
  });

  it('unpacks a release that matches its hash and reports the pinned version, once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ktx-root-'));
    const bytes = tarball(`v${KTX_VERSION}`);
    const { fetch, calls } = serve(bytes);
    const release = { file: `${STEM}.tar.bz2`, sha256: sha256(bytes), kind: 'tar' as const };
    const bin = await ensureKtx(root, {}, quiet, { fetch, release });
    expect(bin).toBe(join(ktxDir(root), 'bin', 'ktx'));
    expect(execFileSync(bin, ['--version'], { encoding: 'utf8' })).toContain(`v${KTX_VERSION}`);
    expect(existsSync(join(ktxDir(root), 'lib', 'libktx.so.4'))).toBe(true);
    expect(leftovers(root)).toEqual([`ktx-software-${KTX_VERSION}`]);
    // (cached: no second download)
    expect(await ensureKtx(root, {}, quiet, { fetch, release })).toBe(bin);
    expect(calls).toHaveLength(1);
  });

  it('refuses a release whose tool reports another version, and leaves no cache behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ktx-root-'));
    const bytes = tarball('v9.9.9');
    const release = { file: `${STEM}.tar.bz2`, sha256: sha256(bytes), kind: 'tar' as const };
    await expect(ensureKtx(root, {}, quiet, { fetch: serve(bytes).fetch, release })).rejects.toThrow(/reports .*v9\.9\.9/);
    expect(leftovers(root)).toEqual([]);
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
