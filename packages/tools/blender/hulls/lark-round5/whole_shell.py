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
runs=[];faces={};comps={}
for samples in (3,12,48):
 total=0;cats={str(t):{k:0. for k in ('present','trim_hit','dark_backing','other_hit','empty')} for t in (.02,.05,.1)};orient={};counts={}
 for fid,a,b,c,n,area in tris:
  rng=random.Random(71007+fid*101+int(area*1e7));visible=0
  for j in range(samples):
   u=math.sqrt(rng.random());v=rng.random();p=a*(1-u)+b*(u*(1-v))+c*(u*v)
   # First-hit visibility from infinity rejects buried skin and opposite plate thickness.
   ds=[n]+[d for d in directions if d.dot(n)>.25]
   good=None
   for d in ds:
    hit=ref.ray_cast(p+d*30,-d,30.005)
    if hit[0] is not None and (hit[0]-p).length<.001 and rm[hit[2]][:2]==('Body',fid):good=d;break
   if good is None:continue
   visible+=1;w=area/samples;total+=w
   axis=max(range(3),key=lambda i:abs(n[i]));key='xyz'[axis]+('+' if n[axis]>0 else '-')
   orient[key]=orient.get(key,0)+w
   for tol in (.02,.05,.1):
    h=husk.ray_cast(p+good*30,-good,60)
    if h[0] is None:cat='empty'
    else:
     mat=hm[h[2]][2];delta=(h[0]-p).dot(good)
     if delta>=-tol and ('Hull' in mat or 'Accent' in mat):cat='present'
     elif 'Trim' in mat:cat='trim_hit'
     elif 'Dark' in mat:cat='dark_backing'
     else:cat='other_hit'
    cats[str(tol)][cat]+=w
    if samples==48 and tol==.05:
     row=counts.setdefault(owner[fid],{'area':0,'missing':0});row['area']+=w;row['missing']+=w*(cat!='present')
  if samples==48 and visible:faces[fid]={'component':owner[fid],'material':m.materials[m.polygons[fid].material_index].name,'visible_area_m2':faces.get(fid,{}).get('visible_area_m2',0)+area*visible/samples}
 runs.append({'samples_per_triangle':samples,'exterior_area_m2':total,'orientation_area_m2':orient,'fractions':{t:{k:v/total for k,v in row.items()} for t,row in cats.items()}})
 if samples==48:comps=counts
 print(json.dumps(runs[-1]),flush=True)
report={'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'requirement':'15–30% of outer plates removed along their seams, exposing the frame beneath. Source does not define area or projected coverage denominator.','classification':'Body connected components, Hull/Accent only; polygon samples must be first visible hits from external sphere and front-facing. All orientations. Trim/Dark excluded from denominator. Hidden thickness excluded by first hit; exposed bevel edges retained.','method':'Area weighted seeded uniform barycentric samples; normal plus 48 Fibonacci sphere directions, first eligible unoccluded direction. Same external ray against complete husked LOD0. Presence depth tolerances 2/5/10 cm.','caveats':['Trim hit is a mechanical-material hit, not semantic proof of structural frame; dark backing never counted as frame.','Finite directional/sample convergence is an empirical sensitivity range, not a statistical confidence interval.','Disconnected components are candidate plates, not a proof each connected component is one authored panel.','Exposed bevel area retained; visible cavity lining can remain if Hull/Accent authored there. No visual PASS.'],'runs':runs,'components':components,'exterior_faces':faces,'component_measurements':comps}
(D/'whole-shell-measurement.json').write_text(json.dumps(report,indent=2))
