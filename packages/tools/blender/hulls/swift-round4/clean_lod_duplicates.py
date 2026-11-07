"""Remove invalid duplicate faces in authored lower LODs before serialization; preserve covered geometry."""
import bpy,hashlib,json,os,shutil
from pathlib import Path
source=Path('assets/blend/hulls/swift.blend').resolve();job=Path(os.environ['SWIFT_JOB']);before_sha=hashlib.sha256(source.read_bytes()).hexdigest()
assert before_sha=='4fdfff3a238a9e2441c92779a188ad3f34ed66db62cf449dde689922578fe992'
archive=job/'before-lod-validity.blend';assert not archive.exists();shutil.copyfile(source,archive)
bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0;rows=[]
def triangles(m):
 m.calc_loop_triangles()
 return {tuple(sorted(tuple(round(x,7) for x in m.vertices[v].co) for v in t.vertices)) for t in m.loop_triangles}
for o in bpy.data.objects:
 if o.type!='MESH':continue
 m=o.data;geometry=triangles(m);count=len(m.loop_triangles)
 repaired=m.validate(verbose=False)
 if repaired:
  assert '_R4L' in o.name,'repair unexpectedly touched hero LOD0'
  assert geometry==triangles(m),'repair changed covered geometry: '+o.name
  rows.append({'object':o.name,'beforeTriangles':count,'afterTriangles':len(m.loop_triangles),'uniqueTriangleCoverageUnchanged':True})
 assert not m.validate(),'mesh still invalid: '+o.name
bpy.context.scene['SwiftR4LODValidity']='Removed duplicate lower-LOD faces that Blender serializer otherwise removed implicitly; geometric triangle coverage retained.'
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
result={'status':'PASS','beforeSourceSha256':before_sha,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'repairs':rows,'LOD0Untouched':True,'reason':'source/export identity and valid topology, not performance reduction'}
(job/'lod-validity.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
