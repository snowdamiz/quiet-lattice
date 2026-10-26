// pnpm turntable -- <asset.blend|asset.glb> [out_dir] [--asset A] [--variant V] [--grid [N]] [--samples N]
//   the turntable and material close-up sheets for the visual grader (packages/tools/blender/turntable.py)
// pnpm turntable:test
//   its self-test (packages/tools/blender/turntable_selftest.py): a small export-layout .glb rendered headless
// Finds Blender as pnpm art:* does (env BLENDER, else the macOS app, else `blender` on PATH). Set ART_RAW=1 to see
// Blender's own log lines.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BLENDER_DIR, blenderArgs, findBlender, isNoise } from '../art/targets.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CWD = process.env.INIT_CWD ?? process.cwd();
const RENDER_NOISE = [/^Fra:\d+ /, /^\s*Time: \d/, /(^|\| )Saved: /, /^Info: Saved /];

function run(script: string, args: string[]): Promise<number> {
  const blender = findBlender(process.env);
  const raw = !!process.env.ART_RAW;
  return new Promise((done) => {
    const child = spawn(blender, blenderArgs(join(ROOT, BLENDER_DIR, script), args), {
      cwd: ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
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

const argv = process.argv.slice(2).filter((a) => a !== '--');
if (argv[0] === '--selftest') {
  process.exitCode = await run('turntable_selftest.py', argv.slice(1));
} else if (!argv.length) {
  console.error('usage: pnpm turntable -- <asset.blend|asset.glb> [out_dir] [--asset A] [--variant V] [--grid [N]] [--samples N]');
  process.exitCode = 2;
} else {
  // paths are relative to where pnpm was run, as the shell would read them
  const paths = argv.map((a, i) => (i < 2 && !a.startsWith('--') ? resolve(CWD, a) : a));
  process.exitCode = await run('turntable.py', paths);
}
