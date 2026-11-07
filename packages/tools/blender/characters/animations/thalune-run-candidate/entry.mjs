import {beforeWrite,writeBytes as packetWriteBytes,firstFailure,FILE_COUNT} from './packet-budget.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const PNG_PREFIX='data:image/png;base64,';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const failure=e=>({name:e?.name??'Error',message:String(e?.message??e),stack:String(e?.stack??'')});
const observedValue=value=>value===undefined?{returnedType:'undefined'}:value;
export function writeJson(file,value) {
  const temp=file+'.writing';
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file);
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export function validatePng(bytes,viewport,maxBytes) {
  if(bytes.length>maxBytes || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('PNG bytes/signature refused');
  let offset=8,ihdr=0,idat=0,end=false,channels=0;const compressed=[];
  while(offset<bytes.length) {
    if(offset+12>bytes.length)throw Error('Truncated PNG chunk');
    const count=bytes.readUInt32BE(offset), stop=offset+12+count;
    if(stop>bytes.length)throw Error('Truncated PNG payload');
    const type=bytes.toString('ascii',offset+4,offset+8), body=bytes.subarray(offset+8,offset+8+count);
    if(crc32(bytes.subarray(offset+4,offset+8+count))!==bytes.readUInt32BE(offset+8+count))throw Error('PNG CRC refused');
    if(type==='IHDR') {
      if(offset!==8 || count!==13 || ++ihdr!==1 || body.readUInt32BE(0)!==viewport[0] || body.readUInt32BE(4)!==viewport[1] ||
        body[8]!==8 || ![2,6].includes(body[9]) || body[10]!==0 || body[11]!==0 || body[12]!==0)throw Error('PNG viewport/format refused');
      channels=body[9]===6?4:3;
    }
    if(type==='IDAT'){idat+=count;compressed.push(body);}
    if(type==='IEND'){if(count!==0 || stop!==bytes.length)throw Error('PNG terminal bytes refused');end=true;}
    offset=stop;
  }
  if(ihdr!==1 || !idat || !end)throw Error('Incomplete PNG refused');
  const row=1+viewport[0]*channels, expected=row*viewport[1];
  const decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});
  if(decoded.length!==expected)throw Error('PNG decoded byte count refused');
  for(let y=0;y<viewport[1];y++)if(decoded[y*row]>4)throw Error('PNG row filter refused');
}
export function validateObservation(raw,work,ready) {
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const actual={workId:raw.workId,reel:raw.reel,frame:raw.frame,sequenceTime:raw.sequenceTime,
    people:raw.actualPeople,variant:raw.actualVariant,clip:raw.actualClip,light:raw.actualLight,lod:raw.actualLod,wire:raw.actualWire};
  const expected={workId:work.id,reel:work.reel,frame:work.frame,sequenceTime:work.sequenceTime,
    people:work.people,variant:work.people+'_head1',clip:work.clip,light:work.light,lod:work.lod,wire:work.wire};
  if(!equal(actual,expected))throw Error('Returned work/frame identity refused');
  if(!Array.isArray(raw.pageErrors)||raw.pageErrors.length)throw Error('Returned page errors refused');
  if(raw.sourceProfileId!==ready.manifest.sourceProfileId ||
    raw.targetProfileId!=='characters/'+work.people+'@'+ready.peopleHashes[work.people])throw Error('Returned source/target profile refused');
  if(!Number.isFinite(raw.actualTime) || Math.abs(raw.actualTime-work.time)>1e-6 || raw.renderCount!==1 ||
    !Number.isFinite(raw.clipDuration)||Math.abs(raw.clipDuration-ready.clipDurations[work.clip])>1e-6)throw Error('Returned clip time/render count refused');
  const names=ready.binding.profile.bones.map(b=>b.name).sort();
  for(const pose of [raw.intendedPose,raw.atRender?.pose,raw.afterCapture]) {
    if(!Array.isArray(pose) || !equal(pose.map(b=>b.name).sort(),names) ||
      pose.some(b=>!Array.isArray(b.position)||b.position.length!==3||!Array.isArray(b.quaternion)||b.quaternion.length!==4||
        !Array.isArray(b.scale)||b.scale.length!==3||![...b.position,...b.quaternion,...b.scale].every(Number.isFinite)))throw Error('Returned pose snapshot refused');
  }
  if(!equal(raw.intendedPose,raw.atRender.pose)||!equal(raw.intendedPose,raw.afterCapture))throw Error('Seek/render/capture pose differs');
  for(const matrix of [raw.atRender.cameraWorld,raw.atRender.reviewWorld])
    if(!Array.isArray(matrix)||matrix.length!==16||!matrix.every(Number.isFinite))throw Error('Returned render transform refused');
}
export function indexFiles(directory) {
  const result=[];
  const walk=dir=>{for(const name of fs.readdirSync(dir).sort()){
    const p=path.join(dir,name),s=fs.lstatSync(p);
    if(s.isSymbolicLink())throw Error('Artifact symlink refused');
    if(s.isDirectory())walk(p);
    else if(s.isFile() && p!==path.join(directory,'artifact-index.json'))result.push({path:path.relative(directory,p),bytes:s.size,sha256:sha(fs.readFileSync(p))});
    else if(!s.isFile())throw Error('Artifact kind refused');
  }};walk(directory);return result;
}
function persistReturned(output,work,raw,ready) {
  const stem=String(work.ordinal).padStart(4,'0'), observation=path.join(output,'observations',stem+'.json');
  let metadata=raw===undefined?{returnedType:'undefined'}:raw, png=null, imageFile=null;
  if(raw && typeof raw==='object' && typeof raw.dataUrl==='string' && raw.dataUrl.startsWith(PNG_PREFIX)) {
    png=Buffer.from(raw.dataUrl.slice(PNG_PREFIX.length),'base64');
    const canonical=PNG_PREFIX+png.toString('base64')===raw.dataUrl;
    if(canonical && png.length<=ready.limits.maxImageBytes) {
      imageFile='images/'+stem+'.png';packetWriteBytes(ready.packetRoot,path.join(output,imageFile),png);
      metadata={...raw,dataUrl:{losslessCanonicalRepresentation:true,prefix:PNG_PREFIX,file:imageFile,bytes:png.length,sha256:sha(png)}};
    }
  }
  const encoded=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
  if(encoded.length>ready.limits.maxObservationBytes) {
    writeJson(observation,{workId:work.id,oversizedReturnedObservation:true,bytes:encoded.length,sha256:sha(encoded)});
    throw Error('Returned observation exceeded byte bound; digest retained');
  }
  packetWriteBytes(ready.packetRoot,observation,encoded); // All returned identities/poses + exact image bytes precede semantic checks.
  if(!png || !imageFile)throw Error('Returned image encoding/byte bound refused; raw observation retained');
  validateObservation(raw,work,ready);
  validatePng(png,ready.viewport,ready.limits.maxImageBytes);
  return {workId:work.id,observation:path.relative(output,observation),image:imageFile,
    imageSha256:sha(png),poseSha256:sha(Buffer.from(JSON.stringify(raw.intendedPose)))};
}

