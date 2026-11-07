import sys, os, importlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from lib import skel, sdf, anatomy, preview, cage, mesh
for m in (skel, sdf, anatomy, preview, cage, mesh):
    importlib.reload(m)
argv = sys.argv[sys.argv.index('--') + 1:]
people = argv[0]
out = argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people)
ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
P = dict(anatomy.GENERIC)
S = anatomy.body(ctx, P)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
sd['torso_arm'] = S.subset(['torso', 'arm'])
sd['leg_foot'] = S.subset(['leg', 'foot'])
t0 = time.time()
C, neck = cage.build_body(ctx, sd, P)
print('cage', len(C.co), 'verts', len(C.faces), 'faces', time.time() - t0)
me = C.to_mesh(bpy, 'cage')
ob = mesh.new_object('cage', me)
mesh.recalc_normals(ob)
ob.data.materials.append(preview.wire_clay())
hi = ob.copy(); hi.data = ob.data.copy(); hi.name = 'body'
bpy.context.scene.collection.objects.link(hi)
hi.location.x = 1.6
mesh.subdivide(hi, 2)
bnd = mesh.boundary_verts(hi.data)
co = mesh.coords(hi.data)
t0 = time.time()
hi.location.x = 0
co = mesh.fit(hi, S, iters=3, fixed=None)
hi.location.x = 1.6
print('fit', time.time() - t0, len(co))
mesh.smooth_shade(hi.data)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('work/t_cage.blend'))
preview.render_views([ob, hi], out, views=((0, 5), (90, 5), (180, 5), (30, 20)), size=(800, 600), samples=12)
