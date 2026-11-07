import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from lib import skel, sdf, anatomy, preview, peoples
argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
voxel = float(argv[1]) if len(argv) > 1 else 0.006
which = argv[2].split(',') if len(argv) > 2 else ['thalune', 'ixari', 'ulgani']
view = argv[3] if len(argv) > 3 else 'front'
bpy.ops.wm.read_factory_settings(use_empty=True)
objs = []
for i, people in enumerate(which):
    bs = skel.bones(people)
    ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
    peoples.PEOPLES[people][0]['head_preview'] = True
    S, P = peoples.body_sdf(ctx, people)
    mo = preview.sdf_mesh(S, (-0.8, -0.3, -0.02), (0.8, 0.3, 2.0), voxel, name='sdf_' + people, path=f'/tmp/sdf_{people}.vdb')
    mo.data.materials.append(preview.clay())
    mo.location.x = (i - (len(which) - 1) / 2) * 1.7
    objs.append(mo)
    mo['slot'] = i
REF = bpy.data.meshes.new('ref')
import bmesh
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(0.05, 0.05, 1.85), verts=bm.verts); bmesh.ops.translate(bm, vec=(0, 0.35, 0.925), verts=bm.verts); bm.to_mesh(REF); bm.free()
r = bpy.data.objects.new('ref', REF); bpy.context.scene.collection.objects.link(r); r.location.x = len(which) * 0.85 + 0.1
objs.append(r)
bpy.context.view_layer.update()
V = {'front': ((0, 3),), 'side': ((90, 3),), 'back': ((180, 3),), 'q': ((35, 10),)}
for name in view.split(','):
    for o in objs:
        if 'slot' in o.keys():
            k = o['slot'] - (len(which) - 1) / 2
            o.location = (0, k * 1.0, 0) if name == 'side' else (k * 1.7, 0, 0)
    bpy.context.view_layer.update()
    preview.render_views(objs, out.replace('.png', f'_{name}.png'), views=V[name], size=(1800, 1100), samples=16, fov=22)
