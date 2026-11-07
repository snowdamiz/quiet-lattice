"""Adverse controls on actual saved assets, stock checks and the route audit; originals never saved."""

import argparse
import hashlib
import json
import struct
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
sys.path.insert(0, str(Path(__file__).parent))
from artlib import (
    checks as C,
)
from artlib import (
    core,
    glb,
)
from artlib import (
    export as exporter,
)
from artlib import (
    materials as M,
)
from artlib import (
    rules as R,
)
from artlib import (
    scene as S,
)
from artlib.report import Report
from audit import geometry, paired_attributes, sample_route, tree


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=False)
    source = ROOT / "assets/blend/cities/ulgani_low.blend"
    export = ROOT / "packages/client/public/models/cities/ulgani_low.glb"
    original = {
        str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (source, export)
    }
    rules = R.load()
    results = []

    def check(label, edit, expected):
        core.load(source)
        edit()
        S.clear_cache()
        M.clear_cache()
        report = core.run_checks(rules, source, "cities", "source")
        report.write(out / (label + ".json"), R.rel)
        failures = report.failures()
        detected = report.status == "FAIL" and any(
            expected.lower() in f["message"].lower() for f in failures
        )
        results.append(
            {
                "control": label,
                "expected": expected,
                "detected": detected,
                "failures": failures,
            }
        )

    check(
        "missing-collision",
        lambda: [
            bpy.data.objects.remove(o, do_unlink=True)
            for o in list(bpy.data.objects)
            if o.name.startswith("COL_ulgani_low_0")
        ],
        "COL_",
    )

    def remove_lod():
        c = bpy.data.collections["ulgani_low_0_LOD3"]
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)

    check("missing-lod3", remove_lod, "missing LOD3")

    def remove_uv():
        me = bpy.data.objects["ulgani_low_0_Surface0"].data
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)

    check("missing-uv", remove_uv, "no UV map")
    check(
        "wrong-reference-scale",
        lambda: setattr(bpy.data.objects["REF_Biped"], "scale", (1, 1, 0.5)),
        "1.85",
    )

    def bad_light():
        ob = next(o for o in bpy.data.objects if o.name.startswith("Light_"))
        del ob["intensity"]

    check("missing-light-property", bad_light, "intensity")

    def flat_normal():
        im = next(i for i in bpy.data.images if i.name.endswith("_Normal") and i.users)
        im.pixels.foreach_set([0.5, 0.5, 1, 1] * (im.size[0] * im.size[1]))
        im.update()

    check("uniform-normal-map", flat_normal, "normal map")
    check(
        "wrong-budget-class",
        lambda: bpy.data.collections["ulgani_low_0"].__setitem__("asset_class", "prop"),
        "budget",
    )
    core.load(export)
    model = S.collect_export(rules)
    S.assign_classes(rules, "cities", model)
    with tempfile.TemporaryDirectory(prefix="negative-", dir=out) as temp:
        for label, extension, fn in [
            ("meshopt-not-required", "EXT_meshopt_compression", C.geometry),
            ("basis-not-required", "KHR_texture_basisu", C.textures),
        ]:
            js, data = glb.read(export)
            js["extensionsRequired"].remove(extension)
            path = Path(temp) / (label + ".glb")
            glb.write(path, js, data)
            report = Report(str(path), "cities", "export")
            fn(rules, "cities", model, report, path, True)
            report.write(out / (label + ".json"), R.rel)
            results.append(
                {
                    "control": label,
                    "detected": report.status == "FAIL",
                    "failures": report.failures(),
                }
            )
        js, data = glb.read(export)
        data = bytearray(data)
        im = js["images"][0]
        view = js["bufferViews"][im["bufferView"]]
        struct.pack_into("<I", data, view.get("byteOffset", 0) + 40, 1)
        path = Path(temp) / "short-mips.glb"
        glb.write(path, js, data)
        report = Report(str(path), "cities", "export")
        C.textures(rules, "cities", model, report, path, True)
        report.write(out / "short-mips.json", R.rel)
        results.append(
            {
                "control": "short-mips",
                "detected": any("mip level" in f["message"] for f in report.failures()),
                "failures": report.failures(),
            }
        )
    core.load(source)
    original_geometry = geometry([bpy.data.objects["ulgani_low_0_Surface3"]])
    for label, index in [("paired-UV-swap", 2), ("paired-normal-swap", 3)]:
        altered = list(original_geometry)
        altered[index] = original_geometry[index].copy()
        if index == 2:
            altered[index] += np.array((0.13, 0.25))
        else:
            altered[index] = altered[index] @ np.array(
                [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
            )
        match = paired_attributes(original_geometry, altered, 0.001)
        key = "uv" if index == 2 else "normalVector"
        results.append(
            {"control": label, "detected": match[key]["p99"] > 0.1, "result": match}
        )
    # A genuine blocking slab across the ground-floor route must be rejected by the additional geometric audit.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.8))
    blocker = bpy.context.object
    blocker.scale = (4, 1, 3.2)
    bpy.context.view_layer.update()
    pts, faces, _, _, _ = geometry([blocker])
    result = sample_route(
        tree(pts, faces),
        {"from": [0, -4, 0.18], "to": [0, 4, 0.18], "width": 3, "height": 3.2},
        False,
        solid=True,
    )
    results.append(
        {
            "control": "blocked-pedestrian-route",
            "detected": result["blocked"] > 0,
            "result": result,
        }
    )
    core.load(source)
    # Removing the real floor colliders must still fail the 5 mm seam-support probe.
    remaining = [
        o
        for o in bpy.data.objects
        if o.name.startswith("COL_ulgani_low_0") and "Deck" not in o.name
    ]
    pts, faces, *_ = geometry(remaining)
    result = sample_route(
        tree(pts, faces),
        {"from": [0, -4, 0.18], "to": [0, 4, 0.18], "width": 3, "height": 3.2},
        True,
    )
    results.append(
        {
            "control": "missing-walkway-floor",
            "detected": result["unsupported"] > 0,
            "result": result,
        }
    )
    core.load(source)
    for ob in list(bpy.data.objects):
        if ob.name.startswith("COL_"):
            bpy.data.objects.remove(ob, do_unlink=True)
    with tempfile.TemporaryDirectory(prefix="stale-", dir=out) as temp:
        rejected = Path(temp) / "ulgani_rejected.blend"
        stale = Path(temp) / "ulgani_rejected.glb"
        bpy.ops.wm.save_as_mainfile(filepath=str(rejected), compress=True)
        stale.write_bytes(b"owned stale export sentinel")
        args = SimpleNamespace(
            report_dir=str(out / "stale-export-stock"),
            verbose=False,
            quiet=True,
            bake_res=None,
            compress=True,
        )
        ok = exporter.export_one(rules, "cities", rejected, stale, args)
        results.append(
            {
                "control": "export-rejects-and-removes-stale",
                "detected": not ok and not stale.exists(),
            }
        )
    after = {
        str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (source, export)
    }
    passed = all(r["detected"] for r in results) and original == after
    (out / "summary.json").write_text(
        json.dumps(
            {
                "status": "PASS" if passed else "FAIL",
                "originalsUnchanged": original == after,
                "originalHashes": original,
                "controls": results,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        "Negative controls:",
        passed,
        [(r["control"], r["detected"]) for r in results],
        flush=True,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
