import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { smokeArgs } from './targets.ts';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const child = spawn(process.execPath, [cli, ...smokeArgs(process.argv.slice(2))], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
