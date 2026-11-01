import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A spec that takes `test` from @playwright/test skips the hang guard in harness.ts, and one stuck page then holds
// the whole run for the 16 minutes Playwright's teardown waits on it.
describe('smoke specs', () => {
  const dir = new URL('./', import.meta.url);
  const specs = readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));

  it('finds the specs', () => {
    expect(specs.length).toBeGreaterThan(10);
  });

  it.each(specs)('%s takes test from the harness', (file) => {
    const names = [...readFileSync(new URL(file, dir), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((n) => n.trim().split(/\s+/)[0]);
    expect(names).not.toContain('test');
  });
});
