import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, sdf, anatomy, cage, mesh
bs = skel.bones('canon')
ctx = anatomy.Ctx(bs, 1.0)
S = anatomy.body(ctx, dict(anatomy.GENERIC))
cg = bpy.data.objects['body']; cg.location.x = 0; bpy.context.view_layer.update()
co = mesh.coords(cg.data)
part = mesh.attr(cg.data, 'part'); s_ = mesh.attr(cg.data, 's')
d = S(co)
bad = np.nonzero(np.abs(d) > 0.015)[0]
for i in bad[:60]:
    print(i, np.round(co[i], 3), 'd=%.3f' % d[i], 'part', part[i], 's=%.2f' % s_[i])
print('n bad', len(bad))
