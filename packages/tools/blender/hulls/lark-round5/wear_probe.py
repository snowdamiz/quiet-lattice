import bpy,json
from pathlib import Path
D=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(D.parents[4]/'assets/blend/hulls/lark.blend'))
r=[]
for o in bpy.data.collections['lark_LOD0'].all_objects:
 if o.type!='MESH':continue
 print(o.name,len(o.data.polygons))
 if 'Cockpit' not in o.name:continue
 m=o.data;adj=[set() for v in m.vertices]
 for e in m.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
 unseen=set(range(len(adj)))
 while unseen:
  group={unseen.pop()};todo=list(group)
  while todo:
   for j in adj[todo.pop()]:
    if j in unseen:unseen.remove(j);group.add(j);todo.append(j)
  faces=[p for p in m.polygons if p.vertices[0] in group];pts=[o.matrix_world@m.vertices[j].co for j in group]
  r.append(dict(object=o.name,first=faces[0].index,bounds=[[min(v[k] for v in pts),max(v[k] for v in pts)] for k in range(3)],materials=list({m.materials[p.material_index].name for p in faces})))
(D/'wear-probe.json').write_text(json.dumps(r,indent=2))
