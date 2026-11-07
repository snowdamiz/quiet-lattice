"""Small CPU-only behavior tests. No bpy, Blender, source assets or renders required."""

import importlib.util
import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import capture_plan as plan


def matrix(x=0, y=0, z=0):
    return [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]


def image(name, payload):
    return {"name": name, "packed_clean": True, "sha256": payload, "width": 512, "height": 512,
            "colorspace": "sRGB", "alpha_mode": "STRAIGHT"}


def lattice():
    vertices, edges = [], []
    for i in range(3):
        for a, b in (((0, i, 0), (2, i, 0)), ((i, 0, 0), (i, 2, 0))):
            edges.append((len(vertices), len(vertices) + 1))
            vertices.extend((a, b))
    return {"vertices": vertices, "edges": edges}


def extracted():
    return {
        "lod0_meshes": ["Body", "CanopyGlass"], "collider_names": ["COL_Body"],
        "biped": {"vertices": [(0, 0, 0), (0, 0, 1.85)]}, "grid": lattice(),
        "boarding_xyz": [-3, 1, -.2], "hardpoints": [{"name": "HP_S_1", "matrix_world": matrix(), "child_meshes": []}],
        "pivots": [{"name": "Canopy", "matrix_world": matrix()}],
        "materials": {name: image("default", "a" * 64) for name in plan.MATERIALS},
        "images": {"lark_livery_compact": image("lark_livery_compact", "b" * 64),
                   "lark_livery_working": image("lark_livery_working", "c" * 64)},
    }


def adapter():
    # Import the real filesystem orchestration without loading Blender. Rendering is
    # replaced only in the orchestration tests below, never represented as exercised.
    mathutils = types.ModuleType("mathutils")
    mathutils.Vector = object
    spec = importlib.util.spec_from_file_location("capture_under_test", Path(__file__).with_name("capture.py"))
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"bpy": types.ModuleType("bpy"), "mathutils": mathutils}):
        spec.loader.exec_module(module)
    return module


