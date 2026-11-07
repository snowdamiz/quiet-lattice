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
            for changed in ({'grant': str(grant) + '.wrong'}, {'authorizationId': 'wrong'}):
                with self.subTest(changed=changed), patch.object(caller, 'grant_gate', return_value={**spec, **changed}), patch.object(caller.subprocess, 'check_output', return_value='head'), patch.object(caller, 'verify_bindings', side_effect=AssertionError('verification reached')), patch.object(caller, 'persist', side_effect=AssertionError('allocation reached')):
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
            self.assertEqual(caller.grant_gate(ready, 'first', grant, 'frozen', 'head', 'cpu-test'), {'screen': 'first'})
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
            base = Path(temp)
            cache, evidence = base / 'cache', base / 'evidence'
            cache.mkdir(); evidence.mkdir()
            source = cache / 'mutable-cache.bin'
            source.write_bytes(b'a' * 1024)
            original_inventory = caller.inventory
            grown = False
            def inventory_then_grow(root):
                nonlocal grown
                before = original_inventory(root)
                if Path(root) == cache and not grown:
                    source.write_bytes(b'a' * 16384)
                    grown = True
                return before
            with patch.object(caller, 'inventory', side_effect=inventory_then_grow):
                with self.assertRaisesRegex(caller.Refused, 'Generated cache changed during snapshot'):
                    caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
            copied = evidence / 'cache-before-0/mutable-cache.bin'
            self.assertLessEqual(copied.stat().st_size, 4096)
            self.assertEqual(copied.read_bytes(), b'a' * 1024)
            self.assertEqual(source.read_bytes(), b'a' * 16384)
            self.assertFalse((evidence / 'cache-before.json').exists())

    def test_multiple_caches_and_files_copy_at_the_exact_aggregate_boundary(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp)
            caches, evidence = [base / 'cache0', base / 'cache1'], base / 'evidence'
            for directory in [*caches, evidence]:
                directory.mkdir()
            (caches[0] / 'a').write_bytes(b'a' * 7)
            (caches[0] / 'b').write_bytes(b'b' * 5)
            (caches[1] / 'c').write_bytes(b'c' * 4)
            (caches[1] / 'empty').write_bytes(b'')
            original = [caller.inventory(root) for root in caches]
            rows = caller.snapshot_caches({'generatedCaches': list(map(str, caches)), 'budget': {'cacheSnapshotCapBytes': 16}}, evidence)
            self.assertEqual([row['files'] for row in rows], original)
            self.assertEqual([caller.inventory(root) for root in caches], original)
            copied = [caller.inventory(evidence / ('cache-before-' + str(i))) for i in range(2)]
            self.assertEqual(copied, original)
            self.assertEqual(sum(row['bytes'] for files in copied for row in files), 16)
            self.assertEqual(json.loads((evidence / 'cache-before.json').read_text()), rows)

    def test_overremaining_file_refuses_before_writing_and_retains_prior_copies(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp)
            caches, evidence = [base / 'cache0', base / 'cache1'], base / 'evidence'
            for directory in [*caches, evidence]:
                directory.mkdir()
            (caches[0] / 'a').write_bytes(b'a' * 7)
            (caches[0] / 'b').write_bytes(b'b' * 5)
            (caches[1] / 'overremaining').write_bytes(b'c' * 4)
            original = [caller.inventory(root) for root in caches]
            with self.assertRaisesRegex(caller.Refused, 'exceeds controlled cap'):
                caller.snapshot_caches({'generatedCaches': list(map(str, caches)), 'budget': {'cacheSnapshotCapBytes': 15}}, evidence)
            self.assertEqual(caller.inventory(evidence / 'cache-before-0'), original[0])
            self.assertFalse((evidence / 'cache-before-1/overremaining').exists())
            self.assertEqual([caller.inventory(root) for root in caches], original)
            self.assertFalse((evidence / 'cache-before.json').exists())

    def test_shrink_and_same_size_mutation_retain_failed_copy_without_success_receipt(self):
        for changed in (b'a' * 1024, b'b' * 4096):
            with self.subTest(changedBytes=len(changed)), tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
                base = Path(temp)
                cache, evidence = base / 'cache', base / 'evidence'
                cache.mkdir(); evidence.mkdir()
                source = cache / 'mutable-cache.bin'
                source.write_bytes(b'a' * 4096)
                original_inventory = caller.inventory
                changed_once = False
                def inventory_then_change(root):
                    nonlocal changed_once
                    before = original_inventory(root)
                    if Path(root) == cache and not changed_once:
                        source.write_bytes(changed)
                        changed_once = True
                    return before
                with patch.object(caller, 'inventory', side_effect=inventory_then_change):
                    with self.assertRaisesRegex(caller.Refused, 'Generated cache changed during snapshot'):
                        caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
                self.assertEqual((evidence / 'cache-before-0/mutable-cache.bin').read_bytes(), changed)
                self.assertEqual(source.read_bytes(), changed)
                self.assertFalse((evidence / 'cache-before.json').exists())

    def test_snapshot_deadline_interrupts_inventory_and_restores_alarm(self):
        with tempfile.TemporaryDirectory(prefix='fauna-cpu-') as temp:
            base = Path(temp)
            cache, evidence = base / 'cache', base / 'evidence'
            cache.mkdir(); evidence.mkdir()
            (cache / 'source').write_bytes(b'preserve')
            previous = caller.signal.getsignal(caller.signal.SIGALRM)
            with patch.object(caller, 'CACHE_SNAPSHOT_SECONDS', 0.01), patch.object(caller, 'inventory', side_effect=lambda root: time.sleep(1)):
                with self.assertRaisesRegex(caller.Refused, 'snapshot deadline expired'):
                    caller.snapshot_caches({'generatedCaches': [str(cache)], 'budget': {'cacheSnapshotCapBytes': 4096}}, evidence)
            self.assertEqual(caller.signal.getsignal(caller.signal.SIGALRM), previous)
            self.assertEqual((cache / 'source').read_bytes(), b'preserve')
            self.assertFalse((evidence / 'cache-before.json').exists())


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
                    with self.assertRaises((OSError, SyntaxError)):
                        inspector.decode_image(file, (8, 6), fmt)

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
            with self.assertRaisesRegex(ValueError, 'Missing/extra'):
                inspector.inspect(ready, unit)
            (output / 'extra.png').unlink()
            (output / 'extra-directory').mkdir()
            with self.assertRaisesRegex(ValueError, 'Unexpected output directory'):
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
            original_open = Path.open
            class CloseError:
                def __enter__(self): self.stream = original_open(path, 'xb'); return self.stream
                def __exit__(self, *a): self.stream.close(); raise OSError('AFTER_CLOSE')
            try:
                caller._receipt_bytes = 32 * 1024 * 1024 - size
                with patch.object(Path, 'open', return_value=CloseError()), self.assertRaisesRegex(OSError, 'AFTER_CLOSE'):
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
                 publication=None, all_sinks=False, clean=False):
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
                def wait(self, *a): calls.append('inert-capture'); return 'completed'
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
            spec = {'evidence': str(evidence), 'consumption': str(base / 'consumed.json'), 'authorizationId': 'CPU'}
            record = {'unit': 'first', 'head': 'CPU_HEAD', 'readinessSha256': 'CPU_SHA', 'authorizationId': 'CPU', 'spec': spec}
            Path(spec['consumption']).write_text(json.dumps(record))  # Synthetic transaction, no consume/grant dispatch.
            original_persist, original_read, original_run, original_open = caller.persist, caller.read_json, caller.run_unit, Path.open
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
                def __exit__(self, *a):
                    self.stream.__exit__(*a)
                    if publication == 'after-close': raise OSError('FINAL_CLOSE_ERROR_AFTER_BYTES')
            def opened(p, *a, **kw):
                stream = original_open(p, *a, **kw)
                return FaultyStream(stream) if publication in ('after-write', 'after-close') and p.name == 'result.json' and a and a[0] == 'xb' else stream
            def decoder(*a, **kw):
                calls.append('decoder')
                self.assertTrue(clean and not timeout and not deadline_at and not allocation and (not all_sinks or publication), 'Decoder dispatched after failure')
                return SimpleNamespace(args=a[0], returncode=0, stdout='{"accepted":true}', stderr='')
            def run(*a):
                value = original_run(*a); returned.append(value); return value
            class FailedSink:
                def write(self, _): raise OSError('STREAM_UNAVAILABLE')
            before_path = list(sys.path); caller._receipt_bytes = 0
            try:
                with patch.object(sys, 'argv', ['caller', '--execute', 'fauna-hit-turn-day-16x9', '--grant', 'CPU_ONLY']), patch.object(caller, 'read_json', side_effect=lambda p, *a: ready if p == caller.READY else original_read(p, *a)), patch.object(caller, 'consume', return_value=(spec, record)) as consumption, patch.object(caller, 'run_unit', side_effect=run), patch.object(caller, 'snapshot_caches'), patch.object(caller.importlib, 'import_module', side_effect=lambda n: helpers[n]), patch.object(caller, 'observed_thresholds', return_value={}), patch.object(caller, 'persist', side_effect=persist), patch.object(caller.subprocess, 'run', side_effect=decoder), patch.object(caller, 'verify_legacy'), patch.object(Path, 'open', opened), redirect_stderr(FailedSink() if all_sinks else io.StringIO()), redirect_stdout(FailedSink() if all_sinks else io.StringIO()):
                    exitcode = caller.main()
                self.assertEqual(consumption.call_count, 1)
            finally:
                sys.path[:] = before_path
            for ns in (archive_ns, terminal_ns):
                self.assertIs(ns['subprocess'], common['subprocess']); self.assertIs(ns['kernel_tasks'], kernel)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
            review = base / 'review'; review.write_text('CPU fixture only')
            next_ready = {'runtimeEnabled': True, 'unitOrder': ['first', 'second'], 'units': {'first': spec, 'second': {'CPU': 'fixture'}}}
            grant = {'purpose': 'FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY', 'oneUse': True, 'authorizationId': 'CPU', 'readinessSha256': 'CPU_SHA', 'authorizedHead': 'CPU_HEAD', 'unit': 'second', 'nativeReservesAccepted': True,
                     'callerReview': {'verdict': 'PASS', 'path': str(review), 'sha256': caller.sha(review)}, 'previousUnitsAccepted': ['first'],
                     'expiresUtc': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)).isoformat()}
            yield SimpleNamespace(base=base, evidence=evidence, private=private, calls=calls, writes=writes, raised=raised,
                                  result=returned[0], exitcode=exitcode, at_interrupt=at_interrupt, next_ready=next_ready, grant=grant, spec=spec)

    def gate(self, case, grant):
        return caller.grant_gate(case.next_ready, 'second', grant, 'CPU_SHA', 'CPU_HEAD', 'CPU')

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
