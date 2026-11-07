import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import preview
k = sys.argv[sys.argv.index('--') + 1]
h = bpy.data.objects['h' + k]
h.data.materials.clear(); h.data.materials.append(preview.wire_clay())
objs = [o for o in bpy.data.objects if o.type == 'MESH' and (o.name == 'h' + k or o.name.startswith('e' + k))]
e = [o for o in objs if o.name.startswith('e')][0]
c = np.mean([e.matrix_world @ v.co for v in e.data.vertices], axis=0)
preview.render_views(objs, f'renders/eyecu_{k}.png', views=((40, 5), (80, 5), (40, 40), (60, -30)), size=(700, 700), samples=16, focus=tuple(c), radius=0.045)
