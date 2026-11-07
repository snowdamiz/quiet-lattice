"""Density failures on actual saved visible faces; no original file is saved."""

import argparse
import copy
import json
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import core, glb, sha
from density import source_rows, summarize
from material_routes import check_export_routes
from pipeline import META, ROOT

parser = argparse.ArgumentParser()
parser.add_argument("--attempt", default="d01")
args = parser.parse_args(
    sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
)
source = ROOT / "assets/blend/cities/ulgani_props.blend"
before = sha(source)
results = []
with tempfile.TemporaryDirectory(prefix="ulgani-density-controls-") as tmp:
    for label, axes in [
        ("visible-face-density-reduction", (0.01, 0.01)),
        ("area-preserving-anisotropic-stretch", (0.0001, 10000)),
    ]:
        core.load(source)
        ob = bpy.data.objects["ulgani_bench_Surface0"]
        me = ob.data
        me.calc_loop_triangles()
        triangle = max(me.loop_triangles, key=lambda t: t.area)
        coords = np.array([me.vertices[v].co[:] for v in triangle.vertices])
        uv = me.uv_layers.active.data
        values = np.array([uv[i].uv[:] for i in triangle.loops])
        values = (values - values[0]) * axes + values[0]
        for loop, value in zip(triangle.loops, values, strict=True):
            uv[loop].uv = value
        path = Path(tmp) / (label + ".blend")
        bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
        rows = source_rows(path, "props")
        failures = [r for r in rows if r["status"] == "FAIL"]
        assert failures, label
        results.append({"control": label, "detected": True, "failures": failures})
    # Only triangle corners participate: an unused UV pool cannot inflate density.
    core.load(source)
    ob = bpy.data.objects["ulgani_bench_Surface0"]
    me = ob.data
    me.calc_loop_triangles()
    triangle = max(me.loop_triangles, key=lambda t: t.area)
    coords = np.array([[me.vertices[v].co[:] for v in triangle.vertices]])
    uv = np.array([[me.uv_layers.active.data[i].uv[:] for i in triangle.loops]])
    uv = (uv - uv[:, :1]) * 0.01 + uv[:, :1]
    padded = np.concatenate([uv.reshape(-1, 2), [[1e12, 1e12], [-1e12, -1e12]]])
    row = summarize(
        coords,
        padded[np.array([[0, 1, 2]])],
        [1024, 1024],
        512,
        ["actual bench surface"],
    )
    assert row["status"] == "FAIL"
    results.append(
        {
            "control": "unused-uv-padding-does-not-help",
            "detected": True,
            "measurement": row,
        }
    )
    row = summarize(
        np.zeros_like(coords), uv, [1024, 1024], 512, ["collapsed actual face"]
    )
    assert (
        row["status"] == "FAIL"
        and row["minorAxisMin"] is None
        and row["zeroWorldAreaTriangles"] == 1
    )
    results.append(
        {
            "control": "all-triangles-collapsed-is-not-pass",
            "detected": True,
            "measurement": row,
        }
    )
    exported, _ = glb.read(
        ROOT / "packages/client/public/models/cities/ulgani_props.glb"
    )
    base = exported["materials"][0]
    assert not check_export_routes(base)
    for label in [
        "roughness-factor-loss",
        "metallic-factor-loss",
        "ao-strength-loss",
        "normal-uv-transform",
        "base-uv-channel",
    ]:
        material = copy.deepcopy(base)
        if label == "roughness-factor-loss":
            material["pbrMetallicRoughness"]["roughnessFactor"] = 0.5
        elif label == "metallic-factor-loss":
            material["pbrMetallicRoughness"]["metallicFactor"] = 0.5
        elif label == "ao-strength-loss":
            material["occlusionTexture"]["strength"] = 0.5
        elif label == "normal-uv-transform":
            material["normalTexture"]["extensions"] = {
                "KHR_texture_transform": {"rotation": 1}
            }
        else:
            material["pbrMetallicRoughness"]["baseColorTexture"]["texCoord"] = 1
        failures = check_export_routes(material)
        assert failures, label
        results.append({"control": label, "detected": True, "failures": failures})
assert sha(source) == before
with (META / f"density-revision/negative-density-{args.attempt}.json").open("x") as f:
    json.dump(
        {
            "status": "PASS",
            "sourceSHA256": before,
            "originalUnchanged": True,
            "controls": results,
        },
        f,
        indent=2,
    )
print("PASS", len(results), "adverse density controls")
