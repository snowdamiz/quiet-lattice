// pnpm turntable -- <asset.blend|asset.glb> [out_dir] [--asset A] [--variant V] [--grid [N]] [--family [N]] [--samples N]
//   the turntable and material close-up sheets for the visual grader (packages/tools/blender/turntable.py); --family
//   renders the sibling sheet instead (every asset and variant of the file in a row of its own, for the consistency
//   criterion)
// pnpm turntable:test
//   its self-test (packages/tools/blender/turntable_selftest.py): a small export-layout .glb rendered headless
// Finds Blender as pnpm art:* does (env BLENDER, else the macOS app, else `blender` on PATH), and for a .glb the KTX2
// tool its textures may need (KTX, else KTX-Software fetched on first use: ../art/ktx.ts). Set ART_RAW=1 to see
// Blender's own log lines.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gameLooksFor } from '@astra/shared/art';
import { ensureKtx } from '../art/ktx.ts';
import { BLENDER_DIR, blenderArgs, findBlender, isNoise } from '../art/targets.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CWD = process.env.INIT_CWD ?? process.cwd();
const RENDER_NOISE = [/^Fra:\d+ /, /^\s*Time: \d/, /(^|\| )Saved: /, /^Info: Saved /];

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
  const blender = findBlender(process.env);
  const raw = !!process.env.ART_RAW;
  return new Promise((done) => {
    const child = spawn(blender, blenderArgs(join(ROOT, BLENDER_DIR, script), args), {
      cwd: ROOT,
      env: { ...process.env, ...env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const [stream, out] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ] as const) {
      createInterface({ input: stream }).on('line', (line) => {
        if (raw || !(isNoise(line) || RENDER_NOISE.some((r) => r.test(line)))) out.write(line + '\n');
      });
    }
    child.on('error', (e) => {
      console.error(`turntable: cannot start Blender (${blender}): ${e.message}. Set BLENDER to the Blender executable.`);
      done(2);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

/** The art family of a model or source path: public/models/<family>/…, the demo's public/models/<family>.glb, or
 * assets/blend/<family>/…. */
export function familyOf(path: string): string {
  const parts = path.split(/[\\/]/);
  const at = (dir: string) => {
    const i = parts.lastIndexOf(dir);
    return i >= 0 && parts[i + 1] ? parts[i + 1]!.replace(/\.(glb|blend)$/, '') : null;
  };
  return at('models') ?? at('blend') ?? '';
}

const argv = process.argv.slice(2).filter((a) => a !== '--');
if (argv[0] === '--selftest') {
  // (the self-test compresses its asset as the export does: KTX2, then meshopt with this Node)
  process.exitCode = await run('turntable_selftest.py', argv.slice(1), { KTX: await ensureKtx(ROOT), ART_NODE: process.execPath });
} else if (!argv.length) {
  console.error('usage: pnpm turntable -- <asset.blend|asset.glb> [out_dir] [--asset A] [--variant V] [--grid [N]] [--family [N]] [--samples N]');
  process.exitCode = 2;
} else {
  // paths are relative to where pnpm was run, as the shell would read them
  const paths = argv.map((a, i) => (i < 2 && !a.startsWith('--') ? resolve(CWD, a) : a));
  const looks = gameLooksFor(familyOf(paths[0]!));
  // (an exported .glb holds KTX2 textures, which turntable.py transcodes back to import them)
  const env = /\.gl(b|tf)$/i.test(paths[0]!) ? { KTX: await ensureKtx(ROOT) } : {};
  process.exitCode = await run('turntable.py', looks.length ? [...paths, '--looks', JSON.stringify(looks)] : paths, env);
}
