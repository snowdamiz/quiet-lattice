import bpy,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
before=json.loads((P.parent/'pane-probe.json').read_text());old=BVHTree.FromPolygons(before['vertices'],before['polygons'])
o=bpy.data.objects['CanopyGlass'];new=BVHTree.FromPolygons([v.co for v in o.data.vertices],[list(f.vertices) for f in o.data.polygons])
v=bpy.data.objects['CanopyFrame'].data.vertices
points=[sum((v[j].co for j in range(i*8,i*8+8)),Vector())/8 for b in range(4) for i in range(b*21+1,b*21+20)]
r={label:dict(max_m=max(d),mean_m=sum(d)/len(d),samples=len(d)) for label,tree in [('before',old),('after',new)] for d in [[tree.find_nearest(p)[3] for p in points]]}
for o in bpy.data.objects:
 if o.type=='MESH' and o.name.startswith('CanopyGlass'):
  assert len(o.data.uv_layers)==1 and o.data.uv_layers[0].name=='UVMap' and o.data.uv_layers[0].active_render
(P.parent/'glazing-fit-measurements.json').write_text(json.dumps(r,indent=2));print(r)
