"""R1/R2 actual retained helper bodies; R3 real harmless holders. CPU only, max two processes."""
import sys
sys.dont_write_bytecode = True
import ast
import contextlib
import json
import os
from pathlib import Path
import plistlib
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

import bindings
import cache_owners
import caller
import contract
import controls
import evidence
import native_ports


def inert_clear(ready, records, phase):
    records.append({'phase': phase, 'status': 'INERT_CLEAR_CONTROL_ONLY'})


class BoundaryControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='effects-r1-r3-', dir='/private/tmp')
        self.root = Path(self.temp.name)
        self.f = controls.Fixture(self.root)

    def tearDown(self):
        self.f.cleanup()
        self.temp.cleanup()

    def helper_case(self, mode, bootstrap_exit=17, sinks_fail=False):
        helper = contract.ROOT / 'assets/blend/stations/_authoring/round4_job_boundary.py'
        tree = ast.parse(helper.read_text())
        nodes = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in ('StationJob', 'deadline', 'DeadlineExpired')]
        allocated, attempted, calls = [], [], []
        process = subprocess.CompletedProcess(['inert-launchctl'], bootstrap_exit, b'BOOTSTRAP_STDOUT_UNKNOWN\0', b'BOOTSTRAP_STDERR_UNKNOWN\xff')
        process.unknown_producer = {'partial': None, 'exitObserved': True}
        def mkdtemp(**kw):
            p = tempfile.mkdtemp(prefix=kw['prefix'], dir=self.root); allocated.append(p); return p
        def write(path, value):
            calls.append(Path(path).name)
            matches = Path(path).name == ('request.json' if mode.startswith('constructor') else 'bootstrap.json')
            if matches:
                attempted[0].unknown_ownership = {'retainedBytes': b'\0\xff', 'possibleRegistration': None}
                if mode.endswith('deadline'):
                    signal.raise_signal(signal.SIGALRM)
                error = OSError(28, 'INJECTED_RECEIPT_FAILURE_WITHOUT_FILENAME')
                error.unknown = {'partial': None}
                raise error
            controls.put(path, value)
        bootstraps = []
        def run(*args, **kw):
            bootstraps.append({'args': args, 'kwargs': kw})
            return process
        producer = SimpleNamespace(run=run)
        namespace = {'__file__': str(helper), 'Path': Path, 'tempfile': SimpleNamespace(mkdtemp=mkdtemp), 'os': os,
                     'uuid': uuid, 'write': write, 'sys': sys, 'plistlib': plistlib, 'subprocess': producer,
                     'time': time, 'signal': signal, 'contextmanager': contextlib.contextmanager}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(helper), 'exec'), namespace)
        def factory(ready, result):
            ready.update(path=os.environ['PATH'], node='/inert/node')
            port = native_ports.NativePorts.__new__(native_ports.NativePorts)
            port.ready, port.result = ready, result
            port.tmp = self.root / 'private-tmp'; port.tmp.mkdir(); port.admission = {}
            port.boundary = SimpleNamespace(StationJob=namespace['StationJob'])
            port.allocate_tmp = lambda _: (port.tmp, {'path': str(port.tmp), 'inert': True})
            port.observer = lambda _: SimpleNamespace(receipt=lambda: {'inert': True}, observe=lambda: None, require_browser=lambda: None)
            initialize = port.initialize
            def init(job, *args):
                attempted.append(job)
                initialize(job, *args)
            port.initialize = init
            return port
        sink_attempts = []
        def sink(path, data):
            sink_attempts.append(Path(path).name)
            if sinks_fail and Path(path).name in ('terminal.json', 'result.json', 'failed-result.json'):
                raise OSError('SINK_FAILURE')
            evidence.Receipts.exclusive(path, data)
        def stderr(data):
            if sinks_fail: raise OSError('STDERR_FAILURE')
        previous = signal.getsignal(signal.SIGALRM)
        with patch.object(bindings, 'ROOT', self.root):
            result = caller.execute(self.f.ready_path, enabled=True, authorization=self.f.ready['pilot']['authorizationId'],
                                    verify_source=lambda _: self.f.source, ports_factory=factory, cache_guard=inert_clear,
                                    sink=evidence.Receipts(sink), stderr=stderr)
        self.assertFalse(result['accepted']); self.assertIsNone(result['release']); self.assertNotIn('inspection', result)
        self.assertEqual(len(allocated), 1); self.assertTrue(Path(allocated[0]).is_dir())
        self.assertEqual(len(result['jobs']), 1)
        for which in ('ownershipBeforeCleanup', 'ownershipAfterCleanup'):
            observed = result['jobs'][0][which]
            self.assertEqual(observed['missing'], [])
            attrs = observed['attributes']
            self.assertEqual(attrs['scratch'], allocated[0])
            self.assertEqual(attrs['out'], self.f.paths['evidence'] + '/job')
            self.assertTrue(attrs['target'].startswith('gui/'))
            self.assertIsNone(attrs['root']); self.assertIsNone(attrs['coalition_id'])
            self.assertEqual(attrs['known'], {}); self.assertIs(attrs['registered'], False)
            self.assertEqual(attrs['unknown_ownership'], {'retainedBytes': {'type': 'bytes', 'base64': 'AP8='}, 'possibleRegistration': None})
            self.assertEqual(observed['registrationAndRelease'], 'UNPROVED_BY_THIS_ATTRIBUTE_SNAPSHOT')
        self.assertIs(namespace['subprocess'], producer)
        self.assertNotIn('members', vars(attempted[0]))
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
        if mode.startswith('constructor'):
            self.assertEqual(bootstraps, []); self.assertNotIn('boundary.json', calls)
            self.assertFalse(result['jobs'][0]['startAttempted'])
        else:
            self.assertEqual(len(bootstraps), 1)  # No retry, including a successful-but-unreceipted bootstrap.
            self.assertTrue(result['jobs'][0]['startAttempted']); self.assertFalse(result['jobs'][0]['started'])
            producer_rows = [r for r in result['raw']['start'][0]['observations'] if r['probe'] == 'subprocess.run']
            self.assertEqual(len(producer_rows), 1)
            retained = producer_rows[0]['returned']
            self.assertEqual(retained, evidence.raw(process))
            self.assertEqual(retained['returncode'], bootstrap_exit)
        if mode.endswith('deadline'):
            self.assertEqual(result['errors'][0]['type'], 'PhaseExpired')
        if sinks_fail:
            self.assertFalse(result['durable'])
            self.assertEqual([r['phase'] for r in result['errors']], ['admission-allocation-capture', 'cleanup', 'terminal-write', 'final-result-write', 'packet-fallback-write', 'stderr-fallback-write'])
            self.assertEqual(len(sink_attempts), len(set(sink_attempts)))
        else:
            durable = contract.snapshot(Path(self.f.paths['evidence']) / 'result.json')['value']
            self.assertEqual(durable['jobs'], result['jobs'])
            self.assertEqual(durable['raw'], result['raw'])
        return result

    def test_R1_actual_constructor_ownership_before_first_save(self):
        self.helper_case('constructor')

    def test_R1_constructor_deadline_and_all_sinks_fail_keeps_ownership(self):
        self.helper_case('constructor-deadline', sinks_fail=True)

    def test_R2_actual_failed_bootstrap_producer_survives_receipt_failure(self):
        self.helper_case('bootstrap', 17)

    def test_R2_successful_bootstrap_uncertain_registration_and_all_sinks_fail(self):
        self.helper_case('bootstrap', 0, sinks_fail=True)

    def test_R2_actual_start_sigalrm_restores_ports_and_keeps_producer(self):
        self.helper_case('bootstrap-deadline', 0, sinks_fail=True)

    @contextlib.contextmanager
    def holder(self, path, *, cwd=None, node=False):
        if node:
            runtime = contract.snapshot(contract.HERE / 'readiness.json')['value']['node']
            script = self.root.parent / (self.root.name + '-inert-holder.mjs')
            script.write_text("process.stdout.write(JSON.stringify({pid:process.pid})+'\\n');process.stdin.resume();process.stdin.on('data',()=>process.exit(0));\n")
            argv = [runtime, str(script)]
        else:
            script = None
            argv = [sys.executable, '-B', '-c', "import os,sys,json;fd=os.open(sys.argv[1],os.O_RDWR);print(json.dumps({'pid':os.getpid(),'inode':os.fstat(fd).st_ino,'mode':'O_RDWR'}),flush=True);sys.stdin.buffer.read(1);os.close(fd)", str(path)]
        actor = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            with selectors.DefaultSelector() as selected:
                selected.register(actor.stdout, selectors.EVENT_READ)
                self.assertTrue(selected.select(5), 'Harmless holder did not report readiness')
                identity = json.loads(actor.stdout.readline())
            yield actor, identity
        finally:
            try:
                if actor.poll() is None: actor.communicate('x', timeout=5)
                self.assertEqual(actor.returncode, 0)
            finally:
                if actor.poll() is None: actor.kill(); actor.wait(timeout=1)
                if script is not None: script.unlink()

    def owner_ready(self):
        cache = self.root / 'cache'; cache.mkdir()
        file = cache / 'existing.json'; file.write_text('{"cached":true}')
        python = bindings.file_binding(Path(sys.executable).resolve())
        self.f.ready.update(python=python['path'], path=os.environ['PATH'], initialCacheBytes=file.stat().st_size,
                            bindings=[python], dependencyTrees=[], pythonRuntime={'launcher': python, 'kernelExecutable': python},
                            process_binary_sha256={python['path']: python['sha256']})
        controls.put(self.f.ready_path, self.f.ready)
        self.f.grant['readinessSha256'] = contract.sha(self.f.ready_path)
        controls.put(self.f.paths['grant'], self.f.grant)
        return file

    def actual_verify_call(self, *, factory=None, **kw):
        with patch.object(bindings, 'ROOT', self.root), patch.object(bindings, 'source', lambda _: self.f.source):
            return caller.execute(self.f.ready_path, enabled=True, authorization=self.f.ready['pilot']['authorizationId'],
                                  verify_source=bindings.verify, ports_factory=factory or self.f.ports, stderr=kw.pop('stderr', lambda _: None), **kw)

    def test_R3_real_RDWR_owner_refuses_before_consumption_or_snapshot(self):
        file = self.owner_ready()
        with self.holder(file) as (actor, owner):
            def denied(_): raise OSError('STDERR_FAILURE')
            result = self.actual_verify_call(stderr=denied)
            self.assertIsNone(actor.poll())
            self.assertFalse(result['accepted']); self.assertEqual(result['publication'], 'REFUSED_BEFORE_CONSUMPTION')
            self.assertEqual(self.f.calls, [])
            self.assertEqual([r['phase'] for r in result['errors']], ['cache-owner-admission', 'admission-stderr-write'])
            self.assertFalse(Path(self.f.paths['consumption']).exists())
            self.assertFalse(Path(self.f.paths['evidence']).exists())
            self.assertFalse(Path(self.f.ready['pilot']['output']).exists())
            raw = result['raw']['cacheOwnerChecks'][0]
            self.assertEqual(raw['status'], 'UNKNOWN')
            conflict = next(r for r in raw['conflicts'] if r['pid'] == owner['pid'])
            self.assertIn('i' + str(owner['inode']), conflict['fields']); self.assertIn('au', conflict['fields'])

    def test_R3_second_guard_catches_owner_started_after_actual_snapshot(self):
        file = self.owner_ready()
        with contextlib.ExitStack() as exit_stack:
            def factory(ready, result):
                port = self.f.ports(ready, result)
                port.cache_snapshot = native_ports.snapshot_caches
                initialize = port.initialize
                def init(*args):
                    initialize(*args)
                    self.actor, self.owner = exit_stack.enter_context(self.holder(file))
                port.initialize = init
                return port
            result = self.actual_verify_call(factory=factory)
            self.assertTrue(hasattr(self, 'actor'), str(result['errors']))
            self.assertFalse(result['accepted']); self.assertIsNone(self.actor.poll())
            self.assertNotIn('launch', self.f.calls); self.assertNotIn('wait', self.f.calls)
            self.assertIn('release', self.f.calls)
            self.assertTrue(Path(self.f.paths['consumption']).exists())
            records = result['raw']['cacheOwnerChecks']
            self.assertEqual([r['phase'] for r in records], ['before-consumption-and-snapshot', 'immediately-before-launch'])
            self.assertEqual(records[0]['status'], 'CLEAR'); self.assertEqual(records[1]['status'], 'UNKNOWN')
            self.assertEqual((Path(self.f.paths['evidence']) / 'cache-before/0/existing.json').read_bytes(), file.read_bytes())

    def test_R3_real_harmless_task_cwd_Node_refuses_absent_cache(self):
        with self.holder(None, cwd=self.root, node=True) as (actor, owner):
            result = self.f.run()
            self.assertFalse(result['accepted']); self.assertIsNone(actor.poll())
            conflicts = result['raw']['cacheOwnerChecks'][0]['conflicts']
            self.assertTrue(any(c['pid'] == owner['pid'] and c['kind'].startswith('task-local') for c in conflicts))
            self.assertFalse(Path(self.f.paths['consumption']).exists()); self.assertEqual(self.f.calls, [])

    def test_R3_unrelated_real_holder_does_not_block_exact_task_scope(self):
        self.owner_ready()
        other = self.root / 'unrelated'; other.write_text('unrelated')
        with self.holder(other) as (actor, _):
            result = self.actual_verify_call()
            self.assertTrue(result['accepted'], result['errors']); self.assertIsNone(actor.poll())
            self.assertEqual([r['status'] for r in result['raw']['cacheOwnerChecks']], ['CLEAR', 'CLEAR'])

    def test_R3_unknown_probe_and_failed_stderr_preserve_evidence_without_allocation(self):
        self.owner_ready()
        def uncertain(argv, record, end):
            row = {'argv': argv, 'returncode': 1, 'stdout': b'PARTIAL_UNKNOWN\0', 'stderr': b'UNREADABLE_CACHE', 'reaped': True,
                   'unknown_future_probe': {'value': None}}
            record['probes'].append(row)
            return row
        def guard(ready, records, phase): return cache_owners.check_cache_owners(ready, records, phase, command=uncertain)
        def denied(_): raise OSError('STDERR_FAILURE')
        result = self.actual_verify_call(cache_guard=guard, stderr=denied)
        self.assertFalse(result['accepted']); self.assertFalse(result['durable'])
        self.assertEqual([r['phase'] for r in result['errors']], ['cache-owner-admission', 'admission-stderr-write'])
        row = result['raw']['cacheOwnerChecks'][0]['probes'][0]
        self.assertEqual(row['unknown_future_probe'], {'value': None}); self.assertEqual(row['stdout']['base64'], 'UEFSVElBTF9VTktOT1dOAA==')
        self.assertFalse(Path(self.f.paths['consumption']).exists()); self.assertEqual(self.f.calls, [])

    def test_R3_probe_caps_deadlines_and_reaps_only_owned_harmless_child(self):
        for kind, program in [('cap', 'import os;os.write(1,b"x"*65536)'), ('deadline', 'import time;time.sleep(5)')]:
            record = {'probes': [], 'bytes': 0}
            with patch.object(cache_owners, 'COMMAND_CAP', 1024), self.assertRaises(contract.Refused):
                cache_owners.probe([sys.executable, '-B', '-c', program], record, time.monotonic() + (.15 if kind == 'deadline' else 2))
            row = record['probes'][0]
            self.assertTrue(row['reaped']); self.assertIsNotNone(row['returncode'])
            self.assertLessEqual(len(row['stdout']) + len(row['stderr']), 1025)
            self.assertIn('failure', row)

    def test_R3_actual_cache_read_access_time_is_not_content_drift(self):
        file = self.owner_ready()
        info = file.stat()
        os.utime(file, ns=(info.st_atime_ns - 86400 * 10**9, info.st_mtime_ns))
        before = file.stat()
        records = []
        native_ports.snapshot_caches(self.f.ready, self.root / 'cache-copy', records)
        self.assertNotEqual(file.stat().st_atime_ns, before.st_atime_ns)
        row = records[0]['files'][0]
        self.assertTrue(row['complete']); self.assertEqual(row['before'], row['after'])
        self.assertEqual((self.root / 'cache-copy/0/existing.json').read_bytes(), file.read_bytes())


if __name__ == '__main__':
    unittest.main(verbosity=2)
