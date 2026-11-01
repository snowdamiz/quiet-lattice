import { describe, expect, it } from 'vitest';
import { smokeArgs } from './targets.ts';

describe('smokeArgs', () => {
  it('runs the whole smoke directory without a file', () => {
    expect(smokeArgs([])).toEqual(['test', 'smoke']);
    expect(smokeArgs(['--'])).toEqual(['test', 'smoke']);
  });

  it('maps a bare name to its spec file', () => {
    expect(smokeArgs(['--', 'boot'])).toEqual(['test', 'src/smoke/boot.spec.ts']);
    expect(smokeArgs(['boot', 'den-pad'])).toEqual(['test', 'src/smoke/boot.spec.ts', 'src/smoke/den-pad.spec.ts']);
  });

  it('passes a path through as is, and flags after it', () => {
    expect(smokeArgs(['src/smoke/boot.spec.ts', '--reporter=dot'])).toEqual(['test', 'src/smoke/boot.spec.ts', '--reporter=dot']);
    expect(smokeArgs(['boot.spec.ts'])).toEqual(['test', 'boot.spec.ts']);
    expect(smokeArgs(['boot.spec.ts:4'])).toEqual(['test', 'boot.spec.ts:4']);
  });

  it('preserves flag values without turning them into file selectors', () => {
    expect(smokeArgs(['--', 'boot', '--grep', 'renders', '--timeout', '120000'])).toEqual([
      'test',
      'src/smoke/boot.spec.ts',
      '--grep',
      'renders',
      '--timeout',
      '120000',
    ]);
    expect(smokeArgs(['--grep', 'renders'])).toEqual(['test', 'smoke', '--grep', 'renders']);
  });
});
