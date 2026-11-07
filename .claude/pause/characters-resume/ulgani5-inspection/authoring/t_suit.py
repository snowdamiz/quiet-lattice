import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import skel, anatomy, mesh, peoples, preview, suits as SU, suitdefs
argv = sys.argv[sys.argv.index('--') + 1:]
people, k, out = argv[0], int(argv[1]), argv[2]
bs = skel.bones(people); ctx = anatomy.Ctx(bs, skel.PEOPLE[people]['scale'])
S, P = peoples.body_sdf(ctx, people)
sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
bmap = SU.BodyMap(ctx, S, sd)
body = bpy.data.objects['body']
coords = SU.body_coords(body.data, ctx, bmap)
mesh.set_attr(body.data, 'bs', coords[2])
mesh.set_attr(body.data, 'bth', coords[3])
t = time.time()
pieces = suitdefs.SUITS[people][k](bmap, body, coords, S)
print('suit pieces', len(pieces), time.time() - t)
objs = [body]
cols = {'fabric': (0.18, 0.42, 0.40), 'scale': (0.85, 0.82, 0.74), 'knee': (0.85, 0.82, 0.74), 'cuff': (0.12, 0.25, 0.3),
        'collar': (0.12, 0.25, 0.3), 'belt': (0.12, 0.25, 0.3), 'pouch': (0.35, 0.45, 0.3)}
tris = 0
for name, me, rigid in pieces:
    o = mesh.new_object('suit_' + name, me)
    if people == 'ulgani':
        memb = name == 'fabric' or 'sac' in name or 'flange' in name or 'web' in name
        me.materials.append(preview.clay('pv_memb' if memb else 'pv_chitin', (0.55, 0.4, 0.24) if memb else (0.62, 0.36, 0.08), 0.5))
    else:
        key = next((c for c in cols if name.startswith(c)), 'fabric')
        me.materials.append(preview.clay('pv_' + key, cols[key], 0.5))
    me.calc_loop_triangles(); tris += len(me.loop_triangles)
    objs.append(o)
print('suit tris', tris)
if os.environ.get('SHADED'):
    from lib import shaders
    au = shaders.suit_ulgani('AUTH_suit') if people == 'ulgani' else shaders.suit_ixari('AUTH_suit') if people == 'ixari' else shaders.suit(people, 'AUTH_suit')
    for o in objs[1:]:
        o.data.materials.clear()
        o.data.materials.append(au)
body.data.materials.clear(); body.data.materials.append(preview.clay('pv_skin', (0.45, 0.62, 0.55), 0.4))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_suit_{people}{k}.blend'))
preview.render_views(objs, out, views=((0, 5), (40, 10), (90, 5), (180, 5)), size=(700, 1000), samples=16, focus=os.environ.get('FOCUS') and tuple(float(x) for x in os.environ['FOCUS'].split(',')), radius=os.environ.get('RAD') and float(os.environ['RAD']))
