import fs from 'node:fs';import path from 'node:path';
export const METADATA_BYTES=32*1024**2,FILE_COUNT=256,RECORD_BYTES=128*1024;
const reserved=new Set(['failure.json','integration-result.json']),video='capture/primary.mp4';
export function inventory(root){
 root=path.resolve(root);let normalBytes=0,reservedBytes=0,files=0,reservedFiles=0;const paths=[];
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file),relative=path.relative(root,file);
  if(stat.isSymbolicLink())throw Error('Packet symlink refused');if(stat.isDirectory()){walk(file);continue;}if(!stat.isFile())throw Error('Packet file kind refused');
  paths.push(relative);files++;if(relative===video){if(stat.size>512*1024**2)throw Error('Primary media byte ceiling');}
  else if(reserved.has(relative)){if(stat.size>RECORD_BYTES)throw Error('Reserved record byte ceiling');reservedBytes+=stat.size;reservedFiles++;}else normalBytes+=stat.size;
 }};walk(root);return {normalBytes,reservedBytes,files,reservedFiles,paths};
}
export function beforeWrite(root,target,count,{atomic=false,isReserved=false,metadataLimit=METADATA_BYTES,fileLimit=FILE_COUNT,recordLimit=RECORD_BYTES}={}){
 root=path.resolve(root);target=path.resolve(target);const name=path.relative(root,target);
 if(name.startsWith('..')||path.isAbsolute(name)||name===video)throw Error('Packet target refused');
 const current=inventory(root);if(current.normalBytes>metadataLimit-2*recordLimit)throw Error('Existing packet metadata ceiling');
 if(isReserved){
  if(!reserved.has(name)||count>recordLimit||fs.existsSync(target)||current.reservedBytes+count>2*recordLimit||current.files+1>fileLimit)throw Error('Reserved first/terminal record refused');
 }else{
  if(reserved.has(name)||(atomic&&fs.existsSync(target+'.writing')))throw Error('Interrupted or reserved packet write refused');
  if(current.normalBytes+count>metadataLimit-2*recordLimit)throw Error('Aggregate packet metadata byte ceiling');
  const mediaSlot=current.paths.includes(video)?0:1;
  if(current.files-current.reservedFiles+1+mediaSlot>fileLimit-2)throw Error('Aggregate packet file-count ceiling');
 }
 return current;
}
export function writeBytes(root,target,bytes,{atomic=false,isReserved=false}={}){
 beforeWrite(root,target,bytes.length,{atomic,isReserved});
 if(atomic){fs.writeFileSync(target+'.writing',bytes,{flag:'wx'});fs.renameSync(target+'.writing',target);}
 else fs.writeFileSync(target,bytes,{flag:'wx'});
}
export function writeJson(root,target,value,{isReserved=false}={}){writeBytes(root,target,Buffer.from(JSON.stringify(value,null,2)+'\n'),{atomic:!isReserved,isReserved});}
export function firstFailure(root,value){const file=path.join(root,'failure.json');if(!fs.existsSync(file))writeJson(root,file,value,{isReserved:true});}
