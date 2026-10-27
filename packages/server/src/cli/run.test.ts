// The CLI without a server: help, usage errors and their exit codes, and what it says when it has nothing to talk to.
// (test/admin.int.test.ts runs it against a real server and database.)
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { EXIT, runCli } from './run.ts';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('the developer CLI', () => {
  it('prints its usage on --help, and on no command as an error', async () => {
    const a = io();
    expect(await runCli(['--', '--help'], {}, a.io)).toBe(EXIT.ok);
    expect(a.out.join('\n')).toMatch(/^Usage: pnpm --filter @astra\/server cli/);
    const b = io();
    expect(await runCli([], {}, b.io)).toBe(EXIT.usage);
    expect(b.err.join('\n')).toMatch(/^Usage/);
  });

  it('refuses bad usage before it sends anything', async () => {
    const a = io();
    expect(await runCli(['grant', 'ves', 'ferrite'], {}, a.io)).toBe(EXIT.usage);
    expect(a.err[0]).toBe('error: missing <n>\n(run with --help for usage)');
    const b = io();
    expect(await runCli(['--loud', 'who'], {}, b.io)).toBe(EXIT.usage);
    expect(b.err[0]).toMatch(/^error: unknown option --loud/);
    const c = io();
    expect(await runCli(['who', '--url'], {}, c.io)).toBe(EXIT.usage);
  });

  it('takes a negative count as an argument, not an option', async () => {
    const a = io();
    // no secret: it gets as far as sending
    expect(await runCli(['grant', 'ves', 'units', '-5'], {}, a.io)).toBe(EXIT.unreachable);
    expect(a.err[0]).toMatch(/ASTRA_ADMIN_SECRET is not set/);
  });

  it('refuses direct mode in production without the opt-in', async () => {
    const a = io();
    const production = { NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(40) };
    expect(await runCli(['--direct', 'grant', 'ves', 'ferrite', '1'], production, a.io)).toBe(EXIT.refused);
    expect(a.err[0]).toBe('error (refused): direct mode is refused in production unless ASTRA_ADMIN_IN_PRODUCTION=1');
  });

  it('says there is no admin channel when nothing answers, and points at --direct', async () => {
    const port = await closedPort();
    const a = io();
    expect(await runCli(['who'], { ASTRA_ADMIN_SECRET: 'x'.repeat(16), ASTRA_ADMIN_PORT: String(port) }, a.io)).toBe(EXIT.unreachable);
    expect(a.err[0]).toMatch(new RegExp(`no admin channel at http://127.0.0.1:${port}.*--direct`));
  });
});
