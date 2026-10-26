// `pnpm dev:server` entry point: boots the server and shuts it down cleanly on SIGINT/SIGTERM.
import { loadDotEnv } from './config.ts';
import { startServer, type RunningServer } from './server.ts';

const SHUTDOWN_GRACE_MS = 10_000;

loadDotEnv();

let server: RunningServer;
try {
  server = await startServer();
} catch (err) {
  console.error('astra server failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
}

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.app.log.info({ signal }, 'shutting down');
  setTimeout(() => {
    server.app.log.error('shutdown took too long; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    server.app.log.error({ err }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', (s) => void shutdown(s));
process.on('SIGTERM', (s) => void shutdown(s));
