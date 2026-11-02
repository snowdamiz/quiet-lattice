import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNativeWorkClassResult, captureNativePass, nativePassArgs, saveNativeOutputs } from './native-pass-probe.ts';

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

  it('requires one exact class only with the separate work-class protocol', () => {
    const { args } = fixture();
    for (const workClass of ['drained-empty', 'fence-only', 'frame-only', 'frame-plus-PNG'])
      expect(nativePassArgs([...args, '--protocol', 'work-class', '--work-class', workClass])).toMatchObject({ protocol: 'work-class', workClass });
    for (const flags of [
      ['--protocol', 'work-class'],
      ['--protocol', 'work-class', '--work-class', 'all'],
      ['--work-class', 'frame-only'],
      ['--protocol', 'off-off', '--work-class', 'frame-only'],
      ['--protocol', 'work-class', '--work-class', 'frame-only', '--work-class', 'frame-only'],
    ])
      expect(() => nativePassArgs([...args, ...flags])).toThrow('work-class');
  });

  it('persists no image file for controls with structurally absent PNG', () => {
    const f = fixture();
    mkdirSync(f.out);
    const raw = { workClass: 'frame-only', samples: [{ operations: { frames: 1, png: 0, queries: 0 } }] };
    expect(saveNativeOutputs(raw, f.out)).toBe(raw);
    expect(raw.samples[0]).not.toHaveProperty('png');
    expect(() => readFileSync(join(f.out, 'frame-1.png'))).toThrow();
  });

  it('enforces zero image fields and exact control counts before persisting a frame-only result', () => {
    const good = { workClass: 'frame-only', samples: [{ operations: { frames: 1, png: 0, queries: 0 } }] };
    expect(() => assertNativeWorkClassResult(good, 'frame-only')).not.toThrow();
    for (const key of ['png', 'output', 'readbackStarted', 'readbackFinished'])
      expect(() => assertNativeWorkClassResult({ ...good, samples: [{ ...good.samples[0], [key]: null }] }, 'frame-only')).toThrow('structurally absent');
    expect(() => assertNativeWorkClassResult({ ...good, samples: [{ operations: { frames: 2, png: 0, queries: 0 } }] }, 'frame-only')).toThrow('counts');
    expect(() => assertNativeWorkClassResult(good, 'drained-empty')).toThrow('mismatched');
    expect(() =>
      assertNativeWorkClassResult({ workClass: 'frame-plus-PNG', samples: [{ operations: { frames: 1, png: 1, queries: 0 } }] }, 'frame-plus-PNG'),
    ).toThrow('missing');
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
