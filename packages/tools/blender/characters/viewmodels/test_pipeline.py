"""CPU-only regression cases: real process/lock boundaries and scratch file ownership."""
from pathlib import Path
import fcntl
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import evidence


def wait_for(check, timeout=6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(.01)
    raise AssertionError('Timed out waiting for process barrier')


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


class RunnerTests(unittest.TestCase):
    def exercise(self, cause, behavior='barrier'):
        with tempfile.TemporaryDirectory(prefix='t03-runner-') as directory:
            root = Path(directory)
            scripts = root / 'packages/tools/blender/characters/viewmodels'
            scripts.mkdir(parents=True)
            runner = scripts / 'run_cpu.py'
            shutil.copy2(HERE / 'run_cpu.py', runner)
            fake = root / 'Blender'
            fake.write_text('''#!/usr/bin/env python3
from pathlib import Path
import os,signal,subprocess,sys,time
root=Path(__file__).parent
(root/'child.pid').write_text(str(os.getpid()))
behavior=sys.argv[-1]
if behavior=='exit':sys.exit(7)
if behavior=='orphan':
 child=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'])
 (root/'grandchild.pid').write_text(str(child.pid));sys.exit(0)
def stop(sig,frame):
 (root/'term').touch()
 if behavior=='ignore':return
 deadline=time.monotonic()+1.5
 while not (root/'release').exists() and time.monotonic()<deadline:time.sleep(.01)
 sys.exit(0)
signal.signal(signal.SIGTERM,stop)
(root/'ready').touch()
while True:time.sleep(.05)
''')
            fake.chmod(0o755)
            command = [sys.executable, str(runner), str(root / 'child.log'), '1' if cause == 'timeout' else '10', str(fake), '-t', '2', behavior]
            witness = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], start_new_session=True)
            child = None
            with (root / 'runner.log').open('w') as log:
                process = subprocess.Popen(command, stdout=log, stderr=log)
                try:
                    wait_for(lambda: (root / 'child.pid').exists())
                    child = int((root / 'child.pid').read_text())
                    if behavior not in ('exit', 'orphan'):
                        wait_for(lambda: (root / 'ready').exists())
                        if cause != 'timeout':
                            process.send_signal(cause)
                        wait_for(lambda: (root / 'term').exists())
                        self.assertTrue(alive(child))
                        lock_path = root / '.claude/pause/P1-E05-T03/blender.lock'
                        with lock_path.open('a') as lock:
                            with self.assertRaises(BlockingIOError):
                                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        replacement = subprocess.run(command[:-1] + ['exit'], capture_output=True, timeout=1)
                        self.assertNotEqual(replacement.returncode, 0, 'replacement entered an occupied lane')
                        (root / 'release').touch()
                    code = process.wait(timeout=6)
                    expected = 124 if cause == 'timeout' else 128 + cause if cause else 7 if behavior == 'exit' else 0
                    self.assertEqual(code, expected, (root / 'runner.log').read_text())
                    self.assertFalse(alive(child), 'direct child was not reaped')
                    if (root / 'grandchild.pid').exists():
                        self.assertFalse(alive(int((root / 'grandchild.pid').read_text())))
                    self.assertIsNone(witness.poll(), 'an unowned process was affected')
                    self.assertFalse((root / '.claude/pause/P1-E05-T03/blender.unclean').exists())
                    with (root / '.claude/pause/P1-E05-T03/blender.lock').open('a') as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    if child and alive(child):
                        os.killpg(child, signal.SIGKILL)
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=2)
                    witness.terminate()
                    witness.wait(timeout=2)

    def test_sigint_holds_lock_until_owned_group_is_reaped(self): self.exercise(signal.SIGINT)
    def test_sigterm_holds_lock_until_owned_group_is_reaped(self): self.exercise(signal.SIGTERM)
    def test_deadline_holds_lock_until_owned_group_is_reaped(self): self.exercise('timeout')
    def test_term_resistance_escalates_to_kill(self): self.exercise(signal.SIGINT, 'ignore')
    def test_natural_exit_releases_lane_and_preserves_exit_code(self): self.exercise(0, 'exit')
    def test_natural_exit_also_cleans_owned_descendant(self): self.exercise(0, 'orphan')


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t03-artifacts-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = evidence.paths(self.root, 'thalune')
        for key, path in self.files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((key + ' prior bytes').encode())
        self.reports = self.root / 'assets/renders/characters/viewmodels/validation'
        self.reports.mkdir(parents=True)
        self.write_reports()
        self.peer = evidence.paths(self.root, 'ixari')['export']
        self.peer.write_bytes(b'unrelated peer export')
        self.before = {key: evidence.fingerprint(path, self.root) for key, path in self.files.items()}

    def write_reports(self):
        for name in evidence.report_names('thalune'):
            value = {'status': 'PASS', 'summary': {'fail': 0}, 'people': 'thalune', 'source_sha256': evidence.sha(self.files['source'])}
            evidence.write_json(self.reports / name, value)

    def publish(self):
        return evidence.publish_receipt(self.root, 'thalune', self.reports, self.before, 'test')

    def test_receipt_accepts_only_the_validated_pair(self):
        self.publish()
        self.assertEqual(evidence.verify_receipt(self.root, 'thalune')['files'], self.before)
        self.files['export'].write_bytes(b'not a GLB')
        with self.assertRaisesRegex(ValueError, 'validated pair'):
            evidence.verify_receipt(self.root, 'thalune')

    def test_source_substitution_is_rejected(self):
        self.publish()
        self.files['source'].write_bytes(b'changed source')
        with self.assertRaisesRegex(ValueError, 'validated pair'):
            evidence.verify_receipt(self.root, 'thalune')

    def test_pass_report_substitution_is_rejected(self):
        self.publish()
        evidence.write_json(self.reports / 'characters__fp_thalune.glb.json', {'status': 'PASS', 'summary': {'fail': 0}, 'different': True})
        with self.assertRaisesRegex(ValueError, 'reports differ'):
            evidence.verify_receipt(self.root, 'thalune')

    def test_substitution_during_validation_cannot_publish_receipt(self):
        self.files['export'].write_bytes(b'substituted between check and publication')
        with self.assertRaisesRegex(ValueError, 'changed during validation'):
            self.publish()
        self.assertFalse((self.reports / 'thalune-receipt.json').exists())

    def test_failed_new_destination_does_not_overwrite_prior_export_history(self):
        self.publish()
        reports, history = evidence.begin_attempt(self.root, 'thalune', 'export')
        self.files['export'].write_bytes(b'new export failed post-export validation')
        evidence.fail_attempt(self.root, 'thalune', reports, history, ValueError('post-export check'), True)
        self.assertEqual((history / 'fp_thalune.glb').read_bytes(), b'export prior bytes')
        self.assertEqual((history / 'failed-fp_thalune.glb').read_bytes(), b'new export failed post-export validation')
        self.assertFalse(self.files['export'].exists())
        self.assertEqual(self.peer.read_bytes(), b'unrelated peer export')

    def wrapper_failure(self, boundary):
        self.publish()
        old_receipt = (self.reports / 'thalune-receipt.json').read_bytes()
        bpy = types.ModuleType('bpy')
        bpy.context = types.SimpleNamespace(scene=types.SimpleNamespace(render=types.SimpleNamespace()))
        def reject(*args, **kwargs): raise RuntimeError(f'injected {boundary} failure')
        artlib = types.ModuleType('artlib')
        artlib.bake = types.SimpleNamespace()
        artlib.lods = types.SimpleNamespace()
        artlib.rules = types.SimpleNamespace(load=lambda: {})
        artlib.core = types.SimpleNamespace(load=reject if boundary == 'unreadable' else lambda *args: None)
        artlib.export = types.SimpleNamespace(parse=lambda args: None, export_one=reject)
        checks = types.ModuleType('viewmodel_checks')
        checks.validate_loaded = reject if boundary == 'validation' else lambda *args: None
        export_checks = types.ModuleType('export_checks')
        export_checks.validate_export = lambda *args: None
        with patch.dict(sys.modules, {'bpy': bpy, 'artlib': artlib, 'viewmodel_checks': checks, 'export_checks': export_checks}):
            spec = importlib.util.spec_from_file_location('t03_export_fixture', HERE / 'export.py')
            wrapper = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(wrapper)
            wrapper.ROOT = self.root
            with patch.object(sys, 'argv', ['export.py', '--', 'thalune']):
                self.assertEqual(wrapper.main(), 1)
        current = json.loads((self.reports / 'thalune-receipt.json').read_text())
        self.assertEqual(current['status'], 'FAIL')
        history = self.root / current['history']
        self.assertEqual((history / 'thalune-receipt.json').read_bytes(), old_receipt)
        self.assertEqual(self.peer.read_bytes(), b'unrelated peer export')
        self.assertEqual(self.files['source'].read_bytes(), b'source prior bytes')
        if boundary == 'unreadable':
            self.assertEqual(self.files['export'].read_bytes(), b'export prior bytes')
        else:
            self.assertFalse(self.files['export'].exists())
            self.assertEqual((history / 'fp_thalune.glb').read_bytes(), b'export prior bytes')
        with self.assertRaisesRegex(ValueError, 'no successful'):
            evidence.verify_receipt(self.root, 'thalune')

    def test_validator_exception_invalidates_only_owned_export(self): self.wrapper_failure('validation')
    def test_codec_exception_invalidates_only_owned_export(self): self.wrapper_failure('codec')
    def test_unreadable_source_retains_export_without_current_pass(self): self.wrapper_failure('unreadable')


if __name__ == '__main__':
    unittest.main(verbosity=2)
