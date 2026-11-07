import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import cp from 'node:child_process';
const root = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
function writable(value) {
  if (typeof value === 'number') { if (value === 1 || value === 2) return; throw new Error('READ_ONLY_BOUNDARY: untracked fd'); }
  const p = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  let parent = p;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const real = path.join(fs.realpathSync(parent), path.relative(parent,p));
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('READ_ONLY_BOUNDARY: write outside exclusive scratch');
}
for (const name of ['writeFile','appendFile','unlink','mkdir','rmdir','rm','truncate','chmod','chown','utimes','createWriteStream']) {
  for (const [object,key] of [[fs,name],[fs,name+'Sync'],[fsp,name]]) if (typeof object[key] === 'function') {
    const original=object[key];object[key]=function(p,...args){writable(p);return original.call(this,p,...args);};
  }
}
for(const name of ['rename','link','symlink','copyFile']) for(const [object,key] of [[fs,name],[fs,name+'Sync'],[fsp,name]]) if(typeof object[key]==='function') {
  const original=object[key];object[key]=function(a,b,...args){writable(a);writable(b);return original.call(this,a,b,...args);};
}
for(const [object,key] of [[fs,'open'],[fs,'openSync'],[fsp,'open']]) {
  const original=object[key];object[key]=function(p,flags,...args){
    if(typeof flags==='number' ? flags !== fs.constants.O_RDONLY : /[wa+]/.test(flags)) writable(p);
    return original.call(this,p,flags,...args);
  };
}
const denied=()=>{throw new Error('READ_ONLY_BOUNDARY: process/network/service denied');};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[name]=denied;
net.Socket.prototype.connect=denied;net.Server.prototype.listen=denied;tls.connect=denied;dgram.Socket.prototype.bind=denied;globalThis.fetch=denied;
syncBuiltinESMExports();
