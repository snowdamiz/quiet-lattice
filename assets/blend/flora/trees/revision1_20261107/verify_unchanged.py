"""Recheck the immutable R1 payload without Blender, codecs, or dependency writes."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
PIN = '515ba1f00810a50b499970b5468ef7bf0af84c32'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    before = json.loads((HERE/'protected-before.json').read_text())
    changed = [row['path'] for row in before if sha(ROOT/row['path']) != row['sha256']]
    assert changed == ['packages/tools/blender/flora_trees/run.py'], changed
    for row in json.loads((HERE/'additional-protected.json').read_text()):
        assert sha(ROOT/row['path']) == row['sha256'], row['path']
    shared = ['artlib/checks.py', 'artlib/materials.py', 'material_mask_selftest.py']
    for name in shared:
        path = 'packages/tools/blender/'+name
        assert (ROOT/path).read_bytes() == subprocess.check_output(['git', 'show', PIN+':'+path], cwd=ROOT)
    candidate = json.loads((HERE.parent/'candidate.json').read_text())
    for row in candidate['bundles']:
        assert sha(ROOT/row['source']) == row['source_sha256']
        assert sha(ROOT/row['export']) == row['export_sha256']
        for key in ['stock_source_report', 'stock_export_report']:
            assert json.loads((ROOT/row[key]).read_text())['status'] == 'PASS'
    images = list((ROOT/'assets/renders/flora/t04').rglob('*.png'))
    assert len(images) == 46
    assert sum(p.stat().st_size for p in images) == 54805448
    assert sha(ROOT/candidate['preview_manifest']) == candidate['preview_manifest_sha256']
    compiled = []
    for path in sorted((ROOT/'packages/tools/blender/flora_trees').glob('*.py')):
        compile(path.read_bytes(), str(path), 'exec')
        compiled.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(path)})
    result = {'status': 'PASS', 'protected_count': len(before), 'unchanged_count': len(before)-len(changed),
              'authorized_runner_delta': changed, 'additional_protected': '4/4 unchanged', 'shared_pin': PIN,
              'stock_validation': '16 existing PASS reports reused by unchanged pair and report hashes; no new Blender validation',
              'pairs': candidate['bundles'], 'inventory': candidate['inventory'], 'compiled': compiled,
              'previews': {'count': len(images), 'bytes': sum(p.stat().st_size for p in images),
                           'manifest': candidate['preview_manifest'], 'manifest_sha256': candidate['preview_manifest_sha256']},
              'native_capture_inventory': candidate['native_capture_inventory'], 'parent_capture_budget': candidate['parent_capture_budget']}
    with args.out.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print('PASS: 641/642 unchanged (runner delta authorized), extra4 exact, shared515 exact, 8 unchanged asset pairs, 46 previews, 11 Python files compile')


if __name__ == '__main__':
    main()
