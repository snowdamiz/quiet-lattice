export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const scale=(a,s)=>a.map(v=>v*s);
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>Math.hypot(...a);
export const unit=a=>scale(a,1/norm(a));
export const midpoint=(a,b)=>scale(add(a,b),.5);
export function areaNormal(v) {const c=cross(sub(v[1],v[0]),sub(v[2],v[0]));const n=norm(c);return {area:n/2,normal:n?scale(c,1/n):[0,0,0]};}
export function bounds(vertices) {return {min:[0,1,2].map(k=>Math.min(...vertices.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...vertices.map(v=>v[k])))};}

function segmentDistance2(p,a,b) {const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/(dot(d,d)||1)));const e=sub(p,add(a,scale(d,t)));return dot(e,e);}
export function triangleDistance2(p,[a,b,c]) {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),n=cross(ab,ac),nn=dot(n,n);
  if(nn===0) return Math.min(segmentDistance2(p,a,b),segmentDistance2(p,b,c),segmentDistance2(p,c,a));
  const d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return dot(ap,ap);
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return dot(bp,bp);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return segmentDistance2(p,a,b);
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return dot(cp,cp);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return segmentDistance2(p,a,c);
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return segmentDistance2(p,b,c);
  return dot(ap,n)**2/nn;
}

export class BVH {
  constructor(triangles) {
    this.triangles=triangles;
    this.data=triangles.map(t=>{const v=t.vertices,e1=sub(v[1],v[0]),e2=sub(v[2],v[0]);return {a:v[0],e1,e2,degenerate:norm(cross(e1,e2))===0,...bounds(v),center:scale(add(add(...v.slice(0,2)),v[2]),1/3)};});
    const build=ids=>{
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(const id of ids)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],this.data[id].min[k]);hi[k]=Math.max(hi[k],this.data[id].max[k]);}
      const n={lo,hi}; if(ids.length<=8){n.ids=ids;return n;}
      const span=sub(hi,lo),axis=span.indexOf(Math.max(...span));ids.sort((a,b)=>this.data[a].center[axis]-this.data[b].center[axis]);
      const mid=ids.length>>1;n.left=build(ids.slice(0,mid));n.right=build(ids.slice(mid));return n;
    };
    this.root=build(triangles.map((_,i)=>i));
  }
  nearest(p) {
    let best=Infinity,identity=-1;
    const bd=n=>[0,1,2].reduce((s,k)=>s+Math.max(0,n.lo[k]-p[k],p[k]-n.hi[k])**2,0);
    const visit=n=>{if(bd(n)>best)return;if(n.ids){for(const id of n.ids){if(this.data[id].degenerate)continue;const d=triangleDistance2(p,this.triangles[id].vertices);if(d<best){best=d;identity=id;}}}else{const l=bd(n.left),r=bd(n.right);if(l<r){visit(n.left);visit(n.right);}else{visit(n.right);visit(n.left);}}};
    visit(this.root);return {distance:Math.sqrt(best),id:identity};
  }
  ray(origin,dir,maxDistance=Infinity) {
    let best=maxDistance,identity=-1,ties=0;
    const intersects=n=>{let lo=0,hi=best+1e-9;for(let k=0;k<3;k++){if(Math.abs(dir[k])<1e-15){if(origin[k]<n.lo[k]-1e-12||origin[k]>n.hi[k]+1e-12)return false;}else{let a=(n.lo[k]-origin[k])/dir[k],b=(n.hi[k]-origin[k])/dir[k];if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi+1e-12)return false;}}return true;};
    const visit=n=>{if(!intersects(n))return;if(!n.ids){visit(n.left);visit(n.right);return;}for(const id of n.ids){const {a,e1,e2}=this.data[id];
      const px=dir[1]*e2[2]-dir[2]*e2[1],py=dir[2]*e2[0]-dir[0]*e2[2],pz=dir[0]*e2[1]-dir[1]*e2[0],det=e1[0]*px+e1[1]*py+e1[2]*pz;
      if(Math.abs(det)<1e-14)continue;
      const tx=origin[0]-a[0],ty=origin[1]-a[1],tz=origin[2]-a[2],u=(tx*px+ty*py+tz*pz)/det;
      if(u< -1e-10||u>1+1e-10)continue;
      const qx=ty*e1[2]-tz*e1[1],qy=tz*e1[0]-tx*e1[2],qz=tx*e1[1]-ty*e1[0],v=(dir[0]*qx+dir[1]*qy+dir[2]*qz)/det;
      if(v< -1e-10||u+v>1+1e-10)continue;
      const d=(e2[0]*qx+e2[1]*qy+e2[2]*qz)/det;
      if(d<0||d>best+1e-9)continue;
      if(identity>=0&&Math.abs(d-best)<=1e-9){ties++;identity=Math.min(id,identity);}else{best=d;identity=id;ties=0;}
    }};
    visit(this.root);return identity<0?null:{id:identity,distance:best,ties};
  }
}

