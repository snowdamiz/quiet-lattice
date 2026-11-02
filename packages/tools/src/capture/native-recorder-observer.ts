import { lstatSync, opendirSync } from 'node:fs';
import { join } from 'node:path';

const stamp = () => ({ at: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() });
export const RECORDER_OBSERVATION_LIMITS = Object.freeze({
  intervalMs: 1000,
  samples: 64,
  entries: 128,
  depth: 3,
  errors: 8,
  outputEvents: 256,
  outputCharacters: 65536,
});
interface TraceSample {
  at: string;
  monotonicNs: string;
  status: 'missing' | 'observed' | 'failed';
  entries: number;
  files: { path: string; bytes: number; mtimeMs: number }[];
  skippedSymlinks: number;
  limits: { entries: boolean; depth: boolean; errors: boolean };
  errors: string[];
}
interface RecorderObservationLog {
  startedAt: string | null;
  stoppedAt: string | null;
  requestedStop: (ReturnType<typeof stamp> & { requested: boolean; error: string | null }) | null;
  exit: (ReturnType<typeof stamp> & { code: number | null; signal: string | null }) | null;
  output: (ReturnType<typeof stamp> & { stream: 'stdout' | 'stderr'; text: string })[];
  samples: TraceSample[];
  droppedSamples: number;
  droppedOutputEvents: number;
  droppedOutputCharacters: number;
  incomplete: boolean;
  limits: typeof RECORDER_OBSERVATION_LIMITS;
  interpretation: string;
}

/** Only the owned recorder's receipt/file observations. No trace decoding, subprocesses or progress verdict. */
export function recorderObserver(trace: string) {
  const limits = RECORDER_OBSERVATION_LIMITS;
  const log: RecorderObservationLog = {
    startedAt: null,
    stoppedAt: null,
    requestedStop: null,
    exit: null,
    output: [],
    samples: [],
    droppedSamples: 0,
    droppedOutputEvents: 0,
    droppedOutputCharacters: 0,
    incomplete: false,
    limits,
    interpretation: 'Receipt timestamps are host observations, not native event/emission time. Size/mtime/CPU alone prove neither useful progress nor hang.',
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let characters = 0;
  const sample = () => {
    if (!log.startedAt || log.stoppedAt) return;
    if (log.samples.length >= limits.samples) {
      log.droppedSamples++;
      log.incomplete = true;
      return;
    }
    const row: TraceSample = {
      ...stamp(),
      status: 'observed',
      entries: 0,
      files: [],
      skippedSymlinks: 0,
      limits: { entries: false, depth: false, errors: false },
      errors: [],
    };
    log.samples.push(row);
    const error = (cause: unknown) => {
      log.incomplete = true;
      if (row.errors.length < limits.errors) row.errors.push(String(cause).slice(0, 512));
      else row.limits.errors = true;
    };
    const visit = (path: string, relative: string, depth: number) => {
      const dir = opendirSync(path);
      try {
        while (row.entries < limits.entries) {
          const entry = dir.readSync();
          if (!entry) return;
          row.entries++;
          const name = relative ? relative + '/' + entry.name : entry.name;
          if (entry.isSymbolicLink()) {
            row.skippedSymlinks++;
            continue;
          }
          try {
            if (entry.isDirectory()) {
              if (depth >= limits.depth) {
                row.limits.depth = true;
                log.incomplete = true;
              } else visit(join(path, entry.name), name, depth + 1);
            } else if (entry.isFile()) {
              const info = lstatSync(join(path, entry.name));
              row.files.push({ path: name, bytes: info.size, mtimeMs: info.mtimeMs });
            }
          } catch (cause) {
            error(cause);
          }
        }
        row.limits.entries = true;
        log.incomplete = true;
      } finally {
        dir.closeSync();
      }
    };
    try {
      const root = lstatSync(trace);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Owned trace observation root is not a real directory');
      visit(trace, '', 0);
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') row.status = 'missing';
      else {
        row.status = 'failed';
        error(cause);
      }
    }
  };
  return {
    log,
    start() {
      if (log.startedAt || log.stoppedAt) return;
      log.startedAt = new Date().toISOString();
      sample();
      timer = setInterval(sample, limits.intervalMs);
    },
    sample,
    output(stream: 'stdout' | 'stderr', chunk: Buffer) {
      if (log.stoppedAt) return;
      const text = chunk.toString();
      if (log.output.length >= limits.outputEvents) {
        log.droppedOutputEvents++;
        log.droppedOutputCharacters += text.length;
        log.incomplete = true;
        return;
      }
      const kept = text.slice(0, Math.max(0, limits.outputCharacters - characters));
      characters += kept.length;
      log.droppedOutputCharacters += text.length - kept.length;
      if (kept) log.output.push({ ...stamp(), stream, text: kept });
      else if (text.length) log.droppedOutputEvents++;
      if (kept.length !== text.length) log.incomplete = true;
    },
    stopRequested(requested: boolean, error: string | null) {
      if (!log.stoppedAt) log.requestedStop = { ...stamp(), requested, error };
    },
    exited(code: number | null, signal: string | null) {
      if (log.stoppedAt) return;
      log.exit = { ...stamp(), code, signal };
      if (timer) clearInterval(timer);
      sample();
    },
    stop() {
      if (log.stoppedAt) return;
      if (timer) clearInterval(timer);
      // Samples are synchronous and bounded; no losing Promise/collector can write after this returns.
      sample();
      log.stoppedAt = new Date().toISOString();
    },
  };
}
export type RecorderObserver = ReturnType<typeof recorderObserver>;
