import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decode,sha} from './decode.mjs';
import {worldAccessor,skinnedAccessor,multiply,transform} from './decode.mjs';
import {BVH,areaNormal,reconstruct,strata,triangleDistance2} from './geometry.mjs';
import {inversePoint,quantize14} from './provenance.mjs';
const require=createRequire(process.env.LARK_DEPENDENCIES ?? '/Users/andreyyurlov/Documents/dev/space/packages/tools/package.json');
const {Document}=require('@gltf-transform/core');
test('actual NodeIO accessor normalizes once, full ancestor chain includes decode once',()=>{
  const doc=new Document(),a=doc.createAccessor().setType('VEC3').setArray(new Int16Array([16384,8192,-32768])).setNormalized(true);
  const parent=doc.createNode().setTranslation([5,6,7]).setScale([2,3,4]);
  const child=doc.createNode().setTranslation([1,2,3]).setScale([.5,.25,.125]);parent.addChild(child);
  const world=multiply(parent.getMatrix(),child.getMatrix());
  assert.deepEqual(world,child.getWorldMatrix());
  const p=worldAccessor(a,world)[0];
  assert.ok(Math.abs(p[0]-(7+16384/32767))<1e-12);
  assert.ok(Math.abs(p[1]-(12+.75*8192/32767))<1e-12);
  assert.equal(p[2],18.5);
  assert.throws(()=>worldAccessor(a,world,child.getMatrix()),/second decode/);
  assert.notDeepEqual(transform(p,child.getMatrix()),p);
});
test('world cross products yield correct nonuniform area and winding',()=>{
  const m=[2,0,0,0,0,3,0,0,0,0,4,0,5,6,7,1];
  const r=areaNormal([[0,0,0],[1,0,0],[0,1,1]].map(p=>transform(p,m)));
  assert.equal(r.area,5);assert.ok(r.normal.every((x,i)=>Math.abs(x-[0,-.8,.6][i])<1e-12));
});
test('source provenance inverts shear/nonuniform world and uses effective quantizer precision',()=>{
  const m=[2,0,0,0,1,3,0,0,.2,.4,4,0,5,6,7,1],p=[.25,.5,.75];
  assert.ok(inversePoint(transform(p,m),m).every((x,i)=>Math.abs(x-p[i])<1e-12));
  assert.equal(quantize14(1),32767);assert.equal(quantize14(-1),-32767);assert.equal(quantize14(.5),16386);
  assert.notEqual(quantize14(.5),Math.round(.5*32767));
});
test('saved skin pose applies joint world and inverse bind once, without mesh node twice',()=>{
  const a=values=>({getCount:()=>1,getElement:()=>values});
  const joint=[1,0,0,0,0,1,0,0,0,0,1,0,10,0,0,1],bind=[2,0,0,0,0,3,0,0,0,0,4,0,-2,0,0,1];
  const p=skinnedAccessor(a([1,1,1]),[multiply(joint,bind)],[a([0,0,0,0])],[a([1,0,0,0])]);
  assert.deepEqual(p,[[10,3,4]]);
  assert.throws(()=>skinnedAccessor(a([1,1,1]),[joint],[a([0,0,0,0])],[a([.5,0,0,0])]),/Unnormalized/);
});
test('UV split within indexed component rejoins; distinct coincident panes stay separate',()=>{
  const p={vertices:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,0]],faces:[[0,1,2],[4,2,3]]};
  const r=reconstruct(p);assert.equal(r.exactDuplicatesRejoined,1);assert.equal(r.boundary.length,4);assert.equal(r.loops.length,1);
  const q={vertices:[...p.vertices.slice(0,4),...p.vertices.slice(0,4)],faces:[[0,1,2],[0,2,3],[4,5,6],[4,6,7]]};
  const s=reconstruct(q);assert.equal(s.exactDuplicatesRejoined,0);assert.equal(s.loops.length,2);assert.equal(s.ambiguities.length,4);
});
test('fully cut UV seam is reported ambiguous instead of joining separate panes',()=>{
  const r=reconstruct({vertices:[[0,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]],faces:[[0,1,2],[3,4,5]]});
  assert.equal(r.ambiguities.length,1);assert.equal(r.loops.length,2);
});
test('all-scene first hit detects unrelated nearer occluder and exact triangle identity',()=>{
  const rib={vertices:[[-2,-2,0],[2,-2,0],[0,2,0]],primitive:'rib',triangle:7};
  const seat={vertices:[[-2,-2,1],[2,-2,1],[0,2,1]],primitive:'seat',triangle:9};
  const bvh=new BVH([rib,seat]);const hit=bvh.ray([0,0,3],[0,0,-1]);
  assert.equal(hit.id,1);assert.equal(hit.distance,2);assert.equal(bvh.triangles[hit.id].triangle,9);
  assert.equal(new BVH([rib]).ray([0,0,3],[0,0,-1]).distance,3);
  assert.equal(bvh.nearest([0,0,2]).distance,1);
});
test('triangle nearest handles face, edge and degenerate cases',()=>{
  assert.equal(triangleDistance2([.2,.2,2],[[0,0,0],[1,0,0],[0,1,0]]),4);
  assert.equal(triangleDistance2([2,0,0],[[0,0,0],[1,0,0],[0,1,0]]),1);
  assert.equal(triangleDistance2([.5,1,0],[[0,0,0],[1,0,0],[1,0,0]]),1);
  const bvh=new BVH([{vertices:[[0,0,1],[1,0,1],[1,0,1]]},{vertices:[[0,0,0],[1,0,0],[0,1,0]]}]);
  assert.equal(bvh.nearest([.5,0,2]).distance,2,'zero-area triangles are not render surfaces');
});
test('3/12/48 deterministic equal-area triangular strata stay inside and cover centroid',()=>{
  for(const n of [3,12,48]){const s=strata(n);assert.equal(s.length,n);for(const p of s){assert.ok(p.every(x=>x>0));assert.ok(Math.abs(p.reduce((a,b)=>a+b)-1)<1e-12);}for(let k=0;k<3;k++)assert.ok(Math.abs(s.reduce((a,p)=>a+p[k],0)/n-1/3)<1e-12);}
});
test('real Meshopt binary round trip preserves normalized positions under ancestor/decode transforms',async()=>{
  const {NodeIO}=require('@gltf-transform/core'),{ALL_EXTENSIONS,EXTMeshoptCompression}=require('@gltf-transform/extensions'),{MeshoptEncoder}=require('meshoptimizer');
  await MeshoptEncoder.ready;
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(),mat=doc.createMaterial();
  const acc=(type,array,normalized=false)=>doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
  for(const variant of ['lark','lark_damaged','lark_husked'])for(let lod=0;lod<4;lod++){
    const root=doc.createNode(`${variant}_LOD${lod}`).setTranslation([5,6,7]).setScale([2,3,4]);
    const mesh=doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Int16Array([0,0,0,32767,0,0,0,32767,0]),true)).setAttribute('NORMAL',acc('VEC3',new Float32Array([0,0,1,0,0,1,0,0,1]))).setAttribute('TEXCOORD_0',acc('VEC2',new Float32Array([0,0,1,0,0,1]))).setIndices(acc('SCALAR',new Uint16Array([0,1,2]))).setMaterial(mat));
    root.addChild(doc.createNode('Pane').setMesh(mesh).setTranslation([1,2,3]).setScale([.5,.25,.125]));scene.addChild(root);
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  const bytes=await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder}).writeBinary(doc);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lark-analytical-')),file=path.join(dir,'fixture.glb');fs.writeFileSync(file,bytes);
  try {
    const decoded=await decode(file,process.env.LARK_DEPENDENCIES??'/Users/andreyyurlov/Documents/dev/space/packages/tools/package.json',sha(bytes));
    assert.ok(decoded.receipt.extensions.includes('EXT_meshopt_compression'));
    assert.deepEqual(decoded.scenes.get('lark_LOD0').triangles[0].vertices,[[7,12,19],[8,12,19],[7,12.75,19]]);
  } finally {fs.rmSync(dir,{recursive:true});}
});