export const PRIMARY_SCHEMA='t02-lossless-rgb-primary/v1';
export function persistMotionObservation(output,work,raw,ready) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))throw Error('Returned motion observation refused');
  const {dataUrl,...metadata}=raw; // Preserve every non-image field, including unknown fields.
  const encoded=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
  const observation='observations/'+String(work.ordinal).padStart(4,'0')+'.json';
  if(encoded.length>ready.limits.maxObservationBytes)throw Error('Complete non-image observation byte ceiling');
  packetWriteBytes(ready.packetRoot,path.join(output,observation),encoded);
  validateObservation(raw,work,ready);
  if(typeof dataUrl!=='string'||!dataUrl.startsWith(PNG_PREFIX))throw Error('Motion PNG data URL refused');
  const png=Buffer.from(dataUrl.slice(PNG_PREFIX.length),'base64');
  if(PNG_PREFIX+png.toString('base64')!==dataUrl)throw Error('Motion PNG base64 refused');
  validatePng(png,ready.viewport,ready.limits.maxImageBytes);
  return {png,observation,observationSha256:sha(encoded),poseSha256:sha(Buffer.from(JSON.stringify(raw.intendedPose))),poseCanonicalJson:JSON.stringify(raw.intendedPose)};
}
export function checkMetadataBudget(output,limit,additional=0,replace=null) {
  let total=0;const walk=dir=>{for(const name of fs.readdirSync(dir)){const p=path.join(dir,name),stat=fs.lstatSync(p);
    if(stat.isDirectory())walk(p);else if(name!=='primary.mp4'&&p!==replace)total+=stat.size;}};walk(output);
  if(total+additional>limit)throw Error('Primary metadata aggregate byte ceiling');
}

