import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from lib import skel, sdf, anatomy, preview, cage, mesh, peoples, head
argv = sys.argv[sys.argv.index('--') + 1:]
people = argv[0]; out = argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people)
ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
sd['torso_arm'] = S.subset(['torso', 'arm']); sd['leg_foot'] = S.subset(['leg', 'foot'])
C, neck = cage.build_body(ctx, sd, P)
neck_pts = np.array(C.co)[neck]
H = getattr(head, people.upper() + '_HEAD')
HS = head.head_sdf(ctx, P, H, S)
HC, info = head.build_head_cage(ctx, HS, neck_pts, H)
bm = head.to_bmesh(HC)
eyes = []
for e in H.get('eyes', []):
    for side in (1, -1):
        eyes.append(head.add_eye(bm, info, ctx, H, e, side, HS))
if H.get('mouth'):
    head.add_mouth(bm, info, ctx, H, H['mouth'], HS)
L = head._layers(bm)
for v in bm.verts:
    pass
me = bpy.data.meshes.new('head'); bm.to_mesh(me); bm.free()
ob = mesh.new_object('head_cage', me)
hi = ob.copy(); hi.data = me.copy(); hi.name = 'head'; bpy.context.scene.collection.objects.link(hi)
mesh.subdivide(hi, 2)
head.fit_head(hi, HS, eyes, iters=3)
for i, e in enumerate(eyes):
    em = head.eyeball(bpy, f'eye{i}', e['E'], e['n'], e['u'], e['v'], e['r'])
    eo = mesh.new_object(f'eye{i}', em)
    m = preview.clay('pv_eye', (0.02, 0.025, 0.03), 0.05)
    em.materials.append(m)
mesh.smooth_shade(hi.data)
# body for context
bme = C.to_mesh(bpy, 'body'); bo = mesh.new_object('body', bme); mesh.recalc_normals(bo); mesh.subdivide(bo, 2); cage.resolve_parts(bo.data)
mesh.fit(bo, S, iters=2, fixed=mesh.boundary_verts(bo.data)); mesh.smooth_shade(bo.data)
for o in (ob, hi, bo):
    o.data.materials.append(preview.wire_clay())
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_head_{people}.blend'))
f = bs['head']['head'] + np.array([0, -0.02, 0.08])
eyeobjs = [o for o in bpy.data.objects if o.name.startswith('eye')]
preview.render_views([hi, bo] + eyeobjs, out, views=((0, 5), (90, 5), (35, 15), (160, 10)), size=(700, 800), samples=16, focus=tuple(f), radius=0.2)
