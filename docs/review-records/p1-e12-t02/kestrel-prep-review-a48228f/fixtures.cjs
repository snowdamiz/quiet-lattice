'use strict';
// Analytic fixtures only. No glTF library, image decoder, mesh codec or Blender.
const assert = require('node:assert/strict');
const {I, point, area3, texPoint, lattice, exactArea, selectedCoord, near, summary, aggregateBySlot} = require('./density_math.cjs');
const cases = [];
function test(name, fn) { fn(); cases.push({name, status: 'PASS'}); }
function accessor(array, size, normalized = true) {
 const types = new Map([[Int8Array,5120],[Uint8Array,5121],[Int16Array,5122],[Uint16Array,5123],[Float32Array,5126]]);
 return {getArray: () => array, getElementSize: () => size,
  getNormalized: () => normalized, getComponentType: () => types.get(array.constructor)};
}
const pos = accessor(new Int16Array([0,0,0,32767,0,0,0,32767,0]),3);
const uv = accessor(new Uint16Array([0,0,65535,0,0,65535]),2);
function triangle(p=pos, u=uv, matrix=I, transform={}, width=512, height=512) {
 const a = exactArea(p,u,[0,1,2],matrix,transform);
 if (!a.worldArea) return {excludedZeroWorld: true, ...a};
 return {sample: [Math.sqrt(width*height*a.uvArea/a.worldArea), a.worldArea, a.uvArea, width*height*a.uvArea, a.rawUVArea], ...a};
}
test('normalized int16 positions / uint16 UV: 512 px/m', () => near(triangle().sample[0],512,'density'));
test('signed normalization clamps minimum endpoint', () => {
 for (const [T,values,expected] of [[Int8Array,[-128,-127,0,127],[-1,-1,0,1]], [Int16Array,[-32768,-32767,0,32767],[-1,-1,0,1]], [Uint8Array,[0,255],[0,1]], [Uint16Array,[0,65535],[0,1]]]) {
  const a=accessor(new T(values),1);
  expected.forEach((e,i)=>{const x=lattice(a,i);near(x.raw[0]/x.divisor,e,T.name);});
 }
});
test('float attributes remain unnormalized', () => {
 const p=accessor(new Float32Array([0,0,0,1,0,0,0,1,0]),3,false);
 near(triangle(p).sample[0],512,'float');
});
test('inherited world scale and translation: local-space mutant rejected', () => {
 const m=[2,0,0,0,0,2,0,0,0,0,2,0,9,4,-3,1];
 near(triangle(pos,uv,m).sample[0],256,'world scale');
 assert.notEqual(triangle(pos,uv,m).sample[0],triangle().sample[0]);
});
test('full affine shear / nonuniform scale / nonsquare map', () => {
 const m=[2,0,0,0,1,3,0,0,0,0,1,0,7,8,9,1];
 const t=triangle(pos,uv,m,{},1024,512);
 near(t.worldArea,3,'world area');near(t.sample[0],Math.sqrt(1024*512/6),'density');
 near(t.worldArea,area3(...[[0,0,0],[1,0,0],[0,1,0]].map(p=>point(m,p))),'independent transformed coordinates');
});
test('composed parent scale times child rotation: nonorthogonal world columns', () => {
 const c=Math.SQRT1_2;
 const m=[2*c,3*c,0,0,-2*c,3*c,0,0,0,0,1,0,0,0,0,1];
 near(triangle(pos,uv,m).sample[0],512/Math.sqrt(6),'composition');
});
test('KHR texture transform determinant and texCoord override', () => {
 const tx={scale:[.5,.5],rotation:Math.PI/2,offset:[3,4]};
 near(triangle(pos,uv,I,tx).sample[0],256,'texture scale');
 const p=texPoint([1,0],{scale:[2,.5],rotation:Math.PI/2,offset:[3,4]});
 near(p[0],3,'uv x');near(p[1],6,'uv y');
 assert.equal(selectedCoord({texCoord:0,extensions:{KHR_texture_transform:{texCoord:1}}}),1);
 assert.equal(selectedCoord({texCoord:1}),1);assert.equal(selectedCoord({}),0);
});
test('reflection preserves absolute area', () => near(triangle(pos,uv,I,{scale:[-1,1]}).sample[0],512,'reflection'));
test('quantized collinear triangle stays exactly zero with noninteger scale', () => {
 const p=accessor(new Int16Array([11,21,31,12,23,34,13,25,37]),3);
 const s=7.390239953994751;
 const m=[s,0,0,0,0,s,0,0,0,0,s,0,-.0000002384,.580390691,.290240049,1];
 assert.equal(triangle(p,uv,m).excludedZeroWorld,true);
 assert.equal(triangle(p,uv,m).worldArea,0);
});
test('zero UV retains positive physical weight, not dropped', () => {
 const z=triangle(pos,accessor(new Uint16Array(6),2)).sample;
 assert.equal(z[0],0);
 const s=summary([z,triangle().sample]);
 near(s.worldAreaM2,1,'area');near(s.worldAreaWeightedMeanDensity,256,'weighted mean');
 near(s.areaEquivalentDensity,512/Math.sqrt(2),'RMS');
});
test('negative 4096 map with low physical coverage: dimension-only mutant rejected', () => {
 const s=7.2,m=[s,0,0,0,0,s,0,0,0,0,s,0,0,0,0,1];
 const u=accessor(new Uint16Array([0,0,13107,0,0,13107]),2);
 const d=triangle(pos,u,m,{},4096,4096).sample[0];
 near(d,4096*.2/7.2,'under-density');assert(d < 128);
});
test('raw integer reinterpretation produces wrong density and is rejected', () => {
 const rawP=accessor(pos.getArray(),3,false),rawU=accessor(uv.getArray(),2,false);
 assert(Math.abs(triangle(rawP,rawU).sample[0]-512) > 500);
});
test('world-area weighting cannot be replaced by triangle counts or RMS', () => {
 const samples=[[100,99,1,990000,1],[1000,1,1,1000000,1]];
 const s=summary(samples);
 near(s.worldAreaWeightedMeanDensity,109,'weighted mean');
 assert.equal(s.worldAreaWeightedPercentiles.p50,100);
 assert(s.areaEquivalentDensity > s.worldAreaWeightedMeanDensity);
 near(s.distribution[2].worldAreaPercent,99,'64-128 physical area');
});
test('different map bindings aggregate per slot without double-counted surface', () => {
 const groups=[{variant:'x',maps:[{slot:'color'},{slot:'ao'}],samples:[triangle().sample]},
  {variant:'x',maps:[{slot:'normal'}],samples:[triangle(pos,uv,I,{scale:[.25,.25]}).sample]}];
 const a=aggregateBySlot(groups,['x']);
 assert.equal(a.length,3);a.forEach(x=>near(x.stats.worldAreaM2,.5,'area once per slot'));
 near(a.find(x=>x.slot==='normal').stats.areaEquivalentDensity,128,'normal binding');
 near(a.find(x=>x.slot==='color').stats.areaEquivalentDensity,512,'color binding');
});
test('invalid and empty inventories fail closed', () => {
 assert.throws(()=>summary([]),/no positive/);
 assert.throws(()=>summary([[NaN,1,1,1,1]]),/invalid/);
 assert.throws(()=>summary([[1,0,1,1,1]]),/invalid/);
});
assert(Object.keys(require.cache).every(p=>!p.includes('/node_modules/')),'fixture imported dependency/codec');
console.log(JSON.stringify({status:'PASS',scope:'analytic shared-math fixtures only; no current GLB decode or saved blend measurement',cases,modules:Object.keys(require.cache),resources:process.resourceUsage()},null,2));
