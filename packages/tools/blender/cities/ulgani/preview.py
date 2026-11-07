"""Bounded Cycles CPU contact sheets from saved sources. No native/GPU acceptance claim."""

import argparse
import hashlib
import json
import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core
from artlib import rules as R
from artlib import scene as S


def aim(ob, point):
    ob.rotation_euler = (
        (Vector(point) - ob.location).to_track_quat("-Z", "Y").to_euler()
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--asset")
    p.add_argument("--size", type=int, default=256)
    p.add_argument("--samples", type=int, default=12)
    p.add_argument("--lod", type=int, default=0)
    p.add_argument("--receipt", required=True)
    p.add_argument("--replace-current", action="store_true")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    dest = Path(a.out).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    receipt = Path(a.receipt)
    if receipt.exists():
        raise RuntimeError("receipt exists")
    source = Path(a.source)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    rules = R.load()
    core.load(source)
    model = (
        S.collect_source(rules)
        if source.suffix == ".blend"
        else S.collect_export(rules)
    )
    candidates = [
        v
        for asset in model.assets
        for v in asset.variants.values()
        if not a.asset or v.id == a.asset
    ]
    if not candidates:
        raise RuntimeError("no matching saved asset")
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = a.samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 3
    scene.cycles.denoising_use_gpu = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
    scene.render.resolution_x = a.size
    scene.render.resolution_y = a.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("CPUPreviewWorld")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.075,
        0.095,
        0.11,
        1,
    )
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    for c in bpy.data.collections:
        c.hide_render = False
    for o in bpy.data.objects:
        o.hide_render = True
    camera = bpy.data.objects.new(
        "CPUPreviewCamera", bpy.data.cameras.new("CPUPreviewCamera")
    )
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    lights = []
    for name, power, col in [
        ("Key", 1, (1, 0.83, 0.61)),
        ("Fill", 0.4, (0.64, 0.8, 1)),
        ("Rim", 0.7, (0.85, 1, 0.77)),
    ]:
        data = bpy.data.lights.new("CPU" + name, "AREA")
        data.color = col
        ob = bpy.data.objects.new("CPU" + name, data)
        scene.collection.objects.link(ob)
        lights.append((ob, power))
    artifacts = []
    for variant in candidates:
        output = dest / f"{variant.id}_lod{a.lod}_turntable.png"
        previous_hash = (
            hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None
        )
        if output.exists() and not a.replace_current:
            raise RuntimeError(f"preview exists: {output}")
        objs = S.render_meshes(rules, variant.lods[a.lod])
        for ob in objs:
            ob.hide_render = False
        lo, hi = S.bounds(objs)
        center = (lo + hi) / 2
        span = float(max(hi - lo))
        scale = span * 1.32
        camera.data.ortho_scale = scale
        camera.data.clip_end = max(5000, span * 10)
        for (ob, power), pos in zip(
            lights, [(-1.5, -2, 2), (2, -0.4, 1), (0.2, 2, 1.8)]
        ):
            ob.location = Vector(center) + Vector(pos) * span
            aim(ob, center)
            ob.data.energy = span * span * power * 65
            ob.data.shape = "DISK"
            ob.data.size = span * 1.1
        sheet = np.ones((a.size * 2, a.size * 4, 4), np.float32)
        with tempfile.TemporaryDirectory(prefix="ulgani-cpu-frame-") as temp:
            frame = Path(temp) / "single.png"
            for i in range(8):
                angle = -math.pi / 2 + i * math.tau / 8
                camera.location = (
                    Vector(center)
                    + Vector((math.cos(angle) * 2, math.sin(angle) * 2, 0.85)) * span
                )
                aim(camera, center)
                scene.render.filepath = str(frame)
                bpy.ops.render.render(write_still=True)
                image = bpy.data.images.load(str(frame), check_existing=False)
                pixels = np.empty(a.size * a.size * 4, np.float32)
                image.pixels.foreach_get(pixels)
                row, col = 1 - i // 4, i % 4
                sheet[
                    row * a.size : (row + 1) * a.size, col * a.size : (col + 1) * a.size
                ] = pixels.reshape(a.size, a.size, 4)
                bpy.data.images.remove(image)
                frame.unlink()
        image = bpy.data.images.new(
            "CPUContactSheet", width=a.size * 4, height=a.size * 2, alpha=True
        )
        image.pixels.foreach_set(sheet.ravel())
        image.filepath_raw = str(output)
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)
        artifacts.append(
            {
                "asset": variant.id,
                "replacedDraftSHA256": previous_hash,
                "lod": a.lod,
                "path": str(output.relative_to(ROOT)),
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "bytes": output.stat().st_size,
                "angles": 8,
                "size": [a.size * 4, a.size * 2],
            }
        )
        for ob in objs:
            ob.hide_render = True
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(
        json.dumps(
            {
                "source": str(source),
                "sourceSHA256": source_hash,
                "renderer": "Cycles CPU",
                "device": scene.cycles.device,
                "threads": scene.render.threads,
                "samples": a.samples,
                "denoising": scene.cycles.use_denoising,
                "denoisingGPU": scene.cycles.denoising_use_gpu,
                "nativeAcceptance": False,
                "artifacts": artifacts,
            },
            indent=2,
        )
        + "\n"
    )
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash


if __name__ == "__main__":
    main()
