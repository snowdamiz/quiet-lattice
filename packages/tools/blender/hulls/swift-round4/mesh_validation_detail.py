"""Measure actual rendered triangle corners before/after Blender's mesh repair, without editing source."""
import bpy,json,os,hashlib
from pathlib import Path
source=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source));rows=[]
def sample(m):
 m.calc_loop_triangles();uvs=list(m.uv_layers);norms=m.corner_normals;tris=[];geom=[]
 for t in m.loop_triangles:
  corners=[];points=[]
  for vi,li in zip(t.vertices,t.loops):
   pos=tuple(round(x,7) for x in m.vertices[vi].co);normal=tuple(round(x,6) for x in norms[li].vector);uv=tuple(tuple(round(x,7) for x in u.data[li].uv) for u in uvs)
   points.append(pos);corners.append((pos,normal,uv))
  tris.append((t.material_index,tuple(sorted(corners))));geom.append((t.material_index,tuple(sorted(points))))
 return {'counts':{'vertices':len(m.vertices),'edges':len(m.edges),'polygons':len(m.polygons),'triangles':len(m.loop_triangles)},'surface':sorted(tris),'geometry':sorted(geom),'UVNames':[u.name for u in uvs]}
for o in bpy.data.objects:
 if o.type!='MESH':continue
 m=o.data.copy();before=sample(m);changed=m.validate(verbose=True);after=sample(m)
 if changed:
  rows.append({'object':o.name,'countsBefore':before['counts'],'countsAfter':after['counts'],'geometryUnchanged':before['geometry']==after['geometry'],'cornersNormalsAllUVsUnchanged':before['surface']==after['surface'],'UVNamesBefore':before['UVNames'],'UVNamesAfter':after['UVNames'],'firstChangedBefore':[x for x,y in zip(before['surface'],after['surface']) if x!=y][:2],'firstChangedAfter':[y for x,y in zip(before['surface'],after['surface']) if x!=y][:2]})
 bpy.data.meshes.remove(m)
result={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'status':'PASS' if all(r['cornersNormalsAllUVsUnchanged'] for r in rows) else 'FAIL','repairs':rows}
Path(os.environ['SWIFT_JOB'],'repair-detail.json').write_text(json.dumps(result,indent=2));print(json.dumps({'status':result['status'],'meshes':[{k:r[k] for k in ['object','countsBefore','countsAfter','geometryUnchanged','cornersNormalsAllUVsUnchanged']} for r in rows]}));__import__('sys').exit(0 if result['status']=='PASS' else 1)
