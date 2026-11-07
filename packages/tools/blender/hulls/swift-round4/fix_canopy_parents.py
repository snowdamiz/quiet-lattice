"""Restore copied canopy parent inverses in the saved source; preserve all mesh/material bytes."""
import bpy, hashlib, json, os, shutil
from pathlib import Path
source = Path('assets/blend/hulls/swift.blend').resolve()
job = Path(os.environ['SWIFT_JOB'])
before = hashlib.sha256(source.read_bytes()).hexdigest()
assert before == 'e527c4e4aaa99776ef8ca60dca84ad782cb3c0fef6ae6c4f145d7a61d52d898f'
shutil.copyfile(source, job / 'before-canopy-parent-fix.blend')
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.view_layer.update()
def matrix(m): return [float(v) for row in m for v in row]
def geometry():
    return {m.name:hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[(tuple(p.vertices),p.material_index) for p in m.polygons],[[tuple(v.uv) for v in u.data] for u in m.uv_layers],[tuple(n.vector) for n in m.corner_normals])).encode()).hexdigest() for m in bpy.data.meshes}
meshes = geometry()
images = {im.name:hashlib.sha256(im.packed_file.data).hexdigest() for im in bpy.data.images if im.packed_file}
worlds = {o.name:matrix(o.matrix_world) for o in bpy.data.objects}
rows=[]
for variant in ['swift','swift_damaged','swift_husked']:
    a=next(o for o in bpy.data.collections[variant+'_LOD0'].objects if o.name.startswith('CanopyGlass'))
    for level in [1,2,3]:
        b=bpy.data.objects[a.name+f'_R4L{level}']
        old=matrix(b.matrix_parent_inverse)
        b.matrix_parent_inverse=a.matrix_parent_inverse.copy()
        bpy.context.view_layer.update()
        assert max(abs(x-y) for x,y in zip(matrix(a.matrix_world),matrix(b.matrix_world))) < 1e-7
        rows.append({'object':b.name,'oldParentInverse':old,'newParentInverse':matrix(b.matrix_parent_inverse),'worldMatchesLOD0':True})
changed={r['object'] for r in rows}
assert all(matrix(o.matrix_world)==worlds[o.name] for o in bpy.data.objects if o.name not in changed)
assert geometry()==meshes
assert images=={im.name:hashlib.sha256(im.packed_file.data).hexdigest() for im in bpy.data.images if im.packed_file}
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
(job/'canopy-parent-fix.json').write_text(json.dumps({'sourceBeforeSha256':before,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'changes':rows,'allMeshesUnchanged':True,'allPackedImagesUnchanged':True,'allOtherWorldTransformsUnchanged':True,'meshSignatures':meshes},indent=2))
print('PASS: restored 9 canopy parent inverses; geometry, packed images and all other world transforms unchanged')
