// drizzle-kit: `pnpm --filter @astra/server db:generate` writes a migration for every change to src/db/schema.ts into
// drizzle/; `pnpm db:migrate` applies them.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://astra:astra@127.0.0.1:55432/astra' },
  strict: true,
});
