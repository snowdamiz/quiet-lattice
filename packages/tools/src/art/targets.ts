// Argument handling for `pnpm art:*`: which files `art:validate` checks, which families `art:export` writes, and how
// Blender is found and started. The checks themselves run inside Blender (packages/tools/blender/*.py).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const BLENDER_DIR = 'packages/tools/blender';
export const SOURCES = 'assets/blend';
export const MAC_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
/** Validation tooling: a change here re-validates every source in `--changed` mode. */
const TOOLING = `${BLENDER_DIR}/`;
const TOOLING_IGNORED = [`${BLENDER_DIR}/reports/`, `${BLENDER_DIR}/selftest.py`];

export interface FamilyRules {
  families: Record<string, { export?: boolean }>;
}

export function loadRules(root: string): FamilyRules {
  return JSON.parse(readFileSync(join(root, BLENDER_DIR, 'families.json'), 'utf8')) as FamilyRules;
}

export function familyNames(rules: FamilyRules, exportable = false): string[] {
  return Object.entries(rules.families)
    .filter(([, f]) => !exportable || f.export !== false)
    .map(([name]) => name);
}

/** pnpm forwards a literal `--` in some versions; drop it wherever it appears. */
function clean(argv: string[]): string[] {
  return argv.filter((a) => a !== '--');
}

export interface ValidateArgs {
  targets: string[];
  /** undefined: not in --changed mode; null: --changed with the default base. */
  changed: string | null | undefined;
  all: boolean;
  /** Options handed to validate.py unchanged. */
  passthrough: string[];
}

const VALUE_FLAGS = new Set(['--family', '--class', '--report', '--report-dir']);
const BOOL_FLAGS = new Set(['--verbose', '--quiet']);

export function parseValidateArgs(argv: string[]): ValidateArgs {
  const args = clean(argv);
  const out: ValidateArgs = { targets: [], changed: undefined, all: false, passthrough: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--changed') {
      const next = args[i + 1];
      out.changed = next !== undefined && !next.startsWith('-') ? next : null;
      if (out.changed !== null) i++;
    } else if (a === '--all') {
      out.all = true;
    } else if (VALUE_FLAGS.has(a)) {
      if (args[i + 1] === undefined) throw new Error(`${a} needs a value`);
      out.passthrough.push(a, args[++i]);
    } else if (BOOL_FLAGS.has(a)) {
      out.passthrough.push(a);
    } else if (a.startsWith('-')) {
      throw new Error(`unknown option ${a}`);
    } else {
      out.targets.push(a);
    }
  }
  const modes = [out.all, out.changed !== undefined, out.targets.length > 0].filter(Boolean).length;
  if (modes === 0) throw new Error('nothing to validate: give an asset path, a family, --all or --changed [<git base>]');
  if (modes > 1) throw new Error('give asset paths/families, --all or --changed, not a mix');
  return out;
}

/** Every source .blend under assets/blend (repo-relative, sorted). */
export function allSources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.blend')) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(join(root, SOURCES));
  return out.sort();
}

export function familySources(root: string, family: string): string[] {
  if (family === 'library') return existsSync(join(root, SOURCES, '_library.blend')) ? [`${SOURCES}/_library.blend`] : [];
  return allSources(root).filter((p) => p.startsWith(`${SOURCES}/${family}/`) && !p.slice(SOURCES.length + family.length + 2).includes('/'));
}

/** Sources to validate given the files changed since the base. A change to the validator or its rules re-validates
 * every source; otherwise only the changed (added, copied, modified, renamed) .blend files under assets/blend. */
export function changedSources(changed: string[], sources: string[]): { files: string[]; reason: string } {
  const tooling = changed.filter((p) => p.startsWith(TOOLING) && !TOOLING_IGNORED.some((x) => p.startsWith(x)));
  if (tooling.length) {
    const which = tooling.length > 3 ? `${tooling.slice(0, 3).join(', ')} and ${tooling.length - 3} more` : tooling.join(', ');
    return { files: sources, reason: `validation tooling changed (${which}): every source` };
  }
  const set = new Set(sources);
  const files = changed.filter((p) => p.startsWith(`${SOURCES}/`) && p.endsWith('.blend') && set.has(p));
  return { files: [...new Set(files)].sort(), reason: files.length ? 'changed sources' : 'no changed .blend sources' };
}

export interface Resolved {
  files: string[];
  message: string;
}

/** Turns `art:validate` targets (paths or family names) into files. Relative paths resolve against `cwd` (the
 * directory pnpm was started from), family names against the repo. */
export function resolveTargets(root: string, cwd: string, targets: string[], rules: FamilyRules): Resolved {
  const families = familyNames(rules);
  const files: string[] = [];
  const empty: string[] = [];
  for (const t of targets) {
    const p = isAbsolute(t) ? t : resolve(cwd, t);
    if (existsSync(p) && statSync(p).isFile()) {
      files.push(p);
    } else if (existsSync(p) && statSync(p).isDirectory()) {
      const inside = allSources(root).filter((s) => resolve(root, s).startsWith(p + sep));
      if (!inside.length) empty.push(relative(root, p) || '.');
      files.push(...inside.map((s) => resolve(root, s)));
    } else if (families.includes(t)) {
      const found = familySources(root, t);
      if (!found.length) empty.push(t);
      files.push(...found.map((s) => resolve(root, s)));
    } else {
      throw new Error(`${t} is neither a file nor a family (${families.join(', ')})`);
    }
  }
  const message = empty.length ? `no .blend sources for ${empty.join(', ')} under ${SOURCES}/: nothing to validate there` : '';
  return { files, message };
}

export function parseExportArgs(argv: string[], rules: FamilyRules): { families: string[]; passthrough: string[] } {
  const args = clean(argv);
  const exportable = familyNames(rules, true);
  const families: string[] = [];
  const passthrough: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'all') families.push(...exportable);
    else if (['--only', '--bake-res', '--src-root', '--out-dir', '--report-dir'].includes(a)) {
      if (args[i + 1] === undefined) throw new Error(`${a} needs a value`);
      passthrough.push(a, args[++i]);
    } else if (BOOL_FLAGS.has(a)) passthrough.push(a);
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (exportable.includes(a)) families.push(a);
    else throw new Error(`unknown family ${a} (${exportable.join(', ')}, or all)`);
  }
  if (!families.length) throw new Error(`name a family to export (${exportable.join(', ')}, or all)`);
  return { families: [...new Set(families)], passthrough };
}

/** BLENDER, else the macOS app bundle, else `blender` on PATH (CI). */
export function findBlender(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string {
  if (env.BLENDER) return env.BLENDER;
  if (exists(MAC_BLENDER)) return MAC_BLENDER;
  return 'blender';
}

export function blenderArgs(script: string, args: string[]): string[] {
  return ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', ...args];
}

/** Blender's own chatter: file reads, glTF importer INFO lines, the version banner, and the two operator reports that
 * carry no news (a bake landing in its image, a file saved). Every other `Info:` report is shown: it may be the only
 * sign that an operator did nothing. */
const NOISE = [
  /^\d\d:\d\d:\d\d \| INFO: /,
  /^\d\d:\d\d\.\d+\s+blend\s+\| Read blend/,
  /^Info: (Baking map saved to internal image|Saved as)/,
  /^INFO (Draco|MeshOptimizer) is available/,
  /^Blender \d+\.\d+.*\(hash /,
  /^Blender quit$/,
];

export function isNoise(line: string): boolean {
  return NOISE.some((r) => r.test(line));
}
