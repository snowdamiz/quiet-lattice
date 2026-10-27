// `pnpm --filter @astra/server cli -- <command>`: the developer CLI's entry point (run.ts does the work). Reads the
// repository's .env first, as the server does, so both see the same ASTRA_ADMIN_SECRET and DATABASE_URL.
import { loadDotEnv } from '../config.ts';
import { runCli } from './run.ts';

loadDotEnv();
try {
  process.exitCode = await runCli(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
} catch (err) {
  console.error('astra cli failed:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
}
