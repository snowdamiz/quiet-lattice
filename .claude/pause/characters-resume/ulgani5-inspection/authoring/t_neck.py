import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, anatomy, cage, peoples
people = sys.argv[sys.argv.index('--') + 1]
bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
sd['torso_arm'] = S.subset(['torso', 'arm']); sd['leg_foot'] = S.subset(['leg', 'foot'])
C, neck = cage.build_body(ctx, sd, P)
np.save(f'work/neck_{people}.npy', np.array(C.co)[neck])
print('neck saved', len(neck))
