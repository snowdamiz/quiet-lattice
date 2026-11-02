import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recorderObserver, type RecorderObserver } from './native-recorder-observer.ts';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  executable: string;
}

/** ps comm excludes arguments. Only owned descendants are retained by the caller. */
export async function processRows(records: CommandRecord[] = [], signal?: AbortSignal): Promise<ProcessRow[]> {
  const { stdout } = await runOwnedHelper('ps', ['-axo', 'pid,ppid,pgid,comm'], records, { deadlineMs: 1000, signal });
  return stdout
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), executable: match[4] }] : [];
    });
}

export function ownedDescendants(rows: ProcessRow[], root: number): ProcessRow[] {
  const owned = new Set([root]);
  for (let added = true; added;) {
    added = false;
    for (const row of rows)
      if (owned.has(row.ppid) && !owned.has(row.pid)) {
        owned.add(row.pid);
        added = true;
      }
  }
  return rows.filter((r) => owned.has(r.pid));
}

export function ownedGpuPid(processes: { id: number; type: string }[], rows: ProcessRow[], browserPid: number): number {
  const gpu = processes.filter((p) => p.type === 'GPU');
  if (gpu.length !== 1 || !Number.isSafeInteger(gpu[0].id) || gpu[0].id <= 1 || gpu[0].id === browserPid)
    throw new Error('Expected exactly one owned Chromium GPU process');
  const owned = ownedDescendants(rows, browserPid);
  if (!owned.some((p) => p.pid === browserPid) || !owned.some((p) => p.pid === gpu[0].id))
    throw new Error('CDP GPU PID is not a descendant of the owned browser');
  return gpu[0].id;
}

export interface CommandRecord {
  file: string;
  args: string[];
  pid: number | null;
  group: number | null;
  startedAt: string;
  finishedAt: string | null;
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
  truncated: boolean;
  signals: { at: string; signal: NodeJS.Signals }[];
  deadlineMs: number | null;
  failure: string | null;
  groupState: 'not-created' | 'unknown' | 'present' | 'absent';
  groupObservations: { at: string; exists: boolean | null; error: string | null }[];
  cleanupErrors: string[];
}

export async function bounded<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        if (!signal) return;
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    removeAbortListener();
    if (timer) clearTimeout(timer);
  }
}

