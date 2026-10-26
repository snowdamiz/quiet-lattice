// Applies the server's SQL migrations (packages/server/drizzle) to DATABASE_URL.
// The schema and its first migration arrive with the accounts service (P1.E03.T01).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../drizzle', import.meta.url));
if (!existsSync(dir)) {
  console.log('db:migrate: no migrations yet');
  process.exit(0);
}
