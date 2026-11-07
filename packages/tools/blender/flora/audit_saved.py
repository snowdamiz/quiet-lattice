"""Read-only source inventory and real malformed-source controls for T05."""

import hashlib
import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from artlib import core, glb, rules, scene
from export_saved import _original_write, restore_float_masks, write_exact

OUT = ROOT / "assets/renders/flora/t05"
R = rules.load()
result = {"task": "P1.E14.T05", "files": {}, "meshes": {}, "controls": []}


def mask_hash(rows):
    # Vertex splitting may duplicate records. Preserve the exact float32 bit patterns.
    unique = sorted({struct.pack("<4f", *row).hex() for row in rows})
    return hashlib.sha256("\n".join(unique).encode()).hexdigest()


def association_hash(ob):
    mask = ob.data.color_attributes.active_color
    unique = []
    for vert, item in zip(ob.data.vertices, mask.data):
        p = vert.co
        # Quantized only in this position key, never in the stored/compared mask.
        coords = ",".join(f"{float(v) + 0:.5f}" for v in (p.x, p.z, -p.y))
        unique.append(coords + ":" + struct.pack("<4f", *item.color).hex())
    return hashlib.sha256("\n".join(sorted(set(unique))).encode()).hexdigest()


def check_loaded(path):
    report = core.run_checks(R, path, "flora", "source")
    core.write_and_print(report, OUT / "validation" / ("final_" + path.name + ".json"))
    assert report.status == "PASS", report.failures()


for path in sorted((ROOT / "assets/blend/flora").glob("non_tree_*.blend")):
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    core.load(path)
    check_loaded(path)
    result["files"][path.name] = {"sha256": before, "bytes": path.stat().st_size}
    model = scene.collect_source(R)
    layout = {
        o.name: (asset.name, variant.id)
        for asset in model.assets
        for variant in asset.variants.values()
        for objects in variant.lods.values()
        for o in objects
        if o.type == "MESH"
    }
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or "kind" not in ob:
            continue
        me = ob.data
        assert not me.validate(), (ob.name, "invalid mesh topology")
        ca = me.color_attributes.active_color
        assert ca.data_type == "FLOAT_COLOR" and ca.domain == "POINT"
        values = np.array([item.color[:] for item in ca.data], dtype=np.float32)
        assert np.isfinite(values).all() and (values >= 0).all() and (values <= 1).all()
        assert np.allclose(values[:, :3].sum(1), 1, atol=2e-6)
        me.calc_loop_triangles()
        areas = np.array([t.area for t in me.loop_triangles])
        assert np.min(areas) > 1e-12, (
            ob.name,
            "degenerate triangles",
            float(np.min(areas)),
        )
        coords = np.array([v.co[:] for v in me.vertices])
        assert np.isfinite(coords).all()
        assert tuple(ob.scale) == (1, 1, 1) and tuple(ob.location) == (0, 0, 0)
        glow = np.array([v.value for v in me.attributes["_glow"].data])
        assert np.isfinite(glow).all() and (glow >= 0).all()
        row = {
            "file": path.name,
            "root": layout[ob.name][0],
            "variant_node": layout[ob.name][1],
            "kind": ob["kind"],
            "variant": ob["variant"],
            "triangles": len(me.loop_triangles),
            "vertices": len(me.vertices),
            "bounds_blender": [coords.min(0).tolist(), coords.max(0).tolist()],
            "mask_sha256": mask_hash(values),
            "mask_position_sha256": association_hash(ob),
            "mask_min": values.min(0).tolist(),
            "mask_max": values.max(0).tolist(),
            "glow_max": float(glow.max()),
            "glow_accent": ob["glow_accent"],
        }
        result["meshes"][ob.name] = row
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before

# Controls use a freshly loaded real source; mutated states are never saved.
path = ROOT / "assets/blend/flora/non_tree_foliage.blend"
for control, expected in [
    ("missing_mask", "naming"),
    ("invalid_weights", "naming"),
    ("repeated_lod3", "lods"),
    ("missing_reference", "scale"),
    ("uniform_base_map", "materials"),
]:
    core.load(path)
    ob = bpy.data.objects["bush_0"]
    me = ob.data
    if control == "missing_mask":
        me.color_attributes.remove(me.color_attributes.active_color)
    if control == "invalid_weights":
        for v in me.color_attributes.active_color.data:
            v.color = (0.8, 0.8, 0.8, 1)
    if control == "repeated_lod3":
        bpy.data.objects["bush_0_lod3"].data = me.copy()
    if control == "missing_reference":
        bpy.data.collections.remove(bpy.data.collections["REF"])
    if control == "uniform_base_map":
        im = bpy.data.images["bush_Base"]
        values = np.ones(len(im.pixels), dtype=np.float32) * 0.5
        im.pixels.foreach_set(values)
    scene.clear_cache()
    report = core.run_checks(R, path, "flora", "source")
    core.write_and_print(
        report, OUT / "validation" / f"control_{control}.json", quiet=True
    )
    assert report[expected].status == "FAIL", (control, report.failures())
    result["controls"].append(
        {
            "name": control,
            "expected_rejection": expected,
            "status": "PASS",
            "failures": report.failures(),
        }
    )

# Exercise the adapter on actual saved geometry, then reject corrupted transport carriers.
core.load(path)
ob = bpy.data.objects["bush_0"]
with tempfile.TemporaryDirectory(prefix="t05-mask-") as temp:
    raw = Path(temp) / "raw.glb"
    _original_write([ob], raw)
    d, b = glb.read(raw)
    p = d["meshes"][0]["primitives"][0]
    acc = d["accessors"][p["attributes"]["COLOR_0"]]
    result["blender_mask_baseline"] = {
        k: acc.get(k) for k in ("componentType", "type", "normalized", "count")
    }
    assert acc["componentType"] != 5126 or acc["type"] != "VEC4", (
        "Baseline no longer reproduces exporter mask limitation"
    )
    exact = Path(temp) / "exact.glb"
    write_exact([ob], exact)
    d, b = glb.read(exact)
    acc = d["accessors"][d["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]]
    assert (
        acc["componentType"] == 5126
        and acc["type"] == "VEC4"
        and not acc.get("normalized")
    )
    result["float_adapter"] = {"status": "PASS", "componentType": 5126, "type": "VEC4"}
    try:
        restore_float_masks(raw)
    except RuntimeError as e:
        result["controls"].append(
            {"name": "missing_float_carriers", "status": "PASS", "reason": str(e)}
        )
    else:
        raise AssertionError("Missing carriers accepted")
(OUT / "source_manifest.json").write_text(json.dumps(result, indent=2) + "\n")
print(
    "AUDIT_PASS",
    len(result["meshes"]),
    "LOD meshes;",
    len(result["controls"]),
    "malformed controls",
)
