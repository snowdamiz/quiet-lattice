import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import preview
argv = sys.argv[sys.argv.index('--') + 1:]
name, out = argv[0], argv[1]
keys = argv[2].split(',')
ob = bpy.data.objects[name]
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.hide_render = o is not ob
rig = ob.parent
eyez = rig.data.bones['eye_L'].head_local
f = (0, eyez[1] + 0.0, eyez[2] - 0.03)
paths = []
for k in keys:
    for kb in ob.data.shape_keys.key_blocks:
        kb.value = 0.0
    if k != 'none':
        ob.data.shape_keys.key_blocks[k].value = 1.0
    p = out + f'.{k}.png'
    preview.render_views([ob], p, views=((15, 3),), size=(420, 420), samples=12, focus=f, radius=0.11)
    paths.append(p)
preview.compose(paths, min(6, len(paths)), out)
