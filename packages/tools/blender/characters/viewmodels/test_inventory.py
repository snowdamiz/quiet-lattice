"""Run the actual inventory entry point against real assets and scratch substitutions."""
from pathlib import Path
import contextlib
import io
import json
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(HERE))
from evidence import PEOPLES, paths, report_names, sha


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t03-real-inventory-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.out = self.root / 'assets/renders/characters/viewmodels'
        scripts = self.root / 'packages/tools/blender/characters/viewmodels'
        scripts.mkdir(parents=True)
        self.script = scripts / 'inventory.py'
        shutil.copy2(HERE / 'inventory.py', self.script)
        (self.out / 'validation').mkdir(parents=True)
        (self.out / 'cpu').mkdir()
        for people in PEOPLES:
            for key, path in paths(self.root, people).items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(paths(ROOT, people)[key])
            for name in (f'assets/blend/characters/{people}.blend', f'packages/client/public/models/characters/{people}.glb'):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(ROOT / name)
            for name in (*report_names(people), f'{people}-receipt.json'):
                shutil.copy2(ROOT / 'assets/renders/characters/viewmodels/validation' / name, self.out / 'validation' / name)
        for path in (ROOT / 'assets/renders/characters/viewmodels/cpu').glob('*.png'):
            (self.out / 'cpu' / path.name).symlink_to(path)
        self.run_inventory()

    def run_inventory(self):
        original = subprocess.check_output
        def readonly_git(*args, **kwargs):
            if kwargs.get('cwd') == self.root:
                self.assertEqual(args[0][0], 'git')
                kwargs['cwd'] = ROOT
            return original(*args, **kwargs)
        with patch.object(subprocess, 'check_output', readonly_git), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(self.script), run_name='inventory_fixture')
        return json.loads((self.out / 'inventory.json').read_text())

    def rejects(self, exception, message=None):
        old = (self.out / 'inventory.json').read_bytes()
        with self.assertRaises(exception) as failure:
            self.run_inventory()
        if message: self.assertIn(message, str(failure.exception))
        self.assertFalse((self.out / 'inventory.json').exists(), 'stale current inventory survived rejection')
        history = list((self.out / 'validation/history').glob('inventory-*/inventory.json'))
        self.assertTrue(any(path.read_bytes() == old for path in history), 'historical inventory was not preserved')

    def test_positive_exact_current_assets(self):
        result = self.run_inventory()
        for people in PEOPLES:
            self.assertEqual(result['assets'][people]['files']['export']['sha256'], sha(paths(ROOT, people)['export']))
            self.assertIn('validation_receipt', result['assets'][people])

    def test_nine_byte_truncation_with_old_pass_reports(self):
        export = paths(self.root, 'thalune')['export']
        export.unlink()
        export.write_bytes(b'not a GLB')
        self.rejects(ValueError, 'validated pair')

    def test_other_actual_source_cannot_reuse_receipt(self):
        source = paths(self.root, 'thalune')['source']
        source.unlink()
        source.symlink_to(paths(ROOT, 'ixari')['source'])
        self.rejects(ValueError, 'validated pair')

    def test_substituted_pass_report_cannot_reuse_receipt(self):
        path = self.out / 'validation/characters__fp_thalune.glb.json'
        value = json.loads(path.read_text())
        value['file'] = 'different-passing-export.glb'
        path.write_text(json.dumps(value))
        self.rejects(ValueError, 'reports differ')

    def test_mismatched_source_export_receipt_pair(self):
        path = self.out / 'validation/thalune-receipt.json'
        value = json.loads(path.read_text())
        value['files']['export']['sha256'] = sha(paths(ROOT, 'ixari')['export'])
        path.write_text(json.dumps(value))
        self.rejects(ValueError, 'validated pair')

    def test_legacy_pass_reports_without_receipt_are_insufficient(self):
        (self.out / 'validation/thalune-receipt.json').unlink()
        self.rejects(FileNotFoundError)


if __name__ == '__main__':
    unittest.main(verbosity=2)
