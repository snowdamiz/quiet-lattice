// The asset class of a reviewed model (packages/tools/blender/families.json, as artlib/rules.py reads it), which sets
// the far views `pnpm capture -- --review` takes: every asset at 100 m (the rubric's silhouette distance), a hero also
// at 200 m.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ClassRules {
  families: Record<string, { class: string; classRules?: { match: string | string[]; class: string }[] }>;
  legacy?: Record<string, unknown>;
}

export function loadClassRules(root: string): ClassRules {
  return JSON.parse(readFileSync(join(root, 'packages/tools/blender/families.json'), 'utf8')) as ClassRules;
}

/** A glob (`*`, `?`, `[...]`, as Python's fnmatchcase) as a whole-string, case-sensitive RegExp. */
export function globRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end < 0) re += '\\[';
      else {
        const body = glob.slice(i + 1, end);
        re += `[${body.startsWith('!') ? '^' + body.slice(1) : body}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The family of a review spec's file: `<family>/<file>`, or a demo model at the top of public/models listed under
 * families.json "legacy" (`ship` is ship.glb, a hull). */
export function reviewFamily(rules: ClassRules, file: string): { family: string | null; legacyClass: string | null } {
  const slash = file.indexOf('/');
  if (slash > 0) {
    const family = file.slice(0, slash);
    return { family: family in rules.families ? family : null, legacyClass: null };
  }
  const entry = rules.legacy?.[`${file}.glb`] as { family?: string; class?: string } | undefined;
  return { family: entry?.family ?? null, legacyClass: entry?.class ?? null };
}

/** The class of one variant in a reviewed file: a legacy entry's class, else the family's classRules, else its default;
 * null for a file of no known family. */
export function reviewClass(rules: ClassRules, file: string, variant: string): string | null {
  const { family, legacyClass } = reviewFamily(rules, file);
  if (legacyClass) return legacyClass;
  const spec = family ? rules.families[family] : undefined;
  if (!spec) return null;
  for (const rule of spec.classRules ?? []) {
    if ([rule.match].flat().some((g) => globRegExp(g).test(variant))) return rule.class;
  }
  return spec.class;
}

/** The far views (metres) for a class: 100 m for every asset, and 200 m as well for a hero. */
export function farRanges(cls: string | null): number[] {
  return cls === 'hero' ? [100, 200] : [100];
}
