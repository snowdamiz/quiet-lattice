"""Read-only source identity bridge for Body polygon/pid attributes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
import bpy
ap=argparse.ArgumentParser()
for k in ('source','sha256','output'): ap.add_argument('--'+k,required=True)
a=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
assert hashlib.sha256(Path(a.source).read_bytes()).hexdigest()==a.sha256
bpy.ops.wm.open_mainfile(filepath=a.source,load_ui=False,use_scripts=False)
rows=[]
depsgraph=bpy.context.evaluated_depsgraph_get()
for variant in ('lark','lark_damaged','lark_husked'):
 for lod in range(4):
  coll=bpy.data.collections[f'{variant}_LOD{lod}']
  for o in coll.all_objects:
   if o.type!='MESH' or not o.name.startswith('Body'):continue
   m=o.data;ev=o.evaluated_get(depsgraph).data
   assert [tuple(v.co)for v in m.vertices]==[tuple(v.co)for v in ev.vertices]
   assert [tuple(p.vertices)for p in m.polygons]==[tuple(p.vertices)for p in ev.polygons]
   m.calc_loop_triangles()
   pid=m.attributes.get('pid');plate=m.attributes.get('plate')
   rows.append(dict(scene=coll.name,object=o.name,world_vertices=[list(o.matrix_world@v.co)for v in m.vertices],
    faces=[list(p.vertices)for p in m.polygons],triangle_vertices=[list(t.vertices)for t in m.loop_triangles],
    triangle_polygons=[t.polygon_index for t in m.loop_triangles],
    polygon_roles=[m.materials[p.material_index].get('engine_name',m.materials[p.material_index].name) for p in m.polygons],
    polygon_pids=[int(v.value)for v in pid.data]if pid else None,
    plate_flags=[v.value for v in plate.data]if plate else None))
with gzip.open(a.output,'wt',encoding='utf8') as f:json.dump(dict(source_sha256=a.sha256,objects=rows),f,separators=(',',':'))
assert hashlib.sha256(Path(a.source).read_bytes()).hexdigest()==a.sha256
print(json.dumps(dict(objects=len(rows),output=a.output,source_unchanged=True)))
