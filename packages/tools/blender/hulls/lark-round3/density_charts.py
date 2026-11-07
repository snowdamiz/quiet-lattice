"""Inventory existing UV charts and material allocation without modifying the saved source."""
import bpy,sys,json,math,hashlib
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
SRC=ROOT/'assets/blend/hulls/lark.blend';bpy.ops.wm.open_mainfile(filepath=str(SRC))
report=[]
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
   report.append({'state':state,'object':o.name,'role':m.materials[polys[0].material_index].get('engine_name'),'chart':id,'faces':len(polys),'area':area,'uv_area':ua,'rect_m':best[1].tolist(),'rect_area':best[0],'world_min':xyz.min(0).tolist(),'world_max':xyz.max(0).tolist()})
with (OUT/'chart-inventory.json').open('x') as f:json.dump(report,f,indent=2)
for state in ('lark','lark_damaged','lark_husked'):
 for role in ('Hull','Accent','Trim','Dark'):
  cs=[c for c in report if c['state']==state and c['role']==role];print(state,role,len(cs),'m2',round(sum(c['area'] for c in cs),2),'rectm2',round(sum(c['rect_area'] for c in cs),2),'largest',sorted([c['rect_area'] for c in cs],reverse=True)[:3],flush=True)
