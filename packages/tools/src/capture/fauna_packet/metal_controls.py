"""CPU-only signature/configuration controls; never launch the compiler or browser."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path: sys.path.remove(str(HERE))
import copy
import importlib.util
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('metal_freeze', HERE / 'freeze.py')
freeze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(freeze)


class MetalBindingControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiler = freeze.apple_metal_compiler_binding()

    def test_actual_signed_root_protected_compiler_and_exact_closure(self):
        compiler = self.compiler
        self.assertEqual(compiler['verify']['exit'], 0)
        self.assertEqual(compiler['display']['exit'], 0)
        self.assertTrue(compiler['filesystemReadOnly'])
        self.assertTrue(all(r['uid'] == 0 and not r['mode'] & 0o022 for r in compiler['rootProtection']))
        ready = {'apple_metal_compiler_binding': compiler,
                 'ownedAppleMetalCompiler': {'path': freeze.METAL_COMPILER, 'role': 'apple-metal-compiler-xpc',
                     'observerRole': 'owned-launch-helper', 'ownership': 'current kernel birth/UID/coalition verified by StageReceipts'},
                 'process_binary_sha256': {freeze.METAL_COMPILER: freeze.METAL_COMPILER_SHA},
                 'bindings': [freeze.binding(freeze.METAL_COMPILER), freeze.binding('/usr/bin/codesign')]}
        freeze.validate_metal_compiler_bindings(ready)
        for kind in ('missing-process', 'wrong-digest', 'wrong-role', 'wrong-path', 'missing-file', 'wrong-file-digest', 'missing-verifier'):
            value = copy.deepcopy(ready)
            if kind == 'missing-process': value['process_binary_sha256'].clear()
            if kind == 'wrong-digest': value['process_binary_sha256'][freeze.METAL_COMPILER] = '0' * 64
            if kind == 'wrong-role': value['ownedAppleMetalCompiler']['ownership'] = 'any Apple process'
            if kind == 'wrong-path': value['apple_metal_compiler_binding']['canonical_path'] += '.substituted'
            if kind == 'missing-file': value['bindings'].pop(0)
            if kind == 'wrong-file-digest': value['bindings'][0]['sha256'] = '0' * 64
            if kind == 'missing-verifier': value['bindings'].pop(1)
            with self.subTest(kind=kind), self.assertRaises(freeze.caller.Refused): freeze.validate_metal_compiler_bindings(value)

    def test_hash_or_writable_volume_refuses_before_signature_commands(self):
        with patch.object(freeze.subprocess, 'run', side_effect=AssertionError('Signature command reached')):
            with patch.object(freeze, 'METAL_COMPILER_SHA', '0' * 64), self.assertRaisesRegex(freeze.caller.Refused, 'bytes changed'):
                freeze.apple_metal_compiler_binding()
            with patch.object(freeze.os, 'statvfs', return_value=SimpleNamespace(f_flag=0)), self.assertRaisesRegex(freeze.caller.Refused, 'read-only'):
                freeze.apple_metal_compiler_binding()

    def test_substituted_copy_and_symlink_never_gain_system_binary_authority(self):
        with tempfile.TemporaryDirectory(prefix='fauna-metal-cpu-') as temp:
            file = Path(temp).resolve() / 'substituted'; file.write_bytes(b'CPU fixture')
            link = file.with_name('link'); link.symlink_to(freeze.METAL_COMPILER)
            for path in (file, link):
                with self.subTest(path=path), patch.object(freeze, 'METAL_COMPILER', str(path)), self.assertRaises(freeze.caller.Refused):
                    freeze.apple_metal_compiler_binding()


if __name__ == '__main__': unittest.main(verbosity=2)
