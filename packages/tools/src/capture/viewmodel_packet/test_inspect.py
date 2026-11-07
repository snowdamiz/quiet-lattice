"""Sequential CPU fixtures; these tests do not qualify poses or native capture."""

from contextlib import contextmanager, redirect_stderr, redirect_stdout
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

from PIL import Image


HERE = Path(__file__).resolve().parent
MODULE_SPEC = importlib.util.spec_from_file_location("viewmodel_inspector", HERE / "inspect_packet.py")
inspector = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(inspector)
INVENTORY = json.loads((HERE / "inventory.json").read_text())


@contextmanager
def replace(obj, name, value):
    previous = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield previous
    finally:
        setattr(obj, name, previous)


def texture_materials(people):
    names = ["Skin", f"VM_{people}_Tool"] + (["Bio"] if people != "ulgani" else [])
    return [{"name": name, "slots": {slot: [2048, 2048, 12] for slot in
            ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] +
            (["emissiveMap"] if name != "Skin" else [])}} for name in names]


def raw_observations(spec):
    frames, elapsed = [], 0
    for index, name in enumerate(n for n in spec["files"] if n.endswith(".png") and n != "sheet.png"):
        pose = name.split("-", 1)[1][:-4]
        gap, underwater = pose == "switch-gap", pose == "underwater"
        dt = 0 if pose in ("raise-0", "overheat") else 0.4
        elapsed += dt
        width = 2520 if name.startswith("21x9") else 1920
        frame = {"file": name, "viewport": [width, 1080], "canvas": [width, 1080],
                 "frame": index + 1, "dt": dt, "elapsed": elapsed,
                 "people": spec["people"], "visible": not gap and not underwater,
                 "modelAttached": not gap, "loaderPending": gap,
                 "raise": 0 if gap or underwater or pose == "raise-0" else 1,
                 "sway": {"sway-left": [-0.035, 0], "sway-right": [0.035, 0],
                          "sway-up": [0, 0.03], "sway-down": [0, -0.03]}.get(pose, [0, 0]),
                 "raiseSeconds": 0 if pose == "raise-0" else 0.4 if pose == "raise-0.4" else None,
                 "heat": 0.9 if pose == "overheat" else 0.1,
                 "overheated": pose == "overheat", "firing": pose == "fire",
                 "beamVisible": pose == "fire", "underwater": underwater,
                 "materials": [] if gap else texture_materials(spec["people"])}
        if pose == "fire":
            frame["projection"] = {"view": [0.2, -0.3, 0.1], "world": [0.2, -0.3, 0.9],
                                   "beam": [0.2, -0.3, 0.9], "viewMuzzle": [0.1, -0.2, -0.4],
                                   "worldMuzzle": [0.5, -0.6, -0.4],
                                   "viewCamera": {"fov": 55, "aspect": width / 1080, "near": 0.01, "far": 10},
                                   "worldCamera": {"fov": 70, "aspect": width / 1080, "near": 0.1, "far": 10000}}
        frames.append(frame)
    return {"version": 1, "unit": spec["id"], "people": spec["people"],
            "fromPeople": spec["fromPeople"],
            "incoming": {"people": spec["fromPeople"] or spec["people"], "visible": True, "modelAttached": True,
                         "materials": texture_materials(spec["fromPeople"] or spec["people"])}, "fixture": "offline-dev-first-person",
            "serverAuthority": False, "errors": [], "frames": frames}


def raw_perf(spec):
    return {"file": spec["asset"], "class": "viewmodel", "viewport": [1920, 1080], "errors": [],
            "stats": {"lods": [0], "shown": 0, "lod": 0,
                      "materials": [m["name"] for m in texture_materials(spec["people"])]},
            "far": [{"range": 100, "lod": 2, "shown": 0, "clear": True}],
            "overlay": {"labelled": ["Muzzle"], "counts": {"Muzzle": 1}, "offscreen": 0},
            "packet": {"version": 1, "unit": spec["id"], "people": spec["people"],
                       "materials": texture_materials(spec["people"]), "overlayMarkers": ["Muzzle"],
                       "gripOverlay": False, "captures": [
                           {"file": name, "requestedLOD": 2 if name.endswith("_lod2.png") else 0,
                            "selectedLOD": 0, "far": 100 if name == "far_lod2.png" else None}
                           for name in spec["files"] if name.endswith(".png") and name != "sheet.png"]}}


