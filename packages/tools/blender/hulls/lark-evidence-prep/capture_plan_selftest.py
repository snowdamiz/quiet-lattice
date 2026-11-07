"""CPU-free checks for the Lark evidence plan. Run: python3 capture_plan_selftest.py"""

import json
import tempfile
import unittest
from pathlib import Path

import capture_plan as plan


def _material(key, name="lark_baseColor", width=4096, height=4096, backed=True):
    return {"key": key, "name": name, "width": width, "height": height, "backed": backed}


def _ready_inputs():
    materials = {name: _material("thalune-image", name="lark_thalune_baseColor") for name in plan.MATERIALS}
    images = {
        "lark_livery_compact": {"key": "compact-image", "width": 4096, "height": 4096, "backed": True},
        "lark_livery_working": {"key": "working-image", "width": 2048, "height": 2048, "backed": True},
    }
    return materials, images


def _triangle():
    return [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))]


def _glass_above():
    # Covers the seat xy (0, 1.15), so the gap is the vertical distance to z=3.
    return {
        "status": "ok",
        "triangles": [((-1.0, 0.15, 3.0), (1.0, 0.15, 3.0), (0.0, 2.15, 3.0))],
    }


def _extracted(height=1.85):
    materials, images = _ready_inputs()
    return {
        "biped": {"name": "REF_Biped", "vertices": [(0.0, 0.0, 0.0), (0.0, 0.0, height)]},
        "grid": {
            "name": "REF_Grid",
            "origin_z": 0.0,
            "vertices": [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)],
            "edges": [(0, 1)],
        },
        "boarding_xyz": (-3.0, 0.95, -0.2),
        "seat_xyz": (0.0, 1.15, 1.52),
        "canopy_glass": _glass_above(),
        "canopy_frame": {"status": "missing", "triangles": []},
        "colliders": {
            "names": ["COL_Body"],
            "status": "ok",
            "triangles": [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))],
        },
        "hardpoints": [
            {
                "name": "HP_S_1",
                "matrix3": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
                "translation": (-1.72, 2.78, -0.62),
                "child_meshes": [],
            }
        ],
        "pivots": [
            {
                "name": "Canopy",
                "matrix3": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
                "translation": (0.0, -1.12, 1.804),
            }
        ],
        "materials": materials,
        "images": images,
        "dropped_duplicate_names": ["CanopyGlass.001"],
    }


