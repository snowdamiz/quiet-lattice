import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np, bmesh, math
from lib import skel, anatomy, preview, mesh, peoples, head, heads
bpy.ops.wm.read_factory_settings(use_empty=True)
people = 'thalune'
bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
neck_pts = np.load(f'work/neck_{people}.npy')
H = heads.head_def(people, 1)
HS = head.head_sdf(ctx, P, H, S)
HC, info = head.build_head_cage(ctx, HS, neck_pts, H)
bm = head.to_bmesh(HC)
eyes = [head.add_eye(bm, info, ctx, H, e, 1, HS) for e in H['eyes']]
L = head._layers(bm)
e = eyes[0]
for vv in bm.verts:
    if vv[L['eyer']] > 0:
        d = np.array(vv.co) - e['E']
        a = math.degrees(math.atan2(d @ e['v'], d @ e['u']))
        b = math.degrees(math.acos(np.clip(d @ e['n'] / np.linalg.norm(d), -1, 1)))
        print('eyer %.4f free %.2f alpha %7.1f beta %5.1f |d| %.4f' % (vv[L['eyer']], vv[L['free']], a, b, np.linalg.norm(d)))
me = bpy.data.meshes.new('c'); bm.to_mesh(me); bm.free()
ob = mesh.new_object('c', me); me.materials.append(preview.wire_clay())
em = head.eyeball(bpy, 'eb', e['E'], e['n'], e['u'], e['v'], e['r']); eo = mesh.new_object('eb', em); em.materials.append(preview.clay('k', (0.05, 0.2, 0.18), 0.1))
preview.render_views([ob, eo], 'renders/eyecage.png', views=((40, 5), (80, 5), (40, 40)), size=(700, 700), samples=8, focus=tuple(e['E']), radius=0.05)
