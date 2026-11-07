import sys, numpy as np
sys.path.insert(0, '.')
from lib import skel, anatomy, peoples
for p in sys.argv[1:]:
    bs = skel.bones(p); ctx = anatomy.Ctx(bs, skel.PEOPLE[p]['scale'])
    S, P = peoples.body_sdf(ctx, p)
    xs = np.arange(0.02, 0.22, 0.003); ys = np.arange(-0.32, 0.16, 0.003); zs = np.arange(-0.12, 0.12, 0.002)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    Q = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    d = S(Q)
    inside = Q[d < 0]
    print(p, 'sole z', round(float(inside[:, 2].min()), 4), 'ball z', bs['ball_L']['head'][2].round(4), 'head top bone', bs['head']['tail'][2].round(3))
