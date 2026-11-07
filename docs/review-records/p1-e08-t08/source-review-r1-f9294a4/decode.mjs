import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { collectLods,showLod,parseSpec,isHelper,nodeName,applyGameLook } from '/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13/packages/client/src/dev/review.js';
import { recolor,maskColors } from '/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13/packages/client/src/gameplay/modelLibrary.js';
import { gameLook } from '/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13/packages/shared/src/art/looks.ts';
import { BODY_PLANS,TEMPERAMENTS } from '/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13/packages/shared/src/data/mobs.ts';
const root='/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13/';
const read=p=>readFileSync(root+p), sha=b=>createHash('sha256').update(b).digest('hex');
const proof=JSON.parse(read('packages/tools/blender/e08t08/reports/source-contract.json'));
const expected=Object.fromEntries(BODY_PLANS.map(p=>{const roots=['0','1',...(TEMPERAMENTS.find(t=>t.id==='predator').bodyPlans.some(b=>b.plan===p.id)?['predator']:[])];return [p.id,roots.flatMap(r=>[`${p.id}_${r}`,...p.attacks.map(a=>`${p.id}_${r}_${a.id}`)])]}));
expected.outpost_drone=['outpost_drone'];expected.outpost_overseer=['outpost_overseer','outpost_overseer_dome','outpost_overseer_core'];
const summary={node:process.version,decoder:'client Engine.js Three bundled MeshoptDecoder',files:[],variants:0,lods:0,vertices:0,sourceSamples:0,maxMaskError:[0,0,0,0],maxLookError:0,nonExactMaskChannels:0,formats:{},controls:[]};
const point=new T.Vector3();const key=p=>p.map(x=>Math.round(x*1000)).join(',');
const meshes=nodes=>{const out=[];for(const n of nodes)n.traverse(o=>{if(o.isMesh&&!isHelper(o))out.push(o)});return out};
const near=(a,b,t=0.004)=>assert(a.every((v,k)=>Math.abs(v-b[k])<t),JSON.stringify({a,b,t}));
const textureMeta=[];
for(const f of proof.files){
 assert.equal(sha(read(f.source)),f.sha256);
 const bytes=read(`packages/client/public/models/${f.family}/${f.stem}.glb`);const js=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 assert(js.extensionsRequired.includes('EXT_meshopt_compression'));assert(js.extensionsRequired.includes('KHR_texture_basisu'));assert.equal(js.extensionsRequired.includes('KHR_mesh_quantization'),f.family==='constructs');assert.equal((js.animations||[]).length,0);
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 loader.register(parser=>({name:'KHR_texture_basisu',async loadTexture(i){
 const tex=parser.json.textures[i],im=parser.json.images[tex.extensions.KHR_texture_basisu.source];assert.equal(im.mimeType,'image/ktx2');
 const d=new DataView(await parser.getDependency('bufferView',im.bufferView));
 const w=d.getUint32(20,true),h=d.getUint32(24,true),mips=d.getUint32(40,true);assert.equal(w,2048);assert.equal(h,2048);assert.equal(mips,12);
 textureMeta.push({file:f.stem,index:i,w,h,mips});return new T.Texture({width:w,height:h});}}));
 await MeshoptDecoder.ready;const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');scene.updateMatrixWorld(true);
 const model=collectLods(scene);assert.equal(model.assets.length,1);assert.equal(model.assets[0].name,f.stem);assert.deepEqual(model.assets[0].variants.map(v=>v.name).sort(),expected[f.stem].toSorted());
 const file={stem:f.stem,sha256:sha(bytes),variants:[],formats:{},materials:js.materials.map(m=>m.name),worldTransformChanges:0};
 for(const m of js.meshes)for(const p of m.primitives)for(const [name,a] of Object.entries(p.attributes)){if(!['COLOR_0','_LIMB','_PIVOT','_GLOW'].includes(name))continue;const at=js.accessors[a];(file.formats[name]??=new Set()).add(JSON.stringify([at.componentType,!!at.normalized,at.type]));}
 for(const v of model.assets[0].variants){
 assert.deepEqual([...v.lods.keys()].sort(),[0,1,2,3]);const src=f.variants.find(x=>x.id===v.name);const counts=[],bounds=[];
 for(let lod=0;lod<4;lod++){
 const spec=parseSpec(`${f.family}/${f.stem}:${f.stem}/${v.name}`);assert.equal(spec.url,`/models/${f.family}/${f.stem}.glb`);assert.deepEqual(showLod(model,lod,spec),{[v.name]:lod});
 const actual=meshes(v.lods.get(lod)),visible=[];scene.traverseVisible(o=>{if(o.isMesh)visible.push(o)});assert.deepEqual(new Set(visible),new Set(actual));
 const box=new T.Box3(),sampleMap=new Map();let triangles=0,shoulder=-Infinity,glowing=0,n=0;const legHeights={};
 for(const o of actual){
 const g=o.geometry,a=g.attributes;box.expandByObject(o,true);triangles+=(g.index?.count??a.position.count)/3;n+=a.position.count;
 assert(!o.isSkinnedMesh);assert.equal((o.morphTargetInfluences||[]).length,0);
 if(f.family==='constructs'){for(const k of ['color','_limb','_pivot','_glow'])assert.equal(a[k],undefined);}else{
 for(const k of ['_limb','_pivot','_glow']){assert(a[k].array instanceof Float32Array);assert.equal(a[k].count,a.position.count);assert(!a[k].normalized)}
 assert(a.color.array instanceof Uint16Array&&a.color.normalized);assert.equal(a.color.itemSize,4);
 }
 for(let i=0;i<a.position.count;i++){
 const raw=point.fromBufferAttribute(a.position,i).toArray();const world=point.applyMatrix4(o.matrixWorld).toArray();assert(world.every(Number.isFinite));
 if(raw.some((x,k)=>Math.abs(x-world[k])>1e-6))file.worldTransformChanges++;
 if(f.family==='creatures'){
 const id=a._limb.getX(i),pv=[a._pivot.getX(i),a._pivot.getY(i),a._pivot.getZ(i)],gl=a._glow.getX(i),mask=[a.color.getX(i),a.color.getY(i),a.color.getZ(i),a.color.getW(i)];
 assert(Number.isInteger(id)&&id>=0&&id<=8);assert(gl===0||gl===1);glowing+=gl;
 assert(mask.every(x=>x>=0&&x<=1));assert(Math.abs(mask[0]+mask[1]+mask[2]-1)<=3*(.5/65535+1e-7));near(pv,src.joints[String(id)],1e-12);
 if(f.stem!=='flyer'&&id>0&&id<5){assert(pv[2]>0);if(lod===0)(legHeights[id]??=[]).push(world[1]/pv[2])}
 if(id===0)shoulder=Math.max(shoulder,world[1]);
 if(lod===0){const k=key(world),list=sampleMap.get(k)||[];list.push({world,pv,id,gl,mask,g,i});sampleMap.set(k,list)}
 }
 }
 if(lod===0){
 const look=gameLook(f.family,o.name);if(look){const pal=Object.fromEntries(['primary','secondary','accent'].map((k,i)=>[k,new T.Color(look.palette[i])]));
 const colored=recolor(o,pal,look);near(colored.boundingBox.min.toArray(),new T.Box3().setFromObject(o,true).min.toArray(),1e-5);
 const oracle=maskColors(g,pal,look);assert.deepEqual(colored.attributes.color.array,oracle.col);colored.dispose();}
 }
 }
 summary.vertices+=n;summary.lods++;counts.push(triangles);bounds.push([box.min.toArray(),box.max.toArray()]);
 if(f.family==='creatures')assert(glowing/n<.025);
 if(lod===0){
 assert(triangles>=15000&&triangles<=40000);assert.equal(triangles,src.triangles);const size=box.getSize(new T.Vector3()).toArray();assert(Math.max(...size)>=.2&&Math.max(...size)<=80);
 near(box.min.toArray(),[src.min[0],src.min[2],-src.max[1]]);near(box.max.toArray(),[src.max[0],src.max[2],-src.min[1]]);
 if(f.stem.startsWith('quad')){const [lo,hi]={quad_small:[.4,1.2],quad_grazer:[1.2,2.4],quad_heavy:[2.5,5]}[f.stem];assert(shoulder>=lo&&shoulder<=hi)}
 if(f.stem==='biped')assert(box.max.y>=1.6&&box.max.y<=2.6);if(f.stem==='flyer')assert(size[0]>=1&&size[0]<=6);if(f.stem==='outpost_drone')assert(Math.max(...size)>=1.5&&Math.max(...size)<=3);if(f.stem==='outpost_overseer')assert(Math.max(...size)>=23&&Math.max(...size)<=25);
 if(/_(0|1|predator)$/.test(v.name)&&f.stem!=='flyer')for(const hs of Object.values(legHeights)){assert(Math.abs(Math.min(...hs))<1e-6);assert(hs.filter(x=>x>=.38&&x<=.62).length>=72);assert(hs.filter(x=>x>=.1&&x<=.24).length>=48)}
 for(const s of src.samples){
 const list=(sampleMap.get(key(s.position))||[]).filter(x=>x.id===s.limb&&x.gl===s.glow&&x.world.every((v,k)=>Math.abs(v-s.position[k])<2e-5)&&x.pv.every((v,k)=>v===s.pivot[k]));assert(list.length,`no decoded world point ${v.name}`);
 list.sort((a,b)=>Math.max(...a.mask.map((v,k)=>Math.abs(v-s.mask[k])))-Math.max(...b.mask.map((v,k)=>Math.abs(v-s.mask[k]))));const found=list[0];
 found.mask.forEach((v,k)=>{const e=Math.abs(v-s.mask[k]);summary.maxMaskError[k]=Math.max(summary.maxMaskError[k],e);assert(e<=.5/65535+1e-7);if(e>0)summary.nonExactMaskChannels++});summary.sourceSamples++;
 const look=gameLook('creatures',v.name),pal=Object.fromEntries(['primary','secondary','accent'].map((k,i)=>[k,new T.Color(look.palette[i])]));
 const single=mask=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0],3));g.setAttribute('color',new T.Float32BufferAttribute(mask,4));return maskColors(g,pal,look).col};
 const exact=single(s.mask),decoded=single(found.mask);for(let c=0;c<3;c++)summary.maxLookError=Math.max(summary.maxLookError,Math.abs(exact[c]-decoded[c]));
 }
 }
 }
 assert(counts[1]<counts[0]&&counts[2]<counts[1]&&counts[3]<counts[2]&&counts[3]<counts[0]*.05);summary.variants++;file.variants.push({id:v.name,triangles:counts,bounds});
 }
 for(const m of f.markers){const obj=model.helpers.find(o=>nodeName(o)===m.name);assert(obj,m.name);if(m.type==='EMPTY'){assert(!obj.isMesh);near(obj.getWorldPosition(new T.Vector3()).toArray(),m.position)}else{assert.equal(obj.geometry.index.count/3,12);const b=new T.Box3().setFromObject(obj,true);near(b.min.toArray(),m.min);near(b.max.toArray(),m.max)}}
 assert(!model.helpers.some(o=>/^(Door|Interact|Socket_|HP_|Mount|Spin)/i.test(nodeName(o))));
 // Observe actual consumer behavior of a missing LOD: documented fallback, not rejection.
 const v=model.assets[0].variants[0],clone=scene.clone(),cv=collectLods(clone).assets[0].variants[0];for(const n of cv.lods.get(3))n.removeFromParent();const missing=collectLods(clone);assert.equal(showLod(missing,3,{variant:v.name})[v.name],2);summary.controls.push({file:f.stem,missingLOD3:'actual showLod chooses LOD2'});
 if(f.family==='creatures'){
 const first=meshes(v.lods.get(0))[0],look=gameLook(f.family,v.name),pal=Object.fromEntries(['primary','secondary','accent'].map((k,i)=>[k,new T.Color(look.palette[i])]));const expected=maskColors(first.geometry,pal,look).col;
 const g=first.geometry.clone();g.attributes.color.normalized=false;const wrong=maskColors(g,pal,look).col;assert(wrong.some((x,i)=>Math.abs(x-expected[i])>1));summary.controls.push({file:f.stem,normalizationRemoved:'actual maskColors output differs by >1'});
 const changed=applyGameLook(scene,f.family);assert(changed>=f.variants.length*4);assert.deepEqual(first.geometry.attributes.color.array,expected);assert.equal(first.material.roughness,.65);assert.equal(first.material.metalness,.05);
 }else{const mats=meshes(v.lods.get(0)).map(x=>x.material);assert.equal(applyGameLook(scene,f.family),0);assert.deepEqual(meshes(v.lods.get(0)).map(x=>x.material),mats)}
 for(const [k,vals]of Object.entries(file.formats))file.formats[k]=[...vals].map(JSON.parse);
 summary.files.push(file);console.log(f.stem,'PASS',file.variants.length,'variants');
}
assert.equal(summary.variants,38);assert.equal(summary.lods,152);assert(summary.nonExactMaskChannels>0);assert(summary.maxLookError<2e-5);summary.textureMetadata=textureMeta;
writeFileSync(new URL('./decoded-result.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({variants:summary.variants,lods:summary.lods,vertices:summary.vertices,sourceSamples:summary.sourceSamples,maxMaskError:summary.maxMaskError,maxLookError:summary.maxLookError,nonExactMaskChannels:summary.nonExactMaskChannels,controls:summary.controls.length}));
