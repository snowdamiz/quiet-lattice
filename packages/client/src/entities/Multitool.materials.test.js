import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { expect, it } from 'vitest';

// Separate processes keep Engine's owned loader/transcoder promise isolated between
// injected Basis failures. No renderer, browser, server, or GPU is created.
for (const scenario of [
  'basis',
  'partial:Tool:baseColorTexture',
  'partial:Tool:normalTexture',
  'partial:Tool:metallicRoughnessTexture',
  'partial:Tool:emissiveTexture',
  'partial:Skin:normalTexture',
  'partial:Bio:emissiveTexture',
  'positive',
  'stale',
  'stale-partial',
  ...['thalune', 'ixari', 'ulgani'].flatMap((requested) => ['thalune', 'ixari', 'ulgani'].map((exported) => `pair:${requested}:${exported}`)),
]) {
  it(`real viewmodel texture consumer: ${scenario}`, () => {
    const output = execFileSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../test/characters/viewmodelConsumer.mjs', import.meta.url)), scenario],
      {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const result = JSON.parse(output.trim().split('\n').at(-1));
    expect(result.status).toBe('PASS');
    expect(result.loaderDisposals).toBe(0);
    expect(result.workers).toBeLessThanOrEqual(1);
  });
}
