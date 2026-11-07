"""CPU-only directory publishers through actual live measurement and caller/helper wait ports."""
import sys
sys.dont_write_bytecode = True
import contextlib
import errno
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
from types import MethodType, SimpleNamespace
import unittest
from unittest.mock import patch

import bindings
import cache_io
import caller
import contract
import controls
import evidence
import live_cache
import native_ports
from boundary_controls import inert_clear
from revision_controls import extract


class LiveCacheControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='effects-live-cache-', dir='/private/tmp')
        self.root = Path(self.temp.name)
        for name in ('cache', 'tmp', 'scratch', 'out'):
            (self.root / name).mkdir()
        self.cache = self.root / 'cache'
        self.pending = self.cache / 'deps_temp_a4ff6522'
        self.pending.mkdir()
        (self.pending / 'bundle.js').write_bytes(b'x' * 137)
        self.port = native_ports.NativePorts.__new__(native_ports.NativePorts)
        self.port.tmp = self.root / 'tmp'
        self.port.result = {'raw': {}}
        self.port.ready = {'generatedCaches': [str(self.cache)], 'initialCacheBytes': 137,
                           'pilot': {'output': str(self.root / 'out')}}
        self.job = SimpleNamespace(scratch=self.root / 'scratch', out=self.root / 'out')

    def tearDown(self):
        self.temp.cleanup()

    @contextlib.contextmanager
    def publisher(self, *, continuous=False, fault=None):
        requested, published = threading.Event(), threading.Event()
        rows, errors = [], []
        def publish():
            try:
                if not requested.wait(3):
                    raise AssertionError('Publisher barrier not reached')
                target = self.pending.with_name('deps')
                self.pending.rename(target)
                rows.append({'before': str(self.pending), 'after': str(target)})
            except BaseException as error:
                errors.append(error)
            finally:
                published.set()
        worker = threading.Thread(target=publish)
        worker.start()
        real = os.stat
        def observed(path, *args, **kw):
            if kw.get('dir_fd') is not None and str(path).startswith('deps') and kw.get('follow_symlinks') is False:
                if not requested.is_set():
                    requested.set()
                    assert published.wait(3)
                elif continuous:
                    src = self.cache / str(path)
                    dest = self.cache / ('deps' if src.name != 'deps' else 'deps_temp_a4ff6522')
                    src.rename(dest)
                    rows.append({'before': str(src), 'after': str(dest)})
                elif fault is not None:
                    fault()
            return real(path, *args, **kw)
        try:
            with patch.object(os, 'stat', observed):
                yield rows
        finally:
            worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])

    def test_actual_helper_wait_completes_after_real_publication(self):
        ns = extract('round4_job_boundary.py', ['StationJob', 'deadline', 'DeadlineExpired'], {
            'signal': signal, 'time': time, 'contextmanager': contextlib.contextmanager})
        job = ns['StationJob'].__new__(ns['StationJob'])
        job.scratch, job.out = self.job.scratch, self.job.out
        job.state = {'errors': [], 'exits': {}}
        job.status = lambda: {'exits': job.state['exits']}
        job.members = lambda: job.state['exits'].update(capture=0)
        job.save = lambda: None
        with self.publisher() as rows, native_ports.phase(4):
            self.assertEqual(job.wait(3, observer=lambda: self.port.budgets(job)), 'completed')
        self.assertEqual(len(rows), 1)
        previous = self.port.result['raw']['writerPublicationObservations'][0]
        self.assertFalse(previous['atomicSnapshot'])
        self.assertEqual([a['complete'] for a in previous['attempts']], [False, True])
        self.assertEqual(previous['attempts'][0]['failure']['type'], 'FileNotFoundError')
        self.assertEqual(previous['bytes'], 137)
        self.port.budgets(job)
        self.assertIs(self.port.result['raw']['writerPublicationObservations'][0], previous)
        self.assertEqual(job.state['errors'], [])

    def test_continuous_real_publication_refuses_unknown(self):
        with self.publisher(continuous=True) as rows, self.assertRaises(FileNotFoundError):
            self.port.budgets(self.job)
        self.assertEqual(len(rows), 3)
        obs = self.port.result['raw']['lastWriterObservation']
        self.assertFalse(obs['complete'])
        sample = self.port.result['raw']['writerPublicationObservations'][0]
        self.assertIsNone(sample['bytes'])
        self.assertEqual(len(sample['attempts']), 3)
        self.assertTrue(all(not a['complete'] for a in sample['attempts']))

    def test_unknown_errors_and_real_sigalrm_after_publication_do_not_retry(self):
        for kind in ('permission', 'io', 'deadline'):
            with self.subTest(kind=kind):
                deps = self.cache / 'deps'
                if deps.exists(): deps.rename(self.pending)
                primary = OSError(errno.EACCES if kind == 'permission' else errno.EIO, 'UNKNOWN_PRIMARY')
                primary.unknown = {'complete': None, 'bytes': b'raw\xff'}
                def fault():
                    if kind == 'deadline': signal.raise_signal(signal.SIGALRM)
                    raise primary
                expected = native_ports.PhaseExpired if kind == 'deadline' else OSError
                with self.publisher(fault=fault), self.assertRaises(expected), native_ports.phase(4):
                    self.port.budgets(self.job)
                sample = self.port.result['raw']['writerPublicationObservations'][-1]
                self.assertFalse(sample['complete'])
                self.assertEqual(len(sample['attempts']), 2)
                failure = sample['attempts'][-1]['failure']
                self.assertEqual(failure['type'], expected.__name__ if kind == 'deadline' else type(primary).__name__)
                if kind != 'deadline': self.assertEqual(failure, evidence.failure(primary))
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))

    def test_live_addition_after_enumeration_is_resampled(self):
        real = os.stat
        fired = []
        def observed(path, *a, **kw):
            info = real(path, *a, **kw)
            if str(path) == 'bundle.js' and not fired:
                fired.append(True)
                (self.pending / 'second.js').write_bytes(b'xyz')
            return info
        sample = {}
        with patch.object(os, 'stat', observed):
            self.assertEqual(live_cache.measure(self.cache, 140, sample), 140)
        self.assertEqual(sample['attempts'][0]['failure']['type'], 'PublicationChanged')
        self.assertEqual(len(sample['attempts']), 2)

    def test_disappeared_root_does_not_become_an_empty_retry(self):
        real = os.stat
        fired = []
        def observed(path, *a, **kw):
            if str(path) == self.pending.name and not fired:
                fired.append(True)
                self.cache.rename(self.root / 'retained-cache')
            return real(path, *a, **kw)
        record = {}
        with patch.object(os, 'stat', observed), self.assertRaises(FileNotFoundError):
            live_cache.measure(self.cache, 137, record)
        self.assertIsNone(record['bytes']); self.assertFalse(record['complete'])
        self.assertEqual(len(record['attempts']), 2)

    def test_directory_replaced_by_link_before_open_refuses(self):
        real = os.open
        fired = []
        def opened(path, *a, **kw):
            if str(path) == self.pending.name and not fired:
                fired.append(True)
                self.pending.rename(self.cache / 'retained')
                self.pending.symlink_to(self.cache / 'retained', target_is_directory=True)
            return real(path, *a, **kw)
        record = {}
        with patch.object(os, 'open', opened), self.assertRaises(OSError):
            live_cache.measure(self.cache, 137, record)
        self.assertEqual(len(record['attempts']), 1)
        self.assertFalse(record['complete'])

    def test_live_cache_never_follows_links_or_opens_fifo_payload(self):
        data = self.pending / 'bundle.js'
        for kind in ('symlink', 'fifo', 'ancestor'):
            with self.subTest(kind=kind):
                if kind != 'ancestor':
                    data.unlink()
                    if kind == 'symlink': data.symlink_to('/dev/zero')
                    else: os.mkfifo(data)
                    target = self.cache
                else:
                    data.unlink();data.write_bytes(b'x')
                    target = self.root / 'linked' / 'deps_temp_a4ff6522'
                    (self.root / 'linked').symlink_to(self.cache, target_is_directory=True)
                record = {}
                with native_ports.phase(2), self.assertRaises((OSError, contract.Refused)):
                    live_cache.measure(target, 1000, record)
                self.assertFalse(record['complete'])
                self.assertEqual(len(record['attempts']), 1)

    def test_size_entry_time_bounds_and_absence(self):
        self.assertEqual(live_cache.measure(self.cache, 137, {}), 137)
        for cap in (136, -1):
            record = {}
            with self.assertRaises(contract.Refused): live_cache.measure(self.cache, cap, record)
            self.assertEqual(record['attempts'][0]['bytes'], 137)
            self.assertFalse(record['complete'])
        for name, value in (('ENTRY_CAP', 2), ('SECONDS', 0)):
            with patch.object(live_cache, name, value), self.assertRaises(contract.Refused):
                live_cache.measure(self.cache, 137, {})
        absent = {}
        self.assertEqual(live_cache.measure(self.root / 'absent', 137, absent), 0)
        self.assertTrue(absent['attempts'][0]['absenceVerification']['complete'])
        self.assertFalse(absent['attempts'][0]['exists'])
        with self.assertRaises(FileNotFoundError): live_cache.measure(self.root / 'missing-parent/absent', 137, {})

    def test_immutable_inventory_and_archive_do_not_retry(self):
        with self.publisher(), self.assertRaises(FileNotFoundError):
            cache_io.inventory(self.cache, 1000, {})
        self.assertNotIn('writerPublicationObservations', self.port.result['raw'])
        with patch.object(live_cache, 'measure', side_effect=AssertionError('live scan forbidden')):
            self.port.budgets(self.job, for_archive=True)
        self.assertEqual(self.port.result['raw']['lastWriterObservation']['cacheBytes'], 137)
        (self.cache / 'deps').rename(self.pending)
        lstat = Path.lstat
        def renamed(path, *a, **kw):
            if path == self.pending:
                self.pending.rename(self.cache / 'deps')
            return lstat(path, *a, **kw)
        with patch.object(Path, 'lstat', renamed), self.assertRaises(FileNotFoundError):
            self.port.budgets(self.job, for_archive=True)
        self.assertFalse(self.port.result['raw']['lastWriterObservation']['complete'])
        self.assertNotIn('writerPublicationObservations', self.port.result['raw'])

    def test_zero_byte_live_tmp_is_a_sample_not_an_immutable_snapshot(self):
        p = self.port.tmp / 'tsx-current.js';p.touch()
        self.port.budgets(self.job)
        self.assertEqual(self.port.result['raw']['lastWriterObservation']['privateTmpNonprofileBytes'], 0)
        p.write_bytes(b'partial')
        self.port.budgets(self.job)
        self.assertEqual(self.port.result['raw']['lastWriterObservation']['privateTmpNonprofileBytes'], 7)

    def test_actual_caller_preserves_incomplete_retry_facts_with_all_sinks_failed(self):
        root = self.root / 'caller'; root.mkdir()
        fixture = controls.Fixture(root)
        original = fixture.ports
        def factory(ready, result):
            port = original(ready, result)
            self.port.result = result
            port.budgets = lambda _: self.port.budgets(self.job)
            return port
        def broken(*_): raise OSError(28, 'SECONDARY_ALL_SINKS_FAILED')
        def sink(path, data):
            if Path(path).name in ('terminal.json', 'result.json', 'failed-result.json'):
                broken()
            evidence.Receipts.exclusive(path, data)
        try:
            with self.publisher(continuous=True), patch.object(bindings, 'ROOT', root):
                result = caller.execute(fixture.ready_path, enabled=True, authorization=fixture.ready['pilot']['authorizationId'],
                    verify_source=lambda _: fixture.source, ports_factory=factory, cache_guard=inert_clear,
                    sink=evidence.Receipts(sink), stderr=broken)
            self.assertFalse(result['accepted']);self.assertFalse(result['durable'])
            self.assertEqual(result['errors'][0]['phase'], 'capture-observer')
            self.assertEqual(result['errors'][0]['type'], 'FileNotFoundError')
            self.assertEqual(result['errors'][-1]['phase'], 'stderr-fallback-write')
            sample = result['raw']['writerPublicationObservations'][0]
            self.assertFalse(sample['complete']);self.assertEqual(len(sample['attempts']), 3)
            self.assertEqual(fixture.calls.count('launch'), 1)
        finally:
            fixture.cleanup()


if __name__ == '__main__':
    unittest.main()
