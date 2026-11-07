"""CPU-only real filesystem controls for the live cache observer, never a capture."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path: sys.path.remove(str(HERE))
import errno
import importlib.util
import json
import os
import signal
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('live_cache_caller', HERE / 'caller.py')
caller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caller)


class LiveCacheControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fauna-live-cache-cpu-')
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'cache'; self.root.mkdir()
        self.file = self.root / 'payload'; self.file.write_bytes(b'1234')
        self.ready = {'generatedCaches': [str(self.root)], 'initialCacheBytes': 0,
                      'budget': {'nativeReservesAndObservedThresholds': {'generatedCacheGrowth': 16}}}
        self.state = {}

    def tearDown(self):
        self.temp.cleanup()
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def sample(self):
        with patch.object(caller, 'bounded_read', side_effect=AssertionError('Live sampler read payload')):
            return caller.live_cache_usage(self.ready, self.state)

    def test_zero_length_file_grows_normally_but_exact_aggregate_cap_still_stops(self):
        for size in (16, 17):
            self.file.write_bytes(b'')
            inode = self.file.stat().st_ino
            original = os.fstat; changed = False
            def fstat(fd):
                nonlocal changed
                info = original(fd)
                if not changed and info.st_ino == inode:
                    changed = True; self.file.write_bytes(b'x' * size); info = original(fd)
                return info
            with self.subTest(size=size), patch.object(os, 'fstat', side_effect=fstat):
                if size == 16:
                    result = self.sample()
                    self.assertEqual(result['bytes'], 16)
                    self.assertTrue(result['enumerationComplete'])
                    self.assertFalse(result['atomic']); self.assertFalse(result['complete'])
                    self.assertEqual(result['payloadBytesRead'], 0)
                else:
                    with self.assertRaisesRegex(caller.Refused, 'exceeds controlled cap') as caught: self.sample()
                    self.assertEqual(caught.exception.cacheObservation['bytes'], 17)
            self.assertTrue(changed)

    def test_open_directory_descriptor_survives_publication_and_next_sample_recovers(self):
        self.file.unlink(); temporary = self.root / 'deps_temp_control'; temporary.mkdir()
        (temporary / 'new.js').write_bytes(b'1234')
        inode = temporary.stat().st_ino; original = os.scandir; fired = False
        def scandir(fd):
            nonlocal fired
            if isinstance(fd, int) and os.fstat(fd).st_ino == inode and not fired:
                fired = True; temporary.rename(self.root / 'deps')
            return original(fd)
        with patch.object(os, 'scandir', side_effect=scandir): result = self.sample()
        self.assertTrue(fired); self.assertFalse(result['enumerationComplete'])
        self.assertGreaterEqual(result['bytes'], 4)
        self.assertTrue(any('afterLookupFailure' in f for f in result['entries']))
        self.assertIsNotNone(self.state['uncertainSinceMonotonic'])
        self.assertTrue(self.sample()['enumerationComplete'])
        self.assertIsNone(self.state['uncertainSinceMonotonic'])
        self.assertEqual(self.state['consecutiveIncomplete'], 0)

    def test_disappearance_is_unknown_not_zero_and_cannot_outlive_existing_deadline(self):
        original = os.open; fired = False
        def opened(path, *args, **kwargs):
            nonlocal fired
            if str(path) == self.file.name and kwargs.get('dir_fd') is not None and not fired:
                fired = True; self.file.unlink()
            return original(path, *args, **kwargs)
        with patch.object(os, 'open', side_effect=opened): result = self.sample()
        self.assertFalse(result['enumerationComplete'])
        self.assertEqual(result['bytes'], 4)  # Before-open observed bytes remain; no guessed zero.
        self.assertTrue(any('openFailure' in f for f in result['entries']))
        self.state['uncertainSinceMonotonic'] = time.monotonic() - caller.CACHE_SNAPSHOT_SECONDS - 1
        with patch.object(caller.file_io, 'live_tree_usage', side_effect=AssertionError('Late resample dispatched')):
            with self.assertRaisesRegex(caller.Refused, 'remained uncertain') as caught: self.sample()
        self.assertIs(caught.exception.cacheObservation, result)
        self.assertIs(self.state['lastSample'], result)

    def test_raced_fifo_symlink_and_regular_replacement_are_not_old_snapshot_objects(self):
        original = os.open
        for kind in ('fifo', 'symlink', 'regular'):
            if self.file.exists() or self.file.is_symlink(): self.file.unlink()
            self.file.write_bytes(b'1234'); saved = self.base / ('saved-' + kind); fired = False
            def opened(path, *args, **kwargs):
                nonlocal fired
                if str(path) == self.file.name and kwargs.get('dir_fd') is not None and not fired:
                    fired = True; self.file.rename(saved)
                    if kind == 'fifo': os.mkfifo(self.file)
                    elif kind == 'symlink': self.file.symlink_to(saved)
                    else: self.file.write_bytes(b'NEW')
                return original(path, *args, **kwargs)
            with self.subTest(kind=kind), patch.object(os, 'open', side_effect=opened):
                if kind == 'regular':
                    result = self.sample(); self.assertFalse(result['enumerationComplete'])
                    self.assertTrue(any('openedReplacement' in f for f in result['entries']))
                else:
                    with self.assertRaises((caller.Refused, OSError)): self.sample()
            self.assertTrue(fired)

    def test_raced_descendant_and_outer_ancestors_do_not_traverse_links(self):
        self.file.unlink(); child = self.root / 'child'; child.mkdir(); (child / 'owned').write_bytes(b'1234')
        foreign = self.base / 'foreign'; foreign.mkdir(); (foreign / 'secret').write_bytes(b'foreign')
        child_inode = child.stat().st_ino; foreign_inode = foreign.stat().st_ino
        original = os.scandir; fired = False; seen = []
        def scandir(fd):
            nonlocal fired
            if isinstance(fd, int):
                inode = os.fstat(fd).st_ino; seen.append(inode)
                if inode == child_inode and not fired:
                    fired = True; child.rename(self.root / 'moved'); child.symlink_to(foreign, target_is_directory=True)
            return original(fd)
        with patch.object(os, 'scandir', side_effect=scandir), self.assertRaisesRegex(caller.Refused, 'Unsafe live cache replacement'):
            self.sample()
        self.assertNotIn(foreign_inode, seen)
        # An outside ancestor is always under the existing strict path contract.
        alias = self.base / 'alias'; alias.symlink_to(self.root, target_is_directory=True)
        self.ready['generatedCaches'] = [str(alias / 'moved')]
        with self.assertRaisesRegex(caller.Refused, 'Unsafe controlled entry'): self.sample()

    def test_unknown_read_and_after_close_error_keep_primary_raw_facts_and_descriptors(self):
        inode = self.file.stat().st_ino; original_stat = os.fstat; original_close = os.close
        selected = set(); error = OSError(errno.EIO, 'UNKNOWN_READ'); error.future = {'bytes': b'\0\xff'}
        def fstat(fd):
            info = original_stat(fd)
            if info.st_ino == inode:
                if fd in selected: raise error
                selected.add(fd)
            return info
        def close(fd):
            original_close(fd)
            if fd in selected: raise OSError('AFTER_CLOSE_FAILURE')
        with patch.object(os, 'fstat', side_effect=fstat), patch.object(os, 'close', side_effect=close):
            with self.assertRaises(OSError) as caught: self.sample()
        self.assertIs(caught.exception, error)
        self.assertEqual(caller.failure(error)['attributes']['future']['bytes']['base64'], 'AP8=')
        self.assertEqual(error.metadata_close_failures[0]['message'], 'AFTER_CLOSE_FAILURE')
        self.assertFalse(error.cacheObservation['complete'])
        for fd in selected:
            with self.assertRaises(OSError): original_stat(fd)

    def test_real_timer_and_keyboard_interrupt_unwind_without_later_root_dispatch(self):
        original = os.scandir
        for interruption in ('timer', 'keyboard'):
            reached = []
            def scandir(fd):
                reached.append(fd)
                if interruption == 'keyboard': raise KeyboardInterrupt('CONTROL_CANCEL')
                time.sleep(.1)
                return original(fd)
            self.ready['generatedCaches'] = [str(self.root), str(self.base / 'later')]
            with self.subTest(interruption=interruption), patch.object(caller, 'CACHE_SNAPSHOT_SECONDS', .02), patch.object(os, 'scandir', side_effect=scandir):
                with self.assertRaises((caller.CacheDeadlineExpired, KeyboardInterrupt)) as caught: self.sample()
            self.assertEqual(len(reached), 1)
            self.assertFalse(caught.exception.cacheObservation['complete'])
            for fd in reached:
                with self.assertRaises(OSError): os.fstat(fd)

    def test_entry_and_evidence_ceilings_are_enforced_without_payload_reads(self):
        self.file.unlink()
        for i in range(caller.CACHE_ENTRY_CAP - 1): (self.root / str(i)).touch()
        sample = self.sample(); self.assertEqual(len(sample['entries']), caller.CACHE_ENTRY_CAP)
        (self.root / 'extra').touch()
        with self.assertRaisesRegex(caller.Refused, 'entry/evidence cap'): self.sample()
        with patch.object(caller.file_io, 'CACHE_ENTRY_METADATA_CAP', 20):
            with self.assertRaisesRegex(caller.Refused, 'evidence cap'): self.sample()

    def test_posttermination_cache_inventory_still_rejects_publication_race(self):
        self.file.unlink(); temporary = self.root / 'deps_temp_control'; temporary.mkdir(); (temporary / 'new').write_bytes(b'1234')
        original = os.stat; fired = False
        def stat(path, *args, **kwargs):
            nonlocal fired
            value = original(path, *args, **kwargs)
            if str(path) == temporary.name and kwargs.get('dir_fd') is not None and not fired:
                fired = True; temporary.rename(self.root / 'deps')
            return value
        observation = {'entries': [], 'bytes': 0, 'complete': False}
        with patch.object(os, 'stat', side_effect=stat), self.assertRaises(FileNotFoundError):
            caller.cache_after(self.ready, observation)
        self.assertTrue(fired); self.assertFalse(observation['complete'])


if __name__ == '__main__': unittest.main(verbosity=2)
