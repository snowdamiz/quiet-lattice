import bpy,json,hashlib
from pathlib import Path
P=Path(__file__).resolve();src=P.parents[5]/'assets/blend/hulls/lark.blend'
def digest(o):
 m=o.data
 return hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],[[tuple(x.uv) for x in u.data] for u in m.uv_layers])).encode()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(src))
protected={o.name:digest(o) for o in bpy.data.objects if o.type=='MESH' and not (o.name.startswith('Body') and any(o in c.objects.values() for c in bpy.data.collections if c.name.endswith(('_LOD1','_LOD2'))))}
bpy.ops.wm.open_mainfile(filepath=str(P.parent/'scratch/repaired.blend'))
assert all(digest(bpy.data.objects[n])==h for n,h in protected.items())
counts={}
for v in ('lark','lark_damaged','lark_husked'):
 counts[v]=[]
 for l in range(4):
  n=0
  for o in bpy.data.collections[f'{v}_LOD{l}'].all_objects:
   if o.type=='MESH':o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
  counts[v].append(n)
 a=counts[v];assert 60000<=a[0]<=150000 and all(x>y for x,y in zip(a,a[1:])) and a[3]<a[0]*.05
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(P.parent/'lod-installed-validation.json').write_text(json.dumps(dict(counts=counts,protected_meshes=len(protected),source_sha256=hashlib.sha256(src.read_bytes()).hexdigest(),disposition='installed; runtime cost unqualified'),indent=2))
