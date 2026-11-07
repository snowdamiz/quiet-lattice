import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from lib import preview
argv = sys.argv[sys.argv.index('--') + 1:]
out, variants = argv[0], argv[1].split(',')
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks:
            kb.value = 0.0
paths = []
for v in variants:
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(f'_{v}_L0')]
    p = out + f'.{v}.png'
    preview.render_views(objs, p, views=((0, 4), (35, 8), (180, 4)), size=(560, 900), samples=24)
    paths.append(p)
preview.compose(paths, 1, out)
