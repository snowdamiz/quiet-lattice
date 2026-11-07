import { ESLint } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/node_modules/eslint/lib/api.js';
const repo='/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521';
const eslint=new ESLint({cwd:repo,cache:false});
const result=await eslint.lintFiles(['symbiotic-online.spec.ts','symbiotic-private.test.ts','symbiotic-lifetime.test.ts','symbiotic-visibility.test.ts'].map(f=>repo+'/packages/tools/src/smoke/'+f));
console.log(await(await eslint.loadFormatter('stylish')).format(result));
const errors=result.reduce((s,r)=>s+r.errorCount,0),warnings=result.reduce((s,r)=>s+r.warningCount,0);console.log(JSON.stringify({errors,warnings}));process.exitCode=errors?1:0;
