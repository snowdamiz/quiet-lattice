"""Re-bakes only the Skin base colour of a finished character source from the (revised) authoring shader, into the
existing TH/IX/UL_Skin_base texture (geometry, UVs, the other maps unchanged)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import shaders, bake, skel, anatomy
argv = sys.argv[sys.argv.index('--') + 1:]
people, out, texdir = argv[0], argv[1], argv[2]
abbr = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[people]
skin = bpy.data.materials[f'{abbr}_Skin']
objs = [bpy.data.objects[f'{abbr}_Body_head1_L0']] + [bpy.data.objects[f'{abbr}_Head{k}_head{k}_L0'] for k in range(1, 7)]
kw = {}
if people == 'thalune':
    sys.argv = ['x', '--', people, '/dev/null']
    import importlib
    bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
    s = ctx.s; base = ctx.bs['head']['head']; marks = []
    for sd in (1, -1):
        M = np.array([sd, 1, 1.0]); E = ctx.bs['eye_L']['head'] * M
        snout = (base + np.array([0.012, -0.09, 0.052]) * s) * M
        frill = (base + np.array([0.058, 0.022, 0.014]) * s) * M
        marks += [(snout, E, 0.005 * s, 0.017 * s), (E, frill, 0.017 * s, 0.009 * s)]
    kw = dict(marks=marks)
auth = getattr(shaders, people + '_skin')(**kw)
saved = []
for o in objs:
    for i, sl in enumerate(o.material_slots):
        if sl.material == skin:
            saved.append((o, i))
            sl.material = auth
bake.cycles(bpy.context.scene, 1)
p = next(n for n in auth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
old = skin.node_tree.nodes
base_node = next(n for n in old if n.type == 'TEX_IMAGE' and n.image and n.image.name.endswith('_Skin_base'))
res = base_node.image.size[0]
img = bake.new_image(f'{abbr}_Skin_base_new', res, True)
bake.bake_pass(auth, objs, img, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
for o, i in saved:
    o.material_slots[i].material = skin
oldimg = base_node.image
name = oldimg.name
img = bake.save_jpeg(img, os.path.join(texdir, f'{abbr}_Skin_base.jpg'))
base_node.image = img
bpy.data.images.remove(oldimg)
img.name = name
bpy.data.materials.remove(auth)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('rebaked', name, res)
