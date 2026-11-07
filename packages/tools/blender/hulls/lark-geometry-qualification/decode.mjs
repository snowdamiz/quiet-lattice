import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';

export const PIN = '7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78';
export const sha = data => createHash('sha256').update(data).digest('hex');
export const hashJSON = data => sha(JSON.stringify(data));
export const readJSON = file => JSON.parse(file.endsWith('.gz')?gunzipSync(fs.readFileSync(file)):fs.readFileSync(file,'utf8'));
export function transform(p, m) {
  return [0,1,2].map(r => m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);
}
export function multiply(a,b) {
  return Array.from({length:16},(_,i)=>[0,1,2,3].reduce((s,k)=>s+a[k*4+i%4]*b[Math.floor(i/4)*4+k],0));
}
export function worldAccessor(accessor, world, extraDecode) {
  if (extraDecode !== undefined) throw Error('NodeIO path already includes decode in node matrices; second decode forbidden');
  return Array.from({length:accessor.getCount()},(_,i)=>transform(accessor.getElement(i,[]),world));
}
export function skinnedAccessor(accessor, jointMatrices, jointSets, weightSets) {
  return Array.from({length:accessor.getCount()},(_,i)=>{
    const p=accessor.getElement(i,[]),out=[0,0,0];let total=0;
    for(let s=0;s<jointSets.length;s++) {
      const joints=jointSets[s].getElement(i,[]),weights=weightSets[s].getElement(i,[]);
      for(let k=0;k<weights.length;k++) {
        if(!Number.isInteger(joints[k])||!jointMatrices[joints[k]]||weights[k]<0||!Number.isFinite(weights[k]))throw Error('Invalid skin influence');
        const q=transform(p,jointMatrices[joints[k]]);total+=weights[k];
        for(let r=0;r<3;r++)out[r]+=q[r]*weights[k];
      }
    }
    if(Math.abs(total-1)>.0001)throw Error(`Unnormalized skin weights ${total}`);
    return out;
  });
}
export async function decode(file, dependencies, expected=PIN) {
  const bytes=fs.readFileSync(file), digest=sha(bytes);
  if(digest!==expected) throw Error(`GLB identity mismatch: ${digest}`);
  if(bytes.readUInt32LE(0)!==0x46546c67 || bytes.readUInt32LE(4)!==2 || bytes.readUInt32LE(8)!==bytes.length) throw Error('Invalid GLB');
  const raw=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  if(raw.buffers?.some(b=>b.uri) || raw.images?.some(i=>i.uri)) throw Error('Require self-contained GLB');
  const require=createRequire(dependencies);
  const {NodeIO}=require('@gltf-transform/core');
  const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
  const {MeshoptDecoder}=require('meshoptimizer');
  await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  const doc=await io.readBinary(bytes), root=doc.getRoot(), nodes=root.listNodes(), materials=root.listMaterials();
  const scenes=new Map(), objects=[], excluded=[];
  for(const [nodeIndex,node] of nodes.entries()) {
    const mesh=node.getMesh(); if(!mesh) continue;
    if(node.getWeights().length) throw Error('Morph evaluation required');
    let chain=[], world=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    for(let n=node;n;n=n.getParentNode()) chain.push(n);
    for(const n of [...chain].reverse()) world=multiply(world,n.getMatrix());
    if(world.some((v,i)=>Math.abs(v-node.getWorldMatrix()[i])>1e-10)) throw Error('Ancestor matrix disagreement');
    const lod=chain.map(n=>n.getName()).find(n=>/^lark(?:_damaged|_husked)?_LOD[0-3]$/.test(n));
    if(!lod) {
      if(!node.getName().startsWith('COL_')) throw Error(`Unassigned render mesh ${node.getName()}`);
      excluded.push({node:nodeIndex,name:node.getName(),reason:'COL collision mesh outside LOD'}); continue;
    }
    const scene=scenes.get(lod)??{name:lod,primitives:[],triangles:[]}; scenes.set(lod,scene);
    for(const [primitiveIndex,p] of mesh.listPrimitives().entries()) {
      if(p.getMode()!==4 || p.listTargets().length) throw Error('Only static triangle primitives admitted');
      for(const semantic of ['POSITION','NORMAL','TEXCOORD_0']) {
        const a=p.getAttribute(semantic); if(!a) throw Error(`Missing ${semantic} ${node.getName()}`);
        for(let i=0;i<a.getCount();i++) if(a.getElement(i,[]).some(v=>!Number.isFinite(v))) throw Error('Nonfinite accessor');
      }
      const pos=p.getAttribute('POSITION');let vertices,skinReceipt=null;
      if(node.getSkin()) {
        const skin=node.getSkin(),joints=skin.listJoints(),ibm=skin.getInverseBindMatrices();
        const matrices=joints.map((j,i)=>multiply(j.getWorldMatrix(),ibm?ibm.getElement(i,[]):[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
        const js=[],ws=[];
        for(let s=0;p.getAttribute(`JOINTS_${s}`);s++){js.push(p.getAttribute(`JOINTS_${s}`));ws.push(p.getAttribute(`WEIGHTS_${s}`));}
        if(!js.length||ws.some(w=>!w))throw Error('Missing skin influences');
        vertices=skinnedAccessor(pos,matrices,js,ws);
        skinReceipt={mode:'saved rest pose; sum(weight * jointWorld * inverseBind * normalized POSITION); nodeWorld cancels and is not applied again',joints:joints.map((j,i)=>({node:nodes.indexOf(j),name:j.getName(),matrix:matrices[i]})),influenceHash:hashJSON(js.map((j,i)=>[Array.from(j.getArray()),Array.from(ws[i].getArray())]))};
      } else vertices=worldAccessor(pos,world);
      const indices=p.getIndices()?Array.from(p.getIndices().getArray()):vertices.map((_,i)=>i);
      if(indices.length%3 || indices.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length)) throw Error('Invalid indices');
      const materialIndex=materials.indexOf(p.getMaterial());
      const id=`n${nodeIndex}/p${primitiveIndex}`;
      const faces=Array.from({length:indices.length/3},(_,i)=>indices.slice(i*3,i*3+3));
      const topologyHash=hashJSON({nodeIndex,primitiveIndex,materialIndex,indices,positions:Array.from(pos.getArray()),normalized:pos.getNormalized(),componentType:pos.getComponentType(),world,skinReceipt});
      const linearColumns=[0,1,2].map(c=>Math.hypot(world[c*4],world[c*4+1],world[c*4+2]));
      const divisor=pos.getNormalized()?({5120:127,5121:255,5122:32767,5123:65535}[pos.getComponentType()]):1;
      const step=pos.getComponentType()===5126||skinReceipt?null:linearColumns.map(s=>s/divisor);
      const prim={id,nodeIndex,primitiveIndex,name:node.getName(),materialIndex,material:p.getMaterial()?.getName(),alphaMode:p.getMaterial()?.getAlphaMode(),world,skin:skinReceipt,chain:chain.map(n=>({node:nodes.indexOf(n),name:n.getName(),matrix:n.getMatrix()})),vertices,faces,topologyHash,accessor:{componentType:pos.getComponentType(),normalized:pos.getNormalized(),count:pos.getCount(),worldLatticeStep:step,halfCellDiagonal:step?Math.hypot(...step)/2:null},uv:Array.from({length:pos.getCount()},(_,i)=>p.getAttribute('TEXCOORD_0').getElement(i,[])),triangleStart:scene.triangles.length};
      scene.primitives.push(prim); objects.push({...prim,vertices:undefined,faces:undefined,uv:undefined,triangleCount:faces.length});
      for(const [triangle,face] of faces.entries()) scene.triangles.push({vertices:face.map(i=>vertices[i]),primitive:id,triangle});
    }
  }
  if(scenes.size!==12) throw Error(`Expected 12 LOD scenes, got ${scenes.size}`);
  return {scenes,receipt:{sha256:digest,bytes:bytes.length,extensions:raw.extensionsUsed,decode:'MeshoptDecoder -> NodeIO Accessor.getElement (normalizes once) -> full ancestor world matrix once; no additional decode matrix',dependencies:{core:require.resolve('@gltf-transform/core'),extensions:require.resolve('@gltf-transform/extensions'),meshoptimizer:require.resolve('meshoptimizer')},objects,excluded,totals:Object.fromEntries([...scenes].map(([k,s])=>[k,s.triangles.length]))}};
}
