import bpy,bmesh,json
from pathlib import Path
P=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
r={}
for name in ('Body','Body_husk'):
 o=bpy.data.objects.get(name)
 if not o: print([o.name for o in bpy.data.collections['lark_husked_LOD0'].objects]);continue
 bm=bmesh.new();bm.from_mesh(o.data);seen=set();rows=[]
 for f in bm.faces:
  if f in seen:continue
  todo=[f];seen.add(f);fs=[]
  while todo:
   a=todo.pop();fs.append(a)
   for e in a.edges:
    for b in e.link_faces:
     if b not in seen:seen.add(b);todo.append(b)
  vs=set(v for f in fs for v in f.verts)
  rows.append(dict(faces=len(fs),area=sum(f.calc_area() for f in fs),bounds=[[min(v.co[i] for v in vs),max(v.co[i] for v in vs)] for i in range(3)],materials=sorted(set(o.data.materials[f.material_index].name for f in fs))))
 r[name]=rows;bm.free()
(P.parent/'husk-probe.json').write_text(json.dumps(r,indent=2))
print([(k,len(v)) for k,v in r.items()])
