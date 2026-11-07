import runpy,sys,json,bpy,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent
def protected():
 result={}
 for o in bpy.data.objects:
  if o.type!='MESH' or o.name.startswith('Cockpit'):continue
  m=o.data
  result[o.name]=hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],[tuple(n.vector) for n in m.corner_normals],[[tuple(x.uv) for x in u.data] for u in m.uv_layers])).encode()).hexdigest()
 return result
bpy.ops.wm.open_mainfile(filepath=str(D/'scratch/cockpit-before.blend'));old=protected()
runpy.run_path(str(D/'cockpit_density.py'),run_name='__main__')
assert old==protected(), 'Non-cockpit geometry or UV changed'
(D/'cockpit-preservation.json').write_text(json.dumps({'protected_meshes':len(old),'identical':True},indent=2))
counts={}
for v in ('lark','lark_damaged','lark_husked'):
 counts[v]=[]
 for l in range(4):
  n=0
  for o in bpy.data.collections[f'{v}_LOD{l}'].all_objects:
   if o.type=='MESH':o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
  counts[v].append(n)
 a=counts[v];assert 60000<=a[0]<=150000 and all(x>y for x,y in zip(a,a[1:])) and a[3]<a[0]*.05
(D/'cockpit-lod.json').write_text(json.dumps(counts,indent=2))
sys.path.insert(0,str(D.parents[1]));sys.argv=['validate.py','--',str(D.parents[4]/'assets/blend/hulls/lark.blend'),'--family','hulls','--report',str(D/'cockpit-validation.json')]
runpy.run_path(str(D.parents[1]/'validate.py'),run_name='__main__')
