"""CPU-only parsing/gating/negative controls. Process receipts here are synthetic mocks."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import run_round4_browser_proof as proof

OUT = Path(os.environ['ROUND4_BROWSER_TEST_OUTPUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
(OUT / 'CPU_MOCKS_ONLY.txt').write_text('All browser/process receipts in this test directory are synthetic. No StationJob/browser/GPU/native capture is launched.\n')


class ProofControls(unittest.TestCase):
    def setUp(self):
        self.out = OUT / self._testMethodName
        self.out.mkdir()
        self.binary = '/CPU-MOCK-NOT-EXECUTED/chrome-headless-shell'
        self.profile = self.out / 'playwright_chromiumdev_profile-mock'
        self.log = f'pw:browser <launching> {self.binary} --use-angle=metal --user-data-dir={self.profile}\npw:browser <launched> pid=9001\n'

    def test_launch_profile_binary_and_positive_pid_parsing(self):
        value = proof.parse_launch(self.log, self.binary, self.out)
        self.assertEqual(value['pid'], 9001)
        self.assertEqual(value['profile'], str(self.profile))
        self.assertTrue(value['angle_metal_requested'])

    def test_partial_launch_retains_exact_profile_without_inventing_pid(self):
        value = proof.parse_launch(self.log.splitlines()[0], self.binary, self.out)
        self.assertIsNone(value['pid'])
        self.assertEqual(value['profile'], str(self.profile))
        self.assertIsNone(proof.parse_launch('', self.binary, self.out))

    def test_wrong_binary_duplicate_zero_negative_and_profile_rejected(self):
        variants = [self.log.replace(self.binary, '/unbound/browser'), self.log + self.log,
                    self.log.replace('pid=9001', 'pid=0'), self.log.replace('pid=9001', 'pid=-1'),
                    self.log.replace(str(self.profile), '/unowned/playwright_chromiumdev_profile-mock')]
        for log in variants:
            with self.assertRaises(AssertionError): proof.parse_launch(log, self.binary, self.out)

    def backend(self):
        return {'renderer': 'ANGLE Metal CPU-MOCK', 'viewport': [1920, 1080], 'canvas': [1, 1],
                'url': 'about:blank', 'assetLoaded': False, 'screenshot': False, 'measurement': False}

    def test_backend_requires_owned_log_match_and_minimal_work(self):
        good = self.backend()
        log = 'STATION_BROWSER_PROOF_BACKEND ' + json.dumps(good) + '\n'
        self.assertEqual(proof.backend_receipt(log, good), good)
        self.assertIsNone(proof.backend_receipt('', good))
        for key, value in [('renderer', 'SwiftShader'), ('viewport', [1, 1]), ('canvas', [2, 2]),
                           ('url', 'https://external.test'), ('assetLoaded', True), ('screenshot', True), ('measurement', True)]:
            changed = {**good, key: value}
            with self.assertRaises(AssertionError):
                proof.backend_receipt('STATION_BROWSER_PROOF_BACKEND ' + json.dumps(changed), changed)
        with self.assertRaises(AssertionError): proof.backend_receipt(log, {**good, 'url': 'other'})

    def observer_fixture(self):
        folder = self.out / 'probe'
        scratch = self.out / 'scratch'
        folder.mkdir(); scratch.mkdir()
        body = self.backend()
        (scratch / 'capture_stdout.txt').write_text(self.log + 'STATION_BROWSER_PROOF_BACKEND ' + json.dumps(body) + '\n')
        (folder / 'ready_for_kernel_receipts.json').write_text(json.dumps(body))
        roles = ['browser', 'gpu-process', 'renderer', 'utility']
        rows = [{'pid': 9001 + n, 'ppid': 8001, 'pgid': 9001, 'uid': os.getuid(), 'birth': [100, n], 'status': 2,
                 'coalition': [999991, 999992]} for n in range(4)]
        class FakeJob:
            state = {}
            coalition_id = 999991
            def save(self): pass
            def members(self): return rows
        job = FakeJob(); job.scratch = scratch
        commands = {r['pid']: self.binary + (' --use-angle=metal' if role == 'browser' else f' --type={role}') for r, role in zip(rows, roles)}
        resolver = {'selectedExecutable': {'path': self.binary}, 'installedBinaryAndLibraryCandidates': [{'path': self.binary}]}
        observer = proof.BrowserReceipts(job, folder, resolver, {self.binary: 'frozen-mock-sha'}, self.out)
        return observer, rows, commands

    def observe_patches(self, rows, commands, current=None):
        mapping = {r['pid']: r for r in rows}
        return patch.multiple(proof, current_commands=lambda _: commands, identity=current or (lambda pid: mapping.get(pid)),
                              coalition=lambda _: [999991, 999992], executable_path=lambda _: self.binary,
                              sha=lambda _: 'frozen-mock-sha')

    def test_complete_current_receipts_release_barrier_once(self):
        observer, rows, commands = self.observer_fixture()
        with self.observe_patches(rows, commands): observer.observe(); observer.observe()
        self.assertTrue(observer.released)
        self.assertTrue((observer.output / 'kernel_receipts_ready').exists())
        self.assertEqual(observer.receipt['external_native_XPC_service_ownership'].split(';')[0], 'UNQUALIFIED')
        self.assertFalse(observer.receipt['all_ever_lived_processes_observed'])

    def test_missing_helper_keeps_barrier_closed(self):
        observer, rows, commands = self.observer_fixture()
        rows.pop()
        with self.observe_patches(rows, commands): observer.observe()
        self.assertFalse(observer.released)
        self.assertFalse((observer.output / 'kernel_receipts_ready').exists())

    def test_current_birth_or_cohort_change_never_acknowledged(self):
        observer, rows, commands = self.observer_fixture()
        mapping = {r['pid']: r for r in rows}
        with self.observe_patches(rows, commands, lambda pid: {**mapping[pid], 'birth': [0, 0]}):
            with self.assertRaises(AssertionError): observer.observe()
        self.assertFalse(observer.released)
        with self.observe_patches(rows, commands):
            with patch.object(proof, 'coalition', lambda _: [4444, 4445]):
                with self.assertRaises(AssertionError): observer.observe()
        self.assertFalse((observer.output / 'kernel_receipts_ready').exists())

    def test_unbound_helper_executable_never_acknowledged(self):
        observer, rows, commands = self.observer_fixture()
        with self.observe_patches(rows, commands):
            with patch.object(proof, 'executable_path', lambda _: '/unbound/helper'):
                with self.assertRaises(AssertionError): observer.observe()
        self.assertFalse(observer.released)

    def test_absent_grant_direct_entry_refuses_before_job_or_consumption(self):
        with patch.object(proof, 'GRANT', self.out / 'absent'):
            with self.assertRaises(AssertionError): proof.preflight(self.out / 'absent')
        with patch.object(proof, 'preflight', side_effect=AssertionError('No grant')):
            class MustNotConstruct:
                def __new__(cls): raise AssertionError('constructed')
            with self.assertRaisesRegex(AssertionError, 'No grant'): proof.execute(MustNotConstruct)

    def test_atomic_consumption_refuses_concurrent_or_later_retry(self):
        grant = {'authorization_id': 'CPU-MOCK-ONLY'}
        def attempt():
            try: return str(proof.consume(grant, self.out / 'claims'))
            except FileExistsError: return 'REFUSED'
        with ThreadPoolExecutor(max_workers=2) as pool: outcomes = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(outcomes.count('REFUSED'), 1)
        self.assertEqual(attempt(), 'REFUSED')

    def test_preflight_checks_grant_drift_output_and_exact_resolver(self):
        file = self.out / 'input'; file.write_text('bound input')
        resolver = {'spawnCalls': [], 'validatedHeadless': True, 'selectedRegistryName': 'chromium-headless-shell'}
        ready = {'runtime_output': str(self.out / 'runtime'), 'capture_seconds': 30, 'cleanup_seconds': 30,
                 'input_sha256': {str(file): proof.sha(file)}, 'resolver_argv': ['CPU-MOCK-RESOLVER'], 'resolver': resolver,
                 'pnpm_executable': str(Path(shutil.which('pnpm')).resolve())}
        ready['python_executable'] = str(Path(sys.executable).resolve())
        readiness = self.out / 'ready.json'; proof.write(readiness, ready)
        grant = {'authorization_id': 'CPU-MOCK-ONLY', 'purpose': 'ASSET_FREE_CHROMIUM_BOUNDARY_PROOF_ONLY',
                 'readiness_sha256': proof.sha(readiness), 'runner_sha256': proof.sha(proof.__file__), 'authorized_head': 'CPU-MOCK-HEAD'}
        grantfile = self.out / 'grant.json'; proof.write(grantfile, grant)
        def checked(argv, **_):
            if argv == ['git', 'rev-parse', 'HEAD']: return 'CPU-MOCK-HEAD\n'
            if argv == ['git', 'branch', '--show-current']: return 'task/P1-E11-T01\n'
            self.assertEqual(argv, ['CPU-MOCK-RESOLVER'])
            return json.dumps(resolver)
        with patch.dict(os.environ, STATION_BROWSER_PROOF_GRANT='CPU-MOCK-ONLY'), patch.object(proof.subprocess, 'check_output', checked):
            self.assertEqual(proof.preflight(grantfile, readiness, self.out / 'runtime'), (grant, ready))
            proof.write(grantfile, {**grant, 'purpose': 'STATION_CAPTURE'})
            with self.assertRaises(AssertionError): proof.preflight(grantfile, readiness, self.out / 'runtime')
            proof.write(grantfile, grant)
            file.write_text('changed')
            with self.assertRaises(AssertionError): proof.preflight(grantfile, readiness, self.out / 'runtime')
            file.write_text('bound input')
            (self.out / 'runtime').mkdir()
            with self.assertRaises(AssertionError): proof.preflight(grantfile, readiness, self.out / 'runtime')
            (self.out / 'runtime').rmdir()
            resolver['selectedRegistryName'] = 'chromium'
            with self.assertRaises(AssertionError): proof.preflight(grantfile, readiness, self.out / 'runtime')

    def test_owned_executable_permission_failure_holds_receipt_barrier(self):
        observer, rows, commands = self.observer_fixture()
        with self.observe_patches(rows, commands):
            with patch.object(proof, 'executable_path', side_effect=PermissionError('CPU-MOCK permission denial')):
                with self.assertRaises(PermissionError): observer.observe()
        self.assertFalse(observer.released)
        self.assertFalse((observer.output / 'kernel_receipts_ready').exists())

    def mocked_execution(self, archive_error=False, bad_profile=False, constructor_error=False, exit_code=7, outcome='completed'):
        class FakeJob:
            constructed = drained = archived = 0
            def __init__(self, out, *_args, **_kwargs):
                type(self).constructed += 1
                self.out = out; out.mkdir()
                if constructor_error:
                    self.scratch = Path(tempfile.mkdtemp(prefix='stations-round4-owned-'))
                    (self.scratch / 'constructor.txt').write_text('CPU MOCK constructor failure')
                    raise RuntimeError('mock constructor failure')
                self.scratch = out / 'scratch'; self.scratch.mkdir()
                (self.scratch / 'capture_stdout.txt').write_text('MOCK log')
                self.coalition_id = 999991; self.state = {}; self.target = 'CPU-MOCK-NOT-REGISTERED'
            def start(self): pass
            def save(self): pass
            def wait(self, *_): return outcome
            def status(self): return {'exits': {'capture': exit_code, 'caffeinate': 0}}
            def drain(self, *_):
                type(self).drained += 1
                return {'exits': {'capture': exit_code, 'caffeinate': 0}, 'drained': True, 'clean': True}
            def archive(self, **_kwargs):
                type(self).archived += 1
                if archive_error: raise RuntimeError('mock archive failure')
                proof.write(self.out / 'profile_release.json', {'all_absent': True, 'owned_logged_profiles': []})
        class FakeObserver:
            released = False; receipt = None
            def __init__(self, *_): pass
            def observe(self): pass
            def bind_profile(self, *_):
                if bad_profile: raise ValueError('mock rejected profile')
        grant = {'authorization_id': 'CPU-MOCK-ONLY'}
        ready = {'payload_sha256': 'mock', 'argv': [], 'resolver': {}, 'process_binary_sha256': {}, 'temporary_root': str(self.out / 'execution/private_profiles')}
        patches = patch.multiple(proof, BASE=self.out / 'claims', RUN=self.out / 'execution',
                                 preflight=lambda: (grant, ready), BrowserReceipts=FakeObserver)
        return FakeJob, patches

    def test_primary_failure_retained_when_archive_also_fails(self):
        fake, patches = self.mocked_execution(archive_error=True)
        with patches: result = proof.execute(fake)
        self.assertIn('exit=7', result['primary_failure']['message'])
        self.assertIn('archive failure', result['teardown_failure']['message'])
        self.assertEqual(fake.drained, 1)
        self.assertFalse(result['observed_chromium_boundary_qualified'])

    def test_profile_failure_does_not_abandon_cohort_drain_or_archive_unbound_path(self):
        fake, patches = self.mocked_execution(bad_profile=True)
        with patches, patch.object(proof.subprocess, 'run') as stopped:
            stopped.return_value.returncode = 3
            result = proof.execute(fake)
        self.assertEqual(fake.drained, 1)
        self.assertEqual(fake.archived, 0)
        self.assertIn('exit=7', result['primary_failure']['message'])
        self.assertIn('profile binding unproved', result['teardown_failure']['message'])

    def test_constructor_failure_preserves_scratch_without_claiming_child_exits(self):
        fake, patches = self.mocked_execution(constructor_error=True)
        before = set(Path(tempfile.gettempdir()).glob('stations-round4-owned-*'))
        with patches: result = proof.execute(fake)
        self.assertEqual(result['capture_exit'], 'UNKNOWN')
        self.assertEqual(result['caffeinate_exit'], 'UNKNOWN')
        self.assertEqual(fake.drained, 0)
        self.assertEqual(set(Path(tempfile.gettempdir()).glob('stations-round4-owned-*')), before)
        self.assertTrue((self.out / 'execution/partial_constructor_scratch/constructor.txt').exists())

    def test_failed_attempt_is_permanently_consumed(self):
        fake, patches = self.mocked_execution()
        with patches:
            first = proof.execute(fake)
            self.assertEqual(first['status'], 'PERMANENT_HOLD')
            with self.assertRaises(FileExistsError): proof.execute(fake)
        self.assertEqual(fake.constructed, 1)

    def test_timeout_retains_unknown_status_and_holds_attempt(self):
        fake, patches = self.mocked_execution(exit_code='UNKNOWN', outcome='timed_out')
        with patches: result = proof.execute(fake)
        self.assertEqual(result['capture_exit'], 'UNKNOWN')
        self.assertEqual(result['capture_outcome'], 'timed_out')
        self.assertEqual(result['status'], 'PERMANENT_HOLD')
        self.assertFalse(result['observed_chromium_boundary_qualified'])

    def test_cli_and_payload_refuse_missing_grant_without_browser_launch(self):
        runner = subprocess.run([sys.executable, str(Path(proof.__file__))], capture_output=True, text=True, timeout=3)
        self.assertNotEqual(runner.returncode, 0)
        self.assertIn('gate closed', runner.stderr)
        env = {k: v for k, v in os.environ.items() if not k.startswith('STATION_BROWSER_PROOF_')}
        payload = subprocess.run(['node', str(Path(proof.__file__).with_name('round4_browser_probe.mjs'))],
                                 env=env, capture_output=True, text=True, timeout=3)
        self.assertNotEqual(payload.returncode, 0)
        self.assertIn('No proof admission/grant', payload.stderr)

    def test_payload_exact_standard_call_and_no_production_work(self):
        source = Path(proof.__file__).with_name('round4_browser_probe.mjs').read_text()
        self.assertIn('chromium.launch({ args })', source)
        for forbidden in ('headless:', 'executablePath:', 'channel:', '.screenshot(', '.perf(', 'startVite(', '.glb'):
            self.assertNotIn(forbidden, source)
        self.assertIn("page.goto('about:blank')", source)
        self.assertIn('width: 1920, height: 1080', source)
        self.assertIn('Date.now() + 5000', source)
        self.assertIn("{ flag: 'wx' }", source)
        subprocess.run(['node', '--check', str(Path(proof.__file__).with_name('round4_browser_probe.mjs'))], check=True, timeout=3)


if __name__ == '__main__': unittest.main()
