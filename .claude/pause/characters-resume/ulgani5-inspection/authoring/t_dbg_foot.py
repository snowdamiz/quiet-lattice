import sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, sdf, anatomy, preview, cage, mesh
argv = sys.argv[sys.argv.index('--') + 1:]
people = argv[0]
bs = skel.bones(people)
ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
P = dict(anatomy.GENERIC)
S = anatomy.body(ctx, P)
mo = preview.sdf_mesh(S, (0.0, -0.25, -0.02), (0.25, 0.2, 0.3), 0.003, name='sdffoot')
mo.data.materials.append(preview.clay())
cg = bpy.data.objects['cage']
co = mesh.coords(cg.data)
print('cage foot verts below 0.15:', (co[:,2] < 0.15).sum())
for o in bpy.data.objects:
    if o.type == 'MESH' and o not in (mo,):
        o.hide_render = True
preview.render_views([mo], 'renders/dbg_sdffoot.png', views=((30, 20), (100, 10), (200, 30), (60, -30)), size=(700, 700), samples=12, focus=(0.12, -0.04, 0.06), radius=0.17)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('work/t_dbg.blend'))
