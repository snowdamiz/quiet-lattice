// The KTX2 (Basis Universal) encoder the export uses to compress textures (P1.E14.T12): Khronos' KTX-Software `ktx`
// tool, pinned to one release and fetched once into node_modules/.cache (no system install, no root). `KTX` in the
// environment points at another `ktx` binary instead. packages/tools/blender/artlib/ktx.py runs it from inside Blender:
// `ktx create` encodes, `ktx extract` decodes for the validator's re-import.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KTX_VERSION = '4.4.2';
const BASE = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}`;

export interface KtxRelease {
  file: string;
  /** SHA-256 of the release asset (the Linux SHA-1s Khronos publishes beside them agree). */
  sha256: string;
  kind: 'pkg' | 'tar';
}

/** The official release assets by `${process.platform}-${process.arch}`. */
export const KTX_RELEASES: Readonly<Record<string, KtxRelease>> = {
  'darwin-arm64': {
    file: `KTX-Software-${KTX_VERSION}-Darwin-arm64.pkg`,
    sha256: '500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c',
    kind: 'pkg',
  },
  'darwin-x64': {
    file: `KTX-Software-${KTX_VERSION}-Darwin-x86_64.pkg`,
    sha256: 'efecc685ab891a6e119a9fdc8cbe038e135f9a367eb2f5d8a059553f947f1fea',
    kind: 'pkg',
  },
  'linux-x64': {
    file: `KTX-Software-${KTX_VERSION}-Linux-x86_64.tar.bz2`,
    sha256: 'a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245',
    kind: 'tar',
  },
  'linux-arm64': {
    file: `KTX-Software-${KTX_VERSION}-Linux-arm64.tar.bz2`,
    sha256: '60382e7b842177b8048bd58ccdc770383f8ef65b94452a25d3afdb55f2405c5a',
    kind: 'tar',
  },
};

/** Where the pinned release lives once fetched: `<dir>/bin/ktx` beside `<dir>/lib/libktx.*` (the binary's rpath). */
export function ktxDir(root: string): string {
  return join(root, 'node_modules', '.cache', `ktx-software-${KTX_VERSION}`);
}

export function ktxRelease(platform: string, arch: string): KtxRelease {
  const r = KTX_RELEASES[`${platform}-${arch}`];
  if (!r) throw new Error(`no KTX-Software ${KTX_VERSION} build for ${platform}-${arch}; install KTX-Software and set KTX to its ktx binary`);
  return r;
}

/** `KTX` from the environment, else the fetched release when it is there, else null. */
export function findKtx(env: NodeJS.ProcessEnv, root: string, exists: (p: string) => boolean = existsSync): string | null {
  if (env.KTX) return env.KTX;
  const bin = join(ktxDir(root), 'bin', 'ktx');
  return exists(bin) ? bin : null;
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Unpacks the release into `dir` (bin/ktx, lib/libktx.*): a macOS .pkg is expanded with pkgutil (nothing installed),
 * a Linux tarball is extracted as it is. */
function unpack(release: KtxRelease, archive: string, work: string, dir: string): void {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  if (release.kind === 'pkg') {
    const x = join(work, 'x');
    execFileSync('pkgutil', ['--expand-full', archive, x]);
    const stem = release.file.replace(/\.pkg$/, '');
    copyFileSync(join(x, `${stem}-tools.pkg`, 'Payload', 'usr', 'local', 'bin', 'ktx'), join(dir, 'bin', 'ktx'));
    // (the payload's libktx.4.dylib is a link to the versioned file; the binary asks for @rpath/libktx.4.dylib)
    copyFileSync(join(x, `${stem}-library.pkg`, 'Payload', 'usr', 'local', 'lib', `libktx.${KTX_VERSION}.dylib`), join(dir, 'lib', 'libktx.4.dylib'));
  } else {
    execFileSync('tar', ['-xjf', archive, '-C', work]);
    const top = join(work, release.file.replace(/\.tar\.bz2$/, ''));
    copyFileSync(join(top, 'bin', 'ktx'), join(dir, 'bin', 'ktx'));
    copyFileSync(join(top, 'lib', `libktx.so.${KTX_VERSION}`), join(dir, 'lib', 'libktx.so.4'));
  }
  chmodSync(join(dir, 'bin', 'ktx'), 0o755);
}

/** The `ktx` binary: KTX, else the fetched release, fetching it first (once) when it is missing. The download is checked
 * against its pinned SHA-256 and the unpacked tool must report the pinned version. */
export async function ensureKtx(root: string, env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Promise<string> {
  const found = findKtx(env, root);
  if (found) return found;
  const release = ktxRelease(process.platform, process.arch);
  const dir = ktxDir(root);
  log(`art: fetching KTX-Software ${KTX_VERSION} (${release.file}) into ${dir}`);
  const res = await fetch(`${BASE}/${release.file}`);
  if (!res.ok) throw new Error(`downloading ${release.file} failed: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const got = sha256(data);
  if (got !== release.sha256) throw new Error(`${release.file} has SHA-256 ${got}, expected ${release.sha256}; not using it`);
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, 'node_modules', '.cache', 'ktx-fetch-'));
  const staging = join(work, 'out');
  try {
    const archive = join(work, release.file);
    writeFileSync(archive, data);
    unpack(release, archive, work, staging);
    const version = execFileSync(join(staging, 'bin', 'ktx'), ['--version'], { encoding: 'utf8' }).trim();
    if (!version.includes(`v${KTX_VERSION}`)) throw new Error(`the unpacked ktx reports '${version}', expected v${KTX_VERSION}`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return join(dir, 'bin', 'ktx');
}
