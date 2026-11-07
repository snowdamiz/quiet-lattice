"""A-pose deformation test: elbows, knees, neck, fingers and spine bent on the shared skeleton, rendered next to the
rest pose (wireframe-over-clay so the topology and the weights read)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import preview
argv = sys.argv[sys.argv.index('--') + 1:]
people, variant, out = argv[0], argv[1], argv[2]
abbr = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[people]
rig = bpy.data.objects[f'RIG_{people}']
objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(f'_{variant}_L0')]
# clay with the mesh's own edges drawn over it as thin dark tubes (a Wireframe modifier after the skin), so the quad
# loops read; the Cycles wireframe node would draw the render triangulation instead
clay = preview.clay('pv_bend_clay', (0.6, 0.6, 0.58), 0.7)
ink = preview.clay('pv_bend_ink', (0.03, 0.035, 0.04), 0.6)
wires = []
for o in objs:
    o.data.materials.clear()
    o.data.materials.append(clay)
    w = o.copy()
    bpy.context.scene.collection.objects.link(w)
    w.name = o.name + '_wire'
    md = w.modifiers.new('wire', 'WIREFRAME')
    md.thickness = 0.0009
    md.use_replace = True
    # (no even offset: at a sliver face its miter shot a spike half a metre off the crown and widened the framing)
    md.use_even_offset = False
    md.material_offset = 1
    w.data = o.data.copy()
    w.data.materials.append(ink)
    wires.append(w)
objs = objs + wires
pb = rig.pose.bones
def rot(name, axis, deg):
    b = pb[name]; b.rotation_mode = 'XYZ'; e = list(b.rotation_euler); e['XYZ'.index(axis)] += math.radians(deg); b.rotation_euler = e
paths = []
for posed in (False, True):
    for b in pb:
        b.rotation_mode = 'XYZ'; b.rotation_euler = (0, 0, 0)
    if posed:
        for sfx in ('_L', '_R'):
            rot('lowerarm' + sfx, 'X', 75); rot('upperarm' + sfx, 'X', 25); rot('hand' + sfx, 'X', 20)
            rot('thigh' + sfx, 'X', 55); rot('calf' + sfx, 'X', -80); rot('foot' + sfx, 'X', 15)
            for f in ('index', 'middle', 'ring'):
                for i in (1, 2, 3): rot(f'{f}_0{i}' + sfx, 'X', 60)
            for i in (1, 2, 3): rot(f'thumb_0{i}' + sfx, 'X', 30)
        rot('spine_02', 'X', 14); rot('spine_03', 'X', 8); rot('neck_01', 'X', 18); rot('head', 'X', 12); rot('jaw', 'X', 14)
    bpy.context.view_layer.update()
    p = out + f'.{int(posed)}.png'
    preview.render_views(objs, p, views=((25, 8), (90, 5), (200, 12)), size=(640, 900), samples=24)
    paths.append(p)
preview.compose(paths, 1, out)
