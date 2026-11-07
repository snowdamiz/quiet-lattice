'use strict';
const {createRequire}=require('node:module');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const installed=createRequire('/Users/andreyyurlov/Documents/dev/space/packages/tools/package.json');
const {NodeIO,Document}=installed('@gltf-transform/core');
const {ALL_EXTENSIONS}=installed('@gltf-transform/extensions');
const {MeshoptDecoder}=installed('meshoptimizer');
const ROOT='/Users/andreyyurlov/.t3/worktrees/space/t3-b4a2c118';
const OUT=__dirname;
const GLB=ROOT+'/packages/client/public/models/hulls/kestrel.glb';
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(n,x)=>writeFileSync(path.join(OUT,n),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function point(m,p){return [0,1,2].map(r=>m[r]*p[0]+m[r+4]*p[1]+m[r+8]*p[2]+m[r+12]);}
function area3(a,b,c){const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
function area2(a,b,c){return Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
function texPoint(p,t={}){const [sx,sy]=t.scale||[1,1],[ox,oy]=t.offset||[0,0],r=t.rotation||0,c=Math.cos(r),s=Math.sin(r);return [ox+c*sx*p[0]-s*sy*p[1],oy+s*sx*p[0]+c*sy*p[1]];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function lattice(a,i){const ar=a.getArray(),n=a.getElementSize(),raw=Array.from(ar.subarray(i*n,(i+1)*n));let divisor=1;if(a.getNormalized()){const ct=a.getComponentType();divisor=({5120:127,5121:255,5122:32767,5123:65535})[ct];assert(divisor);if(ct===5120||ct===5122)for(let k=0;k<raw.length;k++)raw[k]=Math.max(raw[k],-divisor);}return {raw,divisor};}
function exactArea(pos,uv,ids,m,tx={}){
 const p=ids.map(i=>lattice(pos,i)),u=ids.map(i=>lattice(uv,i));
 const e=p[1].raw.map((x,i)=>x-p[0].raw[i]),f=p[2].raw.map((x,i)=>x-p[0].raw[i]),c=cross(e,f);
 const cols=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
 const cof=[cross(cols[1],cols[2]),cross(cols[2],cols[0]),cross(cols[0],cols[1])];
 const wc=[0,1,2].map(r=>(cof[0][r]*c[0]+cof[1][r]*c[1]+cof[2][r]*c[2])/(p[0].divisor*p[0].divisor));
 const rawu=area2(...u.map(x=>x.raw))/(u[0].divisor*u[0].divisor),sc=tx.scale||[1,1];
 return {worldArea:Math.hypot(...wc)/2,rawUVArea:rawu,uvArea:rawu*Math.abs(sc[0]*sc[1])};
}
function selectedCoord(info){return info.extensions?.KHR_texture_transform?.texCoord??info.texCoord??0;}
function near(actual,expected,label){assert(Math.abs(actual-expected)<=1e-10*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);}
function oracle(){
 const d=new Document(),b=d.createBuffer(),cases=[];
 const ps=d.createAccessor().setType('VEC3').setArray(new Int16Array([0,0,0,32767,0,0,0,32767,0])).setNormalized(true).setBuffer(b);
 const uv=d.createAccessor().setType('VEC2').setArray(new Uint16Array([0,0,65535,0,0,65535])).setNormalized(true).setBuffer(b);
 const p=[0,1,2].map(i=>ps.getElement(i,[])),u=[0,1,2].map(i=>uv.getElement(i,[]));
 function test(name,m,tx,W,H,expectedAw,expectedUv,expectedD){const w=p.map(v=>point(m,v)),t=u.map(v=>texPoint(v,tx)),aw=area3(...w),au=area2(...t),rho=Math.sqrt(W*H*au/aw);near(aw,expectedAw,name+' world area');near(au,expectedUv,name+' UV area');near(rho,expectedD,name+' density');const exact=exactArea(ps,uv,[0,1,2],m,tx);near(exact.worldArea,expectedAw,name+' exact world area');near(exact.uvArea,expectedUv,name+' exact UV area');cases.push({name,worldArea:aw,uvArea:au,width:W,height:H,density:rho,expectedDensity:expectedD});}
 test('normalized int16 positions + uint16 UVs unit triangle',I,{},512,512,0.5,0.5,512);
 const parent=d.createNode().setScale([2,2,2]).setTranslation([9,4,-3]),child=d.createNode();parent.addChild(child);
 test('inherited uniform 2x scale and translation',child.getWorldMatrix(),{},512,512,2,0.5,256);
 // Analytic shear maps (x,y,z) -> (2x+y,3y,z); XY triangle area is determinant(2,1;0,3)/2 = 3.
 test('full affine shear, nonuniform scale, nonsquare map',[2,0,0,0,1,3,0,0,0,0,1,0,7,8,9,1],{},1024,512,3,0.5,Math.sqrt(1024*512/6));
 const p2=d.createNode().setScale([2,3,1]);const c2=d.createNode().setRotation([0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)]);p2.addChild(c2);
 const m=c2.getWorldMatrix();near(m[0],Math.SQRT2,'composed m0');near(m[1],3/Math.SQRT2,'composed m1');near(m[4],-Math.SQRT2,'composed m4');near(m[5],3/Math.SQRT2,'composed m5');
 test('NodeIO parent scale times child rotation (nonorthogonal world columns)',m,{},512,512,3,0.5,512/Math.sqrt(6));
 test('KHR texture scale + rotation + offset',I,{scale:[2,0.5],rotation:Math.PI/2,offset:[3,4]},1024,512,0.5,0.5,Math.sqrt(1024*512));
 const q=texPoint([1,0],{scale:[2,0.5],rotation:Math.PI/2,offset:[3,4]});near(q[0],3,'transform x');near(q[1],6,'transform y');
 test('KHR scale determinant is applied',I,{scale:[0.5,0.5]},512,512,0.5,0.125,256);
 const norms=[];
 for(const [T,vals,expect]of [[Int8Array,[-128,-127,0,127],[-1,-1,0,1]],[Uint8Array,[0,255],[0,1]],[Int16Array,[-32768,-32767,0,32767],[-1,-1,0,1]],[Uint16Array,[0,65535],[0,1]]]){
  const a=d.createAccessor().setType('SCALAR').setArray(new T(vals)).setNormalized(true).setBuffer(b);const actual=vals.map((_,i)=>a.getElement(i,[])[0]);actual.forEach((x,i)=>near(x,expect[i],T.name));norms.push({type:T.name,raw:vals,actual,expected:expect});
 }
 assert.equal(selectedCoord({texCoord:0,extensions:{KHR_texture_transform:{texCoord:1}}}),1);
 assert.equal(selectedCoord({texCoord:1}),1);assert.equal(selectedCoord({}),0);
 const collinear=d.createAccessor().setType('VEC3').setArray(new Int16Array([11,21,31,12,23,34,13,25,37])).setNormalized(true).setBuffer(b);const deg=exactArea(collinear,uv,[0,1,2],[7.390239953994751,0,0,0,0,7.390239953994751,0,0,0,0,7.390239953994751,0,-0.0000002384,0.580390691,0.290240049,1]);assert.equal(deg.worldArea,0);return {status:'PASS',cases,normalizationCases:norms,texCoordOverride:'PASS',quantizedCollinearTriangle:deg};
}
function summary(samples){
 const s=samples.slice().sort((a,b)=>a[0]-b[0]);let world=0,uv=0,rawuv=0,pixels=0,rhoSum=0;
 for(const x of s){world+=x[1];uv+=x[2];pixels+=x[3];rhoSum+=x[0]*x[1];rawuv+=x[4];}
 const probs=[0.01,0.05,0.1,0.25,0.5,0.75,0.9,0.95,0.99];let cum=0,qi=0;const weighted={};
 for(const x of s){cum+=x[1];while(qi<probs.length&&cum>=probs[qi]*world){weighted['p'+(100*probs[qi])]=x[0];qi++;}}
 const countP=Object.fromEntries(probs.map(p=>['p'+100*p,s[Math.floor((s.length-1)*p)]?.[0]??null]));
 const edges=[0,32,64,128,256,512,1024,Infinity],dist=edges.slice(0,-1).map((lo,i)=>({lowerInclusive:lo,upperExclusive:Number.isFinite(edges[i+1])?edges[i+1]:null,triangles:0,worldAreaM2:0}));
 for(const x of s){const i=edges.findIndex((lo,i)=>i<edges.length-1&&x[0]>=lo&&x[0]<edges[i+1]);assert(i>=0);dist[i].triangles++;dist[i].worldAreaM2+=x[1];}
 for(const x of dist){x.worldAreaPercent=100*x.worldAreaM2/world;x.trianglePercent=100*x.triangles/s.length;}
 return {triangles:s.length,worldAreaM2:world,rawUVAreaSum:rawuv,transformedUVAreaSum:uv,pixelAreaSum:pixels,areaEquivalentDensity:Math.sqrt(pixels/world),worldAreaWeightedMeanDensity:rhoSum/world,min:s[0]?.[0]??null,max:s.at(-1)?.[0]??null,worldAreaWeightedPercentiles:weighted,triangleCountPercentiles:countP,distribution:dist};
}
async function main(){
 save('oracle.json',oracle());
 const bytes=readFileSync(GLB);assert.equal(hash(bytes),'2c145703c92e53b985d97c705e2c1c5c9ebb3cace91a72535a57ce3e3b97f7cb');assert.equal(bytes.length,20931568);
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const jl=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+jl));assert.equal(bytes.readUInt32LE(16),0x4e4f534a);assert.equal(bytes.readUInt32LE(24+jl),0x004e4942);const bin=bytes.subarray(28+jl,28+jl+bytes.readUInt32LE(20+jl));
 assert(!j.skins?.length);assert(!j.animations?.length,'animated density requires declared pose');
 const images=j.images.map((im,i)=>{const v=j.bufferViews[im.bufferView];assert.equal(v.buffer,0);assert(!v.extensions?.EXT_meshopt_compression);const b=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);assert.equal(b.subarray(0,12).toString('hex'),'ab4b5458203230bb0d0a1a0a');return {index:i,name:im.name,bufferView:im.bufferView,width:b.readUInt32LE(20),height:b.readUInt32LE(24),levels:b.readUInt32LE(40),bytes:b.length,sha256:hash(b)};});
 function maps(m){const found=[];function visit(o,trail=[]){for(const [k,v]of Object.entries(o||{})){if(k.endsWith('Texture')&&v&&Number.isInteger(v.index)){const t=j.textures[v.index],im=t.extensions?.KHR_texture_basisu?.source??t.source;assert(Number.isInteger(im));found.push({slot:[...trail,k].join('.'),texture:v.index,image:im,texCoord:selectedCoord(v),declaredTexCoord:v.texCoord??0,transform:v.extensions?.KHR_texture_transform??{},width:images[im].width,height:images[im].height});}else if(v&&typeof v==='object')visit(v,[...trail,k]);}}visit(m);return found;}
 await MeshoptDecoder.ready;
 // The installed NodeIO registration/read route and normalized getElement/world-matrix APIs match the proven Lark audit.
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
 const document=await io.read(GLB),nodes=document.getRoot().listNodes(),materials=document.getRoot().listMaterials();
 assert.equal(nodes.length,j.nodes.length);nodes.forEach((n,i)=>assert.equal(n.getName(),j.nodes[i].name||''));assert.equal(materials.length,j.materials.length);
 const parents=new Map();j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>{assert(!parents.has(c));parents.set(c,i);}));
 function chain(i){const out=[];for(let x=i;x!==undefined;x=parents.get(x))out.unshift({index:x,name:j.nodes[x].name||''});return out;}
 const reachable=new Set();function visit(i){reachable.add(i);for(const c of j.nodes[i].children||[])visit(c);}for(const i of j.scenes[j.scene??0].nodes)visit(i);
 const roots=new Set(['kestrel_LOD0','kestrel_damaged_LOD0','kestrel_husked_LOD0']);
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
 const aggregate=[...roots].map(variant=>{const samples=[];for(const g of groups.values())if(g.variant===variant)for(const s of g.samples)samples.push(s);return {variant,stats:summary(samples)};});
 assert.equal(stats.length,15);assert.equal(primitiveRows.length,30);
 const modules=Object.keys(require.cache).filter(p=>p.includes('/node_modules/')).map(p=>({path:p,sha256:hash(readFileSync(p))}));
 const dependencies=['@gltf-transform/core','@gltf-transform/extensions','meshoptimizer'].map(n=>{const main=installed.resolve(n);let d=path.dirname(main);while(!require('node:fs').existsSync(path.join(d,'package.json')))d=path.dirname(d);const pkg=JSON.parse(readFileSync(path.join(d,'package.json')));return {name:n,version:pkg.version,entry:main,sha256:hash(readFileSync(main))};});
 const output={status:'MEASURED',scope:'current export only, selected three primary LOD0 variants, static exported pose',glb:GLB,sha256:hash(bytes),bytes:bytes.length,dependencies,modules,images,scene:j.scene??0,extensionsUsed:j.extensionsUsed,accessorChecks,primitiveRows,byMaterial:stats,aggregate,excluded,semantics:{density:'sqrt(width*height*abs(transformed UV triangle area)/world triangle area)',areaEquivalent:'sqrt(sum pixel area/sum world area); world-area-weighted RMS triangle density',weightedMean:'sum(world area*triangle density)/sum(world area)',weightedPercentiles:'inverse cumulative world area; triangle densities sorted ascending',triangleCountPercentiles:'floor((n-1)*p) rank, no interpolation',areas:'sum absolute triangle areas, including layered surfaces and UV overlaps; not atlas union or occupied unique texels',degenerate:'world area exactly zero excluded and explicitly listed; zero UV area retained as zero density. Areas use exact integer-domain cross products/determinants of signed-clamped raw normalized attributes followed by the normalization divisor and world linear cofactor. This avoids false nonzero areas from subtracting translated float positions. No epsilon filter is used.',distribution:'descriptive bins only, no new pass/fail threshold',doubleSided:'physical geometry area once; material doubleSided does not duplicate physical surface area'},resources:process.resourceUsage()};
 save('density.json',output);
 console.log(JSON.stringify({status:output.status,sha256:output.sha256,dependencies,groups:stats.map(x=>({variant:x.variant,material:x.materialName,triangles:x.stats.triangles,worldArea:x.stats.worldAreaM2,uvArea:x.stats.transformedUVAreaSum,areaEquivalent:x.stats.areaEquivalentDensity,weightedMean:x.stats.worldAreaWeightedMeanDensity,min:x.stats.min,p10:x.stats.worldAreaWeightedPercentiles.p10,median:x.stats.worldAreaWeightedPercentiles.p50,p90:x.stats.worldAreaWeightedPercentiles.p90,max:x.stats.max})),aggregate,resources:output.resources},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
