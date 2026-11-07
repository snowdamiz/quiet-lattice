"""R2 actual wait/save, cache descriptor races and complete PNG packets. Inert CPU controls only."""
import sys
sys.dont_write_bytecode = True
import ast
import contextlib
import hashlib
import json
import os
from pathlib import Path
import plistlib
import signal
import stat
import struct
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid
import zlib

import bindings
import cache_io
import caller
import contract
import controls
import evidence
import native_ports
from boundary_controls import inert_clear


def extract(name, names, namespace):
    path = contract.ROOT / 'assets/blend/stations/_authoring' / name
    namespace['__file__'] = str(path)
    nodes = [n for n in ast.parse(path.read_text()).body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace


def chunk(tag, body):
    return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)


class RevisionControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='effects-r2-faults-', dir='/private/tmp')
        self.root = Path(self.temp.name)
        self.fixtures = []

    def tearDown(self):
        for f in self.fixtures:
            f.cleanup()
        self.temp.cleanup()

    def fixture(self, name):
        root = self.root / name; root.mkdir()
        f = controls.Fixture(root); self.fixtures.append(f)
        return f

    def observer_case(self, kind, receipt_fail=False, deadline=False, sinks_fail=False):
        f = self.fixture(f'{kind}-{receipt_fail}-{deadline}-{sinks_fail}')
        root, calls, state = f.root, [], {'observed': False}
        primary = OSError(5, 'PRIMARY_RESOURCE_LSTAT')
        primary.partial = b'\0\xffORIGINAL'
        primary.unknown = {'live': None, 'allocation': str(root / 'private-tmp')}
        def fault():
            state['observed'] = True
            if deadline:
                signal.raise_signal(signal.SIGALRM)
            raise primary
        def writer(path, value):
            calls.append('write:' + Path(path).name)
            if state['observed'] and receipt_fail and Path(path).name == 'boundary.json':
                raise OSError(28, 'SECONDARY_HELPER_SAVE')
            controls.put(path, value)
        ns = extract('round4_job_boundary.py', ['StationJob', 'deadline', 'DeadlineExpired'], {
            'Path': Path, 'tempfile': SimpleNamespace(mkdtemp=lambda **kw: tempfile.mkdtemp(prefix=kw['prefix'], dir=root)),
            'os': os, 'uuid': uuid, 'sys': sys, 'plistlib': plistlib, 'write': writer, 'json': json,
            'signal': signal, 'time': time, 'contextmanager': contextlib.contextmanager})
        def factory(ready, result):
            ready.update(path=os.environ['PATH'], node='/inert/node', initialCacheBytes=0,
                         resolver={'selectedExecutable': {'path': '/inert/browser'}})
            port = native_ports.NativePorts.__new__(native_ports.NativePorts)
            port.ready, port.result, port.tmp = ready, result, root / 'private-tmp'; port.tmp.mkdir()
            (port.tmp / 'evidence-resource').write_bytes(b'x')
            port.boundary = SimpleNamespace(StationJob=ns['StationJob'])
            port.allocate_tmp = lambda _: (port.tmp, {'inert': True})
            port.start = lambda _: calls.append('inert-start')
            init = port.initialize
            def initialize(job, *args):
                init(job, *args)
                job.status = lambda: {'exits': {}}
                job.members = lambda: []
            port.initialize = initialize
            if kind == 'stage':
                stage = extract('run_round4_remaining8.py', ['StageReceipts'], {
                    'Path': Path, 'time': time, 'parse_launch': lambda *a: fault(), 'utc': lambda: 'INERT', 'failure': evidence.failure})
                port.stages = SimpleNamespace(StageReceipts=stage['StageReceipts'])
            else:
                port.observer = lambda _: SimpleNamespace(observe=lambda: None, receipt=lambda: {'inert': True}, require_browser=lambda: None)
            return port
        lstat = Path.lstat
        def resource(path, *args, **kw):
            if path == root / 'private-tmp/evidence-resource':
                fault()
            return lstat(path, *args, **kw)
        def sink(path, data):
            if sinks_fail and Path(path).name in ('terminal.json', 'result.json', 'failed-result.json'):
                raise OSError(28, 'SECONDARY_PUBLICATION')
            evidence.Receipts.exclusive(path, data)
        def stderr(data):
            if sinks_fail:
                raise OSError(28, 'SECONDARY_STDERR')
        with patch.object(bindings, 'ROOT', root), patch.object(Path, 'lstat', resource):
            result = caller.execute(f.ready_path, enabled=True, authorization=f.ready['pilot']['authorizationId'],
                                    verify_source=lambda _: f.source, ports_factory=factory, cache_guard=inert_clear,
                                    sink=evidence.Receipts(sink), stderr=stderr)
        self.assertTrue(state['observed']); self.assertFalse(result['accepted'])
        self.assertIsNone(result['release']); self.assertNotIn('inspection', result)
        first = result['errors'][0]
        self.assertEqual(first['phase'], 'capture-observer'); self.assertEqual(first['operation'], kind)
        if deadline:
            self.assertEqual(first['type'], 'DeadlineExpired')
            # BaseException unwinds actual wait before its normalizing receipt path.
            self.assertFalse(any(e['message'] == '[Errno 28] SECONDARY_HELPER_SAVE' for e in result['errors']))
        else:
            self.assertEqual({k:v for k,v in first.items() if k not in ('phase','operation')}, evidence.failure(primary))
            if receipt_fail:
                self.assertEqual(result['errors'][1]['message'], '[Errno 28] SECONDARY_HELPER_SAVE')
            else:
                self.assertEqual(result['raw']['wait'], 'observer_failed')
            if kind == 'writers':
                observed = result['raw']['writerObservationFailures'][0]
                self.assertFalse(observed['complete']); self.assertIsNone(observed['free'])
                self.assertEqual(observed['probes'][0]['failure'], evidence.failure(primary))
        self.assertNotIn('Capture did not complete normally', json.dumps(result))
        self.assertEqual(calls.count('inert-start'), 1)
        if sinks_fail:
            self.assertFalse(result['durable']); self.assertEqual(result['errors'][-1]['phase'], 'stderr-fallback-write')
        else:
            durable = contract.snapshot(Path(f.paths['evidence']) / 'result.json')['value']
            self.assertEqual(durable['errors'][0], first)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))

    def test_actual_wait_save_resource_and_stage_primary_precedence(self):
        for kind in ('writers', 'stage'):
            for receipt_fail in (False, True):
                with self.subTest(kind=kind, receipt_fail=receipt_fail):
                    self.observer_case(kind, receipt_fail)

    def test_actual_wait_deadline_and_all_publication_sinks(self):
        for kind in ('writers', 'stage'):
            for deadline in (False, True):
                with self.subTest(kind=kind, deadline=deadline):
                    self.observer_case(kind, True, deadline, True)

    def cache_case(self, mode, stage='sourceVerification', component='leaf'):
        f = self.fixture(f'{mode}-{stage}-{component}')
        cache = f.root / 'cache'; cache.mkdir(); nested = cache / 'inner'; nested.mkdir()
        source = nested / 'data.bin'; source.write_bytes(b'x')
        outside = f.root / 'outside'; outside.mkdir(); (outside / 'data.bin').write_bytes(b'x')
        real_open, real_read, actual_reader = os.open, os.read, cache_io.read_cache
        active, triggered, reads = [], [], []
        known_fds = set()
        def reader(path, cap, expected, ancestors, record, write=None):
            phase = 'copyRead' if write else 'copyVerification' if str(path).startswith(f.paths['evidence']) else 'sourceVerification'
            active.append(phase)
            try: return actual_reader(path, cap, expected, ancestors, record, write)
            finally: active.pop()
        def opened(path, flags, *args, **kw):
            target = 'data.bin' if component == 'leaf' else 'inner'
            if active == [stage] and str(path) == target and not triggered:
                triggered.append({'flags': flags, 'timer': signal.getitimer(signal.ITIMER_REAL)})
                p = Path(f.paths['evidence']) / 'cache-before/0/inner/data.bin' if stage == 'copyVerification' else source
                if component == 'ancestor':
                    p.parent.rename(p.parent.with_name('retained-inner')); p.parent.symlink_to(outside, target_is_directory=True)
                elif mode == 'symlink':
                    p.unlink(); p.symlink_to(outside / 'data.bin')
                elif mode == 'fifo':
                    p.unlink(); os.mkfifo(p)
                elif mode == 'replace':
                    p.rename(p.with_name('retained-data')); p.write_bytes(b'x')
                elif mode == 'growth':
                    with p.open('ab') as stream: stream.truncate(contract.CACHE_CAP + 1)
            fd = real_open(path, flags, *args, **kw)
            if active == [stage] and str(path) == 'data.bin': known_fds.add(fd)
            return fd
        def read(fd, n):
            data = real_read(fd, n)
            if active == [stage] and fd in known_fds: reads.append({'requested': n, 'returned': len(data)})
            return data
        original_ports = f.ports
        def ports(ready, result):
            p = original_ports(ready, result); p.cache_snapshot = native_ports.snapshot_caches; return p
        with patch.object(bindings, 'ROOT', f.root), patch.object(cache_io, 'read_cache', reader), patch.object(os, 'open', opened), patch.object(os, 'read', read):
            result = caller.execute(f.ready_path, enabled=True, authorization=f.ready['pilot']['authorizationId'], verify_source=lambda _: f.source,
                                    ports_factory=ports, cache_guard=inert_clear, stderr=lambda _: None)
        self.assertEqual(len(triggered), 1); self.assertFalse(result['accepted']); self.assertNotIn('launch', f.calls)
        self.assertTrue(Path(f.paths['consumption']).exists()); self.assertIsNone(result['release'])
        self.assertEqual(sum(r['returned'] for r in reads), 0)  # Refuse at actual acquisition, before reading/hash.
        if component == 'leaf':
            self.assertTrue(triggered[0]['flags'] & os.O_NONBLOCK); self.assertTrue(triggered[0]['flags'] & os.O_NOFOLLOW)
        self.assertNotEqual(result['errors'][0]['type'], 'PhaseExpired')
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))
        record = result['raw']['cacheSnapshot'][0]
        self.assertFalse(record['complete']); self.assertIn('failure', record)
        if stage != 'copyRead':
            self.assertEqual(record['files'][0]['writtenBytes'], 1)
            self.assertFalse(record['files'][0]['complete'])

    def test_actual_copy_and_both_hash_acquisitions_refuse_leaf_replacement(self):
        for stage in ('copyRead', 'sourceVerification', 'copyVerification'):
            for mode in ('symlink', 'fifo', 'replace', 'growth'):
                with self.subTest(stage=stage, mode=mode): self.cache_case(mode, stage)

    def test_actual_copy_and_both_hash_acquisitions_refuse_ancestor_links(self):
        for stage in ('copyRead', 'sourceVerification', 'copyVerification'):
            with self.subTest(stage=stage): self.cache_case('symlink', stage, 'ancestor')

    def test_all_ancestor_components_are_opened_without_following_links(self):
        source = self.root / 'parent'; source.mkdir(); nested = source / 'nested'; nested.mkdir(); leaf = nested / 'file'; leaf.write_bytes(b'abc')
        info = cache_io.stamp(leaf.stat())
        parent = self.root / 'alias'; parent.symlink_to(source, target_is_directory=True)
        for path in (parent / 'nested/file', self.root / 'parent/nested/file'):
            if 'alias' not in path.parts:
                nested.rename(source / 'kept'); nested.symlink_to(source / 'kept', target_is_directory=True)
            observations = {}
            with self.assertRaises(OSError): cache_io.read_cache(path, 3, info, None, observations)
            self.assertEqual(observations['bytesRead'], 0)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))

    def test_actual_post_admission_growth_reads_at_most_admitted_plus_one(self):
        p = self.root / 'leaf'; p.write_bytes(b'x'); expected = cache_io.stamp(p.stat()); before = expected.copy(); reads=[]
        original_read=os.read
        def read(fd, size):
            if not reads:
                with p.open('ab') as s: s.truncate(contract.CACHE_CAP + 1)
            data=original_read(fd,size); reads.append((size,len(data))); return data
        record={}
        with patch.object(os,'read',read), self.assertRaises(contract.Refused):
            cache_io.read_cache(p,1,expected,None,record)
        self.assertEqual(sum(n for _,n in reads),2); self.assertEqual(record['before'],before)
        self.assertEqual(record['bytesRead'],2); self.assertFalse(record['complete'])

    def test_initial_cap_and_type_admission_precedes_any_payload_read(self):
        p=self.root/'leaf'
        with p.open('wb') as stream: stream.truncate(contract.CACHE_CAP+1)
        with patch.object(os,'read',side_effect=AssertionError('NO_PAYLOAD_READ')):
            with self.assertRaises(contract.Refused): cache_io.read_cache(p,contract.CACHE_CAP,cache_io.stamp(p.stat()),None,{})
        p.unlink();os.mkfifo(p)
        with patch.object(os,'read',side_effect=AssertionError('NO_PAYLOAD_READ')):
            with self.assertRaises(contract.Refused): cache_io.read_cache(p,1,None,None,{})
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.,0.))

    def png_case(self, mode, accepted, color=2):
        f=self.fixture(mode+str(color)); original=controls.packet
        def packet(root):
            writes=original(root); p=root/writes[0]['path']; data=p.read_bytes(); hdr=data[:33]; body=data[41:-16]; end=chunk(b'IEND',b'')
            if color==6:
                hdr=data[:8]+chunk(b'IHDR',struct.pack('>IIBBBBB',1920,1080,8,6,0,0,0))
                body=zlib.compress((b'\0'+bytes([7,11,19,127])*1920)*1080)
            palette=chunk(b'PLTE',bytes([7,11,19]))
            variants={
                'duplicate':palette+palette+chunk(b'IDAT',body),
                'empty':chunk(b'PLTE',b'')+chunk(b'IDAT',body),
                'after-empty-IDAT':chunk(b'IDAT',b'')+palette+chunk(b'IDAT',body),
                'after-data':chunk(b'IDAT',body)+palette,
                'noncontiguous-empty-IDAT':chunk(b'IDAT',b'')+chunk(b'tEXt',b'Key\0text')+chunk(b'IDAT',body),
                'too-many':chunk(b'PLTE',bytes(771))+chunk(b'IDAT',body),
                'partial-entry':chunk(b'PLTE',b'ab')+chunk(b'IDAT',body),
                'valid':palette+chunk(b'IDAT',b'')+chunk(b'IDAT',body[:2])+chunk(b'IDAT',b'')+chunk(b'IDAT',body[2:])+chunk(b'IDAT',b''),
                'valid-max':chunk(b'PLTE',bytes(768))+chunk(b'IDAT',body),
            }
            mutated=hdr+variants[mode]+end; p.write_bytes(mutated); writes[0].update(bytes=len(mutated),sha256=hashlib.sha256(mutated).hexdigest());return writes
        with patch.object(controls,'packet',packet): result=f.run(cache_guard=inert_clear)
        self.assertTrue(f.released); self.assertEqual(result['accepted'],accepted, result['errors'])
        if accepted:
            self.assertEqual(len(result['inspection']['decodedPngs']),11)
            self.assertEqual(result['inspection']['decodedPngs'][0]['channels'],3 if color==2 else 4)
        else:
            self.assertEqual(result['errors'][0]['phase'],'released-cpu-decode'); self.assertNotIn('inspection',result)

    def test_malformed_palettes_and_empty_IDAT_ordering_at_complete_caller(self):
        for mode in ('duplicate','empty','after-empty-IDAT','after-data','noncontiguous-empty-IDAT','too-many','partial-entry'):
            with self.subTest(mode=mode): self.png_case(mode,False)

    def test_valid_RGB_RGBA_palettes_and_contiguous_empty_IDAT(self):
        for color in (2,6):
            for mode in ('valid','valid-max'):
                with self.subTest(color=color,mode=mode): self.png_case(mode,True,color)


if __name__ == '__main__':
    unittest.main(verbosity=2)
