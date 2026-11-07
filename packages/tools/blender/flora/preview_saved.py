"""Compact CPU Cycles previews of saved geometry; never saves the source."""

import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
p = argparse.ArgumentParser()
p.add_argument("--tag", default="initial")
p.add_argument("--lod", type=int, default=0)
p.add_argument("--turntables", action="store_true")
p.add_argument("--materials", action="store_true")
a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
OUT = ROOT / "assets/renders/flora/t05/previews"
OUT.mkdir(parents=True, exist_ok=True)
for group in ("foliage", "stone", "resources"):
    bpy.ops.wm.open_mainfile(
        filepath=str(ROOT / f"assets/blend/flora/non_tree_{group}.blend"), load_ui=False
    )
    sc = bpy.context.scene
    objects = sorted(
        [
            o
            for o in sc.objects
            if o.type == "MESH"
            and "kind" in o
            and (
                ("_lod" not in o.name)
                if a.lod == 0
                else o.name.endswith(f"_lod{a.lod}")
            )
        ],
        key=lambda o: o.name,
    )
    if a.materials:
        by_kind = {}
        for ob in objects:
            by_kind.setdefault(ob["kind"], ob)
        objects = list(by_kind.values())
    for o in sc.objects:
        o.hide_render = True
    for c in bpy.data.collections:
        c.hide_render = False
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 12
    sc.cycles.use_denoising = False
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 2
    sc.render.resolution_x = 384
    sc.render.resolution_y = 384
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.22, 0.28, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    sc.world = world
    for name, loc, energy, size, color in [
        ("Key", (-3, -4, 6), 480, 4, (1, 0.91, 0.79)),
        ("Fill", (4, 1, 3), 310, 3, (0.72, 0.84, 1)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        sc.collection.objects.link(light)
        light.location = loc
        light.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("PreviewCamera")
    cd.type = "ORTHO"
    camera = bpy.data.objects.new("PreviewCamera", cd)
    sc.collection.objects.link(camera)
    sc.camera = camera
    # No per-angle files: tile arrays only, one image per sheet.
    tiles = []
    for ob in objects:
        ob.hide_render = False
        lo = Vector(tuple(min(c[i] for c in ob.bound_box) for i in range(3)))
        hi = Vector(tuple(max(c[i] for c in ob.bound_box) for i in range(3)))
        center = (lo + hi) / 2
        scale = max(hi - lo) * (0.72 if a.materials else 1.38)
        views = 8 if a.turntables else 1
        asset_tiles = []
        for view in range(views):
            phi = -1.05 + view * math.tau / 8
            direction = Vector((math.cos(phi), math.sin(phi), 0.68)).normalized()
            camera.location = center + direction * scale * 3
            camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
            cd.ortho_scale = scale
            # File-backed temporary render is required by Blender's background Render Result API.
            tmp = OUT / "_cpu_tile.png"
            sc.render.filepath = str(tmp)
            bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(str(tmp), check_existing=False)
            arr = np.array(im.pixels[:], dtype=np.float32).reshape(384, 384, 4)
            bpy.data.images.remove(im)
            tmp.unlink()
            asset_tiles.append(arr)
        ob.hide_render = True
        if a.turntables:
            sheet = np.concatenate(asset_tiles, axis=1)
            image = bpy.data.images.new(
                "sheet", sheet.shape[1], sheet.shape[0], alpha=True
            )
            image.pixels.foreach_set(sheet.ravel())
            image.filepath_raw = str(OUT / f"{a.tag}_{ob.name}_8angles.png")
            image.file_format = "PNG"
            image.save()
            bpy.data.images.remove(image)
        else:
            tiles.append((ob.name, asset_tiles[0]))
        print("PREVIEW", ob.name, flush=True)
    if not a.turntables:
        cols = 4
        rows = math.ceil(len(tiles) / cols)
        sheet = np.ones((rows * 384, cols * 384, 4), dtype=np.float32) * 0.035
        sheet[:, :, 3] = 1
        for i, (_, tile) in enumerate(tiles):
            r = rows - 1 - i // cols
            c = i % cols
            sheet[r * 384 : (r + 1) * 384, c * 384 : (c + 1) * 384] = tile
        image = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
        image.pixels.foreach_set(sheet.ravel())
        image.filepath_raw = str(OUT / f"{a.tag}_{group}_LOD{a.lod}.png")
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)
        (OUT / f"{a.tag}_{group}_LOD{a.lod}.txt").write_text(
            "\n".join(
                f"{i // cols + 1},{i % cols + 1}: {name}"
                for i, (name, _) in enumerate(tiles)
            )
            + "\n"
        )
