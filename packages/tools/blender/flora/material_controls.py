"""Full-validator material regressions on real GLBs. Stock positive must pass too."""

import argparse
import sys
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from artlib import core, materials, rules
from receipts import DEFAULT_EVIDENCE, ROOT, Attempt, write_json


def controls(evidence):
    config = rules.load()
    with Attempt(evidence, "material-controls") as attempt:
        source = attempt.snapshot(
            ROOT / "assets/blend/flora/non_tree_stone.blend", "sources"
        )
        export = attempt.snapshot(
            ROOT / "packages/client/public/models/flora/non_tree_stone.glb",
            "exports",
        )
        rows = []
        for case in (
            "baseline",
            "disabled_value_output",
            "inactive_named_black_mask",
            "partial_factor",
            "linked_factor",
            "missing_image",
            "wrong_mask",
        ):
            core.load(export)
            material = bpy.data.materials["Flora_rock"]
            node = next(
                n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"
            )
            socket = node.inputs["Base Color"]
            mix = socket.links[0].from_node
            mask = next(
                link.from_node
                for inp in mix.inputs
                for link in inp.links
                if link.from_node.type == "VERTEX_COLOR"
            )
            texture = next(
                link.from_node
                for inp in mix.inputs
                for link in inp.links
                if link.from_node.type == "TEX_IMAGE"
            )
            if case == "disabled_value_output":
                material.node_tree.links.remove(socket.links[0])
                assert not mix.outputs[0].enabled and mix.outputs[0].type == "VALUE"
                material.node_tree.links.new(mix.outputs[0], socket)
            elif case == "inactive_named_black_mask":
                mask.layer_name = "Color"
                for obj in bpy.context.scene.objects:
                    if obj.type != "MESH" or not any(
                        slot.material == material for slot in obj.material_slots
                    ):
                        continue
                    active = obj.data.color_attributes.active_color
                    active.name = "VerifiedMask"
                    bad = obj.data.color_attributes.new(
                        "Color", "FLOAT_COLOR", "CORNER"
                    )
                    bad.data.foreach_set(
                        "color", np.zeros(len(bad.data) * 4, dtype=np.float32)
                    )
                    obj.data.color_attributes.active_color = active
            elif case == "partial_factor":
                mix.inputs[0].default_value = 0.5
            elif case == "linked_factor":
                value = material.node_tree.nodes.new("ShaderNodeValue")
                value.outputs[0].default_value = 1
                material.node_tree.links.new(value.outputs[0], mix.inputs[0])
            elif case == "missing_image":
                texture.image = None
            elif case == "wrong_mask":
                mask.layer_name = "NotTheValidatedMask"
            materials.clear_cache()
            report = core.run_checks(config, export, "flora", "export", source=source)
            report.write(attempt.path / "reports" / (case + ".json"), str)
            rejected = any(
                f["check"] == "materials" and "Flora_rock" in f["subject"]
                for f in report.failures()
            )
            rows.append(
                {
                    "case": case,
                    "status": report.status,
                    "target_material_rejected": rejected,
                }
            )
        passed = rows[0]["status"] == "PASS" and all(
            row["target_material_rejected"] for row in rows[1:]
        )
        write_json(
            attempt.path / "controls.json",
            {"route": "stock", "cases": rows},
        )
        attempt.assert_stable()
        attempt.finish(
            "PASS" if passed else "FAIL",
            cases=rows,
            note="Stock positive and every full negative are required",
        )
        print("MATERIAL_CONTROLS", "PASS" if passed else "FAIL", rows)
        return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report-dir", type=Path, default=DEFAULT_EVIDENCE / "material-controls"
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    sys.exit(controls(args.report_dir))
