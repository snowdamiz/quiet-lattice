import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  executable: string;
}

/** ps comm excludes arguments. Only owned descendants are retained by the caller. */
export async function processRows(): Promise<ProcessRow[]> {
  const { stdout } = await exec('ps', ['-axo', 'pid,ppid,pgid,comm'], { timeout: 5000 });
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
  survivors: ProcessRow[];
}

export async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Own detached command group; no shell, global signal or privacy-setting mutation. */
export function recordedCommand(file: string, args: string[], records: CommandRecord[]) {
  const child = spawn(file, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    survivors: [],
  };
  records.push(record);
  for (const key of ['stdout', 'stderr'] as const)
    child[key]?.on('data', (chunk: Buffer) => {
      const text = record[key] + chunk.toString();
      record.truncated ||= text.length > 1024 * 1024;
      record[key] = text.slice(0, 1024 * 1024);
    });
  child.on('error', (error) => {
    record.error = String(error);
  });
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
  return {
    record,
    done,
    async stop() {
      if (!record.finishedAt) {
        signalGroup('SIGINT');
        try {
          await bounded(done, 3000, 'command interrupt');
        } catch {
          signalGroup('SIGTERM');
          try {
            await bounded(done, 2000, 'command termination');
          } catch {
            signalGroup('SIGKILL');
            await bounded(done, 2000, 'command kill');
          }
        }
      }
      if (record.group) {
        record.survivors = (await processRows()).filter((r) => r.pgid === record.group);
        if (record.survivors.length) {
          signalGroup('SIGTERM');
          await wait(100);
          record.survivors = (await processRows()).filter((r) => r.pgid === record.group);
          if (record.survivors.length) {
            signalGroup('SIGKILL');
            await wait(100);
          }
          record.survivors = (await processRows()).filter((r) => r.pgid === record.group);
          if (record.survivors.length) throw new Error('Owned native command group did not drain');
        }
      }
    },
  };
}

interface Executable {
  file: string;
  prefix: string[];
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

/** A successful recording/TOC never grants native-event coverage, attribution or a timing verdict. */
export async function withNativeTrace<T>(
  gpuPid: number,
  out: string,
  work: () => Promise<T>,
  platform: NativePlatform = PLATFORM,
  observe: (log: NativeTraceLog) => void = () => {},
): Promise<{ result: T; evidence: NativeTraceLog }> {
  if (!Number.isSafeInteger(gpuPid) || gpuPid <= 1) throw new Error('Native trace requires a verified owned GPU PID');
  const log: NativeTraceLog = {
    diagnosticOnly: true,
    targetPid: gpuPid,
    notification: `dev.astra.t13.${randomUUID()}`,
    trace: join(out, 'native.trace'),
    toc: join(out, 'native-toc.xml'),
    notifiedAt: null,
    controlsFinishedAt: null,
    failure: null,
    commands: [],
    evidence: 'uninspected',
  };
  const jobs: ReturnType<typeof recordedCommand>[] = [];
  const start = (exe: Executable, args: string[]) => {
    const job = recordedCommand(exe.file, [...exe.prefix, ...args], log.commands);
    jobs.push(job);
    observe(log);
    return job;
  };
  let result: T | undefined;
  try {
    const notification = start(platform.notifyutil, ['-v', '-1', log.notification]);
    // A missed registration is a failed startup, never permission to submit frames without notification.
    await wait(platform.registrationMs);
    const trace = start(platform.xctrace, [
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
    ]);
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
    result = await bounded(Promise.race([work(), earlyExit]), platform.controlMs, 'native frame controls');
    log.controlsFinishedAt = new Date().toISOString();
    observe(log);
    const recorded = await bounded(trace.done, platform.finishMs, 'native trace finish');
    if (recorded.code !== 0 || recorded.error || recorded.truncated) throw new Error('Native recording failed; retain its raw status');
    await trace.stop();
    const exported = start(platform.xctrace, ['export', '--input', log.trace, '--toc', '--output', log.toc]);
    const exportedStatus = await bounded(exported.done, platform.exportMs, 'native TOC export');
    if (exportedStatus.code !== 0 || exportedStatus.error || exportedStatus.truncated) throw new Error('Native TOC export failed');
    if (!existsSync(log.trace) || !statSync(log.trace).isDirectory() || !existsSync(log.toc) || statSync(log.toc).size === 0)
      throw new Error('Native trace bundle or nonempty TOC output missing');
  } catch (error) {
    log.failure = String(error);
  } finally {
    for (const job of jobs.reverse()) {
      try {
        await job.stop();
      } catch (error) {
        log.failure = `${log.failure ?? ''}; cleanup: ${String(error)}`;
      }
    }
    observe(log);
  }
  if (log.failure) throw new NativeTraceError(log.failure, log);
  return { result: result as T, evidence: log };
}