class DecisionTests(unittest.TestCase):
    def test_shared_asset_markers_survive_without_mixing_variant_or_lod(self):
        self.assertEqual(plan.base_scope([["lark"]]), "shared_asset")
        self.assertEqual(plan.base_scope([["lark", "lark_LOD0", "Canopy"]]), "base_lod0")
        for path in (["lark", "lark_damaged_LOD0"], ["lark", "lark_LOD2", "Canopy"],
                     ["lark", "lark_husked", "Markers"], ["lark", "_scratch", "lark_LOD0"]):
            self.assertEqual(plan.base_scope([path]), "excluded")
        with self.assertRaises(ValueError):
            plan.base_scope([["lark", "lark_LOD0"], ["lark", "lark_LOD1"]])

    def test_seat_marker_identity_rotation_and_positive_distance_cannot_qualify_fit(self):
        facts = extracted()
        facts.update({"seat_xyz": [0, 0, 1.52], "canopy_closed": True, "seated_pose": "verified",
                      "canopy_glass": {"status": "ok", "triangles": [((0, 0, 3), (1, 0, 3), (0, 1, 3))]},
                      "unsigned_origin_distance": 2.0})
        report = plan.assemble_report(facts)
        shots = plan.plan_shots(facts, report)
        self.assertEqual(report["seated_pose"], "not_verified")
        self.assertEqual(report["canopy_closed"], "not_verified")
        self.assertEqual(report["closed_headroom"], "not_measured")
        self.assertEqual(report["collision_clearance"], "not_measured")
        self.assertEqual(report["pivots"][0]["closed_state"], "not_verified")
        self.assertEqual({s["id"] for s in shots["shots"]},
                         {"standing-reference-scale", "colliders-marker-axes", "livery-lineup"})
        gaps = next(s for s in shots["skipped"] if s["id"] == "seated-closed-canopy")
        self.assertTrue(any("joint pose" in gap for gap in gaps["missing"]))
        self.assertTrue(any("closed canopy target" in gap for gap in gaps["missing"]))
        self.assertNotIn("distance_m", json.dumps(report))

    def test_children_are_observed_hierarchy_never_equipment_proof(self):
        for children in ([], ["MountMesh"], ["REFERENCE_MODULE_HP_S_1"], ["Weapon", "Bracket"]):
            with self.subTest(children=children):
                facts = extracted()
                facts["hardpoints"][0]["child_meshes"] = children
                marker = plan.assemble_report(facts)["hardpoints"][0]
                self.assertEqual(marker["child_meshes"], children)
                self.assertEqual(marker["mounted_module"], "not_verified")
                self.assertEqual(marker["axis_clearance"], "not_measured")
                self.assertNotIn("static_origin_to_collider", marker)

    def test_world_transform_changes_scale_and_stored_axes(self):
        facts = extracted()
        scaled = [[0, -2, 0, 4], [1, 0, 0, 5], [0, 0, 2, 6], [0, 0, 0, 1]]
        facts["biped"]["vertices"] = plan.world_points(facts["biped"]["vertices"], scaled)
        facts["hardpoints"][0]["matrix_world"] = scaled
        report = plan.assemble_report(facts)
        self.assertEqual(report["biped"]["vertical_extent_m"], 3.7)
        self.assertFalse(report["biped"]["matches_1_85m_extent"])
        self.assertEqual(report["hardpoints"][0]["axis_columns_xyz"], [[0, 1, 0], [-2, 0, 0], [0, 0, 2]])
        self.assertEqual(report["hardpoints"][0]["translation_m"], [4, 5, 6])
        self.assertEqual(plan.world_points([(1, 0, 0)], matrix(z=3)), [(1, 0, 3)])
        self.assertNotEqual(plan.world_points([(1, 0, 0)], matrix(z=3)),
                            plan.world_points([(1, 0, 0)], matrix(z=4)))
        with self.assertRaises(ValueError):
            plan.world_points([(float("nan"), 0, 0)], matrix())

    def test_standing_scale_survives_without_seat_or_canopy_proof(self):
        report = plan.assemble_report(extracted())
        self.assertEqual(report["biped"]["vertical_extent_m"], 1.85)
        self.assertTrue(report["biped"]["matches_1_85m_extent"])
        self.assertTrue(report["grid"]["matches_1m_lattice"])
        self.assertEqual(report["standing_reference_placement"]["lowest_band_center_m"], [-3, 1, 0])
        self.assertEqual(report["standing_reference_placement"]["marker_z_minus_grid_m"], -.2)
        self.assertEqual(report["biped"]["production_actor"], "not_verified")
        facts = extracted()
        facts["biped"]["vertices"][-1] = (0, 0, 1.7)
        self.assertFalse(plan.assemble_report(facts)["biped"]["matches_1_85m_extent"])

    def test_single_one_metre_edge_is_not_a_one_metre_grid(self):
        self.assertFalse(plan.grid_fact([(0, 0, 0), (1, 0, 0)], [(0, 1)])["matches_1m_lattice"])
        grid = lattice()
        grid["vertices"] = [(x, y, x*.1) for x, y, z in grid["vertices"]]
        self.assertFalse(plan.grid_fact(**grid)["matches_1m_lattice"])
        facts = extracted()
        facts["grid"] = grid
        self.assertIsNone(plan.assemble_report(facts)["standing_reference_placement"])

    def test_livery_names_and_unused_materials_do_not_qualify_a_lineup(self):
        facts = extracted()
        self.assertTrue(plan.assemble_report(facts)["liveries"]["lineup"])
        facts["images"]["lark_livery_working"]["sha256"] = "b" * 64
        self.assertFalse(plan.assemble_report(facts)["liveries"]["lineup"])
        facts = extracted()
        del facts["materials"]["Lark_Trim"]
        facts["unused_materials"] = {"Lark_Trim": image("default", "a" * 64)}
        self.assertFalse(plan.assemble_report(facts)["liveries"]["lineup"])
        facts = extracted()
        facts["images"]["lark_livery_working"]["packed_clean"] = False
        self.assertFalse(plan.assemble_report(facts)["liveries"]["lineup"])
        facts = extracted()
        facts["livery_graph_gaps"] = ["unresolved active graph"]
        self.assertFalse(plan.assemble_report(facts)["liveries"]["lineup"])
        facts = extracted()
        facts["materials"]["Lark_Trim"]["colorspace"] = "Non-Color"
        self.assertFalse(plan.assemble_report(facts)["liveries"]["lineup"])

    def test_missing_hull_cannot_render_unrelated_reference_or_materials(self):
        facts = extracted()
        facts["lod0_meshes"] = []
        self.assertEqual(plan.plan_shots(facts, plan.assemble_report(facts))["shots"], [])
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            plan.parse_args(["--blend", "source", "--out", "new", "--variant", "lark_damaged"])

    def test_cpu_bounds(self):
        good = {"engine": "CYCLES", "device": "CPU", "denoising_use_gpu": False, "use_denoising": True,
                "denoiser": "OPENIMAGEDENOISE", "width": 640, "height": 480, "samples": 8,
                "images_already": 0, "threads": 2}
        self.assertEqual(plan.gate_render(good), [])
        for key, bad in (("device", "GPU"), ("denoiser", "OPTIX"), ("denoising_use_gpu", None),
                         ("width", 2000), ("samples", 32), ("images_already", 3)):
            with self.subTest(key=key):
                self.assertTrue(plan.gate_render({**good, key: bad}))


