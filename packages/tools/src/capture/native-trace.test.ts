import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeTraceError, ownedDescendants, ownedGpuPid, processRows, recordedCommand, withNativeTrace, type CommandRecord } from './native-trace.ts';

const folders: string[] = [];
const jobs: ReturnType<typeof recordedCommand>[] = [];
function fixture(kind = 'normal') {
  const out = mkdtempSync(join(tmpdir(), 'native-trace-cpu-'));
  folders.push(out);
  const helper = join(out, 'cpu-only.mjs');
  writeFileSync(
    helper,
    `
    import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
    const [folder,kind,...args]=process.argv.slice(2);
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    if(args[0]==='-v'){
      writeFileSync(folder+'/watching','ready');
      while(!existsSync(folder+'/notification')) await wait(5);
      console.log(kind==='wrong-notification'?'unrelated-key':args.at(-1));
    }else if(args[0]==='record'){
      if(kind==='early-exit') process.exit(7);
      while(!existsSync(folder+'/watching')) await wait(5);
      if(kind==='no-notification') {setInterval(()=>{},1000); await new Promise(()=>{});}
      writeFileSync(folder+'/notification','posted');
      console.log('CPU synthetic native start');
      await wait(250);
      mkdirSync(args[args.indexOf('--output')+1]);
    }else if(args[0]==='export'){
      if(kind==='export-failed') process.exit(9);
      if(kind==='no-toc') process.exit(0);
      writeFileSync(args[args.indexOf('--output')+1],'<trace-toc synthetic="CPU-only"/>');
    }else process.exit(11);
  `,
  );
  const executable = { file: process.execPath, prefix: [helper, out, kind] };
  return {
    out,
    platform: {
      xctrace: executable,
      notifyutil: executable,
      registrationMs: 0,
      startupMs: kind === 'no-notification' ? 150 : 2000,
      controlMs: 1000,
      finishMs: 2000,
      exportMs: 2000,
    },
  };
}
afterEach(async () => {
  for (const job of jobs.splice(0)) await job.stop();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('owned native trace orchestration (CPU-only child controls)', () => {
  it('waits for a unique start notification, targets only the supplied PID, exports TOC and drains its groups', async () => {
    const f = fixture();
    let called = 0;
    const saved = await withNativeTrace(
      process.pid,
      f.out,
      async () => {
        called++;
        return { frames: 10 };
      },
      f.platform,
    );
    expect(called).toBe(1);
    expect(saved.result.frames).toBe(10);
    expect(saved.evidence.evidence).toBe('uninspected');
    expect(saved.evidence.notifiedAt).not.toBeNull();
    expect(saved.evidence.controlsFinishedAt).not.toBeNull();
    expect(saved.evidence.commands).toHaveLength(3);
    const args = saved.evidence.commands[1].args;
    expect(args).toContain('--attach');
    expect(args[args.indexOf('--attach') + 1]).toBe(String(process.pid));
    expect(args).toContain('15s');
    expect(args).not.toContain('--all-processes');
    expect(args).not.toContain('--no-prompt');
    expect(readFileSync(saved.evidence.toc, 'utf8')).toContain('CPU-only');
    expect(saved.evidence.commands.every((c) => c.finishedAt && c.survivors.length === 0)).toBe(true);
  });

  it.each(['early-exit', 'no-notification', 'wrong-notification'])('never submits frames after an unobserved/failed start (%s)', async (kind) => {
    const f = fixture(kind);
    let called = 0;
    try {
      await withNativeTrace(
        process.pid,
        f.out,
        async () => {
          called++;
        },
        f.platform,
      );
      throw new Error('Expected native startup failure');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeTraceError);
      expect(called).toBe(0);
      const log = (error as NativeTraceError).evidence;
      expect(log.failure).toEqual(expect.any(String));
      expect(log.notifiedAt).toBeNull();
      expect(log.commands.every((c) => c.finishedAt && c.survivors.length === 0)).toBe(true);
    }
  });

  it('keeps an actual frame/output failure separate from a successful notification and interrupts only owned commands', async () => {
    const f = fixture();
    await expect(
      withNativeTrace(
        process.pid,
        f.out,
        async () => {
          throw new Error('scene-output-mismatch');
        },
        f.platform,
      ),
    ).rejects.toMatchObject({
      evidence: { notifiedAt: expect.any(String), controlsFinishedAt: null, failure: expect.stringContaining('scene-output-mismatch') },
    });
  });

  it('retains failed export instead of reporting native-event coverage', async () => {
    const f = fixture('export-failed');
    await expect(withNativeTrace(process.pid, f.out, async () => null, f.platform)).rejects.toMatchObject({
      evidence: { failure: expect.stringContaining('TOC export failed'), evidence: 'uninspected' },
    });
  });

  it('keeps a zero-exit exporter without output inconclusive and failed', async () => {
    const f = fixture('no-toc');
    await expect(withNativeTrace(process.pid, f.out, async () => null, f.platform)).rejects.toMatchObject({
      evidence: { failure: expect.stringContaining('TOC output missing'), evidence: 'uninspected' },
    });
  });

  it('bounds a stalled frame callback and drains the recording before rejecting', async () => {
    const f = fixture();
    f.platform.controlMs = 30;
    await expect(withNativeTrace(process.pid, f.out, () => new Promise(() => {}), f.platform)).rejects.toMatchObject({
      evidence: {
        failure: expect.stringContaining('frame controls exceeded'),
        commands: expect.arrayContaining([
          expect.objectContaining({ signals: expect.arrayContaining([expect.objectContaining({ signal: 'SIGINT' })]), survivors: [] }),
        ]),
      },
    });
  });

  it('drains a child that outlives its command but remains in the owned detached group', async () => {
    const records: CommandRecord[] = [];
    const job = recordedCommand(
      process.execPath,
      [
        '-e',
        `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);c.unref();`,
      ],
      records,
    );
    jobs.push(job);
    await job.done;
    const childPid = Number(records[0].stdout.trim());
    expect(childPid).toBeGreaterThan(1);
    await job.stop();
    expect((await processRows()).some((p) => p.pid === childPid)).toBe(false);
    expect(records[0].signals.length).toBeGreaterThan(0);
  });
});

describe('GPU PID ownership', () => {
  const rows = [
    { pid: 100, ppid: 1, pgid: 100, executable: 'owned browser' },
    { pid: 101, ppid: 100, pgid: 100, executable: 'owned GPU' },
    { pid: 102, ppid: 101, pgid: 100, executable: 'owned child' },
    { pid: 900, ppid: 1, pgid: 900, executable: 'unrelated GPU' },
  ];
  it('requires the exact browser ancestry and omits unrelated executable rows', () => {
    expect(ownedGpuPid([{ id: 101, type: 'GPU' }], rows, 100)).toBe(101);
    expect(ownedDescendants(rows, 100).map((r) => r.pid)).toEqual([100, 101, 102]);
  });
  it.each([
    { processes: [] },
    { processes: [{ id: 900, type: 'GPU' }] },
    {
      processes: [
        { id: 101, type: 'GPU' },
        { id: 900, type: 'GPU' },
      ],
    },
    { processes: [{ id: 100, type: 'GPU' }] },
  ])('rejects missing, ambiguous or unrelated target (%j)', ({ processes }) => {
    expect(() => ownedGpuPid(processes, rows, 100)).toThrow();
  });
});
