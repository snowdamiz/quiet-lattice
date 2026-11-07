'use strict';
// Prepared only: actual compressed-export execution requires parent release.
// Derived from the byte-pinned independent attempt3; provenance.json identifies it.
if (process.argv[2] !== '--parent-released-export-decode') {
 throw Error('HOLD: parent release is required before loading mesh codecs');
}
const {createRequire} = require('node:module');
const {readFileSync,writeFileSync,statSync} = require('node:fs');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../../../..');
const OUT = path.resolve(process.argv[4]);
assert(OUT.startsWith(path.join(__dirname, 'runs') + path.sep));
const pins = JSON.parse(readFileSync(process.argv[3]));
const candidate = path.relative(ROOT,__dirname).split(path.sep).join('/');
assert([
 ['assets/blend/hulls/kestrel.blend','packages/client/public/models/hulls/kestrel.glb'],
 [candidate+'/candidate/source/hulls/kestrel.blend',candidate+'/candidate/models/hulls/kestrel.glb']
].some(([s,e]) => pins.source.path === s && pins.export.path === e),'unowned input paths');
const GLB = path.join(ROOT, pins.export.path);
const SOURCE = path.join(ROOT, pins.source.path);
assert(pins.roots.length && new Set(pins.roots).size === pins.roots.length);
assert(pins.roots.every(n => /^kestrel(?:_damaged|_husked)?(?:_compact|_working)?_LOD[0-3]$/.test(n)));
assert(statSync(GLB).size <= 128 * 1024 ** 2);
assert(statSync(SOURCE).size <= 512 * 1024 ** 2);
const hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(hash(readFileSync(SOURCE)), pins.source.sha256);
const installed = createRequire(path.join(ROOT, 'packages/tools/package.json'));
const {NodeIO} = installed('@gltf-transform/core');
const {ALL_EXTENSIONS} = installed('@gltf-transform/extensions');
const {MeshoptDecoder} = installed('meshoptimizer');
const {point,texPoint,exactArea,selectedCoord,near,summary,aggregateBySlot} = require('./density_math.cjs');
const save = (n,x) => writeFileSync(path.join(OUT,n),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
async function main(){
 const bytes=readFileSync(GLB);assert.equal(hash(bytes),pins.export.sha256);assert.equal(bytes.length,pins.export.bytes);
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const jl=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+jl));assert.equal(bytes.readUInt32LE(16),0x4e4f534a);assert.equal(bytes.readUInt32LE(24+jl),0x004e4942);const bin=bytes.subarray(28+jl,28+jl+bytes.readUInt32LE(20+jl));
 assert(!j.skins?.length);assert(!j.animations?.length,'animated density requires declared pose');
 assert(j.buffers.every(b => !b.uri), 'external buffers forbidden');
 assert(j.images.every(im => Number.isInteger(im.bufferView) && !im.uri), 'embedded maps required');
 assert(j.accessors.every(a => !a.sparse), 'sparse accessors unsupported');
 const images=j.images.map((im,i)=>{const v=j.bufferViews[im.bufferView];assert.equal(v.buffer,0);assert(!v.extensions?.EXT_meshopt_compression);const b=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);assert.equal(b.subarray(0,12).toString('hex'),'ab4b5458203230bb0d0a1a0a');assert(b.length>=80 && b.readUInt32LE(20)>0 && b.readUInt32LE(24)>0 && b.readUInt32LE(20)<=16384 && b.readUInt32LE(24)<=16384,'invalid KTX2 dimensions');return {index:i,name:im.name,bufferView:im.bufferView,width:b.readUInt32LE(20),height:b.readUInt32LE(24),levels:b.readUInt32LE(40),bytes:b.length,sha256:hash(b)};});
 function maps(m){const found=[];function visit(o,trail=[]){for(const [k,v]of Object.entries(o||{})){if(k.endsWith('Texture')&&v&&Number.isInteger(v.index)){const t=j.textures[v.index],im=t.extensions?.KHR_texture_basisu?.source??t.source;assert(Number.isInteger(im));found.push({slot:[...trail,k].join('.'),texture:v.index,image:im,texCoord:selectedCoord(v),declaredTexCoord:v.texCoord??0,transform:v.extensions?.KHR_texture_transform??{},width:images[im].width,height:images[im].height});}else if(v&&typeof v==='object')visit(v,[...trail,k]);}}visit(m);return found;}
 await MeshoptDecoder.ready;
 // The installed NodeIO registration/read route and normalized getElement/world-matrix APIs match the proven Lark audit.
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
 const document=await io.readBinary(bytes),nodes=document.getRoot().listNodes(),materials=document.getRoot().listMaterials();
 assert.equal(nodes.length,j.nodes.length);nodes.forEach((n,i)=>assert.equal(n.getName(),j.nodes[i].name||''));assert.equal(materials.length,j.materials.length);
 const parents=new Map();j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>{assert(!parents.has(c));parents.set(c,i);}));
 function chain(i){const out=[];for(let x=i;x!==undefined;x=parents.get(x))out.unshift({index:x,name:j.nodes[x].name||''});return out;}
 const reachable=new Set();function visit(i){reachable.add(i);for(const c of j.nodes[i].children||[])visit(c);}for(const i of j.scenes[j.scene??0].nodes)visit(i);
 const roots=new Set(pins.roots);
 for(const root of roots)assert.equal([...reachable].filter(i => j.nodes[i].name === root).length,1,'missing/duplicate root '+root);
 const groups=new Map(),primitiveRows=[],excluded=[],accessorChecks=[],geometrySources=[];
 const viewCache=new Map();
 // Same decodeGltfBuffer primitive as prior Kestrel/Swift; no meshopt integer reinterpretation.
 function rawView(i){if(viewCache.has(i))return viewCache.get(i);const v=j.bufferViews[i],e=v.extensions?.EXT_meshopt_compression;let b;if(e){assert.equal(e.buffer,0);b=new Uint8Array(e.count*e.byteStride);MeshoptDecoder.decodeGltfBuffer(b,e.count,e.byteStride,bin.subarray(e.byteOffset||0,(e.byteOffset||0)+e.byteLength),e.mode,e.filter||'NONE');}else{assert.equal(v.buffer,0);b=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}viewCache.set(i,b);return b;}
 const cw={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},nc={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
 const getter={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};
 function rawElement(ai,i){const a=j.accessors[ai],b=rawView(a.bufferView),v=j.bufferViews[a.bufferView];assert(!a.sparse);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),stride=v.byteStride||v.extensions?.EXT_meshopt_compression?.byteStride||nc[a.type]*cw[a.componentType];const raw=[],normalized=[];for(let c=0;c<nc[a.type];c++){const x=dv[getter[a.componentType]]((a.byteOffset||0)+i*stride+c*cw[a.componentType],true);raw.push(x);let n=x;if(a.normalized){if(a.componentType===5120)n=Math.max(x/127,-1);else if(a.componentType===5122)n=Math.max(x/32767,-1);else if(a.componentType===5121)n=x/255;else if(a.componentType===5123)n=x/65535;else throw Error('unsupported normalization');}normalized.push(n);}return {raw,normalized};}
 const checked=new Set();
 for(let ni=0;ni<nodes.length;ni++){
  const node=nodes[ni],jn=j.nodes[ni];if(jn.mesh===undefined||!reachable.has(ni))continue;const ancestors=chain(ni),names=ancestors.map(x=>x.name),rootName=names.find(x=>roots.has(x));
  const aux=names.some(x=>/^(COL|REF)[_\b]/.test(x));
  if(aux){excluded.push({node:ni,name:node.getName(),path:names.join('/'),reason:'COL/REF auxiliary hierarchy, not a mapped render surface'});continue;}
  if(!rootName)continue;
  const mw=node.getWorldMatrix(),prims=node.getMesh().listPrimitives(),rawprims=j.meshes[jn.mesh].primitives;assert.equal(prims.length,rawprims.length);
  for(let pi=0;pi<prims.length;pi++){
   const p=prims[pi],rp=rawprims[pi],mi=rp.material,m=j.materials[mi],mapset=maps(m),location={variant:rootName,node:ni,nodeName:node.getName(),path:names.join('/'),mesh:jn.mesh,primitive:pi,material:mi,materialName:m?.name};
   if(!mapset.length){excluded.push({...location,reason:'untextured constant/emissive material; texture density undefined',triangles:(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3});continue;}
   assert.equal(p.getMaterial(),materials[mi]);assert.equal(p.getMode(),4);assert(!rp.targets?.length,'morph target needs pose');
   const pos=p.getAttribute('POSITION'),index=p.getIndices(),count=index?.getCount()??pos.getCount();assert.equal(count%3,0);
   for(const [sem,ai]of Object.entries(rp.attributes).filter(([s])=>s==='POSITION'||s.startsWith('TEXCOORD_'))){const a=p.getAttribute(sem);assert.equal(a.getComponentType(),j.accessors[ai].componentType);assert.equal(a.getNormalized(),!!j.accessors[ai].normalized);if(!checked.has(ai)){const samples=[0,Math.floor(a.getCount()/2),a.getCount()-1].map(i=>{const raw=rawElement(ai,i),actual=a.getElement(i,[]);actual.forEach((v,c)=>near(v,raw.normalized[c],`accessor ${ai}/${i}/${c}`));return {index:i,...raw,nodeIO:actual};});accessorChecks.push({accessor:ai,semantic:sem,componentType:a.getComponentType(),normalized:a.getNormalized(),count:a.getCount(),samples});checked.add(ai);}}
   const equivalences=new Map();for(const mp of mapset){const key=JSON.stringify([mp.texCoord,mp.transform,mp.width,mp.height]);if(!equivalences.has(key))equivalences.set(key,[]);equivalences.get(key).push(mp);}
   for(const eq of equivalences.values()){
    const mp=eq[0],uv=p.getAttribute('TEXCOORD_'+mp.texCoord);assert(uv,'missing selected texCoord');
    const samples=[],degenerateWorld=[],degenerateUV=[];let awAll=0,uvAll=0;const wmin=[Infinity,Infinity,Infinity],wmax=[-Infinity,-Infinity,-Infinity],umin=[Infinity,Infinity],umax=[-Infinity,-Infinity];
    for(let t=0;t<count;t+=3){const ids=[0,1,2].map(k=>index?index.getScalar(t+k):t+k);const w=ids.map(i=>point(mw,pos.getElement(i,[]))),u0=ids.map(i=>uv.getElement(i,[])),u=u0.map(v=>texPoint(v,mp.transform)),exact=exactArea(pos,uv,ids,mw,mp.transform),aw=exact.worldArea,au=exact.uvArea,rawu=exact.rawUVArea;assert([aw,au,rawu].every(Number.isFinite));awAll+=aw;uvAll+=au;
     for(const v of w)for(let a=0;a<3;a++){wmin[a]=Math.min(wmin[a],v[a]);wmax[a]=Math.max(wmax[a],v[a]);}for(const v of u)for(let a=0;a<2;a++){umin[a]=Math.min(umin[a],v[a]);umax[a]=Math.max(umax[a],v[a]);}
     if(aw===0){degenerateWorld.push({triangle:t/3,uvArea:au});continue;}if(au===0)degenerateUV.push(t/3);const px=au*mp.width*mp.height;const rho=Math.sqrt(px/aw);samples.push([rho,aw,au,px,rawu]);
    }
    const gkey=JSON.stringify([rootName,mi,mp.texCoord,mp.transform,mp.width,mp.height]);if(!groups.has(gkey))groups.set(gkey,{variant:rootName,material:mi,materialName:m.name,maps:eq,samples:[],locations:[]});const g=groups.get(gkey);for(const s of samples)g.samples.push(s);g.locations.push({...location,worldMatrix:mw,accessors:rp.attributes,indices:rp.indices});
    primitiveRows.push({...location,maps:eq,worldMatrix:mw,accessors:rp.attributes,indices:rp.indices,totalTriangles:count/3,degenerateWorld,degenerateUVCount:degenerateUV.length,degenerateUVTriangleIndices:degenerateUV,worldAreaAll:awAll,uvAreaAll:uvAll,worldBounds:[wmin,wmax],uvBounds:[umin,umax],stats:summary(samples)});
   }
   geometrySources.push(location);
  }
 }
 const stats=[...groups.values()].map(({samples,...rest})=>({...rest,stats:summary(samples)}));
 const aggregate=aggregateBySlot([...groups.values()],[...roots]);
 assert(primitiveRows.length > 0, 'no mapped render surfaces');
 assert.equal(hash(readFileSync(SOURCE)),pins.source.sha256,'source changed during read-only measure');
 assert.equal(hash(readFileSync(GLB)),pins.export.sha256,'export changed during read-only measure');
 const modules=Object.keys(require.cache).filter(p=>p.includes('/node_modules/')).map(p=>({path:p,sha256:hash(readFileSync(p))}));
 const dependencies=['@gltf-transform/core','@gltf-transform/extensions','meshoptimizer'].map(n=>{const main=installed.resolve(n);let d=path.dirname(main);while(!require('node:fs').existsSync(path.join(d,'package.json')))d=path.dirname(d);const pkg=JSON.parse(readFileSync(path.join(d,'package.json')));return {name:n,version:pkg.version,entry:main,sha256:hash(readFileSync(main))};});
 const output={status:'MEASURED',scope:'actual export only, explicit pinned roots, static exported pose; no source density or visual verdict',sourceDensity:'NOT MEASURED',roots:[...roots],glb:GLB,sha256:hash(bytes),bytes:bytes.length,dependencies,modules,images,scene:j.scene??0,extensionsUsed:j.extensionsUsed,accessorChecks,primitiveRows,byMaterial:stats,aggregate,excluded,semantics:{density:'sqrt(width*height*abs(transformed UV triangle area)/world triangle area)',areaEquivalent:'sqrt(sum pixel area/sum world area); world-area-weighted RMS triangle density',weightedMean:'sum(world area*triangle density)/sum(world area)',weightedPercentiles:'inverse cumulative world area; triangle densities sorted ascending',triangleCountPercentiles:'floor((n-1)*p) rank, no interpolation',aggregation:'each texture slot separately; different bindings never double-counted in one aggregate',areas:'sum absolute triangle areas, including layered surfaces and UV overlaps; not atlas union or occupied unique texels',degenerate:'world area exactly zero excluded and explicitly listed; zero UV area retained as zero density. Areas use exact integer-domain cross products/determinants of signed-clamped raw normalized attributes followed by the normalization divisor and world linear cofactor. This avoids false nonzero areas from subtracting translated float positions. No epsilon filter is used.',distribution:'descriptive bins only, no new pass/fail threshold',doubleSided:'physical geometry area once; material doubleSided does not duplicate physical surface area'},resources:process.resourceUsage()};
 save('density.json',output);
 console.log(JSON.stringify({status:output.status,sha256:output.sha256,dependencies,groups:stats.map(x=>({variant:x.variant,material:x.materialName,triangles:x.stats.triangles,worldArea:x.stats.worldAreaM2,uvArea:x.stats.transformedUVAreaSum,areaEquivalent:x.stats.areaEquivalentDensity,weightedMean:x.stats.worldAreaWeightedMeanDensity,min:x.stats.min,p10:x.stats.worldAreaWeightedPercentiles.p10,median:x.stats.worldAreaWeightedPercentiles.p50,p90:x.stats.worldAreaWeightedPercentiles.p90,max:x.stats.max})),aggregate,resources:output.resources},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