class OutputTests(unittest.TestCase):
    def test_snapshot_preserves_evaluated_material_faces_and_world_transform(self):
        module = adapter()

        class Material:
            def __init__(self, name):
                self.name = name
                self.node_tree = None

            def copy(self):
                return Material(self.name + " copy")

            def animation_data_clear(self):
                pass

        polygons = [types.SimpleNamespace(material_index=1), types.SimpleNamespace(material_index=0)]

        class Slots(list):
            def clear(self):
                super().clear()
                for polygon in polygons:
                    polygon.material_index = 0

        mesh = types.SimpleNamespace(polygons=polygons, materials=Slots())
        materials = [Material("Hull"), Material("Accent")]
        evaluated = types.SimpleNamespace(material_slots=[types.SimpleNamespace(material=m) for m in materials],
                                          matrix_world=matrix(3, 4, 5))
        source = types.SimpleNamespace(name="Body", evaluated_get=lambda graph: evaluated)
        linked = []
        module.bpy.data = types.SimpleNamespace(
            meshes=types.SimpleNamespace(new_from_object=lambda *a, **k: mesh),
            objects=types.SimpleNamespace(new=lambda name, data: types.SimpleNamespace(name=name, data=data)))
        scene = types.SimpleNamespace(collection=types.SimpleNamespace(objects=types.SimpleNamespace(link=linked.append)))
        result = module.snapshot_mesh(source, scene, object(), {})
        self.assertEqual([p.material_index for p in result.data.polygons], [1, 0])
        self.assertEqual([m.name for m in result.data.materials], ["Hull copy", "Accent copy"])
        self.assertEqual(result.matrix_world, matrix(3, 4, 5))
        self.assertIsNot(result.matrix_world, evaluated.matrix_world)
        self.assertEqual(linked, [result])

    def test_disconnected_paint_graph_cannot_replace_active_material_identity(self):
        module = adapter()

        class Inputs(dict):
            def __iter__(self):
                return iter(self.values())

        class Node:
            def __init__(self, kind, inputs=None, image=None):
                self.type = kind
                self.inputs = Inputs(inputs or {})
                self.image = image
                self.is_active_output = kind == "OUTPUT_MATERIAL"

        def socket(node):
            return types.SimpleNamespace(links=[types.SimpleNamespace(from_node=node)])

        used = Node("TEX_IMAGE", image=object())
        unused = Node("TEX_IMAGE", image=object())
        shader = Node("BSDF_PRINCIPLED", {"Base Color": socket(used)})
        inactive_shader = Node("BSDF_PRINCIPLED", {"Base Color": socket(unused)})
        output = Node("OUTPUT_MATERIAL", {"Surface": socket(shader)})
        material = types.SimpleNamespace(name="Hull", use_nodes=True,
                                         node_tree=types.SimpleNamespace(nodes=[inactive_shader, unused, used, shader, output]))
        self.assertIs(module.base_color_node(material), used)
        shader.inputs["Base Color"] = types.SimpleNamespace(links=[])
        self.assertIsNone(module.base_color_node(material))

    def test_image_filepaths_and_names_are_not_backing_or_identity(self):
        module = adapter()
        for packed, dirty, size in ((None, False, (512, 512)), (b"pixels", True, (512, 512)),
                                    (b"pixels", False, (0, 0))):
            candidate = types.SimpleNamespace(name="lark_livery_compact", filepath="/missing/image.png",
                                              packed_file=types.SimpleNamespace(data=packed) if packed else None,
                                              source="FILE", is_dirty=dirty, size=size,
                                              colorspace_settings=types.SimpleNamespace(name="sRGB"), alpha_mode="STRAIGHT")
            self.assertFalse(module.image_fact(candidate)["packed_clean"])
        candidate = types.SimpleNamespace(name="one", packed_file=types.SimpleNamespace(data=b"same payload"),
                                          source="FILE", is_dirty=False, size=(512, 512),
                                          colorspace_settings=types.SimpleNamespace(name="sRGB"), alpha_mode="STRAIGHT")
        first = module.image_fact(candidate)
        candidate.name = "two"
        self.assertEqual(first["sha256"], module.image_fact(candidate)["sha256"])

    def test_existing_output_files_and_symlink_targets_survive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.blend"
            source.write_bytes(b"source")
            old = root / "old"
            (old / ".cells").mkdir(parents=True)
            originals = {"receipt.json": b"old receipt", "cockpit-closed-canopy.png": b"user image",
                         ".cells/custom.png": b"unknown data"}
            for name, data in originals.items():
                (old / name).write_bytes(data)
            link = root / "alias"
            link.symlink_to(old, target_is_directory=True)
            for out in (old, link):
                with self.assertRaises(FileExistsError):
                    plan.claim_output(out, source)
            for name, data in originals.items():
                self.assertEqual((old / name).read_bytes(), data)
            fresh = plan.claim_output(root / "fresh", source)
            self.assertTrue(fresh.is_dir())
            with self.assertRaises(FileExistsError):
                plan.claim_output(fresh, source)
            with self.assertRaises(ValueError):
                plan.claim_output(root, source)

    def test_wrong_hash_cannot_start_capture_or_create_output(self):
        module = adapter()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.blend"
            source.write_bytes(b"obsolete input")
            out = root / "out"
            with patch.object(module, "capture") as render:
                with self.assertRaises(SystemExit):
                    module.main(["--blend", str(source), "--out", str(out)])
                render.assert_not_called()
            self.assertFalse(out.exists())

    def test_failure_exit_and_source_mutation_write_invalid_receipts(self):
        module = adapter()
        for changes_source in (False, True):
            with self.subTest(changes_source=changes_source), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source = root / "source.blend"
                source.write_bytes(b"pinned test bytes")
                out = root / "out"
                def fail(args, blend, destination):
                    if changes_source:
                        blend.write_bytes(b"changed during capture")
                    raise SystemExit("CPU gate refused")
                with patch.object(plan, "SOURCE_SHA256", module.file_sha256(source)), patch.object(module, "capture", fail):
                    with self.assertRaises(SystemExit):
                        module.main(["--blend", str(source), "--out", str(out)])
                receipt = json.loads((out / "receipt.json").read_text())
                self.assertEqual(receipt["status"], "invalid_source_changed" if changes_source else "failed")
                self.assertEqual(receipt["blend"]["bytes_unchanged"], not changes_source)
                self.assertEqual(receipt["images"], [])
                self.assertEqual(receipt["review_qualification"], "not_claimed")


if __name__ == "__main__":
    unittest.main()
