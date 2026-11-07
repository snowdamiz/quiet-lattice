"""Compact CPU source inspection. Not an in-engine Review capture or a visual grade."""

import argparse
from pathlib import Path
import sys
import math
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
from artlib import core, scene as S, rules as R

p = argparse.ArgumentParser()
p.add_argument("path")
p.add_argument("--variant", required=True)
p.add_argument("--out", required=True)
p.add_argument("--size", type=int, default=448)
p.add_argument("--single", action="store_true")
args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
path = ROOT / args.path
core.load(path)
rules = R.load()
model = S.collect_source(rules) if path.suffix == ".blend" else S.collect_export(rules)
v = next(v for a in model.assets for v in a.variants.values() if v.id == args.variant)
for c in bpy.data.collections:
    c.hide_render = False
for o in bpy.context.scene.objects:
    o.hide_render = True
objs = S.render_meshes(rules, v.lods[0])
lo, hi = S.bounds(objs)
# Imported GLBs are converted to Blender Z-up by the importer.
center = Vector((lo + hi) / 2)
size = Vector(hi - lo)
span = max(size)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.render.threads_mode = "FIXED"
scene.render.threads = 2
scene.render.resolution_x = args.size
scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.world = bpy.data.worlds.new("T08_CPU_Studio")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
    0.15,
    0.17,
    0.21,
    1,
)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
stage = bpy.data.materials.new("T08_CPU_Ground")
stage.diffuse_color = (0.105, 0.12, 0.14, 1)
stage.use_nodes = True
stage.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (
    0.105,
    0.12,
    0.14,
    1,
)
bpy.ops.mesh.primitive_plane_add(
    size=span * 200, location=(center.x, center.y, float(lo[2]) - 0.003 * span)
)
floor = bpy.context.object
floor.name = "T08_CPU_StudioFloor"
floor.data.materials.append(stage)
camdata = bpy.data.cameras.new("T08_CPU_Camera")
cam = bpy.data.objects.new("T08_CPU_Camera", camdata)
scene.collection.objects.link(cam)
scene.camera = cam
camdata.type = "ORTHO"
camdata.clip_end = span * 500
for name, xyz, power, color in [
    ("Key", (-3, -4, 6), 950, (1, 0.87, 0.72)),
    ("Fill", (4, -1, 3), 650, (0.73, 0.83, 1)),
    ("Rim", (0, 4, 5), 1100, (1, 0.93, 0.84)),
]:
    d = bpy.data.lights.new("T08_CPU_" + name, "AREA")
    d.energy = power * span**2
    d.shape = "DISK"
    d.size = span * 3
    d.color = color
    o = bpy.data.objects.new(d.name, d)
    scene.collection.objects.link(o)
    o.location = center + Vector(xyz) * span
    o.rotation_euler = (center - o.location).to_track_quat("-Z", "Y").to_euler()
configs = [
    (-0.78, 0.62, 0, 1.28),
    (2.38, 0.55, 0, 1.28),
    (-0.78, 0.62, 2, 1.28),
    (-1.15, 0.3, 0, 0.65),
]
if args.single:
    configs = configs[:1]
frames = []
for angle, elevation, lod, zoom in configs:
    for level, items in v.lods.items():
        for o in items:
            o.hide_render = level != lod or S.is_point_marker(rules, o)
    cam.location = (
        center
        + Vector(
            (
                math.cos(angle) * math.cos(elevation),
                math.sin(angle) * math.cos(elevation),
                math.sin(elevation),
            )
        )
        * span
        * 4
    )
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    camdata.ortho_scale = span * zoom
    # RenderResult's pixels can be empty after background render in 5.x; reload a bounded private PNG.
    tmp = Path(__import__("os").environ["TMPDIR"]) / "preview.png"
    scene.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(str(tmp), check_existing=False)
    pixels = np.empty(args.size * args.size * 4, np.float32)
    im.pixels.foreach_get(pixels)
    frames.append(pixels.reshape(args.size, args.size, 4))
    bpy.data.images.remove(im)
if len(frames) == 1:
    sheet = frames[0]
else:
    sheet = np.concatenate(
        [np.concatenate(frames[2:], axis=1), np.concatenate(frames[:2], axis=1)], axis=0
    )
out = ROOT / args.out
out.parent.mkdir(parents=True, exist_ok=True)
assert not out.exists(), f"preserve prior preview: {out}"
im = bpy.data.images.new(
    "CPU_inspection_only", sheet.shape[1], sheet.shape[0], alpha=True
)
im.pixels.foreach_set(sheet.ravel())
im.filepath_raw = str(out)
im.file_format = "PNG"
im.save()
print("CPU_PREVIEW", out, flush=True)
