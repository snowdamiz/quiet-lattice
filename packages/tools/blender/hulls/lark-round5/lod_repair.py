import bpy,bmesh,json,hashlib,math
from pathlib import Path
P=Path(__file__).resolve();src=P.parents[5]/'assets/blend/hulls/lark.blend'
assert hashlib.sha256(src.read_bytes()).hexdigest()=='e6e7d8c4cf73bfe22cdb18c0c5b7eb85c4b1baab46a2133a1fd304a68bf7c129'
bpy.ops.wm.open_mainfile(filepath=str(src)); rows=[]
for v in ('lark','lark_damaged','lark_husked'):
 body=next(o for o in bpy.data.collections[v+'_LOD0'].objects if o.name.startswith('Body'))
 for level,angle in ((1,.04),(2,.12)):
  o=next(o for o in bpy.data.collections[f'{v}_LOD{level}'].objects if o.name.startswith('Body'))
  o.data=body.data.copy();bm=bmesh.new();bm.from_mesh(o.data)
  bmesh.ops.dissolve_limit(bm,angle_limit=angle,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit={'MATERIAL','SEAM','SHARP','UV','NORMAL'})
  bm.to_mesh(o.data);bm.free();o.data.update();o.data.calc_loop_triangles()
  rows.append([o.name,len(o.data.loop_triangles)])
print('COUNTS',rows)
(P.parent/'lod-repair-counts.json').write_text(json.dumps(rows))
bpy.ops.wm.save_as_mainfile(filepath=str(P.parent/'scratch/repaired.blend'),compress=True)
