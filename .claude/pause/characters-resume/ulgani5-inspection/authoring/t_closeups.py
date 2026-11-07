import sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from lib import preview
importlib.reload(preview)
argv = sys.argv[sys.argv.index('--') + 1:]
obj_name, out = argv[0], argv[1]
spots = argv[2] if len(argv) > 2 else 'full'
o = bpy.data.objects[obj_name]
o.location.x = 0
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob is not o:
        ob.hide_render = True
mat = argv[3] if len(argv) > 3 else 'wire'
if mat == 'wire':
    o.data.materials.clear()
    o.data.materials.append(preview.wire_clay())
elif mat == 'clay':
    o.data.materials.clear()
    o.data.materials.append(preview.clay())
bpy.context.view_layer.update()
S = {
    'full': dict(views=((0, 5), (90, 5), (180, 5), (35, 15)), size=(700, 1000), focus=None, radius=None),
    'hand': dict(views=((60, 30), (120, -30), (90, 70), (20, 0)), size=(700, 700), focus=(0.62, -0.01, 0.98), radius=0.13),
    'foot': dict(views=((30, 20), (100, 10), (200, 30), (60, -30)), size=(700, 700), focus=(0.12, -0.04, 0.06), radius=0.17),
    'shoulder': dict(views=((40, 10), (100, 0), (160, 20), (90, -40)), size=(700, 700), focus=(0.18, 0.0, 1.35), radius=0.22),
    'heel': dict(views=((150, 10), (110, -20), (180, 40), (90, 0)), size=(700, 700), focus=(0.12, 0.05, 0.05), radius=0.08),
    'hips': dict(views=((0, 0), (60, -10), (180, 0), (0, -50)), size=(700, 700), focus=(0.0, 0.0, 0.92), radius=0.28),
    'upper': dict(views=((0, 5), (45, 10), (180, 5), (90, 5)), size=(700, 800), focus=(0.0, 0.0, 1.45), radius=0.38),
}[spots]
preview.render_views([o], out, samples=16, **S)
