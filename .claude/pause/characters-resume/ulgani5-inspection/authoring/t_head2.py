"""Fast head iteration: head k of a people (cached neck ring), accessories, eyes; renders 4 views (shaded)."""
import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, anatomy, preview, cage, mesh, peoples, head, heads, shaders
argv = sys.argv[sys.argv.index('--') + 1:]
people, ks, out = argv[0], [int(x) for x in argv[1].split(',')], argv[2]
mode = argv[3] if len(argv) > 3 else 'shaded'
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
neck_pts = np.load(f'work/neck_{people}.npy')
skin = getattr(shaders, people + '_skin')() if mode == 'shaded' else preview.wire_clay()
eyem = getattr(shaders, 'eye_' + people)() if mode == 'shaded' else preview.clay('e', (0.02, 0.02, 0.02), 0.05)
finm = getattr(shaders, {'thalune': 'thalune_fin', 'ixari': 'ixari_crystal', 'ulgani': 'ulgani_frond'}[people])()
objs = []
for i, k in enumerate(ks):
    H = heads.head_def(people, k)
    HS = head.head_sdf(ctx, P, H, S)
    HC, info = head.build_head_cage(ctx, HS, neck_pts, H)
    bm = head.to_bmesh(HC)
    eyes = [head.add_eye(bm, info, ctx, H, e, sd, HS) for e in H['eyes'] for sd in (1, -1)]
    head.add_mouth(bm, info, ctx, H, H['mouth'], HS)
    head._layers(bm)
    me = bpy.data.meshes.new(f'h{k}'); bm.to_mesh(me); bm.free()
    ob = mesh.new_object(f'h{k}', me)
    mesh.subdivide(ob, 2)
    head.fit_head(ob, HS, eyes, iters=3)
    mesh.smooth_shade(ob.data)
    ob.data.materials.append(skin)
    group = [ob]
    for j, e in enumerate(eyes):
        em = head.eyeball(bpy, f'e{k}{j}', e['E'], e['n'], e['u'], e['v'], e['r'])
        eo = mesh.new_object(f'e{k}{j}', em); em.materials.append(eyem); group.append(eo)
    for ao in heads.accessories(ctx, H, HS, f'acc{k}'):
        ao.data.materials.append(finm); group.append(ao)
    objs.append(group)
bpy.context.view_layer.update()
f = bs['head']['head'] + np.array([0, 0.02, float(os.environ.get('FZ', '0.08'))])
views = ((0, 4), (35, 12), (90, 4), (150, 15)) if len(ks) == 1 else ((0, 6), (40, 10), (110, 8))
paths = []
for i, group in enumerate(objs):
    p = out + f'.g{i}.png'
    preview.render_views(group, p, views=views, size=(480, 560), samples=24, focus=tuple(f), radius=float(os.environ.get('FR', '0.17')))
    paths.append(p)
if len(paths) == 1:
    os.replace(paths[0], out)
else:
    preview.compose(paths, int(os.environ.get('NC', '3')), out)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_head2_{people}.blend'))
