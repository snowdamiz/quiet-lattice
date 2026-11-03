import fs from 'node:fs';
import path from 'node:path';
import {runEntryStage,sha} from './entry.mjs';
const [readyFile]=process.argv.slice(2),ready=JSON.parse(fs.readFileSync(readyFile));
if(ready.runtimeAuthorization!==false || ready.purpose!=='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES')throw Error('CPU fixture scope refused');
const stage=ready.stages[0];let calls=0;
const runtime={async start(){return {observation:{installed:true,cpuReplayOnly:true,sourcePilot:ready.sourcePilot},backend:async()=>({...ready.historicalBackend,cpuReplayOnly:true}),
  async frame(work){
    const source=ready.sourceFrames[calls++];if(work.id!==source.work.id)throw Error('Fixture source order refused');
    const png=fs.readFileSync(source.pngPath),obs=fs.readFileSync(source.observationPath);
    if(sha(png)!==source.pngSha256||png.length!==source.pngBytes||sha(obs)!==source.observationSha256)throw Error('Historical source identity drift');
    const saved=JSON.parse(obs);delete saved.dataUrl;return {...saved,dataUrl:'data:image/png;base64,'+png.toString('base64')};
  }};},async cleanup(){return {released:true,cpuReplayOnly:true};}};
const result=await runEntryStage({ready,stage,output:ready.captureOutput,runtime});
console.log(JSON.stringify({scope:ready.purpose,accepted:result.accepted,frames:result.completed.length,primary:result.primaryFailure,cleanup:result.cleanupFailures}));
process.exitCode=result.accepted?0:1;
