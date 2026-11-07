"""Inventory existing UV charts and material allocation without modifying the saved source."""
import bpy,sys,json,math,hashlib,warnings
warnings.filterwarnings('ignore',category=DeprecationWarning)
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
SRC=ROOT/'assets/blend/hulls/lark.blend';bpy.ops.wm.open_mainfile(filepath=str(SRC))
report=[]
cache={}
for state in ['lark','lark_damaged','lark_husked']:
 a=[]
 for name in [state+'_4k_baseColor',state+'_4k_ORM']:
  im=bpy.data.images[name];v=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(v);a.append(v.reshape(4096,4096,4))
 cache[state]=a
for coll in bpy.data.collections:
 if not coll.name.endswith('_LOD0'):continue
 state=coll.name[:-5]
 for o in coll.objects:
  if o.type!='MESH' or not o.data.uv_layers.active:continue
  m=o.data;uv=m.uv_layers.active.data;parents=list(range(len(m.polygons)));edges={}
  def root(a):
   while parents[a]!=a:parents[a]=parents[parents[a]];a=parents[a]
   return a
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ('Hull','Accent','Trim','Dark'):continue
   for a,b in zip(p.loop_indices,list(p.loop_indices[1:])+[p.loop_indices[0]]):
    pair=tuple(sorted(((m.loops[a].vertex_index,tuple(uv[a].uv)),(m.loops[b].vertex_index,tuple(uv[b].uv)))))
    key=(role,pair)
    if key in edges:parents[root(p.index)]=root(edges[key])
    else:edges[key]=p.index
  groups={}
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ('Hull','Accent','Trim','Dark'):continue
   groups.setdefault(root(p.index),[]).append(p)
  for id,polys in groups.items():
   li=[l for p in polys for l in p.loop_indices];u=np.array([uv[l].uv for l in li],dtype=np.float64);xyz=np.array([o.matrix_world@m.vertices[m.loops[l].vertex_index].co for l in li]);area=sum(p.area for p in polys)
   samples=[]
   for p in polys:
    us=np.array([uv[l].uv for l in p.loop_indices])*4096
    for k in range(1,len(us)-1):
     q=us[[0,k,k+1]];lo=np.floor(q.min(0)).astype(int);hi=np.ceil(q.max(0)).astype(int);lo=np.clip(lo,0,4095);hi=np.clip(hi,0,4095)
     xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1));x=xx+.5;y=yy+.5
     den=(q[1,1]-q[2,1])*(q[0,0]-q[2,0])+(q[2,0]-q[1,0])*(q[0,1]-q[2,1])
     if abs(den)<1e-9:continue
     aa=((q[1,1]-q[2,1])*(x-q[2,0])+(q[2,0]-q[1,0])*(y-q[2,1]))/den
     bb=((q[2,1]-q[0,1])*(x-q[2,0])+(q[0,0]-q[2,0])*(y-q[2,1]))/den
     mask=(aa>=0)&(bb>=0)&(aa+bb<=1)
     if mask.any():samples.append(np.concatenate([cache[state][0][yy[mask],xx[mask],:3],cache[state][1][yy[mask],xx[mask],1:3]],axis=1))
   if samples:
    sampled=np.concatenate(samples);vmin=sampled.min(0);vmax=sampled.max(0);mean=sampled.mean(0)
   else:
    xy=np.clip(np.mean(u,axis=0)*4096,0,4095).astype(int);mean=np.r_[cache[state][0][xy[1],xy[0],:3],cache[state][1][xy[1],xy[0],1:3]];vmin=vmax=mean
   flat=bool(np.max(vmax-vmin)<.025)

   # Existing SmartUV charts have a common scale; physical area determines exact isotropic normalization.
   ua=0
   for p in polys:
    v=[np.array(uv[l].uv) for l in p.loop_indices]
    for k in range(1,len(v)-1):ua+=abs(float(np.cross(v[k]-v[0],v[k+1]-v[0])))*.5
   scale=math.sqrt(area/max(ua,1e-14));u=(u-u.mean(0))*scale
   # Hull charts are triangles to narrow strips; estimate rectangle occupancy at actual metre scale.
   best=None
   for angle in np.linspace(0,math.pi/2,19):
    rot=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]]);v=u@rot;s=np.ptp(v,axis=0);bb=float(np.prod(s))
    if best is None or bb<best[0]:best=(bb,s)
   report.append({'state':state,'object':o.name,'role':m.materials[polys[0].material_index].get('engine_name'),'chart':id,'faces':len(polys),'paint_min':vmin.tolist(),'paint_max':vmax.tolist(),'paint_mean':mean.tolist(),'flat_paint':flat,'area':area,'uv_area':ua,'rect_m':best[1].tolist(),'rect_area':best[0],'world_min':xyz.min(0).tolist(),'world_max':xyz.max(0).tolist()})
with (OUT/'chart-paint-inventory.json').open('x') as f:json.dump(report,f,indent=2)
for state in ('lark','lark_damaged','lark_husked'):
 for role in ('Hull','Accent','Trim','Dark'):
  cs=[c for c in report if c['state']==state and c['role']==role];print(state,role,len(cs),'m2',round(sum(c['area'] for c in cs),2),'rectm2',round(sum(c['rect_area'] for c in cs),2),'NONFLATAREA',round(sum(c['area'] for c in cs if not c['flat_paint']),2),'NONFLATRECT',round(sum(c['rect_area'] for c in cs if not c['flat_paint']),2),'largest',sorted([c['rect_area'] for c in cs],reverse=True)[:3],flush=True)