/** Own detached command group; no shell, global signal or privacy-setting mutation. */
export function recordedCommand(file: string, args: string[], records: CommandRecord[], options: { cwd?: string; recorder?: RecorderObserver } = {}) {
  const child = spawn(file, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: options.cwd });
  const record: CommandRecord = {
    file,
    args,
    pid: child.pid ?? null,
    group: child.pid ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    error: null,
    truncated: false,
    signals: [],
    deadlineMs: null,
    failure: null,
    groupState: child.pid ? 'unknown' : 'not-created',
    groupObservations: [],
    cleanupErrors: [],
  };
  records.push(record);
  for (const key of ['stdout', 'stderr'] as const)
    child[key]?.on('data', (chunk: Buffer) => {
      const text = record[key] + chunk.toString();
      record.truncated ||= text.length > 1024 * 1024;
      record[key] = text.slice(0, 1024 * 1024);
      options.recorder?.output(key, chunk);
    });
  child.on('error', (error) => {
    record.error = String(error);
  });
  if (options.recorder) child.once('exit', (code, signal) => options.recorder?.exited(code, signal));
  const done = new Promise<CommandRecord>((resolve) =>
    child.once('close', (code, signal) => {
      record.finishedAt = new Date().toISOString();
      record.code = code;
      record.signal = signal;
      resolve(record);
    }),
  );
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!record.group) return;
    record.signals.push({ at: new Date().toISOString(), signal });
    try {
      process.kill(-record.group, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const groupExists = () => {
    if (!record.group) return false;
    let exists: boolean | null = true;
    let error: string | null = null;
    try {
      process.kill(-record.group, 0);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') exists = false;
      else {
        exists = null;
        error = String(cause);
      }
    }
    record.groupState = exists === false ? 'absent' : exists === true ? 'present' : 'unknown';
    record.groupObservations.push({ at: new Date().toISOString(), exists, error });
    return exists;
  };
  let stopping: Promise<void> | undefined;
  const stop = async () => {
    if (!record.group) {
      await bounded(done, 2000, 'unstarted command close');
      return;
    }
    // Ownership is already established by detached spawn. Never gate this drain on an external ps.
    for (const [signal, ms] of [
      ['SIGINT', 3000],
      ['SIGTERM', 2000],
      ['SIGKILL', 2000],
    ] as const) {
      if (groupExists() === false && record.finishedAt) return;
      try {
        signalGroup(signal);
      } catch (error) {
        record.cleanupErrors.push(String(error));
      }
      const until = performance.now() + ms;
      do {
        if (groupExists() === false && record.finishedAt) return;
        await wait(20);
      } while (performance.now() < until);
    }
    // Do not leave inherited pipe handles keeping the runner alive after failed cleanup.
    child.stdout?.destroy();
    child.stderr?.destroy();
    try {
      await bounded(done, 2000, 'command close after group drain');
    } catch (error) {
      record.cleanupErrors.push(String(error));
    }
    if (groupExists() !== false || !record.finishedAt) {
      const error = 'Owned helper group/close did not drain; see direct group observations and cleanup errors';
      record.cleanupErrors.push(error);
      throw new Error(error);
    }
  };
  return {
    record,
    done,
    requestInterrupt: () => {
      // A request is separate from stop/drain. Never signal after an observed root exit.
      if (!record.group || record.finishedAt || child.exitCode !== null || child.signalCode !== null) return false;
      signalGroup('SIGINT');
      return true;
    },
    stop: () => (stopping ??= stop()),
  };
}

export class OwnedHelperError extends Error {
  constructor(
    message: string,
    readonly command: CommandRecord,
  ) {
    super(message);
  }
}

/** Every finite observational/provenance helper shares the same wait, raw status and unconditional owned-group drain. */
export async function runOwnedHelper(
  file: string,
  args: string[],
  records: CommandRecord[] = [],
  options: { deadlineMs: number; cwd?: string; signal?: AbortSignal } = { deadlineMs: 5000 },
): Promise<CommandRecord> {
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 60_000) throw new Error('Helper deadline must be 1..60000ms');
  options.signal?.throwIfAborted();
  const job = recordedCommand(file, args, records, { cwd: options.cwd });
  job.record.deadlineMs = options.deadlineMs;
  try {
    const result = await bounded(job.done, options.deadlineMs, `Helper ${file}`, options.signal);
    if (result.code !== 0 || result.error || result.truncated)
      throw new Error(`Helper ${file} failed: code=${result.code}, signal=${result.signal}, error=${result.error}`);
  } catch (error) {
    job.record.failure = String(error);
  } finally {
    try {
      await job.stop();
    } catch (error) {
      job.record.failure = `${job.record.failure ?? ''}; cleanup: ${String(error)}`;
    }
  }
  if (job.record.failure) throw new OwnedHelperError(job.record.failure, job.record);
  return job.record;
}

interface Executable {
  file: string;
  prefix: string[];
}

export interface NativeDiscoveryLog {
  noRecordingInDiscovery: true;
  deadlineMs: number;
  startedAt: string;
  finishedAt: string | null;
  commands: CommandRecord[];
  failure: string | null;
}

export class NativeDiscoveryError extends Error {
  constructor(
    message: string,
    readonly evidence: NativeDiscoveryLog,
  ) {
    super(message);
  }
}

/** One finite helper at a time. Its entire owned group drains before another helper or caller can proceed. */
export async function discoverNativeCli(executable: Executable = { file: 'xcrun', prefix: ['xctrace'] }, deadlineMs = 10_000): Promise<NativeDiscoveryLog> {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10_000) throw new Error('Discovery deadline must be1..10000ms');
  const log: NativeDiscoveryLog = {
    noRecordingInDiscovery: true,
    deadlineMs,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    commands: [],
    failure: null,
  };
  try {
    for (const args of [['version'], ['help', 'record'], ['help', 'export'], ['record', '--template', 'Metal System Trace', '--show-recording-options']]) {
      try {
        await runOwnedHelper(executable.file, [...executable.prefix, ...args], log.commands, { deadlineMs });
      } catch (error) {
        log.failure = String(error);
      }
      if (log.failure) break;
    }
  } catch (error) {
    log.failure = String(error);
  } finally {
    log.finishedAt = new Date().toISOString();
  }
  if (log.failure) throw new NativeDiscoveryError(log.failure, log);
  return log;
}

