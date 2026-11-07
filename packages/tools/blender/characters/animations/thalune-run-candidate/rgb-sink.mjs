import {writeJson as packetWriteJson,writeBytes as packetWriteBytes} from './packet-budget.mjs';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import {writeJson,sha} from './entry.mjs';
export const SCHEMA='t02-lossless-rgb-primary/v1';
export function validateAck(ack,work,index,png){
  if(ack?.schema!==SCHEMA || ack.workId!==work.id || ack.mediaFrameOrdinal!==index || ack.sourcePngBytes!==png.length ||
    ack.sourcePngSha256!==sha(png) || ack.width!==1920 || ack.height!==1080 || ack.alphaPolicy!=='verified-opaque255' ||
    ack.sourcePngRetained!==false || !/^[0-9a-f]{64}$/.test(ack.rgbSha256??'') || !/^[0-9a-f]{64}$/.test(ack.rgbaSha256??''))throw Error('Encoder acknowledgment refused');
}
export function createRgbSink(ready,stage,output){
  if(stage.work.length!==189||ready.rgbPrimary.maxVideoBytes!==39354368)throw Error('Exact reel limits refused');
  if(!ready.nativeRawDirectory.endsWith('/jobs/'+stage.id+'/native'))throw Error('Distinct stage log path refused');
  const config={schema:SCHEMA,maxVideoBytes:39354368,frameCount:stage.work.length,video:output+'/primary.mp4',rawLog:ready.nativeRawDirectory+'/encoder.raw.log',
    command:ready.nativeRawDirectory+'/encoder-command.json',result:ready.nativeRawDirectory+'/encoder-result.json',ffmpeg:ready.rgbPrimary.ffmpeg};
  packetWriteJson(ready.packetRoot,output+'/encoder-config.json',config);
  const stderr=fs.openSync(ready.nativeRawDirectory+'/worker.stderr','wx');
  const raw=fs.openSync(ready.nativeRawDirectory+'/worker.stdout','wx');
  const child=spawn(ready.rgbPrimary.python,[ready.rgbPrimary.worker,'encode-png-stdio',output+'/encoder-config.json'],
    {stdio:['pipe','pipe',stderr],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  fs.closeSync(stderr);
  let pending=null,ended=false,index=0,primary=null,busy=false,rawClosed=false;
  const closeRaw=()=>{if(!rawClosed){fs.closeSync(raw);rawClosed=true;}};
  child.stdin.on('error',e=>{primary??=e;pending?.reject(e);pending=null;});
  const close=new Promise((resolve,reject)=>{child.once('error',e=>{primary??=e;pending?.reject(e);pending=null;reject(e);});child.once('close',(code,signal)=>{
    ended=true;if(code!==0){const e=primary??Error('Pixel worker exit '+code+' '+signal);primary??=e;pending?.reject(e);pending=null;reject(e);}else resolve();});});
  close.catch(()=>{}); // finalization/abort awaits the same error; no detached rejection
  child.stdout.on('data',bytes=>fs.writeSync(raw,bytes));
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{
    try{if(!pending)throw Error('Unexpected encoder acknowledgment');const value=JSON.parse(line);const p=pending;pending=null;p.resolve(value);}
    catch(e){primary??=e;pending?.reject(e);pending=null;}
  });
  return {
    async push(work,png){
      if(busy || pending || ended || primary)throw primary??Error('One-frame encoder queue refused');
      busy=true;try{
      const head=Buffer.from(JSON.stringify({workId:work.id,mediaFrameOrdinal:index}));const length=Buffer.alloc(8);length.writeUInt32BE(head.length);length.writeUInt32BE(png.length,4);
      const ack=new Promise((resolve,reject)=>{pending={resolve,reject};});ack.catch(()=>{});
      // Write only this source frame; awaiting ACK keeps the next producer dispatch behind encoder backpressure.
      for(const bytes of [length,head,png])if(!child.stdin.write(bytes))await Promise.race([once(child.stdin,'drain'),close.then(()=>{throw Error('Worker closed during write');})]);
      const value=await ack;validateAck(value,work,index,png);index++;return value;
      }finally{busy=false;}
    },
    async finish(){child.stdin.end();try{await close;if(primary)throw primary;const result=JSON.parse(fs.readFileSync(config.result));if(result.accepted!==true||result.frames!==index)throw Error('Encoder finalization refused');for(const [source,name] of [[config.command,'encoder-command.json'],[config.result,'encoder-result.json']]){if(fs.statSync(source).size>2*1024**2)throw Error('Encoder report byte ceiling');packetWriteBytes(ready.packetRoot,output+'/'+name,fs.readFileSync(source));}return result;}finally{closeRaw();}},
    async abort(){child.stdin.end();try{await close;}finally{closeRaw();}},
  };
}
