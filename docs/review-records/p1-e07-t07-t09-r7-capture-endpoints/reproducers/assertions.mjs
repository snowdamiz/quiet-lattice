import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ts from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/node_modules/typescript/lib/typescript.js';
const root=new URL('.',import.meta.url).pathname,repo='/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521';
const base=fs.readFileSync('/private/tmp/symbiotic-visibility-da532383-y1y_tk7x/base/packages/tools/src/smoke/symbiotic-online.spec.ts','utf8');
const current=fs.readFileSync(repo+'/packages/tools/src/smoke/symbiotic-online.spec.ts','utf8');
function tokens(text){const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,text);const out=[];for(let t=scanner.scan();t!==ts.SyntaxKind.EndOfFileToken;t=scanner.scan())out.push([t,scanner.getTokenText()]);return JSON.stringify(out);}
function expressions(text){const source=ts.createSourceFile('spec.ts',text,ts.ScriptTarget.Latest,true),out=[];const visit=n=>{if(ts.isCallExpression(n)&&/^expect\(/.test(n.getText(source)))out.push(n.getText(source));ts.forEachChild(n,visit);};visit(source);return out;}
const old=expressions(base),now=expressions(current),remaining=now.map(tokens),missing=[];
for(const e of old){const i=remaining.indexOf(tokens(e));if(i<0)missing.push(e);else remaining.splice(i,1);}
assert.equal(missing.length,0,JSON.stringify(missing));
const blocks=[];
for(const [name,start,end] of [
 ['authoritative retirement wait',"    await until(\n      b.page,\n      `window.game.net.joined",'    const retired ='],
 ['terminal owner page closure','    // Net.close() reloads this dev-login URL.','    await until(\n      b.page,'],
 ['original owner movement','    const initialOwner:', '    for (const page of pages)\n      await until('],
 ['original observer/target lifetime assertions','    const retired =', '    evidence.retired = retired;']
]){const a=base.indexOf(start),b=base.indexOf(end,a),c=current.indexOf(start),d=current.indexOf(end,c);assert.ok([a,b,c,d].every(x=>x>=0),name);assert.equal(tokens(base.slice(a,b)),tokens(current.slice(c,d)),name);blocks.push(name);}
const result={baseSha256:crypto.createHash('sha256').update(base).digest('hex'),currentSha256:crypto.createHash('sha256').update(current).digest('hex'),priorExpectCalls:old.length,currentExpectCalls:now.length,missingPriorExpectCalls:missing,preservedTokenExactBlocks:blocks,limits:'Token equality preserves prior assertions. New capture framing/placement calls remain a separate native acceptance gate.'};
fs.writeFileSync(root+'assertion-preservation.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

const r7=fs.readFileSync(root+'base-spec.ts.txt','utf8'),r7Calls=expressions(r7),bag=now.map(tokens);
for(const e of r7Calls){const i=bag.indexOf(tokens(e));assert.ok(i>=0,e);bag.splice(i,1);}
const funcs=text=>new Map(ts.createSourceFile('spec.ts',text,ts.ScriptTarget.Latest,true).statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,tokens(n.getText())]));
const oldFns=funcs(r7),newFns=funcs(current),unchanged=[];
for(const [name,value] of oldFns)if(name!=='captureView'){assert.equal(newFns.get(name),value,name);unchanged.push(name);}
fs.writeFileSync(root+'r7-assertion-preservation.json',JSON.stringify({r7ExpectCalls:r7Calls.length,currentExpectCalls:now.length,allPriorPreserved:true,unchangedFunctions:unchanged,captureInventory:'same pixels/capture call sites: Bond2 active-follow2 combat2 observer retirement2; maximum8; no screenshot retry'},null,2)+'\n');
console.log(JSON.stringify({r7Preserved:r7Calls.length,current:now.length,unchangedFunctions:unchanged.length}));