export function strata(count) {
  const a=[1,0,0],b=[0,1,0],c=[0,0,1],g=[1/3,1/3,1/3];let ts=[[a,b,g],[b,c,g],[c,a,g]];
  while(ts.length<count)ts=ts.flatMap(([x,y,z])=>{const xy=midpoint(x,y),yz=midpoint(y,z),zx=midpoint(z,x);return [[x,xy,zx],[xy,y,yz],[zx,yz,z],[xy,yz,zx]];});
  if(ts.length!==count)throw Error('Expected 3,12,48 strata');
  return ts.map(t=>scale(add(add(t[0],t[1]),t[2]),1/3));
}

export function reconstruct(prim) {
  const {vertices,faces}=prim,parent=vertices.map((_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(a,b)=>{parent[find(b)]=find(a);};
  for(const f of faces){union(f[0],f[1]);union(f[1],f[2]);}
  const indexedComponent=vertices.map((_,i)=>find(i)),groups=new Map(),ambiguities=[];
  const keys=vertices.map(v=>JSON.stringify(v));
  // An exact coordinate is welded only within an existing indexed component.
  // Across disconnected panes, even a unique reversed edge cannot prove authorship.
  for(let i=0;i<vertices.length;i++){const k=`${indexedComponent[i]}:${keys[i]}`;if(!groups.has(k))groups.set(k,i);}
  const remap=vertices.map((_,i)=>groups.get(`${indexedComponent[i]}:${keys[i]}`));
  const edges=new Map();
  for(const [ti,f] of faces.entries())for(let j=0;j<3;j++){
    const a=remap[f[j]],b=remap[f[(j+1)%3]],key=[a,b].sort((x,y)=>x-y).join(',');
    if(a===b){ambiguities.push({type:'collapsed_edge',triangle:ti});continue;}
    const e=edges.get(key)??[];e.push({a,b,triangle:ti});edges.set(key,e);
  }
  const boundary=[],nonmanifold=[];
  for(const [key,es] of edges){if(es.length===1)boundary.push(es[0]);else if(es.length!==2||es[0].a===es[1].a)nonmanifold.push({key,triangles:es.map(e=>e.triangle)});}
  const geometricEdges=new Map();
  for(const e of boundary){const key=[keys[e.a],keys[e.b]].sort().join('|');const list=geometricEdges.get(key)??[];list.push(e);geometricEdges.set(key,list);}
  for(const es of geometricEdges.values())if(es.length>1)ambiguities.push({type:'coincident_component_boundary',edges:es,reason:'Distinct coincident pane vs export split cannot be inferred; retained separately'});
  const degree=new Map();for(const e of boundary)for(const i of [e.a,e.b])degree.set(i,(degree.get(i)??0)+1);
  const badDegrees=[...degree].filter(([,d])=>d!==2);
  const remaining=new Set(boundary.map((_,i)=>i)),loops=[];
  while(remaining.size){const stack=[remaining.values().next().value],ids=[];while(stack.length){const i=stack.pop();if(!remaining.delete(i))continue;ids.push(i);const e=boundary[i];for(const j of remaining){const f=boundary[j];if([e.a,e.b].some(v=>v===f.a||v===f.b))stack.push(j);}}loops.push(ids);}
  return {boundary,loops,remap,indexedComponents:new Set(indexedComponent).size,exactDuplicatesRejoined:vertices.length-groups.size,nonmanifold,badDegrees,ambiguities};
}
