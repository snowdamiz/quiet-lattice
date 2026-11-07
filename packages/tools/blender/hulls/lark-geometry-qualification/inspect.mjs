import fs from 'node:fs';
import {decode,hashJSON,sha} from './decode.mjs';
import {reconstruct,bounds,norm,sub} from './geometry.mjs';
const [asset,deps,out,referencePath=new URL('./reference/decoded.json',import.meta.url)]=process.argv.slice(2);
const {scenes,receipt}=await decode(asset,deps);
const reference=JSON.parse(fs.readFileSync(referencePath));
if(hashJSON(receipt.totals)!==hashJSON(reference.totals))throw Error('Independent counts differ');
receipt.reference={path:String(referencePath),sha256:sha(fs.readFileSync(referencePath)),countsMatch:true};
receipt.canopies=[];
for(const scene of scenes.values()) for(const p of scene.primitives.filter(p=>p.name.startsWith('Canopy'))) {
  const {remap,boundary,loops,...r}=reconstruct(p),b=bounds(p.vertices);
  receipt.canopies.push({scene:scene.name,id:p.id,name:p.name,vertices:p.vertices.length,triangles:p.faces.length,bounds:b,dimensions:sub(b.max,b.min),...r,boundaryEdges:boundary.length,loopEdges:loops.map(x=>x.length),accessor:p.accessor});
}
fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({totals:receipt.totals,canopies:receipt.canopies.map(p=>({scene:p.scene,name:p.name,vertices:p.vertices,triangles:p.triangles,components:p.indexedComponents,rejoined:p.exactDuplicatesRejoined,loops:p.loopEdges,ambiguities:p.ambiguities.length,nonmanifold:p.nonmanifold.length}))}));
