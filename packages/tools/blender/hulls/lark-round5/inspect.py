import bpy,json
from pathlib import Path
p=Path(__file__).resolve(); root=p.parents[5]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blend/hulls/lark.blend'))
rows=[]
for c in bpy.data.collections:
 if c.name.startswith('lark'):
  for o in c.objects:
   if o.type=='MESH':
    o.data.calc_loop_triangles()
    rows.append(dict(collection=c.name,name=o.name,tri=len(o.data.loop_triangles),smooth=sum(f.use_smooth for f in o.data.polygons),faces=len(o.data.polygons),custom=o.data.has_custom_normals,uv=[x.name for x in o.data.uv_layers],materials=[s.material.name if s.material else None for s in o.material_slots]))
(p.parent/'inspection.json').write_text(json.dumps(rows,indent=2))
