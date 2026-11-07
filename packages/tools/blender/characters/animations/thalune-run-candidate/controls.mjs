// Synthetic pixels and injected runtimes only; no browser, renderer, or encoder.
import {fileURLToPath} from 'node:url';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
let nativeCalls=0;for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=()=>{nativeCalls++;throw Error('Native child refused');};syncBuiltinESMExports();
const {runEntryStage,persistMotionObservation,sha,writeJson,crc32,admit,PRIMARY_SCHEMA}=await import('./entry.mjs');
const {validateAck}=await import('./rgb-sink.mjs');
const budget=await import('./packet-budget.mjs');
const ready=JSON.parse(fs.readFileSync(new URL('./readiness.json',import.meta.url))),root=fs.mkdtempSync(path.join(os.tmpdir(),'t02-run-pure-'));
const controls=[];const pass=name=>controls.push({control:name,pass:true});
function chunk(name,bytes){const b=Buffer.alloc(bytes.length+12);b.writeUInt32BE(bytes.length);b.write(name,4);bytes.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1920);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((1+1920*3)*1080))),chunk('IEND',Buffer.alloc(0))]);
const rgbHash=sha(Buffer.alloc(1920*1080*3));const rgba=Buffer.alloc(1920*1080*4);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;const rgbaHash=sha(rgba);
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],pose=ready.binding.profile.bones.map(({name,position,quaternion,scale})=>({name,position,quaternion,scale}));
function observation(work){return {workId:work.id,reel:work.reel,frame:work.frame,sequenceTime:work.sequenceTime,actualPeople:work.people,
 actualVariant:work.people+'_head1',actualClip:work.clip,actualTime:work.time,clipDuration:.8,sourceProfileId:ready.manifest.sourceProfileId,
 targetProfileId:ready.manifest.sourceProfileId,actualLight:work.light,actualLod:work.lod,actualWire:work.wire,renderCount:1,
 intendedPose:pose,atRender:{pose,cameraWorld:matrix,reviewWorld:matrix,unknownNested:{retained:true}},afterCapture:pose,
 pageErrors:[],futureUnknown:{nested:[false,null,17,{x:'preserve'}]},dataUrl:'data:image/png;base64,'+png.toString('base64')};}
function ack(work,i){return {schema:PRIMARY_SCHEMA,workId:work.id,mediaFrameOrdinal:i,sourcePngBytes:png.length,sourcePngSha256:sha(png),
 rgbSha256:rgbHash,rgbaSha256:rgbaHash,width:1920,height:1080,alphaPolicy:'verified-opaque255',sourcePngRetained:false};}
