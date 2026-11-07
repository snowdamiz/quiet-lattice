import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const base=process.cwd(), require=createRequire(base+'/packages/client/package.json');
const T=await import(pathToFileURL(require.resolve('three').replace(/three\.cjs$/, 'three.module.js')));
const {loadActualRig}=await import(pathToFileURL(base+'/packages/client/test/characters/loadActualRig.js'));
const {captureSharedRigBindProfile:capture,adaptSharedRigClip:adapt}=await import(pathToFileURL(base+'/packages/client/src/characters/sharedRig.js'));
const out='/tmp/characters-whole-review2-sol-20261102', all=[];
for(const name of ['thalune','ixari','ulgani']) {
 const gltf=await loadActualRig(name), scene=gltf.scene, profile=capture({id:name+'@'+gltf.proof.exportSha256,root:scene}), meshes=[];
 scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
 all.push({name,scene,profile,meshes,proof:gltf.proof,rest:meshes.map(m=>{const a=[];for(let i=0;i<m.geometry.attributes.position.count;i++)a.push(m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld));return a;})});
}
const snapshot=(x)=>JSON.stringify(x.profile.bones.map(b=>{const n=x.scene.getObjectByName(b.name);return {name:n.name,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()};}));
const restore=x=>{for(const b of x.profile.bones){const n=x.scene.getObjectByName(b.name);n.position.fromArray(b.position);n.quaternion.fromArray(b.quaternion);n.scale.fromArray(b.scale);}x.scene.updateMatrixWorld(true);};
const clipFor=(profile,motion=false)=>new T.AnimationClip('independent',1,profile.bones.flatMap((b,i)=>{
 const offset=motion?[.001*(i%3),-.001*(i%5),.001*(i%7)]:[0,0,0],ratio=motion?[1.01,1.02,1.03]:[1,1,1];
 const delta=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,2,3).normalize(),motion?.04:0);
 return [new T.VectorKeyframeTrack(b.name+'.position',[0,1],[...b.position,...b.position.map((v,j)=>v+offset[j])]),new T.QuaternionKeyframeTrack(b.name+'.quaternion',[0,1],[...b.quaternion,...new T.Quaternion().fromArray(b.quaternion).multiply(delta).toArray()]),new T.VectorKeyframeTrack(b.name+'.scale',[0,1],[...b.scale,...b.scale.map((v,j)=>v*ratio[j])])];
}));
const result={exports:all.map(x=>x.proof),pairs:[],negativeControls:[]};
for(const src of all)for(const dst of all){
 const before=[snapshot(src),snapshot(dst),JSON.stringify(src.profile),JSON.stringify(dst.profile)];
 const pair={source:src.name,target:dst.name,bones:dst.profile.bones.length,meshes:dst.meshes.length,allVertexCount:dst.rest.reduce((a,b)=>a+b.length,0)};
 for(const motion of [false,true]){
  const input=clipFor(src.profile,motion), beforeClip=JSON.stringify(input.toJSON());
  const output=adapt({clip:input,sourceProfileId:src.profile.id,sourceProfile:src.profile,targetProfile:dst.profile});
  assert.deepEqual([snapshot(src),snapshot(dst),JSON.stringify(src.profile),JSON.stringify(dst.profile)],before);
  assert.notEqual(input,output);assert.equal(output.name,input.name);assert.equal(output.duration,input.duration);assert.equal(output.blendMode,input.blendMode);
  for(let i=0;i<input.tracks.length;i++){assert.notEqual(output.tracks[i],input.tracks[i]);assert.notEqual(output.tracks[i].times,input.tracks[i].times);assert.notEqual(output.tracks[i].values,input.tracks[i].values);}
  const mixer=new T.AnimationMixer(dst.scene);mixer.clipAction(output).play();mixer.setTime(.37);dst.scene.updateMatrixWorld(true);
  let localError=0,rotationError=0;
  for(let i=0;i<dst.profile.bones.length;i++){
   const b=dst.profile.bones[i],n=dst.scene.getObjectByName(b.name),sbi=src.profile.bones.findIndex(x=>x.name===b.name);
   const offsets=motion?[.001*(sbi%3),-.001*(sbi%5),.001*(sbi%7)]:[0,0,0],ratios=motion?[1.01,1.02,1.03]:[1,1,1];
   localError=Math.max(localError,...n.position.toArray().map((v,j)=>Math.abs(v-b.position[j]-.37*offsets[j])),...n.scale.toArray().map((v,j)=>Math.abs(v-b.scale[j]*(1+.37*(ratios[j]-1)))));
   const delta=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,2,3).normalize(),motion?.04:0);const interpolatedDelta=new T.Quaternion().slerpQuaternions(new T.Quaternion(),delta,.37);
   const expected=new T.Quaternion().fromArray(b.quaternion).normalize().multiply(interpolatedDelta).normalize();
   rotationError=Math.max(rotationError,expected.angleTo(n.quaternion.clone().normalize()));
  }
  assert(localError<1e-6,JSON.stringify({localError,pair,motion}));assert(rotationError<1e-6,JSON.stringify({rotationError,pair,motion}));
  let maxShift=0;
  for(let m=0;m<dst.meshes.length;m++)for(let i=0;i<dst.rest[m].length;i++)maxShift=Math.max(maxShift,dst.rest[m][i].distanceTo(dst.meshes[m].getVertexPosition(i,new T.Vector3()).applyMatrix4(dst.meshes[m].matrixWorld)));
  if(motion)assert(maxShift>.01);else assert(maxShift<2e-6,JSON.stringify({maxShift}));
  const rt=adapt({clip:output,sourceProfileId:dst.profile.id,sourceProfile:dst.profile,targetProfile:src.profile});
  for(let i=0;i<input.tracks.length;i++)for(let k=0;k<input.tracks[i].values.length;k++)assert(Math.abs(input.tracks[i].values[k]-rt.tracks[i].values[k])<1e-6);
  assert.equal(JSON.stringify(input.toJSON()),beforeClip);
  pair[motion?'motion':'neutral']={time:.37,maxShiftM:maxShift,localError,rotationErrorRad:rotationError};
  mixer.stopAllAction();mixer.uncacheRoot(dst.scene);restore(dst);
 }
 result.pairs.push(pair);
}
const src=all[0],dst=all[1], first=src.profile.bones[0], standard=()=>new T.VectorKeyframeTrack(first.name+'.position',[0,1],[...first.position,...first.position]);
function reject(label,clip,changes={}) {assert.throws(()=>adapt({clip,sourceProfileId:src.profile.id,sourceProfile:src.profile,targetProfile:dst.profile,...changes}));result.negativeControls.push(label);}
const input=()=>new T.AnimationClip('reject',1,[standard()]);
reject('wrong source profile ID',input(),{sourceProfileId:'wrong'});reject('uncaptured profile',input(),{sourceProfile:{...src.profile}});
for(const path of [first.name+'.morphTargetInfluences',first.name+'.position[x]','unknown.position'])reject(path,new T.AnimationClip('bad',1,[new T.VectorKeyframeTrack(path,[0],[0,0,0])]));
reject('wrong typed channel',new T.AnimationClip('bad',1,[new T.NumberKeyframeTrack(first.name+'.position',[0],[1])]));
let c=input();c.blendMode=T.AdditiveAnimationBlendMode;reject('additive',c);c=input();c.tracks.push(c.tracks[0].clone());reject('duplicate channel',c);
c=input();c.tracks[0].setInterpolation(T.InterpolateSmooth);reject('cubic interpolation',c);c=input();c.tracks[0].createInterpolant=()=>null;reject('custom interpolation',c);
for(const [label,times,values] of [['duplicate times',[0,0],[0,0,0,0,0,0]],['nonfinite times',[0,NaN],[0,0,0,0,0,0]],['out of duration',[0,2],[0,0,0,0,0,0]],['malformed length',[0,1],[0,0,0]],['nonfinite values',[0],[0,NaN,0]]]){c=input();c.tracks[0].times=new Float32Array(times);c.tracks[0].values=new Float32Array(values);reject(label,c);}
reject('nonpositive scale',new T.AnimationClip('bad',1,[new T.VectorKeyframeTrack(first.name+'.scale',[0],[0,1,1])]));reject('nonunit quaternion',new T.AnimationClip('bad',1,[new T.QuaternionKeyframeTrack(first.name+'.quaternion',[0],[0,0,0,2])]));
for(const [label,mutate] of [['hierarchy',s=>s.add(s.getObjectByName('lowerarm_L'))],['joint axes',s=>s.getObjectByName('lowerarm_L').rotateX(.01)]]){const clone=dst.scene.clone(true);mutate(clone);reject(label,input(),{targetProfile:capture({id:'bad-'+label,root:clone})});}
fs.writeFileSync(out+'/adapter-independent.json',JSON.stringify(result,null,2)+'\n');
console.log('INDEPENDENT_ADAPTER_PASS',result.pairs.length,'pairs',result.pairs.map(x=>x.allVertexCount),'all-vertex samples each neutral/motion',result.negativeControls.length,'rejection controls');
