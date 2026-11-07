"""R1 real helper/cache crossings with inert native ports and retained scratch."""
import contextlib
import importlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import bindings
import boundary
import caller
import native

sys.path.insert(0, str(bindings.HELPERS))
jb = importlib.import_module('round4_job_boundary')
stages = importlib.import_module('run_round4_remaining8')
HERE = Path(__file__).resolve().parent


def scratch():
    return Path(tempfile.mkdtemp(prefix='vmr1-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()


class RevisionControls(unittest.TestCase):
    def adapter(self, mode='healthy', save_fails=False):
        root = scratch(); evidence_dir = root / 'evidence'; evidence_dir.mkdir()
        ready = json.loads((HERE / 'readiness.json').read_text())
        spec = caller.plan()['units'][0]
        paths = {'ready': str(root / 'ready'), 'consumption': str(root / 'consumption'),
                 'evidence': str(evidence_dir), 'output': str(root / 'output')}
        record = {'entryToken': 'INERT', 'sourceHead': '0' * 40, 'consumptionSha256': '0' * 64}
        trace = []; originals = []; ticks = []; temp = tempfile.mkdtemp
        rows = [{'pid': 990001 + i, 'birth': [1, i], 'uid': os.getuid(), 'pgid': 990001, 'status': 2} for i in range(4)]
        binary = ready['bindings']['browserBinary']
        commands = {row['pid']: binary + ('' if i == 0 else ' --type=' + ['gpu-process', 'renderer', 'utility'][i - 1]) for i, row in enumerate(rows)}
        def mkdtemp(*args, **kwargs):
            kwargs['dir'] = str(root); return temp(*args, **kwargs)
        def forbidden(*args, **kwargs):
            raise AssertionError('Native process port forbidden')
        def start(job):
            trace.append('start-inert')
            job.root = rows[0]; job.coalition_id = 111111
            private = Path(json.loads((job.scratch / 'request.json').read_text())['env']['TMPDIR'])
            profile = private / 'playwright_chromiumdev_profile-inert'; profile.mkdir(mode=0o700)
            (job.scratch / 'capture_stdout.txt').write_text(f'<launching> {binary} --use-angle=metal --user-data-dir={profile}\n<launched> pid={rows[0]["pid"]}\n')
            if mode == 'resource': (job.scratch / 'unexpected-link').symlink_to(root)
        def status(job):
            if ticks: job.state['exits']['capture'] = 0
            ticks.append(True); return job.state
        def drain(job, *_):
            trace.append('mandatory-inert-drain'); job.state['drained'] = False; return job.state
        def current_commands(_):
            trace.append('actual-observer-command-port')
            if mode == 'observer':
                error = subprocess.TimeoutExpired(['inert-observer'], .01, output=b'RAW\xff', stderr=b'ERR\xfe')
                error.unknown = {'retained': b'\x00'}; originals.append(error); raise error
            if mode == 'deadline':
                try:
                    with boundary.deadline(.01): time.sleep(.05)
                except BaseException as error:
                    error.unknown = {'retained': b'\x00'}; originals.append(error); raise
            return commands
        real_require = native.require
        def resource_require(condition, message):
            try: real_require(condition, message)
            except Exception as error:
                if str(message).startswith('Unexpected owned symlink'):
                    error.unknown = {'retained': b'\x00'}; originals.append(error)
                raise
        real_write = jb.write
        def write(path, value):
            if save_fails and Path(path).name == 'boundary.json' and value.get('errors'):
                error = OSError('POST_OBSERVER_RECEIPT_FAILURE'); error.partial = b'RECEIPT\xff'; raise error
            return real_write(path, value)
        real_require_browser = stages.StageReceipts.require_browser
        def require_browser(observer):
            real_require_browser(observer); trace.append('actual-require-browser-pass')
        with contextlib.ExitStack() as stack:
            for owner, name, value in [
                (tempfile, 'mkdtemp', mkdtemp), (subprocess, 'run', forbidden), (subprocess, 'check_output', forbidden), (subprocess, 'Popen', forbidden),
                (jb.StationJob, 'start', start), (jb.StationJob, 'status', status), (jb.StationJob, 'drain', drain),
                (jb.StationJob, 'members', lambda _: rows), (jb, 'kernel_tasks', lambda _: {'live': 0}), (jb, 'write', write),
                (stages, 'current_commands', current_commands), (stages, 'identity', lambda pid: next(row for row in rows if row['pid'] == pid)),
                (stages, 'coalition', lambda _: [111111, 0]), (stages, 'executable_path', lambda _: binary),
                (stages.StageReceipts, 'require_browser', require_browser), (native, 'require', resource_require),
            ]: stack.enter_context(patch.object(owner, name, value))
            try:
                native.capture(ready, spec, paths, record)
                self.fail('Inert release deliberately remains unproved')
            except BaseException as error:
                caught = error
        (root / 'result.json').write_text(json.dumps({'mode': mode, 'saveFails': save_fails, 'trace': trace, 'record': boundary.raw(record), 'error': boundary.raw(caught)}, indent=2) + '\n')
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)
        self.assertFalse(record['native']['released'])
        return record['native'], trace, caught, originals

    def test_actual_retained_observe_and_require_browser_use_pinned_schema(self):
        evidence, trace, error, _ = self.adapter()
        self.assertIn('actual-require-browser-pass', trace)
        self.assertEqual(evidence['wait'], 'completed')
        self.assertEqual({r['role'] for r in evidence['observation']['processes']}, {'browser', 'gpu-process', 'renderer', 'utility'})
        self.assertTrue(all(r['admitted'] for r in evidence['observation']['processes']))
        self.assertIn('Capture release unproved', str(error))

    def test_resource_and_observer_primary_survive_real_wait_and_failed_save(self):
        for mode in ('resource', 'observer'):
            for save_fails in (False, True):
                with self.subTest(mode=mode, save_fails=save_fails):
                    evidence, trace, caught, originals = self.adapter(mode, save_fails)
                    self.assertIs(caught, originals[0])
                    self.assertEqual(evidence['primaryFailure']['attributes']['unknown']['retained']['base64'], 'AA==')
                    if mode == 'observer':
                        self.assertEqual(evidence['primaryFailure']['attributes']['output']['base64'], 'UkFX/w==')
                        self.assertEqual(evidence['primaryFailure']['attributes']['stderr']['base64'], 'RVJS/g==')
                    if save_fails:
                        self.assertTrue(any(f.get('message') == 'POST_OBSERVER_RECEIPT_FAILURE' for f in evidence['secondaryFailures']))
                    self.assertNotIn('actual-require-browser-pass', trace)
                    self.assertNotIn('observation', evidence)  # No fallible post-wait receipt before promoting the cause.

    def test_actual_callback_alarm_unwinds_before_later_capture_dispatch(self):
        evidence, trace, caught, originals = self.adapter('deadline')
        self.assertIs(caught, originals[0])
        self.assertEqual(evidence['primaryFailure']['type'], 'DeadlineExpired')
        self.assertNotIn('wait', evidence)
        self.assertNotIn('observation', evidence)
        self.assertEqual(trace[-1], 'mandatory-inert-drain')

    def test_cache_growth_before_each_content_pass_is_capped_before_read(self):
        for phase in ('first', 'source-reconcile', 'copy-reconcile', 'growth-validation'):
            with self.subTest(phase=phase):
                root = scratch(); cache = root / 'cache'; cache.mkdir(); leaf = cache / 'leaf'; leaf.write_bytes(b'x')
                evidence = root / 'e'; evidence.mkdir(); record = {'ledger': []}; reads = []; changed = []
                original_contents = caller.cache_contents; fdopen = os.fdopen; calls = []
                class Stream:
                    def __init__(self, stream): self.stream = stream
                    def __enter__(self): return self
                    def __exit__(self, *args): self.stream.close()
                    def read(self, n):
                        value = self.stream.read(n); reads.append((n, len(value))); return value
                def grow(admitted, cap, event, **kwargs):
                    calls.append(True)
                    selected = {'first': 1, 'source-reconcile': 2, 'copy-reconcile': 3, 'growth-validation': 1}[phase]
                    if len(calls) == selected:
                        victim = Path(admitted['trees'][0]['path']) / 'leaf'
                        with victim.open('wb') as stream: stream.truncate(64 * boundary.MIB + 1)
                        changed.append(True)
                    return original_contents(admitted, cap, event, **kwargs)
                with patch.object(caller, 'cache_contents', grow), patch.object(os, 'fdopen', lambda *a, **kw: Stream(fdopen(*a, **kw))), boundary.deadline(.5):
                    with self.assertRaises(ValueError):
                        if phase == 'growth-validation': caller.bounded_caches([str(cache)], 256 * boundary.MIB + 1, {})
                        else: caller.snapshot_caches({'bindings': {'generatedCaches': [str(cache)]}}, evidence, record)
                self.assertEqual(changed, [True])
                self.assertLessEqual(sum(n for _, n in reads), 2)
                self.assertTrue(all(asked <= 2 for asked, _ in reads))
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)
                (root / 'read-facts.json').write_text(json.dumps({'phase': phase, 'reads': reads, 'record': record}, indent=2) + '\n')

    def test_cache_aggregate_exact_limit_fifo_and_descriptor_closure(self):
        root = scratch(); cache = root / 'cache'; cache.mkdir(); (cache / 'a').write_bytes(b'abc'); (cache / 'b').write_bytes(b'de')
        event = {}; self.assertEqual(caller.bounded_caches([str(cache)], 5, event), 5)
        self.assertEqual([r['cap'] for r in event['reads']], [3, 2])
        with self.assertRaisesRegex(ValueError, 'ceiling'): caller.bounded_caches([str(cache)], 4, {})
        original = os.open; descriptors = []; leaf = cache / 'a'
        def fifo(path, flags, *args, **kwargs):
            if Path(path) == leaf and not descriptors:
                leaf.rename(cache / 'original'); os.mkfifo(leaf)
                descriptor = original(path, flags, *args, **kwargs); descriptors.append(descriptor); return descriptor
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', fifo), boundary.deadline(.5), self.assertRaises(ValueError): caller.bounded_caches([str(cache)], 5, {})
        self.assertEqual(len(descriptors), 1)
        with self.assertRaises(OSError): os.fstat(descriptors[0])
        self.assertEqual((cache / 'original').read_bytes(), b'abc')


if __name__ == '__main__': unittest.main()
