"""Focused boundary tests for ownership, identity and bounded job cleanup."""

import importlib.util
import subprocess
import sys
import time
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("ulgani_run", HERE / "run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ProcessCleanup(unittest.TestCase):
    def test_owned_group_drains_descendant(self):
        # Both parent and descendant ignore TERM; the runner must KILL and reap its own group.
        code = 'import signal,time,subprocess,sys;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);time.sleep(60)'
        proc = subprocess.Popen([sys.executable, "-c", code], start_new_session=True)
        try:
            time.sleep(0.25)
            members = runner.group_members(proc.pid)
            self.assertGreaterEqual(len(members), 2)
            self.assertEqual(runner.stop_group(proc), [])
            self.assertIsNotNone(proc.returncode)
        finally:
            if proc.poll() is None:
                runner.stop_group(proc)

    def test_thread_environment_and_root(self):
        self.assertEqual(runner.ROOT, Path.cwd())
        self.assertEqual(runner.LIMITS["ART_KTX_JOBS"], "1")
        for name, value in runner.LIMITS.items():
            if name.endswith("NUM_THREADS") or name in (
                "VECLIB_MAXIMUM_THREADS",
                "UV_THREADPOOL_SIZE",
            ):
                self.assertEqual(value, "2")

    def test_export_is_stock_and_cannot_import_author(self):
        wrapper = (runner.ROOT / "packages/tools/blender/export_cities.py").read_text()
        self.assertIn("from artlib.export import main", wrapper)
        self.assertNotIn("ulgani", wrapper)


if __name__ == "__main__":
    unittest.main()
