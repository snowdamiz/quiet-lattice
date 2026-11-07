"""CPU signature verification and unchanged StageReceipts ownership boundaries."""
import contextlib
import importlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bindings
sys.path.insert(0, str(bindings.HELPERS))
stages = importlib.import_module('run_round4_remaining8')


class EncoderTests(unittest.TestCase):
    def test_actual_signature_and_protected_exact_file(self):
        result = bindings.apple_encoder_binding()
        self.assertEqual(result['executable']['path'], bindings.VT_ENCODER)
        self.assertEqual(result['executable']['sha256'], bindings.VT_ENCODER_SHA256)
        self.assertEqual(result['signature']['Identifier'], 'com.apple.coremedia.videoencoder')
        self.assertEqual(result['signature']['Platform identifier'], '26')
        self.assertEqual([r['exit'] for r in result['observations']], [0, 0])
        self.assertTrue(all(r['uid'] == 0 and not r['mode'] & 0o022 for r in result['protectedRoute']))

    def test_wrong_bytes_owner_permissions_route_and_signature_refuse(self):
        original_stat = Path.lstat; original_binding = bindings.file_binding
        for mode in ('hash', 'uid', 'writable', 'symlink', 'signature'):
            with self.subTest(mode=mode), contextlib.ExitStack() as stack:
                calls = []
                def info(path, *args, **kwargs):
                    result = original_stat(path, *args, **kwargs)
                    if str(path) == bindings.VT_ENCODER and mode in ('uid', 'writable'):
                        return SimpleNamespace(st_uid=501 if mode == 'uid' else result.st_uid,
                            st_mode=result.st_mode | (0o002 if mode == 'writable' else 0))
                    return result
                def bound(path):
                    result = original_binding(path)
                    if str(path) == bindings.VT_ENCODER and mode == 'hash': result['sha256'] = '0'*64
                    return result
                def command(argv, **kwargs):
                    calls.append(argv)
                    return subprocess.CompletedProcess(argv, 1, stdout=b'', stderr=b'inert signature refusal')
                stack.enter_context(patch.object(Path, 'lstat', info));stack.enter_context(patch.object(bindings, 'file_binding', bound))
                stack.enter_context(patch.object(subprocess, 'run', command))
                if mode == 'symlink': stack.enter_context(patch.object(bindings, 'canonical', side_effect=ValueError('Symlink route')))
                with self.assertRaises(ValueError): bindings.apple_encoder_binding()
                self.assertEqual(len(calls), 1 if mode == 'signature' else 0)

    def test_actual_observer_requires_binding_uid_birth_coalition_and_executable(self):
        bound = bindings.apple_encoder_binding()
        for mode in ('bound', 'missing', 'wrong-uid', 'wrong-birth', 'wrong-coalition', 'wrong-binary', 'not-a-member'):
            with self.subTest(mode=mode):
                root = Path(tempfile.mkdtemp(prefix='vm-encoder-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()
                row = {'pid': 990009, 'birth': [1, 9], 'uid': os.getuid(), 'pgid': 990001, 'status': 2}
                current = {**row, 'birth': [2, 9] if mode == 'wrong-birth' else row['birth'], 'uid': row['uid']+1 if mode == 'wrong-uid' else row['uid']}
                job = SimpleNamespace(out=root, scratch=root, state={}, members=lambda: [] if mode == 'not-a-member' else [row], coalition_id=111111)
                ready = {'resolver': {'selectedExecutable': {'path': '/INERT-browser'}},
                    'process_binary_sha256': {} if mode == 'missing' else {bindings.VT_ENCODER: bound['executable']['sha256']}}
                def forbidden(*a, **kw): raise AssertionError('No native command permitted')
                with contextlib.ExitStack() as stack:
                    for owner, name, value in [(subprocess, 'run', forbidden), (subprocess, 'check_output', forbidden), (subprocess, 'Popen', forbidden),
                        (stages, 'current_commands', lambda _: {row['pid']: bindings.VT_ENCODER}), (stages, 'identity', lambda _: current),
                        (stages, 'coalition', lambda _: [222222 if mode == 'wrong-coalition' else 111111, 0]),
                        (stages, 'executable_path', lambda _: '/unbound/other-xpc' if mode == 'wrong-binary' else bindings.VT_ENCODER)]:
                        stack.enter_context(patch.object(owner, name, value))
                    observer = stages.StageReceipts(job, ready, str(root))
                    if mode in ('bound', 'not-a-member'): observer.observe()
                    else:
                        with self.assertRaises(AssertionError): observer.observe()
                    receipt = observer.receipt()
                (root/'control.json').write_text(json.dumps({'mode':mode,'receipt':receipt},indent=2)+'\n')
                admitted = [r for r in receipt['processes'] if r['admitted']]
                self.assertEqual(len(admitted), 1 if mode == 'bound' else 0)
                if admitted:
                    self.assertEqual(admitted[0]['role'], 'apple-video-encoder-xpc')
                    self.assertEqual(admitted[0]['prelaunch_sha256'], bindings.VT_ENCODER_SHA256)


if __name__ == '__main__': unittest.main()
