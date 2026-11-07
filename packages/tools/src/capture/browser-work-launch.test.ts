import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { runOwnedHelper, type CommandRecord } from './native-trace.ts';

it('retains real public child facts atomically, refuses overwrite/storage failure and bounds oversized actual argv', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const commands: CommandRecord[] = [];
  const source = `
    import { retainBrowserLaunch } from './packages/tools/src/capture/browser-work-probe.ts';
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'t13-public-child-'));
    const prefix='bwt-'+'e'.repeat(32), results=[];
    async function control(name,args){
      const dir=path.join(out,name);fs.mkdirSync(dir);
      const child=spawn('/usr/bin/true',args,{stdio:'ignore'}), closed=once(child,'close');
      try {
        let error;
        if(name==='refused')fs.chmodSync(dir,0o500);
        try {retainBrowserLaunch(dir,prefix,child);}catch(e){error=String(e);}
        if(name==='valid'){
          const bytes=fs.readFileSync(path.join(dir,'browser-launch.json'));
          const value=JSON.parse(bytes);assert.equal(value.pid,child.pid);assert.equal(value.spawnfile,child.spawnfile);assert.deepEqual(value.spawnargs,child.spawnargs);
          assert.equal(value.provenance,'BrowserServer.process() ChildProcess');assert.equal(value.prefix,prefix);
          assert(!fs.existsSync(path.join(dir,'browser-launch.json.writing')));
          assert.throws(()=>retainBrowserLaunch(dir,prefix,child),/EEXIST/);
          assert(fs.readFileSync(path.join(dir,'browser-launch.json')).equals(bytes));
        }else if(name==='refused'){assert(error.includes('EACCES'));assert(!fs.existsSync(path.join(dir,'browser-launch.json')));}
        else{assert(error.includes('overflow'));assert(!fs.existsSync(path.join(dir,'browser-launch.json')));assert.equal(fs.statSync(path.join(dir,'browser-launch.json.prefix')).size,65536);}
        const [code]=await closed;assert.equal(code,0);results.push({name,childPid:child.pid,code,expectedError:error??null});
      }finally{fs.chmodSync(dir,0o700);}
    }
    try {await control('valid',['argument with spaces']);await control('refused',[]);await control('overflow',['x'.repeat(70000)]);}
    finally{fs.rmSync(out,{recursive:true,force:true});}
    process.stdout.write(JSON.stringify({actualBrowserOrGPU:false,results}));
  `;
  try {
    const command = await runOwnedHelper(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], commands, { cwd: root, deadlineMs: 5000 });
    expect(JSON.parse(command.stdout)).toMatchObject({
      actualBrowserOrGPU: false,
      results: [
        { name: 'valid', code: 0 },
        { name: 'refused', code: 0 },
        { name: 'overflow', code: 0 },
      ],
    });
    expect(command.groupState).toBe('absent');
    expect(command.code).toBe(0);
  } finally {
    const output = process.env.T13_BROWSER_LAUNCH_CPU_RECEIPTS;
    if (output) writeFileSync(output, JSON.stringify({ commands, actualBrowserOrGPU: false }, null, 2) + '\n', { flag: 'wx' });
  }
});
