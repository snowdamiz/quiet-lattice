import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decode,hashJSON} from './decode.mjs';
import {BVH,areaNormal,strata,add,sub,scale,cross,unit,norm} from './geometry.mjs';

const [asset,deps,targetName,out]=process.argv.slice(2);
const {scenes,receipt}=await decode(asset,deps);
const target=scenes.get(targetName),reference=scenes.get(`lark_LOD${targetName.at(-1)}`);
if(!target||!reference)throw Error('Unknown scene');
const refTree=new BVH(reference.triangles),targetTree=reference===target?refTree:new BVH(target.triangles);
const lo=refTree.root.lo.map((x,k)=>Math.min(x,targetTree.root.lo[k])),hi=refTree.root.hi.map((x,k)=>Math.max(x,targetTree.root.hi[k]));
const reach=norm(sub(hi,lo))+1;
const runs=[],records=[];
const directionNames=['world_winding_normal','normal_plus_45deg_tangent','normal_minus_45deg_tangent'];
const geometry=reference.triangles.map(t=>areaNormal(t.vertices));
const totalArea=geometry.reduce((s,t)=>s+t.area,0);
const tiesEpsilon=1e-9;
for(const count of [3,12,48]) {
  const samples=strata(count);
  for(let direction=0;direction<3;direction++) {
    const started=performance.now(),digest=createHash('sha256'),record=Buffer.allocUnsafe(24);
    const hitCounts=new Uint32Array(target.triangles.length),hitWeights=new Float64Array(target.triangles.length),refCounts=new Uint32Array(reference.triangles.length),visibleCounts=new Uint8Array(reference.triangles.length);
    const transitions=new Map(),witnesses=new Map();
    let rays=0,visible=0,visibleArea=0,empty=0,emptyArea=0,refTies=0,targetTies=0,misses=0,minDepth=Infinity,maxDepth=-Infinity;
    for(let ti=0;ti<reference.triangles.length;ti++) {
      const t=reference.triangles[ti],{area,normal}=geometry[ti];if(area===0)continue;
      const axis=Math.abs(normal[2])<.9?[0,0,1]:[0,1,0],tangent=unit(cross(normal,axis));
      const d=direction===0?normal:unit(add(normal,scale(tangent,direction===1?1:-1))),inward=scale(d,-1),weight=area/count;
      for(let si=0;si<samples.length;si++) {
        const b=samples[si],p=add(add(scale(t.vertices[0],b[0]),scale(t.vertices[1],b[1])),scale(t.vertices[2],b[2])),origin=add(p,scale(d,reach));
        const ref=refTree.ray(origin,inward,2*reach);rays++;
        if(ref)refCounts[ref.id]++;else misses++;
        // Identity, not proximity to a selected material, establishes reference visibility.
        const isVisible=ref?.id===ti&&Math.abs(ref.distance-reach)<1e-7;
        if(ref?.ties)refTies++;
        if(!isVisible)continue;
        visible++;visibleCounts[ti]++;visibleArea+=weight;
        const hit=reference===target?ref:targetTree.ray(origin,inward,2*reach);
        const ht=hit?target.triangles[hit.id]:null;
        const key=`${t.primitive}->${ht?.primitive??'empty'}`;
        const tr=transitions.get(key)??{samples:0,sourceArea_m2:0};tr.samples++;tr.sourceArea_m2+=weight;transitions.set(key,tr);
        if(hit){hitCounts[hit.id]++;hitWeights[hit.id]+=weight;if(hit.ties)targetTies++;minDepth=Math.min(minDepth,reach-hit.distance);maxDepth=Math.max(maxDepth,reach-hit.distance);}else{empty++;emptyArea+=weight;}
        // Hash all accepted source sample -> target first-hit records, including distance.
        record.writeUInt32LE(ti,0);record.writeUInt32LE(si,4);record.writeInt32LE(hit?.id??-1,8);record.writeUInt32LE(hit?.ties??0,12);record.writeDoubleLE(hit?.distance??-1,16);digest.update(record);
        if(!witnesses.has(key))witnesses.set(key,{source:{primitive:t.primitive,triangle:t.triangle,globalTriangle:ti,sample:si,barycentric:b,point:p},direction:d,origin,hit:hit?{primitive:ht.primitive,triangle:ht.triangle,globalTriangle:hit.id,distance_m:hit.distance,point:add(origin,scale(inward,hit.distance)),ties:hit.ties}:null});
      }
    }
    const histogram=[];for(let i=0;i<hitCounts.length;i++)if(hitCounts[i])histogram.push([i,hitCounts[i],hitWeights[i]]);
    const referenceHistogram=[];for(let i=0;i<refCounts.length;i++)if(refCounts[i])referenceHistogram.push([i,refCounts[i]]);
    const perTriangleVisible=[];for(let i=0;i<visibleCounts.length;i++)if(visibleCounts[i])perTriangleVisible.push([i,visibleCounts[i]]);
    const row={samplesPerTriangle:count,direction:directionNames[direction],rays,referenceVisibleSamples:visible,referenceVisibleArea_m2:visibleArea,emptySamples:empty,emptyArea_m2:emptyArea,referenceCoincidentHitTies:refTies,targetCoincidentHitTies:targetTies,referenceMisses:misses,targetRelativeDepthRange_m:visible>empty?[minDepth,maxDepth]:null,hitRecordSHA256:digest.digest('hex'),wall_seconds:(performance.now()-started)/1000,transitions:Object.fromEntries(transitions),classification:{structural_member:null,occluder_or_unknown_samples:visible-empty,reason:'No reviewed semantic member identities; every nonempty first hit remains unknown'},witnesses:[...witnesses.values()]};
    runs.push(row);records.push({samplesPerTriangle:count,direction:directionNames[direction],targetFirstHitHistogram:histogram,referenceFirstHitHistogram:referenceHistogram,referenceVisibleSampleCounts:perTriangleVisible});
    console.log(JSON.stringify({target:targetName,samples:count,direction:directionNames[direction],rays,visibleArea_m2:visibleArea,seconds:row.wall_seconds}));
  }
}
const identity=s=>({scene:s.name,triangles:s.triangles.length,primitives:s.primitives.map(p=>({id:p.id,name:p.name,material:p.material,alphaMode:p.alphaMode,triangleStart:p.triangleStart,triangleCount:p.faces.length,topologyHash:p.topologyHash,skin:!!p.skin}))});
const payload={schema:1,asset_sha256:receipt.sha256,reference:identity(reference),target:identity(target),totalReferenceTriangleArea_m2:totalArea,degenerateReferenceTriangles:geometry.filter(g=>g.area===0).length,
  method:{samples:'Equal-area triangular subdivision: 3 centroid sectors, then two successive midpoint subdivisions to 12 and 48; each stratum sampled at its centroid; deterministic, no random seed',directions:directionNames,tangent:'normalize(cross(world winding normal, world Z)); use world Y when abs(normal.z)>=0.9',rayReach_m:reach,origin:'sample + direction * (union scene AABB diagonal + 1 metre)',occluders:'ALL render primitives in owning variant/LOD, including skinned mechanisms in saved pose, glyph descendants, glass and backing. COL outside LOD excluded. Double-sided geometric intersections; alpha/blend/texture transparency is not evaluated.',normals:'cross product of fully transformed world triangle edges, normalized',area:'half norm of world triangle cross product',referenceVisibility:'Exact first-hit triangle identity and distance within 1e-7 m of source point; ties at 1e-9 m retained as ambiguity counts',depth:'reference sample distance minus target first-hit distance; signed along incoming direction, not a clearance threshold',histograms:'Each global triangle resolves to primitive and local triangle via triangleStart/count. Source area weights are area/sample count; they are neither target triangle area nor projected camera coverage.',semantics:'Whole-render-scene diagnostic denominator. Not semantic plate count, continuous visibility, photometric rendering, or a visual grade.'},runs,records,semanticStatus:'UNQUALIFIED',directionSensitivityIsNotConfidenceInterval:true};
fs.writeFileSync(`${out}.json.gz`,gzipSync(JSON.stringify(payload),{level:6}));
fs.writeFileSync(`${out}-summary.json`,JSON.stringify({...payload,records:undefined,runs:runs.map(r=>({...r,witnesses:undefined}))},null,2)+'\n');
