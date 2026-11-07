"""Conservative geometric visibility inventory; no rendering and no source writes."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
report={}
dirs=[Vector((x,y,z)).normalized() for x in (-1,0,1) for y in (-1,0,1) for z in (-1,0,1) if x or y or z]
for c in bpy.data.collections:
 if not c.name.endswith('_LOD0'):continue
 obs=[o for o in c.objects if o.type=='MESH' and 'Glass' not in o.name];verts=[];tris=[]
 for o in obs:
  start=len(verts);verts.extend(o.matrix_world@v.co for v in o.data.vertices);o.data.calc_loop_triangles();tris.extend(tuple(start+i for i in t.vertices) for t in o.data.loop_triangles)
 bvh=BVHTree.FromPolygons(verts,tris,all_triangles=True,epsilon=.00001);records={};totals={}
 for o in obs:
  m=o.data;visible=[]
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name');coords=[o.matrix_world@m.vertices[i].co for i in p.vertices];center=sum(coords,Vector())/len(coords);normal=o.matrix_world.to_3x3()@p.normal
   vis=not o.name.startswith('Body')
   # Both sides; this is an intentionally conservative visibility classifier including all 26 exterior sectors.
   points=[center]+[center.lerp(v,.80) for v in coords] if p.area>.03 else [center]
   for point in points:
    if vis:break
    for d in dirs:
     if bvh.ray_cast(point+d*.001,d,100)[0] is None:vis=True;break
   if vis:visible.append(p.index)
   b=totals.setdefault(role,[0,0]);b[0]+=p.area
   if vis:b[1]+=p.area
  records[o.name]={'visible_polygons':visible,'total_polygons':len(m.polygons)}
 report[c.name]={'objects':records,'area_total_visible':totals}
 print(c.name,totals,flush=True)
with (OUT/'visibility-inventory.json').open('x') as f:json.dump(report,f)
