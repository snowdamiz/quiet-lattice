import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { runOwnedHelper, type CommandRecord } from './native-trace.ts';
it('actual installed tsx page functions preserve reference/reuse/cancel calls in an isolated realm', async () => {
  const commands: CommandRecord[] = [],
    root = fileURLToPath(new URL('../../../../', import.meta.url));
  const source = `
    import { cloudMarchPageCall, cancelCloudMarchPage } from './packages/tools/src/capture/cloud-march-page.ts';
    import vm from 'node:vm';
    const calls=[]; const context={performance:{mark:name=>({name,startTime:calls.length})}, window:{review:{cloudMarchProbe:async(...args)=>{calls.push(args);return{CPU_ONLY:true};}}}};
    const call=vm.runInNewContext('('+cloudMarchPageCall.toString()+')',context), cancel=vm.runInNewContext('('+cancelCloudMarchPage.toString()+')',context);
    const reference=await call({action:'run',mode:'reference',id:'reference'}), reuse=await call({action:'run',mode:'reuse',id:'reuse'}); await cancel();
    process.stdout.write(JSON.stringify({calls,reference,reuse,actualBrowserOrGPU:false}));
  `;
  try {
    const result = await runOwnedHelper(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], commands, { cwd: root, deadlineMs: 5000 });
    expect(result.code).toBe(0);
    expect(result.groupState).toBe('absent');
    expect(JSON.parse(result.stdout)).toMatchObject({
      calls: [['run', 'reference'], ['run', 'reuse'], ['cancel']],
      reference: { failure: null },
      reuse: { failure: null },
      actualBrowserOrGPU: false,
    });
  } finally {
    if (process.env.CLOUD_MARCH_SERIALIZATION_RECEIPTS)
      writeFileSync(process.env.CLOUD_MARCH_SERIALIZATION_RECEIPTS, JSON.stringify({ commands }, null, 2) + '\n', { flag: 'wx' });
  }
});
