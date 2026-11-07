"""Read-only deterministic exterior armor survey; original polygon IDs retained."""
import bpy,bmesh,json,math,random,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
for s in bpy.data.scenes:
 s.render.threads=2;s.render.threads_mode='FIXED';s.cycles.device='CPU';s.cycles.use_denoising=False
body=bpy.data.objects['Body'];m=body.data
bm=bmesh.new();bm.from_mesh(m);bm.faces.ensure_lookup_table();seen=set();components=[];owner={}
for seed in bm.faces:
 if seed.index in seen:continue
 stack=[seed];seen.add(seed.index);ids=[]
 while stack:
  f=stack.pop();ids.append(f.index)
  for e in f.edges:
   for n in e.link_faces:
    if n.index not in seen:seen.add(n.index);stack.append(n)
 cid=min(ids)
 for i in ids:owner[i]=cid
 components.append({'id':cid,'face_ids':sorted(ids),'materials':sorted({m.materials[m.polygons[i].material_index].name for i in ids})})
bm.free()
def tree(coll):
 vs=[];fs=[];meta=[]
 for o in bpy.data.collections[coll].all_objects:
  if o.type!='MESH' or o.name.startswith(('COL_','REF_')):continue
  me=o.data;me.calc_loop_triangles()
  for t in me.loop_triangles:
   fs.append(tuple(range(len(vs),len(vs)+3)));vs.extend(o.matrix_world@me.vertices[i].co for i in t.vertices)
   meta.append((o.name,t.polygon_index,me.materials[t.material_index].name))
 return BVHTree.FromPolygons(vs,fs,all_triangles=True),meta
ref,rm=tree('lark_LOD0');husk,hm=tree('lark_husked_LOD0')
m.calc_loop_triangles();tris=[]
for t in m.loop_triangles:
 mat=m.materials[t.material_index].name
 if mat not in ('Lark_Hull','Lark_Accent'):continue
 a,b,c=[body.matrix_world@m.vertices[i].co for i in t.vertices];cross=(b-a).cross(c-a)
 if cross.length<1e-10:continue
 tris.append((t.polygon_index,a,b,c,cross.normalized(),cross.length/2))
directions=[Vector((math.sqrt(1-z*z)*math.cos(i*2.399963229728653),math.sqrt(1-z*z)*math.sin(i*2.399963229728653),z)) for i in range(48) for z in [1-2*(i+.5)/48]]

# Geometry identity, independent of material semantics.
geom={};owners={}
for o in bpy.data.collections['lark_husked_LOD0'].all_objects:
 if o.type!='MESH':continue
 b=bmesh.new();b.from_mesh(o.data);b.faces.ensure_lookup_table();seen=set()
 for seed in b.faces:
  if seed.index in seen:continue
  stack=[seed];seen.add(seed.index);fs=[]
  while stack:
   f=stack.pop();fs.append(f)
   for e in f.edges:
    for q in e.link_faces:
     if q.index not in seen:seen.add(q.index);stack.append(q)
  cid=min(f.index for f in fs);key=o.name+':'+str(cid);vs={v for f in fs for v in f.verts};pts=[o.matrix_world@v.co for v in vs]
  bounds=[[min(v[i] for v in pts),max(v[i] for v in pts)] for i in range(3)]
  geom[key]=dict(object=o.name,component_id=cid,faces=len(fs),bounds=bounds,dimensions=[hi-lo for lo,hi in bounds],materials=sorted({o.data.materials[f.material_index].name for f in fs}),area=sum(f.calc_area() for f in fs))
  for f in fs:owners[(o.name,f.index)]=key
 b.free()
hits={}
for fid,a,b,c,n,area in tris:
 p=(a+b+c)/3
 for d in [n]+[d for d in directions if d.dot(n)>.25]:
  h=ref.ray_cast(p+d*30,-d,30.005)
  if h[0] is None or (h[0]-p).length>=.001 or rm[h[2]][:2]!=('Body',fid):continue
  h=husk.ray_cast(p+d*30,-d,60)
  if h[0] is not None:
   obj,poly,mat=hm[h[2]]
   if (h[0]-p).dot(d)<-.05 or not ('Hull' in mat or 'Accent' in mat):
    key=owners[(obj,poly)];r=hits.setdefault(key,dict(area=0,count=0,rays=[]));r['area']+=area;r['count']+=1
    if len(r['rays'])<4:r['rays'].append(dict(reference_component=owner[fid],reference_face=fid,origin=list(p+d*30),direction=list(-d),hit=list(h[0]),hit_polygon=poly))
  break
report=dict(source_sha256=hashlib.sha256(src.read_bytes()).hexdigest(),components=geom,missing_plate_hits=hits,method='Exterior triangle centroid rays; diagnostic geometry identity, not replacement plate denominator.')
(D/'semantic-geometry.json').write_text(json.dumps(report,indent=2))
