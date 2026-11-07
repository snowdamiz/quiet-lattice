import { fileURLToPath } from 'node:url';
import { bounded, OwnedHelperError, recordedCommand, type CommandRecord } from './native-trace.ts';

/** Startup and HTTP-server lifetime live inside an owned group, including the unchanged startVite's pending work. */
export async function startOwnedVite(root: string, records: CommandRecord[], options: { startupMs?: number; command?: { file: string; args: string[] } } = {}) {
  const deadline = options.startupMs ?? 30_000;
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 30_000) throw new Error('Vite startup deadline must be 1..30000ms');
  const command = options.command ?? {
    file: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('./native-vite-child.ts', import.meta.url)), root],
  };
  const job = recordedCommand(command.file, command.args, records, { cwd: root });
  job.record.deadlineMs = deadline;
  let cancelled = false;
  const ready = (async () => {
    while (!cancelled && !job.record.finishedAt) {
      if (job.record.truncated) throw new Error('Owned Vite startup output exceeded its retained bound');
      const match = /^NATIVE_VITE_READY (\S+)$/m.exec(job.record.stdout);
      if (match) {
        const url = new URL(match[1]);
        if (
          url.protocol !== 'http:' ||
          url.hostname !== '127.0.0.1' ||
          !url.port ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        )
          throw new Error('Owned Vite reported an unexpected ready URL');
        return url.origin;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Owned Vite exited before ready: code=${job.record.code}, signal=${job.record.signal}, error=${job.record.error}`);
  })();
  try {
    const url = await bounded(ready, deadline, 'owned Vite startup');
    return { url, stop: job.stop };
  } catch (error) {
    cancelled = true;
    job.record.failure = String(error);
    try {
      await job.stop();
    } catch (cleanup) {
      job.record.failure += `; cleanup: ${String(cleanup)}`;
    }
    throw new OwnedHelperError(job.record.failure, job.record);
  }
}
