import { writeFileSync } from 'node:fs';
import { runMigrations } from '../../packages/server/src/db/migrate.ts';
import { startServer } from '../../packages/server/src/server.ts';
await runMigrations(process.env.DATABASE_URL!);
const server = await startServer({
  port: 0,
  host: '127.0.0.1',
  shard: 'bots_t01_soak_20261102',
  config: { LOG_LEVEL: 'warn' },
  tooling: { ASTRA_DEV_LOGIN: false, ASTRA_ADMIN_PORT: 0, ASTRA_METRICS_S: 0 },
  discovery: false,
});
writeFileSync(
  new URL('./server.json', import.meta.url),
  JSON.stringify({ pid: process.pid, url: server.url, startedAt: new Date().toISOString() }, null, 2) + '\n',
);
process.stdout.write(JSON.stringify({ event: 'server.ready', pid: process.pid, url: server.url }) + '\n');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await server.close();
    process.stdout.write(JSON.stringify({ event: 'server.closed', signal, at: new Date().toISOString() }) + '\n');
  });
