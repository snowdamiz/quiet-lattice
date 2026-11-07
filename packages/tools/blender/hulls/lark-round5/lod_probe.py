import bpy,json,bmesh
from pathlib import Path
P=Path(__file__).resolve(); bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
r=[]
for level in (0,1,2):
 o=next(o for o in bpy.data.collections[f'lark_LOD{level}'].objects if o.name.startswith('Body'));m=o.data
 bm=bmesh.new();bm.from_mesh(m)
 r.append(dict(lod=level,verts=len(m.vertices),faces=len(m.polygons),custom=m.has_custom_normals,modifiers=[(x.name,x.type) for x in o.modifiers],boundary=sum(e.is_boundary for e in bm.edges),nonmanifold=sum(not e.is_manifold for e in bm.edges),uv=[u.name for u in m.uv_layers]))
 if level==2:
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  bpy.ops.mesh.customdata_custom_splitnormals_clear()
print('PROBE',r)
(P.parent/'lod-probe.json').write_text(json.dumps(r,indent=2))
# temporary comparison only
bpy.ops.wm.save_as_mainfile(filepath=str(P.parent/'scratch/no-custom.blend'))
