import bpy,json
from pathlib import Path
from mathutils.geometry import closest_point_on_tri
D=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(D/'scratch/frame-reference.blend'))
r=json.loads((D/'semantic-receipt.json').read_text())
o=bpy.data.objects['Body_husk'];o.data.calc_loop_triangles()
ids={ray['hit_polygon'] for item in r['selected_blocking_candidates'].values() for ray in item['ray_evidence']['rays']}
footprints=[[o.matrix_world@o.data.vertices[i].co for i in t.vertices] for t in o.data.loop_triangles if t.polygon_index in ids]
bpy.ops.wm.open_mainfile(filepath=str(D.parents[4]/'assets/blend/hulls/lark.blend'))
report={'method':'World-space triangle projection and normal-plane proximity; diagnostic only','footprints':[[list(v) for v in tri] for tri in footprints],'lods':{}}
for lod in range(4):
 o=next(o for o in bpy.data.collections[f'lark_husked_LOD{lod}'].all_objects if o.type=='MESH' and o.name.startswith('Body_husk'))
 rows=[]
 for p in o.data.polygons:
  if o.data.materials[p.material_index].name!='LarkHusk_HuskDark':continue
  pts=[o.matrix_world@o.data.vertices[i].co for i in p.vertices];c=sum(pts,pts[0]*0)/len(pts)
  matches=[]
  for j,(a,b,c0) in enumerate(footprints):
   n=(b-a).cross(c0-a).normalized()
   if abs(n.dot(o.matrix_world.to_3x3()@p.normal))<.95:continue
   if abs(n.dot(c-a))>.025:continue
   q=c-n*n.dot(c-a)
   if (closest_point_on_tri(q,a,b,c0)-q).length<.001:matches.append(j)
  if matches:rows.append({'polygon':p.index,'footprints':matches,'world_centroid':list(c),'area':p.area})
 report['lods'][str(lod)]={'object':o.name,'matched_count':len(rows),'matched_faces':rows}
(D/'frame-propagation-probe.json').write_text(json.dumps(report,indent=2))
print({k:v['matched_count'] for k,v in report['lods'].items()})
