import bpy,json,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
def digest(o):
 m=o.data
 return hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],[[tuple(x.uv) for x in u.data] for u in m.uv_layers])).encode()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(src))
protected={o.name:digest(o) for o in bpy.data.objects if o.type=='MESH' and not o.name.startswith('Body_husk')}
bpy.ops.wm.open_mainfile(filepath=str(D/'scratch/husk-openings.blend'))
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
bpy.ops.wm.save_as_mainfile(filepath=str(src))
r={'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'protected_meshes_verified':len(protected),'lod_triangles':counts,'density':json.loads((D/'husk-density.json').read_text())['summary'],'previews':['husk-unit-overview.png','husk-unit-opening.png','husk-unit-final-opening.png'],'inspection':'Overview preserves broad hull outline. Close view shows ribs in front of open shoulder cavities. Final view adds sparse mint rib fragments. No visual PASS; rust remains restrained and glyph lettering/flicker are not demonstrated.','export':'not performed','cleanup':'none; all inherited scratch retained'}
(D/'husk-unit-receipt.json').write_text(json.dumps(r,indent=2))
