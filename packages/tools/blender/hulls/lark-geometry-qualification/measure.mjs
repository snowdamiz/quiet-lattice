import fs from 'node:fs';
import {decode,sha,hashJSON} from './decode.mjs';
import {BVH,reconstruct,bounds,sub,add,scale,norm,areaNormal} from './geometry.mjs';

const [asset,deps,probeFile,out]=process.argv.slice(2);
const {scenes,receipt}=await decode(asset,deps);
const probe=JSON.parse(fs.readFileSync(probeFile));
const swizzle=p=>[p[0],p[2],-p[1]];
const lerp=(a,b,t)=>add(scale(a,1-t),scale(b,t));
function referenceConstruction(vertices,n) {
  const centres=Array.from({length:159},(_,i)=>scale(vertices.slice(i*8,i*8+8).reduce(add,[0,0,0]),1/8));
  const arches=Array.from({length:4},(_,i)=>centres.slice(i*21,i*21+21));
  const sample=(ps,t)=>{t=Math.max(0,Math.min(ps.length-1,t));const i=Math.min(Math.floor(t),ps.length-2);return lerp(ps[i],ps[i+1],t-i);};
  const rail=(ps,y)=>{for(let i=0;i<ps.length-1;i++)if(ps[i][1]<=y&&y<=ps[i+1][1])return lerp(ps[i],ps[i+1],(y-ps[i][1])/(ps[i+1][1]-ps[i][1]));return ps.reduce((a,b)=>Math.abs(a[1]-y)<Math.abs(b[1]-y)?a:b);};
  const panes=[];
  for(let band=0;band<3;band++)for(let side=0;side<2;side++){
    const points=[],arch=(b,s)=>sample(arches[b],side===0?1+9*s:19-9*s),sidecurve=centres.slice(side===0?84:134,side===0?109:159),centre=centres.slice(109,134);
    for(let i=0;i<=n;i++)for(let j=0;j<10;j++){
      const t=i/n,s=j/9;let p=lerp(arch(band,s),arch(band+1,s),t);
      for(const [w,sc,ss] of [[1-s,sidecurve,0],[s,centre,1]]){
        const aa=arch(band,ss),bb=arch(band+1,ss),q=lerp(aa,bb,t);
        let correction=sub(rail(sc,q[1]),q);
        correction=sub(correction,lerp(sub(rail(sc,aa[1]),aa),sub(rail(sc,bb[1]),bb),t));p=add(p,scale(correction,w));
      }
      p[2]-=.006;points.push(swizzle(p));
    }
    panes.push({band,side,points});
  }
  return {centres,panes};
}
function matchVertices(expected,actual,tolerance) {
  const matches=expected.map(p=>{let d=Infinity,id=-1;for(let i=0;i<actual.length;i++){const x=norm(sub(p,actual[i]));if(x<d){d=x;id=i;}}return {vertex:id,distance:d};});
  return {maximum_m:Math.max(...matches.map(m=>m.distance)),matched:matches.filter(m=>m.distance<=tolerance).length,total:matches.length,tolerance_m:tolerance,matches};
}
// Derive dimensions and select sample spacing before measuring perimeter distances.
const construction=[];
for(const scene of scenes.values()) {
  const frames=scene.primitives.filter(p=>p.name.startsWith('CanopyFrame')),glass=scene.primitives.filter(p=>p.name.startsWith('CanopyGlass'));
  if(frames.length!==1||glass.length!==1)throw Error(`Require unique frame and glass roles ${scene.name}`);
  const f=frames[0],g=glass[0],b=bounds(f.vertices),gb=bounds(g.vertices);
  const reference=referenceConstruction(probe.CanopyFrame.vertices,scene.name.endsWith('3')?6:12);
  const tolerance=(f.accessor.halfCellDiagonal??0)+1e-6;
  const matched=matchVertices(probe.CanopyFrame.vertices.slice(0,1272).map(swizzle),f.vertices,tolerance);
  const rings=[];
  for(let i=0;i<159;i++) {
    const ids=matched.matches.slice(i*8,i*8+8);
    if(ids.some(m=>m.distance>tolerance))continue;
    const vs=ids.map(m=>f.vertices[m.vertex]),centre=scale(vs.reduce(add,[0,0,0]),1/8),radii=vs.map(v=>norm(sub(v,centre)));
    rings.push({ring:i,vertices:ids.map(m=>m.vertex),centre,radius_min_m:Math.min(...radii),radius_max_m:Math.max(...radii)});
  }
  const panePredictions=reference.panes.map(p=>({band:p.band,side:p.side,...matchVertices(p.points,g.vertices,(g.accessor.halfCellDiagonal??0)+2e-6)}));
  construction.push({scene:scene.name,frame:f.id,glass:g.id,frameDimensions_m:sub(b.max,b.min),glassDimensions_m:sub(gb.max,gb.min),frameBounds:b,glassBounds:gb,frameTopologyHash:f.topologyHash,glassTopologyHash:g.topologyHash,
    ringCorrespondence:{...matched,rings,interpretation:'Historical explicit ring coordinates matched to current decoded vertices, not current Blender polygon/load-path identity; unmatched rings remain unknown'},
    paneConstructionCorrespondence:panePredictions,
    accessorStorageHalfCellPair_m:(f.accessor.halfCellDiagonal??0)+(g.accessor.halfCellDiagonal??0),
    quantizationCaveat:'Storage half-cell is NOT an error bound for the effective 14-bit quantizer. Use source-comparison-v3.json quantizationBound_m and actual source correspondence. This preliminary probe match intentionally records failure at storage precision. Measurements use actual decoded bytes.',
    intendedSeatClearance_m:null,clearanceStatus:'UNQUALIFIED: no reviewed intentional seat/overlap specification bound to saved source polygons',
    spacing_m:.001,spacingBasis:'1 mm numerical resolution fixed before surface-distance evaluation; no acceptance tolerance inferred from it',
    historicalInset:{axis:'source local -Z',amount:.006,worldMagnitudeIfHistoricalIdentityTransform_m:.006,admission:'construction hypothesis; current saved source transform and seating intent need inspection'}});
}
const rows=[];
for(const dimensions of construction){
  const scene=scenes.get(dimensions.scene),frame=scene.primitives.find(p=>p.id===dimensions.frame),glass=scene.primitives.find(p=>p.id===dimensions.glass),top=reconstruct(glass);
  if(top.nonmanifold.length||top.badDegrees.length||!top.boundary.length)throw Error('Unmeasurable boundary');
  const tree=new BVH(frame.faces.map((f,i)=>({vertices:f.map(j=>frame.vertices[j]),triangle:i,primitive:frame.id})));
  const loops=[];
  for(const ids of top.loops){let maximum=0,upper=0,minimum=Infinity,length=0,samples=0,witness=null;const edges=[];
    for(const id of ids){const e=top.boundary[id],a=glass.vertices[e.a],b=glass.vertices[e.b],len=norm(sub(b,a)),n=Math.max(1,Math.ceil(len/dimensions.spacing_m));let edgeMax=0,edgeMin=Infinity;
      for(let j=0;j<=n;j++){const point=lerp(a,b,j/n),hit=tree.nearest(point);if(hit.distance>maximum){maximum=hit.distance;witness={point,glassEdge:[e.a,e.b],sample:j,intervals:n,frameTriangle:hit.id};}edgeMax=Math.max(edgeMax,hit.distance);edgeMin=Math.min(edgeMin,hit.distance);samples++;}
      upper=Math.max(upper,edgeMax+len/(2*n));minimum=Math.min(minimum,edgeMin);length+=len;edges.push({vertices:[e.a,e.b],triangle:e.triangle,length_m:len,intervals:n,sampled_min_m:edgeMin,sampled_max_m:edgeMax,max_upper_m:edgeMax+len/(2*n)});
    }
    loops.push({edgeCount:ids.length,perimeter_m:length,samples,sampled_min_m:minimum,maxDistanceInterval_m:[maximum,upper],witness,edges});
  }
  rows.push({scene:scene.name,glass:glass.id,frame:frame.id,frameTriangles:frame.faces.length,degenerateFrameTrianglesExcluded:tree.data.filter(t=>t.degenerate).length,glassTriangles:glass.faces.length,topology:{indexedComponents:top.indexedComponents,exactDuplicatesRejoined:top.exactDuplicatesRejoined,coincidentBoundaryAmbiguities:top.ambiguities.length,policy:'All six connected pane boundaries retained independently, including shared coincident edges; no positional welding across components'},maxDistanceInterval_m:[Math.max(...loops.map(l=>l.maxDistanceInterval_m[0])),Math.max(...loops.map(l=>l.maxDistanceInterval_m[1]))],loops,status:'MEASURED_UNSIGNED_DISTANCE; INTENTIONAL_CLEARANCE_UNQUALIFIED'});
  console.log(JSON.stringify({scene:scene.name,rings:dimensions.ringCorrespondence.rings.length,paneMatches:dimensions.paneConstructionCorrespondence.map(p=>[p.matched,p.total]),maxDistanceInterval_m:rows.at(-1).maxDistanceInterval_m}));
}
fs.writeFileSync(out,JSON.stringify({asset_sha256:receipt.sha256,probe:{path:probeFile,sha256:sha(fs.readFileSync(probeFile))},construction,rows,meaning:'Distances to actual frame surface triangles from every edge of every connected pane. Unsigned distance alone is not a gap/seat/visibility/watertightness verdict. Per-edge 1-Lipschitz upper bound includes unsampled interior; no repair or pass/fail threshold.'},null,2)+'\n');
