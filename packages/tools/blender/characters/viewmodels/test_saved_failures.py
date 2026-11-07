"""Blender CPU reproduction of wrapper failures in a fresh, isolated scratch root.

Blender ... -P test_saved_failures.py -- /absolute/new/scratch-root
No repository source/export is modified. Reports and old outputs remain in scratch.
"""
from pathlib import Path
import importlib.util
import json
import shutil
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(HERE))
from evidence import paths, sha
spec = importlib.util.spec_from_file_location('viewmodel_export_fixture', HERE / 'export.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
scratch = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
assert not scratch.exists() and not scratch.is_relative_to(ROOT)
scratch.mkdir(parents=True)
files = paths(scratch, 'thalune')
originals = paths(ROOT, 'thalune')
protected = {str(path): sha(path) for path in originals.values()}
for path in files.values(): path.parent.mkdir(parents=True, exist_ok=True)
reports = scratch / 'assets/renders/characters/viewmodels/validation'
reports.mkdir(parents=True)
for path in (ROOT / 'assets/renders/characters/viewmodels/validation').glob('*thalune*.json'):
    shutil.copy2(path, reports / path.name)
bpy.ops.wm.open_mainfile(filepath=str(originals['source']))
bpy.data.objects.remove(bpy.data.objects['Muzzle'], do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=str(files['source']), compress=True)
wrapper.ROOT = scratch
sys.argv = ['export.py', '--', 'thalune']
results = []
for case in ('missing-Muzzle', 'codec-exception'):
    shutil.copy2(originals['export'], files['export'])
    if case == 'codec-exception':
        shutil.copy2(originals['source'], files['source'])
        original_compress = wrapper.export.ktx.compress
        def reject_codec(*args, **kwargs):
            raise RuntimeError('R1 real-export injected codec failure')
        wrapper.export.ktx.compress = reject_codec
    try:
        code = wrapper.main()
    finally:
        if case == 'codec-exception': wrapper.export.ktx.compress = original_compress
    receipt = json.loads((reports / 'thalune-receipt.json').read_text())
    assert code == 1 and receipt['status'] == 'FAIL' and receipt['destination_removed']
    assert not files['export'].exists()
    historical = scratch / receipt['history'] / 'fp_thalune.glb'
    assert sha(historical) == protected[str(originals['export'])]
    results.append({'case': case, 'wrapper_exit': code, 'receipt': receipt, 'historical_export_sha256': sha(historical)})
assert all(sha(Path(path)) == digest for path, digest in protected.items())
(scratch / 'results.json').write_text(json.dumps({'results': results, 'repository_inputs_unchanged': protected}, indent=2) + '\n')
print('REAL_SAVED_FAILURES_PASS', json.dumps(results), flush=True)