interface NativePlatform {
  xctrace: Executable;
  notifyutil: Executable;
  registrationMs: number;
  startupMs: number;
  controlMs: number;
  finishMs: number;
  exportMs: number;
}
const PLATFORM: NativePlatform = {
  xctrace: { file: '/usr/bin/xcrun', prefix: ['xctrace'] },
  notifyutil: { file: '/usr/bin/notifyutil', prefix: [] },
  registrationMs: 100,
  startupMs: 15_000,
  controlMs: 10_000,
  finishMs: 25_000,
  exportMs: 60_000,
};

export interface NativeTraceLog {
  diagnosticOnly: true;
  targetPid: number;
  notification: string;
  trace: string;
  toc: string;
  notifiedAt: string | null;
  controlsFinishedAt: string | null;
  controlsSettledAt: string | null;
  controlsCancelledAt: string | null;
  controlFailure: string | null;
  controlCleanupErrors: string[];
  recorderObservation: RecorderObserver['log'];
  recorderFinalization: {
    startedAt: string | null;
    finishedAt: string | null;
    status: 'not-started' | 'waiting' | 'finalized' | 'failed';
    failure: string | null;
  };
  tocExport: { startedAt: string | null; finishedAt: string | null; status: 'not-attempted' | 'waiting' | 'exported' | 'failed'; failure: string | null };
  failure: string | null;
  commands: CommandRecord[];
  evidence: 'uninspected';
}

export class NativeTraceError extends Error {
  constructor(
    message: string,
    readonly evidence: NativeTraceLog,
  ) {
    super(message);
  }
}

/** The callback must honor its signal at launch boundaries. cancelWork interrupts pending provider operations;
 * the callback and its owned helpers must settle before this scope returns, even after recorder loss/timeout.
 * A successful recording/TOC never grants native-event coverage, attribution or a timing verdict. */
