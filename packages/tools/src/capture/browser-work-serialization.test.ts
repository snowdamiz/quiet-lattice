import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { runOwnedHelper, type CommandRecord } from './native-trace.ts';

it('the installed tsx output executes in an isolated page-like realm without compiler helpers', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const commands: CommandRecord[] = [];
  const source = `
    import { browserProbePageCall } from './packages/tools/src/capture/browser-work-probe.ts';
    import vm from 'node:vm';
    const calls = [];
    const pageFunction = vm.runInNewContext('(' + browserProbePageCall.toString() + ')', {
      performance: { mark: (name) => ({ name, startTime: calls.length }) },
      window: { review: { nativeWorkClassProbe: async (...args) => { calls.push(args); return { actual: 'CPU fake Review' }; } } }
    });
    const result = await pageFunction({ action: 'run', workClass: 'frame-only', id: 'real-transpilation' });
    process.stdout.write(JSON.stringify({ calls, result, actualBrowserOrGPU: false }));
  `;
  try {
    const command = await runOwnedHelper(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], commands, { cwd: root, deadlineMs: 5000 });
    expect(JSON.parse(command.stdout)).toMatchObject({
      calls: [['run', 'frame-only']],
      result: { failure: null, markers: [{ name: 'real-transpilation-start' }, { name: 'real-transpilation-end' }] },
      actualBrowserOrGPU: false,
    });
    expect(command.code).toBe(0);
    expect(command.finishedAt).not.toBeNull();
    expect(command.groupState).toBe('absent');
  } finally {
    const output = process.env.T13_BROWSER_CPU_RECEIPTS;
    if (output) writeFileSync(output, JSON.stringify({ commands, actualBrowserOrGPU: false }, null, 2) + '\n', { flag: 'wx' });
  }
});
