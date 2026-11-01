// The game server for a smoke spec that steps time (packages/tools/src/smoke/online.ts, `stepped`): src/index.ts with the
// server clock under the spec's control. It runs on the real monotonic clock until told to `freeze`, then stands still
// until told to `advance`, so what the server sees of time is exactly what the spec steps, whatever the machine's load;
// `thaw` lets it run on with real time from where it stands (never back), for the next spec's setup.
// The control port (STEPPED_CLOCK_PORT) answers `GET /freeze`, `GET /advance?ms=N` and `GET /thaw` with the clock's
// reading, ms.
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { loadDotEnv } from '../src/config.ts';
import { startServer } from '../src/server.ts';

loadDotEnv();

let frozenAt: number | null = null;
let offset = 0;
const monoNow = () => frozenAt ?? performance.now() + offset;

const server = await startServer({ clock: { monoNow } });

const control = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/freeze') frozenAt ??= monoNow();
  else if (url.pathname === '/advance' && frozenAt !== null) frozenAt += Number(url.searchParams.get('ms'));
  else if (url.pathname === '/thaw' && frozenAt !== null) {
    offset = frozenAt - performance.now();
    frozenAt = null;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ frozen: frozenAt !== null, ms: monoNow() }));
});
control.listen(Number(process.env.STEPPED_CLOCK_PORT), '127.0.0.1');

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 10_000).unref();
  control.close();
  await server.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
