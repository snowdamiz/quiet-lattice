import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from lib import skel, sdf, anatomy, preview, peoples
for m in (skel, sdf, anatomy, preview, peoples):
    importlib.reload(m)

argv = sys.argv[sys.argv.index('--') + 1:]
people = argv[0] if argv else 'canon'
out = argv[1] if len(argv) > 1 else '/tmp/sdf_body.png'
voxel = float(argv[2]) if len(argv) > 2 else 0.005
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people)
ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
t = time.time()
peoples.PEOPLES[people][0]['head_preview'] = True
S, P = peoples.body_sdf(ctx, people)
mo = preview.sdf_mesh(S, (-0.8, -0.3, -0.02), (0.8, 0.3, 1.85), voxel)
print('mesh', len(mo.data.vertices), 'verts in', time.time() - t)
mo.data.materials.append(preview.clay())
arm = skel.build_armature(bpy, 'RIG', people, bpy.context.scene.collection)
preview.render_views([mo], out, size=(500, 800), samples=16, views=((0, 5), (90, 5), (180, 5), (35, 12)))
