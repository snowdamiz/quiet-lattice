import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureNativePass, nativePassArgs, saveNativeOutputs } from './native-pass-probe.ts';

const dirs: string[] = [];
const SHA = 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARAAA//8DAAJZAXHr7wAAAABJRU5ErkJggg==';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'native-pass-cli-'));
  dirs.push(root);
  const assetPath = join(root, 'asset.glb');
  writeFileSync(assetPath, 'wrong asset bytes');
  const out = join(root, 'new-output');
  const args = ['--review', 'characters/thalune:thalune/thalune_suit2', '--asset-file', assetPath, '--asset-sha256', SHA, '--out', out];
  return { root, out, args, assetPath };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('bounded native diagnostic CLI boundary', () => {
  it('accepts only the exact single scene/light/hash with no recording customization', () => {
    const f = fixture();
    expect(nativePassArgs(f.args)).toMatchObject({ spec: 'characters/thalune:thalune/thalune_suit2', light: 'noon-lush', assetSha256: SHA });
    for (const [flag, value] of [
      ['--review', 'stations/waystation:ws_hangar/ws_hangar'],
      ['--light', 'open-space'],
      ['--asset-sha256', '0'.repeat(64)],
    ]) {
      const args = [...f.args];
      const i = args.indexOf(flag);
      if (i >= 0) args[i + 1] = value;
      else args.push(flag, value);
      expect(() => nativePassArgs(args)).toThrow('limited');
    }
    expect(() => nativePassArgs([...f.args, '--all-processes'])).toThrow();
    expect(() => nativePassArgs([...f.args, '--template', 'System Trace'])).toThrow();
  });

  it('opts into only the two-frame off/off protocol and preserves the default pass-query protocol', () => {
    const { args } = fixture();
    expect(nativePassArgs(args).protocol).toBe('pass-queries');
    expect(nativePassArgs([...args, '--protocol', 'off-off']).protocol).toBe('off-off');
    for (const flags of [['--protocol'], ['--protocol', 'all'], ['--protocol', 'off-off', '--protocol', 'off-off']])
      expect(() => nativePassArgs([...args, ...flags])).toThrow('protocol');
  });

  it('rejects changed asset bytes and existing reports before launching any browser or native recorder', async () => {
    const f = fixture();
    const options = nativePassArgs(f.args);
    await expect(captureNativePass(options)).rejects.toThrow('SHA-256');
    mkdirSync(f.out);
    const sentinel = join(f.out, 'original.json');
    writeFileSync(sentinel, 'preserved');
    await expect(captureNativePass(options)).rejects.toThrow('EEXIST');
    expect(readFileSync(sentinel, 'utf8')).toBe('preserved');
  });

  it('retains actual PNG bytes/hashes, preserves partial records and never overwrites a different artifact', () => {
    const f = fixture();
    mkdirSync(f.out);
    const raw = { failureKind: 'scene-output-mismatch', samples: [{ pair: 1, mode: 'off', png: `data:image/png;base64,${PNG}` }, { png: null }] };
    const saved = saveNativeOutputs(raw, f.out);
    expect(saved).toMatchObject({
      failureKind: 'scene-output-mismatch',
      samples: [{ output: { file: 'frame-1.png', sha256: expect.any(String) } }, { png: null }],
    });
    expect(readFileSync(join(f.out, 'frame-1.png')).equals(Buffer.from(PNG, 'base64'))).toBe(true);
    expect(raw.samples[0]).not.toHaveProperty('png');
    writeFileSync(join(f.out, 'frame-1.png'), 'preserved');
    expect(() => saveNativeOutputs({ samples: [{ png: `data:image/png;base64,${PNG}` }] }, f.out)).toThrow('refusing overwrite');
    expect(readFileSync(join(f.out, 'frame-1.png'), 'utf8')).toBe('preserved');
    expect(() => saveNativeOutputs({ samples: [{ png: 'data:image/png;base64,c2NlbmU=' }] }, f.out)).toThrow('PNG bytes');
  });
});
