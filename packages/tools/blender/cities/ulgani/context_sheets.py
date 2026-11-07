"""CPU-only atlas sheets and a metric ring/lake assembly study, consuming saved sources."""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core

OUT = ROOT / "assets/renders/cities/ulgani-cpu"
META = ROOT / "assets/blend/cities/ulgani"
RECEIPT = META / "previews/context-r01.json"
if RECEIPT.exists():
    raise RuntimeError("receipt already exists")
artifacts = []
sources = {}


def remember(path):
    sources[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()


def record(path, **extras):
    artifacts.append(
        {
            "path": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
            **extras,
        }
    )


for group, res in [("low", 2048), ("props", 1024), ("anchor", 4096)]:
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    remember(source)
    core.load(source)
    sheet = np.ones((1024, 1024, 4), np.float32)
    names = ["BaseColor", "ORM", "Normal", "Emissive"]
    for i, name in enumerate(names):
        image = bpy.data.images[f"Ulgani_{res}_{name}"]
        pixels = np.empty(res * res * 4, np.float32)
        image.pixels.foreach_get(pixels)
        small = pixels.reshape(res, res, 4)[:: res // 512, :: res // 512]
        row, col = 1 - i // 2, i % 2
        sheet[row * 512 : (row + 1) * 512, col * 512 : (col + 1) * 512] = small
    path = OUT / f"ulgani_{res}_material_atlas.png"
    if path.exists():
        raise RuntimeError("image already exists")
    image = bpy.data.images.new("AtlasSheet", width=1024, height=1024, alpha=True)
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    record(
        path,
        kind="packed material atlas",
        quadrants=[
            "top-left BaseColor",
            "top-right ORM",
            "bottom-left Normal",
            "bottom-right Emissive",
        ],
        sourceResolution=res,
    )

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.cycles.denoising_use_gpu = False
scene.cycles.max_bounces = 3
scene.render.threads_mode = "FIXED"
scene.render.threads = 2
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new("AssemblyWorld")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
    0.04,
    0.065,
    0.075,
    1,
)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
loaded = {}
placements = []


def place(group, asset, position, angle=0):
    if asset not in loaded:
        source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
        remember(source)
        with bpy.data.libraries.load(str(source), link=False) as (_src, dst):
            dst.collections = [asset]
        loaded[asset] = [
            o
            for o in dst.collections[0].all_objects
            if o.name.startswith(asset + "_Surface2")
        ]
        if len(loaded[asset]) != 1:
            raise RuntimeError("saved LOD2 asset not found: " + asset)
    for original in loaded[asset]:
        ob = original.copy()
        ob.data = original.data
        scene.collection.objects.link(ob)
        ob.hide_render = False
        ob.location = position
        ob.rotation_euler.z = angle
    placements.append(
        {
            "asset": asset,
            "lod": 2,
            "positionMetres": list(position),
            "yawRadians": angle,
        }
    )


place("anchor", "ulgani_root_island_landmark", (0, 0, 0))
for i in range(15):
    angle = i * math.tau / 15
    rotation = Matrix.Rotation(angle, 4, "Z")
    place("kit", "ulgani_ring_shelf", rotation @ Vector((0, 100, 0)), angle)
for i in range(4):
    angle = i * math.pi / 2
    rotation = Matrix.Rotation(angle, 4, "Z")
    place("kit", "ulgani_bridge_long", rotation @ Vector((0, 88, 0)), angle)
place("landmarks", "ulgani_great_cap_landmark", (0, 151, 0))
place("civic", "ulgani_plaza", (0, 145, 0))
for i, position in enumerate(
    [(-140, -42, 0), (-140, 0, 0), (140, -42, 0), (140, 0, 0)]
):
    place("low", f"ulgani_low_{i}", position)
place("kit", "ulgani_cap_half", (-140, -20, 0))
place("kit", "ulgani_cap_half", (140, -20, 0))
place("civic", "ulgani_market", (-44, 146, 0))
place("civic", "ulgani_chorus_listener", (44, 146, 0))

bpy.ops.mesh.primitive_circle_add(
    vertices=128, radius=121, fill_type="NGON", location=(0, 0, -2.6)
)
lake = bpy.context.object
lake.name = "StudyOnly_LakeSurface"
mat = bpy.data.materials.new("StudyOnly_GlowingLake")
mat.use_nodes = True
bs = mat.node_tree.nodes.get("Principled BSDF")
bs.inputs["Base Color"].default_value = (0.025, 0.22, 0.14, 1)
bs.inputs["Roughness"].default_value = 0.28
bs.inputs["Emission Color"].default_value = (0.03, 0.35, 0.18, 1)
bs.inputs["Emission Strength"].default_value = 0.3
lake.data.materials.append(mat)
for name, position, energy, color, size in [
    ("Key", (-180, -220, 330), 6500000, (1, 0.83, 0.6), 220),
    ("Fill", (260, 40, 200), 3000000, (0.65, 0.83, 1), 180),
]:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.size = size
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.location = position
    ob.rotation_euler = (
        (Vector((0, 30, 0)) - ob.location).to_track_quat("-Z", "Y").to_euler()
    )
camera = bpy.data.objects.new("AssemblyCamera", bpy.data.cameras.new("AssemblyCamera"))
scene.collection.objects.link(camera)
camera.data.type = "ORTHO"
camera.data.ortho_scale = 400
camera.data.clip_end = 3000
camera.location = (290, -380, 350)
camera.rotation_euler = (
    (Vector((0, 25, 12)) - camera.location).to_track_quat("-Z", "Y").to_euler()
)
scene.camera = camera
path = OUT / "ulgani_belost_assembly_cpu.png"
if path.exists():
    raise RuntimeError("assembly preview already exists")
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(path)
bpy.ops.render.render(write_still=True)
record(path, kind="metric assembly study", nativeImplementation=False)
assert all(
    hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == sha
    for p, sha in sources.items()
)
RECEIPT.write_text(
    json.dumps(
        {
            "renderer": "Cycles CPU",
            "threads": 2,
            "denoising": False,
            "nativeAcceptance": False,
            "sourceHashes": sources,
            "placements": placements,
            "lake": "study-only plane; T01 owns terrain and water",
            "artifacts": artifacts,
        },
        indent=2,
    )
    + "\n"
)
