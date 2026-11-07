import fs from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {decode,sha} from './decode.mjs';
import {sourceCode,decodedCode} from './provenance.mjs';
const [asset,deps,sourceFile,out]=process.argv.slice(2);
const source=JSON.parse(gunzipSync(fs.readFileSync(sourceFile))),{scenes,receipt}=await decode(asset,deps);
const rows=[];
for(const scene of scenes.values())for(const p of scene.primitives.filter(p=>p.name.startsWith('Body'))) {
  const s=source.objects.find(s=>s.scene===scene.name&&s.object.replace(/\.\d+$/,'')===p.name);
  if(!s||p.skin)throw Error('Unsupported source Body counterpart');
  const sourceKeys=s.world_vertices.map(v=>sourceCode([v[0],v[2],-v[1]],p.world)),exportKeys=p.vertices.map(v=>decodedCode(v,p.world));
  const triangles=new Map(),verticesToPolygons=new Map();
  s.triangle_vertices.forEach((vs,ti)=>{const polygon=s.triangle_polygons[ti];if(s.polygon_roles[polygon]!==p.material)return;const key=vs.map(v=>sourceKeys[v]).sort().join('|'),list=triangles.get(key)??[];list.push(polygon);triangles.set(key,list);});
  s.faces.forEach((vs,polygon)=>{if(s.polygon_roles[polygon]!==p.material)return;for(const key of new Set(vs.map(v=>sourceKeys[v]))){const set=verticesToPolygons.get(key)??new Set();set.add(polygon);verticesToPolygons.set(key,set);}});
  const identities=[],unresolved=[];let exact=0,retessellated=0;
  for(const [i,f] of p.faces.entries()) {
    const ks=f.map(v=>exportKeys[v]),key=[...ks].sort().join('|');let ids=[...new Set(triangles.get(key)??[])],method='triangle';
    if(ids.length!==1){ids=[...(verticesToPolygons.get(ks[0])??[])].filter(id=>ks.slice(1).every(k=>verticesToPolygons.get(k)?.has(id)));method='polygon_vertex_membership';}
    if(ids.length===1){const polygon=ids[0],pid=s.polygon_pids?.[polygon]??null;identities.push([i,polygon,pid,method==='triangle'?0:1]);if(method==='triangle')exact++;else retessellated++;}
    else unresolved.push({exportTriangle:i,sourcePolygonCandidates:ids});
  }
  rows.push({scene:scene.name,exportPrimitive:p.id,object:p.name,material:p.material,topologyHash:p.topologyHash,sourceObject:s.object,triangleCount:p.faces.length,exactTriangleMatches:exact,polygonVertexMatches:retessellated,unresolved,identities});
  console.log(JSON.stringify({scene:scene.name,id:p.id,material:p.material,exact,retessellated,unresolved:unresolved.length}));
}
fs.writeFileSync(out,gzipSync(JSON.stringify({source_sha256:source.source_sha256,glb_sha256:receipt.sha256,source_geometry_sha256:sha(fs.readFileSync(sourceFile)),rows,meaning:'Exact forward-quantized source triangle coordinate keys within owning node/material; fallback unique source polygon vertex membership is labelled. Coincident/ambiguous source polygons remain unresolved. pid=0 has no semantic plate identity. Mapping does not establish complete plate denominator or removal state.'}),{level:6}));
