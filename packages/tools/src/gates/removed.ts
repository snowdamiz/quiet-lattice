// pnpm gate:removed — DESIGN 20.3 lists demo code that must go once its replacement lands. Each rule pairs a piece of
// demo code with the plan task that replaces it; when that task is [x] in docs/IMPLEMENTATION_PLAN.md and the code
// is still there, the gate fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Rule {
  what: string;
  task: string;
  /** Repo-relative path. A client `.js` path also matches the file once it is migrated to `.ts`. */
  file?: string;
  /** If set, the rule fails only while this pattern is in the file; otherwise the file itself must be gone. */
  pattern?: RegExp;
  /** A directory searched recursively for `pattern` (instead of one file). */
  under?: string;
  /** A directory plus file-name pattern, for families of files (the Blender generators). */
  files?: { dir: string; name: RegExp };
}

const CLIENT = 'packages/client/src';

export const RULES: Rule[] = [
  {
    what: 'procedural outpost, monolith, crash and beacon builders',
    task: 'P1.E14.T07',
    file: `${CLIENT}/gameplay/Structures.js`,
    pattern: /function build(Outpost|Monolith|Crash|Beacon)\b/,
  },
  { what: 'procedural creature builders', task: 'P1.E14.T07', file: `${CLIENT}/gameplay/Fauna.js`, pattern: /function build(Quadruped|Flyer)\b/ },
  // the server owns herds from P1.E08.T01; the client renders them from snapshots once P1.E08.T09 lands
  { what: "the client's own herd spawner and herd AI", task: 'P1.E08.T09', file: `${CLIENT}/gameplay/Fauna.js`, pattern: /^\s+(spawnHerd|think)\s*\(/m },
  { what: 'procedural flora model builders', task: 'P1.E14.T07', file: `${CLIENT}/gameplay/floraModels.js` },
  { what: 'Blender geometry generators (build_*.py)', task: 'P1.E14.T07', files: { dir: 'blender', name: /^build_.*\.py$/ } },
  { what: 'box-geometry station build', task: 'P1.E11.T02', file: `${CLIENT}/universe/Station.js`, pattern: /\*buildSteps\s*\(/ },
  { what: 'decorative hologram trader', task: 'P1.E09.T05', file: `${CLIENT}/universe/Station.js`, pattern: /hologram trader/ },
  { what: 'flat RESOURCES price table', task: 'P1.E13.T03', file: `${CLIENT}/gameplay/Inventory.js`, pattern: /export const RESOURCES\b/ },
  { what: 'sell-only trade panel', task: 'P1.E11.T04', file: `${CLIENT}/ui/Menus.js`, pattern: /data-sell=/ },
  { what: 'SHOP list', task: 'P1.E07.T09', file: `${CLIENT}/ui/Menus.js`, pattern: /\bconst SHOP\b/ },
  // DESIGN 15.7: the warp cell recipe "replaces today's 1,800-unit purchase"
  { what: "the trade panel's 1,800-unit warp cell", task: 'P1.E13.T05', file: `${CLIENT}/ui/Menus.js`, pattern: /\bid: 'warpcell'/ },
  { what: 'applyUpgrade', task: 'P1.E07.T09', under: CLIENT, pattern: /\bapplyUpgrade\b/ },
  { what: 'death tax: ship rebuilt for 20% of units', task: 'P1.E06.T03', file: `${CLIENT}/Game.js`, pattern: /inventory\.units \* 0\.2\b/ },
  { what: 'death tax: towed home for 15% of units', task: 'P1.E06.T03', file: `${CLIENT}/entities/Pirates.js`, pattern: /\bplayerDefeated\s*\(/ },
  { what: 'suit failure recall to ship', task: 'P1.E06.T03', file: `${CLIENT}/Game.js`, pattern: /SUIT FAILURE/ },
  { what: 'random raid timer', task: 'P1.E08.T05', file: `${CLIENT}/entities/Pirates.js`, pattern: /\bnextRaid\b/ },
  { what: 'the objective chain and "THE STARS ARE YOURS" banner', task: 'P1.E09.T01', file: `${CLIENT}/gameplay/Objectives.js` },
  { what: '"THE STARS ARE YOURS" banner', task: 'P1.E09.T01', under: CLIENT, pattern: /THE STARS ARE YOURS/ },
  { what: 'localStorage save', task: 'P1.E04.T01', file: `${CLIENT}/gameplay/Save.js` },
  { what: 'demo discovery payout (250 to 650 units on a banner; the server pays 2000 XP once)', task: 'P2.E29.T01', file: `${CLIENT}/Game.js`, pattern: /\b250 \+ Math\.floor\(Math\.random\(\) \* 400\)/ },
  { what: 'demo multitool model', task: 'P1.E05.T03', file: 'packages/client/public/models/multitool.glb' },
];

/** Task id → status marker (' ', '~', 'R', 'x', '!') from the plan's task lines. */
export function planStatuses(plan: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of plan.matchAll(/^- \[(.)\] \*\*(P\d\.E\d+\.T\d+) /gm)) out.set(m[2], m[1]);
  return out;
}

function variants(path: string): string[] {
  return path.endsWith('.js') ? [path, path.replace(/\.js$/, '.ts')] : [path];
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Where the rule's demo code still exists (empty when it is gone). */
export function stillPresent(rule: Rule, root: string): string[] {
  if (rule.files) {
    const dir = join(root, rule.files.dir);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => rule.files!.name.test(n))
          .map((n) => join(rule.files!.dir, n))
      : [];
  }
  if (rule.under) {
    return walk(join(root, rule.under))
      .filter((p) => /\.(js|ts)$/.test(p) && !/\.test\.(js|ts)$/.test(p) && rule.pattern!.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p));
  }
  return variants(rule.file!).filter((f) => {
    const p = join(root, f);
    if (!existsSync(p)) return false;
    return rule.pattern ? rule.pattern.test(readFileSync(p, 'utf8')) : true;
  });
}

export function runGate(root: string, rules: Rule[] = RULES): { failures: string[]; pending: number; unknown: string[] } {
  const status = planStatuses(readFileSync(join(root, 'docs/IMPLEMENTATION_PLAN.md'), 'utf8'));
  const failures: string[] = [];
  const unknown: string[] = [];
  let pending = 0;
  for (const rule of rules) {
    const s = status.get(rule.task);
    if (s === undefined) unknown.push(`${rule.task} (${rule.what})`);
    if (s !== 'x') {
      pending++;
      continue;
    }
    for (const where of stillPresent(rule, root)) failures.push(`${rule.task} is done but ${rule.what} remains in ${where}`);
  }
  return { failures, pending, unknown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const { failures, pending, unknown } = runGate(root);
  for (const u of unknown) console.error(`gate:removed: rule names a task that is not in the plan: ${u}`);
  for (const f of failures) console.error(`gate:removed: ${f}`);
  if (failures.length || unknown.length) process.exit(1);
  console.log(`gate:removed: ok (${RULES.length - pending} rules enforced, ${pending} waiting on their replacement task)`);
}
