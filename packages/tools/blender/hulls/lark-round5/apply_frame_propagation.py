import bpy,bmesh,json,hashlib
from collections import Counter
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
D=Path(__file__).resolve().parent
source=D.parents[4]/'assets/blend/hulls/lark.blend'
probe=json.loads((D/'frame-propagation-probe.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest()=='2930843029aa4b4398adccacc003831bf298a0ddabfb539e1fc834397f2f863e', 'Requires original c6b47f6b0 source'
bpy.ops.wm.open_mainfile(filepath=str(source))
def signatures(o):
 m=o.data
 return Counter((p.material_index,p.use_smooth,tuple((tuple(m.vertices[m.loops[i].vertex_index].co),tuple(tuple(u.data[i].uv) for u in m.uv_layers)) for i in p.loop_indices)) for p in m.polygons)
def summary():
 out={}
 for name in ('lark','lark_damaged','lark_husked'):
  out[name]=[]
  for lod in range(4):
   obs=[o for o in bpy.data.collections[f'{name}_LOD{lod}'].all_objects if o.type=='MESH']
   for o in obs:o.data.calc_loop_triangles()
   pts=[o.matrix_world@Vector(v) for o in obs for v in o.bound_box]
   out[name].append(dict(triangles=sum(len(o.data.loop_triangles) for o in obs),bounds=[[min(v[i] for v in pts),max(v[i] for v in pts)] for i in range(3)]))
 return out
def rays(o):
 m=o.data; tree=BVHTree.FromPolygons([o.matrix_world@v.co for v in m.vertices],[list(p.vertices) for p in m.polygons])
 rows=[]
 for j,tri in enumerate(probe['footprints']):
  a,b,c=map(Vector,tri);n=(b-a).cross(c-a).normalized()
  for weights in ((1/3,1/3,1/3),(.6,.2,.2),(.2,.6,.2),(.2,.2,.6)):
   q=a*weights[0]+b*weights[1]+c*weights[2]
   for side in (-1,1):
    pos,normal,index,distance=tree.ray_cast(q+n*.15*side,-n*side,.3)
    rows.append(dict(footprint=j,weights=weights,side=side,hit_polygon=index,hit=list(pos) if pos else None,material=m.materials[m.polygons[index].material_index].name if index is not None else None,distance=distance,backing_plane_hit=bool(pos is not None and abs((pos-q).dot(n))<.025 and abs(normal.dot(n))>.95)))
 return rows
before=summary(); untouched={o.name:signatures(o) for o in bpy.data.objects if o.type=='MESH'}
report=dict(before=before,lods={},exports_rerun=False,current_glb_stale=True)
for lod in range(4):
 o=bpy.data.objects[probe['lods'][str(lod)]['object']]
 pre=rays(o); ids=set()
 if lod in (1,2):
  for row in probe['lods'][str(lod)]['matched_faces']:
   p=o.data.polygons[row['polygon']];c=sum((o.matrix_world@o.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
   assert (c-Vector(row['world_centroid'])).length<1e-5
   assert o.data.materials[p.material_index].name=='LarkHusk_HuskDark'
   ids.add(p.index)
 if lod==3:
  ids={r['hit_polygon'] for r in pre if r['material']=='LarkHusk_HuskDark' and r['backing_plane_hit']}
  # A broad face hit by an opening ray is backing even if its centroid lies outside.
 removed=[]
 for i in sorted(ids):
  p=o.data.polygons[i];removed.append(dict(polygon=i,vertices=[list(o.matrix_world@o.data.vertices[v].co) for v in p.vertices]))
 if ids:
  expected=signatures(o)
  for p in o.data.polygons:
   if p.index in ids:
    m=o.data
    sig=(p.material_index,p.use_smooth,tuple((tuple(m.vertices[m.loops[i].vertex_index].co),tuple(tuple(u.data[i].uv) for u in m.uv_layers)) for i in p.loop_indices))
    expected[sig]-=1
  bm=bmesh.new();bm.from_mesh(o.data);bm.faces.ensure_lookup_table()
  bmesh.ops.delete(bm,geom=[bm.faces[i] for i in ids],context='FACES_ONLY');bm.to_mesh(o.data);bm.free();o.data.update()
  assert +expected==signatures(o),'surviving face/UV/material mismatch'
  untouched.pop(o.name)
 report['lods'][str(lod)]=dict(removed_count=len(ids),removed=removed,rays_before=pre,rays_after=rays(o),reason='Confirmed probe backing removed' if ids else ('Existing LOD0 fix preserved' if lod==0 else 'No coplanar HuskDark backing intersected 256 bidirectional rays across 32 opening triangles. Nearby hits are offset or angled coarse geometry, not backing sheets (plane tolerance 0.025m, normal dot >0.95).'))
for name,sigs in untouched.items():assert signatures(bpy.data.objects[name])==sigs,name
report['after']=summary()
for name,levels in report['after'].items():
 counts=[x['triangles'] for x in levels]
 assert all(a>b for a,b in zip(counts,counts[1:])),(name,counts)
 assert counts[3]<counts[0]*.05,(name,counts)
 assert 60000<=counts[0]<=150000,(name,counts)
 assert levels==before[name] if name!='lark_husked' else all(x['bounds']==y['bounds'] for x,y in zip(levels,before[name]))
report['preservation']='All surviving face coordinates, UVs, material indices and smoothing preserved; untouched meshes identical; bounds unchanged.'
report['source_before_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(source))
report['source_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()
(D/'frame-propagation-applied.json').write_text(json.dumps(report,indent=2))
print('APPLIED',[(k,v['removed_count']) for k,v in report['lods'].items()]);print('COUNTS',report['after'])
