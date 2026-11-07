import { registerHooks } from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13';
const fromClient=createRequire(root+'/packages/client/package.json');
const fromTools=createRequire(root+'/packages/tools/package.json');
const threeRoot=realpathSync(root+'/packages/client/node_modules/three');
const meshoptEntry=fromTools.resolve('meshoptimizer');
const seen=new Map();
registerHooks({resolve(spec,ctx,next){
 let out;
 if(spec==='three')out={url:pathToFileURL(threeRoot+'/build/three.module.js').href,shortCircuit:true};
 else if(spec.startsWith('three/addons/'))out={url:pathToFileURL(threeRoot+'/examples/jsm/'+spec.slice('three/addons/'.length)).href,shortCircuit:true};
 else if(spec==='meshoptimizer')out={url:pathToFileURL(meshoptEntry).href,shortCircuit:true};
 else if(spec.startsWith('@astra/shared'))out={url:pathToFileURL(root+'/packages/shared/src/'+(spec==='@astra/shared'?'index.ts':spec.slice('@astra/shared/'.length)+'/index.ts')).href,shortCircuit:true};
 else out=next(spec,ctx);
 if(out.url.startsWith('file:')){const path=realpathSync(fileURLToPath(out.url));if(!seen.has(path))seen.set(path,createHash('sha256').update(readFileSync(path)).digest('hex'));}
 return out;
}});
process.on('exit',()=>writeFileSync(new URL('./imports-used-direct.json',import.meta.url),JSON.stringify(Object.fromEntries(seen),null,2)+'\n'));
