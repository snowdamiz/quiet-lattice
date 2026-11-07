import bpy,bmesh,json,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
r=json.loads((D/'semantic-receipt.json').read_text())
body=bpy.data.objects['Body_husk']; regions=[]
for key,item in r['selected_blocking_candidates'].items():
 for ray in item['ray_evidence']['rays']:
  p=body.data.polygons[ray['hit_polygon']]
  pts=[body.matrix_world@body.data.vertices[i].co for i in p.vertices]
  regions.append((key,[[min(v[i] for v in pts)-.0001,max(v[i] for v in pts)+.0001] for i in range(3)]))
report={'operation':'Remove only recorded backing hit faces and spatially corresponding lower LOD faces','removed':{},'regions':regions,'outer_plate_proxy_counts':r['plate_count_audit'],'frame_proof':[]}
for lod in range(4):
 for o in bpy.data.collections[f'lark_husked_LOD{lod}'].all_objects:
  if o.type!='MESH' or not o.name.startswith('Body_husk'):continue
  bm=bmesh.new();bm.from_mesh(o.data);bm.faces.ensure_lookup_table();remove=[]
  for f in bm.faces:
   mat=o.data.materials[f.material_index].name
   if mat!='LarkHusk_HuskDark':continue
   pts=[o.matrix_world@v.co for v in f.verts]
   if any(all(all(lo<=v[i]<=hi for i,(lo,hi) in enumerate(bounds)) for v in pts) for key,bounds in regions):remove.append(f)
  report['removed'][o.name]=len(remove)
  bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(o.data);bm.free();o.data.update()
assert report['removed'].get('Body_husk',0)>0
# Audit first-hit identity without equating dark material with frame.
vs=[];fs=[];meta=[]
for o in bpy.data.collections['lark_husked_LOD0'].all_objects:
 if o.type!='MESH' or o.name.startswith(('COL_','REF_')):continue
 o.data.calc_loop_triangles()
 for t in o.data.loop_triangles:
  fs.append(tuple(range(len(vs),len(vs)+3)));vs.extend(o.matrix_world@o.data.vertices[i].co for i in t.vertices);meta.append([o.name,t.polygon_index])
tree=BVHTree.FromPolygons(vs,fs,all_triangles=True)
for key,item in r['selected_blocking_candidates'].items():
 for ray in item['ray_evidence']['rays']:
  hit=tree.ray_cast(Vector(ray['origin']),Vector(ray['direction']),60)
  report['frame_proof'].append({'before_component':key,'before_hit':ray['hit'],'after_first_hit':meta[hit[2]] if hit[0] is not None else None,'after_position':list(hit[0]) if hit[0] is not None else None,'recognized_frame':False})
report['lod_triangles']={}
for variant in ('lark','lark_damaged','lark_husked'):
 counts=[]
 for lod in range(4):
  count=0
  for o in bpy.data.collections[f'{variant}_LOD{lod}'].all_objects:
   if o.type=='MESH':o.data.calc_loop_triangles();count+=len(o.data.loop_triangles)
  counts.append(count)
 assert 60000<=counts[0]<=150000 and all(a>b for a,b in zip(counts,counts[1:])) and counts[3]<counts[0]*.05
 report['lod_triangles'][variant]=counts
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(src))
report['source_sha256']=hashlib.sha256(src.read_bytes()).hexdigest()
report['status']='BACKING_EDIT_SAVED_FRAME_QUALIFICATION_PENDING'
(D/'frame-knownfix.json').write_text(json.dumps(report,indent=2))