class PlanTests(unittest.TestCase):
    def test_parse_requires_paths_and_rejects_oversize(self):
        with self.assertRaises(SystemExit):
            plan.parse_args(["--blend", "hull.blend"])
        with self.assertRaises(SystemExit):
            plan.parse_args(["--blend", "hull.blend", "--out", "out", "--width", "2000"])
        with self.assertRaises(SystemExit):
            plan.parse_args(["--blend", "hull.blend", "--out", "out", "--samples", "64"])
        args = plan.parse_args(["--blend", "hull.blend", "--out", "out", "--variant", "lark"])
        self.assertEqual(args["width"], 640)
        self.assertEqual(args["samples"], 8)

    def test_output_dir_cannot_contain_the_blend(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            blend = root / "hulls" / "lark.blend"
            blend.parent.mkdir()
            blend.write_bytes(b"blend")
            self.assertFalse(plan.output_allowed(blend.parent, blend))
            self.assertFalse(plan.output_allowed(root, blend))
            self.assertTrue(plan.output_allowed(root / "evidence", blend))

    def test_gate_rejects_gpu_and_optix(self):
        good = {
            "engine": "CYCLES",
            "device": "CPU",
            "denoising_use_gpu": False,
            "use_denoising": True,
            "denoiser": "OPENIMAGEDENOISE",
            "samples": 8,
            "width": 640,
            "height": 480,
            "images_already": 0,
            "threads": 2,
        }
        self.assertEqual(plan.gate_render(good), [])
        self.assertIn("device", plan.gate_render({**good, "device": "GPU"}))
        self.assertIn("denoising_use_gpu", plan.gate_render({**good, "denoising_use_gpu": True}))
        self.assertIn("denoising_use_gpu", plan.gate_render({**good, "denoising_use_gpu": None}))
        self.assertIn("denoiser", plan.gate_render({**good, "denoiser": "OPTIX"}))
        self.assertEqual(plan.gate_render({**good, "denoiser": "OPTIX", "use_denoising": False}), [])

    def test_livery_lineup_requires_three_distinct_backed_images(self):
        materials, images = _ready_inputs()
        ready = plan.resolve_liveries(materials, images)
        self.assertTrue(ready["lineup"])
        self.assertEqual([item["id"] for item in ready["sources"]], ["thalune", "compact", "working"])
        images.pop("lark_livery_working")
        missing = plan.resolve_liveries(materials, images)
        self.assertFalse(missing["lineup"])
        self.assertIn("lark_livery_working", missing["missing"])
        images["lark_livery_working"] = {"key": "working-image", "width": 0, "height": 0, "backed": True}
        self.assertFalse(plan.resolve_liveries(materials, images)["lineup"])
        images["lark_livery_working"] = {"key": "compact-image", "width": 32, "height": 32, "backed": True}
        images["lark_livery_compact"] = {"key": "compact-image", "width": 32, "height": 32, "backed": True}
        same = plan.resolve_liveries(materials, images)
        self.assertEqual(same["reason"], "liveries_not_distinct")
        self.assertFalse(same["lineup"])
        materials["Lark_Accent"] = _material("other-image")
        disagreed = plan.resolve_liveries(materials, _ready_inputs()[1])
        self.assertEqual(disagreed["reason"], "thalune_materials_disagree")
        self.assertFalse(disagreed["lineup"])
        unbacked = _ready_inputs()
        unbacked[1]["lark_livery_compact"]["backed"] = False
        self.assertFalse(plan.resolve_liveries(*unbacked)["lineup"])

    def test_names_drop_lod_duplicates_and_damage_variants(self):
        picked = plan.prefer_unsuffixed(["CanopyGlass.001", "CanopyGlass", "HP_S_1.001"])
        self.assertEqual(picked["kept"], ["CanopyGlass", "HP_S_1.001"])
        self.assertEqual(picked["dropped_duplicates"], ["CanopyGlass.001"])
        self.assertTrue(plan.is_hardpoint_name("HP_S_2"))
        self.assertFalse(plan.is_hardpoint_name("HP_S_2_dmg"))
        self.assertTrue(plan.is_collider_name("COL_Body"))
        self.assertFalse(plan.is_canopy_surface("CanopyGlass_husk", "glass"))
        self.assertTrue(plan.is_canopy_surface("CanopyFrame.002", "frame"))
        self.assertTrue(plan.is_rest_pivot("GearAssembly"))
        self.assertFalse(plan.is_rest_pivot("CanopyFrame"))

    def test_distance_segment_and_caps(self):
        triangle = _triangle()[0]
        self.assertAlmostEqual(plan.point_triangle_distance((0.2, 0.2, 0.0), triangle), 0.0, places=6)
        self.assertAlmostEqual(plan.point_triangle_distance((0.2, 0.2, 1.0), triangle), 1.0, places=6)
        self.assertAlmostEqual(plan.point_triangle_distance((2.0, 0.0, 0.0), triangle), 1.0, places=6)
        self.assertTrue(plan.segment_intersects_triangle((0.2, 0.2, -1.0), (0.2, 0.2, 1.0), triangle))
        self.assertFalse(plan.segment_intersects_triangle((2.0, 2.0, -1.0), (2.0, 2.0, 1.0), triangle))
        self.assertFalse(plan.segment_intersects_triangle((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), triangle))
        capped = plan.distances_to_triangles([(0.0, 0.0, 1.0)] * (plan.VERTEX_CAP + 1), _triangle())
        self.assertEqual(capped["status"], "vertex_cap_exceeded")
        self.assertIsNone(capped["distance_m"])
        self.assertEqual(capped["dynamic_clearance"], "not_measured")
        product = plan.distances_to_triangles([(0.0, 0.0, 1.0)] * 2000, _triangle() * 2000)
        self.assertEqual(product["status"], "product_cap_exceeded")
        self.assertIsNone(product["distance_m"])

    def test_height_mismatch_skips_eye_and_does_not_invent_clearance(self):
        short = plan.assemble_report(_extracted(height=1.70))
        self.assertFalse(short["biped"]["matches_1_85"])
        eye = next(item for item in short["clearance"]["probes"] if item["id"] == "convention_eye")
        self.assertEqual(eye["status"], "skipped_height_mismatch")
        self.assertIsNone(eye["point"])
        self.assertNotIn("distance_m", eye)
        crown = next(item for item in short["clearance"]["probes"] if item["id"] == "mesh_crown")
        self.assertEqual(crown["glass"]["distance_m"], 0.98)
        self.assertEqual(crown["frame"]["status"], "not_measured")
        self.assertIsNone(crown["frame"]["distance_m"])

    def test_matching_biped_reports_static_gaps_only(self):
        report = plan.assemble_report(_extracted())
        self.assertTrue(report["biped"]["matches_1_85"])
        self.assertEqual(report["biped"]["height_m"], 1.85)
        self.assertTrue(report["grid"]["matches_1m"])
        boarding = report["placements"]["boarding"]
        self.assertEqual(boarding["feet_xyz"], [-3.0, 0.95, 0.0])
        self.assertEqual(boarding["marker_z_minus_grid_m"], -0.2)
        cockpit = report["placements"]["cockpit_standing"]
        self.assertEqual(cockpit["implied_floor_z"], 0.32)
        self.assertEqual(cockpit["feet_xyz"][2], 0.32)
        self.assertIn("no joint rotation", cockpit["pose"])
        crown = next(item for item in report["clearance"]["probes"] if item["id"] == "mesh_crown")
        self.assertEqual(crown["point"][2], 2.17)
        self.assertEqual(crown["glass"]["distance_m"], 0.83)
        eye = next(item for item in report["clearance"]["probes"] if item["id"] == "convention_eye")
        self.assertEqual(eye["point"][2], 2.02)
        self.assertEqual(eye["glass"]["distance_m"], 0.98)
        self.assertFalse(report["clearance"]["standing_segment_intersects"]["glass"]["hits"])
        self.assertEqual(report["hardpoints"][0]["mounted_module"], "absent")
        self.assertEqual(report["hardpoints"][0]["axis_clearance"], "not_measured")
        self.assertTrue(report["hardpoints"][0]["rotation_identity"])
        self.assertNotIn("static_origin_to_collider", report["hardpoints"][0])
        self.assertEqual(report["pivots"][0]["motion"], "not_measured")
        self.assertTrue(report["liveries"]["lineup"])
        self.assertEqual(report["dynamic_clearance"], "not_measured")
        self.assertEqual(report["review_qualification"], "not_claimed")

    def test_present_module_gets_a_static_collider_gap(self):
        extracted = _extracted()
        extracted["hardpoints"][0]["child_meshes"] = ["MountMesh"]
        extracted["hardpoints"][0]["translation"] = (0.2, 0.2, 1.0)
        report = plan.assemble_report(extracted)
        gap = report["hardpoints"][0]["static_origin_to_collider"]
        self.assertEqual(gap["distance_m"], 1.0)
        self.assertEqual(gap["dynamic_clearance"], "not_measured")
        self.assertIn("not reported as penetration", report["hardpoints"][0]["static_origin_to_collider_note"])

    def test_too_many_child_meshes_stay_unmeasured(self):
        record = plan.module_clearance([f"Mesh{i}" for i in range(9)])
        self.assertEqual(record["mounted_module"], "ambiguous")
        self.assertEqual(record["axis_clearance"], "not_measured")

    def test_missing_sources_skip_shots_and_keep_the_image_cap(self):
        extracted = _extracted()
        extracted["images"] = {}
        extracted["boarding_xyz"] = None
        extracted["canopy_glass"] = {"status": "triangle_cap_exceeded", "triangles": []}
        report = plan.assemble_report(extracted)
        self.assertFalse(report["liveries"]["lineup"])
        self.assertIsNone(report["clearance"]["probes"][0]["glass"]["distance_m"])
        self.assertEqual(report["clearance"]["probes"][0]["glass"]["status"], "triangle_cap_exceeded")
        facts = plan.shot_facts(extracted, report["liveries"]["lineup"])
        planned = plan.plan_shots(facts)
        ids = [shot["id"] for shot in planned["shots"]]
        self.assertNotIn("boarding-standing", ids)
        self.assertNotIn("cockpit-closed-canopy", ids)
        self.assertNotIn("livery-lineup", ids)
        self.assertIn("colliders-axes", ids)
        self.assertLessEqual(len(planned["shots"]), plan.MAX_IMAGES)
        full = plan.plan_shots(plan.shot_facts(_extracted(), True))
        self.assertEqual(
            [shot["id"] for shot in full["shots"]],
            ["boarding-standing", "cockpit-closed-canopy", "colliders-axes", "livery-lineup"],
        )
        self.assertEqual(full["shots"][-1]["width"] * full["shots"][-1]["height"] <= plan.MAX_PIXELS, True)
        self.assertEqual(full["shots"][0]["frame"], "biped")
        self.assertEqual(full["shots"][1]["frame"], "biped_and_canopy")

    def test_every_dynamic_clearance_value_is_the_unmeasured_token(self):
        found = []

        def walk(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "dynamic_clearance":
                        found.append(value)
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(plan.assemble_report(_extracted()))
        self.assertTrue(found)
        self.assertTrue(all(value == "not_measured" for value in found))

    def test_report_is_json_ready(self):
        encoded = json.dumps(plan.assemble_report(_extracted()))
        self.assertIn("lark-evidence-prep/1", encoded)
        self.assertNotIn("NaN", encoded)

    def test_capture_script_refuses_save_and_gates_the_render(self):
        source = Path(__file__).with_name("capture.py").read_text()
        for banned in ("save_mainfile", "save_as_mainfile", "ops.wm.save", ".pack(", "rotation_euler.x", "radians("):
            self.assertNotIn(banned, source, banned)
        self.assertIn('scene.cycles.device = "CPU"', source)
        self.assertIn("scene.cycles.denoising_use_gpu = False", source)
        self.assertIn("sha256", source)
        body = source.split("def render_pixels", 1)[1].split("\ndef ", 1)[0]
        self.assertLess(body.index("require_cpu("), body.index("bpy.ops.render.render"))
        self.assertEqual(source.count("bpy.ops.render.render"), 1)


if __name__ == "__main__":
    unittest.main()