export async function runEntryStage({ready,stage,output,runtime,writer=writeJson,sinkFactory=null}) {
  if(fs.existsSync(output))throw Error('Capture output already exists; no retry');
  fs.mkdirSync(output);fs.mkdirSync(path.join(output,'images'));fs.mkdirSync(path.join(output,'observations'));
  if(ready.primaryArtifactSchema===PRIMARY_SCHEMA){const baseWriter=writer;writer=(file,value)=>{const bytes=Buffer.byteLength(JSON.stringify(value,null,2)+'\n');beforeWrite(ready.packetRoot,file,bytes,{atomic:true});baseWriter(file,value);};}
  const state={stage:stage.id,scope:'T02_PILOT_VISUAL_SEQUENCE_ONLY',status:'ACTIVE',accepted:false,
    primaryFailure:null,cleanupFailures:[],persistenceFailures:[],observations:[],completed:[],cleanup:[]};
  const persist=()=>{
    try{writer(path.join(output,'entry-state.json'),state);return true;}
    catch(error){
      const record=failure(error);state.persistenceFailures.push(record);
      if(state.primaryFailure===null)state.primaryFailure=record;
      if(ready.primaryArtifactSchema===PRIMARY_SCHEMA){try{firstFailure(ready.packetRoot,{schema:PRIMARY_SCHEMA,phase:'entry-persistence',primaryFailure:state.primaryFailure});}catch(secondary){state.persistenceFailures.push(failure(secondary));}}
      return false;
    }
  };
  const primary=error=>{if(state.primaryFailure===null)state.primaryFailure=failure(error);if(ready.primaryArtifactSchema===PRIMARY_SCHEMA){try{firstFailure(ready.packetRoot,{schema:PRIMARY_SCHEMA,phase:'entry',primaryFailure:state.primaryFailure});}catch(secondary){state.persistenceFailures.push(failure(secondary));}}persist();};
  let resources=null,sink=null,sinkFinalized=false;
  const primaryMotion=stage.kind==='motion'&&ready.primaryArtifactSchema===PRIMARY_SCHEMA;
  const frames=[];
  try {
    if(!persist())throw Error('Initial evidence persistence refused');
    resources=await runtime.start(ready,stage,observation=>{
      state.observations.push({runtimeReturned:observation});
      if(!persist())throw Error('Returned runtime observation persistence refused');
    });
    state.startObservation=observedValue(resources?.observation);
    if(!persist())throw Error('Runtime install observation persistence refused');
    if(!resources?.observation || resources.observation.installed!==true)throw Error('Runtime install observation refused');
    const backend=await resources.backend();state.backend=observedValue(backend);
    if(!persist())throw Error('Backend observation persistence refused');
    if(!backend || !/WebGL 2/i.test(backend.version)||!/Metal/i.test(backend.unmaskedRenderer??'')||
      /SwiftShader|llvmpipe/i.test(backend.unmaskedRenderer??'')||JSON.stringify(backend.canvas)!==JSON.stringify(ready.viewport))throw Error('Actual backend/viewport refused');
    if(primaryMotion){const factory=sinkFactory??(await import('./rgb-sink.mjs')).createRgbSink;sink=factory(ready,stage,output);}
    for(const work of stage.work) {
      if(primaryMotion){const map=path.join(output,'frame-map.json'),mapBytes=fs.existsSync(map)?fs.statSync(map).size:0;beforeWrite(ready.packetRoot,path.join(output,'next-frame-reservation'),2*ready.limits.maxObservationBytes+mapBytes+8192+1024**2,{fileLimit:FILE_COUNT-3});}
      const returned=await resources.frame(work);
      const metadata=returned===undefined?{returnedType:'undefined'}:returned&&typeof returned==='object'?{...returned,dataUrl:typeof returned.dataUrl==='string'?
        {returnedStringBytes:Buffer.byteLength(returned.dataUrl),sha256:sha(Buffer.from(returned.dataUrl))}:returned.dataUrl}:returned;
      const encoded=Buffer.from(JSON.stringify(metadata));
      state.lastReturnedObservation=encoded.length<=ready.limits.maxObservationBytes?metadata:
        {oversizedReturnedObservation:true,bytes:encoded.length,sha256:sha(encoded)};
      if(!persist())throw Error('Returned frame observation persistence refused');
      let record;
      if(primaryMotion) {
        const saved=persistMotionObservation(output,work,returned,ready);
        const ack=await sink.push(work,saved.png);
        (await import('./rgb-sink.mjs')).validateAck(ack,work,frames.length,saved.png);
        const row={...work,...ack,primaryVideo:'primary.mp4',mediaPts:frames.length*1000,mediaTimeBase:'1/60000',
          observation:saved.observation,observationSha256:saved.observationSha256,poseSha256:saved.poseSha256,poseCanonicalJson:saved.poseCanonicalJson};
        frames.push(row);writer(path.join(output,'frame-map.json'),{schema:PRIMARY_SCHEMA,frames});
        record={workId:work.id,observation:saved.observation,mediaFrameOrdinal:row.mediaFrameOrdinal,rgbSha256:row.rgbSha256};
      } else record=persistReturned(output,work,returned,ready);
      state.observations.push(record);state.completed.push(work.id);persist();
      if(state.persistenceFailures.length)throw Error('Evidence persistence failed; refusing next work');
    }
    if(state.completed.length!==stage.work.length)throw Error('Incomplete work');
    if(sink){state.encoderFinalization=await sink.finish();sinkFinalized=true;if(!persist())throw Error('Encoder finalization evidence persistence refused');}
  } catch(error) { primary(error); }
  finally {
    if(sink&&!sinkFinalized){try{await sink.abort();}catch(error){state.cleanupFailures.push({name:'encoder',...failure(error)});persist();}}
    for(const name of ['disposePage','closeBrowser','stopServer']) {
      try {
        const observation=await runtime.cleanup(name,resources);
        state.cleanup.push({name,returned:observedValue(observation)});persist();
        if(observation?.released!==true || observation?.neutralRestored===false || observation?.hookRestored===false ||
          observation?.pageErrors?.length)throw Error(name+' did not prove clean release');
      } catch(error) {state.cleanupFailures.push({name,...failure(error)});persist();}
    }
  }
  state.accepted=state.primaryFailure===null&&!state.cleanupFailures.length&&!state.persistenceFailures.length&&state.completed.length===stage.work.length;
  state.status=state.accepted?'CAPTURED_PENDING_VISUAL_REVIEW':'HOLD';
  if(!persist()){state.accepted=false;state.status='HOLD';}
  try{writer(path.join(output,'entry-result.json'),state);}
  catch(error){const record=failure(error);state.persistenceFailures.push(record);state.primaryFailure??=record;state.accepted=false;state.status='HOLD';}
  if(!state.persistenceFailures.length) {
    try {
      writer(path.join(output,'sequence-index.json'),{stage:stage.id,completeWork:state.completed.length===stage.work.length,
        finalStatusReference:'entry-result.json',kind:stage.kind,
        primaryArtifactSchema:primaryMotion?PRIMARY_SCHEMA:null,
        viewport:ready.viewport,manualSampleRateHz:stage.kind==='motion'?60:null,realTimePerformanceQualified:false,
        work:stage.work.filter(w=>state.completed.includes(w.id)).map(w=>({...w,
          ...(primaryMotion?{primaryVideo:'primary.mp4',mediaFrameOrdinal:frames.findIndex(r=>r.id===w.id)}:{image:'images/'+String(w.ordinal).padStart(4,'0')+'.png'}),
          observation:'observations/'+String(w.ordinal).padStart(4,'0')+'.json'}))});
    } catch(error) {
      const record=failure(error);state.persistenceFailures.push(record);state.primaryFailure??=record;state.accepted=false;state.status='HOLD';
      try{writer(path.join(output,'entry-result.json'),state);}catch(secondary){state.persistenceFailures.push(failure(secondary));}
    }
  }
  if(!state.persistenceFailures.length) {
    // No later state/event/artifact write on success; index excludes itself.
    try{writer(path.join(output,'artifact-index.json'),{stage:stage.id,accepted:state.accepted,files:indexFiles(output)});}
    catch(error) {
      const record=failure(error);state.persistenceFailures.push(record);state.primaryFailure??=record;state.accepted=false;state.status='HOLD';
      try{writer(path.join(output,'entry-result.json'),state);}catch(secondary){state.persistenceFailures.push(failure(secondary));}
    }
  }
  return state;
}