export async function withNativeTrace<T>(
  gpuPid: number,
  out: string,
  work: (signal: AbortSignal) => Promise<T>,
  platform: NativePlatform = PLATFORM,
  observe: (log: NativeTraceLog) => void = () => {},
  cancelWork: () => Promise<void> = async () => {},
): Promise<{ result: T; evidence: NativeTraceLog }> {
  if (!Number.isSafeInteger(gpuPid) || gpuPid <= 1) throw new Error('Native trace requires a verified owned GPU PID');
  const observation = recorderObserver(join(out, 'native.trace'));
  const log: NativeTraceLog = {
    diagnosticOnly: true,
    targetPid: gpuPid,
    notification: `dev.astra.t13.${randomUUID()}`,
    trace: join(out, 'native.trace'),
    toc: join(out, 'native-toc.xml'),
    notifiedAt: null,
    controlsFinishedAt: null,
    controlsSettledAt: null,
    controlsCancelledAt: null,
    controlFailure: null,
    controlCleanupErrors: [],
    recorderObservation: observation.log,
    recorderFinalization: { startedAt: null, finishedAt: null, status: 'not-started', failure: null },
    tocExport: { startedAt: null, finishedAt: null, status: 'not-attempted', failure: null },
    failure: null,
    commands: [],
    evidence: 'uninspected',
  };
  const jobs: ReturnType<typeof recordedCommand>[] = [];
  const start = (exe: Executable, args: string[], observation?: RecorderObserver) => {
    const job = recordedCommand(exe.file, [...exe.prefix, ...args], log.commands, { recorder: observation });
    jobs.push(job);
    observe(log);
    return job;
  };
  const finalizeRecorder = async (recorder: ReturnType<typeof recordedCommand>) => {
    // Control work is settled/drained before this point. Request graceful stop now;
    // the unchanged 25s bound measures the following save wait, not continued collection toward the15s cap.
    log.recorderFinalization.startedAt = new Date().toISOString();
    log.recorderFinalization.status = 'waiting';
    try {
      try {
        observation.stopRequested(recorder.requestInterrupt(), null);
      } catch (error) {
        observation.stopRequested(false, String(error));
        throw error;
      }
      const recorded = await bounded(recorder.done, platform.finishMs, 'native recorder finalization');
      if (recorded.code !== 0 || recorded.error || recorded.truncated) throw new Error('Native recording failed; retain its raw status');
      await recorder.stop();
      if (!existsSync(log.trace) || !statSync(log.trace).isDirectory()) throw new Error('Native trace bundle missing');
      log.recorderFinalization.status = 'finalized';
    } catch (error) {
      log.recorderFinalization.status = 'failed';
      log.recorderFinalization.failure = String(error);
      log.failure ??= String(error);
    } finally {
      log.recorderFinalization.finishedAt = new Date().toISOString();
    }
    if (log.recorderFinalization.status === 'finalized') {
      log.tocExport.startedAt = new Date().toISOString();
      log.tocExport.status = 'waiting';
      try {
        const exported = start(platform.xctrace, ['export', '--input', log.trace, '--toc', '--output', log.toc]);
        const status = await bounded(exported.done, platform.exportMs, 'native TOC export');
        if (status.code !== 0 || status.error || status.truncated) throw new Error('Native TOC export failed');
        if (!existsSync(log.toc) || statSync(log.toc).size === 0) throw new Error('Native nonempty TOC output missing');
        log.tocExport.status = 'exported';
      } catch (error) {
        log.tocExport.status = 'failed';
        log.tocExport.failure = String(error);
        log.failure ??= String(error);
      } finally {
        log.tocExport.finishedAt = new Date().toISOString();
      }
    }
  };
  let result: T | undefined;
  const controls = new AbortController();
  let controlTask: Promise<void> | undefined;
  let trace: ReturnType<typeof recordedCommand> | undefined;
  try {
    const notification = start(platform.notifyutil, ['-v', '-1', log.notification]);
    // A missed registration is a failed startup, never permission to submit frames without notification.
    await wait(platform.registrationMs);
    trace = start(
      platform.xctrace,
      [
        'record',
        '--template',
        'Metal System Trace',
        '--attach',
        String(gpuPid),
        '--time-limit',
        '15s',
        '--output',
        log.trace,
        '--notify-tracing-started',
        log.notification,
      ],
      observation,
    );
    observation.start();
    const earlyExit = trace.done.then((r) => {
      throw new Error(`Native recording ended before controls completed: code=${r.code}, signal=${r.signal}, error=${r.error}`);
    });
    await bounded(
      Promise.race([
        notification.done.then((r) => {
          if (r.code !== 0 || r.error || r.truncated || !r.stdout.includes(log.notification)) throw new Error('Native start notification was not observed');
        }),
        earlyExit,
      ]),
      platform.startupMs,
      'native trace startup',
    );
    log.notifiedAt = new Date().toISOString();
    observe(log);
    // Observe both outcomes immediately; retaining this task is ownership, not merely consuming a losing rejection.
    const workResult = Promise.resolve().then(() => {
      controls.signal.throwIfAborted();
      return work(controls.signal);
    });
    controlTask = workResult.then(
      () => {
        log.controlsSettledAt = new Date().toISOString();
      },
      (error) => {
        log.controlFailure = String(error);
        log.controlsSettledAt = new Date().toISOString();
      },
    );
    result = await bounded(Promise.race([workResult, earlyExit]), platform.controlMs, 'native frame controls');
    log.controlsFinishedAt = new Date().toISOString();
    observe(log);
  } catch (error) {
    log.failure = String(error);
  } finally {
    if (controlTask) {
      if (log.failure) {
        log.controlsCancelledAt = new Date().toISOString();
        controls.abort(new Error(`Native controls aborted: ${log.failure}`));
        try {
          await cancelWork();
        } catch (error) {
          log.controlCleanupErrors.push(String(error));
        }
      }
      // This is deliberately not another losing race: no callback may resume after terminal artifacts are written.
      await controlTask;
    }
    if (trace) await finalizeRecorder(trace);
    for (const job of jobs.reverse()) {
      try {
        await job.stop();
      } catch (error) {
        log.failure = `${log.failure ?? ''}; cleanup: ${String(error)}`;
      }
    }
    observation.stop();
    if (observation.log.incomplete) log.failure ??= 'Native recorder observations incomplete; retain limits/errors';
    observe(log);
  }
  if (log.failure) throw new NativeTraceError(log.failure, log);
  return { result: result as T, evidence: log };
}
