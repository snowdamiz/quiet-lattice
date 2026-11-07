"""-- <asset> <lod> <out.png> "px,py,pz>tx,ty,tz>lens;..." [hall]   EEVEE views with the kit sheet's lights, tiled 2 across."""
import math, sys
import bpy
import numpy as np
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
asset, lod, out, views = a[0], int(a[1]), a[2], a[3]
hall = len(a) > 4
sc = bpy.context.scene
keep = [f"{x}_LOD{lod}" for x in asset.split(",")]
for o in sc.objects:
    o.hide_render = not any(c.name in keep for c in o.users_collection)
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.eevee.taa_render_samples = 16
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.03, 0.035, 0.045, 1); bg.inputs[1].default_value = 1.0
for nm, e, rot in (("key", 4.5, (50, 0, 35)), ("fill", 0.9, (115, 0, 210)), ("rim", 1.2, (80, 0, 140))):
    L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, "SUN")); L.data.energy = e
    L.rotation_euler = tuple(math.radians(v) for v in rot); sc.collection.objects.link(L)
if hall:
    L = bpy.data.objects.new("hall", bpy.data.lights.new("hall", "AREA")); L.data.energy = 4.0e5; L.data.size = 100
    L.data.use_shadow = False; L.location = (0, 15, 40); sc.collection.objects.link(L)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_end = 6000; cam.data.clip_start = 0.05
imgs = []
for i, v in enumerate(views.split(";")):
    p, t, lens = v.split(">")
    p = Vector(tuple(map(float, p.split(",")))); t = Vector(tuple(map(float, t.split(","))))
    cam.location = p; cam.data.lens = float(lens)
    cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
    f = f"{out[:-4]}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); imgs.append(f)
ims = [bpy.data.images.load(f) for f in imgs]
W, H = ims[0].size; cols = 2; rows = (len(ims) + 1) // 2
o = np.zeros((H * rows, W * cols, 4), np.float32)
for i, im in enumerate(ims):
    px = np.array(im.pixels[:], np.float32).reshape(H, W, 4); r, c = divmod(i, cols)
    o[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = px
img = bpy.data.images.new("o", W * cols, H * rows); img.pixels.foreach_set(o.ravel()); img.filepath_raw = out; img.file_format = "PNG"; img.save()
print("PV", out)