export function admit(ready,stageId,output,readyFile,environment=process.env) {
  if(ready.runtimeAuthorization!==true)throw Error('CPU-only source candidate; browser runtime disabled');
  if(environment.T02_PILOT_READY_SHA!==sha(fs.readFileSync(readyFile)) || environment.T02_PILOT_ATTEMPT!==ready.attemptId ||
    environment.T02_PILOT_STAGE!==stageId || !environment.T02_PILOT_GRANT)throw Error('Exact owned-stage admission absent');
  const consumed=JSON.parse(fs.readFileSync(path.join(HERE,'consumed-attempt.json')));
  if(sha(fs.readFileSync(path.join(HERE,'grant.json')))!==consumed.grantSha256)throw Error('Consumed grant bytes changed');
  if(sha(fs.readFileSync(path.join(HERE,'candidate-index.json')))!==consumed.combinedCandidateSha256)throw Error('Reviewed candidate index changed');
  const stage=ready.stages.find(s=>s.id===stageId);
  if(!stage || output!==path.join(ready.packetRoot,'captures',stageId) ||
    consumed.authorizationId!==environment.T02_PILOT_GRANT || consumed.attemptId!==ready.attemptId ||
    consumed.readinessSha256!==environment.T02_PILOT_READY_SHA)throw Error('Consumed attempt/stage refused');
  const claim=JSON.parse(fs.readFileSync(path.join(ready.proofRoot,'jobs',stageId,'launch-claim','admission.json')));
  if(claim.stage!==stageId || claim.authorizationId!==consumed.authorizationId || claim.attemptId!==ready.attemptId ||
    claim.readinessSha256!==consumed.readinessSha256)throw Error('Exclusive stage launch claim refused');
  for(const b of ready.bindings)if(sha(fs.readFileSync(b.path))!==b.sha256)throw Error('Entry input binding drift: '+b.path);
  return stage;
}

