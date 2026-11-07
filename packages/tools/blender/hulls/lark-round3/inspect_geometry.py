import bpy,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
R=Path(__file__).resolve().parents[5];bpy.ops.wm.open_mainfile(filepath=str(R/'assets/blend/hulls/lark.blend'))
for n in ['Body','CockpitMechanismMesh','LandingMechanismMesh','CanopyGlass']:
 o=bpy.data.objects[n];ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());pts=[ev.matrix_world@v.co for v in ev.data.vertices]
 print(n,'MIN',[min(v[i] for v in pts) for i in range(3)],'MAX',[max(v[i] for v in pts) for i in range(3)],'hide',o.hide_render,'camera',o.visible_camera,'rotation_mode',o.rotation_mode,'parent',o.parent.name if o.parent else None)
 if n=='Body':
  tree=BVHTree.FromPolygons([tuple(v) for v in pts],[p.vertices[:] for p in ev.data.polygons])
  for x,y in [(0,1.15),(0,.6),(0,1.9),(-.9,.95)]:
   p=Vector((x,y,10));hits=[]
   for i in range(8):
    h=tree.ray_cast(p,Vector((0,0,-1)))
    if h[0] is None:break
    hits.append((list(h[0]),ev.data.materials[ev.data.polygons[h[2]].material_index].name));p=h[0]+Vector((0,0,-.001))
   print('RAY',x,y,hits)

print('CANOPY MODE',bpy.data.objects['Canopy'].rotation_mode)

for o in bpy.data.collections['lark_LOD0'].objects:
 print('VIS',o.name,[c.name for c in o.users_collection],o.hide_render,o.hide_viewport,o.hide_get(),o.visible_get(),o.show_instancer_for_render,[(md.name,md.show_render) for md in o.modifiers])

body=bpy.data.objects['Body'];tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],[p.vertices[:] for p in body.data.polygons])
for x in [-3.2,-3,-2.8,-2.6,-2.4,-2.2,-2,-1.8,-1.6,-1.4,-1.2,-1]:
 h=tree.ray_cast(Vector((x,.95,8)),Vector((0,0,-1)))
 print('BOARDING_SURFACE',x,list(h[0]) if h[0] else None)
