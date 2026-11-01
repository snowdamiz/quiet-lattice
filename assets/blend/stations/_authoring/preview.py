"""Quick look: renders one asset's LOD from a few angles with EEVEE.  -- <blend> <asset> <lod> <out.png> [az,el;az,el] [interior]"""
import math, sys, os
import bpy
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
asset, lod, out = argv[0], int(argv[1]), argv[2]
views = [tuple(map(float, v.split(","))) for v in (argv[3] if len(argv) > 3 else "35,20;145,25;215,15;-90,60").split(";")]
inside = len(argv) > 4 and argv[4] == "interior"
sc = bpy.context.scene
keep = f"{asset}_LOD{lod}"
for o in sc.objects:
    show = any(c.name == keep for c in o.users_collection)
    o.hide_render = not show
objs = [o for o in sc.objects if not o.hide_render and o.type == "MESH"]
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
ctr = (mn + mx) / 2; rad = (mx - mn).length / 2
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 960, 540
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.05, 0.06, 0.08, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN")); sc.collection.objects.link(fill)
fill.data.energy = 0.8; fill.rotation_euler = (math.radians(120), 0, math.radians(200))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35; cam.data.clip_end = 5000
import subprocess
paths = []
for i, (az, el) in enumerate(views):
    if inside:
        tgt = ctr + Vector((0, 20, -10)); d = 0.2
        pos = Vector((math.cos(math.radians(az)) * 40, math.sin(math.radians(az)) * 40 - 30, 12))
    else:
        d = rad * 2.0
        pos = ctr + Vector((math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * d
        tgt = ctr
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    p = f"{out[:-4]}_{i}.png"; sc.render.filepath = p; bpy.ops.render.render(write_still=True); paths.append(p)
print("RENDERED", paths)
