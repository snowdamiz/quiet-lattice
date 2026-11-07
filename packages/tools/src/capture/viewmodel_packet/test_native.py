"""Recovered helper bodies with inert command ports; never native launch."""
import importlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import boundary
import bindings
import native

sys.path.insert(0, str(bindings.HELPERS))
job_module = importlib.import_module('round4_job_boundary')
proof = importlib.import_module('run_round4_browser_proof')
stages = importlib.import_module('run_round4_remaining8')


class NativeControls(unittest.TestCase):
    def test_archive_retains_raw_print_failure_before_assertion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); scratch = root / 'scratch'; scratch.mkdir(); out = root / 'out'; out.mkdir()
            private = root / 'private'; private.mkdir(mode=0o700)
            job = job_module.StationJob.__new__(job_module.StationJob)
            job.state = {'drained': True, 'profiles': []}; job.scratch = scratch; job.out = out; job.target = 'INERT-never-launch'
            evidence = {'helperCalls': []}
            def inert(argv, **kwargs):
                value = subprocess.CompletedProcess(argv, 0, stdout=b'raw\xff', stderr=b'err\xfe'); value.futureField = {'unclassified': b'\x00'}
                return value
            with patch.object(subprocess, 'run', inert), native.observed_helpers((job_module, proof, stages), evidence):
                with self.assertRaisesRegex(AssertionError, 'registration remains'):
                    job.archive(profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
            facts = [e['value'] for e in evidence['helperCalls'] if e['operation'] == 'run']
            self.assertEqual(len(facts), 2)
            self.assertEqual(facts[-1]['stdout']['base64'], 'cmF3/w==')
            self.assertEqual(facts[-1]['futureField']['unclassified']['base64'], 'AA==')
            self.assertTrue(scratch.exists()); self.assertTrue(private.exists())

    def test_actual_alarm_stops_later_archive_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); scratch = root / 'scratch'; scratch.mkdir(); out = root / 'out'; out.mkdir()
            private = root / 'private'; private.mkdir(mode=0o700)
            job = job_module.StationJob.__new__(job_module.StationJob)
            job.state = {'drained': True, 'profiles': []}; job.scratch = scratch; job.out = out; job.target = 'INERT-never-launch'
            calls = []; evidence = {'helperCalls': []}
            def alarm(argv, **kwargs):
                calls.append(argv)
                with boundary.deadline(.01): time.sleep(.05)
            with patch.object(subprocess, 'run', alarm), native.observed_helpers((job_module, proof, stages), evidence):
                with self.assertRaises(boundary.DeadlineExpired): job.archive(profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
            self.assertEqual(len(calls), 1)
            self.assertEqual(evidence['helperCalls'][-1]['error']['type'], 'DeadlineExpired')
            self.assertFalse((out / 'unload.json').exists())

    def test_cleanup_receipt_failure_keeps_facts_without_stopping_owned_drain(self):
        evidence = {'helperCalls': [], 'phase': 'cleanup'}
        with patch.object(job_module, 'write', side_effect=OSError('receipt unavailable')):
            with native.observed_helpers((job_module, proof, stages), evidence):
                job_module.write('/INERT-never-created', {'original': b'\x00\xff', 'unknown': {'extra': 7}})
        self.assertEqual(len(evidence['cleanupReceiptFailures']), 1)
        fact = evidence['cleanupReceiptFailures'][0]
        self.assertEqual(fact['args'][1]['original']['base64'], 'AP8=')
        self.assertEqual(fact['error']['message'], 'receipt unavailable')
        self.assertFalse(Path('/INERT-never-created').exists())

    def test_real_allocation_failure_retains_owned_identity(self):
        # Redirect only allocation's /private/tmp port into this owned scratch root.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); evidence = {'helperCalls': []}
            policy = {**proof.PRIVATE_TMP_POLICY, 'parent': str(root)}
            with patch.object(proof, 'PRIVATE_TMP_POLICY', policy), patch.object(proof, 'write', side_effect=OSError('receipt full')):
                with self.assertRaises(OSError) as failure:
                    proof.create_private_tmp(root / 'receipt.json')
            allocation = failure.exception.private_tmp_allocation
            self.assertIsNotNone(allocation['identity_at_allocation']['stamp'])
            self.assertTrue(allocation['released'])
            self.assertFalse(Path(allocation['path']).exists())


if __name__ == '__main__': unittest.main()
