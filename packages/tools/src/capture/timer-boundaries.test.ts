import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureTimerBoundaries, timerBoundaryArgs, timerBoundaryAsset } from './timer-boundaries.ts';

const folders: string[] = [];
function input() {
  const root = mkdtempSync(join(tmpdir(), 'timer-boundary-cli-'));
  folders.push(root);
  const assetPath = join(root, 'asset.glb');
  const body = Buffer.from('glTF synthetic byte-verification fixture');
  writeFileSync(assetPath, body);
  const assetSha256 = createHash('sha256').update(body).digest('hex');
  const out = join(root, 'new-output');
  const args = ['--review', 'characters/thalune:thalune/thalune_suit2', '--asset-file', assetPath, '--asset-sha256', assetSha256, '--out', out];
  return { root, assetPath, assetSha256, out, args, body };
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('timer-boundary diagnostic CLI boundary', () => {
  it('requires exact input bytes and uses a fixed diagnostic scope', () => {
    const f = input();
    const options = timerBoundaryArgs(f.args);
    expect(options).toEqual({
      spec: 'characters/thalune:thalune/thalune_suit2',
      assetPath: resolve(f.assetPath),
      assetSha256: f.assetSha256,
      out: resolve(f.out),
      light: 'noon-lush',
    });
    expect(timerBoundaryAsset(options)).toEqual(f.body);
  });

  it.each([{ args: [] }, { args: ['--review', 'ship'] }, { args: ['--mode', 'measure'] }])('rejects incomplete or budget-run arguments (%j)', ({ args }) => {
    expect(() => timerBoundaryArgs(args)).toThrow();
  });

  it.each(['--light', '--asset-sha256'])('rejects an invalid %s', (flag) => {
    const f = input();
    const args = [...f.args];
    const index = args.indexOf(flag);
    if (index < 0) args.push(flag, 'invalid');
    else args[index + 1] = 'invalid';
    expect(() => timerBoundaryArgs(args)).toThrow();
  });

  it('rejects changed or unhydrated asset bytes before starting any output or browser', async () => {
    const f = input();
    writeFileSync(f.assetPath, 'changed');
    await expect(captureTimerBoundaries(timerBoundaryArgs(f.args))).rejects.toThrow('SHA-256');
    const pointer = Buffer.from('version https://git-lfs.github.com/spec/v1');
    writeFileSync(f.assetPath, pointer);
    expect(() => timerBoundaryAsset({ assetPath: f.assetPath, assetSha256: createHash('sha256').update(pointer).digest('hex') })).toThrow('hydrated GLB');
  });

  it('preserves an existing experiment directory before launching a browser', async () => {
    const f = input();
    mkdirSync(f.out);
    const sentinel = join(f.out, 'original.json');
    writeFileSync(sentinel, 'preserved');
    await expect(captureTimerBoundaries(timerBoundaryArgs(f.args))).rejects.toThrow('EEXIST');
    expect(readFileSync(sentinel, 'utf8')).toBe('preserved');
  });
});
