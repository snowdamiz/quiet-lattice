// In-process negative controls over actual entry/sink functions. No child/browser invocation.
import {fileURLToPath} from 'node:url';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {runEntryStage as actualRunEntryStage,persistMotionObservation,checkMetadataBudget,sha,writeJson} from './entry.mjs';
import {validateAck,SCHEMA} from './rgb-sink.mjs';
const ready=JSON.parse(fs.readFileSync(new URL('./readiness.json',import.meta.url))),root=fs.mkdtempSync('/private/tmp/t02-primary-pure-controls-');
ready.packetRoot=root;
async function runEntryStage(options){fs.mkdirSync(path.dirname(options.output),{recursive:true});return actualRunEntryStage({...options,ready:{...options.ready,packetRoot:path.dirname(options.output)}});}
const sources=ready.sourceFrames.slice(0,2),works=sources.map(x=>x.work),stage={...ready.stages[0],work:works};
const returns=sources.map(s=>{const raw=JSON.parse(fs.readFileSync(s.observationPath));raw.dataUrl='data:image/png;base64,'+fs.readFileSync(s.pngPath).toString('base64');return raw;});
const receipts=[];
function runtime(cleanupFailure=false){let calls=0;return {get calls(){return calls;},async start(){return {observation:{installed:true},backend:async()=>ready.historicalBackend,frame:async()=>returns[calls++]};},async cleanup(name){if(cleanupFailure&&name==='closeBrowser')throw Error('secondary cleanup fixture');return {released:true};}};}
function ack(work,index){const s=sources[index];return {schema:SCHEMA,workId:work.id,mediaFrameOrdinal:index,sourcePngBytes:s.pngBytes,sourcePngSha256:s.pngSha256,rgbSha256:s.rgbSha256,rgbaSha256:s.rgbaSha256,width:1920,height:1080,alphaPolicy:'verified-opaque255',sourcePngRetained:false};}
const plain=path.join(root,'unknown');fs.mkdirSync(plain);fs.mkdirSync(plain+'/observations');const rich={...returns[0],futureUnknown:{nested:[false,null,17,{x:'preserve'}]}};
persistMotionObservation(plain,works[0],rich,ready);const saved=JSON.parse(fs.readFileSync(plain+'/observations/0015.json'));const {dataUrl,...expected}=rich;assert.deepEqual(saved,expected);receipts.push({control:'complete unknown non-image observation',pass:true});
assert.throws(()=>checkMetadataBudget(plain,1),/ceiling/);receipts.push({control:'prospective aggregate byte limit',pass:true});
for(const [field,value] of [['workId','wrong'],['mediaFrameOrdinal',1],['sourcePngSha256','0'.repeat(64)],['alphaPolicy','dropped']]){assert.throws(()=>validateAck({...ack(works[0],0),[field]:value},works[0],0,Buffer.from(returns[0].dataUrl.split(',')[1],'base64')),/refused/);receipts.push({control:'bad ACK '+field,pass:true});}
{
 const r=runtime(true);let pushes=0;
 const result=await runEntryStage({ready,stage,output:root+'/epipe/capture',runtime:r,sinkFactory:()=>({async push(){pushes++;throw Error('EPIPE fixture');},async abort(){}})});
 assert.equal(r.calls,1);assert.equal(pushes,1);assert.match(result.primaryFailure.message,/EPIPE/);assert(result.cleanupFailures.some(x=>x.message==='secondary cleanup fixture'));assert(fs.existsSync(root+'/epipe/capture/observations/0015.json'));receipts.push({control:'encoder EPIPE stops next dispatch; observation and primary/cleanup retained',pass:true});
}
{
 const r=runtime();let pushes=0;
 const result=await runEntryStage({ready,stage,output:root+'/persist/capture',runtime:r,writer(file,value){if(value.lastReturnedObservation)throw Error('write failure fixture');writeJson(file,value);},sinkFactory:()=>({async push(){pushes++;},async abort(){}})});
 assert.equal(r.calls,1);assert.equal(pushes,0);assert.match(result.primaryFailure.message,/write failure/);receipts.push({control:'persistence failure prevents first encoder write and next frame',pass:true});
}
{
 const r=runtime();let pushes=0,release;const gate=new Promise(resolve=>release=resolve);
 const running=runEntryStage({ready,stage,output:root+'/backpressure/capture',runtime:r,sinkFactory:()=>({async push(work){const i=pushes++;if(!i)await gate;return ack(work,i);},async finish(){return {accepted:true,frames:2};},async abort(){}})});
 while(!pushes)await new Promise(resolve=>setImmediate(resolve));assert.equal(r.calls,1);release();const result=await running;assert.equal(r.calls,2);assert(result.accepted);receipts.push({control:'one in-flight source frame under blocked ACK',pass:true});
}
writeJson(fileURLToPath(new URL('./pure-node-controls.json',import.meta.url)),{status:'PASS_IN_PROCESS_NO_NATIVE_CHILDREN',root,controls:receipts});console.log(JSON.stringify({status:'PASS',controls:receipts.length,root}));
