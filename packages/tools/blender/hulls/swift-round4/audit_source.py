"""Budget and geometry audit specific to the saved Swift source, including the R3 LOD findings."""
import bpy,bmesh,json,math,os,hashlib
from pathlib import Path
from mathutils import Vector
source=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.view_layer.update()
out={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'variants':{},'failures':[]}
def signature(o):
 m=o.data;m.calc_loop_triangles()
 return {'vertices':[[round(float(c),7) for c in v.co] for v in m.vertices], 'faces':[list(p.vertices) for p in m.polygons], 'normals':[[round(float(c),7) for c in n.vector] for n in m.corner_normals]}
for variant in ['swift','swift_damaged','swift_husked']:
 item={'lods':{},'protected':{}};lodobjects={}
 for lod in range(4):
  coll=bpy.data.collections[variant+f'_LOD{lod}'];obs=[o for o in coll.objects if o.type=='MESH'];lodobjects[lod]=obs
  audit=[]
  for o in obs:
   m=o.data;m.calc_loop_triangles();bm=bmesh.new();bm.from_mesh(m)
   zero=sum(t.area<1e-10 for t in m.loop_triangles)
   face_keys=[tuple(sorted(p.vertices)) for p in m.polygons];duplicate_faces=len(face_keys)-len(set(face_keys))
   uv=m.uv_layers.active;uvzero=0
   if uv:
    for t in m.loop_triangles:
     a,b,c=[uv.data[i].uv for i in t.loops]
     if abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<1e-12:uvzero+=1
   finite=all(math.isfinite(c) for v in m.vertices for c in v.co)
   badnormals=sum(not all(math.isfinite(c) for c in n.vector) or abs(n.vector.length-1)>1e-4 for n in m.corner_normals)
   audit.append({'object':o.name,'triangles':len(m.loop_triangles),'vertices':len(m.vertices),'boundaryEdges':sum(e.is_boundary for e in bm.edges),'multiFaceEdges':sum(len(e.link_faces)>2 for e in bm.edges),'duplicateFaces':duplicate_faces,'zeroAreaTriangles':zero,'zeroAreaUVTriangles':uvzero,'finite':finite,'invalidCornerNormals':badnormals,'uvLayers':[u.name for u in m.uv_layers]})
   bm.free()
   if not finite or not uv or zero or uvzero or duplicate_faces or badnormals or audit[-1]['multiFaceEdges']:out['failures'].append(f'{variant}/LOD{lod}/{o.name}: finite={finite},UV={bool(uv)},zero={zero},uvZero={uvzero},duplicateFaces={duplicate_faces},badNormals={badnormals},multiFaceEdges={audit[-1]["multiFaceEdges"]}')
  item['lods'][str(lod)]={'triangles':sum(a['triangles'] for a in audit),'meshes':audit}
 for prefix in ['CanopyGlass','GearFront_leg','GearLeft_leg','GearRight_leg']:
  a=next(o for o in lodobjects[0] if o.name.startswith(prefix));b=next(o for o in lodobjects[2] if o.name.startswith(prefix))
  equal=signature(a)==signature(b);item['protected'][prefix]={'LOD0_LOD2_identicalVerticesFacesCornerNormals':equal,'triangles':sum(len(p.vertices)-2 for p in a.data.polygons)}
  pose_error=max(abs(a.matrix_world[r][c]-b.matrix_world[r][c]) for r in range(4) for c in range(4))
  item['protected'][prefix]['maxWorldTransformDifference']=pose_error
  if pose_error>1e-7:out['failures'].append(f'{variant} {prefix} world transform differs by {pose_error}')
  if not equal:out['failures'].append(f'{variant} {prefix} not identical')
 a=next(o for o in lodobjects[0] if o.name.startswith('Body'));b=next(o for o in lodobjects[2] if o.name.startswith('Body'))
 rear0=[v.co for v in a.data.vertices if v.co.y<-5.4];rear2=[v.co for v in b.data.vertices if v.co.y<-5.4]
 dist=max(min((v-w).length for w in rear2) for v in rear0) if rear2 else 999
 item['protected']['rearCrystalTip']={'maxLOD0ToLOD2VertexDistance':dist,'LOD0Vertices':len(rear0),'LOD2Vertices':len(rear2)}
 if dist>1e-5:out['failures'].append(f'{variant} rear tip moved {dist}')
 tris=[item['lods'][str(l)]['triangles'] for l in range(4)]
 item['LOD3Ratio']=tris[3]/tris[0]
 if not 60000<=tris[0]<=150000 or not all(a>b for a,b in zip(tris,tris[1:])) or item['LOD3Ratio']>=.05:out['failures'].append(f'{variant} budget {tris}')
 out['variants'][variant]=item
out['status']='PASS' if not out['failures'] else 'FAIL'
Path(os.environ['SWIFT_JOB'],'audit.json').write_text(json.dumps(out,indent=2))
print(json.dumps({'status':out['status'],'failures':out['failures'],'budgets':{k:[v['lods'][str(l)]['triangles'] for l in range(4)] for k,v in out['variants'].items()}}))
sys=__import__('sys');sys.exit(0 if not out['failures'] else 1)