function runtime(modifier=x=>x){let calls=0;return {get calls(){return calls;},async start(){return {observation:{installed:true},backend:async()=>({version:'WebGL 2',unmaskedRenderer:'Synthetic Metal fixture',canvas:[1920,1080]}),frame:async w=>{calls++;return modifier(observation(w));}};},async cleanup(){return {released:true};}};}
function setup(name,stage=ready.stages[0]){const packet=path.join(root,name);fs.mkdirSync(packet);const output=path.join(packet,'captures',stage.id);fs.mkdirSync(path.dirname(output),{recursive:true});return {ready:{...ready,packetRoot:packet},stage,output};}
function sink(output){let i=0;return {async push(work){return ack(work,i++);},async finish(){const video=Buffer.from('SYNTHETIC SOURCE CONTROL - NOT MEDIA');fs.writeFileSync(output+'/primary.mp4',video);for(const name of ['encoder-config','encoder-command'])writeJson(output+'/'+name+'.json',{synthetic:true});const result={accepted:true,frames:i,videoSha256:sha(video)};writeJson(output+'/encoder-result.json',result);return result;},async abort(){}};}
assert.throws(()=>admit(ready,ready.stages[0].id,'unused','unused'),/disabled/);pass('disabled entry before bindings, allocation or child import');
for(const [field,value] of [['workId','wrong'],['mediaFrameOrdinal',1],['sourcePngSha256','0'.repeat(64)],['rgbSha256','bad'],['alphaPolicy','dropped']]){assert.throws(()=>validateAck({...ack(ready.stages[0].work[0],0),[field]:value},ready.stages[0].work[0],0,png));pass('ACK refusal '+field);}
for(const mode of ['EPIPE','persistence','observation','cleanup']){
 const options=setup(mode,{...ready.stages[0],work:ready.stages[0].work.slice(0,2)}),rt=runtime(mode==='observation'?x=>({...x,actualTime:Infinity}):x=>x);let pushes=0;
 if(mode==='cleanup')rt.cleanup=async()=>{throw Error('secondary cleanup fixture');};
 const result=await runEntryStage({...options,runtime:rt,writer(file,value){if(mode==='persistence'&&value.lastReturnedObservation)throw Error('write failure fixture');writeJson(file,value);},sinkFactory:()=>({async push(){pushes++;throw Error('EPIPE fixture');},async abort(){}})});
 assert.equal(rt.calls,1);assert.equal(pushes,['persistence','observation'].includes(mode)?0:1);assert.equal(result.accepted,false);
 if(mode==='cleanup'){assert.match(result.primaryFailure.message,/EPIPE/);assert(result.cleanupFailures.length);}
 pass(mode+' stops later frame dispatch and retains first failure');
}
{
 const options=setup('backpressure',{...ready.stages[0],work:ready.stages[0].work.slice(0,2)}),rt=runtime();let pushes=0,release;
 const gate=new Promise(r=>release=r);const underlying=sink(options.output);
 const running=runEntryStage({...options,runtime:rt,sinkFactory:()=>({...underlying,async push(w){if(++pushes===1)await gate;return underlying.push(w);}})});
 while(!pushes)await new Promise(r=>setImmediate(r));assert.equal(rt.calls,1);release();assert((await running).accepted);assert.equal(rt.calls,2);pass('blocked ACK permits only one in-flight source frame');
}
const packet=path.join(root,'complete');fs.mkdirSync(packet);fs.mkdirSync(packet+'/captures');fs.mkdirSync(packet+'/inspections');
for(const stage of ready.stages){
 const output=path.join(packet,'captures',stage.id),rt=runtime();const state=await runEntryStage({ready:{...ready,packetRoot:packet},stage,output,runtime:rt,sinkFactory:()=>sink(output)});
 assert(state.accepted,JSON.stringify(state.primaryFailure));assert.equal(rt.calls,stage.work.length);
 for(const w of stage.work){const saved=JSON.parse(fs.readFileSync(output+`/observations/${String(w.ordinal).padStart(4,'0')}.json`));const {dataUrl,...expected}=observation(w);if(stage.kind==='stills')delete saved.dataUrl;assert.deepEqual(saved,expected);}
 pass('complete '+stage.id+' inventory and unknown observations');
}
{
 const packet=path.join(root,'budget');fs.mkdirSync(packet);const ordinary=packet+'/ordinary';fs.writeFileSync(ordinary,'');
 budget.beforeWrite(packet,ordinary,budget.METADATA_BYTES-2*budget.RECORD_BYTES);assert.throws(()=>budget.beforeWrite(packet,ordinary,budget.METADATA_BYTES-2*budget.RECORD_BYTES+1));pass('metadata byte boundary including atomic peak');
 for(const name of budget.videos){const f=packet+'/'+name;fs.mkdirSync(path.dirname(f),{recursive:true});const fd=fs.openSync(f,'wx');fs.ftruncateSync(fd,budget.VIDEO_BYTES);fs.closeSync(fd);}budget.inventory(packet);
 const first=packet+'/'+[...budget.videos][0];fs.truncateSync(first,budget.VIDEO_BYTES+1);assert.throws(()=>budget.inventory(packet));fs.truncateSync(first,budget.VIDEO_BYTES);pass('both reel paths accept ceiling and reject ceiling plus one');
 const still=packet+'/'+[...budget.stills][0];budget.beforeWrite(packet,still,budget.IMAGE_BYTES);assert.throws(()=>budget.beforeWrite(packet,still,budget.IMAGE_BYTES+1));pass('12 MiB still boundary');
 for(let i=0;i<499;i++)fs.writeFileSync(packet+'/f'+i,'');assert.throws(()=>budget.beforeWrite(packet,packet+'/next',0));pass('512 file cap reserves two reels, eight stills and terminal records');
}
assert.equal(nativeCalls,0);
const report={status:'PASS_SYNTHETIC_SOURCE_CONTROLS_NO_NATIVE_JOBS',nativeCalls,fixtureRoot:packet,syntheticNotCaptureEvidence:true,controls};
writeJson(fileURLToPath(new URL('./pure-node-controls.json',import.meta.url)),report);console.log(JSON.stringify({status:report.status,controls:controls.length,nativeCalls,fixtureRoot:packet}));
