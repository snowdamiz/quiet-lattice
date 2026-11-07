"""Real owned CPU writers test live-anchor continuity through adapter/wait/caller ports."""
import contextlib
import errno
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bindings
import caller
import controls
import evidence
import live_cache
import native_ports
from boundary_controls import inert_clear
from contract import Refused
from revision_controls import extract

OBSERVATIONS = []
WRITER = '''import json,sys,shutil
from pathlib import Path
for line in sys.stdin:
 r=json.loads(line);p=Path(r['root']);a=r['action'];old=p.with_name('old-'+p.name)
 if a=='ancestor':
  parent=p.parent;retained=parent.with_name('old-route');parent.rename(retained);parent.mkdir()
  (retained/p.name).rename(p)
 elif a in ('replace','death'):
  p.rename(old)
  if a=='replace':p.mkdir()
 target=old if a in ('replace','death') else p
 if (target/'volatile').exists():shutil.rmtree(target/'volatile')
 print(json.dumps({'request':r,'rootExists':p.exists(),'rootInode':p.stat().st_ino if p.exists() else None}),flush=True)
'''


class AnchorControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='effects-anchor-', dir='/private/tmp')
        self.root = Path(self.temp.name)
        self.route = self.root / 'route'
        self.route.mkdir()
        for name in ('tmp', 'scratch', 'out', 'cache'):
            (self.route / name).mkdir()
        self.port = native_ports.NativePorts.__new__(native_ports.NativePorts)
        self.port.tmp = self.route / 'tmp'
        self.port.result = {'raw': {}}
        self.port.ready = {'generatedCaches': [str(self.route / 'cache')], 'initialCacheBytes': 0,
                           'pilot': {'output': str(self.route / 'out')}}
        self.job = SimpleNamespace(scratch=self.route / 'scratch', out=self.route / 'out',
                                   state={'exits': {}, 'errors': []})

    def tearDown(self):
        OBSERVATIONS.append({'case': self._testMethodName, 'raw': self.port.result['raw']})
        self.temp.cleanup()

    @contextlib.contextmanager
    def publisher(self, anchor, action):
        volatile = anchor / 'volatile'
        volatile.mkdir()
        (volatile / 'data').write_bytes(b'known-owned-original')
        child = subprocess.Popen([sys.executable, '-B', '-c', WRITER], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        receipts = []
        actual = os.stat
        def command():
            child.stdin.write(json.dumps({'root': str(anchor), 'action': action}) + '\n')
            child.stdin.flush()
            receipts.append(json.loads(child.stdout.readline()))
        def raced(path, *args, **kwargs):
            if str(path) == 'volatile' and not receipts:
                command()
            return actual(path, *args, **kwargs)
        try:
            with native_ports.phase(5), patch.object(os, 'stat', raced):
                yield receipts, command
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
                raise
            stderr = child.stderr.read()
            OBSERVATIONS.append({'writerPid': child.pid, 'exit': child.returncode, 'stderr': stderr,
                                 'receipts': receipts})
            self.assertEqual(child.returncode, 0)
            self.assertEqual(stderr, '')

    def wait(self, observer):
        ns = extract('round4_job_boundary.py', ['StationJob', 'deadline', 'DeadlineExpired'],
                     {'signal': signal, 'time': time, 'contextmanager': contextlib.contextmanager})
        self.job.status = lambda: {'exits': self.job.state['exits']}
        self.job.members = lambda: self.job.state['exits'].update(capture=0)
        self.job.save = lambda: None
        return ns['StationJob'].wait(self.job, 2, observer=observer)

    def refusal(self):
        sample = self.port.result['raw']['lastWriterObservation']
        self.assertFalse(sample['complete'])
        self.assertFalse(sample['resourceReleaseProved'])
        probe = self.port.result['raw']['writerPublicationObservations'][-1]
        self.assertIsNone(probe['bytes'])
        self.assertEqual(len(probe['attempts']), 1)
        attempt = probe['attempts'][0]
        self.assertEqual(attempt['failure']['type'], 'FileNotFoundError')
        self.assertIn('failure', attempt['anchorVerification'])
        self.assertTrue(probe['anchorRoute'])
        return probe

    def test_real_replacement_refuses_each_required_and_optional_existing_root(self):
        for name in ('tmp', 'scratch', 'out', 'cache'):
            with self.subTest(root=name), self.publisher(self.route / name, 'replace'):
                with self.assertRaisesRegex(Refused, 'ancestor identity changed'):
                    self.port.budgets(self.job)
                self.refusal()

    def test_real_ancestor_replacement_with_same_root_inode_aborts_actual_wait(self):
        before = self.port.tmp.stat().st_ino
        with self.publisher(self.port.tmp, 'ancestor'):
            outcome = self.wait(lambda: self.port.budgets(self.job))
        self.assertEqual(self.port.tmp.stat().st_ino, before)
        self.assertEqual(outcome, 'observer_failed')
        self.assertEqual(self.job.state['exits'], {})
        self.assertIn('ancestor identity changed', self.job.state['errors'][0])
        self.refusal()

    def test_required_root_death_is_terminal_before_another_sample(self):
        with self.publisher(self.port.tmp, 'death'):
            outcome = self.wait(lambda: self.port.budgets(self.job))
        self.assertEqual(outcome, 'observer_failed')
        self.assertFalse(self.port.tmp.exists())
        self.assertEqual(self.refusal()['attempts'][0]['anchorVerification']['failure']['type'], 'FileNotFoundError')

    def test_replacement_during_retry_yield_is_not_new_admission(self):
        with self.publisher(self.port.tmp, 'child') as (receipts, command):
            def replace(_):
                anchor = self.port.tmp
                anchor.rename(anchor.with_name('old-tmp'))
                anchor.mkdir()
            with patch.object(live_cache.time, 'sleep', replace), self.assertRaisesRegex(Refused, 'ancestor identity changed'):
                self.port.budgets(self.job)
        probe = self.port.result['raw']['writerPublicationObservations'][-1]
        self.assertEqual(len(probe['attempts']), 2)
        self.assertTrue(probe['attempts'][0]['anchorVerification']['complete'])
        self.assertFalse(probe['complete'])
        self.assertNotEqual(probe['anchorRoute'][-1]['st_ino'], self.port.tmp.stat().st_ino)

    def test_live_metadata_changes_and_child_deletion_keep_same_anchor(self):
        before = self.port.tmp.stat()
        with self.publisher(self.port.tmp, 'child'):
            self.assertEqual(self.wait(lambda: self.port.budgets(self.job)), 'completed')
        probe = self.port.result['raw']['lastWriterObservation']['probes'][0]
        self.assertTrue(probe['complete'])
        self.assertEqual(probe['anchorRoute'][-1]['st_ino'], before.st_ino)
        self.assertNotEqual(self.port.tmp.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertNotIn('st_mtime_ns', probe['anchorRoute'][-1])
        self.assertNotIn('st_size', probe['anchorRoute'][-1])
        self.assertEqual(len(probe['attempts']), 2)

    def test_optional_initial_absence_keeps_original_parent_route(self):
        missing = self.route / 'missing'
        self.port.ready['generatedCaches'] = [str(missing)]
        actual = os.open
        fired = []
        def replace_parent(path, *args, **kwargs):
            try:
                return actual(path, *args, **kwargs)
            except FileNotFoundError:
                if str(path) == 'missing' and not fired:
                    fired.append(True)
                    self.route.rename(self.root / 'old-route')
                    self.route.mkdir()
                raise
        with patch.object(os, 'open', replace_parent), self.assertRaisesRegex(Refused, 'ancestor identity changed'):
            self.port.budgets(self.job)
        probe = self.port.result['raw']['writerPublicationObservations'][-1]
        self.assertTrue(probe['absentParentRoute'])
        self.assertFalse(probe['complete'])
        self.assertIsNone(probe['anchorRoute'])
        self.assertIn('failure', probe['attempts'][0]['absenceVerification'])

    def test_verification_io_and_real_deadline_keep_original_partial_failure(self):
        for alarm in (False, True):
            with self.subTest(alarm=alarm):
                actual = os.open
                opens = []
                parent_inode = self.route.stat().st_ino
                def interrupted(path, *args, **kwargs):
                    if str(path) == 'tmp' and kwargs.get('dir_fd') is not None and os.fstat(kwargs['dir_fd']).st_ino == parent_inode:
                        opens.append(path)
                        if len(opens) == 2:
                            if alarm:
                                signal.raise_signal(signal.SIGALRM)
                            error = PermissionError(errno.EACCES, 'ANCHOR_UNCERTAIN', 'tmp')
                            error.unknown = {'owner': None, 'partial': b'\xff'}
                            raise error
                    return actual(path, *args, **kwargs)
                with self.assertRaises(native_ports.PhaseExpired if alarm else PermissionError):
                    with self.publisher(self.port.tmp, 'child'), patch.object(os, 'open', interrupted):
                        self.port.budgets(self.job)
                probe = self.refusal()
                kind = probe['attempts'][0]['anchorVerification']['failure']['type']
                self.assertEqual(kind, 'PhaseExpired' if alarm else 'PermissionError')
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))

    def test_actual_caller_keeps_anchor_error_before_cleanup_and_all_sink_failures(self):
        root = self.root / 'caller'
        root.mkdir()
        fixture = controls.Fixture(root)
        original = fixture.ports
        def factory(ready, result):
            port = original(ready, result)
            self.port.result = result
            port.budgets = lambda job: self.port.budgets(self.job)
            port.wait = lambda job, observer: self.wait(observer)
            def cleanup(*_):
                raise Refused('UNKNOWN_COHORT_RELEASE')
            port.cleanup = cleanup
            return port
        def broken(*_):
            raise OSError(28, 'SECONDARY_PUBLICATION')
        def sink(path, data):
            if Path(path).name in ('terminal.json', 'result.json', 'failed-result.json'):
                broken()
            evidence.Receipts.exclusive(path, data)
        try:
            with self.publisher(self.port.tmp, 'replace'), patch.object(bindings, 'ROOT', root):
                result = caller.execute(fixture.ready_path, enabled=True,
                    authorization=fixture.ready['pilot']['authorizationId'], verify_source=lambda _: fixture.source,
                    ports_factory=factory, cache_guard=inert_clear, sink=evidence.Receipts(sink), stderr=broken)
            self.assertFalse(result['accepted'])
            self.assertFalse(result['durable'])
            self.assertIsNone(result['release'])
            self.assertNotIn('inspection', result)
            self.assertEqual(result['errors'][0]['phase'], 'capture-observer')
            self.assertEqual(result['errors'][0]['message'], 'Cache ancestor identity changed')
            self.assertEqual(result['errors'][-1]['phase'], 'stderr-fallback-write')
            self.assertEqual(fixture.calls.count('launch'), 1)
            self.refusal()
            OBSERVATIONS.append({'callerResult': result})
        finally:
            fixture.cleanup()


if __name__ == '__main__':
    unittest.main()
