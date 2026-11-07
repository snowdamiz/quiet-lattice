"""Compact still sheets of saved sources, CPU Cycles only. No animation or runtime capture."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules as R, scene as S


def main():
    p = argparse.ArgumentParser()
    p.add_argument("source")
    p.add_argument("out")
    p.add_argument("--angle", type=float, default=-55)
    p.add_argument("--samples", type=int, default=12)
    p.add_argument("--cell", type=int, default=512)
    p.add_argument("--stage", action="store_true", help="one common-scale family composition, one still")
    p.add_argument("--direct", action="store_true", help="save a single asset still without a second composite image")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    core.load(a.source)
    model = S.collect_source(R.load())
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 2
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world.color = (.12, .16, .20)
    for o in bpy.data.objects:
        o.hide_render = True
    for c in bpy.data.collections:
        c.hide_render = False
    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    sc.collection.objects.link(camera)
    sc.camera = camera
    camera_data.type = "ORTHO"
    for name, angle, energy, color in [("Key", (-.7, -1, 1.5), 1800, (1, .88, .72)),
                                       ("Fill", (1, -.2, .8), 1000, (.65, .83, 1)),
                                       ("Rim", (0, 1, 1.2), 2300, (1, .94, .82))]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        ob = bpy.data.objects.new(name, data)
        sc.collection.objects.link(ob)
        ob["preview_direction"] = angle
        ob["preview_energy"] = energy
    variants = [v for asset in model.assets for v in asset.variants.values()]
    if a.stage:
        all_meshes = []
        inventory = []
        spacing = max(max(S.bounds(S.render_meshes(R.load(), v.lods[0]))[1][:2] - S.bounds(S.render_meshes(R.load(), v.lods[0]))[0][:2]) for v in variants) * 1.2
        for k, v in enumerate(variants):
            shift = (k - (len(variants) - 1) / 2) * spacing
            meshes = S.render_meshes(R.load(), v.lods[0])
            for o in meshes:
                o.location.x += shift
                o.hide_render = False
            all_meshes += meshes
            inventory.append({"asset": v.id, "column": k, "translationX": shift})
        bpy.context.view_layer.update()
        lo, hi = (Vector(x) for x in S.bounds(all_meshes))
        center, size = (lo + hi) * .5, max(hi - lo)
        camera.location = center + Vector((0, -1, .60)).normalized() * size * 2
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera_data.ortho_scale = size * 1.08
        camera_data.clip_end = size * 10
        sc.render.resolution_x = 2048
        sc.render.resolution_y = 640
        for o in sc.objects:
            if o.type == "LIGHT":
                o.location = center + Vector(o["preview_direction"]) * size
                o.rotation_euler = (center - o.location).to_track_quat("-Z", "Y").to_euler()
                o.data.size = size * .85
                o.data.energy = o["preview_energy"] * (size / 10) ** 2
        sc.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        out.with_suffix(".json").write_text(json.dumps({"source": a.source, "sourceSha256": hashlib.sha256(Path(a.source).read_bytes()).hexdigest(),
            "backend": "CYCLES_CPU", "threads": 2, "samples": a.samples, "stillViews": 1,
            "independentVisualPass": False, "cells": inventory}, indent=2) + "\n")
        return
    cols = min(4, len(variants))
    rows = math.ceil(len(variants) / cols)
    sheet = np.zeros((rows * a.cell, cols * a.cell, 4), np.float32)
    sheet[:, :, :] = (.035, .055, .065, 1)
    inventory = []
    for k, v in enumerate(variants):
        meshes = S.render_meshes(R.load(), v.lods[0])
        for o in meshes:
            o.hide_render = False
        bounds = S.bounds(meshes)
        lo, hi = (Vector(x) for x in bounds)
        center = (lo + hi) * .5
        size = max(hi - lo)
        theta = math.radians(a.angle)
        direction = Vector((math.cos(theta), math.sin(theta), .5)).normalized()
        camera.location = center + direction * size * 2.2
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera_data.ortho_scale = size * 1.35
        camera_data.clip_end = size * 10
        for o in sc.objects:
            if o.type == "LIGHT":
                d = Vector(o["preview_direction"])
                o.location = center + d * size
                o.rotation_euler = (center - o.location).to_track_quat("-Z", "Y").to_euler()
                o.data.size = size * .85
                o.data.energy = o["preview_energy"] * (size / 10) ** 2
        # Saving through Blender's color-managed output then reloading avoids treating
        # scene-linear Render Result as sRGB; the scratch still is removed immediately.
        scratch = out if a.direct and len(variants) == 1 else out.parent / ("_" + v.id + ".png")
        sc.render.filepath = str(scratch)
        bpy.ops.render.render(write_still=True)
        if a.direct and len(variants) == 1:
            out.with_suffix(".json").write_text(json.dumps({"source": a.source, "sourceSha256": hashlib.sha256(Path(a.source).read_bytes()).hexdigest(),
                "backend": "CYCLES_CPU", "threads": 2, "samples": a.samples, "stillViews": 1,
                "independentVisualPass": False, "cells": [{"asset": v.id, "angle": a.angle}]}, indent=2) + "\n")
            return
        im = bpy.data.images.load(str(scratch), check_existing=False)
        pix = np.array(im.pixels[:], dtype=np.float32).reshape(a.cell, a.cell, 4)
        row, col = rows - 1 - k // cols, k % cols
        sheet[row * a.cell:(row + 1) * a.cell, col * a.cell:(col + 1) * a.cell] = pix
        bpy.data.images.remove(im)
        scratch.unlink()
        for o in meshes:
            o.hide_render = True
        inventory.append({"asset": v.id, "row": k // cols, "column": col, "bounds": [list(lo), list(hi)], "angle": a.angle})
    result = bpy.data.images.new("SarelunSheet", width=cols * a.cell, height=rows * a.cell, alpha=True)
    result.pixels.foreach_set(sheet.ravel())
    result.filepath_raw = str(out)
    result.file_format = "PNG"
    result.save()
    out.with_suffix(".json").write_text(json.dumps({"source": a.source, "sourceSha256": hashlib.sha256(Path(a.source).read_bytes()).hexdigest(), "backend": "CYCLES_CPU", "threads": 2,
                                                 "samples": a.samples, "stillViews": len(variants),
                                                 "independentVisualPass": False, "cells": inventory}, indent=2) + "\n")


if __name__ == "__main__":
    main()
