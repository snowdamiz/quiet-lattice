"""Measure whole-part geometric reuse candidates without saving or altering geometry."""
import bpy,json,itertools,numpy as np
from pathlib import Path
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
report={}
for coll in bpy.data.collections:
 if not coll.name.endswith('_LOD0'):continue
 parts=[]
 for o in coll.objects:
  if o.type!='MESH':continue
  m=o.data;parents=list(range(len(m.vertices)))
  def root(a):
   while parents[a]!=a:parents[a]=parents[parents[a]];a=parents[a]
   return a
  for e in m.edges:a,b=e.vertices;parents[root(a)]=root(b)
  groups={}
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ['Hull','Accent','Trim','Dark']:continue
   groups.setdefault((root(p.vertices[0]),role),[]).append(p)
  for (id,role),fs in groups.items():
   ids=sorted({v for p in fs for v in p.vertices});co=np.array([o.matrix_world@m.vertices[v].co for v in ids]);center=co.mean(0);p=co-center;_,_,v=np.linalg.svd(p,full_matrices=False);q=p@v.T;size=np.ptp(q,axis=0)
   parts.append({'name':o.name,'component':id,'role':role,'area':sum(f.area for f in fs),'center':center.tolist(),'n':len(ids),'co':q,'size':size,'faces':len(fs)})
 groups=[]
 for p in sorted(parts,key=lambda p:p['area'],reverse=True):
  match=None
  # Include all geometric symmetries; paint compatibility is still unresolved and explicitly not inferred.
  for g in groups:
   r=g['rep']
   if p['role']!=r['role'] or p['n']!=r['n'] or p['faces']!=r['faces'] or np.max(np.abs(p['size']-r['size']))>.012:continue
   for signs in itertools.product((-1,1),repeat=3):
    q=p['co']*signs
    if max(g['kd'].find(v)[2] for v in q)<.012:match=g;break
   if match:break
  if match:match['members'].append(p)
  else:
   kd=KDTree(p['n'])
   for i,v in enumerate(p['co']):kd.insert(v,i)
   kd.balance();groups.append({'rep':p,'members':[p],'kd':kd})
 report[coll.name]=[{'representative':{k:v for k,v in g['rep'].items() if k not in ['co','size']},'members':[{k:v for k,v in p.items() if k not in ['co','size']} for p in g['members']]} for g in groups]
 for role in ['Hull','Accent','Trim','Dark']:
  gs=[g for g in groups if g['rep']['role']==role];print(coll.name,role,'total',round(sum(p['area'] for p in parts if p['role']==role),2),'templates',round(sum(g['rep']['area'] for g in gs),2),'groups',len(gs),'parts',sum(len(g['members']) for g in gs),flush=True)
with (OUT/'congruent-part-candidates.json').open('x') as f:json.dump(report,f,indent=2)
