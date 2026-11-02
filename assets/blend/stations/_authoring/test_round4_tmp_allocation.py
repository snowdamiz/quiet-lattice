"""Narrow CPU-only allocation/provenance failure controls. No job or launcher runs."""
import json
import os
from pathlib import Path
import signal
import unittest
from unittest.mock import patch

import run_round4_browser_proof as proof
from round4_job_boundary import DeadlineExpired

OUT = Path(os.environ['ROUND4_ALLOCATION_TEST_OUTPUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
RECORDS = []


def mask():
    return signal.pthread_sigmask(signal.SIG_BLOCK, set())


class AllocationControls(unittest.TestCase):
    def setUp(self):
        self.out = OUT / self._testMethodName; self.out.mkdir()
        self.created = []
        real = proof.tempfile.mkdtemp
        def remember(*args, **kwargs):
            path = real(*args, **kwargs); self.created.append(path); return path
        self.allocator = patch.object(proof.tempfile, 'mkdtemp', remember)
        self.allocator.start()

    def tearDown(self):
        self.allocator.stop()
        self.assertTrue(all(not Path(p).exists() for p in self.created), self.created)
        RECORDS.append({'test': self.id(), 'mode': 'CPU_ONLY_NO_JOB_OR_LAUNCHER', 'allocated_paths': self.created,
                        'all_exact_allocated_paths_absent': True})
        proof.write(OUT / 'fixtures.json', RECORDS)

    def execute_failure(self, *, nonempty=False, remove_first=False):
        original = proof.write
        primary = OSError('injected provenance write failure')
        at_write = []
        def failure(path, value):
            if Path(path).name == 'private_tmp_admission.json':
                at_write.append(sorted(mask()))
                root = Path(self.created[-1])
                if nonempty: (root / 'unexpected-owned-data').write_bytes(b'preserve CPU fixture bytes')
                if remove_first: root.rmdir()
                raise primary
            return original(path, value)
        class NeverConstruct:
            constructed = 0
            def __new__(cls):
                cls.constructed += 1
                raise AssertionError('No job may be constructed')
        with patch.multiple(proof, BASE=self.out / 'claims', RUN=self.out / 'runtime',
                            preflight=lambda: ({'authorization_id': 'CPU_ALLOCATION_FAILURE_ONLY'}, {})), patch.object(proof, 'write', failure):
            result = proof.execute(NeverConstruct)
        self.assertEqual(NeverConstruct.constructed, 0)
        self.assertEqual(at_write, [sorted(mask())])
        self.assertEqual(result['primary_failure'], {'type': 'OSError', 'message': str(primary)})
        proof.write(self.out / 'observed.json', {'result': result, 'job_constructed': 0,
                    'browser_or_process_launched': False, 'created': self.created,
                    'admission_exists': (self.out / 'runtime/private_tmp_admission.json').exists()})
        return result, primary

    def test_failed_receipt_rolls_back_exact_root_before_return(self):
        result, primary = self.execute_failure()
        self.assertEqual(result['teardown_status'], 'NO_JOB_CREATED')
        self.assertTrue(result['private_tmp_allocation_failure']['released'])
        self.assertEqual(primary.private_tmp_allocation['identity_at_allocation']['uid'], os.getuid())
        self.assertFalse(Path(self.created[0]).exists())

    def test_admission_exception_preserves_primary_and_removes_allocation(self):
        primary = ValueError('injected admission validation failure')
        with patch.object(proof, 'tmp_admission', side_effect=primary):
            try: proof.create_private_tmp(self.out / 'private_tmp_admission.json')
            except BaseException as observed: self.assertIs(observed, primary)
            else: self.fail('Expected original admission failure')
        self.assertTrue(primary.private_tmp_allocation['released'])

    def test_deferred_phase_exception_reaches_cleanup_and_restores_exact_mask(self):
        saved_mask, saved_handler = mask(), signal.getsignal(signal.SIGALRM)
        prior = (saved_mask | {signal.SIGUSR1}) - {signal.SIGALRM, signal.SIGINT}
        signal.pthread_sigmask(signal.SIG_SETMASK, prior)
        primary = DeadlineExpired('injected deferred phase cancellation')
        called = []
        def expired(*_): called.append('delivered'); raise primary
        signal.signal(signal.SIGALRM, expired)
        real = proof.tempfile.mkdtemp
        def allocation_then_pending(*args, **kwargs):
            path = real(*args, **kwargs)
            self.assertTrue({signal.SIGALRM, signal.SIGINT} <= mask())
            signal.raise_signal(signal.SIGALRM)
            self.assertFalse(called)
            return path
        try:
            with patch.object(proof.tempfile, 'mkdtemp', allocation_then_pending), patch.object(proof, 'write') as no_write:
                try: proof.create_private_tmp(self.out / 'private_tmp_admission.json')
                except BaseException as observed: self.assertIs(observed, primary)
                else: self.fail('Deferred cancellation must propagate')
                no_write.assert_not_called()
            self.assertEqual(mask(), prior)
            self.assertEqual(called, ['delivered'])
            self.assertTrue(primary.private_tmp_allocation['released'])
        finally:
            signal.signal(signal.SIGALRM, saved_handler)
            signal.pthread_sigmask(signal.SIG_SETMASK, saved_mask)

    def test_receipt_and_copy_work_run_with_original_signal_mask(self):
        prior = mask(); original = proof.write; seen = []
        def observed_write(path, value):
            seen.append(mask()); return original(path, value)
        with patch.object(proof, 'write', observed_write):
            path, admission = proof.create_private_tmp(self.out / 'private_tmp_admission.json')
        self.assertEqual(seen, [prior])
        original_copy = proof.shutil.copytree
        def observed_copy(*args, **kwargs):
            self.assertEqual(mask(), prior); return original_copy(*args, **kwargs)
        with patch.object(proof.shutil, 'copytree', observed_copy):
            proof.preserve_private_tmp(path, admission, self.out / 'preserved', no_process_launched=True)
        self.assertEqual(mask(), prior)

    def test_unproved_rollback_records_root_without_masking_primary(self):
        result, primary = self.execute_failure(nonempty=True)
        self.assertEqual(result['teardown_status'], 'UNPROVED')
        owner = result['retained_private_tmp']
        self.assertFalse(owner['released'])
        path = Path(owner['path']); self.assertTrue(path.exists())
        self.assertEqual((path / 'unexpected-owned-data').read_bytes(), b'preserve CPU fixture bytes')
        recovery = proof.preserve_private_tmp(path, proof.tmp_admission(path), self.out / 'explicit_fixture_recovery', no_process_launched=True)
        proof.write(self.out / 'fixture_recovery.json', recovery)
        self.assertEqual(result['primary_failure']['message'], str(primary))

    def test_unexpected_path_absence_is_recorded_unproved(self):
        result, _ = self.execute_failure(remove_first=True)
        self.assertEqual(result['teardown_status'], 'UNPROVED')
        self.assertTrue(result['retained_private_tmp']['path_absent'])
        self.assertFalse(result['retained_private_tmp']['released'])


if __name__ == '__main__': unittest.main()
