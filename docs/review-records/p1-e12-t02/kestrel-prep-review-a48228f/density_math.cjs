'use strict';
// Area and distribution method retained from the pinned independent audit. No codec imports.
const assert = require('node:assert/strict');
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
function summary(samples){
 assert(samples.length, "no positive-world-area mapped triangles");
 assert(samples.every(x => x.length === 5 && x.every(Number.isFinite) && x[0] >= 0 && x[1] > 0 && x.slice(2).every(v => v >= 0)), "invalid density sample");
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

function aggregateBySlot(groups, roots) {
 const slots = [...new Set(groups.flatMap(g => g.maps.map(m => m.slot)))].sort();
 return roots.flatMap(variant => slots.map(slot => {
  const samples = [];
  for (const g of groups) if (g.variant === variant && g.maps.some(m => m.slot === slot)) {
   for (const s of g.samples) samples.push(s);
  }
  return {variant, slot, stats: summary(samples)};
 }));
}
module.exports = {I, point, area3, area2, texPoint, lattice, exactArea, selectedCoord, near, summary, aggregateBySlot};
