import bpy,json,os
from pathlib import Path
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/swift.blend').resolve()))
out={'meshes':{},'materials':{}}
for c in bpy.data.collections:
 if not c.name.endswith('_LOD0'):continue
 for o in c.objects:
  if o.type!='MESH':continue
  mesh=o.data;adj=[[] for _ in mesh.vertices]
  for e in mesh.edges:a,b=e.vertices;adj[a].append(b);adj[b].append(a)
  seen=set();groups=[]
  for v in mesh.vertices:
   if v.index in seen:continue
   todo=[v.index];seen.add(v.index);verts=[]
   while todo:
    i=todo.pop();verts.append(i)
    for n in adj[i]:
     if n not in seen:seen.add(n);todo.append(n)
   group=set(verts);faces=[p for p in mesh.polygons if p.vertices[0] in group];co=[o.matrix_world@mesh.vertices[i].co for i in verts]
   lo=[min(v[i] for v in co) for i in range(3)];hi=[max(v[i] for v in co) for i in range(3)]
   groups.append({'index':len(groups),'v0':min(verts),'vertices':len(verts),'triangles':sum(len(p.vertices)-2 for p in faces),'min':[round(x,4) for x in lo],'max':[round(x,4) for x in hi],'materials':sorted(set(o.material_slots[p.material_index].material.name for p in faces))})
  out['meshes'][o.name]={'islands':groups,'attributes':[(a.name,a.domain,a.data_type) for a in mesh.attributes],'groups':[g.name for g in o.vertex_groups]}
for m in bpy.data.materials:
 if not m.use_nodes:continue
 out['materials'][m.name]={'nodes':[{ 'name':n.name,'type':n.type,'label':n.label,'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None,'values':{i.name:str(i.default_value[:]) if hasattr(i.default_value,'__len__') else str(i.default_value) for i in n.inputs if hasattr(i,'default_value') and not i.is_linked}} for n in m.node_tree.nodes], 'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links]}
Path(os.environ['SWIFT_JOB'],'details.json').write_text(json.dumps(out,indent=2));print('DETAILS',len(out['meshes']))
