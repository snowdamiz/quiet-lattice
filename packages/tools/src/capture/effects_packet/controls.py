"""Scratch-only controls of actual admission/caller/decoder/cleanup ports. No native runtime."""
import sys
sys.dont_write_bytecode = True
import ast
import contextlib
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import tempfile
import time
from types import SimpleNamespace, MethodType
import unittest
from unittest.mock import patch
import uuid
import zlib

import bindings
import caller
import contract
from contract import ASSET, ASSET_HEAD, FILE, PURPOSE, Refused, ledger, plan, sha, snapshot
from evidence import Receipts, failure, publish
from inspect_packet import inspect_packet, perf, png
from native_ports import NativePorts, PhaseExpired, observe_call, phase, snapshot_caches


def put(path, value):
    Path(path).write_text(json.dumps(value, sort_keys=True) + '\n')


def image(width, height, filters=(0,)):
    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    # Nonzero constant RGB pixels, encoded through all five real PNG filters.
    line = bytes([7, 11, 19]) * width
    raw = bytearray()
    previous = bytes(len(line))
    for y in range(height):
        kind = filters[y % len(filters)]
        raw.append(kind)
        if kind == 0:
            raw.extend(line)
        else:
            for i, b in enumerate(line):
                left, up, ul = (line[i - 3] if i >= 3 else 0), previous[i], (previous[i - 3] if i >= 3 else 0)
                p = left + up - ul
                a, bb, c = abs(p - left), abs(p - up), abs(p - ul)
                paeth = left if a <= bb and a <= c else up if bb <= c else ul
                prediction = (0, left, up, (left + up) // 2, paeth)[kind]
                raw.append((b - prediction) & 255)
        previous = line
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def actual_shape():
    stats = {'file': FILE, 'asset': ASSET, 'variant': ASSET, 'lod': 0, 'shown': 0, 'lods': [0],
             'materials': ['LIB_FX_Gravitic'], 'meshes': 1, 'triangles': 576,
             'textures': {k: {'count': 1, 'compressed': 1, 'mb': 1.3} for k in ('shown', 'file')}}
    return {'file': FILE, 'asset': ASSET, 'variant': ASSET, 'class': 'effect', 'gl': 'metal', 'viewport': [1920, 1080],
            'stats': stats, 'errors': [], 'spots': {k: {} for k in contract.LIGHTS}, 'overlay': {},
            'far': [{'range': 100, 'case': 'noon-lush', 'lod': 2, 'shown': 0}],
            'perf': [{'case': k, 'lod': 0, 'viewport': [1920, 1080], 'stats': copy.deepcopy(stats),
                      'scene': {}, 'withoutAsset': {}, 'asset': {}, 'settle': {}} for k in contract.LIGHTS]}


def packet(root):
    (root / ASSET).mkdir()
    normal, sheet = image(1920, 1080), image(1920, 2876)
    writes = []
    for name in plan():
        data = (json.dumps(actual_shape()) + '\n').encode() if name.endswith('perf.json') else sheet if name.endswith('sheet.png') else normal
        (root / name).write_bytes(data)
        writes.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'completed': True})
    return writes


