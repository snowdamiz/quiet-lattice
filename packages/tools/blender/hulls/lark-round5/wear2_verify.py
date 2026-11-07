import runpy,sys,json,bpy,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent
def protected():
 result={}
 for o in bpy.data.objects:
  if o.type!='MESH':continue
  m=o.data
  result[o.name]=hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],[tuple(n.vector) for n in m.corner_normals],[[tuple(x.uv) for x in u.data] for u in m.uv_layers])).encode()).hexdigest()
 return result
def state():
 return {'images':{i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file},'objects':{o.name:repr((list(o.matrix_world),dict(o))) for o in bpy.data.objects},'uv':{o.name:[(u.name,u.active_render) for u in o.data.uv_layers] for o in bpy.data.objects if o.type=='MESH'}}
bpy.ops.wm.open_mainfile(filepath=str(D/'scratch/wear2-before.blend'));old=protected();prior=state()
runpy.run_path(str(D/'wear2_density.py'),run_name='__main__')
assert old==protected(), 'Geometry or UV changed'
current=state();allowed={v+'_4k_density_'+m for v in ('lark','lark_damaged') for m in ('baseColor','ORM')}
assert prior['objects']==current['objects'] and prior['uv']==current['uv']
assert all(current['images'][n]==h for n,h in prior['images'].items() if n not in allowed)
(D/'wear2-integrity.json').write_text(json.dumps({'only_changed_images':sorted(n for n,h in prior['images'].items() if current['images'][n]!=h),'objects_transforms_properties_uv_preserved':True},indent=2))
(D/'wear2-preservation.json').write_text(json.dumps({'protected_meshes':len(old),'identical':True},indent=2))
counts={}
for v in ('lark','lark_damaged','lark_husked'):
 counts[v]=[]
 for l in range(4):
  n=0
  for o in bpy.data.collections[f'{v}_LOD{l}'].all_objects:
   if o.type=='MESH':o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
  counts[v].append(n)
 a=counts[v];assert 60000<=a[0]<=150000 and all(x>y for x,y in zip(a,a[1:])) and a[3]<a[0]*.05
(D/'wear2-lod.json').write_text(json.dumps(counts,indent=2))
sys.path.insert(0,str(D.parents[1]));sys.argv=['validate.py','--',str(D.parents[4]/'assets/blend/hulls/lark.blend'),'--family','hulls','--report',str(D/'wear2-validation.json')]
runpy.run_path(str(D.parents[1]/'validate.py'),run_name='__main__')
