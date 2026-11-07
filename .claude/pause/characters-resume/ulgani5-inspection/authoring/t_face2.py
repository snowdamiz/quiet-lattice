"""Face iteration: head k of a people built as the build does (cached neck ring), rig, head weights, blendshapes; renders
the neutral face (front, three-quarter, profile) and a row of shapes.
   Blender -b -P t_face2.py -- <people> <k> <out.png> [shaded|clay] [key,key,...]"""
import sys, os, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, anatomy, preview, mesh, peoples, head, heads, shaders, weights, shapes
argv = sys.argv[sys.argv.index('--') + 1:]
people, k, out = argv[0], int(argv[1]), argv[2]
mode = argv[3] if len(argv) > 3 else 'shaded'
keys = argv[4].split(',') if len(argv) > 4 else ['blink_L', 'browUp_L', 'browDown_R', 'smile_L', 'frown_R', 'vis_AA']
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people); s = skel.PEOPLE[people]['scale']; ctx = anatomy.Ctx(bs, s)
S, P = peoples.body_sdf(ctx, people)
neck_pts = np.load(f'work/neck_{people}.npy')
skin = getattr(shaders, people + '_skin')() if mode == 'shaded' else preview.clay()
eyem = getattr(shaders, 'eye_' + people)() if mode == 'shaded' else preview.clay('e', (0.02, 0.02, 0.02), 0.05)
finm = getattr(shaders, {'thalune': 'thalune_fin', 'ixari': 'ixari_crystal', 'ulgani': 'ulgani_frond'}[people])()
H = heads.head_def(people, k)
HS = head.head_sdf(ctx, P, H, S)
HC, info = head.build_head_cage(ctx, HS, neck_pts, H)
bm = head.to_bmesh(HC)
eyes = [head.add_eye(bm, info, ctx, H, e, sd, HS) for e in H['eyes'] for sd in (1, -1)]
mo = head.add_mouth(bm, info, ctx, H, H['mouth'], HS)
head._layers(bm)
head.region_masks(bm)
me = bpy.data.meshes.new('face'); bm.to_mesh(me); bm.free()
ob = mesh.new_object('face', me)
mesh.subdivide(ob, 2)
head.fit_head(ob, HS, eyes, iters=3)
mesh.smooth_shade(ob.data)
ob.data.materials.append(skin)
rig = skel.build_armature(bpy, 'RIG', people, bpy.context.scene.collection)
hn, hA = weights.head(ob.data, bs, s, eyes, mo['zc'])
weights.apply(ob, hn, hA, rig)
parts = []
for j, e in enumerate(eyes):
    em = head.eyeball(bpy, f'e{j}', e['E'], e['n'], e['u'], e['v'], e['r'])
    eo = mesh.new_object(f'e{j}', em); em.materials.append(eyem)
    side = '_L' if e['E'][0] > 0 else '_R'
    weights.apply(eo, [('eye_upper' if e.get('upper') else 'eye') + side], np.ones((len(em.vertices), 1)), rig)
    parts.append(eo)
for ao in heads.accessories(ctx, H, HS, 'acc'):
    ao.data.materials.append(finm)
    an, aA = weights.copy_nearest(ob, ao); weights.apply(ao, an, aA, rig)
    parts.append(ao)
if people == 'thalune':
    for j, e in enumerate(eyes):
        nm = head.nictitating(bpy, f'n{j}', e['E'], e['n'], e['u'], e['v'], e['r'], e['spec'])
        no = mesh.new_object(f'n{j}', nm); no['nict'] = 'lid_nict_L' if e['E'][0] > 0 else 'lid_nict_R'
        nm.materials.append(finm)
        weights.apply(no, [no['nict']], np.ones((len(nm.vertices), 1)), rig)
        parts.append(no)
if not ob.data.uv_layers:
    ob.data.uv_layers.new(name='UVMap')
vl = bpy.context.view_layer
for o in vl.objects:
    o.select_set(False)
for o in parts:
    o.select_set(True)
ob.select_set(True); vl.objects.active = ob
bpy.ops.object.join()
mo['w'] = H['mouth']['w'] * s
def gw(name):
    g = ob.vertex_groups.get(name); w = np.zeros(len(ob.data.vertices))
    if g is None: return w
    for v in ob.data.vertices:
        for gg in v.groups:
            if gg.group == g.index: w[v.index] = gg.weight
    return w
fl = ob.data.attributes.get('flare'); flare = None
if fl is not None:
    flare = np.empty(len(ob.data.vertices) * 3); fl.data.foreach_get('vector', flare); flare = flare.reshape(-1, 3)
infod = dict(jaw_w=gw('jaw'), lid_up={x: gw('lid_upper' + x) for x in ('_L', '_R')}, lid_lo={x: gw('lid_lower' + x) for x in ('_L', '_R')},
             eyes=eyes, zc=mo['zc'], w=mo['w'], M=mo['M'], flare=flare, s=s, nict={x: gw('lid_nict' + x) for x in ('_L', '_R')},
             eye_up={x: gw('eye_upper' + x) for x in ('_L', '_R')},
             rigid=np.max([gw(b + x) for b in ('eye', 'eye_upper', 'lid_nict') for x in ('_L', '_R')], axis=0))
shapes.build(ob, ctx, infod)
f = bs['head']['head'] + np.array([0, -0.01, 0.075]) * s
paths = []
if keys == ['eyeseq']:
    if mode == 'wire':
        w = preview.wire_clay()
        for sl in ob.material_slots:
            sl.material = w
    eside = float(os.environ.get('EYESIDE', '1'))
    e0 = next(e for e in eyes if e['E'][0] * eside > 0 and bool(e.get('upper')) == bool(os.environ.get('EYEUP')))
    fe = e0['E'] + e0['n'] * 0.01
    kb = ob.data.shape_keys.key_blocks
    bk = os.environ.get('EYEKEY', 'blink') + ('_L' if eside > 0 else '_R')
    for key, val, az, el in ((bk, 0.0, 25 * eside, 4), (bk, 0.4, 25 * eside, 4), (bk, 0.75, 25 * eside, 4), (bk, 1.0, 25 * eside, 4),
                             (bk, 1.0, 75 * eside, 2), (bk, 0.0, 75 * eside, 2)):
        for x in kb:
            x.value = 0.0
        kb[key].value = val
        p = out + f'.e{len(paths)}.png'
        preview.render_views([ob], p, views=((az, el),), size=(480, 400), samples=16, focus=tuple(fe), radius=0.035)
        paths.append(p)
    preview.compose(paths, 3, out)
    raise SystemExit

kb = ob.data.shape_keys.key_blocks
for az, el in ((0, 4), (35, 8), (90, 2)):
    p = out + f'.n{az}.png'
    preview.render_views([ob], p, views=((az, el),), size=(520, 600), samples=24, focus=tuple(f), radius=0.15)
    paths.append(p)
fe = bs['eye_L']['head'] * np.array([0, 1, 1.0]) + np.array([0, 0, -0.025]) * s
for key in keys:
    for x in kb:
        x.value = 0.0
    kb[key].value = 1.0
    p = out + f'.k{key}.png'
    preview.render_views([ob], p, views=((18, 4),), size=(520, 600), samples=24, focus=tuple(fe), radius=0.1)
    paths.append(p)
for x in kb:
    x.value = 0.0
preview.compose(paths, 3, out)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_face2_{people}.blend'))
