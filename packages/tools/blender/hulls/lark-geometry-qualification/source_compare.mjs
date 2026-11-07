import fs from 'node:fs';
import {decode,hashJSON,sha,readJSON} from './decode.mjs';
import {sub,norm,add,scale,bounds,reconstruct} from './geometry.mjs';
import {inversePoint,sourceCode as code} from './provenance.mjs';

const [asset,deps,factsFile,glazingFile,sourceMeasureFile,out]=process.argv.slice(2);
const facts=readJSON(factsFile),glazing=readJSON(glazingFile),sourceMeasure=readJSON(sourceMeasureFile);
const {scenes,receipt}=await decode(asset,deps);
const swizzle=p=>[p[0],p[2],-p[1]];
function components(faces,vertexCount) {
  const parent=Array.from({length:vertexCount},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const f of faces)for(const i of f)parent[find(i)]=find(f[0]);
  return parent.map((_,i)=>find(i));
}
const mapped=[],construction=[];
for(const scene of scenes.values())for(const p of scene.primitives.filter(p=>p.name.startsWith('Canopy'))) {
  const source=facts.objects.find(o=>o.scene===scene.name&&o.object.replace(/\.\d+$/,'')===p.name);
  if(!source)throw Error('Missing source counterpart');
  const sourceWorld=source.world_vertices.map(swizzle),sc=components(source.faces,source.vertices),ec=components(p.faces,p.vertices.length);
  const keys=new Map();
  sourceWorld.forEach((v,i)=>{const k=code(v,p.world),ids=keys.get(k)??[];ids.push(i);keys.set(k,ids);});
  const candidates=p.vertices.map(v=>keys.get(inversePoint(v,p.world).map(x=>Math.round(x*32767)).join(','))??[]);
  const exportComponents=new Map();for(let i=0;i<ec.length;i++){const group=exportComponents.get(ec[i])??[];group.push(i);exportComponents.set(ec[i],group);}
  const mapping=Array(p.vertices.length).fill(null),ambiguous=[];
  for(const [component,vis] of exportComponents){
    const possible=[...new Set(candidates[vis[0]].map(i=>sc[i]))].filter(s=>vis.every(v=>candidates[v].some(i=>sc[i]===s)));
    for(const v of vis){const ids=possible.length===1?candidates[v].filter(i=>sc[i]===possible[0]):candidates[v];if(ids.length===1)mapping[v]=ids[0];else ambiguous.push({exportVertex:v,component,sourceCandidates:ids,possibleSourceComponents:possible});}
  }
  const sourceTriangles=new Map();
  for(const [i,t] of source.triangles_to_polygons.entries()){const k=[...t.vertices].sort((a,b)=>a-b).join(',');const ids=sourceTriangles.get(k)??[];ids.push({triangle:i,polygon:t.polygon});sourceTriangles.set(k,ids);}
  const triangles=p.faces.map((f,i)=>{const ids=f.map(v=>mapping[v]);return {exportTriangle:i,source:ids.some(v=>v===null)?[]:sourceTriangles.get([...ids].sort((a,b)=>a-b).join(','))??[],sourcePolygons:ids.some(v=>v===null)?[]:source.faces.flatMap((face,index)=>ids.every(v=>face.includes(v))?[index]:[])};});
  const errors=mapping.flatMap((id,i)=>id===null?[]:[norm(sub(sourceWorld[id],p.vertices[i]))]);
  const coordinateError=errors.length?Math.max(...errors):null;
  const rawLatticeCompatible=p.vertices.every(v=>inversePoint(v,p.world).every(x=>{const q=Math.round(Math.abs(x)*32767),base=q>>2;return ((base<<2)|(base>>11))===q;}));
  // Signed quantBits=13; msb replication has additional bounded normalized error.
  let replication=0;for(let q=0;q<=8191;q++)replication=Math.max(replication,Math.abs(((q<<2)|(q>>11))/32767-q/8191));
  const scalarError=.5/8191+replication;
  const cornerErrors=Array.from({length:8},(_,j)=>norm([0,1,2].map(r=>[0,1,2].reduce((s,c)=>s+p.world[c*4+r]*scalarError*((j>>c)&1?1:-1),0))));
  let boundaryProof=null;
  if(p.name.startsWith('CanopyGlass')) {
    const counts=new Map();for(const face of source.faces)face.forEach((v,i)=>{const k=[v,face[(i+1)%face.length]].sort((a,b)=>a-b).join(',');counts.set(k,(counts.get(k)??0)+1);});
    const expected=[...counts].filter(([,n])=>n===1).map(([k])=>k).sort();
    const actual=reconstruct(p).boundary.map(e=>[mapping[e.a],mapping[e.b]].sort((a,b)=>a-b).join(',')).sort();
    boundaryProof={sourceBoundaryEdges:expected.length,exportBoundaryEdges:actual.length,exactSourceIdentityMatch:JSON.stringify(expected)===JSON.stringify(actual),sourceBoundarySHA256:hashJSON(expected),exportMappedBoundarySHA256:hashJSON(actual)};
    if(!boundaryProof.exactSourceIdentityMatch)throw Error('Pane perimeter source correspondence failed');
  }
  mapped.push({scene:scene.name,exportPrimitive:p.id,sourceObject:source.object,sourceTopologyHash:source.topology_sha256,exportTopologyHash:p.topologyHash,rawLatticeCompatible14bit:rawLatticeCompatible,quantizationBound_m:Math.max(...cornerErrors),maxMatchedPositionError_m:coordinateError,vertices:p.vertices.length,uniqueMappedVertices:mapping.filter(x=>x!==null).length,exactExportDuplicatesResolved:mapping.filter(x=>x!==null).length-new Set(mapping.filter(x=>x!==null)).size,ambiguousVertices:ambiguous,vertexToSource:mapping,triangles,matchedTriangles:triangles.filter(t=>t.source.length===1).length,uniquelyMappedPolygons:triangles.filter(t=>t.sourcePolygons.length===1).length,sourceTriangleCount:source.triangles_to_polygons.length,boundaryProof,
    interpretation:'Forward quantize actual saved source world coordinates using pinned 14-bit quantizer; exact integer key match. Component provenance disambiguates distinct coincident panes. No tolerance welding. Ambiguous vertices remain unmapped.'});
  if(p.name.startsWith('CanopyFrame')&&scene.name.endsWith('0')) {
    const edges=new Set(source.faces.flatMap(f=>f.map((v,i)=>[v,f[(i+1)%f.length]].sort((a,b)=>a-b).join(','))));
    const rings=[];
    for(let ring=0;ring<159;ring++) {
      const ids=Array.from({length:8},(_,i)=>ring*8+i),vs=ids.map(i=>sourceWorld[i]),centre=scale(vs.reduce(add,[0,0,0]),1/8),radii=vs.map(v=>norm(sub(v,centre)));
      const edgeIdentity=ids.every((v,i)=>edges.has([v,ids[(i+1)%8]].sort((a,b)=>a-b).join(',')));
      rings.push({ring,sourceVertices:ids,edgeCycleVerified:edgeIdentity,centre,radiusRange_m:[Math.min(...radii),Math.max(...radii)]});
    }
    construction.push({scene:scene.name,frameSource:source.object,sourceTopologyHash:source.topology_sha256,rings,
      archRingGroups:[[0,20],[21,41],[42,62],[63,83]],railRingGroups:[[84,108],[109,133],[134,158]],
      scope:'Verified saved eight-vertex ring cycles and actual world radii. Grouping into four arches and three rails follows fit_glazing construction; does not identify hull structural-member load paths.'});
  }
}
const comparisons=glazing.rows.map(r=>{
  const s=sourceMeasure.rows.find(s=>`${s.variant}_LOD${s.lod}`===r.scene);
  const g=mapped.find(m=>m.scene===r.scene&&m.sourceObject.startsWith('CanopyGlass')),f=mapped.find(m=>m.scene===r.scene&&m.sourceObject.startsWith('CanopyFrame'));
  return {scene:r.scene,sourceMaxInterval_m:[s.sampled_max_m,s.conservative_max_m],exportMaxInterval_m:r.maxDistanceInterval_m,sampledMaxDifference_m:r.maxDistanceInterval_m[0]-s.sampled_max_m,conditionalQuantizationPairBound_m:g.quantizationBound_m+f.quantizationBound_m,measuredMatchedVertexPairBound_m:g.maxMatchedPositionError_m+f.maxMatchedPositionError_m,sourceFrameTriangles:s.frame_triangles,exportFrameTriangles:r.frameTriangles,clearanceStatus:'UNQUALIFIED: intentional seat/overlap specification not present in inspected source'};
});
const paneSeats=[];
for(const s of facts.objects.filter(o=>o.object.startsWith('CanopyGlass'))) {
  const n=s.scene.endsWith('3')?6:12,variant=s.scene.replace(/_LOD\d$/,''),frame=facts.objects.find(o=>o.scene===`${variant}_LOD0`&&o.object.startsWith('CanopyFrame'));
  const faceKeys=new Set(s.faces.map(f=>[...f].sort((a,b)=>a-b).join(',')));
  let gridVerified=s.vertices===6*(n+1)*10&&s.faces.length===6*n*9;const offsets=[];
  for(let band=0;band<3;band++)for(let side=0;side<2;side++){
    const start=(band*2+side)*(n+1)*10;
    for(let i=0;i<n;i++)for(let j=0;j<9;j++){const v=start+i*10+j;gridVerified&&=faceKeys.has([v,v+10,v+11,v+1].sort((a,b)=>a-b).join(','));}
    for(const end of [0,1])for(let j=0;j<10;j++){
      const ring=(band+end)*21+(side===0?1+j:19-j),centre=scale(frame.world_vertices.slice(ring*8,ring*8+8).reduce(add,[0,0,0]),1/8),v=start+end*n*10+j;
      offsets.push({sourceGlassVertex:v,sourceFrameRing:ring,sourceWorldOffset:sub(s.world_vertices[v],centre)});
    }
  }
  const lengths=offsets.map(o=>norm(o.sourceWorldOffset));
  paneSeats.push({scene:s.scene,sourceObject:s.object,sourceTopologyHash:s.topology_sha256,gridTopologyVerified:gridVerified,archBoundaryOffsets:offsets,archOffsetMagnitudeRange_m:[Math.min(...lengths),Math.max(...lengths)],maxDeviationFromSourceMinusZ6mm_m:Math.max(...offsets.map(o=>norm(sub(o.sourceWorldOffset,[0,0,-.006])))),interpretation:'Actual saved grid topology and arch-boundary source coordinates establish the ~6 mm downward offset from tube centre curves. This is not 6 mm clearance to the tube surface and does not specify acceptable exposure/overlap.'});
}
fs.writeFileSync(out,JSON.stringify({source_sha256:facts.source_sha256,glb_sha256:receipt.sha256,source_facts_sha256:sha(fs.readFileSync(factsFile)),mapping:mapped,construction,paneSeats,comparisons},null,2)+'\n');
console.log(JSON.stringify(mapped.map(m=>({scene:m.scene,object:m.sourceObject,vertices:[m.uniqueMappedVertices,m.vertices],triangles:[m.matchedTriangles,m.triangles.length],quantizationBound_m:m.quantizationBound_m,error:m.maxMatchedPositionError_m}))));
