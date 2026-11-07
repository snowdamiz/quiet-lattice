"""Read-only source controls. Each invocation retains a new immutable audit attempt."""

import argparse
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from artlib import core, glb, rules, scene
from export_saved import _original_write, restore_float_masks, write_exact
from receipts import DEFAULT_EVIDENCE, ROOT, STEMS, Attempt, write_json
from source_audit import audit_sources


def audit(src_dir, evidence):
    with Attempt(evidence, "source-audit") as attempt:
        OUT = attempt.path
        R = rules.load()
        sources = [
            attempt.snapshot(src_dir / (stem + ".blend"), "sources") for stem in STEMS
        ]
        result = audit_sources(sources, OUT / "validation")
        result["controls"] = []
        # Controls use a freshly loaded real source; mutated states are never saved.
        path = sources[0]
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
            d, _b = glb.read(raw)
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
            d, _b = glb.read(exact)
            acc = d["accessors"][
                d["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]
            ]
            assert (
                acc["componentType"] == 5126
                and acc["type"] == "VEC4"
                and not acc.get("normalized")
            )
            result["float_adapter"] = {
                "status": "PASS",
                "componentType": 5126,
                "type": "VEC4",
            }
            try:
                restore_float_masks(raw)
            except RuntimeError as e:
                result["controls"].append(
                    {
                        "name": "missing_float_carriers",
                        "status": "PASS",
                        "reason": str(e),
                    }
                )
            else:
                raise AssertionError("Missing carriers accepted")
        result["run_id"] = attempt.id
        write_json(OUT / "source_manifest.json", result)
        attempt.finish(
            "PASS", meshes=len(result["meshes"]), controls=len(result["controls"])
        )
        print("SOURCE_AUDIT_PASS", attempt.id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--src-dir", type=Path, default=ROOT / "assets/blend/flora")
    parser.add_argument(
        "--report-dir", type=Path, default=DEFAULT_EVIDENCE / "source-audit"
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    audit(args.src_dir, args.report_dir)
