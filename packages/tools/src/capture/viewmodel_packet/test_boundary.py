"""Real files/Git/process exits with inert capture and decoder ports only."""
import copy
import hashlib
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

import boundary
import bindings
import caller

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


HARNESS = r'''
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import caller
caller.HERE = Path(sys.argv[2])
def capture(ready, spec, paths, record):
    for name in spec['files']:
        (Path(paths['output']) / name).write_text('INERT BOUNDARY FIXTURE '+name)
    record['ports'] = ['capture', 'release']
    return {'released': True}
def decoder(ready, spec, paths, record, frozen):
    assert record['released']
    record['ports'].append('decode')
    record['inspection'] = {'valid': True, 'inert': True}
def cache(ready, evidence, record): record['initialCacheBytes'] = 0
def runner(*args): return caller.run_unit(*args, capture=capture, decoder=decoder, cache_copy=cache, final_verify=lambda _: {})
code, result = caller.main(Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]), enabled=True, verifier=lambda _: {}, runner=runner)
print(json.dumps({'code': code, 'durable': result['durable']}))
raise SystemExit(code)
'''


class Repo:
    def __init__(self, base):
        self.root = base / 'repo'; self.root.mkdir()
        self.packet = self.root / 'packet'; self.packet.mkdir()
        self.plan = caller.plan(); self.plan['runtimeEnabled'] = self.plan['entryEnabled'] = True
        (self.packet / 'inventory.json').write_text(json.dumps(self.plan))
        (self.root / 'source').write_text('frozen')
        (self.root / '.gitignore').write_text('*.ignored\n')
        for args in [('init', '-q'), ('add', '.'), ('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'source')]:
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        self.head = boundary.git(self.root, 'rev-parse', 'HEAD').decode().strip()
        self.ready_path = base / 'ready.json'
        self.ready = {'runtimeEnabled': True, 'entryEnabled': True, 'inventorySha256': digest(self.packet / 'inventory.json'),
            'paths': {}, 'containers': {'output': str(self.root / 'renders'), 'evidence': str(base / 'evidence')}, 'bindings': {'root': str(self.root), 'branch': boundary.git(self.root, 'branch', '--show-current').decode().strip(),
            'ignoredInventorySha256': hashlib.sha256(b'').hexdigest(), 'generatedCaches': []}}
        for spec in self.plan['units']:
            unit = spec['id']
            self.ready['paths'][unit] = {'ready': str(self.ready_path), 'grant': str(base / (unit + '.grant.json')),
                'consumption': str(base / (unit + '.consumed.json')), 'evidence': str(base / 'evidence' / unit),
                'output': str(self.root / 'renders' / unit)}
        self.ready_path.write_text(json.dumps(self.ready))
        self.previous = []
        self.harness = base / 'child.py'; self.harness.write_text(HARNESS)

    def grant(self, index):
        spec = self.plan['units'][index]; p = self.ready['paths'][spec['id']]
        grant = {'purpose': 'P1-E05-T03-ONE-NATIVE-UNIT', 'enabled': True, 'authorizationId': f'inert-grant-{index:016}',
                 'unit': spec['id'], 'authorizedHead': self.head, 'readySha256': digest(self.ready_path), 'previous': copy.deepcopy(self.previous)}
        Path(p['grant']).write_text(json.dumps(grant))
        return spec, p, grant

    def run(self, index):
        spec, p, grant = self.grant(index)
        result = subprocess.run([sys.executable, '-B', str(self.harness), str(HERE), str(self.packet), str(self.ready_path), spec['id'], p['grant']], capture_output=True, timeout=15)
        if result.returncode == 0:
            self.previous.append({'unit': spec['id'], 'callerExit': result.returncode,
                                  'resultSha256': digest(Path(p['evidence']) / 'result.json'), 'consumptionSha256': digest(p['consumption'])})
        return result

    def admit(self, index, grant=None):
        spec, p, _ = self.grant(index) if grant is None else grant
        with patch.object(caller, 'HERE', self.packet):
            return caller.admit(self.ready_path, spec['id'], Path(p['grant']), enabled=True, verifier=lambda _: {})


class BoundaryTests(unittest.TestCase):
    def test_exact_inventory_and_budget(self):
        p = caller.plan()
        self.assertEqual([s['admission'] for s in p['units']], [5402312704] * 3 + [5754683392, 5855346688, 5855346688, 4999659520])
        for mutation in ('cap', 'bool', 'duplicate', 'count'):
            bad = copy.deepcopy(p)
            if mutation == 'cap': bad['units'][0]['admission'] -= 1
            elif mutation == 'bool': bad['reserves']['metadata'] = True
            elif mutation == 'duplicate': bad['units'][0]['files'][0] = 'sheet.png'
            else: bad['units'].pop()
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): boundary.validate_inventory(bad)

    def test_all_seven_disabled_have_zero_dispatch(self):
        for spec in caller.plan()['units']:
            with self.subTest(unit=spec['id']), patch.object(caller, 'plan', side_effect=AssertionError('read')), patch.object(caller, 'run_unit', side_effect=AssertionError('dispatch')):
                with self.assertRaisesRegex(ValueError, 'disabled'):
                    caller.main(None, spec['id'], None, enabled=False)
        with patch.object(caller, 'plan', side_effect=AssertionError('read')):
            with self.assertRaisesRegex(ValueError, 'Missing parent grant'): caller.admit(None, 'x', None, enabled=True)

    def test_all_seven_actual_caller_processes_refuse_without_helper_imports(self):
        script = "import sys,runpy,json;sys.path.insert(0,sys.argv[1]);sys.argv=[sys.argv[1]+'/caller.py','--unit',sys.argv[2]]\ntry: runpy.run_path(sys.argv[0],run_name='__main__')\nfinally: print(json.dumps({'helpers':[n for n in sys.modules if n.startswith(('round4_', 'run_round4_'))]}))"
        for spec in caller.plan()['units']:
            with self.subTest(unit=spec['id']), tempfile.TemporaryDirectory() as tmp:
                result = subprocess.run([sys.executable, '-B', '-c', script, str(HERE), spec['id']], cwd=tmp, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 1)
                self.assertIn(b'Missing parent grant', result.stderr)
                self.assertEqual(json.loads(result.stdout), {'helpers': []})
                self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_seven_process_success_chain_same_head(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Repo(Path(tmp).resolve())
            for i, spec in enumerate(repo.plan['units']):
                result = repo.run(i)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                paths = repo.ready['paths'][spec['id']]
                receipt = json.loads((Path(paths['evidence']) / 'result.json').read_text())
                self.assertFalse(receipt['accepted'])
                self.assertEqual(receipt['observations']['ports'], ['capture', 'release', 'decode'])
                self.assertEqual(len(receipt['outputManifest']), len(spec['files']))
                self.assertEqual(boundary.git(repo.root, 'rev-parse', 'HEAD').decode().strip(), repo.head)
            self.assertEqual(len(repo.previous), 7)

    def test_negative_real_git_predecessors(self):
        for mutation in ('unrelated', 'staged', 'tracked', 'tamper', 'symlink', 'rootlink', 'extra', 'emptydir', 'ignored', 'reused', 'wronghead', 'wronghash', 'failed', 'noexit'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                repo = Repo(Path(tmp).resolve()); first = repo.run(0)
                self.assertEqual(first.returncode, 0, first.stderr.decode())
                spec, paths, grant = repo.grant(1)
                old = repo.ready['paths']['review-thalune']; output = Path(old['output']); image = output / repo.plan['units'][0]['files'][0]
                if mutation == 'unrelated': (repo.root / 'unrelated\nquoted"').write_text('x')
                elif mutation == 'staged': subprocess.run(['git', '-C', str(repo.root), 'add', str(image)], check=True)
                elif mutation == 'tracked': (repo.root / 'source').write_text('changed')
                elif mutation == 'tamper': image.write_text('x')
                elif mutation == 'symlink': image.unlink(); image.symlink_to(repo.root / 'source')
                elif mutation == 'rootlink': renamed = output.with_name('relocated'); output.rename(renamed); output.symlink_to(renamed, target_is_directory=True)
                elif mutation == 'extra': (output / 'extra.png').write_text('x')
                elif mutation == 'emptydir': (output / 'empty').mkdir()
                elif mutation == 'ignored': (repo.root / 'new.ignored').write_text('x')
                elif mutation == 'reused': Path(paths['consumption']).write_text('{}')
                elif mutation == 'wronghead': grant['authorizedHead'] = '0' * 40
                elif mutation == 'wronghash': grant['readySha256'] = '0' * 64
                elif mutation == 'noexit': grant['previous'][0]['callerExit'] = None
                elif mutation == 'failed':
                    r = Path(old['evidence']) / 'result.json'; obj = json.loads(r.read_text()); obj['checksPassed'] = False; r.write_text(json.dumps(obj)); grant['previous'][0]['resultSha256'] = digest(r)
                Path(paths['grant']).write_text(json.dumps(grant))
                with self.assertRaises((ValueError, FileNotFoundError)):
                    repo.admit(1, (spec, paths, grant))
                self.assertFalse(Path(paths['evidence']).exists())

    def test_admission_free_space_edges_and_reused_authorization(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            repo = Repo(Path(tmp).resolve()); spec, paths, grant = repo.grant(0)
            with patch.object(caller.shutil, 'disk_usage', return_value=SimpleNamespace(free=spec['admission'] - 1)):
                with self.assertRaisesRegex(ValueError, 'free space'): repo.admit(0, (spec, paths, grant))
            with patch.object(caller.shutil, 'disk_usage', return_value=SimpleNamespace(free=spec['admission'])):
                repo.admit(0, (spec, paths, grant))
            self.assertFalse(Path(paths['consumption']).exists())
            self.assertEqual(repo.run(0).returncode, 0)
            first = json.loads(Path(paths['consumption']).read_text())
            spec, paths, grant = repo.grant(1)
            grant['authorizationId'] = first['authorizationId']; Path(paths['grant']).write_text(json.dumps(grant))
            with self.assertRaisesRegex(ValueError, 'Reused authorization'): repo.admit(1, (spec, paths, grant))

    def test_authenticated_failed_bytes_cannot_be_replaced_by_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Repo(Path(tmp).resolve()); self.assertEqual(repo.run(0).returncode, 0)
            prior = Path(repo.ready['paths']['review-thalune']['evidence']) / 'result.json'
            good = prior.read_bytes(); bad = json.loads(good); bad['checksPassed'] = False; prior.write_text(json.dumps(bad))
            repo.previous[0]['resultSha256'] = digest(prior)
            spec, paths, grant = repo.grant(1)
            original = boundary.snapshot
            seen = []
            def schedule(path, cap, expected=None):
                result = original(path, cap, expected)
                if Path(path) == prior:
                    prior.write_bytes(good); seen.append('replaced-after-authenticated-read')
                return result
            with patch.object(boundary, 'snapshot', schedule), self.assertRaisesRegex(ValueError, 'Predecessor failed'):
                repo.admit(1, (spec, paths, grant))
            self.assertEqual(seen, ['replaced-after-authenticated-read'])
            self.assertFalse(Path(paths['consumption']).exists())

    def test_bounded_reads_preflight_and_growth(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp).resolve() / 'metadata'; p.write_bytes(b'x' * 1025)
            with patch.object(os, 'open', side_effect=AssertionError('must not open oversized')):
                with self.assertRaisesRegex(ValueError, 'capped regular'): boundary.snapshot(p, 1024)
            p.write_bytes(b'{}')
            original = os.fdopen; reads = []
            class Growing:
                def __init__(self, stream): self.stream = stream
                def __enter__(self): return self
                def __exit__(self, *args): self.stream.close()
                def fileno(self): return self.stream.fileno()
                def read(self, count):
                    p.write_bytes(b'x' * 2000); reads.append(count); return self.stream.read(count)
            with patch.object(os, 'fdopen', lambda *a, **kw: Growing(original(*a, **kw))), self.assertRaises(ValueError): boundary.snapshot(p, 1024)
            self.assertEqual(reads, [1025])

    def test_actual_fifo_replacements_refuse_and_close_all_metadata_descriptors(self):
        for target in ('grant', 'result', 'consumption'):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as tmp:
                repo = Repo(Path(tmp).resolve()); self.assertEqual(repo.run(0).returncode, 0)
                spec, paths, grant = repo.grant(1)
                old = repo.ready['paths']['review-thalune']
                victim = Path(paths['grant']) if target == 'grant' else Path(old['consumption']) if target == 'consumption' else Path(old['evidence']) / 'result.json'
                original = os.open; descriptors = []; replaced = []
                def replace_before_open(path, flags, *args, **kwargs):
                    if Path(path) == victim and not replaced:
                        victim.rename(victim.with_name(victim.name + '.original'))
                        os.mkfifo(victim)
                        replaced.append(True)
                        self.assertEqual(flags & (os.O_NONBLOCK | os.O_NOFOLLOW), os.O_NONBLOCK | os.O_NOFOLLOW)
                        fd = original(path, flags, *args, **kwargs); descriptors.append(fd); return fd
                    return original(path, flags, *args, **kwargs)
                with patch.object(os, 'open', replace_before_open), boundary.deadline(.5):
                    with self.assertRaisesRegex(ValueError, 'descriptor.*regular'):
                        repo.admit(1, (spec, paths, grant))
                self.assertEqual(len(descriptors), 1)
                with self.assertRaises(OSError): os.fstat(descriptors[0])
                self.assertFalse(Path(paths['consumption']).exists())
                self.assertFalse(Path(paths['evidence']).exists())

    def test_deadline_unwinds_and_restores(self):
        dispatched = []
        original = signal.getsignal(signal.SIGALRM)
        with self.assertRaises(boundary.DeadlineExpired):
            with boundary.deadline(0.02):
                time.sleep(.06)
                dispatched.append('later')
        self.assertEqual(dispatched, [])
        self.assertEqual(signal.getsignal(signal.SIGALRM), original)
        record = {'primaryFailure': {'original': True}}
        def interrupted(*_):
            with boundary.deadline(.01): time.sleep(.05)
        with self.assertRaises(boundary.DeadlineExpired) as context:
            boundary.persist(record, [Path('/unused'), Path('/later')], write=interrupted)
        self.assertIs(context.exception.evidence, record)

    def test_error_fallback_and_all_sinks_preserve_memory(self):
        error = subprocess.CalledProcessError(1, ['inert'], b'raw\xff', b'err\xfe'); error.unknown = {'extra': b'\x00'}
        record = {'primaryFailure': boundary.raw(error)}
        calls = []
        def fail(path, value): calls.append(path); raise OSError('full')
        result = boundary.persist(record, [Path('/a'), Path('/b')], write=fail, emit=lambda _: (_ for _ in ()).throw(OSError('stderr failed')))
        self.assertFalse(result['durable']); self.assertIs(result['record'], record)
        self.assertEqual(len(record['persistenceErrors']), 3)
        self.assertEqual(record['primaryFailure']['attributes']['unknown']['extra']['base64'], 'AA==')
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp).resolve() / 'fallback.json'
            result = boundary.persist(record, [p.parent / 'absent' / 'result.json', p])
            self.assertTrue(result['durable']); self.assertEqual(json.loads(p.read_text())['primaryFailure'], record['primaryFailure'])

    def test_cache_copy_actual_bytes_and_pre_copy_caps(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve(); cache = base / 'cache'; cache.mkdir(); (cache / 'leaf').write_bytes(b'cache bytes')
            evidence = base / 'evidence'; evidence.mkdir(); record = {'ledger': []}
            caller.snapshot_caches({'bindings': {'generatedCaches': [str(cache)]}}, evidence, record)
            self.assertEqual((evidence / 'cache-before/0/leaf').read_bytes(), b'cache bytes')
            self.assertEqual(record['ledger'][0]['attemptedBytes'], 11)
            (cache / 'leaf').unlink(); (cache / 'leaf').symlink_to(evidence / 'cache-before/0/leaf')
            other = base / 'symlink-evidence'; other.mkdir()
            with self.assertRaisesRegex(ValueError, 'Symlink'): caller.snapshot_caches({'bindings': {'generatedCaches': [str(cache)]}}, other, {'ledger': []})
            (cache / 'leaf').unlink()
            with (cache / 'leaf').open('wb') as stream: stream.truncate(64 * boundary.MIB + 1)
            other = base / 'large-evidence'; other.mkdir()
            with patch.object(bindings, 'tree_binding', side_effect=AssertionError('oversized cache must not be hashed')):
                with self.assertRaisesRegex(ValueError, 'snapshot ceiling'): caller.snapshot_caches({'bindings': {'generatedCaches': [str(cache)]}}, other, {'ledger': []})

    def test_no_decode_or_copy_before_positive_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve(); record = {}
            paths = {'evidence': str(base / 'evidence'), 'output': str(base / 'output')}
            events = []
            with self.assertRaisesRegex(ValueError, 'positively released'):
                caller.run_unit({'bindings': {'generatedCaches': []}}, caller.plan()['units'][0], paths, record,
                    capture=lambda *_: {'released': False}, decoder=lambda *_: events.append('decoder'),
                    cache_copy=lambda *args: None)
            self.assertEqual(events, []); self.assertFalse((base / 'evidence' / 'decode-copy').exists())


if __name__ == '__main__': unittest.main()
