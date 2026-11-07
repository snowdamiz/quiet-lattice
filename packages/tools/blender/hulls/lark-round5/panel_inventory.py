import bpy,bmesh,json
from pathlib import Path
D=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(D.parents[4]/'assets/blend/hulls/lark.blend'))
rows=[]
for name in ['Body','Body_husk','LandingMechanismMesh']:
 o=bpy.data.objects[name];m=bmesh.new();m.from_mesh(o.data);m.transform(o.matrix_world);m.faces.ensure_lookup_table();seen=set()
 for seed in m.faces:
  if seed in seen:continue
  stack=[seed];seen.add(seed);fs=[]
  while stack:
   f=stack.pop();fs.append(f)
   for e in f.edges:
    for n in e.link_faces:
     if n not in seen:seen.add(n);stack.append(n)
  vs=set(v for f in fs for v in f.verts)
  rows.append(dict(object=name,id=min(f.index for f in fs),faces=len(fs),materials=sorted(set(o.data.materials[f.material_index].name for f in fs)),area=sum(f.calc_area() for f in fs),bounds=[[min(v.co[i] for v in vs) for i in range(3)],[max(v.co[i] for v in vs) for i in range(3)]]))
 m.free()
(D/'panel-inventory.json').write_text(json.dumps(rows,indent=2))
