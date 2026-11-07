import bpy,bmesh,json
from pathlib import Path
P=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
o=bpy.data.objects['Body'];bm=bmesh.new();bm.from_mesh(o.data);seen=set();r=[]
for f in bm.faces:
 if f in seen:continue
 todo=[f];seen.add(f);fs=[]
 while todo:
  a=todo.pop();fs.append(a)
  for e in a.edges:
   for b in e.link_faces:
    if b not in seen:seen.add(b);todo.append(b)
 r.append([len(fs),sum(f.calc_area() for f in fs)])
print('COMPONENTS',sorted(r,reverse=True)[:50])
