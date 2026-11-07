"""Close-up sheets for the grader: the six heads (three-quarter and profile), under the turntable's neutral studio
light, and the blendshape set on head 1."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np, mathutils
from lib import preview
argv = sys.argv[sys.argv.index('--') + 1:]
people, outdir = argv[0], argv[1]
abbr = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[people]
os.makedirs(outdir, exist_ok=True)
rig = bpy.data.objects[f'RIG_{people}']
E = rig.matrix_world @ rig.data.bones['eye_L'].head_local
H = rig.matrix_world @ rig.data.bones['head'].head_local
focus = (0.0, float(H[1]) + 0.01, float(H[2]) + 0.1)
heads = sorted([o for o in bpy.data.objects if o.name.startswith(f'{abbr}_Head') and o.name.endswith('_L0') and '_head' in o.name],
               key=lambda o: o.name)
bodyh = {o.name: o for o in bpy.data.objects if o.name.startswith(f'{abbr}_Body_head') and o.name.endswith('_L0')}
paths = []
for h in ([] if os.environ.get('ONLY_HF') else heads):
    k = h.name.split('_')[2]  # head<k>
    b = bodyh.get(f'{abbr}_Body_{k}_L0')
    objs = [h] + ([b] if b else [])
    for az, el, view in ((35, 6, 'three-quarter'), (95, 4, 'profile')):
        p = os.path.join(outdir, f'_{h.name}_{az}.png')
        preview.render_views(objs, p, views=((az, el),), size=(640, 720), samples=48, focus=focus, radius=0.2,
                             label=f'{people} {k}, {view}')
        paths.append(p)
if paths:
    preview.compose(paths, 4, os.path.join(outdir, f'{people}_heads_closeup.png'))
# blendshapes on head 1
h = next(o for o in heads if o.name.endswith('_head1_L0'))
b = bodyh.get(f'{abbr}_Body_head1_L0')
keys = ['Basis'] + [k.name for k in h.data.shape_keys.key_blocks if k.name != 'Basis']
paths = []
kb = h.data.shape_keys.key_blocks
for k in ([] if os.environ.get('ONLY_HF') else keys):
    for x in kb:
        x.value = 0.0
    if k != 'Basis':
        kb[k].value = 1.0
    p = os.path.join(outdir, f'_shape_{k}.png')
    # (moodFlare moves the crest, fins or crystals: framed wide enough to hold them)
    wide = k == 'moodFlare'
    preview.render_views([h] + ([b] if b else []), p, views=((20, 8) if wide else (0, 4),), size=(420, 460), samples=32,
                         focus=(0, float(H[1]) + 0.02, float(E[2]) + 0.1) if wide else (0, float(H[1]) - 0.02, float(E[2]) - 0.02),
                         radius=0.3 if wide else 0.12, label=k)
    paths.append(p)
for x in kb:
    x.value = 0.0
if paths:
    preview.compose(paths, 7, os.path.join(outdir, f'{people}_blendshapes.png'))
    with open(os.path.join(outdir, f'{people}_blendshapes.txt'), 'w') as f:
        f.write('\n'.join(f'cell {i + 1}: {k}' for i, k in enumerate(keys)) + '\n')
# hands and feet of the unsuited body (head 1): back and palm of the left hand, the left foot from the side and above
b = bodyh.get(f'{abbr}_Body_head1_L0')
if b:
    def bone(n):
        return rig.matrix_world @ rig.data.bones[n].head_local, rig.matrix_world @ rig.data.bones[n].tail_local
    hh, ht = bone('hand_L')
    hc = tuple((hh + (ht - hh) * 1.5))
    # (the left foot framed by its own vertices: everything of the body below the ankle on the left side)
    me = b.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    co = np.array([b.matrix_world @ v.co for v in me.vertices])
    foot = co[(co[:, 2] < 0.1) & (co[:, 0] > 0.02)]
    fc = tuple((foot.min(0) + foot.max(0)) / 2)
    bh, bt = bone('ball_L')
    toes = tuple(bh + (bt - bh) * 0.35 + mathutils.Vector((0, 0, -0.01)))
    paths = []
    for name, c, rad, views, labels in (('hand', hc, 0.15, ((90, 50), (-90, -40)), ('back of the hand', 'palm')),
                                        ('foot', fc, 0.15, ((100, 8), (-75, 10)), ('foot, outer side', 'foot, inner side')),
                                        ('toes', toes, 0.09, ((0, 68), (25, 20)), ('toes from above', 'toes from the front'))):
        for (az, el), lab in zip(views, labels):
            p = os.path.join(outdir, f'_hf_{name}_{az}_{el}.png')
            preview.render_views([b], p, views=((az, el),), size=(640, 560), samples=48, focus=c, radius=rad,
                                 label=f'{people} {lab}')
            paths.append(p)
    preview.compose(paths, 3, os.path.join(outdir, f'{people}_hands_feet.png'))
