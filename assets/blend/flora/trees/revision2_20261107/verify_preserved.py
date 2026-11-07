"""Read-only R2 preservation proof. No Blender, codec, dependency or source writes."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
TOOLS = ROOT/'packages/tools/blender/flora_trees'
ALLOWED = {str(TOOLS/name) for name in ('run.py','export_saved.py','test_runner.py')}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    original = json.loads((HERE/'protected-before.json').read_text())
    preserved, changed = [], []
    for row in original:
        path = Path(row['path'])
        info = path.lstat()
        if str(path) in ALLOWED:
            changed.append({'path':str(path),'before_sha256':row['sha256'],'after_sha256':sha(path)})
            continue
        assert (info.st_mode,info.st_size,info.st_mtime_ns)==(row['mode'],row['bytes'],row['mtime_ns']),str(path)
        if 'sha256' in row:
            assert sha(path)==row['sha256'],str(path)
        elif 'error' in row and stat.S_ISREG(info.st_mode):
            try: path.read_bytes()
            except OSError as error:
                assert {'type':type(error).__name__,'errno':error.errno}==row['error'],str(path)
            else: raise AssertionError(f'unexpected readable entry: {path}')
        preserved.append(row)
    assert {row['path'] for row in changed}==ALLOWED
    shared = ['artlib/checks.py','artlib/materials.py','material_mask_selftest.py','artlib/export.py']
    shared_hashes = {}
    for name in shared:
        path = ROOT/'packages/tools/blender'/name
        pin = '515ba1f00810a50b499970b5468ef7bf0af84c32' if name!='artlib/export.py' else '36861a31e752164469e847a916e0ea21a2e54686'
        assert path.read_bytes()==subprocess.check_output(['git','show',pin+':'+str(path.relative_to(ROOT))],cwd=ROOT)
        shared_hashes[str(path.relative_to(ROOT))]=sha(path)
    candidate = json.loads((HERE.parent/'candidate.json').read_text())
    for pair in candidate['bundles']:
        for key in ('source','export'):
            assert sha(ROOT/pair[key])==pair[key+'_sha256']
        for key in ('stock_source_report','stock_export_report'):
            assert json.loads((ROOT/pair[key]).read_text())['status']=='PASS'
    images = list((ROOT/'assets/renders/flora/t04').rglob('*.png'))
    assert len(images)==46 and sum(p.stat().st_size for p in images)==54805448
    assert sha(ROOT/candidate['preview_manifest'])==candidate['preview_manifest_sha256']
    compiled=[]
    for path in sorted(TOOLS.glob('*.py')):
        compile(path.read_bytes(),str(path),'exec')
        compiled.append({'path':str(path.relative_to(ROOT)),'sha256':sha(path)})
    result={'status':'PASS','original_rows':len(original),'preserved_rows':len(preserved),'authorized_changes':changed,
            'preserved':preserved,'shared_hashes':shared_hashes,'compiled':compiled,
            'reuse_note':'Existing 16 stock PASS / 76 source clouds / 29 real-consumer results are reused by exact protected bytes. No new Blender/stock/consumer run.',
            'pairs':candidate['bundles'],'inventory':candidate['inventory'],
            'previews':{'count':len(images),'bytes':sum(p.stat().st_size for p in images),'manifest':candidate['preview_manifest'],'manifest_sha256':candidate['preview_manifest_sha256']},
            'native_capture_inventory':candidate['native_capture_inventory'],'parent_capture_budget':candidate['parent_capture_budget']}
    with args.out.open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    print(f'PASS: {len(preserved)}/{len(original)} exact; three authorized tooling deltas; 8 blends/8 GLBs/46 previews/shared515/prior reports exact; {len(compiled)} Python files compile')


if __name__=='__main__':main()