class Packet:
    def __init__(self, root, unit):
        self.root = root
        self.output = root / "output"
        self.output.mkdir()
        self.spec = copy.deepcopy(next(s for s in INVENTORY["units"] if s["id"] == unit))
        self.readout = "perf.json" if self.spec["kind"] == "review" else "observations.json"
        self.value = raw_perf(self.spec) if self.spec["kind"] == "review" else raw_observations(self.spec)
        count = self.spec["pngCount"] - 1
        for name in self.spec["files"]:
            if not name.endswith(".png"):
                continue
            size = (2520 if name.startswith("21x9") else 1920, 1080)
            if name == "sheet.png":
                size = (1920, 2876 if self.spec["kind"] == "review" else 48 + ((count + 3) // 4) * 294)
            with Image.new("RGB", size, (7, 21, 31)) as picture:
                picture.save(self.output / name)
        self.write()

    def write(self, value=None, raw=None):
        value = self.value if value is None else value
        (self.output / self.readout).write_bytes(raw if raw is not None else json.dumps(value, separators=(",", ":")).encode())
        self.manifest = self.manifest_now()

    def manifest_now(self):
        result = []
        for name in self.spec["files"]:
            raw = (self.output / name).read_bytes()
            result.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        return result

    def run(self):
        return inspector.inspect_packet(self.spec, self.output, self.manifest)


@contextmanager
def packet(unit="return-thalune"):
    with tempfile.TemporaryDirectory(prefix="viewmodel-inspector-test-") as temporary:
        yield Packet(Path(temporary).resolve(), unit)


class InspectorTests(unittest.TestCase):
    def assert_refused(self, fixture, message):
        with self.assertRaises(inspector.InspectionError) as failure:
            fixture.run()
        self.assertIn(message, str(failure.exception))
        return failure.exception

    def test_all_seven_units_decode_each_png_once_and_preserve_unknown_fields(self):
        for spec in INVENTORY["units"]:
            with self.subTest(unit=spec["id"]), packet(spec["id"]) as fixture:
                fixture.value["futureRawFact"] = {"unrecognized": [17, "keep me"]}
                fixture.write()
                decoded = []
                original = inspector.decode_png

                def counted(raw, expected, name):
                    decoded.append(name)
                    return original(raw, expected, name)

                with replace(inspector, "decode_png", counted):
                    result = fixture.run()
                self.assertEqual(result["status"], "PASS")
                self.assertEqual(result[fixture.readout[:-5]], fixture.value)
                self.assertEqual(len(decoded), spec["pngCount"])
                self.assertEqual(len(set(decoded)), len(decoded))
                self.assertLessEqual((fixture.output / fixture.readout).stat().st_size, spec["readoutCap"])

    def test_view_readout_32k_preserves_full_precision_and_unknown_fields(self):
        with packet("view-ixari") as fixture:
            fixture.value["futureEvidence"] = "x" * 3000
            fixture.value["unrounded"] = [1 / 60, 0.035 - 1e-16, 123.45678901234567]
            fixture.write()
            size = (fixture.output / fixture.readout).stat().st_size
            self.assertGreater(size, 16384)
            self.assertLessEqual(size, 32768)
            result = fixture.run()
            self.assertEqual(result["observations"], fixture.value)
            manifest = fixture.root / "manifest.json"
            manifest.write_text(json.dumps({"files": fixture.manifest}))
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(inspector.main(["--inventory", str(HERE / "inventory.json"),
                    "--unit", fixture.spec["id"], "--output", str(fixture.output),
                    "--manifest", str(manifest)]), 0)
            self.assertEqual(json.loads(output.getvalue())["observations"], fixture.value)
            original = fixture.spec["readoutCap"]
            for cap in (16384, 65536, True):
                fixture.spec["readoutCap"] = cap
                self.assert_refused(fixture, "readoutCap")
            fixture.spec["readoutCap"] = original
            fixture.write(raw=b" " * 32769)
            self.assert_refused(fixture, "manifest byte count")

    def test_frame_fact_contradictions_preserve_primary_and_full_raw_observations(self):
        cases = [
            ("16x9-switch-gap.png", "loaderPending", False, "loader/attachment"),
            ("16x9-switch-gap.png", "modelAttached", True, "loader/attachment"),
            ("16x9-switch-gap.png", "materials", [{}], "no materials"),
            ("16x9-switch-settled.png", "loaderPending", True, "loader/attachment"),
            ("16x9-neutral.png", "firing", True, "firing/beam"),
            ("16x9-neutral.png", "visible", False, "visibility"),
            ("16x9-neutral.png", "people", "thalune", "wrong people"),
            ("16x9-neutral.png", "frame", True, "integer"),
            ("16x9-neutral.png", "dt", -1, "frame/time"),
            ("16x9-neutral.png", "elapsed", -1, "frame/time"),
            ("16x9-neutral.png", "viewport", [2520, 1080], "dimensions"),
            ("16x9-neutral.png", "canvas", [1920, 720], "dimensions"),
            ("16x9-neutral.png", "heat", 100, "out of range"),
            ("16x9-neutral.png", "heat", True, "finite number"),
            ("16x9-sway-left.png", "sway", [0.035, 0], "sway did not reach extreme"),
            ("16x9-sway-right.png", "sway", [-0.035, 0], "sway did not reach extreme"),
            ("16x9-sway-up.png", "sway", [0, -0.03], "sway did not reach extreme"),
            ("16x9-sway-down.png", "sway", [0, 0.03], "sway did not reach extreme"),
            ("16x9-sway-down.png", "sway", [0, -0.5], "sway out of range"),
            ("16x9-raise-0.png", "raise", 1, "zero raise"),
            ("16x9-raise-0.png", "dt", 0.1, "frame/time"),
            ("16x9-raise-0.4.png", "raise", 0.8, "did not settle"),
            ("16x9-fire.png", "beamVisible", False, "firing/beam"),
            ("16x9-fire.png", "projection", None, "missing projection"),
            ("16x9-overheat.png", "firing", True, "firing/beam"),
            ("16x9-overheat.png", "heat", 0.7, "insufficient overheat"),
            ("16x9-underwater.png", "visible", True, "visibility"),
            ("16x9-underwater.png", "materials", [], "incorrect materials"),
        ]
        with packet("view-ixari") as fixture:
            for filename, key, value, message in cases:
                with self.subTest(file=filename, key=key):
                    observation = copy.deepcopy(fixture.value)
                    observation["unknownEvidence"] = {"sentinel": "keep-primary"}
                    frame = next(f for f in observation["frames"] if f["file"] == filename)
                    frame[key] = value
                    fixture.write(observation)
                    failure = self.assert_refused(fixture, message)
                    self.assertEqual(failure.evidence["observations"], observation)
                    self.assertIs(failure.raw, failure.evidence)

    def test_material_requirements_and_substitutions(self):
        with packet("review-thalune") as fixture:
            base = fixture.value
            mutations = []
            value = copy.deepcopy(base)
            value["packet"]["materials"][0]["name"] = "VM_thalune_Skin"
            mutations.append((value, "material name"))
            value = copy.deepcopy(base)
            value["packet"]["materials"][1]["name"] = "VM_ixari_Tool"
            mutations.append((value, "material name"))
            for slot in ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]:
                value = copy.deepcopy(base)
                del value["packet"]["materials"][1]["slots"][slot]
                mutations.append((value, "missing texture slots"))
            for facts in ([1024, 2048, 12], [2048, 1024, 12], [2048, 2048, 1], [2048, 2048, 13], [2048, 2048, True]):
                value = copy.deepcopy(base)
                value["packet"]["materials"][0]["slots"]["map"] = facts
                mutations.append((value, "finite number" if facts[-1] is True else "12 mips"))
            for value, message in mutations:
                with self.subTest(value=value["packet"]["materials"]):
                    fixture.write(value)
                    self.assert_refused(fixture, message)
        with packet("review-ulgani") as fixture:
            fixture.value["packet"]["materials"].append(texture_materials("thalune")[-1])
            fixture.write()
            self.assert_refused(fixture, "incorrect materials")

    def test_projection_xy_alignment_camera_and_finite_raw_facts(self):
        with packet("view-thalune") as fixture:
            for key, replacement, message in [
                ("beam", [0.20002, -0.3, 0.9], "misaligned"),
                ("world", [0.2, -0.30002, 0.9], "misaligned"),
                ("viewMuzzle", [0, 0, float("nan")], "finite number"),
                ("worldMuzzle", [0, 0, float("inf")], "finite number"),
                ("worldCamera", {"fov": 70, "aspect": 21 / 9, "near": 0.1, "far": 1000}, "aspect"),
                ("viewCamera", {"fov": 55, "aspect": 16 / 9, "near": 0, "far": 10}, "frustum"),
            ]:
                with self.subTest(key=key):
                    value = copy.deepcopy(fixture.value)
                    frame = next(f for f in value["frames"] if f["file"] == "16x9-fire.png")
                    frame["projection"][key] = replacement
                    fixture.write(value)
                    failure = self.assert_refused(fixture, message)
                    self.assertIn("observations", failure.evidence)

    def test_frame_order_time_and_top_level_contradictions(self):
        with packet() as fixture:
            mutations = []
            for key, value in [("version", True), ("people", "ixari"), ("fromPeople", "ixari"),
                               ("fixture", "accepted"), ("serverAuthority", True), ("errors", ["renderer error"])]:
                changed = copy.deepcopy(fixture.value)
                changed[key] = value
                mutations.append(changed)
            changed = copy.deepcopy(fixture.value)
            changed["frames"].reverse()
            mutations.append(changed)
            for key, value in [("frame", 1), ("elapsed", 0.3), ("dt", 1.0)]:
                changed = copy.deepcopy(fixture.value)
                changed["frames"][1][key] = value
                mutations.append(changed)
            for changed in mutations:
                with self.subTest(changed=changed):
                    fixture.write(changed)
                    self.assert_refused(fixture, "")

    def test_native_perf_and_capture_lod_cannot_disagree(self):
        with packet("review-thalune") as fixture:
            mutations = []
            for key, replacement in [("class", "hero"), ("file", "characters/other"), ("errors", ["bad"]), ("viewport", [640, 360])]:
                changed = copy.deepcopy(fixture.value)
                changed[key] = replacement
                mutations.append(changed)
            for replacement in (None, {"labelled": []}, {"labelled": ["Muzzle", "Grip"]}):
                changed = copy.deepcopy(fixture.value)
                changed["overlay"] = replacement
                mutations.append(changed)
            for key, replacement in [("lods", [0, 2]), ("lods", [False]), ("lod", 2), ("shown", 2), ("materials", ["Skin"])]:
                changed = copy.deepcopy(fixture.value)
                changed["stats"][key] = replacement
                mutations.append(changed)
            for key, replacement in [("range", 200), ("shown", 2), ("lod", 0)]:
                changed = copy.deepcopy(fixture.value)
                changed["far"][0][key] = replacement
                mutations.append(changed)
            for filename, key, replacement in [
                ("overlay.png", "requestedLOD", 2), ("noon-lush_lod0.png", "requestedLOD", 2),
                ("noon-lush_lod2.png", "requestedLOD", 0), ("noon-lush_lod2.png", "selectedLOD", 2),
                ("far_lod2.png", "far", 200), ("overlay.png", "far", 100),
                ("overlay.png", "file", "far_lod2.png"), ("overlay.png", "selectedLOD", False),
            ]:
                changed = copy.deepcopy(fixture.value)
                next(c for c in changed["packet"]["captures"] if c["file"] == filename)[key] = replacement
                mutations.append(changed)
            for key, replacement in [("gripOverlay", True), ("overlayMarkers", ["Muzzle", "Grip"]), ("captures", [])]:
                changed = copy.deepcopy(fixture.value)
                changed["packet"][key] = replacement
                mutations.append(changed)
            for changed in mutations:
                with self.subTest(changed=changed):
                    fixture.write(changed)
                    failure = self.assert_refused(fixture, "")
                    self.assertEqual(failure.evidence["perf"], changed)

    def test_invalid_png_container_and_actual_decode_failure(self):
        with packet() as fixture:
            target = fixture.output / "16x9-switch-gap.png"
            original = target.read_bytes()
            invalid_stream = bytearray(original[:33])
            compressed = b"this is not a deflate stream"
            invalid_stream += struct.pack(">I", len(compressed)) + b"IDAT" + compressed
            invalid_stream += struct.pack(">I", zlib.crc32(b"IDAT" + compressed))
            invalid_stream += original[-12:]
            corrupt_crc = bytearray(original)
            corrupt_crc[45] ^= 1
            for raw, message in [(b"not-png", "signature"), (original[:33], "missing PNG end"),
                                 (original[:-1], "malformed PNG"), (original + b"extra", "after PNG end"),
                                 (bytes(corrupt_crc), "CRC mismatch"), (bytes(invalid_stream), "OSError")]:
                with self.subTest(message=message):
                    target.write_bytes(raw)
                    fixture.manifest = fixture.manifest_now()
                    failure = self.assert_refused(fixture, message)
                    self.assertEqual(failure.evidence["observations"], fixture.value)

    def test_rgb_rgba_only_dimensions_and_sheet_geometry(self):
        with packet() as fixture:
            target = fixture.output / "16x9-switch-gap.png"
            for mode in ("L", "P", "RGBA"):
                with Image.new(mode, (1920, 1080)) as picture:
                    picture.save(target)
                fixture.manifest = fixture.manifest_now()
                if mode == "RGBA":
                    self.assertEqual(fixture.run()["status"], "PASS")
                else:
                    self.assert_refused(fixture, "RGB/RGBA")
            with Image.new("RGB", (1, 1)) as picture:
                picture.save(fixture.output / "sheet.png")
            fixture.manifest = fixture.manifest_now()
            self.assert_refused(fixture, "wrong PNG dimensions")

    def test_manifest_shapes_hash_substitution_and_file_inventory(self):
        with packet() as fixture:
            original = copy.deepcopy(fixture.manifest)
            for key, value in [("path", "../escape.png"), ("path", "/absolute.png"), ("path", ".hidden"),
                               ("bytes", True), ("bytes", 0), ("bytes", inspector.PNG_CAP + 1),
                               ("sha256", "0" * 64), ("sha256", "NO"), ("extra", 1)]:
                with self.subTest(key=key, value=value):
                    fixture.manifest = copy.deepcopy(original)
                    fixture.manifest[0][key] = value
                    self.assert_refused(fixture, "")
            fixture.manifest = copy.deepcopy(original)
            fixture.manifest[0] = fixture.manifest[1]
            self.assert_refused(fixture, "duplicate")
            fixture.manifest = original
            extra = fixture.output / ".ignored"
            extra.write_text("hidden extra")
            self.assert_refused(fixture, "extra/nonregular")
            extra.unlink()
            extra.mkdir()
            self.assert_refused(fixture, "extra/nonregular")
            extra.rmdir()
            (fixture.output / "sheet.png").unlink()
            self.assert_refused(fixture, "missing artifacts")

    def test_symlinks_fifo_and_directory_substitution_refused(self):
        with packet() as fixture:
            sheet = fixture.output / "sheet.png"
            saved = fixture.root / "saved.png"
            sheet.rename(saved)
            sheet.symlink_to(saved)
            self.assert_refused(fixture, "extra/nonregular")
            sheet.unlink()
            sheet.mkdir()
            self.assert_refused(fixture, "extra/nonregular")
            sheet.rmdir()
            os.mkfifo(sheet)
            self.assert_refused(fixture, "extra/nonregular")
            sheet.unlink()
            saved.rename(sheet)
            link = fixture.root / "link"
            link.symlink_to(fixture.output, target_is_directory=True)
            fixture.output = link
            self.assert_refused(fixture, "NotADirectoryError")

    def test_caps_before_read_and_cap_plus_one_growth_sentinel(self):
        with packet() as fixture:
            fixture.write(raw=b" " * (inspector.READOUT_CAP + 1))
            opened = []
            original = inspector.os.fdopen

            def track(*args, **kwargs):
                opened.append(args)
                return original(*args, **kwargs)

            with replace(inspector.os, "fdopen", track):
                self.assert_refused(fixture, "manifest byte count")
            self.assertEqual(opened, [])
            fixture.write()
            (fixture.output / fixture.readout).write_bytes(b" " * (inspector.READOUT_CAP + 1))
            with replace(inspector.os, "fdopen", track):
                self.assert_refused(fixture, "size exceeds cap")
            self.assertEqual(opened, [])
            fixture.write()
            metadata = fixture.root / "too-big.json"
            with metadata.open("wb") as stream:
                stream.truncate(inspector.METADATA_CAP + 1)
            with replace(inspector.os, "fdopen", track), self.assertRaisesRegex(inspector.InspectionError, "size exceeds cap"):
                inspector.read_metadata(metadata)
            self.assertEqual(opened, [])

            requests = []
            target = fixture.output / fixture.readout

            class GrowingStream:
                def __init__(self, stream):
                    self.stream = stream

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.stream.close()

                def fileno(self):
                    return self.stream.fileno()

                def read(self, count):
                    requests.append(count)
                    with target.open("ab") as writer:
                        writer.write(b" " * (inspector.READOUT_CAP + 10))
                    return self.stream.read(count)

            with replace(inspector.os, "fdopen", lambda *a, **k: GrowingStream(original(*a, **k))):
                self.assert_refused(fixture, "grew beyond cap")
            self.assertEqual(requests, [inspector.READOUT_CAP + 1])

    def test_sparse_png_cap_is_checked_before_image_read(self):
        with packet() as fixture:
            target = fixture.output / "16x9-switch-gap.png"
            with target.open("wb") as stream:
                stream.truncate(inspector.PNG_CAP + 1)
            reads = []
            original = inspector.bounded_read

            def record(fd, name, cap, expected=None):
                value = original(fd, name, cap, expected)
                reads.append(name)
                return value

            with replace(inspector, "bounded_read", record):
                self.assert_refused(fixture, "size exceeds cap")
            self.assertEqual(reads, [fixture.readout])

    def test_hash_and_decode_use_the_same_snapshot_after_path_replacement(self):
        with packet() as fixture:
            original = inspector.hashlib.sha256
            target = fixture.output / "16x9-switch-gap.png"
            png = target.read_bytes()
            replaced = []

            def hash_and_replace(raw):
                result = original(raw)
                if raw == png and not replaced:
                    temporary = fixture.root / "replacement"
                    temporary.write_bytes(b"not a png")
                    temporary.replace(target)
                    replaced.append(True)
                return result

            with replace(inspector.hashlib, "sha256", hash_and_replace):
                self.assertEqual(fixture.run()["status"], "PASS")
            self.assertTrue(replaced)
            self.assertEqual(target.read_bytes(), b"not a png")
            self.assert_refused(fixture, "manifest size mismatch")

    def test_every_artifact_read_is_capped_once(self):
        with packet() as fixture:
            original = inspector.os.fdopen
            requests = []

            class RecordingStream:
                def __init__(self, stream):
                    self.stream = stream

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    self.stream.close()

                def fileno(self):
                    return self.stream.fileno()

                def read(self, count):
                    requests.append(count)
                    return self.stream.read(count)

            with replace(inspector.os, "fdopen", lambda *a, **k: RecordingStream(original(*a, **k))):
                fixture.run()
            self.assertEqual(requests, [inspector.READOUT_CAP + 1] + [inspector.PNG_CAP + 1] * 3)

    def test_json_duplicate_keys_overflow_and_unknown_nonfinite_are_refused(self):
        with packet() as fixture:
            for raw, message in [(b'{"version":1,"version":1}', "duplicate JSON key"),
                                 (b"\xff", "invalid JSON"), (b"{", "invalid JSON")]:
                fixture.write(raw=raw)
                failure = self.assert_refused(fixture, message)
                self.assertIn("rawText", failure.evidence)
            for number in ("NaN", "Infinity", "-Infinity", "1e400"):
                raw = json.dumps(fixture.value, separators=(",", ":")).encode()
                fixture.write(raw=raw[:-1] + b',"unknownRaw":' + number.encode() + b"}")
                failure = self.assert_refused(fixture, "finite number")
                self.assertIn("unknownRaw", failure.evidence["observations"])

    def test_cli_success_exclusive_result_and_metadata_caps(self):
        with packet() as fixture:
            manifest = fixture.root / "manifest.json"
            manifest.write_text(json.dumps({"files": fixture.manifest}))
            result = fixture.root / "result.json"
            args = ["--inventory", str(HERE / "inventory.json"), "--unit", fixture.spec["id"],
                    "--output", str(fixture.output), "--manifest", str(manifest)]
            output, errors = io.StringIO(), io.StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                self.assertEqual(inspector.main(args), 0)
                self.assertEqual(inspector.main(args + ["--result", str(result)]), 0)
            self.assertEqual(json.loads(output.getvalue())["status"], "PASS")
            self.assertIs(json.loads(output.getvalue())["valid"], True)
            saved = result.read_bytes()
            self.assertLessEqual(len(saved), inspector.RESULT_CAP)
            with redirect_stderr(errors):
                self.assertEqual(inspector.main(args + ["--result", str(result)]), 1)
            self.assertEqual(result.read_bytes(), saved)
            self.assertIn("FileExistsError", errors.getvalue())
            manifest.write_bytes(b" " * (inspector.METADATA_CAP + 1))
            with redirect_stderr(errors):
                self.assertEqual(inspector.main(args), 1)
            self.assertIn("size exceeds cap", errors.getvalue())

    def test_cli_real_process_success_and_primary_failure(self):
        with packet() as fixture:
            manifest = fixture.root / "manifest.json"
            manifest.write_text(json.dumps({"files": fixture.manifest}))
            args = [sys.executable, "-B", str(HERE / "inspect_packet.py"), "--inventory", str(HERE / "inventory.json"),
                    "--unit", fixture.spec["id"], "--output", str(fixture.output), "--manifest", str(manifest)]
            result = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["status"], "PASS")
            self.assertIs(json.loads(result.stdout)["valid"], True)
            fixture.value["frames"][0]["loaderPending"] = False
            fixture.value["unknownRaw"] = "producer-fact"
            fixture.write()
            manifest.write_text(json.dumps({"files": fixture.manifest}))
            result = subprocess.run(args, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 1)
            failure = json.loads(result.stderr)
            self.assertIn("loader/attachment", failure["primaryFailure"])
            self.assertEqual(failure["evidence"]["observations"]["unknownRaw"], "producer-fact")
            self.assertEqual(result.stdout, "")

    def test_cli_result_cap_keeps_all_raw_evidence_and_creates_no_result(self):
        with packet() as fixture:
            raw = json.dumps(fixture.value, separators=(",", ":")).encode()
            fixture.value["unknownRaw"] = "x" * (inspector.READOUT_CAP - len(raw) - len(',"unknownRaw":""'))
            fixture.write()
            self.assertEqual((fixture.output / fixture.readout).stat().st_size, inspector.READOUT_CAP)
            self.assertIs(fixture.run()["valid"], True)
            manifest = fixture.root / "manifest.json"
            manifest.write_text(json.dumps({"files": fixture.manifest}))
            result = fixture.root / "result.json"
            args = ["--inventory", str(HERE / "inventory.json"), "--unit", fixture.spec["id"],
                    "--output", str(fixture.output), "--manifest", str(manifest), "--result", str(result)]
            errors = io.StringIO()
            with redirect_stderr(errors):
                self.assertEqual(inspector.main(args), 1)
            failure = json.loads(errors.getvalue())
            self.assertIn("result: exceeds", failure["primaryFailure"])
            self.assertEqual(failure["evidence"]["inspection"]["observations"], fixture.value)
            self.assertFalse(result.exists())
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(inspector.main(args[:-2]), 0)
            self.assertEqual(json.loads(output.getvalue())["observations"], fixture.value)


if __name__ == "__main__":
    unittest.main()
