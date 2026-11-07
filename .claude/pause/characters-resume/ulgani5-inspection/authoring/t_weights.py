import sys, os, importlib, time, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from lib import skel, preview, mesh
argv = sys.argv[sys.argv.index('--') + 1:]
people, out = argv[0], argv[1]
bo = bpy.data.objects['body']
for o in list(bpy.data.objects):
    if o is not bo:
        bpy.data.objects.remove(o)
coll = bpy.context.scene.collection
rig = skel.build_armature(bpy, 'RIG', people, coll)
from lib import weights
bs = skel.bones(people)
t = time.time()
names, A = weights.body(bo.data, bs, skel.PEOPLE[people]['scale'], people)
weights.apply(bo, names, A, rig)
print('weights', time.time() - t, names)
# pose: bend
pb = rig.pose.bones
def rot(name, axis, deg):
    b = pb[name]; b.rotation_mode = 'XYZ'; e = list(b.rotation_euler); e['XYZ'.index(axis)] += math.radians(deg); b.rotation_euler = e
for sfx, sg in (('_L', 1), ('_R', -1)):
    rot('lowerarm' + sfx, 'X', 60)
    rot('upperarm' + sfx, 'X', 20)
    rot('calf' + sfx, 'X', -60)
    rot('thigh' + sfx, 'X', 40)
    for f in ('index', 'middle', 'ring'):
        for i in (1, 2, 3): rot(f'{f}_0{i}' + sfx, 'X', 55)
    rot('hand' + sfx, 'X', 25)
rot('spine_02', 'X', 12); rot('neck_01', 'X', 15)
bo.data.materials.clear(); bo.data.materials.append(preview.wire_clay())
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'work/t_weights_{people}.blend'))
preview.render_views([bo], out, views=((20, 5), (90, 5), (200, 10), (60, -20)), size=(700, 900), samples=16)
