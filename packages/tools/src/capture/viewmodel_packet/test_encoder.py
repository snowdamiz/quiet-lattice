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


class MetalCompilerTests(unittest.TestCase):
    binary = '/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService'
    digest = '65af927ce641351e604bf36da7a664e5350d583483c7e5f3fe799e0d0db7a78b'

    def directory(self):
        return Path(tempfile.mkdtemp(prefix='vm-mtl-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()

    def discover_cpu(self):
        """Execute discovery with real Apple files; isolate unrelated inventory/probes."""
        root = self.directory()
        routes = {name: str(root / name) for name in ('tsxApi', 'playwright', 'esbuild', 'browserBinary')}
        real_binding, real_run = bindings.file_binding, subprocess.run
        def bound(path):
            if str(path) in (bindings.VT_ENCODER, self.binary, '/usr/bin/codesign'):
                return real_binding(path)
            logical = str(Path(path).absolute())
            return {'path': logical, 'realpath': logical, 'bytes': 0,
                    'sha256': bindings.HELPER_HASHES.get(Path(path).name, '1' * 64)}
        def run(argv, **kwargs):
            if argv[0] == '/usr/bin/codesign':
                return real_run(argv, **kwargs)
            self.assertEqual(argv, ['/usr/bin/true', str(bindings.HERE / 'resolve.mjs')])
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(routes).encode(), stderr=b'')
        def forbidden(*args, **kwargs):
            raise RuntimeError('No runtime or kernel process probe permitted')
        with contextlib.ExitStack() as stack:
            for owner, name, value in [
                (bindings, 'ROOT', root), (bindings.shutil, 'which', lambda _: '/usr/bin/true'),
                (bindings, 'file_binding', bound), (bindings, 'self_kernel', lambda: bound(root / 'python-kernel')),
                (bindings, 'tree_binding', lambda *a, **k: {'cpu_fixture': True}),
                (bindings, 'git', lambda *a: b'cpu-fixture\n' if a[1] == 'branch' else b''),
                (bindings, 'ignored_inventory', lambda: b''), (subprocess, 'run', run),
                (subprocess, 'check_output', forbidden),
            ]:
                stack.enter_context(patch.object(owner, name, value))
            result = bindings.discover()
        (root / 'discovery.json').write_text(json.dumps(result, indent=2) + '\n')
        return result

    def observe_cpu(self, discovered, mode='bound', *, retained=None):
        """Use actual StageReceipts and StationJob.members with inert kernel facts."""
        root = self.directory()
        row = dict(retained or {'pid': 990010, 'birth': [1, 10], 'uid': os.getuid(),
                                'pgid': 990010, 'status': 2, 'coalition': [111111, 111112]})
        cid = row['coalition'][0]
        current = {**row, 'birth': [2, 10] if mode == 'wrong-birth' else row['birth'],
                   'uid': row['uid'] + 1 if mode == 'wrong-uid' else row['uid']}
        after = {**current, 'birth': [3, 10] if mode == 'birth-race' else current['birth']}
        job = object.__new__(stages.StationJob)
        job.out = job.scratch = root
        job.state, job.coalition_id = {}, cid
        job.known = {str(row['pid']): {**row, 'birth': [0, 10]}} if mode == 'pid-reuse' else {}
        ready = {'resolver': {'selectedExecutable': {'path': '/INERT-browser'}},
                 'process_binary_sha256': dict(discovered['process_binary_sha256'])}
        if mode == 'missing':
            ready['process_binary_sha256'].pop(self.binary, None)
        unknown = '/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/Other.xpc/Contents/MacOS/Other'
        binary = unknown if mode == 'wrong-binary' else self.binary
        def forbidden(*args, **kwargs):
            raise RuntimeError('No native command permitted')
        receipt = None
        failure = None
        try:
            with contextlib.ExitStack() as stack:
                for owner, name, value in [
                    (subprocess, 'run', forbidden), (subprocess, 'check_output', forbidden), (subprocess, 'Popen', forbidden),
                    (sys.modules[stages.StationJob.__module__], 'coalition_members', lambda _: [] if mode == 'not-a-member' else [row]),
                    (stages, 'current_commands', lambda _: {row['pid']: self.binary}),
                    (stages, 'executable_path', lambda _: binary),
                ]:
                    stack.enter_context(patch.object(owner, name, value))
                stack.enter_context(patch.object(stages, 'identity', side_effect=[current, after]))
                stack.enter_context(patch.object(stages, 'coalition', side_effect=[
                    [cid + 1, 0] if mode == 'wrong-coalition' else row['coalition'],
                    [cid + 1, 0] if mode == 'coalition-race' else row['coalition']]))
                observer = stages.StageReceipts(job, ready, str(root))
                try:
                    observer.observe()
                finally:
                    receipt = observer.receipt()
        except BaseException as error:
            failure = {'type': type(error).__name__, 'message': str(error)}
            if receipt is not None and any(row['admitted'] for row in receipt['processes']):
                raise RuntimeError('Refused observation admitted a process') from error
            raise
        finally:
            (root / 'control.json').write_text(json.dumps({'mode': mode, 'input': row, 'receipt': receipt,
                                                         'failure': failure}, indent=2) + '\n')
        return receipt

    def test_discovered_binding_admits_matching_owned_mtl(self):
        discovered = self.discover_cpu()
        receipt = self.observe_cpu(discovered)
        admitted = [row for row in receipt['processes'] if row['admitted']]
        self.assertEqual(len(admitted), 1)
        self.assertEqual(admitted[0]['binary'], self.binary)
        self.assertEqual(admitted[0]['role'], 'owned-launch-helper')
        self.assertEqual(admitted[0]['prelaunch_sha256'], self.digest)
        self.assertEqual(discovered['appleMetalCompiler']['executable']['sha256'], self.digest)
        self.assertEqual([row['sha256'] for row in discovered['bindings'] if row['realpath'] == self.binary], [self.digest])
        self.assertEqual(discovered['process_binary_sha256'][bindings.VT_ENCODER], bindings.VT_ENCODER_SHA256)
        self.assertEqual([p for p in discovered['process_binary_sha256'] if p.startswith('/System/')],
                         [bindings.VT_ENCODER, self.binary])

    def test_actual_mtl_signature_and_protected_exact_file(self):
        result = bindings.apple_mtl_compiler_binding()
        self.assertEqual(result['executable']['path'], self.binary)
        self.assertEqual(result['executable']['sha256'], self.digest)
        self.assertEqual(result['executable']['bytes'], 389760)
        self.assertEqual(result['signature']['Identifier'], 'com.apple.MTLCompilerService')
        self.assertEqual(result['signature']['Platform identifier'], '26')
        self.assertEqual([r['exit'] for r in result['observations']], [0, 0])
        self.assertEqual([r['path'] for r in result['protectedRoute']], [str(p) for p in (Path(self.binary), *Path(self.binary).parents)])
        self.assertTrue(all(r['uid'] == 0 and not r['mode'] & 0o022 for r in result['protectedRoute']))

    def test_mtl_wrong_bytes_owner_permissions_route_and_signature_refuse(self):
        real_stat, real_binding, real_run = Path.lstat, bindings.file_binding, subprocess.run
        for mode in ('hash', 'size', 'uid', 'writable', 'parent-uid', 'parent-writable', 'symlink',
                     'signature', 'identifier', 'platform', 'requirement'):
            with self.subTest(mode=mode), contextlib.ExitStack() as stack:
                calls = []
                def info(path, *args, **kwargs):
                    result = real_stat(path, *args, **kwargs)
                    target = str(Path(self.binary).parent) if mode.startswith('parent-') else self.binary
                    if str(path) == target and mode in ('uid', 'writable', 'parent-uid', 'parent-writable'):
                        return SimpleNamespace(st_uid=501 if mode.endswith('uid') else result.st_uid,
                            st_mode=result.st_mode | (0o002 if mode.endswith('writable') else 0))
                    return result
                def bound(path):
                    result = real_binding(path)
                    if str(path) == self.binary:
                        if mode == 'hash': result['sha256'] = '0' * 64
                        if mode == 'size': result['bytes'] += 1
                    return result
                def run(argv, **kwargs):
                    calls.append(argv)
                    if mode == 'signature':
                        return subprocess.CompletedProcess(argv, 1, stdout=b'', stderr=b'inert signature refusal')
                    result = real_run(argv, **kwargs)
                    if '-d' in argv:
                        if mode == 'identifier': result.stderr = result.stderr.replace(b'Identifier=com.apple.MTLCompilerService', b'Identifier=com.apple.Other')
                        if mode == 'platform': result.stderr = result.stderr.replace(b'Platform identifier=26', b'Platform identifier=0')
                        if mode == 'requirement': result.stdout = b'designated => anchor apple\n'
                    return result
                stack.enter_context(patch.object(Path, 'lstat', info))
                stack.enter_context(patch.object(bindings, 'file_binding', bound))
                stack.enter_context(patch.object(subprocess, 'run', run))
                if mode == 'symlink':
                    stack.enter_context(patch.object(bindings, 'canonical', side_effect=ValueError('Symlink route')))
                with self.assertRaises(ValueError):
                    bindings.apple_mtl_compiler_binding()
                self.assertEqual(len(calls), 2 if mode in ('identifier', 'platform', 'requirement') else 1 if mode == 'signature' else 0)

    def test_mtl_discovery_rejects_wrong_hash_before_process_admission(self):
        real_binding = bindings.file_binding
        def bound(path):
            result = real_binding(path)
            if str(path) == self.binary:
                result['sha256'] = '0' * 64
            return result
        with patch.object(bindings, 'file_binding', bound):
            with self.assertRaisesRegex(ValueError, 'Unexpected Apple Metal compiler bytes'):
                self.discover_cpu()

    def test_mtl_actual_observer_and_member_refusals(self):
        discovered = self.discover_cpu()
        for mode in ('missing', 'wrong-uid', 'wrong-birth', 'wrong-coalition', 'wrong-binary',
                     'birth-race', 'coalition-race', 'pid-reuse'):
            with self.subTest(mode=mode):
                if mode == 'pid-reuse':
                    error = sys.modules[stages.StationJob.__module__].UnsafeCaptureGroup
                else:
                    error = AssertionError
                with self.assertRaises(error):
                    self.observe_cpu(discovered, mode)
        self.assertEqual(self.observe_cpu(discovered, 'not-a-member')['processes'], [])


if __name__ == '__main__': unittest.main()
