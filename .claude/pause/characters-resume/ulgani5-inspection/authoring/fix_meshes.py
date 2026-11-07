"""Validates every mesh (Mesh.validate: degenerate faces and edges that LOD decimation can leave) and saves."""
import sys, bpy
out = sys.argv[sys.argv.index('--') + 1]
bad = []
for me in bpy.data.meshes:
    if me.validate(verbose=False, clean_customdata=False):
        bad.append(me.name)
        me.update()
print('fixed', len(bad), bad[:20])
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
