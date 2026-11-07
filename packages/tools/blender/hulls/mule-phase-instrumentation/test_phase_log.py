"""Fake bake calls for the Mule phase log. No Blender."""

import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from phase_log import PhaseError, PhaseLog, install, load, variant_from_label

IDENTITY = {
    "material": "Mule_Accent.001",
    "variant": "mule",
    "channel": "baseColor",
    "resolution": 4096,
    "object_count": 3,
    "triangle_count": 1200,
}
RESOURCES = {"group_rss_kib": 12, "wall_limit_s": 5400, "rss_limit_kib": 8388608}


class Clock:
    def __init__(self):
        self.value = 10.0

    def __call__(self):
        current = self.value
        self.value += 1.0
        return current


class PhaseLogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = Path(self.tmp) / "bake-phases.jsonl"
        self.clock = Clock()
        self.log = PhaseLog(self.path, clock=self.clock)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_success_records_start_then_success_and_returns_the_bake(self):
        seen = []

        def bake():
            phases = PhaseLog(self.path, clock=self.clock).phases()
            self.assertEqual(phases[0]["status"], "unfinished")
            self.assertNotIn("success", self.path.read_text())
            seen.append("bake")
            return {"baseColor": "image"}

        result = self.log.invoke(dict(IDENTITY), dict(RESOURCES), bake)
        self.assertEqual(result, {"baseColor": "image"})
        self.assertEqual(seen, ["bake"])
        phase = self.log.phases()[0]
        self.assertEqual(phase["status"], "success")
        self.assertEqual(phase["material"], "Mule_Accent.001")
        self.assertEqual(phase["variant"], "mule")
        self.assertEqual(phase["channel"], "baseColor")
        self.assertEqual(phase["resolution"], 4096)
        self.assertEqual(phase["object_count"], 3)
        self.assertEqual(phase["triangle_count"], 1200)
        self.assertEqual(phase["resources"], RESOURCES)
        self.assertEqual(phase["started_monotonic_s"], 10.0)
        self.assertEqual(phase["ended_monotonic_s"], 11.0)
        self.assertIsNone(phase["error"])
        events = [line.split('"event":"', 1)[1].split('"', 1)[0] for line in self.path.read_text().splitlines()]
        self.assertEqual(events, ["start", "success"])

    def test_exception_is_recorded_and_reraised(self):
        with self.assertRaises(RuntimeError) as caught:
            self.log.invoke(dict(IDENTITY), dict(RESOURCES), lambda: (_ for _ in ()).throw(RuntimeError("bake failed")))
        self.assertEqual(str(caught.exception), "bake failed")
        phase = self.log.phases()[0]
        self.assertEqual(phase["status"], "error")
        self.assertIn("bake failed", phase["error"])
        self.assertNotIn('"event":"success"', self.path.read_text())

    def test_keyboard_interrupt_is_not_stored_as_error(self):
        with self.assertRaises(KeyboardInterrupt):
            self.log.invoke(dict(IDENTITY), dict(RESOURCES), lambda: (_ for _ in ()).throw(KeyboardInterrupt("stopped")))
        phase = self.log.phases()[0]
        self.assertEqual(phase["status"], "interrupt")
        self.assertIn("KeyboardInterrupt", phase["error"])
        self.assertNotIn('"event":"error"', self.path.read_text())
        self.assertNotIn('"event":"success"', self.path.read_text())

    def test_system_exit_is_an_interrupt(self):
        with self.assertRaises(SystemExit):
            self.log.invoke(dict(IDENTITY), dict(RESOURCES), lambda: (_ for _ in ()).throw(SystemExit(1)))
        self.assertEqual(self.log.phases()[0]["status"], "interrupt")

    def test_log_failure_after_bake_error_does_not_replace_the_bake_exception(self):
        def bake():
            os.chmod(self.path, 0o444)
            raise RuntimeError("bake failed")

        try:
            with self.assertRaises(RuntimeError) as caught:
                self.log.invoke(dict(IDENTITY), dict(RESOURCES), bake)
            self.assertEqual(str(caught.exception), "bake failed")
            phase = load(self.path)[0][0]
            self.assertEqual(phase["status"], "unfinished")
            self.assertNotIn(b"success", self.path.read_bytes())
        finally:
            os.chmod(self.path, 0o644)

    def test_log_failure_after_successful_bake_does_not_record_success(self):
        def bake():
            os.chmod(self.path, 0o444)
            return "image"

        try:
            with self.assertRaises(OSError):
                self.log.invoke(dict(IDENTITY), dict(RESOURCES), bake)
            phase = load(self.path)[0][0]
            self.assertEqual(phase["status"], "unfinished")
            self.assertNotIn(b'"event":"success"', self.path.read_bytes())
        finally:
            os.chmod(self.path, 0o644)

    def test_unfinished_start_stays_after_the_writer_is_killed(self):
        script = (
            "import os, sys\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "from phase_log import PhaseLog\n"
            "log = PhaseLog(sys.argv[2])\n"
            "log.invoke(%r, %r, lambda: os.kill(os.getpid(), %d))\n"
        ) % (IDENTITY, RESOURCES, signal.SIGKILL)
        child = subprocess.run(
            [sys.executable, "-c", script, str(Path(__file__).resolve().parent), str(self.path)],
            check=False,
        )
        self.assertNotEqual(child.returncode, 0)
        phases, truncated = load(self.path)
        self.assertIsNone(truncated)
        self.assertEqual(len(phases), 1)
        self.assertEqual(phases[0]["status"], "unfinished")
        self.assertEqual(phases[0]["channel"], "baseColor")
        self.assertEqual(phases[0]["resources"], RESOURCES)
        self.assertNotIn(b"success", self.path.read_bytes())

    def test_truncated_tail_is_not_a_success(self):
        self.log.start(dict(IDENTITY), dict(RESOURCES))
        with self.path.open("ab") as handle:
            handle.write(b'{"event":"succ')
        phases, truncated = load(self.path)
        self.assertEqual(phases[0]["status"], "unfinished")
        self.assertTrue(truncated.startswith(b'{"event":"succ'))

    def test_bad_identity_does_not_call_the_bake_or_write(self):
        called = []
        bad = dict(IDENTITY)
        bad["triangle_count"] = -1
        with self.assertRaises(PhaseError):
            self.log.invoke(bad, dict(RESOURCES), lambda: called.append("bake"))
        self.assertEqual(called, [])
        self.assertFalse(self.path.exists())

    def test_default_clock_is_monotonic(self):
        log = PhaseLog(Path(self.tmp) / "wall.jsonl")
        before = time.monotonic()
        log.invoke(dict(IDENTITY), dict(RESOURCES), lambda: None)
        after = time.monotonic()
        phase = log.phases()[0]
        self.assertGreaterEqual(phase["started_monotonic_s"], before)
        self.assertGreaterEqual(phase["ended_monotonic_s"], phase["started_monotonic_s"])
        self.assertLessEqual(phase["ended_monotonic_s"], after)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = Path(self.tmp) / "bake-phases.jsonl"
        self.clock = Clock()
        self.log = PhaseLog(self.path, clock=self.clock)
        self.calls = []
        self.order = []

        class Mat:
            name = "Mule_Accent.001"

        class Info:
            mat = Mat()

        self.info = Info()
        self.module = type("BakeModule", (), {})()

        def bake_material(mat, objects, res, ao=False, label=None, occluders=None, log=print):
            self.order.append(("admit", mat.name, label, ao, list(objects)))
            return self.module._bake_channels(self.info, "nt", "out", "surface", ["baseColor", "roughness"], res, label)

        def bake_channels(info, nt, out, surface, todo, res, label):
            self.calls.append(list(todo))
            self.order.append(("channel", list(todo)))
            if "roughness" in todo and len(todo) == 1 and self.fail == "error":
                raise RuntimeError("roughness bake failed")
            if "roughness" in todo and len(todo) == 1 and self.fail == "interrupt":
                raise KeyboardInterrupt()
            return {channel: "img-" + channel for channel in todo}

        self.fail = None
        self.module.bake_material = bake_material
        self.module._bake_channels = bake_channels
        self.original_material = bake_material
        self.original_channels = bake_channels
        self.resources_n = 0

        def resources_of():
            self.resources_n += 1
            self.order.append(("resources", self.resources_n))
            return {"snap": self.resources_n, "wall_limit_s": 5400}

        def counts_of(objects):
            self.order.append(("counts", list(objects)))
            return (len(objects), 40)

        self.uninstall = install(
            self.module,
            self.log,
            resources_of=resources_of,
            counts_of=counts_of,
            variant_ids=("mule", "mule_damaged", "mule_husked"),
        )

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_each_channel_is_a_separate_successful_call(self):
        result = self.module.bake_material(
            type("Mat", (), {"name": "Mule_Accent.001"})(),
            ["body", "trim"],
            4096,
            ao=True,
            label="mule_Accent",
        )
        self.assertEqual(result, {"baseColor": "img-baseColor", "roughness": "img-roughness"})
        self.assertEqual(self.calls, [["baseColor"], ["roughness"]])
        self.assertEqual([item[0] for item in self.order], ["counts", "admit", "resources", "channel", "resources", "channel"])
        phases = self.log.phases()
        self.assertEqual([phase["status"] for phase in phases], ["success", "success"])
        self.assertEqual([phase["channel"] for phase in phases], ["baseColor", "roughness"])
        self.assertEqual(phases[0]["variant"], "mule")
        self.assertEqual(phases[0]["material"], "Mule_Accent.001")
        self.assertEqual(phases[0]["resolution"], 4096)
        self.assertEqual(phases[0]["object_count"], 2)
        self.assertEqual(phases[0]["triangle_count"], 40)
        self.assertEqual(phases[0]["resources"], {"snap": 1, "wall_limit_s": 5400})
        self.assertEqual(phases[1]["resources"], {"snap": 2, "wall_limit_s": 5400})

    def test_channel_exception_keeps_the_earlier_success_and_stops(self):
        self.fail = "error"
        with self.assertRaises(RuntimeError):
            self.module.bake_material(
                type("Mat", (), {"name": "Mule_Accent.001"})(),
                ["body"],
                2048,
                label="mule_damaged_Accent",
            )
        self.assertEqual(self.calls, [["baseColor"], ["roughness"]])
        phases = self.log.phases()
        self.assertEqual([phase["status"] for phase in phases], ["success", "error"])
        self.assertEqual(phases[1]["variant"], "mule_damaged")
        self.assertIn("roughness bake failed", phases[1]["error"])

    def test_channel_interrupt_stops_without_a_success_record(self):
        self.fail = "interrupt"
        with self.assertRaises(KeyboardInterrupt):
            self.module.bake_material(
                type("Mat", (), {"name": "Mule_Accent.001"})(),
                ["body"],
                2048,
                label="mule_husked_Accent",
            )
        phases = self.log.phases()
        self.assertEqual([phase["status"] for phase in phases], ["success", "interrupt"])
        self.assertEqual(phases[1]["variant"], "mule_husked")

    def test_direct_channel_call_without_a_frame_does_not_bake(self):
        with self.assertRaises(PhaseError):
            self.module._bake_channels(self.info, None, None, None, ["baseColor"], 4096, "mule_Accent")
        self.assertEqual(self.calls, [])
        self.assertFalse(self.path.exists())

    def test_unknown_variant_does_not_bake(self):
        with self.assertRaises(PhaseError):
            self.module.bake_material(
                type("Mat", (), {"name": "Mule_Accent.001"})(),
                ["body"],
                4096,
                label="other_Accent",
            )
        self.assertEqual(self.calls, [])
        self.assertFalse(self.path.exists())

    def test_variant_match_prefers_the_longest_id(self):
        self.assertEqual(variant_from_label("mule_damaged_Hull", ("mule", "mule_damaged", "mule_husked")), "mule_damaged")
        self.assertEqual(variant_from_label("mule_Hull", ("mule", "mule_damaged")), "mule")

    def test_uninstall_restores_the_original_functions(self):
        self.uninstall()
        self.assertIs(self.module.bake_material, self.original_material)
        self.assertIs(self.module._bake_channels, self.original_channels)


if __name__ == "__main__":
    unittest.main()
