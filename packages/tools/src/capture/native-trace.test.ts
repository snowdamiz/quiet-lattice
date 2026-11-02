import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverNativeCli,
  NativeDiscoveryError,
  NativeTraceError,
  ownedDescendants,
  ownedGpuPid,
  processRows,
  recordedCommand,
  runOwnedHelper,
  withNativeTrace,
  type CommandRecord,
  type NativeTraceLog,
} from './native-trace.ts';

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
      if(kind==='slow-finalization')process.on('SIGINT',()=>console.log('Stopping recording...'));
      if(kind==='hung-finalization'){setInterval(()=>{},1000);await new Promise(()=>{});}
      await wait(kind==='slow-finalization'?3600:250);
      mkdirSync(args[args.indexOf('--output')+1]);
      console.log('CPU trace finalized');
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
    expect(saved.evidence.commands.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
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
      expect(log.commands.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
    }
  });

  it('keeps an actual frame/output failure separate from a successful notification and finalizes only owned commands', async () => {
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

  it('lets a slow recorder finalize and exports retained TOC even when controls failed', async () => {
    const f = fixture('slow-finalization');
    f.platform.finishMs = 6000;
    let evidence: NativeTraceLog | undefined;
    try {
      await withNativeTrace(
        process.pid,
        f.out,
        async () => {
          throw new Error('stationary-output-failed');
        },
        f.platform,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(NativeTraceError);
      evidence = (error as NativeTraceError).evidence;
    }
    if (process.env.NATIVE_FINALIZATION_EVIDENCE)
      appendFileSync(
        process.env.NATIVE_FINALIZATION_EVIDENCE,
        JSON.stringify({
          scope: 'CPU synthetic recorder,real production trace/helper lifecycle; no browser/GPU/native recording',
          evidence,
          traceExists: existsSync(f.out + '/native.trace'),
          tocExists: existsSync(f.out + '/native-toc.xml'),
        }) + '\n',
      );
    expect(evidence).toMatchObject({
      failure: expect.stringContaining('stationary-output-failed'),
      controlsFinishedAt: null,
      recorderFinalization: { status: 'finalized', failure: null },
      tocExport: { status: 'exported', failure: null },
    });
    expect(evidence?.commands[1]).toMatchObject({ code: 0, signals: [], groupState: 'absent' });
    expect(readFileSync(f.out + '/native-toc.xml', 'utf8')).toContain('CPU-only');
    expect(evidence?.commands.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
  });

  it('bounds recorder finalization and retains the primary control error before terminal escalation', async () => {
    const f = fixture('hung-finalization');
    f.platform.finishMs = 50;
    let failure: NativeTraceLog | undefined;
    try {
      await withNativeTrace(
        process.pid,
        f.out,
        async () => {
          throw new Error('primary-control-failed');
        },
        f.platform,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(NativeTraceError);
      failure = (error as NativeTraceError).evidence;
    }
    expect(failure).toMatchObject({
      failure: expect.stringContaining('primary-control-failed'),
      recorderFinalization: { status: 'failed', failure: expect.stringContaining('finalization exceeded 50') },
      tocExport: { status: 'not-attempted' },
    });
    expect(failure?.commands.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
    const rows = await processRows();
    expect(rows.filter((row) => failure?.commands.some((c) => c.pid === row.pid || c.group === row.pgid))).toEqual([]);
  });

  it.each(['export-failed', 'no-toc'])('retains primary failed controls separately from finalized-trace export failure (%s)', async (kind) => {
    const f = fixture(kind);
    await expect(
      withNativeTrace(
        process.pid,
        f.out,
        async () => {
          throw new Error('primary-control-failed');
        },
        f.platform,
      ),
    ).rejects.toMatchObject({
      evidence: {
        failure: expect.stringContaining('primary-control-failed'),
        recorderFinalization: { status: 'finalized' },
        tocExport: { status: 'failed', failure: expect.stringContaining('TOC') },
      },
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
    await expect(
      withNativeTrace(
        process.pid,
        f.out,
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
        f.platform,
      ),
    ).rejects.toMatchObject({
      evidence: {
        failure: expect.stringContaining('frame controls exceeded'),
        recorderFinalization: { status: 'finalized' },
        tocExport: { status: 'exported' },
        commands: expect.arrayContaining([expect.objectContaining({ code: 0, signals: [], groupState: 'absent' })]),
      },
    });
  });

  it('keeps the primary timeout, losing callback failure and cancellation cleanup failure separately', async () => {
    const f = fixture();
    f.platform.controlMs = 30;
    await expect(
      withNativeTrace(
        process.pid,
        f.out,
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('callback-cancelled')), { once: true });
          }),
        f.platform,
        () => {},
        async () => {
          throw new Error('provider-close-failed');
        },
      ),
    ).rejects.toMatchObject({
      evidence: {
        failure: expect.stringContaining('frame controls exceeded'),
        controlFailure: expect.stringContaining('callback-cancelled'),
        controlCleanupErrors: [expect.stringContaining('provider-close-failed')],
        controlsCancelledAt: expect.any(String),
        controlsSettledAt: expect.any(String),
      },
    });
  });

  it('does not launch any helper after cancellation was already observed', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already-aborted'));
    const records: CommandRecord[] = [];
    await expect(
      runOwnedHelper(process.execPath, ['-e', 'throw Error("must not run")'], records, { deadlineMs: 1000, signal: controller.signal }),
    ).rejects.toThrow('already-aborted');
    expect(records).toEqual([]);
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

describe('finite read-only CLI discovery', () => {
  function discoveryFixture(kind: string) {
    const out = mkdtempSync(join(tmpdir(), 'native-discovery-cpu-'));
    folders.push(out);
    const helper = join(out, 'discovery.mjs');
    writeFileSync(
      helper,
      `
      import {spawn} from 'node:child_process';
      import {appendFileSync,existsSync,readFileSync} from 'node:fs';
      const [out,kind,...args]=process.argv.slice(2);
      if(existsSync(out+'/descendant')) {
        const pid=Number(readFileSync(out+'/descendant','utf8'));
        try {process.kill(pid,0);process.exit(73);} catch(e){if(e.code!=='ESRCH')throw e;}
      }
      appendFileSync(out+'/calls',JSON.stringify({pid:process.pid,args})+'\\n');
      if(args[0]==='version' && ['hung-descendant','exited-descendant','failed-descendant'].includes(kind)) {
        const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.unref();
        appendFileSync(out+'/descendant',String(c.pid));console.log(JSON.stringify({descendant:c.pid}));
        if(kind==='hung-descendant')setInterval(()=>{},1000);
        else process.exit(kind==='failed-descendant'?7:0);
      } else if(kind==='version-failed'&&args[0]==='version' || kind==='later-failed'&&args.join(' ')==='help export')process.exit(7);
      else console.log('CPU-only discovery '+args.join(' '));
    `,
    );
    return { out, executable: { file: process.execPath, prefix: [helper, out, kind] } };
  }

  async function assertDrained(commands: CommandRecord[]) {
    const rows = await processRows();
    expect(commands.every((c) => c.finishedAt && c.groupState === 'absent')).toBe(true);
    expect(rows.filter((row) => commands.some((c) => c.pid === row.pid || c.group === row.pgid))).toEqual([]);
  }

  it('runs all four fixed commands sequentially and drains each successful helper group', async () => {
    const f = discoveryFixture('normal');
    const result = await discoverNativeCli(f.executable, 1000);
    expect(result.commands.map((c) => c.args.slice(f.executable.prefix.length))).toEqual([
      ['version'],
      ['help', 'record'],
      ['help', 'export'],
      ['record', '--template', 'Metal System Trace', '--show-recording-options'],
    ]);
    expect(result.failure).toBeNull();
    await assertDrained(result.commands);
  });

  it.each(['version-failed', 'later-failed', 'failed-descendant'])(
    'never starts a later command after failure and drains every started group (%s)',
    async (kind) => {
      const f = discoveryFixture(kind);
      let error: unknown;
      try {
        await discoverNativeCli(f.executable, 1000);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(NativeDiscoveryError);
      const evidence = (error as NativeDiscoveryError).evidence;
      expect(evidence.commands).toHaveLength(kind === 'later-failed' ? 3 : 1);
      expect(evidence.commands.at(-1)?.code).toBe(7);
      await assertDrained(evidence.commands);
    },
  );

  it('times out a hung helper and its real descendant before rejecting', async () => {
    const f = discoveryFixture('hung-descendant');
    const start = Date.now();
    let error: unknown;
    try {
      await discoverNativeCli(f.executable, 1000);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NativeDiscoveryError);
    const evidence = (error as NativeDiscoveryError).evidence;
    expect(evidence.failure).toContain('exceeded 1000ms');
    expect(evidence.commands).toHaveLength(1);
    expect(evidence.commands[0].stdout).toContain('descendant');
    expect(evidence.commands[0].signals.length).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(10_000);
    await assertDrained(evidence.commands);
  });

  it('drains a descendant left by a zero-exit helper before the next helper can start', async () => {
    const f = discoveryFixture('exited-descendant');
    const result = await discoverNativeCli(f.executable, 1000);
    expect(result.commands).toHaveLength(4);
    expect(result.commands[0].signals.length).toBeGreaterThan(0);
    expect(result.commands.every((c) => c.code === 0)).toBe(true);
    await assertDrained(result.commands);
  });
});
