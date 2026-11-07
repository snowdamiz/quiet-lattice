import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, anatomy, cage, mesh, peoples, uv
people = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
sd['torso_arm'] = S.subset(['torso', 'arm']); sd['leg_foot'] = S.subset(['leg', 'foot'])
C, neck = cage.build_body(ctx, sd, P)
me = C.to_mesh(bpy, 'body'); ob = mesh.new_object('body', me); mesh.recalc_normals(ob)
uv.body_seams(ob.data); uv.unwrap(ob, pack=False)
mesh.subdivide(ob, 2); cage.resolve_parts(ob.data)
mesh.fit(ob, S, iters=3, fixed=mesh.boundary_verts(ob.data)); mesh.smooth_shade(ob.data)
np.save(f'work/neck_{people}.npy', np.array(C.co)[neck])
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/body_{people}.blend'))
