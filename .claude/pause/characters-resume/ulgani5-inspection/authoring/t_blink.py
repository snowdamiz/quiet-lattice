import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import preview
ob = bpy.data.objects['TH_Head1_head1_L0']
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.hide_render = o is not ob
rig = ob.parent
E = rig.data.bones['eye_L'].head_local
ob.data.materials[0] = preview.wire_clay() if False else ob.data.materials[0]
paths = []
for k in ('none', 'blink_L'):
    for kb in ob.data.shape_keys.key_blocks:
        kb.value = 0.0
    if k != 'none':
        ob.data.shape_keys.key_blocks[k].value = 1.0
    p = f'renders/blink_{k}.png'
    preview.render_views([ob], p, views=((40, 3), (90, 3), (40, 40)), size=(500, 500), samples=12, focus=tuple(E), radius=0.04)
    paths.append(p)
preview.compose(paths, 1, 'renders/blink.png')