class Fixture:
    def __init__(self, root):
        self.root = root
        (root / 'assets/renders').mkdir(parents=True)
        nonce = 'control-' + uuid.uuid4().hex
        self.paths = {'evidence': '/private/tmp/egp-' + nonce, 'consumption': '/private/tmp/egc-' + nonce + '.json', 'grant': '/private/tmp/egg-' + nonce + '.json'}
        self.source = {'head': 'a' * 40, 'tree': 'b' * 40, 'clean': True}
        self.ready = {'runtimeEnabled': True, 'root': str(root), 'uid': os.getuid(), 'assetSourcePaths': [],
                      'budget': ledger(), 'asset': {'material': 'LIB_FX_Gravitic', 'triangles': 576},
                      'pilot': {**self.paths, 'file': FILE, 'asset': ASSET, 'gl': 'metal', 'viewport': [1920, 1080], 'files': plan(),
                                'authorizationId': nonce, 'attemptId': nonce, 'output': str(root / 'assets/renders' / nonce)}}
        self.ready_path = root / 'readiness.json'
        put(self.ready_path, self.ready)
        review = root / 'review.json'
        put(review, {'verdict': 'PASS', 'scope': 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW', 'source': self.source})
        self.grant = {'purpose': PURPOSE, 'oneUse': True, 'nativeReservesAccepted': True, 'authorizationId': nonce,
                      'readinessSha256': sha(self.ready_path), 'pilot': self.ready['pilot'], 'source': self.source,
                      'assetHead': ASSET_HEAD, 'expiresAt': '2099-01-01T00:00:00+00:00', 'callerReview': {'path': str(review), 'sha256': sha(review)}}
        put(self.paths['grant'], self.grant)
        self.calls = []
        self.fault = None
        self.released = False

    def cleanup(self):
        for name, path in self.paths.items():
            p = Path(path)
            if p.is_dir(): shutil.rmtree(p)
            elif p.exists(): p.unlink()

    def ports(self, ready, result):
        self.calls.append('ports')
        fixture = self
        class Job:
            def __init__(self): self.state = {'exits': {'capture': 0}}
            def start(self):
                fixture.calls.append('launch')
                if fixture.fault == 'capture-deadline': signal.raise_signal(signal.SIGALRM)
                if fixture.fault == 'capture':
                    e = RuntimeError('capture partial')
                    e.unknown = {'kernel': None, 'bytes': b'partial\xff'}
                    raise e
            def wait(self, seconds, observer):
                fixture.calls.append('wait')
                observer()
                writes = packet(Path(ready['pilot']['output']))
                consumed = snapshot(ready['pilot']['consumption'])['value']
                put(Path(ready['pilot']['evidence']) / 'entry.json', {'accepted': False, 'checksPassed': True, 'errors': [],
                    'consumption': consumed, 'source': fixture.source, 'readinessSha256': sha(fixture.ready_path), 'writes': writes})
                return 'completed'
        class Observer:
            def observe(self): pass
            def receipt(self): return {'unrecognized_observation': {'partial': True, 'live': 'UNKNOWN'}}
            def require_browser(self): pass
        class Ports:
            phase = staticmethod(phase)
            def cache_snapshot(self, *args): fixture.calls.append('cache')
            def allocate_tmp(self, evidence): fixture.calls.append('allocate'); return Path(evidence), {'unknown': 'retain'}
            def job_object(self): return Job()
            def initialize(self, *args):
                fixture.calls.append('initialize')
                if fixture.fault == 'constructor': raise RuntimeError('partial constructor')
            def observer(self, job): return Observer()
            def budgets(self, job): pass
            def cleanup(self, job, observer):
                fixture.calls.append('release')
                if fixture.fault == 'cleanup-deadline': signal.raise_signal(signal.SIGALRM)
                if fixture.fault == 'release': raise RuntimeError('release unknown')
                fixture.released = True
                return {'released': True, 'unrecognized_future_field': {'kernel': 'inert'}}
            def no_job_cleanup(self, *args): return {'released': False}
        return Ports()

    def run(self, **kw):
        with patch.object(bindings, 'ROOT', self.root):
            return caller.execute(self.ready_path, enabled=True, authorization=self.ready['pilot']['authorizationId'],
                                  verify_source=lambda _: self.source, ports_factory=self.ports, **kw)


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='effects-pilot-controls-', dir='/private/tmp')
        self.root = Path(self.tmp.name)
        self.f = Fixture(self.root)
    def tearDown(self):
        self.f.cleanup()
        self.tmp.cleanup()

    def test_disabled_actual_entry_has_zero_import_launch_allocation(self):
        with patch.object(caller, 'snapshot', side_effect=AssertionError('read forbidden')):
            r = caller.execute(ports_factory=lambda *_: self.fail('native import'))
        self.assertEqual(r['allocations'], 0)
        self.assertEqual(r['state'], 'DISABLED')
        r = subprocess.run([sys.executable, '-B', str(contract.HERE / 'caller.py')], capture_output=True, timeout=5)
        self.assertEqual(r.returncode, 78)

    def test_missing_reused_mismatched_grants_zero_ports(self):
        grant = Path(self.f.paths['grant'])
        grant.unlink()
        with self.assertRaises(FileNotFoundError): self.f.run()
        put(grant, {**self.f.grant, 'purpose': 'wrong'})
        with self.assertRaises(Refused): self.f.run()
        put(grant, self.f.grant)
        Path(self.f.paths['consumption']).write_text('already consumed')
        with self.assertRaises(Refused): self.f.run()
        self.assertEqual(self.f.calls, [])

    def test_readiness_and_source_bindings_refuse_before_ports(self):
        for name, bad in [('runtimeEnabled', False), ('budget', {})]:
            put(self.f.ready_path, {**self.f.ready, name: bad})
            with self.assertRaises(Refused): self.f.run()
        put(self.f.ready_path, self.f.ready)
        self.f.source = {**self.f.source, 'head': 'c' * 40}
        with self.assertRaises(Refused): self.f.run()
        self.assertEqual(self.f.calls, [])

    def test_actual_clean_git_rejects_first_completed_output_for_any_successor(self):
        subprocess.run(['/usr/bin/git', 'init', '-q', '-b', 'task/P1-E07-T14-effects', str(self.root)], check=True)
        subprocess.run(['/usr/bin/git', '-C', str(self.root), 'add', '.'], check=True)
        subprocess.run(['/usr/bin/git', '-C', str(self.root), '-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', 'commit', '-qm', 'inert source'], check=True)
        head = bindings.git(self.root, 'rev-parse', 'HEAD')
        with patch.object(bindings, 'ROOT', self.root), patch.object(bindings, 'ASSET_HEAD', head):
            self.assertTrue(bindings.source(self.f.ready)['clean'])
            (self.root / 'assets/renders/completed-pilot.json').write_text('{"checksPassed":true}')
            with self.assertRaisesRegex(Refused, 'Strict clean'): bindings.source(self.f.ready)

    def test_positive_release_precedes_real_full_decoder_and_parent_exit(self):
        import inspect_packet as module
        def checked(*args):
            self.assertTrue(self.f.released)
            self.f.calls.append('decode')
            return inspect_packet(*args)
        with patch.object(module, 'inspect_packet', checked), patch.object(caller.shutil, 'disk_usage', return_value=SimpleNamespace(free=ledger()['admissionBytes'])):
            r = self.f.run()
        self.assertTrue(r['accepted'], r['errors'])
        self.assertLess(self.f.calls.index('release'), self.f.calls.index('decode'))
        result, consumed = Path(self.f.paths['evidence']) / 'result.json', Path(self.f.paths['consumption'])
        kw = {'result_sha256': sha(result), 'consumption_sha256': sha(consumed)}
        for exit_code in (None, 1, False):
            with self.assertRaises(Refused): caller.parent_acceptance(result, consumed, observed_os_exit=exit_code, **kw)
        self.assertTrue(caller.parent_acceptance(result, consumed, observed_os_exit=0, **kw)['accepted'])
        self.assertFalse(snapshot(result)['value']['accepted'])

    def test_failed_release_skips_decoder_and_preserves_unknowns(self):
        self.f.fault = 'release'
        with patch('inspect_packet.inspect_packet', side_effect=AssertionError('decoder forbidden')):
            result = self.f.run()
        self.assertFalse(result['accepted'])
        self.assertIn('unrecognized_observation', result['raw']['executionPartial'])

    def test_partial_constructor_counted_and_exception_attributes_preserved(self):
        self.f.fault = 'constructor'
        r = self.f.run()
        self.assertEqual(len(r['jobs']), 1)
        self.assertFalse(r['jobs'][0]['initialized'])
        self.assertIn('release', self.f.calls)
        e = subprocess.TimeoutExpired(['inert'], 1, output=b'partial', stderr=b'error')
        e.unknown = {'kernel': None}
        f = failure(e)
        self.assertEqual(f['attributes']['stdout'], f['attributes']['output'])
        self.assertEqual(f['attributes']['unknown'], {'kernel': None})

    def test_late_final_write_combined_fallback_no_durable_success(self):
        def writer(path, data):
            Receipts.exclusive(path, data)
            if Path(path).name == 'result.json': raise OSError('late close')
        result = self.f.run(sink=Receipts(writer))
        self.assertFalse(result['accepted'])
        self.assertFalse(snapshot(Path(self.f.paths['evidence']) / 'result.json')['value']['accepted'])
        self.assertTrue(snapshot(Path(self.f.paths['evidence']) / 'result.json')['value']['checksPassed'])
        self.assertFalse(result['checksPassed'])
        self.assertTrue(result['failurePacketWritten'])

    def test_actual_capture_exception_keeps_unknown_partial_facts(self):
        self.f.fault = 'capture'
        result = self.f.run()
        self.assertIn('unknown', result['errors'][0]['attributes'])
        self.assertEqual(result['errors'][0]['attributes']['unknown']['kernel'], None)
        self.assertIn('release', self.f.calls)

    def test_actual_source_byte_verifier_refuses_changed_binding_before_ports(self):
        file = self.root / 'bound-source.py'; file.write_text('before')
        r = {**self.f.ready, 'python': str(Path(sys.executable).resolve()), 'path': os.environ['PATH'],
             'bindings': [bindings.file_binding(file)]}
        file.write_text('changed bytes')
        put(self.f.ready_path, r)
        with patch.object(bindings, 'ROOT', self.root), self.assertRaisesRegex(Refused, 'bytes drift'):
            caller.execute(self.f.ready_path, enabled=True, authorization=r['pilot']['authorizationId'],
                           verify_source=bindings.verify, ports_factory=self.f.ports)
        self.assertEqual(self.f.calls, [])

    def test_all_sinks_failed_preserves_in_memory_primary_and_secondary(self):
        result = {'checksPassed': True, 'errors': [{'phase': 'primary', 'unknown': {'live': None}}]}
        def denied(*_): raise OSError('all sinks denied')
        r = publish(result, self.root, self.root, Receipts(denied), denied)
        self.assertFalse(r['accepted']); self.assertFalse(r['durable'])
        self.assertEqual(len(r['errors']), 4)
        self.assertEqual(r['errors'][0]['unknown'], {'live': None})

    def test_real_sigalrm_unwinds_before_archive_and_preserves_partial_probe(self):
        probes = []
        def blocked():
            e = {'unknown': {'kernel': 'partial'}}
            probes.append(e)
            signal.raise_signal(signal.SIGALRM)
        before = signal.getsignal(signal.SIGALRM)
        observations = []
        with self.assertRaises(PhaseExpired):
            with phase(1):
                observe_call(observations, 'deadline', blocked)
                probes.append('ARCHIVE_WITHOUT_TIMER')
        self.assertEqual(probes, [{'unknown': {'kernel': 'partial'}}])
        self.assertEqual(observations[0]['failure']['type'], 'PhaseExpired')
        self.assertEqual(signal.getsignal(signal.SIGALRM), before)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_real_sigalrm_through_actual_caller_retains_consumption_and_runs_cleanup(self):
        self.f.fault = 'capture-deadline'
        with patch('inspect_packet.inspect_packet', side_effect=AssertionError('decoder forbidden')): r = self.f.run()
        self.assertEqual(r['errors'][0]['type'], 'PhaseExpired')
        self.assertIn('release', self.f.calls)
        self.assertTrue(Path(self.f.paths['consumption']).exists())
        self.assertFalse(r['accepted'])

    def test_real_sigalrm_cleanup_never_dispatches_validator(self):
        self.f.fault = 'cleanup-deadline'
        with patch('inspect_packet.inspect_packet', side_effect=AssertionError('decoder forbidden')): r = self.f.run()
        self.assertEqual(r['errors'][0]['phase'], 'cleanup')
        self.assertEqual(r['errors'][0]['type'], 'PhaseExpired')
        self.assertIsNone(r['release'])

    def test_finite_cache_copy_includes_cap_and_retains_failed_partial(self):
        import native_ports
        cache = self.root / 'cache'; cache.mkdir(); (cache / 'a').write_bytes(b'abc')
        ready, observations = {'generatedCaches': [str(cache)]}, []
        with patch.object(native_ports, 'CACHE_CAP', 3):
            self.assertEqual(snapshot_caches(ready, self.root / 'snapshot', observations), 3)
            (cache / 'b').write_bytes(b'x')
            with self.assertRaises(Refused): snapshot_caches(ready, self.root / 'excess', [])
        self.assertEqual((self.root / 'snapshot/0/a').read_bytes(), b'abc')
        self.assertTrue((cache / 'a').exists())

    def test_parent_observes_real_inert_child_os_exit_and_exact_receipt_hashes(self):
        child_root = self.root / 'child'; child_root.mkdir()
        run = subprocess.run([sys.executable, '-B', str(contract.HERE / 'controls.py'), '--inert-child', str(child_root)], capture_output=True, text=True, timeout=15)
        self.assertEqual(run.returncode, 0, run.stderr)
        identity = json.loads(run.stdout)
        try:
            r, c = Path(identity['result']), Path(identity['consumption'])
            accepted = caller.parent_acceptance(r, c, observed_os_exit=run.returncode, result_sha256=snapshot(r)['sha256'], consumption_sha256=snapshot(c)['sha256'])
            self.assertTrue(accepted['accepted'])
        finally:
            for key, name in identity.items():
                if key == 'result': continue
                p = Path(name)
                if p.is_dir(): shutil.rmtree(p)
                elif p.exists(): p.unlink()

    def test_actual_helper_terminal_assertion_retains_unknown_partial_observations(self):
        path = contract.ROOT / 'assets/blend/stations/_authoring/run_round4_remaining8.py'
        node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'terminal_audit')
        namespace = {'kernel_tasks': lambda _: {'live': 1, 'unknown_native_field': {'partial': None}}}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
        job = SimpleNamespace(state={'drained': True, 'clean': True}, coalition_id=7)
        records = []
        with self.assertRaises(AssertionError): observe_call(records, 'terminal', namespace['terminal_audit'], job, '/inert', [])
        self.assertEqual(records[0]['observations'][0]['returned']['unknown_native_field'], {'partial': None})

    def test_actual_station_drain_cannot_swallow_outer_sigalrm_into_archive(self):
        path = contract.ROOT / 'assets/blend/stations/_authoring/round4_job_boundary.py'
        tree = ast.parse(path.read_text())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'StationJob')
        drain = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'drain')
        class HelperExpired(BaseException): pass
        namespace = {'deadline': phase, 'DeadlineExpired': HelperExpired, 'time': time}
        exec(compile(ast.Module(body=[drain], type_ignores=[]), str(path), 'exec'), namespace)
        archived = []
        job = SimpleNamespace(root={'pid': 1}, coalition_id=1, state={}, known={}, members=lambda: [])
        job.drain = MethodType(namespace['drain'], job)
        job.archive = lambda **_: archived.append('forbidden')
        def interrupted(): signal.raise_signal(signal.SIGALRM)
        ports = NativePorts.__new__(NativePorts)
        ports.result = {'raw': {}}
        with self.assertRaises(PhaseExpired):
            with phase(1): ports.cleanup(job, SimpleNamespace(observe=interrupted))
        self.assertEqual(archived, [])
        self.assertEqual(ports.result['raw']['cleanup'][0]['failure']['type'], 'PhaseExpired')

    def test_original_helper_deadline_catch_restores_outer_timer_and_refuses_archive(self):
        path = contract.ROOT / 'assets/blend/stations/_authoring/round4_job_boundary.py'
        tree = ast.parse(path.read_text())
        deadline = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'deadline')
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'StationJob')
        drain = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'drain')
        class HelperExpired(BaseException): pass
        namespace = {'DeadlineExpired': HelperExpired, 'time': time, 'signal': signal, 'contextmanager': contextlib.contextmanager}
        exec(compile(ast.Module(body=[deadline, drain], type_ignores=[]), str(path), 'exec'), namespace)
        archived = []
        job = SimpleNamespace(root={'pid': 1}, coalition_id=1, state={'errors': [], 'drained': False}, known={}, members=lambda: [], save=lambda: None)
        job.drain = MethodType(namespace['drain'], job)
        job.archive = lambda **_: archived.append('forbidden')
        def interrupted(): signal.raise_signal(signal.SIGALRM)
        ports = NativePorts.__new__(NativePorts); ports.result = {'raw': {}}
        with phase(2):
            with self.assertRaises(Refused): ports.cleanup(job, SimpleNamespace(observe=interrupted))
            self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0], 0)
        self.assertEqual(archived, [])
        self.assertIn('cleanup phase deadline expired; release unproved', ports.result['raw']['cleanup'][0]['returned']['errors'])

    def test_exact_budget_edges_and_failed_attempt_charged(self):
        self.assertEqual(ledger()['outputCapBytes'], 184565760)
        self.assertEqual(ledger()['admissionBytes'], 5402312704)
        def denied(*_): raise OSError('partial')
        sink = Receipts(denied)
        with self.assertRaises(OSError): sink.write(self.root / 'inert.json', {'a': 1})
        self.assertGreater(sink.charged, 0)
        sink.charged = contract.METADATA_PER_PROCESS
        with self.assertRaises(Refused): sink.write(self.root / 'inert.json', {})
        usage = SimpleNamespace(free=ledger()['admissionBytes'] - 1)
        with patch.object(caller.shutil, 'disk_usage', return_value=usage), self.assertRaises(Refused): self.f.run()
        self.assertEqual(self.f.calls, [])

    def test_png_full_decode_all_filters_crc_and_truncation(self):
        file = self.root / 'filters.png'
        file.write_bytes(image(9, 10, (0, 1, 2, 3, 4)))
        decoded = png(file, [9, 10])
        self.assertEqual(decoded['filters'], [0, 1, 2, 3, 4])
        self.assertEqual(decoded['pixelsSha256'], hashlib.sha256(bytes([7, 11, 19]) * 90).hexdigest())
        original = file.read_bytes()
        for data in (original[:-1], original + b'extra', original[:30] + b'BAD' + original[33:]):
            file.write_bytes(data)
            with self.assertRaises((Refused, ValueError)): png(file, [9, 10])

    def test_wrong_inventory_perf_material_texture_lod_facts(self):
        root = Path(self.f.ready['pilot']['output']); root.mkdir()
        writes = packet(root)
        (root / 'unexpected.txt').write_text('extra')
        with self.assertRaises(Refused): inspect_packet(self.f.ready, writes)
        for mutate in [lambda v: v['stats'].update(shown=2), lambda v: v['stats'].update(lods=[0, 2]),
                       lambda v: v['stats'].update(materials=['generic_glow']), lambda v: v['stats']['textures']['shown'].update(compressed=0),
                       lambda v: v['far'][0].update(shown=None), lambda v: v.update(viewport=[2520, 1080]), lambda v: v.update(errors=['error'])]:
            value = actual_shape(); mutate(value)
            with self.assertRaises(Refused): perf(value, 'LIB_FX_Gravitic', 576)

    def test_hash_parse_same_snapshot_under_actual_file_replacement(self):
        path = self.root / 'raced.json'; replacement = self.root / 'replacement.json'
        put(path, {'checksPassed': False, 'unknown': {'retained': True}})
        expected = sha(path)
        put(replacement, {'checksPassed': True})
        original_fdopen = contract.os.fdopen
        reads = []
        class Stream:
            def __init__(self, inner): self.inner = inner
            def __enter__(self): return self
            def __exit__(self, *args): return self.inner.__exit__(*args)
            def fileno(self): return self.inner.fileno()
            def read(self, count):
                value = self.inner.read(count); reads.append((count, len(value)))
                os.replace(replacement, path)
                return value
        with patch.object(contract.os, 'fdopen', side_effect=lambda *a, **k: Stream(original_fdopen(*a, **k))):
            bound = snapshot(path)
        self.assertEqual(bound['sha256'], expected)
        self.assertFalse(bound['value']['checksPassed'])
        self.assertTrue(snapshot(path)['value']['checksPassed'])
        self.assertEqual(len(reads), 1)
        self.assertLessEqual(reads[0][0], 2 * 1024 ** 2 + 1)

    def test_actual_parent_gate_rejects_hash_bound_failed_result_or_consumption_during_swap(self):
        self.assertTrue(self.f.run()['accepted'])
        result_path = Path(self.f.paths['evidence']) / 'result.json'
        consumed_path = Path(self.f.paths['consumption'])
        original_result, original_consumed = snapshot(result_path)['value'], snapshot(consumed_path)['value']
        for target, bad, good in [(result_path, {**original_result, 'checksPassed': False}, original_result),
                                  (consumed_path, {**original_consumed, 'state': 'FAILED'}, original_consumed)]:
            put(result_path, original_result); put(consumed_path, original_consumed)
            replacement = self.root / 'replacement-success.json'; put(replacement, good); put(target, bad)
            hashes = {'result_sha256': snapshot(result_path)['sha256'], 'consumption_sha256': snapshot(consumed_path)['sha256']}
            actual = caller.snapshot
            def swapped(path, *args):
                value = actual(path, *args)
                if Path(path) == target: os.replace(replacement, target)
                return value
            with patch.object(caller, 'snapshot', swapped), self.assertRaises(Refused):
                caller.parent_acceptance(result_path, consumed_path, observed_os_exit=0, **hashes)

    def test_oversized_receipt_refused_before_any_read_symlink_fifo_duplicate(self):
        path = self.root / 'oversized.json'
        with path.open('wb') as f: f.truncate(8 * 1024 ** 2)
        original_fdopen, reads = contract.os.fdopen, []
        class Stream:
            def __init__(self, inner): self.inner = inner
            def __enter__(self): return self
            def __exit__(self, *args): return self.inner.__exit__(*args)
            def fileno(self): return self.inner.fileno()
            def read(self, count): reads.append(count); return self.inner.read(count)
        with patch.object(contract.os, 'fdopen', side_effect=lambda *a, **k: Stream(original_fdopen(*a, **k))):
            with self.assertRaises(Refused): snapshot(path)
        self.assertEqual(reads, [])
        link = self.root / 'link'; link.symlink_to(path)
        with self.assertRaises(OSError): snapshot(link)
        fifo = self.root / 'fifo'; os.mkfifo(fifo)
        with self.assertRaises(Refused): snapshot(fifo)
        path.write_text('{"ok":false,"ok":true}')
        with self.assertRaises(Refused): snapshot(path)

    def test_bound_failed_review_cannot_be_replaced_with_success_for_admission(self):
        review = Path(self.f.grant['callerReview']['path']); replacement = self.root / 'review-success.json'
        put(replacement, snapshot(review)['value'])
        put(review, {'verdict': 'FAIL', 'source': self.f.source, 'scope': 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW'})
        self.f.grant['callerReview']['sha256'] = sha(review); put(self.f.paths['grant'], self.f.grant)
        original = bindings.snapshot
        def snap(path, *args):
            result = original(path, *args)
            if Path(path) == review: os.replace(replacement, review)
            return result
        with patch.object(bindings, 'snapshot', snap), self.assertRaises(Refused): self.f.run()
        self.assertEqual(self.f.calls, [])


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--inert-child':
        f = Fixture(Path(sys.argv[2]))
        result = f.run()
        print(json.dumps({**f.paths, 'result': str(Path(f.paths['evidence']) / 'result.json')}))
        raise SystemExit(0 if result['accepted'] else 1)
    unittest.main(verbosity=2)
