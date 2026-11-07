"""Compact saved-art CPU sheets: whole assets beside metric material closeups."""

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from audit import R, S, core, sha
from pipeline import META, ROOT
from preview import aim


def main(a=None):
    p = argparse.ArgumentParser()
    p.add_argument("--group", required=True)
    p.add_argument("--export", action="store_true")
    p.add_argument("--attempt", required=True)
    if a is None:
        a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    source = ROOT / (
        f"packages/client/public/models/cities/ulgani_{a.group}.glb"
        if a.export
        else f"assets/blend/cities/ulgani_{a.group}.blend"
    )
    before = sha(source)
    core.load(source)
    rules = R.load()
    model = S.collect_export(rules) if a.export else S.collect_source(rules)
    variants = [v for asset in model.assets for v in asset.variants.values()]
    output = (
        ROOT
        / f"assets/renders/cities/ulgani-density/{a.group}-{'export' if a.export else 'source'}-{a.attempt}.png"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    assert not output.exists()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.cycles.denoising_use_gpu = False
    scene.cycles.max_bounces = 3
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
    size = 384
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("MetricCPUWorld")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.09,
        0.11,
        0.13,
        1,
    )
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.65
    for c in bpy.data.collections:
        c.hide_render = False
    for ob in bpy.data.objects:
        ob.hide_render = True
    camera = bpy.data.objects.new(
        "MetricCPUCamera", bpy.data.cameras.new("MetricCPUCamera")
    )
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.clip_end = 6000
    lights = []
    for power, color, pos in [
        (55, (1, 0.88, 0.72), (-1.5, -2, 2)),
        (25, (0.73, 0.85, 1), (2, -0.4, 1)),
        (40, (0.85, 1, 0.8), (0.2, 2, 1.8)),
    ]:
        ob = bpy.data.objects.new(
            "MetricCPULight", bpy.data.lights.new("MetricCPULight", "AREA")
        )
        scene.collection.objects.link(ob)
        ob.data.color = color
        lights.append((ob, power, Vector(pos)))
    cols = 6
    rows = math.ceil(len(variants) / 2)
    sheet = np.ones((rows * size, cols * size, 4), np.float32)
    views = []
    with tempfile.TemporaryDirectory(prefix="ulgani-metric-") as temp:
        frame = Path(temp) / "single.png"
        for i, variant in enumerate(variants):
            obs = S.render_meshes(rules, variant.lods[0])
            for ob in obs:
                ob.hide_render = False
            lo, hi = S.bounds(obs)
            center = Vector((lo + hi) / 2)
            span = float(max(hi - lo))
            # Select a real outward-facing, low, sizeable surface from this exact saved mesh.
            candidates = []
            for ob in obs:
                me = ob.data
                me.calc_loop_triangles()
                for t in me.loop_triangles:
                    if t.area < 0.0001:
                        continue
                    n = (ob.matrix_world.to_3x3() @ t.normal).normalized()
                    point = (
                        ob.matrix_world
                        @ sum((me.vertices[j].co for j in t.vertices), Vector())
                        / 3
                    )
                    if n.y < -0.2 and n.z < 0.9:
                        score = t.area / (1 + abs(point.z - min(2, float(hi[2]) * 0.5)))
                        candidates.append((score, point, n))
            if not candidates:
                raise RuntimeError("no visible detail triangle")
            _, detail, normal = max(candidates, key=lambda x: x[0])
            for mode in range(3):
                scene.cycles.samples = 64 if mode == 1 else 24
                if mode == 2:
                    for ob in obs:
                        ob.hide_render = True
                    obs = S.render_meshes(rules, variant.lods[2])
                    for ob in obs:
                        ob.hide_render = False
                target = center if mode != 1 else detail
                scale = span * 1.28 if mode != 1 else 2.0
                camera.data.ortho_scale = scale
                camera.location = target + (
                    Vector((1.4, -2, 0.95)) * span
                    if mode != 1
                    else normal * 4 + Vector((0, 0, 0.25))
                )
                aim(camera, target)
                for light, power, pos in lights:
                    light.location = target + pos * (span if mode != 1 else 4)
                    aim(light, target)
                    light.data.energy = (span if mode != 1 else 4) ** 2 * power
                    light.data.size = (span if mode != 1 else 4) * 1.1
                scene.render.filepath = str(frame)
                bpy.ops.render.render(write_still=True)
                im = bpy.data.images.load(str(frame), check_existing=False)
                pixels = np.empty(size * size * 4, np.float32)
                im.pixels.foreach_get(pixels)
                row = rows - 1 - i // 2
                col = (i % 2) * 3 + mode
                sheet[row * size : (row + 1) * size, col * size : (col + 1) * size] = (
                    pixels.reshape(size, size, 4)
                )
                bpy.data.images.remove(im)
                frame.unlink()
                views.append(
                    {
                        "asset": variant.id,
                        "kind": "whole" if mode != 1 else "2m material closeup",
                        "lod": 2 if mode == 2 else 0,
                        "samples": scene.cycles.samples,
                        "tileFromTop": [i // 2, col],
                        "orthographicWidthMetres": scale,
                        "target": list(target),
                        "camera": list(camera.location),
                    }
                )
            for ob in obs:
                ob.hide_render = True
    if getattr(a, "return_pixels", False):
        assert sha(source) == before
        return sheet, {
            "source": str(source.relative_to(ROOT)),
            "sourceSHA256": before,
            "views": views,
        }
    image = bpy.data.images.new(
        "MetricDiagnostic", width=cols * size, height=rows * size, alpha=True
    )
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw = str(output)
    image.file_format = "PNG"
    image.save()
    assert sha(source) == before
    with (
        META
        / f"density-revision/preview-{a.group}-{'export' if a.export else 'source'}-{a.attempt}.json"
    ).open("x") as f:
        json.dump(
            {
                "source": str(source.relative_to(ROOT)),
                "sourceSHA256": before,
                "output": str(output.relative_to(ROOT)),
                "outputSHA256": sha(output),
                "bytes": output.stat().st_size,
                "renderer": "Cycles CPU",
                "threads": 2,
                "samples": {"whole": 24, "closeup": 64},
                "nativeAcceptance": False,
                "views": views,
            },
            f,
            indent=2,
        )


if __name__ == "__main__":
    main()
