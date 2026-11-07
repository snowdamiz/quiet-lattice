"""Real Blender validation -> receipt -> inventory for saved source/export pairs.

Run through run_cpu.py, with -- /new/scratch/root [--code-dir PINNED_TOOLING].
The post-export case injects only delivery of existing GLB bytes at export_one;
all source/export validation, receipts, quarantine and inventory code runs normally.
No source save, mesh generation or compression is performed.
"""
from pathlib import Path
import argparse
import contextlib
import importlib.util
import io
import json
import runpy
import shutil
import subprocess
import sys
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
parser = argparse.ArgumentParser()
parser.add_argument('scratch', type=Path)
parser.add_argument('--code-dir', type=Path, default=HERE)
parser.add_argument('--pair', nargs=2)
parser.add_argument('--mode', choices=('validate-only', 'post-export'))
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
scratch = args.scratch.resolve()
assert not scratch.exists() and not scratch.is_relative_to(ROOT)
scratch.mkdir(parents=True)
sys.dont_write_bytecode = True
sys.path[:0] = [str(args.code_dir), str(HERE.parents[1])]
from evidence import PEOPLES, paths, report_names, sha

spec = importlib.util.spec_from_file_location('pair_wrapper', args.code_dir / 'export.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
protected = {str(path): sha(path) for people in PEOPLES for path in paths(ROOT, people).values()}


def fixture(name):
    root = scratch / name
    reports = root / 'assets/renders/characters/viewmodels/validation'
    reports.mkdir(parents=True)
    for people in PEOPLES:
        for key, path in paths(root, people).items():
            path.parent.mkdir(parents=True, exist_ok=True)
            if key == 'source':
                path.symlink_to(paths(ROOT, people)[key])  # validator only reads sources
            else:
                shutil.copy2(paths(ROOT, people)[key], path)
        for name in (*report_names(people), f'{people}-receipt.json'):
            shutil.copy2(ROOT / 'assets/renders/characters/viewmodels/validation' / name, reports / name)
        for name in (f'assets/blend/characters/{people}.blend', f'packages/client/public/models/characters/{people}.glb'):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to(ROOT / name)
    shutil.copy2(ROOT / 'assets/renders/characters/viewmodels/inventory.json', reports.parent / 'inventory.json')
    cpu = reports.parent / 'cpu'
    cpu.mkdir()
    for path in (ROOT / 'assets/renders/characters/viewmodels/cpu').glob('*.png'):
        (cpu / path.name).symlink_to(path)
    script = root / 'packages/tools/blender/characters/viewmodels/inventory.py'
    script.parent.mkdir(parents=True)
    shutil.copy2(args.code_dir / 'inventory.py', script)
    return root, reports, script


def inventory(root, script):
    original = subprocess.check_output
    def git(*a, **kw):
        if Path(kw.get('cwd', '.')).resolve() == root:
            assert a[0][0] == 'git'
            kw['cwd'] = ROOT  # read-only identity queries against the actual checkout
        return original(*a, **kw)
    with patch.object(subprocess, 'check_output', git), contextlib.redirect_stdout(io.StringIO()):
        runpy.run_path(str(script), run_name='pair_inventory')


results = []
pairs = [args.pair] if args.pair else [(p, q) for p in PEOPLES for q in PEOPLES]
for mode in ([args.mode] if args.mode else ['validate-only', 'post-export']):
    for people, exported in pairs:
        assert people in PEOPLES and exported in PEOPLES
        root, reports, script = fixture(f'{mode}-{people}-{exported}')
        destination = paths(root, people)['export']
        delivered = paths(ROOT, exported)['export']
        prior = destination.read_bytes()
        old_reports = {name: (reports / name).read_bytes() for name in (*report_names(people), f'{people}-receipt.json')}
        old_inventory = (reports.parent / 'inventory.json').read_bytes()
        if mode == 'validate-only':
            shutil.copy2(delivered, destination)
        def deliver(*unused, **kwargs):
            shutil.copy2(delivered, destination)
            return True
        wrapper.ROOT = root
        sys.argv = ['export.py', '--', *(['--validate-only'] if mode == 'validate-only' else []), people]
        with patch.object(wrapper.export, 'export_one', deliver):
            code = wrapper.main()
        receipt = json.loads((reports / f'{people}-receipt.json').read_text())
        try:
            inventory(root, script)
            inventory_status = 'PASS'
        except (ValueError, FileNotFoundError) as error:
            inventory_status = 'REJECTED'
            inventory_error = str(error)
        result = {'mode': mode, 'source_people': people, 'export_people': exported,
                  'source_sha256': sha(paths(ROOT, people)['source']), 'export_sha256': sha(delivered),
                  'wrapper_exit': code, 'receipt_status': receipt['status'], 'inventory': inventory_status,
                  'expected_match': people == exported, 'receipt': receipt}
        results.append(result)
        (scratch / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
        if people == exported:
            assert code == 0 and receipt['status'] == 'PASS' and inventory_status == 'PASS', result
            assert destination.read_bytes() == prior
        else:
            assert code == 1 and receipt['status'] == 'FAIL' and inventory_status == 'REJECTED', result
            assert not destination.exists() and not (reports.parent / 'inventory.json').exists()
            history = root / receipt['history']
            for name, data in old_reports.items():
                assert (history / name).read_bytes() == data
            assert (history / 'inventory.json').read_bytes() == old_inventory
            if mode == 'post-export':
                assert (history / destination.name).read_bytes() == prior
                assert (history / ('failed-' + destination.name)).read_bytes() == delivered.read_bytes()
            else:
                assert (history / destination.name).read_bytes() == delivered.read_bytes()
        assert all(sha(paths(root, p)['export']) == sha(paths(ROOT, p)['export']) for p in PEOPLES if p != people)
        assert all(sha(Path(path)) == digest for path, digest in protected.items())
        print('PAIR_RESULT', json.dumps({k: v for k, v in result.items() if k != 'receipt'}), flush=True)
print('SAVED_PAIRS_PASS', len(results), flush=True)
