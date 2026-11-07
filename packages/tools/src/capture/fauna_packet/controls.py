"""CPU controls with inert native boundaries; no browser, Vite, GPU or services."""
import sys
sys.dont_write_bytecode = True
import copy
import base64
import signal
import shutil
import ast
from contextlib import contextmanager, nullcontext, redirect_stderr, redirect_stdout
import datetime
import importlib.util
import io
import json
import os
import re
import stat
from pathlib import Path
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))  # inspect.py is an executable inspector, never the stdlib inspect module.
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


caller = module('fauna_cpu_caller', 'caller.py')
inspector = module('fauna_cpu_inspector', 'inspect.py')


class CallerControls(unittest.TestCase):
    def test_actual_helper_refusals_preserve_raw_unknown_fields_through_receipt_failure(self):
        helpers_dir = HERE.parents[4] / 'assets/blend/stations/_authoring'
        for phase in ('archive', 'terminal', 'combined-write', 'all-sinks'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix='fauna-cpu-release-') as tempdir:
                base = Path(tempdir).resolve(); evidence = base / 'evidence'; evidence.mkdir()
                private = base / 'private'; private.mkdir(mode=0o700)
                calls = []
                def command(argv, **kwargs):
                    calls.append(argv[1])
                    return SimpleNamespace(args=argv, returncode=1 if argv[1] == 'bootout' or phase in ('combined-write', 'all-sinks') else 0,
                                           stdout='RAW_STDOUT', stderr='RAW_STDERR', futureField={'unknown': [7, 'preserve']})
                kernel = lambda _: {'live': 0, 'futureKernel': {'raw': 'preserve'}}
                namespace = {'Path': Path, 'ROOT': base, 'SUPPORTED_PROFILE_PREFIXES': ('playwright_chromiumdev_profile-',),
                             'UnsafeCaptureGroup': RuntimeError, 'tempfile': tempfile, 'stat': stat, 'os': os, 're': re,
                             'subprocess': SimpleNamespace(run=command, check_output=lambda *a, **k: ''),
                             'kernel_tasks': kernel, 'identity': lambda _: None, 'utc': lambda: 'CPU_ONLY',
                             'write': lambda p, v: p.write_text(json.dumps(v))}
                source = helpers_dir / 'round4_job_boundary.py'
                tree = ast.parse(source.read_text(), filename=str(source))
                prevalidate = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_archive_profile_paths')
                jobclass = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'StationJob')
                archive = next(n for n in jobclass.body if isinstance(n, ast.FunctionDef) and n.name == 'archive')
                exec(compile(ast.Module(body=[prevalidate, archive], type_ignores=[]), str(source), 'exec'), namespace)
                source = helpers_dir / 'run_round4_remaining8.py'
                audit = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'terminal_audit')
                exec(compile(ast.Module(body=[audit], type_ignores=[]), str(source), 'exec'), namespace)
                class Job:
                    def __init__(self, out, *a, **kw):
                        self.out = Path(out); self.out.mkdir(); self.scratch = base / 'scratch'; self.scratch.mkdir()
                        (self.scratch / 'capture_stdout.txt').write_text('PARTIAL_CAPTURE_LOG')
                        self.coalition_id = 7; self.known = {}; self.target = 'CPU_ONLY_NO_LAUNCH'
                        self.state = {'drained': True, 'clean': True, 'exits': {'capture': 1, 'caffeinate': 0}, 'futureState': {'raw': 'keep'}}
                    def start(self): calls.append('fake-start')
                    def wait(self, *a): calls.append('fake-capture'); return 'completed'
                    def drain(self, *a): return self.state.copy()
                    def members(self): return []
                    def archive(self, **kw):
                        (self.scratch / 'capture_stdout.txt').unlink(); self.scratch.rmdir()
                        (self.out / 'profile_release.json').write_text(json.dumps({'all_absent': True, 'all_owned_profiles': [], 'futureProfile': 'keep'}))
                if phase == 'archive': Job.archive = namespace['archive']
                def release(*a, **kw):
                    private.rmdir()
                    return {'namespace_removed': True, 'all_bytes_preserved': True, 'futureRelease': 'keep'}
                core = SimpleNamespace(StationJob=Job, identity=lambda _: {'uid': os.getuid()}, coalition=lambda _: [1, 2], deadline=lambda _: nullcontext(), kernel_tasks=kernel)
                temp = SimpleNamespace(executable_path=lambda _: sys.executable, create_private_tmp=lambda _: (private, {}), preserve_private_tmp=release)
                support = SimpleNamespace(StageReceipts=lambda *a: SimpleNamespace(observe=lambda: None, require_browser=lambda: None), terminal_audit=namespace['terminal_audit'])
                helpers = {'round4_job_boundary': core, 'run_round4_browser_proof': temp, 'run_round4_remaining8': support}
                ready = {'generatedCaches': [], 'stationDirectory': str(helpers_dir), 'uid': os.getuid(), 'node': 'NEVER_EXECUTED', 'path': 'CPU_ONLY', 'browserCache': 'CPU_ONLY', 'root': str(base)}
                original_persist, original_read, original_run = caller.persist, caller.read_json, caller.run_unit
                returned_results, write_attempts = [], []
                def run(*a):
                    result = original_run(*a)
                    returned_results.append(result)
                    return result
                def persist(p, value):
                    name = Path(p).name
                    write_attempts.append(name)
                    if phase == 'all-sinks' and 'fake-capture' in calls: raise OSError('ENOSPC_' + name)
                    if phase == 'combined-write' and name in ('returned-tmp-release.json', 'terminal-audit.json', 'result.json'): raise OSError('ENOSPC_' + name)
                    if phase in ('archive', 'terminal') and (name.startswith('release-') or name == 'result.json'): raise OSError('ENOSPC_SECONDARY')
                    return original_persist(p, value)
                stderr, stdout = io.StringIO(), io.StringIO()
                class FailedSink:
                    def write(self, _): raise OSError('STDERR_UNAVAILABLE')
                before_path = list(sys.path)
                try:
                    with patch.object(sys, 'argv', ['caller', '--execute', 'fauna-hit-turn-day-16x9', '--grant', 'CPU_ONLY']), patch.object(caller, 'read_json', side_effect=lambda p, *a: ready if p == caller.READY else original_read(p, *a)), patch.object(caller, 'consume', return_value=({'evidence': str(evidence), 'consumption': 'NEVER_USED'}, {'unit': 'fauna-hit-turn-day-16x9'})) as consume, patch.object(caller, 'run_unit', side_effect=run), patch.object(caller, 'snapshot_caches'), patch.object(caller.importlib, 'import_module', side_effect=lambda n: helpers[n]), patch.object(caller, 'observed_thresholds', return_value={}), patch.object(caller, 'persist', side_effect=persist), patch.object(caller.subprocess, 'run', side_effect=AssertionError('No decoder/later dispatch')), redirect_stderr(FailedSink() if phase == 'all-sinks' else stderr), redirect_stdout(FailedSink() if phase == 'all-sinks' else stdout):
                        self.assertEqual(caller.main(), 1)
                    self.assertEqual(consume.call_count, 1)
                finally:
                    sys.path[:] = before_path
                result = returned_results[0]
                self.assertFalse(result['accepted'])
                self.assertEqual(result['primaryFailure']['message'], 'Capture returned failure')
                if phase in ('archive', 'terminal'):
                    self.assertEqual(result['cleanupFailures'][0]['type'], 'AssertionError')
                self.assertTrue(result['persistenceFailures'])
                if phase in ('archive', 'terminal'):
                    attempt = result['raw']['releaseAttempts'][phase]
                    self.assertIn('assert check.returncode != 0', attempt['failure']['predicate'])
                data = json.dumps(result)
                for marker in ('RAW_STDOUT', 'RAW_STDERR', 'futureField', 'futureKernel', 'futureState', 'preserve'):
                    self.assertIn(marker, data)
                    if phase != 'all-sinks': self.assertIn(marker, stderr.getvalue())
                self.assertEqual(calls.count('fake-start'), 1)
                if phase == 'archive':
                    self.assertTrue(private.exists())
                    self.assertEqual((base / 'scratch/capture_stdout.txt').read_text(), 'PARTIAL_CAPTURE_LOG')
                if phase == 'combined-write':
                    self.assertIn('failed-result.json', write_attempts)
                    fallback = (evidence / 'failed-result.json').read_text()
                    for marker in ('Capture returned failure', 'ENOSPC_returned-tmp-release.json', 'ENOSPC_terminal-audit.json', 'ENOSPC_result.json', 'RAW_STDOUT', 'futureKernel', 'futureRelease'):
                        self.assertIn(marker, fallback)
                    self.assertEqual(result['publication']['completeReceipt'], 'failed-result.json')
                if phase == 'all-sinks':
                    self.assertIn('failed-result.json', write_attempts)
                    self.assertEqual(result['publication']['status'], 'UNABLE_TO_PERSIST_COMPLETE_RESULT')
                    self.assertIsNone(result['publication']['completeReceipt'])
                    self.assertTrue(any(row['message'] == 'STDERR_UNAVAILABLE' for row in result['persistenceFailures']))

    def test_per_unit_budget_uses_219_images_for_broad_and_81_for_correction(self):
        freeze = module('fauna_cpu_freeze', 'freeze.py')
        common = caller.read_json(HERE / 'readiness.json')['budget']
        correction = freeze.unit_budget(81, common)
        broad = freeze.unit_budget(219, common)
        self.assertEqual((correction['fileCount'], correction['newOutputCapBytes'], correction['oneUnitAdmissionBytes']), (82, 1358970880, 8925528064))
        self.assertEqual((broad['fileCount'], broad['newOutputCapBytes'], broad['oneUnitAdmissionBytes']), (220, 3674226688, 15871295488))
        for budget in (correction, broad):
            self.assertEqual(budget['futureLfsAdditionalBytes'], budget['newOutputCapBytes'])
            self.assertEqual(budget['futureMainHydrationAdditionalBytes'], budget['newOutputCapBytes'])

    def test_retained_git_archive_detects_different_tree_without_hydrating_payloads(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            root = Path(temp)
            def git(*args):
                return subprocess.check_output(['/usr/bin/git', *args], cwd=root, stderr=subprocess.PIPE, text=True).strip()
            git('init', '-q')
            file = root / 'assets/renders/ui/fauna-combat/fixture.txt'
            file.parent.mkdir(parents=True)
            file.write_text('CPU archive fixture only')
            git('add', '.')
            git('-c', 'user.name=CPU fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            pin = caller.legacy_binding(root, '/usr/bin/git', git('rev-parse', 'HEAD'))
            ready = {'root': str(root), 'git': '/usr/bin/git', 'legacyArchive': pin}
            self.assertEqual(pin['files'], 1)
            caller.verify_legacy(ready)
            file.write_text('different CPU archive fixture')
            git('add', '.')
            git('-c', 'user.name=CPU fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'changed')
            caller.verify_legacy(ready)  # Its original immutable revision remains intact.
            with self.assertRaisesRegex(caller.Refused, 'Git identities changed'):
                caller.verify_legacy({**ready, 'legacyArchive': {**pin, 'commit': git('rev-parse', 'HEAD')}})
            with self.assertRaisesRegex(caller.Refused, 'immutable commit'):
                caller.legacy_binding(root, '/usr/bin/git', 'HEAD')

    def test_fresh_attempt_grant_path_and_authorization_are_bound_before_allocation(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            grant = Path(temp) / 'grant.json'
            grant.write_text('{"authorizationId":"cpu-only"}')
            spec = {'grant': str(grant.resolve()), 'authorizationId': 'cpu-only'}
            ready = {'runtimeEnabled': True, 'root': temp, 'git': '/usr/bin/git'}
            ready_path = Path(temp) / 'ready.json'; ready_path.write_text(json.dumps(ready))
            for changed in ({'grant': str(grant) + '.wrong'}, {'authorizationId': 'wrong'}):
                with self.subTest(changed=changed), patch.object(caller, 'READY', ready_path), patch.object(caller, 'grant_gate', return_value=caller.GrantAdmission({**spec, **changed}, ())), patch.object(caller.subprocess, 'check_output', return_value='head'), patch.object(caller, 'verify_bindings', side_effect=AssertionError('verification reached')), patch.object(caller, 'persist', side_effect=AssertionError('allocation reached')):
                    with self.assertRaisesRegex(caller.Refused, 'Grant attempt identity changed'):
                        caller.consume(ready, 'cpu-only', str(grant))

    def test_actual_disabled_entry_has_no_subprocess_helper_import_or_allocation(self):
        script = '''import sys, runpy
def audit(event, args):
    if event in ('subprocess.Popen', 'os.posix_spawn', 'os.fork', 'os.mkdir'):
        raise AssertionError('disabled entry attempted allocation: ' + event)
    if event == 'import' and args[0] in ('round4_job_boundary', 'round4_capture_children', 'run_round4_browser_proof', 'run_round4_remaining8'):
        raise AssertionError('disabled entry imported an ownership helper')
sys.addaudithook(audit)
sys.argv = [sys.argv[1], '--execute', sys.argv[2], '--grant', '/nonexistent-cpu-control-grant']
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        python = caller.read_json(HERE / 'readiness.json')['python']
        for unit in ['fauna-hit-turn-' + light + '-' + aspect for light in ('day', 'night') for aspect in ('16x9', '21x9')] + ['fauna-combat', 'fauna-combat-night']:
            result = subprocess.run([python, '-I', '-B', '-c', script, str(HERE / 'caller.py'), unit], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
            self.assertIn('Readiness is disabled; no helper import/allocation permitted', result.stderr)

    def test_disabled_before_grant_helper_or_allocation(self):
        with patch.object(caller, 'read_json', side_effect=AssertionError('grant read')), patch.object(caller.importlib, 'import_module', side_effect=AssertionError('helper import')), patch.object(caller, 'persist', side_effect=AssertionError('allocation')):
            with self.assertRaisesRegex(caller.Refused, 'Readiness is disabled'):
                caller.consume({'runtimeEnabled': False}, 'unit', '/nonexistent-grant')

    def test_real_python_optimization_and_compiled_optimization(self):
        python = caller.read_json(HERE / 'readiness.json')['python']
        for target in ('caller.py', 'freeze.py'):
            for flags, optimization in (([], '1'), ([], '2'), (['-O'], '0'), (['-OO'], '0')):
                with self.subTest(target=target, flags=flags, environment=optimization):
                    env = {**os.environ, 'PYTHONOPTIMIZE': optimization, 'PYTHONDONTWRITEBYTECODE': '1'}
                    result = subprocess.run([python, '-B', *flags, str(HERE / target)], env=env, capture_output=True, text=True, timeout=5)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Optimized Python is refused', result.stderr)
            for optimization in (1, 2):
                namespace = {'__name__': 'compiled_control', '__file__': str(HERE / target)}
                code = compile((HERE / target).read_text(), str(HERE / target), 'exec', optimize=optimization)
                with self.assertRaisesRegex(SystemExit, 'Optimized Python is refused'):
                    exec(code, namespace)

    def test_grant_identity_scope_freeze_expiry_and_review(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            review = Path(temp) / 'review.json'
            review.write_text('CPU test review, not a native runtime grant\n')
            ready = {'runtimeEnabled': True, 'units': {'second': {'evidence': temp}, 'first': {'screen': 'first'}}, 'unitOrder': ['first', 'second']}
            grant = {'purpose': 'FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY', 'oneUse': True, 'authorizationId': 'cpu-test',
                     'readinessSha256': 'frozen', 'authorizedHead': 'head', 'unit': 'first', 'nativeReservesAccepted': True,
                     'callerReview': {'verdict': 'PASS', 'path': str(review), 'sha256': caller.sha(review)},
                     'previousUnitsAccepted': [], 'expiresUtc': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)).isoformat()}
            self.assertEqual(caller.grant_gate(ready, 'first', grant, 'frozen', 'head', 'cpu-test').spec, {'screen': 'first'})
            for key, bad in (('purpose', 'other'), ('oneUse', False), ('authorizationId', 'other'), ('readinessSha256', 'drift'), ('authorizedHead', 'drift'), ('unit', 'second'), ('nativeReservesAccepted', False), ('previousUnitsAccepted', ['second']), ('expiresUtc', '2000-01-01T00:00:00+00:00'), ('callerReview', {})):
                with self.subTest(key=key), self.assertRaises((caller.Refused, KeyError)):
                    caller.grant_gate(ready, 'first', {**grant, key: bad}, 'frozen', 'head', 'cpu-test')
            with self.assertRaises(caller.Refused):
                caller.grant_gate(ready, 'first', grant, 'frozen', 'head', '')

    def test_exclusive_one_use_receipt_and_receipt_cap(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            file = Path(temp) / 'consumed.json'
            caller.persist(file, {'cpuFixture': True})
            with self.assertRaises(FileExistsError):
                caller.persist(file, {'cpuFixture': True})
            with self.assertRaisesRegex(caller.Refused, '1 MiB'):
                caller.persist(Path(temp) / 'large.json', {'data': 'x' * 1024**2})
            self.assertFalse((Path(temp) / 'large.json').exists())

    def test_raw_failure_and_release_failures_cannot_be_accepted(self):
        good = {'outcome': 'completed', 'exits': {'capture': 0, 'caffeinate': 0}, 'drained': True, 'clean': True,
                'profilesAbsent': True, 'tmpAbsent': True, 'terminalAudit': True, 'inspection': {'accepted': True}, 'persistenceFailures': []}
        caller.accept_outcome(good)
        for key, bad in (('outcome', 'timed_out'), ('outcome', 'observer_failed'), ('exits', {'capture': 1, 'caffeinate': 0}), ('exits', {'capture': 0, 'caffeinate': 'UNKNOWN'}), ('drained', False), ('clean', False), ('profilesAbsent', False), ('tmpAbsent', False), ('terminalAudit', False), ('inspection', {'accepted': False}), ('persistenceFailures', ['disk-full'])):
            with self.subTest(key=key, bad=bad), self.assertRaises(caller.Refused):
                caller.accept_outcome({**good, key: bad})

    def test_failed_capture_preserves_raw_and_drains_without_importing_real_helpers(self):
        for outcome, capture_exit, live in (('completed', 1, 0), ('observer_failed', 0, 0), ('completed', 0, 1)):
            with self.subTest(outcome=outcome, capture_exit=capture_exit, live=live), tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
                base = Path(temp)
                evidence, private = base / 'evidence', base / 'private'
                evidence.mkdir(); private.mkdir(mode=0o700)
                calls = []
                class FakeJob:
                    def __init__(self, out, *args, **kwargs):
                        self.out = Path(out); self.out.mkdir()
                        self.scratch = base / 'scratch'; self.scratch.mkdir()
                        self.coalition_id = 7
                        self.state = {'exits': {'capture': capture_exit, 'caffeinate': 0}}
                    def start(self):
                        calls.append('start')
                    def wait(self, seconds, observe):
                        calls.append('wait')
                        return outcome
                    def drain(self, seconds):
                        calls.append('drain')
                        return {'drained': True, 'clean': True, 'exits': self.state['exits']}
                    def members(self):
                        return []
                    def archive(self, **kwargs):
                        calls.append('archive')
                        (self.out / 'profile_release.json').write_text(json.dumps({'all_absent': True, 'all_owned_profiles': []}))
                core = SimpleNamespace(StationJob=FakeJob, identity=lambda pid: {'uid': os.getuid(), 'pid': pid, 'birth': [1, 2]}, coalition=lambda pid: [1, 2],
                                       deadline=lambda seconds: nullcontext(), kernel_tasks=lambda coalition: {'live': live})
                temp_helper = SimpleNamespace(executable_path=lambda pid: sys.executable, create_private_tmp=lambda path: (private, {}),
                                              preserve_private_tmp=lambda *args, **kwargs: {'namespace_removed': True, 'all_bytes_preserved': True})
                support = SimpleNamespace(StageReceipts=lambda *args: SimpleNamespace(observe=lambda: None, require_browser=lambda: None), terminal_audit=lambda *args: {'cpuFixtureOnly': True})
                helpers = {'round4_job_boundary': core, 'run_round4_browser_proof': temp_helper, 'run_round4_remaining8': support}
                ready = {'uid': os.getuid(), 'stationDirectory': str(base), 'node': 'CPU_FAKE_NODE_NEVER_EXECUTED', 'path': os.environ['PATH'], 'browserCache': str(base), 'root': str(base),
                         'generatedCaches': [], 'initialCacheBytes': 0, 'budget': {'safetyReserveBytes': 0, 'nativeReservesAndObservedThresholds': {key: 1024**2 for key in ('nativeProfileWorkingAndArchivePeak', 'privateTmpWorkingAndArchivePeak', 'helperLogWorkingAndArchivePeak', 'generatedCacheGrowth')}}}
                before_path = list(sys.path)
                try:
                    with patch.object(caller, 'snapshot_caches'), patch.object(caller.importlib, 'import_module', side_effect=lambda name: helpers[name]), patch.object(caller.subprocess, 'run', side_effect=AssertionError('No inspector after failure')):
                        result = caller.run_unit(ready, {'evidence': str(evidence), 'consumption': str(base / 'unused')}, {'unit': 'cpu-only'})
                finally:
                    sys.path[:] = before_path
                self.assertFalse(result['accepted'])
                self.assertEqual(calls[:3], ['start', 'wait', 'drain'])
                self.assertTrue((evidence / 'returned-capture-outcome.json').exists())
                self.assertTrue((evidence / 'returned-drain.json').exists())
                self.assertTrue((evidence / 'raw-before-acceptance.json').exists())
                self.assertTrue((evidence / 'cache-after.json').exists())
                if live:
                    self.assertNotIn('archive', calls)
                    self.assertTrue(result['cleanupFailures'])
                    self.assertTrue(private.exists())
                else:
                    self.assertIn('archive', calls)
                    self.assertIsNotNone(result['primaryFailure'])


class CacheSnapshotControls(unittest.TestCase):
    def test_regular_source_growth_after_inventory_never_exceeds_admitted_copy_bytes(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp).resolve();cache, evidence = base / 'cache', base / 'evidence'
            cache.mkdir(); evidence.mkdir(); source = cache / 'mutable-cache.bin';source.write_bytes(b'a' * 1024)
            original = caller.hash_plan; grown = False
            def hashed(plan, *args):
                nonlocal grown
                rows = original(plan, *args)
                if plan['root'] == cache and not grown: source.write_bytes(b'a' * 16384);grown = True
                return rows
            with patch.object(caller, 'hash_plan', side_effect=hashed):
                with self.assertRaises(caller.Refused): caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
            copied = evidence / 'cache-before-0/mutable-cache.bin'
            self.assertEqual(copied.read_bytes(), b'')  # Changed size is refused before reading/copying.
            self.assertEqual(source.read_bytes(), b'a' * 16384)
            self.assertFalse((evidence / 'cache-before.json').exists())

    def test_multiple_caches_and_files_copy_at_the_exact_aggregate_boundary(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp).resolve();caches, evidence = [base / 'cache0', base / 'cache1'], base / 'evidence'
            for directory in [*caches, evidence]: directory.mkdir()
            (caches[0] / 'a').write_bytes(b'a' * 7);(caches[0] / 'b').write_bytes(b'b' * 5)
            (caches[1] / 'c').write_bytes(b'c' * 4);(caches[1] / 'empty').write_bytes(b'')
            original = [caller.inventory(root) for root in caches]
            rows = caller.snapshot_caches({'generatedCaches': list(map(str, caches)), 'budget': {'cacheSnapshotCapBytes': 16}}, evidence)
            self.assertEqual([row['files'] for row in rows], original)
            self.assertEqual([caller.inventory(root) for root in caches], original)
            copied = [caller.inventory(evidence / ('cache-before-' + str(i))) for i in range(2)]
            self.assertEqual(copied, original)
            self.assertEqual(sum(row['bytes'] for files in copied for row in files), 16)
            self.assertEqual(json.loads((evidence / 'cache-before.json').read_text()), rows)

    def test_overremaining_file_refuses_before_any_payload_read_or_copy(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp).resolve();caches, evidence = [base / 'cache0', base / 'cache1'], base / 'evidence'
            for directory in [*caches, evidence]: directory.mkdir()
            (caches[0] / 'a').write_bytes(b'a' * 7);(caches[0] / 'b').write_bytes(b'b' * 5);(caches[1] / 'overremaining').write_bytes(b'c' * 4)
            original = [caller.inventory(root) for root in caches]
            with patch.object(os, 'fdopen', side_effect=AssertionError('PAYLOAD_READ_BEFORE_AGGREGATE_ADMISSION')):
                with self.assertRaisesRegex(caller.Refused, 'exceeds controlled cap') as caught:
                    caller.snapshot_caches({'generatedCaches': list(map(str, caches)), 'budget': {'cacheSnapshotCapBytes': 15}}, evidence)
            self.assertEqual(caught.exception.cacheObservation['bytes'], 16)
            self.assertEqual(list(evidence.iterdir()), [])
            self.assertEqual([caller.inventory(root) for root in caches], original)

    def test_shrink_and_same_size_mutation_retain_failed_copy_without_success_receipt(self):
        for changed in (b'a' * 1024, b'b' * 4096):
            with self.subTest(changedBytes=len(changed)), tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
                base = Path(temp).resolve();cache, evidence = base / 'cache', base / 'evidence'
                cache.mkdir(); evidence.mkdir();source = cache / 'mutable-cache.bin';source.write_bytes(b'a' * 4096)
                original = caller.hash_plan; changed_once = False
                def hashed(plan, *args):
                    nonlocal changed_once
                    rows = original(plan, *args)
                    if plan['root'] == cache and not changed_once: source.write_bytes(changed);changed_once = True
                    return rows
                with patch.object(caller, 'hash_plan', side_effect=hashed):
                    with self.assertRaises(caller.Refused):caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
                self.assertEqual((evidence / 'cache-before-0/mutable-cache.bin').read_bytes(), b'' if len(changed) < 4096 else changed)
                self.assertEqual(source.read_bytes(), changed)
                self.assertFalse((evidence / 'cache-before.json').exists())

    def test_snapshot_deadline_interrupts_inventory_and_restores_alarm(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp).resolve();cache, evidence = base / 'cache', base / 'evidence'
            cache.mkdir(); evidence.mkdir();(cache / 'source').write_bytes(b'preserve')
            previous = caller.signal.getsignal(caller.signal.SIGALRM)
            with patch.object(caller, 'CACHE_SNAPSHOT_SECONDS', 0.01), patch.object(caller, 'tree_plan', side_effect=lambda *a, **kw: time.sleep(1)):
                with self.assertRaisesRegex(caller.Refused, 'snapshot deadline expired'):
                    caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
            self.assertEqual(caller.signal.getsignal(caller.signal.SIGALRM), previous)
            self.assertEqual((cache / 'source').read_bytes(), b'preserve')
            self.assertFalse((evidence / 'cache-before.json').exists())

    def test_cache_entry_cap_refuses_empty_file_flood_before_content_reads(self):
        with tempfile.TemporaryDirectory(prefix='fauna-entry-cap-') as temp:
            base = Path(temp).resolve();cache = base / 'cache';cache.mkdir();evidence = base / 'evidence';evidence.mkdir()
            for i in range(caller.CACHE_ENTRY_CAP + 1): (cache / str(i)).touch()
            with patch.object(os, 'fdopen', side_effect=AssertionError('NO_CONTENT_BEFORE_ENTRY_ADMISSION')):
                with self.assertRaisesRegex(caller.Refused, 'entry/evidence cap') as caught:
                    caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 64 * 1024**2}}, evidence)
            self.assertEqual(len(caught.exception.cacheObservation['entries']), caller.CACHE_ENTRY_CAP)
            self.assertEqual(list(evidence.iterdir()), [])

    def test_snapshot_verification_rejects_extra_copied_entries_before_hashing(self):
        for extra in (b'X', b''):
            with self.subTest(extraBytes=len(extra)), tempfile.TemporaryDirectory(prefix='fauna-copy-verify-') as temp:
                base = Path(temp).resolve();cache = base / 'cache';cache.mkdir();(cache / 'source').write_bytes(b'A' * 8)
                evidence = base / 'evidence';evidence.mkdir();original_plan = caller.tree_plan;original_hash = caller.hash_plan;hash_calls = []
                def plan(root, *a, **kw):
                    if Path(root).name == 'cache-before-0': (Path(root) / 'unexpected').write_bytes(extra)
                    return original_plan(root, *a, **kw)
                def hashed(plan, *a):
                    hash_calls.append(str(plan['root']))
                    return original_hash(plan, *a)
                with patch.object(caller, 'tree_plan', side_effect=plan), patch.object(caller, 'hash_plan', side_effect=hashed):
                    with self.assertRaises(caller.Refused): caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 64}}, evidence)
                self.assertNotIn(str(evidence / 'cache-before-0'), hash_calls, 'Unadmitted copied entries reached payload hashing')
                self.assertEqual((evidence / 'cache-before-0/source').read_bytes(), b'A' * 8)
                self.assertFalse((evidence / 'cache-before.json').exists())

    def test_snapshot_rechecks_source_shape_and_content_within_admitted_budget(self):
        for fault in ('extra-empty', 'extra-bytes', 'same-size-change'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-source-verify-') as temp:
                base = Path(temp).resolve();cache = base / 'cache';cache.mkdir();source = cache / 'source';source.write_bytes(b'A' * 8)
                evidence = base / 'evidence';evidence.mkdir();original = caller.tree_plan;plans = []
                def plan(root, *a, **kw):
                    if Path(root) == cache:
                        plans.append(str(root))
                        if len(plans) == 2:
                            if fault == 'same-size-change': source.write_bytes(b'B' * 8)
                            else: (cache / 'extra').write_bytes(b'' if fault == 'extra-empty' else b'X')
                    return original(root, *a, **kw)
                with patch.object(caller, 'tree_plan', side_effect=plan):
                    with self.assertRaises(caller.Refused): caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 64}}, evidence)
                self.assertEqual((evidence / 'cache-before-0/source').read_bytes(), b'A' * 8)
                self.assertFalse((evidence / 'cache-before.json').exists())

    def test_cache_copy_read_cancel_and_close_errors_keep_partial_ownership(self):
        for fault in ('read', 'cancel', 'deadline', 'write-after-bytes'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-cache-failure-') as temp:
                base = Path(temp).resolve();cache = base / 'cache';cache.mkdir();evidence = base / 'evidence';evidence.mkdir()
                source = cache / 'source';source.write_bytes(b'A' * (1024 * 1024 + 7))
                original_read, original_fdopen, original_open = caller.bounded_read, os.fdopen, Path.open
                active = False; reads = []
                primary = KeyboardInterrupt('PRIMARY_CACHE_CANCEL') if fault == 'cancel' else OSError('PRIMARY_CACHE_READ')
                primary.futureCache = {'partial': b'UNKNOWN\x00\xff'}
                class Input:
                    def __init__(self, stream): self.stream = stream
                    def read(self, n):
                        if reads:
                            if fault == 'deadline': time.sleep(1)
                            if fault in ('read', 'cancel'): raise primary
                        data = self.stream.read(n);reads.append(len(data));return data
                    def close(self):
                        self.stream.close()
                        error = OSError('SOURCE_CLOSE_AFTER_REAL_CLOSE');error.rawClose = b'INPUT';raise error
                class Output:
                    def __init__(self, stream): self.stream = stream
                    def write(self, data):
                        value = self.stream.write(data)
                        if fault == 'write-after-bytes': raise primary
                        return value
                    def close(self):
                        self.stream.close()
                        error = OSError('DESTINATION_CLOSE_AFTER_REAL_CLOSE');error.rawClose = b'OUTPUT';raise error
                def fdopen(*a, **kw):
                    stream = original_fdopen(*a, **kw)
                    return Output(stream) if len(a) > 1 and a[1] == 'wb' else Input(stream) if active else stream
                def open_path(path, *a, **kw):
                    stream = original_open(path, *a, **kw)
                    return Output(stream) if a and a[0] == 'xb' and path.name == 'source' else stream
                def read(path, *a, **kw):
                    nonlocal active
                    active = kw.get('sink') is not None
                    try: return original_read(path, *a, **kw)
                    finally: active = False
                with patch.object(caller, 'bounded_read', side_effect=read), patch.object(os, 'fdopen', fdopen), patch.object(Path, 'open', open_path), patch.object(caller, 'CACHE_SNAPSHOT_SECONDS', 0.05 if fault == 'deadline' else 30):
                    with self.assertRaises(BaseException) as caught:
                        caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 2 * 1024**2}}, evidence)
                error = caught.exception
                if fault == 'deadline': self.assertIsInstance(error, caller.CacheDeadlineExpired)
                else: self.assertIs(error, primary)
                facts = caller.failure(error)['attributes']
                self.assertIn('metadata_close_failures', facts);self.assertIn('cache_copy_close', facts)
                self.assertEqual(facts['cacheObservation']['copies'][0]['complete'], False)
                copied = evidence / 'cache-before-0/source'
                self.assertEqual(copied.stat().st_size, 1024 * 1024)
                self.assertTrue(source.exists());self.assertFalse((evidence / 'cache-before.json').exists())
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_cache_after_uses_growth_allowance_and_real_deadline(self):
        with tempfile.TemporaryDirectory(prefix='fauna-after-') as temp:
            base = Path(temp).resolve();cache = base / 'cache';cache.mkdir();(cache / 'source').write_bytes(b'A' * 17)
            ready = {'generatedCaches': [str(cache)], 'initialCacheBytes': 1, 'budget': {'cacheSnapshotCapBytes': 8, 'nativeReservesAndObservedThresholds': {'generatedCacheGrowth': 16}}}
            observation = {'entries': [], 'bytes': 0, 'complete': False}
            rows = caller.cache_after(ready, observation)
            self.assertTrue(observation['complete']);self.assertEqual(rows[0]['files'][0]['bytes'], 17)
            with (cache / 'source').open('ab') as stream: stream.write(b'X')
            with patch.object(os, 'fdopen', side_effect=AssertionError('NO_READ_BEFORE_AFTER_AGGREGATE_ADMISSION')):
                with self.assertRaises(caller.Refused): caller.cache_after(ready, {'entries': [], 'bytes': 0})
            (cache / 'source').write_bytes(b'A')
            with patch.object(caller, 'CACHE_SNAPSHOT_SECONDS', 0.02), patch.object(caller, 'bounded_read', side_effect=lambda *a, **kw: time.sleep(1)):
                with self.assertRaises(caller.CacheDeadlineExpired): caller.cache_after(ready, {'entries': [], 'bytes': 0})
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))


def synthetic_turn():
    script = [(0, 17), (4, 23), (8, 9), (30, 17), (30, 23), (30, 9), (54, 11)]
    frames, observations = [], []
    for i in range(72):
        visible = i < 18 or i >= 48
        values = [str(v) for at, v in script[:3] if at <= i] if i < 18 else ['11'] if i >= 54 else []
        trace = {'frame': i, 'ms': (i + 1) * 1000 / 60, 'targetVisible': visible, 'values': values}
        frames.append(trace)
        raw = {'traceFrame': trace, 'target': {'id': 602, 'incarnation': 1, 'visible': visible},
               'numbers': [{'value': v, 'target': 602, 'incarnation': 1, 'sameRecord': True} for v in values], 'events': [], 'takes': []}
        observations.append({'path': '_frames/%03d.jpg' % i, 'after': raw})
    final = observations[-1]['after']
    final['events'] = [{'phase': 'turn', 'frame': i, 'clipTime': i / 60, 'event': {'kind': 'combat', 'target': 602, 'amount': value}} for i, value in script]
    final['takes'] = [{'phase': 'turn', 'returned': {'dealt': [{'target': 602, 'amount': value} for _, value in script]}}]
    return observations, {'frames': frames, 'events': [{'frame': i, 'amount': value, 'consumed': True} for i, value in script]}


def synthetic_broad():
    # Simulate the fixture's before-frame dispatch and during-frame consumption; never visual evidence.
    script = [(0.15, 603, 12), (0.3, 603, 18), (0.36, 603, 9), (0.55, 602, 21), (0.85, 1, 11),
              (1.1, 603, 15), (1.45, 603, 24), (1.6, 603, 31), (1.75, 'xp', 30), (1.8, 'loot', 7), (3.0, 'loot', 7)]
    events, takes, rows = [], [], []
    next_event = 0
    for i in range(204):
        t = i / 60
        while next_event < len(script) and script[next_event][0] <= t + 1e-9:
            _, target, amount = script[next_event]
            next_event += 1
            queues = {'dealt': [], 'taken': [], 'gained': []}
            if target in ('xp', 'loot'):
                event = {'kind': 'xp', 'amount': amount, 'level': 1} if target == 'xp' else {'kind': 'loot', 'item': 'units', 'count': amount}
                item = {'what': 'xp', 'count': amount, 'level': 1} if target == 'xp' else {'what': 'units', 'count': amount}
                channel = 'gained'
            else:
                killed = amount == 31
                event = {'kind': 'combat', 'source': 602 if target == 1 else 1, 'target': target, 'amount': amount, 'killed': killed, 'hp': 0.9 if target == 1 else 0 if killed else 0.5}
                item = {k: event[k] for k in ('amount', 'killed', 'hp')}
                item['source' if target == 1 else 'target'] = 602 if target == 1 else target
                channel = 'taken' if target == 1 else 'dealt'
            item['at'] = 400000 + t * 1000 + 1
            queues[channel].append(item)
            stamp = {'phase': 'fight', 'frame': None, 'clipTime': t, 'gameTime': 100 + t, 'hudTime': 1000 + t * 1000}
            events.append({**stamp, 'event': event, 'queues': queues})
            takes.append({**stamp, 'gameTime': 100 + (i + 1) / 60, 'returned': copy.deepcopy(queues)})
        raw = {'phase': 'fight', 'actor': 1, 'clipTime': (i + 1) / 60, 'gameTime': 100 + (i + 1) / 60,
               'hudTime': 1000 + (i + 1) * 1000 / 60, 'feedTime': 400000 + (i + 1) * 1000 / 60,
               'target': {'id': 603, 'incarnation': 1, 'visible': True}, 'numbers': [], 'events': copy.deepcopy(events), 'takes': copy.deepcopy(takes)}
        rows.append({'path': '_frames/%03d.jpg' % i, 'before': copy.deepcopy(raw), 'after': raw})
    return rows, 'HUD frame cost over 204 frames: CPU SYNTHETIC CONTROL ONLY\nframes over 1 ms: none'


class InspectorControls(unittest.TestCase):
    def test_broad_actual_frames_and_feed_are_required(self):
        observations, readout = synthetic_broad()
        inspector.broad_oracle(observations, readout)
        for bad in ('clock', 'event', 'consumption', 'damage', 'reward', 'readout'):
            rows = copy.deepcopy(observations)
            text = readout
            if bad == 'clock':
                rows[100]['after']['clipTime'] = 0
            elif bad == 'event':
                rows[-1]['after']['events'][-1]['event']['kind'] = 'xp'
            elif bad == 'consumption':
                rows[-1]['after']['takes'] = []
            elif bad == 'damage':
                next(take for take in rows[-1]['after']['takes'] if take['returned']['taken'])['returned']['taken'] = []
            elif bad == 'reward':
                next(take for take in rows[-1]['after']['takes'] if take['returned']['gained'])['returned']['gained'].pop()
            else:
                text = text.replace('204', '72')
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                inspector.broad_oracle(rows, text)

    def test_actual_frame_and_feed_receipts_are_required(self):
        observations, trace = synthetic_turn()
        inspector.turn_oracle(observations, trace)
        for bad in ('lost-number', 'rebound', 'no-fresh-hit', 'different-record', 'event', 'consumption', 'frame'):
            rows, readout = copy.deepcopy((observations, trace))
            if bad == 'lost-number':
                rows[20]['after']['numbers'] = [{'value': '17', 'target': 602, 'incarnation': 1, 'sameRecord': True}]
            elif bad == 'rebound':
                rows[52]['after']['numbers'] = [{'value': '17', 'target': 602, 'incarnation': 1, 'sameRecord': True}]
            elif bad == 'no-fresh-hit':
                rows[60]['after']['numbers'] = []
            elif bad == 'different-record':
                rows[60]['after']['numbers'][0]['incarnation'] = 2
            elif bad == 'event':
                rows[-1]['after']['events'][-1]['event']['amount'] = 99
            elif bad == 'consumption':
                rows[-1]['after']['takes'] = []
            else:
                readout['frames'][-1]['frame'] = 70
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                inspector.turn_oracle(rows, readout)

    def test_actual_displayed_instance_not_source_position(self):
        # Synthetic geometry is only an oracle control, never a capture receipt.
        receipt = {'offlineReplay': True, 'target': 606, 'speciesKind': 'flyer', 'beforeMode': 'fly', 'mode': 'dead', 'viewport': [1920, 1080],
                   'sourcePosition': [0, 20, -10], 'sourcePositionAfter': [0, 20, -10], 'instanceMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, -10, 1],
                   'cameraWorld': [0, 0, 0], 'worldUp': [0, 1, 0], 'size': 2, 'publishedAnchor': [0, 0, -10], 'cameraInverseQuaternion': [0, 0, 0, 1],
                   'projectionMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0],
                   'number': {'left': 960, 'top': 540, 'sameRecord': True, 'value': '26', 'fontSize': '26px', 'color': 'var(--accent-hi)', 'ageMs': 700}, 'fallAgeMs': 716.6}
        inspector.flyer_oracle(receipt, [1920, 1080])
        for field, value in (('publishedAnchor', [0, 20, -10]), ('sourcePositionAfter', [0, 0, -10]), ('fallAgeMs', 0)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                inspector.flyer_oracle({**receipt, field: value}, [1920, 1080])
        for field, value in (('left', 1000), ('value', '14'), ('sameRecord', False), ('ageMs', 900)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                inspector.flyer_oracle({**receipt, 'number': {**receipt['number'], field: value}}, [1920, 1080])

    def test_full_software_decoder_rejects_truncation_wrong_dimensions_and_crc(self):
        from PIL import Image, ImageFile
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            for suffix, fmt in (('png', 'PNG'), ('jpg', 'JPEG')):
                file = Path(temp) / ('image.' + suffix)
                Image.new('RGB', (8, 6), (20, 80, 140)).save(file, fmt)
                inspector.decode_image(file, (8, 6), fmt)
                with self.assertRaises(ValueError):
                    inspector.decode_image(file, (1920, 1080), fmt)
                data = file.read_bytes()
                file.write_bytes(data[:-7])
                with self.assertRaises(ValueError):
                    inspector.decode_image(file, (8, 6), fmt)
                if fmt == 'PNG':
                    corrupted = bytearray(data)
                    corrupted[29] ^= 1
                    file.write_bytes(corrupted)
                    with self.assertRaises((OSError, SyntaxError, ValueError)):
                        inspector.decode_image(file, (8, 6), fmt)

    def test_png_palette_cardinality_order_and_stream_contract_on_real_decoder(self):
        import struct
        import zlib
        from PIL import Image
        def chunk(kind, data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        with tempfile.TemporaryDirectory(prefix='fauna-png-container-') as temp:
            path=Path(temp)/'image.png';Image.new('RGB',(8,6),(20,80,140)).save(path);original=path.read_bytes()
            for fault in ('valid-none','valid-one','valid-256','empty','duplicate','257','partial-entry','after-idat','extra-deflate','bad-filter'):
                with self.subTest(fault=fault):
                    plte=chunk(b'PLTE',b'\x00\x00\x00')
                    extra={'valid-none':b'','valid-one':plte,'valid-256':chunk(b'PLTE',bytes(768)),'empty':chunk(b'PLTE',b''),'duplicate':plte+plte,'257':chunk(b'PLTE',bytes(771)),'partial-entry':chunk(b'PLTE',bytes(2))}.get(fault,b'')
                    data=original[:33]+extra+original[33:]
                    if fault=='after-idat':data=original[:-12]+plte+original[-12:]
                    if fault in ('extra-deflate','bad-filter'):
                        pixels=(b'\x05' if fault=='bad-filter' else b'\x00')+bytes(24)
                        compressed=zlib.compress(pixels*6)+(b'EXTRA' if fault=='extra-deflate' else b'')
                        data=original[:33]+chunk(b'IDAT',compressed)+original[-12:]
                    path.write_bytes(data)
                    if fault.startswith('valid'):inspector.decode_image(path,(8,6),'PNG')
                    else:
                        with self.assertRaises(ValueError):inspector.decode_image(path,(8,6),'PNG')

    def test_inspector_reads_only_admitted_bytes_and_reuses_the_decoded_snapshot(self):
        from PIL import Image
        for fault in ('growth','replace-after-read','fifo','parent-link','close'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory(prefix='fauna-decoder-boundary-') as temp:
                base=Path(temp).resolve();parent=base/'images';parent.mkdir();path=parent/'image.png';Image.new('RGB',(8,6)).save(path)
                admitted=path.stat();real_open,real_fdopen=os.open,os.fdopen;reads=[];changed=[];fds=[]
                class Input:
                    def __init__(self, stream):self.stream=stream
                    def read(self,n):
                        if fault=='growth':
                            with path.open('ab') as writer:writer.truncate(32*1024**2+7)
                        data=self.stream.read(n);reads.append((n,len(data)))
                        if fault=='replace-after-read':path.write_bytes(b'NOT AN IMAGE')
                        return data
                    def close(self):
                        self.stream.close()
                        if fault=='close':raise OSError('DECODER_CLOSE_AFTER_REAL_CLOSE')
                def open_at(name,flags,*a,**kw):
                    if str(name)==path.name and not changed and fault in ('fifo','parent-link'):
                        changed.append(fault)
                        if fault=='fifo':path.rename(path.with_suffix('.retained'));os.mkfifo(path)
                        else:parent.rename(base/'retained');parent.symlink_to(base/'retained',target_is_directory=True)
                    fd=real_open(name,flags,*a,**kw);fds.append(fd);return fd
                def fdopen(fd,*a,**kw):
                    stream=real_fdopen(fd,*a,**kw)
                    return Input(stream) if os.fstat(fd).st_ino==admitted.st_ino else stream
                with patch.object(os,'open',open_at),patch.object(os,'fdopen',fdopen):
                    if fault=='replace-after-read':inspector.decode_image(path,(8,6),'PNG')
                    else:
                        with self.assertRaises((inspector.file_io.Refused,OSError)):inspector.decode_image(path,(8,6),'PNG')
                if fault in ('fifo','parent-link'):self.assertEqual(reads,[]);self.assertEqual(changed,[fault])
                else:self.assertEqual(reads,[(admitted.st_size+1,admitted.st_size+(fault=='growth'))])
                for fd in fds:
                    with self.assertRaises(OSError):os.fstat(fd)

    def test_complete_synthetic_packet_has_no_missing_extra_or_unbound_output(self):
        self.check_complete_synthetic_packet('correction')

    def test_complete_broad_synthetic_packet_has_219_decoded_images(self):
        self.check_complete_synthetic_packet('broad')

    def check_complete_synthetic_packet(self, kind):
        from PIL import Image
        broad = kind == 'broad'
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp)
            output, evidence = base / 'output', base / 'evidence'
            output.mkdir(); evidence.mkdir(); (output / '_frames').mkdir()
            unit = 'fauna-combat' if broad else 'fauna-hit-turn-day-16x9'
            ready = {'units': {unit: {'kind': kind, 'light': 'day', 'aspect': '16x9', 'output': str(output), 'evidence': str(evidence)}}, 'productBindings': {'cpuFixtureOnly': '0' * 64}}
            rows, trace = synthetic_broad() if broad else synthetic_turn()
            suffixes = ('', '-numbers', '-kill', '-flash', '-analysis', '-offscreen', '-start') if broad else ('', '-kill', '-offscreen', '-start')
            names = ['16x9' + suffix + '.png' for suffix in suffixes]
            names += ['_frames/%03d.jpg' % i for i in range(204 if broad else 72)] + ['readout.txt', 'clip-sheet.png']
            names += ['21x9' + suffix + '.png' for suffix in suffixes]
            writes, observations, cache = [], [], {}
            for ordinal, name in enumerate(names):
                width = 2520 if name.startswith('21x9') else 1920
                if name == 'readout.txt':
                    data = ((trace if broad else 'CPU SYNTHETIC CONTROL ONLY\n' + json.dumps(trace)) + '\n').encode()
                else:
                    dimensions = (2400, 1526 if broad else 1228) if name == 'clip-sheet.png' else (width, 1080)
                    fmt = 'JPEG' if name.endswith('.jpg') else 'PNG'
                    key = dimensions, fmt
                    if key not in cache:
                        stream = io.BytesIO()
                        Image.new('RGB', dimensions, (20, 80, 140)).save(stream, fmt)
                        cache[key] = stream.getvalue()
                    data = cache[key]
                (output / name).write_bytes(data)
                writes.append({'path': name, 'bytes': len(data), 'sha256': inspector.digest(data)})
                if name in ('readout.txt', 'clip-sheet.png'):
                    continue
                if name.startswith('_frames/'):
                    raw = copy.deepcopy(rows[int(Path(name).stem)]['after'])
                    raw['phase'] = 'fight' if broad else 'turn'
                else:
                    raw = {'phase': 'base', 'target': {'id': 602, 'incarnation': 1, 'visible': True}, 'numbers': [], 'events': [], 'takes': []}
                    if '-kill' in name and not broad:
                        viewport = [width, 1080]
                        raw.update(phase='kill', target={'id': 606, 'incarnation': 2, 'visible': True}, numbers=[{'target': 606, 'incarnation': 2, 'sameRecord': True, 'value': '26'}])
                        raw['flyer'] = {'offlineReplay': True, 'target': 606, 'speciesKind': 'flyer', 'beforeMode': 'fly', 'mode': 'dead', 'viewport': viewport,
                                        'sourcePosition': [0, 20, -10], 'sourcePositionAfter': [0, 20, -10], 'instanceMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, -10, 1],
                                        'cameraWorld': [0, 0, 0], 'worldUp': [0, 1, 0], 'size': 2, 'publishedAnchor': [0, 0, -10], 'cameraInverseQuaternion': [0, 0, 0, 1],
                                        'projectionMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0],
                                        'number': {'left': width / 2, 'top': 540, 'sameRecord': True, 'value': '26', 'fontSize': '26px', 'color': 'var(--accent-hi)', 'ageMs': 700}, 'fallAgeMs': 716.6}
                        event = {'target': 606, 'amount': 26, 'killed': True}
                        raw['events'] = [{'phase': 'kill', 'event': {**event, 'kind': 'combat'}}]
                        raw['takes'] = [{'phase': 'kill', 'returned': {'dealt': [event]}}]
                    if '-offscreen' in name:
                        raw.update(phase='offscreen', target={'id': 602, 'incarnation': 1, 'visible': False})
                        events = [{'target': target, 'amount': value} for target, value in ((602, 17), (603, 23), (602, 9))]
                        raw['events'] = [{'phase': 'offscreen', 'event': {**event, 'kind': 'combat'}} for event in events]
                        raw['takes'] = [{'phase': 'offscreen', 'returned': {'dealt': events}}]
                raw.update(viewport=[width, 1080], canvas=[width, 1080], gameTime=raw.get('gameTime', 0), clipTime=raw.get('clipTime'))
                if broad:
                    raw.setdefault('hudTime', 0); raw.setdefault('feedTime', 0); raw['actor'] = 1
                observations.append({'ordinal': ordinal, 'path': name, 'sha256': inspector.digest(data), 'sourceBindings': ready['productBindings'], 'before': copy.deepcopy(raw), 'after': raw})
            def save(name, value):
                (evidence / name).write_text(json.dumps(value))
            entry = {'accepted': True, 'primaryFailure': None, 'unit': unit, 'pages': 2, 'launched': 1, 'writes': writes}
            save('entry-result.json', entry)
            methods = {name: '0' * 64 for name in ('HUD.hitNumber', 'HUD.hitAnchor', 'Fauna.update', 'Fauna.hitAnchor', 'CombatFeed.event', 'CombatFeed.take')}
            source = {'unit': unit, 'productBindings': ready['productBindings'], 'expectedMethods': methods}
            save('source-methods.json', source)
            for page in (1, 2):
                save('page-source-%d.json' % page, {'actual': methods, 'expectedMethods': methods})
            (evidence / 'capture-observations.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in observations))
            accepted = inspector.inspect(ready, unit)
            if broad:
                original_journal = (evidence / 'capture-observations.jsonl').read_bytes()
                for defect in ('future-stamps', 'missing-intermediate', 'incoming-payload', 'null-game', 'nan-hud', 'missing-channel', 'rewritten-history'):
                    adverse = copy.deepcopy(observations)
                    for row in adverse:
                        if not row['path'].startswith('_frames/'):
                            continue
                        for side in ('before', 'after'):
                            raw = row[side]
                            if defect == 'future-stamps':
                                for stamp in raw['events'] + raw['takes']:
                                    stamp.update(clipTime=999, gameTime=999, hudTime=999000, frame=59940)
                            elif defect == 'missing-intermediate' and row['path'] != '_frames/203.jpg':
                                raw.pop('events'); raw.pop('takes')
                            elif defect == 'incoming-payload':
                                for event in raw['events']:
                                    if event['event'].get('target') == 1:
                                        event['event'].update(target=555, source=123, amount=999)
                            elif defect == 'null-game':
                                raw['gameTime'] = None
                            elif defect == 'nan-hud':
                                raw['hudTime'] = float('nan')
                            elif defect == 'missing-channel':
                                for take in raw['takes']:
                                    take['returned'].pop('taken', None)
                            elif defect == 'rewritten-history' and row['path'] == '_frames/203.jpg':
                                raw['events'][0]['unknown-new-field'] = 'later rewrite'
                    (evidence / 'capture-observations.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in adverse))
                    with self.subTest(full_decoder_defect=defect), self.assertRaises(ValueError):
                        inspector.inspect(ready, unit)
                (evidence / 'capture-observations.jsonl').write_bytes(original_journal)
            self.assertEqual(accepted['decodedImages'], 219 if broad else 81)
            self.assertLess(accepted['outputBytes'], (12 if broad else 4) * 1024**2)
            (output / 'extra.png').write_bytes(b'x')
            with self.assertRaisesRegex(inspector.file_io.Refused, 'entry/evidence cap'):
                inspector.inspect(ready, unit)
            (output / 'extra.png').unlink()
            (output / 'extra-directory').mkdir()
            with self.assertRaisesRegex(inspector.file_io.Refused, 'entry/evidence cap'):
                inspector.inspect(ready, unit)
            (output / 'extra-directory').rmdir()
            held = (output / '16x9.png').read_bytes()
            (output / '16x9.png').unlink()
            with self.assertRaisesRegex(ValueError, 'Missing/extra'):
                inspector.inspect(ready, unit)
            (output / '16x9.png').write_bytes(held)
            save('entry-result.json', {**entry, 'accepted': False})
            with self.assertRaisesRegex(ValueError, 'Raw entry outcome refused'):
                inspector.inspect(ready, unit)
            save('entry-result.json', entry)
            save('page-source-2.json', {'actual': {}, 'expectedMethods': methods})
            with self.assertRaisesRegex(ValueError, 'Actual page/source'):
                inspector.inspect(ready, unit)


class BoundaryControls(unittest.TestCase):
    def test_after_close_failure_still_reserves_the_actual_metadata_bytes(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-receipt-cap-') as tempdir:
            path = Path(tempdir) / 'partial.json'
            payload = {'observation': 'retained'}
            size = len((json.dumps(payload, sort_keys=True, indent=2) + '\n').encode())
            original_fdopen = os.fdopen
            class CloseError:
                def __init__(self, stream): self.stream = stream
                def write(self, data): return self.stream.write(data)
                def close(self): self.stream.close(); raise OSError('AFTER_CLOSE')
            try:
                caller._receipt_bytes = 32 * 1024 * 1024 - size
                with patch.object(os, 'fdopen', side_effect=lambda *a, **kw: CloseError(original_fdopen(*a, **kw))), self.assertRaisesRegex(OSError, 'AFTER_CLOSE'):
                    caller.persist(path, payload)
                self.assertEqual(caller.read_json(path), payload)
                self.assertEqual(caller._receipt_bytes, 32 * 1024 * 1024)
                with self.assertRaisesRegex(caller.Refused, 'aggregate'):
                    caller.persist(path.with_name('next.json'), payload)
                self.assertFalse(path.with_name('next.json').exists())
            finally:
                caller._receipt_bytes = 0

    @contextmanager
    def boundary(self, *, deadline_at=None, cancel=False, timeout=None, allocation=False,
                 publication=None, all_sinks=False, clean=False, real_git=False, producer=None):
        """Actual caller/helper bodies; only native boundaries and scratch paths are inert."""
        helpers_dir = HERE.parents[4] / 'assets/blend/stations/_authoring'
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-boundary-') as tempdir:
            base = Path(tempdir).resolve(); evidence = base / 'evidence'; evidence.mkdir()
            private = base / 'private'; private.mkdir(mode=0o700)
            calls, writes, raised, returned, at_interrupt = [], [], [], [], []
            def exact(file, names, namespace, method=None):
                tree = ast.parse(file.read_text(), filename=str(file))
                nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
                if method:
                    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'StationJob')
                    nodes += [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == method]
                exec(compile(ast.Module(body=nodes, type_ignores=[]), str(file), 'exec'), namespace)
            def command(argv, **kw):
                calls.append('probe:' + argv[1])
                if timeout == 'archive' and argv[1] == 'bootout' or timeout == 'terminal' and argv[1] == 'print' and not (base / 'scratch').exists():
                    error = subprocess.TimeoutExpired(argv, kw.get('timeout'), output=b'PARTIAL_STDOUT\x00\xff', stderr=b'PARTIAL_STDERR\xfe')
                    error.futureAudit = {'unknown': [b'FUTURE\x80', {'path': private}]}
                    raised.append(error)
                    raise error
                return SimpleNamespace(args=argv, returncode=1, stdout='RAW_STDOUT', stderr='RAW_STDERR', futureField={'unknown': 'keep'})
            def kernel(_):
                calls.append('kernel')
                return {'live': 0, 'futureKernel': {'raw': 'keep'}}
            common = {'Path': Path, 'ROOT': base, 'SUPPORTED_PROFILE_PREFIXES': ('playwright_chromiumdev_profile-',),
                      'UnsafeCaptureGroup': RuntimeError, 'tempfile': tempfile, 'stat': stat, 'os': os, 're': re,
                      'shutil': shutil, 'kernel_tasks': kernel, 'identity': lambda _: None, 'utc': lambda: 'CPU_ONLY',
                      'subprocess': SimpleNamespace(run=command, check_output=lambda *a, **kw: ''),
                      'write': lambda p, v: p.write_text(json.dumps(v))}
            archive_ns, terminal_ns = dict(common), dict(common)
            exact(helpers_dir / 'round4_job_boundary.py', ['_archive_profile_paths'], archive_ns, 'archive')
            exact(helpers_dir / 'run_round4_remaining8.py', ['terminal_audit'], terminal_ns)
            timer_ns = {'signal': signal, 'time': time, 'contextmanager': contextmanager}
            exact(helpers_dir / 'round4_job_boundary.py', ['DeadlineExpired', 'deadline'], timer_ns)
            class Job:
                def __init__(self, out, *a, **kw):
                    self.out = Path(out); self.out.mkdir(); self.scratch = base / 'scratch'; self.scratch.mkdir()
                    (self.scratch / 'capture_stdout.txt').write_text('PARTIAL_CAPTURE_LOG')
                    self.coalition_id = 7; self.known = {}; self.target = 'CPU_ONLY_NO_LAUNCH'; self.registered = True
                    self.state = {'drained': True, 'clean': True, 'exits': {'capture': 0 if clean else 1, 'caffeinate': 0}, 'futureState': {'raw': 'keep'}}
                def start(self): calls.append('inert-start')
                def wait(self, *a):
                    calls.append('inert-capture')
                    output = Path(spec['output']); output.mkdir(exist_ok=True)
                    (output / '_frames').mkdir()
                    names = ['16x9' + suffix + '.png' for suffix in ('', '-kill', '-offscreen', '-start')]
                    names += ['_frames/%03d.jpg' % i for i in range(72)] + ['readout.txt', 'clip-sheet.png']
                    names += ['21x9' + suffix + '.png' for suffix in ('', '-kill', '-offscreen', '-start')]
                    for name in names: (output / name).write_bytes(('INERT CPU ARTIFACT ' + name).encode())
                    (evidence / 'entry-result.json').write_text(json.dumps({'writes': caller.inventory(output)}))
                    return 'completed'
                def drain(self, *a): calls.append('inert-drain'); return self.state.copy()
                def members(self): calls.append('members'); return []
            Job.archive = archive_ns['archive']
            def release(*a, **kw):
                calls.append('tmp-release'); private.rmdir()
                return {'namespace_removed': True, 'all_bytes_preserved': True, 'futureRelease': 'keep'}
            # Run the real helper timer in every case; shorten only the injected cleanup case.
            core = SimpleNamespace(StationJob=Job, identity=lambda _: {'uid': os.getuid()}, coalition=lambda _: [1, 2],
                                   deadline=lambda seconds: timer_ns['deadline'](0.02 if deadline_at and not cancel and seconds == 60 else seconds), kernel_tasks=kernel)
            temp = SimpleNamespace(executable_path=lambda _: sys.executable, create_private_tmp=lambda _: (private, {}), preserve_private_tmp=release)
            if allocation:
                allocation_ns = {'Path': Path, 'os': os, 'stat': stat, 'signal': signal, 'tempfile': tempfile,
                                 'PRIVATE_TMP_POLICY': {'parent': str(base), 'prefix': 'owned-', 'worst_case_tsx_pid': '999999', 'unix_socket_capacity': 104}}
                def fail_admission(p, value):
                    (Path(value['path']) / 'partial_native_bytes').write_bytes(b'RETAIN')
                    error = OSError('PRIMARY_ADMISSION_PROOF_ERROR'); error.futureAllocation = {'bytes': b'OWNER\xff'}
                    raised.append(error)
                    raise error
                allocation_ns['write'] = fail_admission
                exact(helpers_dir / 'run_round4_browser_proof.py', ['tmp_admission', 'create_private_tmp'], allocation_ns)
                temp.create_private_tmp = allocation_ns['create_private_tmp']
            support = SimpleNamespace(StageReceipts=lambda *a: SimpleNamespace(observe=lambda: None, require_browser=lambda: None), terminal_audit=terminal_ns['terminal_audit'])
            helpers = {'round4_job_boundary': core, 'run_round4_browser_proof': temp, 'run_round4_remaining8': support}
            ready = {'generatedCaches': [], 'stationDirectory': str(helpers_dir), 'uid': os.getuid(), 'node': 'NEVER_EXECUTED',
                     'path': 'CPU_ONLY', 'browserCache': 'NEVER_EXECUTED', 'root': str(base), 'decoderPython': 'NEVER_EXECUTED'}
            if producer is not None: producer(core, support, exact, helpers_dir, calls, raised, ready)
            spec = {'evidence': str(evidence), 'consumption': str(base / 'consumed.json'), 'authorizationId': 'CPU',
                    'output': str(base / 'output'), 'budget': {'fileCount': 82}}
            record = {'unit': 'first', 'head': 'CPU_HEAD', 'readinessSha256': 'CPU_SHA', 'authorizationId': 'CPU', 'spec': spec}
            ready_path = caller.READY
            first_unit, second_unit = 'fauna-hit-turn-day-16x9', 'fauna-hit-turn-day-21x9'
            first_grant = 'CPU_ONLY'
            if real_git:
                repo = base / 'repo'; repo.mkdir()
                def git(*args):
                    return subprocess.check_output(['/usr/bin/git', *args], cwd=repo, text=True, stderr=subprocess.PIPE).strip()
                git('init', '-q'); git('config', 'core.hooksPath', '/dev/null')
                (repo / 'source.txt').write_text('Tracked CPU source fixture\n')
                (repo / '.gitignore').write_text('*.cache\n')
                parent = repo / 'assets/renders/ui'; parent.mkdir(parents=True); (parent / '.keep').write_text('')
                evidence.rmdir()  # Actual consume requires every first-unit identity to be fresh.
                spec.update(output=str(parent / 'first-output'), grant=str(base / 'first-grant.json'))
                next_spec = {**spec, 'output': str(parent / 'second-output'), 'evidence': str(base / 'second-evidence'),
                             'consumption': str(base / 'second-consumed.json'), 'grant': str(base / 'second-grant.json'), 'authorizationId': 'CPU_SECOND'}
                ready.update(root=str(repo), git='/usr/bin/git', runtimeEnabled=True, unitOrder=[first_unit, second_unit], units={first_unit: spec, second_unit: next_spec})
                ready_path = repo / 'readiness.json'; ready_path.write_text(json.dumps(ready))
                git('add', '.'); git('-c', 'user.name=CPU fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'isolated sequence fixture')
                review = base / 'review'; review.write_text('CPU fixture only')
                first_grant = spec['grant']
                grant = {'purpose': 'FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY', 'oneUse': True, 'authorizationId': 'CPU',
                         'readinessSha256': caller.sha(ready_path), 'authorizedHead': git('rev-parse', 'HEAD'), 'unit': first_unit,
                         'nativeReservesAccepted': True, 'callerReview': {'verdict': 'PASS', 'path': str(review), 'sha256': caller.sha(review)},
                         'previousUnitsAccepted': [], 'previousUnitReceipts': {},
                         'expiresUtc': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)).isoformat()}
                Path(first_grant).write_text(json.dumps(grant))
            else:
                Path(spec['consumption']).write_text(json.dumps(record))  # No real grant/consume dispatch.
            original_persist, original_read, original_run, original_open = caller.persist, caller.read_json, caller.run_unit, Path.open
            original_fdopen = os.fdopen
            original_process_run = subprocess.run
            def persist(p, value):
                name = Path(p).name; writes.append(name)
                if name == deadline_at:
                    at_interrupt.extend(calls)
                    if cancel: raise KeyboardInterrupt('CANCEL_AT_RECEIPT')
                    time.sleep(0.2)  # The actual SIGALRM must interrupt this call.
                    self.fail('Real deadline did not fire')
                if all_sinks and (allocation and raised or 'inert-capture' in calls):
                    # With a final-close fault, allow the success candidate's real bytes first.
                    if not publication or name == 'failed-result.json': raise OSError('ENOSPC_' + name)
                value_written = original_persist(p, value)
                if name == 'result.json' and publication in ('after-publication', 'after-rename'):
                    if publication == 'after-rename':
                        temporary = Path(p).with_name('publication-staging.json')
                        Path(p).rename(temporary); temporary.rename(p)
                    raise OSError('FINAL_' + publication.upper() + '_AFTER_BYTES')
                return value_written
            class FaultyStream:
                def __init__(self, stream): self.stream = stream
                def __enter__(self): self.stream.__enter__(); return self
                def write(self, data):
                    value = self.stream.write(data)
                    if publication == 'after-write':
                        self.stream.flush()
                        raise OSError('FINAL_WRITE_ERROR_AFTER_BYTES')
                    return value
                def close(self):
                    self.stream.close()
                    if publication == 'after-close': raise OSError('FINAL_CLOSE_ERROR_AFTER_BYTES')
            def opened(fd, *a, **kw):
                stream = original_fdopen(fd, *a, **kw)
                result_path = evidence / 'result.json'
                is_result = a and a[0] == 'wb' and result_path.exists() and os.fstat(fd).st_ino == result_path.stat().st_ino
                return FaultyStream(stream) if publication in ('after-write', 'after-close') and is_result else stream
            def decoder(*a, **kw):
                if real_git and a[0][0] == '/usr/bin/git': return original_process_run(*a, **kw)
                calls.append('decoder')
                self.assertTrue(clean and not timeout and not deadline_at and not allocation and (not all_sinks or publication), 'Decoder dispatched after failure')
                return SimpleNamespace(args=a[0], returncode=0, stdout='{"accepted":true}', stderr='')
            def run(*a):
                value = original_run(*a); returned.append(value); return value
            class FailedSink:
                def write(self, _): raise OSError('STREAM_UNAVAILABLE')
            before_path = list(sys.path); caller._receipt_bytes = 0
            try:
                consumption_patch = patch.object(caller, 'consume', wraps=caller.consume) if real_git else patch.object(caller, 'consume', return_value=(spec, record))
                with patch.object(sys, 'argv', ['caller', '--execute', first_unit, '--grant', first_grant]), patch.object(caller, 'READY', ready_path), patch.dict(os.environ, {'FAUNA_CAPTURE_GRANT': 'CPU'}), patch.object(caller, 'read_json', side_effect=lambda p, *a, **kw: ready if p == caller.READY else original_read(p, *a, **kw)), consumption_patch as consumption, patch.object(caller, 'verify_bindings', return_value={'scope': 'INERT_CPU_FIXTURE'}), patch.object(caller, 'run_unit', side_effect=run), patch.object(caller, 'snapshot_caches'), patch.object(caller.importlib, 'import_module', side_effect=lambda n: helpers[n]), patch.object(caller, 'observed_thresholds', return_value={}), patch.object(caller, 'persist', side_effect=persist), patch.object(caller.subprocess, 'run', side_effect=decoder), patch.object(caller, 'verify_legacy'), patch.object(os, 'fdopen', opened), redirect_stderr(FailedSink() if all_sinks else io.StringIO()), redirect_stdout(FailedSink() if all_sinks else io.StringIO()):
                    exitcode = caller.main()
                self.assertEqual(consumption.call_count, 1)
            finally:
                sys.path[:] = before_path
            for ns in (archive_ns, terminal_ns):
                self.assertIs(ns['subprocess'], common['subprocess']); self.assertIs(ns['kernel_tasks'], kernel)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
            if real_git:
                next_grant = {**grant, 'unit': second_unit, 'authorizationId': next_spec['authorizationId'],
                              'previousUnitsAccepted': [first_unit], 'previousUnitReceipts': {first_unit: {
                                  'callerExitCode': exitcode, **{key: {'path': str(p), 'sha256': caller.sha(p)} for key, p in
                                  (('result', evidence / 'result.json'), ('consumption', Path(spec['consumption'])))}}}}
                Path(next_spec['grant']).write_text(json.dumps(next_grant))
                yield SimpleNamespace(base=base, repo=repo, spec=spec, ready=ready, ready_path=ready_path, git=git, result=returned[0],
                                      exitcode=exitcode, next_spec=next_spec, next_grant=next_grant, second_unit=second_unit, calls=calls)
                return
            review = base / 'review'; review.write_text('CPU fixture only')
            next_ready = {'runtimeEnabled': True, 'unitOrder': ['first', 'second'], 'units': {'first': spec, 'second': {'CPU': 'fixture'}}}
            grant = {'purpose': 'FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY', 'oneUse': True, 'authorizationId': 'CPU', 'readinessSha256': 'CPU_SHA', 'authorizedHead': 'CPU_HEAD', 'unit': 'second', 'nativeReservesAccepted': True,
                     'callerReview': {'verdict': 'PASS', 'path': str(review), 'sha256': caller.sha(review)}, 'previousUnitsAccepted': ['first'],
                     'expiresUtc': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)).isoformat()}
            yield SimpleNamespace(base=base, evidence=evidence, private=private, calls=calls, writes=writes, raised=raised,
                                  result=returned[0], exitcode=exitcode, at_interrupt=at_interrupt, next_ready=next_ready, grant=grant, spec=spec)

    def gate(self, case, grant):
        return caller.grant_gate(case.next_ready, 'second', grant, 'CPU_SHA', 'CPU_HEAD', 'CPU').spec

    def next_consumption(self, case):
        with patch.object(caller, 'READY', case.ready_path), patch.dict(os.environ, {'FAUNA_CAPTURE_GRANT': case.next_spec['authorizationId']}), patch.object(caller, 'verify_bindings', return_value={'scope': 'INERT_CPU_FIXTURE'}):
            return caller.consume(case.ready, case.second_unit, case.next_spec['grant'])

    def test_actual_bootstrap_and_observer_producers_survive_helper_and_all_sink_failures(self):
        for phase in ('bootstrap-0', 'bootstrap-17', 'bootstrap-timeout', 'observer-timeout', 'observer-cancel'):
            for all_sinks in (False, True):
                with self.subTest(phase=phase, all_sinks=all_sinks):
                    producer_facts = []
                    def producer(core, support, exact, helpers_dir, calls, raised, ready):
                        ready['resolver'] = {'selectedExecutable': {'path': 'INERT_BROWSER'}}
                        job_class, initialize = core.StationJob, core.StationJob.__init__
                        def init(job, *a, **kw):
                            initialize(job, *a, **kw);job.registered=False;job.root={'pid':1234567};job.state.update(exits={}, errors=[])
                        job_class.__init__ = init
                        def write(path, value):
                            raise OSError('SECONDARY_HELPER_WRITE')
                        namespace = {'signal': signal, 'time': time, 'contextmanager': contextmanager, 'write': write, 'os': os}
                        exact(helpers_dir / 'round4_job_boundary.py', ['DeadlineExpired', 'deadline'], namespace)
                        exact(helpers_dir / 'round4_job_boundary.py', [], namespace, 'save');job_class.save=namespace['save']
                        def command(argv, **kw):
                            calls.append('inert-capture')  # Also arms the existing all-sink injection.
                            if phase.endswith(('timeout', 'cancel')):
                                error = KeyboardInterrupt('ORIGINAL_CANCEL') if phase.endswith('cancel') else subprocess.TimeoutExpired(argv, 2, output=b'PRIMARY\x00\xff', stderr=b'STDERR\xfe')
                                error.unknown = {'recovery': b'FUTURE\x00\x80'};producer_facts.append(caller.failure(error));raised.append(error);raise error
                            value = SimpleNamespace(args=argv, returncode=17 if phase=='bootstrap-17' else 0, stdout=b'BOOT\x00\xff', stderr=b'ERR\xfe', unknown={'recovery': b'FUTURE\x80'})
                            producer_facts.append(caller.raw_value(value));return value
                        if phase.startswith('bootstrap'):
                            namespace['subprocess']=SimpleNamespace(run=command)
                            exact(helpers_dir / 'round4_job_boundary.py', [], namespace, 'start');job_class.start=namespace['start']
                        else:
                            exact(helpers_dir / 'round4_job_boundary.py', [], namespace, 'wait');job_class.wait=namespace['wait'];job_class.status=lambda job:job.state
                            job_class.members=lambda job:[] if producer_facts else [{'pid':1234567, 'birth':[1,2]}]
                            observer_ns={'Path':Path,'time':time,'json':json,'os':os,'re':re,'subprocess':SimpleNamespace(run=command),'write':write,'utc':lambda:'CPU_ONLY','failure':caller.failure}
                            exact(helpers_dir / 'run_round4_browser_proof.py', ['current_commands','parse_launch'], observer_ns)
                            exact(helpers_dir / 'run_round4_remaining8.py', ['StageReceipts'], observer_ns);support.StageReceipts=observer_ns['StageReceipts']
                    with self.boundary(all_sinks=all_sinks, producer=producer) as case:
                        result=case.result
                        self.assertEqual(case.exitcode, 1);self.assertFalse(result['accepted']);self.assertNotIn('decoder',case.calls)
                        self.assertEqual(case.calls.count('inert-capture'),1);self.assertEqual(len(producer_facts),1)
                        if phase.startswith('bootstrap'):
                            attempt=result['raw']['startAttempt'];self.assertTrue(attempt['registrationUncertain']);self.assertFalse(attempt['registered'])
                            self.assertEqual(len(attempt['commands']),1);self.assertEqual(attempt['target'],'CPU_ONLY_NO_LAUNCH');self.assertTrue(attempt['scratch']);self.assertTrue(attempt['output'])
                            row=attempt['commands'][0]
                            self.assertEqual(row['failure'] if phase.endswith('timeout') else row['returned'],producer_facts[0])
                            self.assertEqual(attempt['helperFailure']['message'], 'SECONDARY_HELPER_WRITE' if not phase.endswith('timeout') else producer_facts[0]['message'])
                        else:
                            self.assertEqual({k:v for k,v in result['raw']['captureObserver']['failure'].items() if k!='phase'},producer_facts[0])
                        if phase.endswith(('timeout','cancel')): self.assertEqual(result['primaryFailure'],producer_facts[0])
                        elif phase=='bootstrap-17': self.assertEqual(result['primaryFailure']['message'],'Owned launchd bootstrap failed')
                        else:self.assertEqual(result['primaryFailure']['message'],'SECONDARY_HELPER_WRITE')
                        if phase in ('bootstrap-17','observer-timeout'):self.assertTrue(any(x['message']=='SECONDARY_HELPER_WRITE' for x in result['secondaryFailures']))
                        if all_sinks:
                            self.assertEqual(result['publication']['status'],'UNABLE_TO_PERSIST_COMPLETE_RESULT')
                            self.assertTrue(any(x.get('receipt')=='stderr' for x in result['persistenceFailures']))
                        else:self.assertEqual(caller.read_json(case.evidence/'result.json')['primaryFailure'],result['primaryFailure'])

    def test_cache_destination_ancestor_and_leaf_races_never_write_foreign_bytes(self):
        for fault in ('parent-symlink', 'parent-regular', 'leaf-symlink', 'leaf-fifo', 'leaf-regular', 'mkdir-parent-symlink'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-copy-destination-') as temp:
                base=Path(temp).resolve();cache=base/'cache';(cache/'sub').mkdir(parents=True);(cache/'sub/payload').write_bytes(b'OWNED_BYTES')
                evidence=base/'evidence';evidence.mkdir();outside=base/'foreign';outside.mkdir();foreign=outside/'payload';foreign.write_bytes(b'FOREIGN')
                target=evidence/'cache-before-0/sub/payload';events=[];fds=[];real_open,real_mkdir=os.open,os.mkdir
                def attack():
                    events.append(fault)
                    if fault.startswith(('parent','mkdir')):
                        parent=target.parent if not fault.startswith('mkdir') else evidence/'cache-before-0'
                        parent.rename(base/'retained-parent')
                        if fault=='parent-regular':parent.mkdir()
                        else:parent.symlink_to(outside,target_is_directory=True)
                    elif fault=='leaf-symlink':target.symlink_to(foreign)
                    elif fault=='leaf-fifo':os.mkfifo(target)
                    else:target.write_bytes(b'FOREIGN')
                def open_at(name, flags, *a, **kw):
                    if str(name)=='payload' and flags & os.O_WRONLY and not events:attack()
                    fd=real_open(name,flags,*a,**kw);fds.append(fd);return fd
                def mkdir_at(name,*a,**kw):
                    if fault=='mkdir-parent-symlink' and str(name)=='sub' and not events:attack()
                    return real_mkdir(name,*a,**kw)
                with patch.object(os,'open',open_at),patch.object(os,'mkdir',mkdir_at):
                    with self.assertRaises((caller.Refused,OSError)) as caught:caller.snapshot_caches({'generatedCaches':[str(cache)],'budget':{'cacheSnapshotCapBytes':64}},evidence)
                self.assertEqual(events,[fault]);self.assertEqual(foreign.read_bytes(),b'FOREIGN');self.assertFalse((outside/'sub').exists())
                self.assertFalse((evidence/'cache-before.json').exists());self.assertFalse(caught.exception.cacheObservation['complete'])
                for fd in fds:
                    with self.assertRaises(OSError):os.fstat(fd)

    def test_actual_admission_uses_one_authenticated_snapshot_for_result_and_consumption(self):
        for key in ('result', 'consumption'):
            with self.subTest(key=key), self.boundary(clean=True, real_git=True) as case:
                self.assertEqual(case.exitcode, 0)
                first = case.ready['unitOrder'][0]
                reference = case.next_grant['previousUnitReceipts'][first][key]
                path = Path(reference['path']); success = path.read_bytes(); failed = json.loads(success)
                if key == 'result': failed.update(checksPassed=False, primaryFailure={'type': 'Refused', 'message': 'AUTHENTICATED_FAILURE'})
                else: failed['authorizationId'] = 'AUTHENTICATED_WRONG_TRANSACTION'
                failed_bytes = json.dumps(failed).encode(); path.write_bytes(failed_bytes)
                reference['sha256'] = caller.sha(path); Path(case.next_spec['grant']).write_text(json.dumps(case.next_grant))
                original_fdopen, original_read = os.fdopen, caller.read_json
                reads, schedule = [], []
                class Swapping:
                    def __init__(self, stream): self.stream = stream
                    def __enter__(self): self.stream.__enter__(); return self
                    def __exit__(self, *a): return self.stream.__exit__(*a)
                    def __getattr__(self, name): return getattr(self.stream, name)
                    def read(self, n=-1):
                        data = self.stream.read(n); reads.append((n, len(data)))
                        if not schedule:
                            path.write_bytes(success); schedule.append('replace-after-real-read')
                        return data
                def opened(fd, *a, **kw):
                    stream = original_fdopen(fd, *a, **kw)
                    return Swapping(stream) if os.fstat(fd).st_ino == path.stat().st_ino else stream
                def restore(p, *a, **kw):
                    value = original_read(p, *a, **kw)
                    if Path(p) == path: path.write_bytes(failed_bytes); schedule.append('restore-after-real-parse')
                    return value
                with patch.object(os, 'fdopen', opened), patch.object(caller, 'read_json', side_effect=restore), self.assertRaises(caller.Refused):
                    self.next_consumption(case)
                self.assertEqual(reads, [(len(failed_bytes) + 1, len(failed_bytes))])
                self.assertEqual(schedule, ['replace-after-real-read', 'restore-after-real-parse'])
                self.assertEqual(path.read_bytes(), failed_bytes)
                for field in ('output', 'evidence', 'consumption'): self.assertFalse(Path(case.next_spec[field]).exists())
                self.assertEqual(case.calls.count('inert-start'), 1)

    def test_actual_admission_metadata_caps_growth_encoding_hashes_and_unknown_fields(self):
        for key in ('grant', 'result', 'consumption'):
            for fault in ('exact-cap', 'oversized', 'growth', 'bad-utf8', 'bad-json', 'wrong-hash', 'unknown-fields', 'symlink', 'directory', 'after-snapshot-growth'):
                if key == 'grant' and fault == 'wrong-hash': continue  # Root grant has no external receipt reference.
                if key != 'grant' and fault == 'after-snapshot-growth': continue
                with self.subTest(key=key, fault=fault), self.boundary(clean=True, real_git=True) as case:
                    first = case.ready['unitOrder'][0]
                    reference = None if key == 'grant' else case.next_grant['previousUnitReceipts'][first][key]
                    path = Path(case.next_spec['grant'] if reference is None else reference['path'])
                    maximum = 16384 if key == 'grant' else 2 * 1024 * 1024
                    raw = path.read_bytes(); value = json.loads(raw)
                    if fault == 'exact-cap': raw += b' ' * (maximum - len(raw))
                    if fault == 'oversized': raw += b' ' * (8 * 1024 * 1024)
                    if fault == 'bad-utf8': raw = b'{"bad":"\xff"}'
                    if fault == 'bad-json': raw = b'{'
                    if fault == 'unknown-fields':
                        value['futureMetadata'] = {'unknown': [7, '\u2603', {'keep': True}]}; raw = json.dumps(value).encode()
                        if key == 'consumption':
                            rp = Path(case.next_grant['previousUnitReceipts'][first]['result']['path'])
                            result = json.loads(rp.read_bytes()); result['admission'] = value; rp.write_text(json.dumps(result))
                            case.next_grant['previousUnitReceipts'][first]['result']['sha256'] = caller.sha(rp)
                    path.write_bytes(raw)
                    if reference is not None:
                        if fault != 'wrong-hash': reference['sha256'] = caller.sha(path)
                        else: reference['sha256'] = '0' * 64
                        Path(case.next_spec['grant']).write_text(json.dumps(case.next_grant))
                    if fault in ('symlink', 'directory'):
                        saved = case.base / 'saved-metadata'; path.rename(saved)
                        if fault == 'symlink': path.symlink_to(saved)
                        else: path.mkdir()
                    original_open, original_fdopen, original_snapshot = Path.open, os.fdopen, caller.read_json_snapshot
                    reads, snapshots = [], []
                    class Measured:
                        def __init__(self, stream): self.stream = stream
                        def __enter__(self): self.stream.__enter__(); return self
                        def __exit__(self, *a): return self.stream.__exit__(*a)
                        def __getattr__(self, name): return getattr(self.stream, name)
                        def read(self, n=-1):
                            if fault == 'growth' and not reads:
                                with original_open(path, 'ab') as writer: writer.write(b' ' * (maximum + 9))
                            data = self.stream.read(n); reads.append((n, len(data))); return data
                    def opened(fd, *a, **kw):
                        stream = original_fdopen(fd, *a, **kw)
                        return Measured(stream) if os.fstat(fd).st_ino == path.stat().st_ino else stream
                    def observe(p, *a, **kw):
                        snapshot = original_snapshot(p, *a, **kw)
                        if Path(p) == path:
                            snapshots.append(snapshot)
                            if fault == 'after-snapshot-growth':
                                with original_open(path, 'ab') as writer: writer.write(b' ' * (8 * 1024 * 1024))
                        return snapshot
                    with patch.object(os, 'fdopen', opened), patch.object(caller, 'read_json_snapshot', side_effect=observe):
                        if fault in ('exact-cap', 'unknown-fields', 'after-snapshot-growth'):
                            _, record = self.next_consumption(case)
                            if key == 'grant': self.assertEqual(record['grantSha256'], snapshots[0][1])
                        else:
                            with self.assertRaises((caller.Refused, ValueError)): self.next_consumption(case)
                            for field in ('output', 'evidence', 'consumption'): self.assertFalse(Path(case.next_spec[field]).exists())
                    if fault in ('oversized', 'symlink', 'directory'): self.assertEqual(reads, [])
                    else:
                        self.assertEqual(len(reads), 1)
                        self.assertEqual(reads[0], (len(raw) + 1, len(raw) + 1 if fault == 'growth' else len(raw)))
                    if fault == 'unknown-fields': self.assertEqual(snapshots[0][0]['futureMetadata'], value['futureMetadata'])
                    if fault == 'after-snapshot-growth': self.assertNotEqual(record['grantSha256'], caller.sha(path))
                    self.assertEqual(case.calls.count('inert-start'), 1)

    def test_actual_admission_refuses_open_races_without_a_timer_or_descriptor_leak(self):
        for key in ('grant', 'result', 'consumption'):
            for fault in ('fifo', 'symlink', 'different-regular', 'directory', 'oversized'):
                with self.subTest(key=key, fault=fault), self.boundary(clean=True, real_git=True) as case:
                    first = case.ready['unitOrder'][0]
                    reference = None if key == 'grant' else case.next_grant['previousUnitReceipts'][first][key]
                    path = Path(case.next_spec['grant'] if reference is None else reference['path'])
                    original_open, original_close, original_fdopen = os.open, os.close, os.fdopen
                    descriptors, closed, flags_seen, swaps = [], [], [], []
                    def opened(p, flags, *a, **kw):
                        target = str(p) == path.name and 'dir_fd' in kw and os.fstat(kw['dir_fd']).st_ino == path.parent.stat().st_ino
                        if target:
                            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
                            flags_seen.append(flags)
                            if fault == 'oversized':
                                with path.open('ab') as writer: writer.write(b' ' * (2 * 1024 * 1024 + 1))
                            else:
                                saved = path.with_name(path.name + '.preserved'); path.rename(saved)
                                if fault == 'fifo': os.mkfifo(path, 0o600)
                                elif fault == 'symlink': path.symlink_to(saved)
                                elif fault == 'directory': path.mkdir()
                                else: path.write_bytes(saved.read_bytes())
                            swaps.append(fault)
                        fd = original_open(p, flags, *a, **kw)
                        if target: descriptors.append(fd)
                        return fd
                    def closed_fd(fd):
                        if fd in descriptors: closed.append(fd)
                        return original_close(fd)
                    def fdopen(fd, *a, **kw):
                        self.assertNotIn(fd, descriptors, 'Rejected metadata reached payload read')
                        return original_fdopen(fd, *a, **kw)
                    with patch.object(os, 'open', opened), patch.object(os, 'close', closed_fd), patch.object(os, 'fdopen', fdopen):
                        with self.assertRaises((caller.Refused, OSError)): self.next_consumption(case)
                    self.assertEqual(swaps, [fault])
                    self.assertTrue(all(flags & os.O_NONBLOCK and flags & os.O_NOFOLLOW for flags in flags_seen))
                    self.assertEqual(closed, descriptors)
                    for fd in descriptors:
                        with self.assertRaises(OSError): os.fstat(fd)
                    for field in ('output', 'evidence', 'consumption'): self.assertFalse(Path(case.next_spec[field]).exists())
                    self.assertEqual(case.calls.count('inert-start'), 1)

    def test_metadata_keeps_supplied_ancestor_identity_without_resolving_symlinks(self):
        with caller.controlled_path('/', directory=True) as (fd, info, _):
            self.assertTrue(stat.S_ISDIR(info.st_mode)); self.assertTrue(stat.S_ISDIR(os.fstat(fd).st_mode))
        with self.assertRaises(OSError): os.fstat(fd)
        for fault in ('static-alias', 'before-parent-open', 'before-leaf-open', 'same-file-new-parent'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-metadata-parent-') as temp:
                base = Path(temp).resolve();parent = base / 'parent';parent.mkdir();path = parent / 'value.json';path.write_text('{}')
                real_open, real_fdopen = os.open, os.fdopen;events = [];opened = []
                def replace():
                    saved = base / 'saved';parent.rename(saved)
                    if fault == 'same-file-new-parent':
                        parent.mkdir();os.link(saved / path.name, path)
                    else: parent.symlink_to(saved, target_is_directory=True)
                    events.append(fault)
                if fault == 'static-alias': replace()
                def open_at(name, flags, *a, **kw):
                    if str(name) == ('parent' if fault == 'before-parent-open' else path.name) and not events: replace()
                    fd = real_open(name, flags, *a, **kw)
                    if str(name) == path.name: opened.append(fd)
                    return fd
                def fdopen(fd, *a, **kw):
                    self.assertNotIn(fd, opened, 'Unsafe metadata route reached content read')
                    return real_fdopen(fd, *a, **kw)
                with patch.object(os, 'open', open_at), patch.object(os, 'fdopen', fdopen):
                    with self.assertRaises((caller.Refused, OSError)): caller.read_json(path)
                self.assertEqual(events, [fault])
                for fd in opened:
                    with self.assertRaises(OSError): os.fstat(fd)

    def test_metadata_descriptor_owner_preserves_primary_and_all_close_failures(self):
        for fault in ('success', 'empty', 'wrong-hash', 'fstat', 'fdopen', 'read', 'cancel', 'stream-close', 'descriptor-close', 'both-close', 'read-both-close', 'cancel-both-close'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-descriptor-') as tempdir:
                path = Path(tempdir) / 'metadata.json'; path.write_bytes(b'' if fault == 'empty' else b'{}')
                descriptors, closes, streams = [], [], []
                original_open, original_close, original_fdopen, original_fstat = os.open, os.close, os.fdopen, os.fstat
                primary = KeyboardInterrupt('PRIMARY_CANCEL') if fault.startswith('cancel') else OSError('PRIMARY_' + fault)
                primary.futureFact = {'bytes': b'RAW\x00\xff', 'unknown': [7]}
                def opened(*a, **kw):
                    fd = original_open(*a, **kw)
                    if str(a[0]) == path.name: descriptors.append(fd)
                    return fd
                def fstat(fd):
                    if fault == 'fstat' and fd in descriptors: raise primary
                    return original_fstat(fd)
                class Stream:
                    def __init__(self, stream): self.stream = stream; streams.append(stream)
                    def read(self, count):
                        if fault.startswith(('read', 'cancel')): raise primary
                        return self.stream.read(count)
                    def close(self):
                        self.stream.close(); closes.append('stream')
                        if fault == 'stream-close' or fault.endswith('both-close'):
                            error = OSError('STREAM_CLOSE_AFTER_REAL_CLOSE'); error.unknownStream = b'RAW_STREAM'; raise error
                def fdopen(*a, **kw):
                    if fault == 'fdopen': raise primary
                    return Stream(original_fdopen(*a, **kw))
                def close(fd):
                    original_close(fd)
                    if fd not in descriptors: return
                    closes.append('descriptor')
                    if fault == 'descriptor-close' or fault.endswith('both-close'):
                        error = OSError('FD_CLOSE_AFTER_REAL_CLOSE'); error.unknownDescriptor = b'RAW_FD'; raise error
                error = None
                with patch.object(os, 'open', opened), patch.object(os, 'fstat', fstat), patch.object(os, 'fdopen', fdopen), patch.object(os, 'close', close):
                    try:
                        value, digest = caller.read_json_snapshot(path, expected_sha256='0' * 64 if fault == 'wrong-hash' else None)
                    except BaseException as caught: error = caught
                self.assertEqual(len(descriptors), 1)
                self.assertEqual(closes.count('descriptor'), 1)
                for fd in descriptors:
                    with self.assertRaises(OSError): original_fstat(fd)
                self.assertTrue(all(stream.closed for stream in streams))
                if fault == 'success': self.assertIsNone(error); self.assertEqual(value, {}); continue
                self.assertIsNotNone(error)
                if fault.startswith(('read', 'cancel')) or fault in ('fstat', 'fdopen'):
                    self.assertIs(error, primary)
                    self.assertEqual(base64.b64decode(caller.failure(error)['attributes']['futureFact']['bytes']['base64']), b'RAW\x00\xff')
                if 'close' in fault:
                    facts = caller.failure(error)['attributes']['metadata_close_failures']
                    self.assertEqual([f['operation'] for f in facts], ['stream.close', 'os.close'] if fault.endswith('both-close') else [fault.replace('stream-close', 'stream.close').replace('descriptor-close', 'os.close')])
                    self.assertTrue(all(f['path'] == str(path) and f['descriptor'] == descriptors[0] for f in facts))
                    for fact in facts:
                        key = 'unknownStream' if fact['operation'] == 'stream.close' else 'unknownDescriptor'
                        self.assertIn('base64', fact['attributes'][key])

    def test_metadata_unbuffered_reads_keep_exact_caps_and_refuse_size_changes(self):
        for fault in ('empty-object', 'exact-cap', 'growth-sentinel', 'growth-within-cap', 'truncated'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='fauna-read-cap-') as tempdir:
                maximum = 64; path = Path(tempdir) / 'metadata.json'
                path.write_bytes(b'{}' + b' ' * (maximum - 2 if fault == 'exact-cap' else 8))
                original_fdopen = os.fdopen; reads = []
                class Stream:
                    def __init__(self, stream): self.stream = stream
                    def close(self): self.stream.close()
                    def read(self, n):
                        if fault.startswith('growth'):
                            with path.open('ab') as writer: writer.write(b' ' * (maximum if fault == 'growth-sentinel' else 1))
                        if fault == 'truncated': path.write_bytes(b'{}')
                        data = self.stream.read(n); reads.append((n, len(data))); return data
                with patch.object(os, 'fdopen', side_effect=lambda *a, **kw: Stream(original_fdopen(*a, **kw))):
                    if fault in ('empty-object', 'exact-cap'): self.assertEqual(caller.read_json(path, maximum), {})
                    else:
                        with self.assertRaises(caller.Refused): caller.read_json(path, maximum)
                self.assertEqual(len(reads), 1); self.assertEqual(reads[0][0], maximum + 1 if fault == 'exact-cap' else 11)
                self.assertLessEqual(reads[0][1], maximum + 1)
                if fault == 'growth-sentinel': self.assertEqual(reads[0][1], 11)

    def test_actual_artifact_admission_rejects_leaf_and_ancestor_races(self):
        for fault in ('fifo', 'symlink', 'regular', 'parent-symlink', 'parent-regular', 'parent-before-open'):
            with self.subTest(fault=fault), self.boundary(clean=True, real_git=True) as case:
                target = Path(case.spec['output']) / '_frames/000.jpg'
                original_open, original_fdopen = os.open, os.fdopen
                parent_inode = target.parent.stat().st_ino; events = []; opened = []
                def open_at(name, flags, *a, **kw):
                    selected = str(name) == ('_frames' if fault == 'parent-before-open' else target.name)
                    if selected and not events:
                        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
                        source = target.parent if fault.startswith('parent') else target
                        saved = case.base / 'preserved-raced-entry'; source.rename(saved)
                        if fault == 'fifo': os.mkfifo(source, 0o600)
                        elif fault in ('symlink', 'parent-symlink', 'parent-before-open'): source.symlink_to(saved, target_is_directory=fault.startswith('parent'))
                        elif fault == 'regular': source.write_bytes(saved.read_bytes())
                        else: shutil.copytree(saved, source)
                        events.append(fault)
                    fd = original_open(name, flags, *a, **kw)
                    if selected: opened.append(fd)
                    return fd
                def fdopen(fd, *a, **kw):
                    self.assertNotIn(fd, opened, 'Unsafe artifact reached a payload read')
                    return original_fdopen(fd, *a, **kw)
                with patch.object(os, 'open', open_at), patch.object(os, 'fdopen', fdopen):
                    with self.assertRaises((caller.Refused, OSError)): self.next_consumption(case)
                self.assertEqual(events, [fault]); self.assertEqual(case.calls.count('inert-start'), 1)
                for key in ('consumption', 'evidence', 'output'): self.assertFalse(Path(case.next_spec[key]).exists())
                for fd in opened:
                    with self.assertRaises(OSError): os.fstat(fd)

    def test_real_git_successor_admission_allows_only_exact_predecessor_artifacts(self):
        for mutation in ('none', 'unrelated', 'quoted-untracked', 'tracked-edit', 'staged-edit', 'modified-artifact',
                         'missing-artifact', 'extra-artifact', 'ignored-extra', 'extra-empty-directory', 'artifact-symlink',
                         'output-symlink', 'frames-symlink', 'unrelated-symlink', 'staged-artifact'):
            with self.subTest(mutation=mutation), self.boundary(clean=True, real_git=True) as case:
                self.assertEqual(case.exitcode, 0); self.assertTrue(case.result['accepted'])
                head = case.git('rev-parse', 'HEAD')
                self.assertEqual(case.result['admission']['head'], head)
                status = subprocess.check_output(['/usr/bin/git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd=case.repo)
                self.assertEqual(len([row for row in status.split(b'\0') if row]), 82)
                self.assertTrue(all(row.startswith(b'?? assets/renders/ui/first-output/') for row in status.split(b'\0') if row))
                self.assertEqual(subprocess.run(['/usr/bin/git', 'check-ignore', str(case.spec['output'])], cwd=case.repo, capture_output=True).returncode, 1)
                output = Path(case.spec['output']); artifact = output / '16x9.png'
                if mutation == 'unrelated': (case.repo / 'unexpected.txt').write_text('unrelated')
                elif mutation == 'quoted-untracked': (case.repo / 'unrelated "name\n.txt').write_text('unrelated')
                elif mutation in ('tracked-edit', 'staged-edit'):
                    (case.repo / 'source.txt').write_text('changed tracked source')
                    if mutation == 'staged-edit': case.git('add', 'source.txt')
                elif mutation == 'modified-artifact': artifact.write_bytes(b'X' + artifact.read_bytes()[1:])
                elif mutation == 'missing-artifact': artifact.unlink()
                elif mutation in ('extra-artifact', 'ignored-extra'): (output / ('extra.cache' if mutation == 'ignored-extra' else 'extra.png')).write_text('extra')
                elif mutation == 'extra-empty-directory': (output / 'extra').mkdir()
                elif mutation == 'artifact-symlink':
                    saved = case.base / 'saved-artifact'; artifact.rename(saved); artifact.symlink_to(saved)
                elif mutation in ('output-symlink', 'frames-symlink'):
                    target = output if mutation == 'output-symlink' else output / '_frames'
                    saved = case.base / 'saved-directory'; target.rename(saved); target.symlink_to(saved, target_is_directory=True)
                elif mutation == 'unrelated-symlink': (case.repo / 'unrelated-link').symlink_to(artifact)
                elif mutation == 'staged-artifact': case.git('add', str(artifact))
                consumption_before = Path(case.spec['consumption']).read_bytes()
                with patch.object(caller, 'READY', case.ready_path), patch.dict(os.environ, {'FAUNA_CAPTURE_GRANT': case.next_spec['authorizationId']}), patch.object(caller, 'verify_bindings', return_value={'scope': 'INERT_CPU_FIXTURE'}):
                    if mutation == 'none':
                        admitted, record = caller.consume(case.ready, case.second_unit, case.next_spec['grant'])
                        self.assertEqual(admitted, case.next_spec); self.assertEqual(record['head'], head)
                        self.assertTrue(Path(admitted['consumption']).is_file())
                    else:
                        with self.assertRaises(caller.Refused):
                            caller.consume(case.ready, case.second_unit, case.next_spec['grant'])
                        for key in ('output', 'evidence', 'consumption'): self.assertFalse(Path(case.next_spec[key]).exists())
                self.assertEqual(case.git('rev-parse', 'HEAD'), head)
                self.assertEqual(Path(case.spec['consumption']).read_bytes(), consumption_before)
                self.assertEqual(case.calls.count('inert-start'), 1)

    def completion(self, case):
        return {'callerExitCode': case.exitcode, **{key: {'path': str(path), 'sha256': caller.sha(path)}
                for key, path in (('result', case.evidence / 'result.json'), ('consumption', Path(case.spec['consumption'])))}}

    def test_real_deadline_and_cancellation_unwind_receipt_and_observed_release(self):
        for cancel in (False, True):
            for name in ('returned-drain.json', 'release-archive-01.json', 'release-archive-03.json', 'release-archive-result.json', 'release-terminal-03.json', 'release-terminal-result.json'):
                with self.subTest(cancel=cancel, receipt=name), self.boundary(deadline_at=name, cancel=cancel) as case:
                    self.assertEqual(case.exitcode, 1)
                    self.assertEqual(case.result['primaryFailure']['message'], 'Capture returned failure')
                    kind = 'KeyboardInterrupt' if cancel else 'DeadlineExpired'
                    self.assertEqual(case.result['cleanupFailures'][0]['type'], kind)
                    self.assertTrue(any(row['type'] == kind for row in case.result['persistenceFailures']))
                    self.assertEqual(case.calls, case.at_interrupt, 'A release/probe/decoder followed the abort')
                    if name in ('returned-drain.json', 'release-archive-01.json', 'release-archive-03.json'):
                        self.assertTrue(case.private.exists()); self.assertTrue((case.base / 'scratch').exists())
                    with self.assertRaises(caller.Refused): self.gate(case, case.grant)

    def test_failed_publication_never_authorizes_successor_at_actual_writer_and_gate(self):
        for fault, all_sinks in (('after-write', False), ('after-close', False), ('after-publication', False), ('after-rename', False), ('after-close', True), (None, True)):
            with self.subTest(fault=fault, all_sinks=all_sinks), self.boundary(publication=fault, all_sinks=all_sinks, clean=True) as case:
                self.assertEqual(case.exitcode, 1); self.assertFalse(case.result['accepted'])
                self.assertIn('failed-result.json', case.writes)
                with self.assertRaises(caller.Refused): self.gate(case, case.grant)
                if (case.evidence / 'result.json').exists():
                    self.assertFalse(caller.read_json(case.evidence / 'result.json')['accepted'])
                    self.assertTrue(case.result['checksPassed'])
                    with self.assertRaises(caller.Refused):
                        self.gate(case, {**case.grant, 'previousUnitReceipts': {'first': self.completion(case)}})
                if all_sinks:
                    self.assertEqual(case.result['publication']['status'], 'UNABLE_TO_PERSIST_COMPLETE_RESULT')
                    self.assertIsNone(case.result['publication']['completeReceipt'])
                    self.assertIn('STREAM_UNAVAILABLE', json.dumps(case.result))

    def test_successor_requires_parent_completion_and_exact_transaction_references(self):
        with self.boundary(clean=True) as case:
            self.assertEqual(case.exitcode, 0); self.assertTrue(case.result['accepted'])
            self.assertFalse(caller.read_json(case.evidence / 'result.json')['accepted'])
            with self.assertRaises(caller.Refused): self.gate(case, case.grant)
            completion = self.completion(case)
            grant = {**case.grant, 'previousUnitReceipts': {'first': completion}}
            self.assertEqual(self.gate(case, grant), {'CPU': 'fixture'})
            for key, value in (('callerExitCode', 1), ('callerExitCode', False), ('result', {**completion['result'], 'sha256': 'drift'}), ('consumption', {**completion['consumption'], 'path': '/wrong'})):
                with self.subTest(key=key, value=value), self.assertRaises(caller.Refused):
                    self.gate(case, {**grant, 'previousUnitReceipts': {'first': {**completion, key: value}}})
            result_path = case.evidence / 'result.json'
            candidate = caller.read_json(result_path)
            result_path.write_text(json.dumps({**candidate, 'accepted': True}))
            with self.assertRaisesRegex(caller.Refused, 'failed/indeterminate'):
                self.gate(case, {**grant, 'previousUnitReceipts': {'first': self.completion(case)}})
            result_path.write_text(json.dumps(candidate))
            grant['previousUnitReceipts']['first'] = self.completion(case)
            (case.evidence / 'failed-result.json').write_text('{"accepted":false}')
            with self.assertRaisesRegex(caller.Refused, 'failed publication'): self.gate(case, grant)

    def test_exception_bytes_unknown_fields_and_allocation_ownership_survive_all_sinks(self):
        for phase in ('archive', 'terminal', 'allocation'):
            for all_sinks in (False, True):
                with self.subTest(phase=phase, all_sinks=all_sinks), self.boundary(timeout=None if phase == 'allocation' else phase, allocation=phase == 'allocation', all_sinks=all_sinks) as case:
                    result = case.result
                    self.assertEqual(case.exitcode, 1); self.assertFalse(result['accepted']); self.assertNotIn('decoder', case.calls)
                    if phase == 'allocation':
                        self.assertNotIn('inert-start', case.calls)
                        facts = result['primaryFailure']['attributes']
                        allocation = facts['private_tmp_allocation']
                        self.assertEqual(allocation, case.raised[0].private_tmp_allocation)
                        self.assertEqual(allocation, result['raw']['privateTmpAllocation'])
                        self.assertEqual(allocation, result['cleanupFailures'][0]['allocation'])
                        self.assertFalse(allocation['released']); self.assertTrue(Path(allocation['path']).exists())
                        self.assertEqual(Path(allocation['path']).stat().st_ino, allocation['identity_at_allocation']['stamp'][1])
                        self.assertEqual(base64.b64decode(facts['futureAllocation']['bytes']['base64']), b'OWNER\xff')
                    else:
                        self.assertEqual(result['primaryFailure']['message'], 'Capture returned failure')
                        attempt = result['raw']['releaseAttempts'][phase]
                        facts = attempt['failure']['attributes']
                        self.assertEqual(facts, result['cleanupFailures'][0]['attributes'])
                        for key, value in (('stdout', b'PARTIAL_STDOUT\x00\xff'), ('output', b'PARTIAL_STDOUT\x00\xff'), ('stderr', b'PARTIAL_STDERR\xfe')):
                            self.assertEqual(base64.b64decode(facts[key]['base64']), value)
                        self.assertEqual(base64.b64decode(facts['futureAudit']['unknown'][0]['base64']), b'FUTURE\x80')
                        self.assertEqual(facts['futureAudit']['unknown'][1]['path'], str(case.private))
                    encoded = json.dumps(result)
                    self.assertLess(len(encoded.encode()), 1024 * 1024)
                    if all_sinks:
                        self.assertEqual(result['publication']['status'], 'UNABLE_TO_PERSIST_COMPLETE_RESULT')
                        self.assertIsNone(result['publication']['completeReceipt'])
                        for name in ('result.json', 'failed-result.json'): self.assertIn(name, case.writes)
                        self.assertIn('STREAM_UNAVAILABLE', encoded)
                    else:
                        durable = caller.read_json(case.evidence / 'result.json')
                        self.assertEqual(durable['primaryFailure'], result['primaryFailure'])
                        self.assertEqual(durable['cleanupFailures'], result['cleanupFailures'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
