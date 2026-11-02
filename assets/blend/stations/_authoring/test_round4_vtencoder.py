"""Focused CPU-only observation, native admission and fresh-namespace controls."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import capture_round4_stage as sequence
import run_round4_remaining8 as caller


class EncoderControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='station-vtencoder-cpu-')
        self.out = Path(self.temp.name).resolve()
        self.row = {'pid': 777777, 'birth': [1, 2], 'uid': os.getuid(), 'ppid': 1, 'pgid': 777777}
        self.job = Mock(out=self.out, scratch=self.out / 'absent_scratch', coalition_id=123)
        self.job.members.return_value = [self.row]
        self.job.state = {}
        self.ready = {'resolver': {'selectedExecutable': {'path': '/CPU-ONLY-browser'}}, 'process_binary_sha256': {}}

    def tearDown(self):
        self.temp.cleanup()
        self.assertFalse(self.out.exists())

    def observe(self, binary):
        observer = caller.StageReceipts(self.job, self.ready, self.out / 'absent_private')
        with patch.object(caller, 'identity', return_value=self.row), \
             patch.object(caller, 'coalition', return_value=[123, 124]), \
             patch.object(caller, 'executable_path', return_value=binary), \
             patch.object(caller, 'current_commands', return_value={}):
            observer.observe()

    def test_rejected_observation_survives_without_argv(self):
        with self.assertRaisesRegex(AssertionError, 'Unbound owned executable'):
            self.observe('/CPU-ONLY-unbound-executable')
        record = json.loads((self.out / 'observed_execution.json').read_text())['processes'][0]
        self.assertEqual(record['kernel'], self.row)
        self.assertEqual(record['coalition'], [123, 124])
        self.assertEqual(record['binary'], '/CPU-ONLY-unbound-executable')
        self.assertIs(record['admitted'], False)

    def test_exact_encoder_admission_is_recorded_without_argv(self):
        self.ready['process_binary_sha256'][caller.VTENCODER] = 'CPU-PRELAUNCH-HASH'
        self.observe(caller.VTENCODER)
        record = json.loads((self.out / 'observed_execution.json').read_text())['processes'][0]
        self.assertIs(record['admitted'], True)
        self.assertEqual(record['role'], 'apple-video-encoder-xpc')
        self.assertEqual(record['prelaunch_sha256'], 'CPU-PRELAUNCH-HASH')

    def test_encoder_binding_does_not_admit_framework_sibling(self):
        self.ready['process_binary_sha256'][caller.VTENCODER] = 'CPU-PRELAUNCH-HASH'
        sibling = caller.VTENCODER.replace('VTEncoderXPCService', 'UnacceptedSibling')
        with self.assertRaisesRegex(AssertionError, 'Unbound owned executable'):
            self.observe(sibling)
        record = json.loads((self.out / 'observed_execution.json').read_text())['processes'][0]
        self.assertEqual(record['binary'], sibling)
        self.assertIs(record['admitted'], False)

    def signature_query(self, valid=True):
        metadata = ('Identifier=com.apple.coremedia.videoencoder\nPlatform identifier=26\n'
                    'CDHash=CPU-CDHASH\nAuthority=macOS Software Signing\n'
                    'Authority=Apple Code Signing Certification Authority\nAuthority=Apple Root CA\n'
                    'designated => identifier "com.apple.coremedia.videoencoder" and anchor apple\n')
        def run(argv, **kwargs):
            if '-R' in argv:
                self.assertEqual(argv[argv.index('-R') + 1], '=' + caller.ENCODER_REQUIREMENT)
            return Mock(returncode=0 if valid else 1, stdout='', stderr=metadata if '-d' in argv else '')
        return run

    def test_exact_encoder_hash_mismatch_refuses(self):
        binary = self.out / 'VTEncoderXPCService'; binary.write_bytes(b'CPU-only bytes, never executable')
        with patch.object(caller, 'VTENCODER', str(binary)), \
             patch.object(caller.subprocess, 'run', side_effect=self.signature_query()):
            ready = {'apple_encoder_binding': caller.encoder_binding()}
            caller.verify_encoder_binding(ready)
            binary.write_bytes(b'changed CPU-only bytes')
            with self.assertRaisesRegex(AssertionError, 'encoder binding changed'):
                caller.verify_encoder_binding(ready)

    def test_encoder_signature_failure_refuses(self):
        binary = self.out / 'VTEncoderXPCService'; binary.write_bytes(b'CPU-only bytes')
        with patch.object(caller, 'VTENCODER', str(binary)), \
             patch.object(caller.subprocess, 'run', side_effect=self.signature_query(False)):
            with self.assertRaisesRegex(AssertionError, 'Apple encoder signature'):
                caller.encoder_binding()

    def test_different_canonical_path_with_same_bytes_refuses(self):
        binary = self.out / 'VTEncoderXPCService'; binary.write_bytes(b'CPU-only bytes')
        other = self.out / 'other'; other.write_bytes(binary.read_bytes())
        with patch.object(caller.subprocess, 'run', side_effect=self.signature_query()):
            with patch.object(caller, 'VTENCODER', str(binary)):
                ready = {'apple_encoder_binding': caller.encoder_binding()}
            with patch.object(caller, 'VTENCODER', str(other)):
                with self.assertRaisesRegex(AssertionError, 'encoder binding changed'):
                    caller.verify_encoder_binding(ready)

    def test_encoder_alias_path_refuses(self):
        binary = self.out / 'actual'; binary.write_bytes(b'CPU-only bytes')
        alias = self.out / 'VTEncoderXPCService'; alias.symlink_to(binary)
        with patch.object(caller, 'VTENCODER', str(alias)), \
             patch.object(caller.subprocess, 'run', side_effect=AssertionError('must reject before codesign')):
            with self.assertRaisesRegex(AssertionError, 'canonical'):
                caller.encoder_binding()

    def test_fresh_attempt_namespace_is_only_plan_change(self):
        old = json.loads((caller.BASE / 'capture_readiness.json').read_text())['stages']
        expected = [s for s in old if s['id'] != 'standard-waystation-ws_fabricator']
        expected = json.loads(json.dumps(expected).replace('/engine/attempt01/', '/engine/attempt02/'))
        self.assertEqual(caller.original_stages(), expected)
        self.assertEqual(caller.FREEZE.name, 'station_remaining8_ready04')
        ready = {'stages': expected, 'capture_seconds': 600, 'cleanup_seconds': 60,
                 'private_tmp_policy': caller.PRIVATE_TMP_POLICY}
        caller.validate_plan(ready)
        changed = copy.deepcopy(ready)
        changed['stages'][0]['out_path'] = changed['stages'][0]['out_path'].replace('/attempt02/', '/attempt01/')
        with self.assertRaises(AssertionError): caller.validate_plan(changed)

    def test_fresh_grant_stops_first_failure_and_old_grant_cannot_resume(self):
        ready = {'stages': caller.original_stages()}
        calls = []
        def fail(stage, out):
            calls.append(stage['id']); return {'accepted': False}
        with self.assertRaises(RuntimeError): sequence.run_plan(ready, self.out / 'consumed', 'new-cpu-only-grant', fail)
        self.assertEqual(calls, [ready['stages'][0]['id']])
        with self.assertRaises(FileExistsError): sequence.run_plan(ready, self.out / 'consumed', 'new-cpu-only-grant', fail)
        self.assertEqual(len(calls), 1)

    def test_new_namespace_has_no_actual_grant_and_entry_refuses_without_spawn(self):
        self.assertFalse(caller.GRANT.exists())
        with patch.object(caller.subprocess, 'run', side_effect=AssertionError('must not spawn')):
            with self.assertRaisesRegex(AssertionError, 'gate closed'):
                caller.execute()


if __name__ == '__main__': unittest.main(verbosity=2)
