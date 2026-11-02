import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BotClient, registerBot } from './client.ts';
import { patrol } from './scripts.ts';

export function parseBotOptions(args: string[]): { count: number; durationMs: number; url: string; system?: number; help: boolean } {
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: {
      count: { type: 'string', default: '10' },
      duration: { type: 'string', default: '600' },
      url: { type: 'string', default: process.env.ASTRA_BOT_URL ?? 'http://127.0.0.1:8787' },
      system: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const count = Number(values.count);
  const duration = Number(values.duration);
  const system = values.system === undefined ? undefined : Number(values.system);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('--count must be an integer from 1 to 1000');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('--duration must be seconds in (0, 86400]');
  if (system !== undefined && (!Number.isSafeInteger(system) || system < 0 || system > 1023)) throw new Error('--system must be an integer from 0 to 1023');
  const url = new URL(values.url ?? '');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('--url must be an HTTP(S) server URL');
  return { count, durationMs: duration * 1000, url: url.origin, system, help: values.help };
}

export async function runBots(options: ReturnType<typeof parseBotOptions>): Promise<void> {
  const bots: BotClient[] = [];
  const startedAt = new Date().toISOString();
  let stopped = false;
  const log = (event: string, fields: object) => process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
  const interrupted = () => {
    stopped = true;
    for (const bot of bots) void bot.close();
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    log('bots.start', { count: options.count, durationMs: options.durationMs, url: options.url, startedAt });
    for (let i = 0; i < options.count; i++) {
      if (stopped) throw new Error('bot run interrupted');
      const account = await registerBot(options.url);
      if (stopped) throw new Error('bot run interrupted');
      const bot = await BotClient.connect({ url: options.url, ...account });
      bots.push(bot);
      if (stopped) throw new Error('bot run interrupted');
    }
    log('bots.joined', { count: bots.length });
    await Promise.all(bots.map((bot) => patrol(bot, options.durationMs, options.system)));
    for (const bot of bots) bot.assertHealthy();
    log('bots.passed', {
      startedAt,
      count: bots.length,
      durationMs: options.durationMs,
      clients: bots.map((bot) => ({ characterId: bot.welcome.character.id, zone: bot.zone, ...bot.stats })),
    });
  } finally {
    await Promise.all(bots.map((bot) => bot.close()));
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    log('bots.closed', { count: bots.length });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseBotOptions(process.argv.slice(2));
    if (options.help)
      process.stdout.write(
        'pnpm bots -- --count 10 [--duration 600] [--url http://127.0.0.1:8787] [--system 0]\nRequires a running server. Creates ordinary accounts; no admin access or inventory grants.\n',
      );
    else await runBots(options);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: 'bots.failed', message: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
