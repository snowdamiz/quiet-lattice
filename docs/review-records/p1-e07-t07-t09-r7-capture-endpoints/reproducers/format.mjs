import fs from 'node:fs';
import prettier from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/node_modules/prettier/index.mjs';
const repo='/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521', root=new URL('.',import.meta.url).pathname;
for(const f of ['symbiotic-online.spec.ts','symbiotic-visibility.test.ts']) {
 const path=repo+'/packages/tools/src/smoke/'+f;
 const options={...await prettier.resolveConfig(path),filepath:path};
 const text=await prettier.format(fs.readFileSync(path,'utf8'),options);
 if(process.argv.includes('--check')) { if(text!==fs.readFileSync(path,'utf8'))throw Error('format differs: '+f); }
 else fs.writeFileSync(root+f,text);
}
console.log('format PASS');
