// pnpm art:validate -- <asset path | family>... | --all | --changed [<git base>]
// pnpm art:export -- <family>... | all
// pnpm art:test
// Finds Blender (env BLENDER, else the macOS app, else `blender` on PATH) and runs packages/tools/blender/*.py headless.
// Export, the self-test and validating a .glb also need the KTX2 encoder (KTX-Software's ktx, fetched on first use into
// node_modules/.cache; env KTX overrides it: ./ktx.ts). Set ART_RAW=1 to see Blender's own log lines.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ensureKtx } from './ktx.ts';
import {
  BLENDER_DIR,
  allSources,
  blenderArgs,
  changedSources,
  findBlender,
  isNoise,
  loadRules,
  parseExportArgs,
  parseValidateArgs,
  resolveTargets,
} from './targets.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CWD = process.env.INIT_CWD ?? process.cwd();

/** The environment Blender's scripts need to write and read KTX2 textures: KTX, the encoder (fetched when missing). */
async function ktxEnv(): Promise<NodeJS.ProcessEnv> {
  return { KTX: await ensureKtx(ROOT) };
}

function runBlender(script: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
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
        if (raw || !isNoise(line)) out.write(line + '\n');
      });
    }
    child.on('error', (e) => {
      console.error(`art: cannot start Blender (${blender}): ${e.message}. Set BLENDER to the Blender executable.`);
      done(2);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function defaultBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      // try the next one
    }
  }
  throw new Error('no origin/main or main to compare with; pass --changed <git base>');
}

function changedFiles(base: string): string[] {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase]);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
}

async function validate(argv: string[]): Promise<number> {
  const args = parseValidateArgs(argv);
  const rules = loadRules(ROOT);
  let files: string[];
  if (args.all) {
    files = allSources(ROOT);
    console.log(`art:validate: every source (${files.length}) under assets/blend`);
  } else if (args.changed !== undefined) {
    const base = args.changed ?? defaultBase();
    const { files: picked, reason } = changedSources(changedFiles(base), allSources(ROOT));
    files = picked;
    console.log(`art:validate --changed ${base}: ${reason}${picked.length ? ` (${picked.length})` : ''}`);
  } else {
    const resolved = resolveTargets(ROOT, CWD, args.targets, rules);
    if (resolved.message) console.log(`art:validate: ${resolved.message}`);
    files = resolved.files;
  }
  if (!files.length) {
    console.log('art:validate: nothing to validate');
    return 0;
  }
  // (an exported .glb may hold KTX2 textures, which the validator transcodes back to re-import them)
  const env = files.some((f) => /\.gl(b|tf)$/i.test(f)) ? await ktxEnv() : {};
  return runBlender('validate.py', [...args.passthrough, ...files], env);
}

async function exportFamilies(argv: string[]): Promise<number> {
  const { families, passthrough } = parseExportArgs(argv, loadRules(ROOT));
  let worst = 0;
  const env = await ktxEnv();
  for (const family of families) {
    const script = `export_${family}.py`;
    if (!existsSync(join(ROOT, BLENDER_DIR, script))) {
      console.error(`art:export: ${BLENDER_DIR}/${script} is missing`);
      return 2;
    }
    worst = Math.max(worst, await runBlender(script, passthrough, env));
  }
  return worst;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'validate') return await validate(rest);
    if (command === 'export') return await exportFamilies(rest);
    if (command === 'test')
      return await runBlender(
        'selftest.py',
        rest.filter((a) => a !== '--'),
        await ktxEnv(),
      );
  } catch (e) {
    console.error(`art:${command}: ${(e as Error).message}`);
    return 2;
  }
  console.error('usage: cli.ts validate|export|test [args]');
  return 2;
}

process.exitCode = await main();