async function browserDependencies(ready) {
  const cap=await import(pathToFileURL(ready.root+'/packages/tools/src/capture/capture.ts'));
  const req=createRequire(ready.root+'/packages/tools/package.json');
  const {chromium}=req('@playwright/test');
  return {cap,chromium};
}
export function browserRuntime(program,loadDependencies=browserDependencies) {
  let vite=null,browser=null,page=null;const errors=[];
  return {
    async start(ready,stage,retain) {
      const {cap,chromium}=await loadDependencies(ready);
      const gl=cap.glArgs();
      if(JSON.stringify(gl.args)!==JSON.stringify(ready.browser.args)||gl.gl!=='metal')throw Error('Pinned Metal launch args changed');
      vite=await cap.startVite();
      browser=await chromium.launch({args:gl.args,executablePath:ready.browser.selectedExecutable.path});
      page=await browser.newPage({viewport:{width:ready.viewport[0],height:ready.viewport[1]},deviceScaleFactor:1});
      page.on('pageerror',e=>errors.push({type:'pageerror',message:e.message}));
      page.on('console',m=>{if(m.type()==='error')errors.push({type:'console',message:m.text()});});
      await page.addInitScript(()=>{window.__reviewCapture=true;let s=0x9e3779b9;Math.random=()=>{s=(s+0x6d2b79f5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};});
      await page.goto(vite.url+'/#review:characters/thalune');
      await page.waitForFunction(()=>!!window.review?.ready,null,{timeout:180000});
      await page.evaluate(()=>window.review.ready);
      const installed=await page.evaluate(async({source,options})=>{
        const module=Function(source.replace(/^export /gm,'')+';return {installPilotPage};')();
        return module.installPilotPage(options);
      },{source:program,options:{manifest:ready.manifest,binding:ready.binding,peopleHashes:ready.peopleHashes}});
      retain({phase:'install',returned:observedValue(installed)});
      if(installed?.installed!==true || installed.sourceProfileId!==ready.manifest.sourceProfileId ||
        installed.standardReview!=='characters/thalune')throw Error('Serialized page install observation refused');
      const begun=await page.evaluate(species=>window.__t02Pilot.begin(species),stage.people);
      retain({phase:'begin-people',returned:observedValue(begun)});
      if(begun?.people!==stage.people || begun?.profileId!=='characters/'+stage.people+'@'+ready.peopleHashes[stage.people] ||
        begun?.variant!==stage.people+'_head1')throw Error('Loaded people/profile observation refused');
      return {observation:installed,
        backend:()=>page.evaluate(()=>window.__t02Pilot.backend()),
        async frame(work) {
          if(errors.length)throw Error('Page errors before work: '+JSON.stringify(errors));
          const returned=await page.evaluate(work=>window.__t02Pilot.frame(work),work);
          // Retain errors in the raw returned observation; entry persists before refusal.
          return returned&&typeof returned==='object'?{...returned,pageErrors:errors.slice()}:returned;
        }};
    },
    async cleanup(name) {
      if(name==='disposePage'){return page?await page.evaluate(()=>window.__t02Pilot?window.__t02Pilot.dispose():{released:true,notInstalled:true}):{released:true,notStarted:true};}
      if(name==='closeBrowser'){if(browser)await browser.close();return {released:true,pageErrors:errors.slice()};}
      if(name==='stopServer'){if(vite)await vite.stop();return {released:true};}
      throw Error('Unknown cleanup');
    },
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let state;
  try {
    const [readyFile,stageId,output]=process.argv.slice(2),ready=JSON.parse(fs.readFileSync(readyFile));
    const stage=admit(ready,stageId,output,readyFile);
    ready.nativeRawDirectory=path.join(ready.proofRoot,'jobs',stageId,'native');
    const program=fs.readFileSync(path.join(HERE,'playback.mjs'),'utf8')+'\n'+fs.readFileSync(path.join(HERE,'page-api.mjs'),'utf8');
    state=await runEntryStage({ready,stage,output,runtime:browserRuntime(program)});
    console.log(JSON.stringify({stage:stageId,status:state.status,primaryFailure:state.primaryFailure}));
    process.exitCode=state.accepted?0:1;
  } catch(error) {console.error(JSON.stringify({status:'ENTRY_REFUSED',primaryFailure:failure(error)}));process.exitCode=1;}
}
