"""Check that a complete review set is fresh, then record its source/artifact hashes.

Run after the serialized studio/engine pack and distance comparisons:
    python3 packages/tools/blender/characters/review_inventory.py thalune 5

Freshness is an execution-time check, not a visual grade. The resulting hashes
preserve the checked set even when a checkout changes filesystem timestamps.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('species', choices=('thalune', 'ixari', 'ulgani'))
parser.add_argument('round', type=int)
args = parser.parse_args()
root = Path(__file__).resolve().parents[4]
people = args.species
source = root / f'assets/blend/characters/{people}.blend'
export = root / f'packages/client/public/models/characters/{people}.glb'
studio = root / 'assets/renders/characters'
review = root / f'assets/renders/review/characters/{people}/{people}'
variants = [f'{kind}{number}' for kind, count in (('head', 6), ('suit', 4)) for number in range(1, count + 1)]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

source_hash, export_hash = sha(source), sha(export)
run_path = studio / f'validate/{people}-review{args.round}-run.json'
run = json.loads(run_path.read_text())
assert run['steps'][-1]['command'] == ['pnpm', 'capture', '--', '--review', f'characters/{people}'], 'Engine capture did not complete'
assert run['source_sha256'] == source_hash, 'Source changed during review generation'
assert run['export_sha256'] == export_hash, 'Export changed during review generation'
audit = json.loads((studio / 'validate/source-audit.json').read_text())['species'][people]
assert audit['sha256'] == source_hash, 'Source audit is stale'

expected = []
def add(path, dependency):
    expected.append((path, dependency))

for variant in variants:
    for ending in ('turntable.png', 'materials.png', 'materials.txt'):
        add(studio / f'{people}_{people}_{people}_{variant}_{ending}', source)
    directory = review / f'{people}_{variant}'
    for case in ('noon-lush', 'night-exotic', 'open-space'):
        for level in (0, 2):
            add(directory / f'{case}_lod{level}.png', export)
    for name in ('wireframe_lod0.png', 'wireframe_lod2.png', 'overlay.png', 'far_lod2.png',
                 'far200_lod2.png', 'perf.json', 'sheet.png'):
        add(directory / name, export)
for ending in ('turntable.png', 'materials.png', 'materials.txt', 'heads_family.png', 'heads_family.txt',
               'suits_family.png', 'suits_family.txt', 'heads_closeup.png', 'blendshapes.png',
               'blendshapes.txt', 'hands_feet.png', 'bendtest_head1.png', 'bendtest_suit3.png'):
    add(studio / f'{people}_{ending}', source)
for suffix in ('', '_grayscale'):
    for extension in ('png', 'json'):
        add(root / f'assets/renders/review/characters/{people}_lineup_far_lod2{suffix}.{extension}', export)
for extension, dependency in (('blend', source), ('glb', export)):
    add(studio / f'validate/characters__{people}.{extension}.json', dependency)

artifacts = []
for path, dependency in expected:
    assert path.is_file(), f'Missing required artifact: {path}'
    stat = path.stat()
    assert stat.st_mtime >= dependency.stat().st_mtime, f'Artifact predates its input: {path}'
    artifacts.append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'bytes': stat.st_size,
                      'input': str(dependency.relative_to(root))})
capture_checks = []
for variant in variants:
    capture = json.loads((review / f'{people}_{variant}/perf.json').read_text())
    assert capture['file'] == f'characters/{people}' and capture['variant'] == f'{people}_{variant}'
    assert not capture['errors'], f'Capture errors in {variant}: {capture["errors"]}'
    assert len(capture['perf']) == 3
    assert {case['case'] for case in capture['perf']} == {'noon-lush', 'night-exotic', 'open-space'}
    for case in capture['perf']:
        asset = case['asset']
        assert case['lod'] == 0 and asset['triangles'] > 0 and asset['drawCalls'] > 0
        assert case['scene']['triangles'] > case['withoutAsset']['triangles'], 'No measured asset work'
        assert asset['pairs'] > 0 and case['scene']['gpuSamples'] > 0
        capture_checks.append({'variant': variant, 'case': case['case'], 'gpu_timing': case['gpuTiming'],
                               'pairs': asset['pairs'], 'reliable': asset['reliable'],
                               'triangles': asset['triangles'], 'draw_calls': asset['drawCalls'],
                               'page_errors': len(capture['errors'])})
output = studio / f'validate/{people}-review{args.round}-inventory.json'
output.write_text(json.dumps({
    'note': 'Completeness, local generation freshness and hash consistency; not a visual grade.',
    'verified_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'round': args.round, 'source_sha256': source_hash, 'export_sha256': export_hash,
    'generation_run_sha256': sha(run_path), 'source_evidence': audit,
    'artifact_count': len(artifacts), 'artifacts': artifacts,
    'single_session_capture_checks': capture_checks,
}, indent=2) + '\n')
print('REVIEW_INVENTORY_PASS', people, len(artifacts), output)
