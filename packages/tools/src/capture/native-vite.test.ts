import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startOwnedVite } from './native-vite.ts';
import { processRows, type CommandRecord } from './native-trace.ts';

const dirs: string[] = [];
const servers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(kind: string) {
  const root = mkdtempSync(join(tmpdir(), 'native-server-cpu-'));
  dirs.push(root);
  const script = join(root, 'server.mjs');
  writeFileSync(
    script,
    `
    import {createServer} from 'node:http';import {spawn} from 'node:child_process';
    if(${JSON.stringify(kind)}==='fail')process.exit(7);
    const server=createServer((req,res)=>res.end('CPU-only server control'));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log('CHILD '+c.pid);
    if(${JSON.stringify(kind)}!=='hang')console.log('NATIVE_VITE_READY http://127.0.0.1:'+server.address().port);
  `,
  );
  return { root, command: { file: process.execPath, args: [script] } };
}
describe('owned CPU server acquisition and teardown', () => {
  it('retains a bounded startup failure without a live group', async () => {
    const f = fixture('fail');
    const records: CommandRecord[] = [];
    await expect(startOwnedVite(f.root, records, { command: f.command, startupMs: 1000 })).rejects.toThrow('exited before ready');
    expect(records[0]).toMatchObject({ code: 7, groupState: 'absent', failure: expect.any(String) });
  });

  it('bounds a pending server/descendant startup and consumes its late rejection during cleanup', async () => {
    const f = fixture('hang');
    const records: CommandRecord[] = [];
    await expect(startOwnedVite(f.root, records, { command: f.command, startupMs: 1000 })).rejects.toThrow('exceeded');
    expect(records[0].stdout).toContain('CHILD');
    expect(records[0].groupState).toBe('absent');
    const rows = await processRows();
    expect(rows.filter((r) => r.pgid === records[0].group)).toEqual([]);
    await new Promise((r) => setTimeout(r, 30));
  });

  it('serves real HTTP on CPU and stops its server plus real descendant through the same group primitive', async () => {
    const f = fixture('normal');
    const records: CommandRecord[] = [];
    const server = await startOwnedVite(f.root, records, { command: f.command, startupMs: 1000 });
    servers.push(server);
    expect(await (await fetch(server.url)).text()).toBe('CPU-only server control');
    await server.stop();
    expect(records[0].groupState).toBe('absent');
    expect((await processRows()).filter((r) => r.pgid === records[0].group)).toEqual([]);
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it('runs the thin unchanged Vite startup wrapper on CPU and closes its owned group', async () => {
    const records: CommandRecord[] = [];
    const server = await startOwnedVite(process.cwd(), records, { startupMs: 5000 });
    servers.push(server);
    expect((await fetch(server.url)).status).toBe(200);
    await server.stop();
    expect(records[0].groupState).toBe('absent');
  }, 10_000);
});
