"""Preview a revised authoring skin shader on a finished source (unbaked, evaluated live in Cycles).
   t_skin.py -- <people> <out.png> [variant=head1] [closeup]"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import shaders, skel, anatomy, preview
importlib.reload(shaders)
argv = sys.argv[sys.argv.index('--') + 1:]
people, out = argv[0], argv[1]
variant = argv[2] if len(argv) > 2 else 'head1'
closeup = len(argv) > 3 and argv[3] == 'closeup'
abbr = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[people]
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.shape_keys:
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
skin = bpy.data.materials[f'{abbr}_Skin']
objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(f'_{variant}_L0')]
for o in objs:
    for sl in o.material_slots:
        if sl.material == skin:
            sl.material = auth
if closeup:
    z = skel.bones(people)['spine_03']['head'][2]
    preview.render_views(objs, out, views=((0, 4), (40, 6), (180, 4)), size=(700, 900), samples=24,
                         focus=(0, 0, z), radius=0.42)
else:
    preview.render_views(objs, out, views=((0, 4), (35, 8), (90, 4), (180, 4)), size=(560, 900), samples=24)
