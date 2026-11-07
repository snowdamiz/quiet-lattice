"""Re-bakes the Skin base colour, roughness and normal of a finished character source from the (revised) authoring
shader into its existing TH/IX/UL_Skin_* textures; the ambient occlusion (R of the ORM map), geometry and UVs are kept.
   Blender -b <src.blend> -P rebake_skin2.py -- <people> <out.blend> <texdir>"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import shaders, bake, skel, anatomy
argv = sys.argv[sys.argv.index('--') + 1:]
people, out, texdir = argv[0], argv[1], argv[2]
abbr = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[people]
skin = bpy.data.materials[f'{abbr}_Skin']
objs = [bpy.data.objects[f'{abbr}_Body_head1_L0']] + [bpy.data.objects[f'{abbr}_Head{k}_head{k}_L0'] for k in range(1, 7)]
for o in objs:
    if o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks:
            kb.value = 0.0
kw = {}
if people == 'thalune':
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
nodes = {}
for n in skin.node_tree.nodes:
    if n.type == 'TEX_IMAGE' and n.image:
        for k in ('base', 'orm', 'normal'):
            if n.image.name.endswith(f'_Skin_{k}'):
                nodes[k] = n
res = nodes['base'].image.size[0]
base = bake.new_image(f'{abbr}_Skin_base_new', res, True)
bake.bake_pass(auth, objs, base, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
rough = bake.new_image(f'{abbr}_Skin_rough_new', res, False)
bake.bake_pass(auth, objs, rough, 'EMIT', p.inputs['Roughness'].links[0].from_socket, samples=1)
nrm = bake.new_image(f'{abbr}_Skin_normal_new', res, False, (0.5, 0.5, 1, 1))
bake.bake_pass(auth, objs, nrm, 'NORMAL', samples=4)
for o, i in saved:
    o.material_slots[i].material = skin
# ORM: keep the baked occlusion, take the new roughness
old_orm = nodes['orm'].image
A = bake.pixels(old_orm)[..., 0].copy()
orm = bake.new_image(f'{abbr}_Skin_orm_new', res, False)
R = bake.pixels(rough)[..., 0]
orm.pixels.foreach_set(np.stack([A, R, np.zeros_like(A), np.ones_like(A)], -1).ravel())
orm.update()
bpy.data.images.remove(rough)
for key, img, q in (('base', base, 92), ('orm', orm, 92), ('normal', nrm, 95)):
    old = nodes[key].image
    name = old.name
    new = bake.save_jpeg(img, os.path.join(texdir, f'{abbr}_Skin_{key}.jpg'), q)
    nodes[key].image = new
    bpy.data.images.remove(old)
    new.name = name
    print('rebaked', name, res)
bpy.data.materials.remove(auth)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('saved', out)
