import sys, os, importlib, time, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, sdf, anatomy, preview, cage, mesh, peoples, uv
people = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bs = skel.bones(people)
ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
sd['torso_arm'] = S.subset(['torso', 'arm']); sd['leg_foot'] = S.subset(['leg', 'foot'])
C, neck = cage.build_body(ctx, sd, P)
me = C.to_mesh(bpy, 'body'); bo = mesh.new_object('body', me); mesh.recalc_normals(bo)
uv.body_seams(bo.data)
print('seams', sum(e.use_seam for e in bo.data.edges))
uv.unwrap(bo, method='ANGLE_BASED', margin=0.003)
mesh.subdivide(bo, 2); cage.resolve_parts(bo.data)
mesh.fit(bo, S, iters=3, fixed=mesh.boundary_verts(bo.data)); mesh.smooth_shade(bo.data)
# checker material
m = bpy.data.materials.new('chk'); m.use_nodes = True; nt = m.node_tree
p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
ch = nt.nodes.new('ShaderNodeTexChecker'); ch.inputs['Scale'].default_value = 40
tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['UV'], ch.inputs['Vector'])
nt.links.new(ch.outputs['Color'], p.inputs['Base Color'])
bo.data.materials.append(m)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_uv_{people}.blend'))
preview.render_views([bo], f'renders/uv_{people}.png', views=((0, 5), (90, 5), (180, 5), (40, -30)), size=(600, 900), samples=8)
# uv layout image
a, _ = uv.uv_array(bo.data)
import numpy as np
img = np.zeros((1024, 1024, 4), np.float32); img[..., 3] = 1
for poly in bo.data.polygons:
    idx = list(poly.loop_indices)
    pts = a[idx]
    for i in range(len(pts)):
        p0, p1 = pts[i], pts[(i + 1) % len(pts)]
        for t in np.linspace(0, 1, 8):
            q = p0 * (1 - t) + p1 * t
            x, y = int(q[0] * 1023), int(q[1] * 1023)
            if 0 <= x < 1024 and 0 <= y < 1024:
                img[y, x, :3] = 1
im = bpy.data.images.new('uvl', 1024, 1024); im.pixels.foreach_set(img.ravel()); im.filepath_raw = os.path.abspath(f'renders/uvl_{people}.png'); im.file_format = 'PNG'; im.save()
print('uv done')
