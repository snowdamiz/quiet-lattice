"""Render the station grader sheets with standard settings on a bounded CPU process.

python3 assets/blend/stations/_authoring/render_static.py
Create _authoring/scratch/stop-static to stop cleanly between assets for GPU/performance coordination.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'assets/renders/stations'
HERE = Path(__file__).resolve().parent
STOP = HERE / 'scratch/stop-static'
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
SCHEDULE = [
    ('waystation', name) for name in ('ws_cargopod', 'ws_refuelpost', 'ws_fabricator', 'ws_spine', 'ws_habitat', 'ws_baydoor', 'ws_tradedeck', 'ws_ring', 'ws_hangar')
] + [
    ('scrapyard', name) for name in ('sy_dock', 'sy_dock_l', 'sy_deck', 'sy_gangway', 'sy_mouth', 'sy_rock')
] + [('waystation', None), ('scrapyard', None)]
OUT.mkdir(parents=True, exist_ok=True)
ledger = OUT / 'static_manifest.json'
records = json.loads(ledger.read_text()) if ledger.exists() else []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


for family, asset in SCHEDULE:
    src = ROOT / 'packages/client/public/models/stations' / f'{family}.glb'
    sha = digest(src)
    key = asset or 'family'
    if any(r['family'] == family and r['target'] == key and r['source_sha256'] == sha and all((ROOT / a['path']).is_file() and digest(ROOT / a['path']) == a['sha256'] for a in r['artifacts']) for r in records):
        continue
    if STOP.exists():
        print('STOPPED between assets for resource coordination', flush=True)
        break
    manifest = OUT / f'{family}_{key}_manifest.json'
    log = HERE / 'scratch' / f'final_{family}_{key}.log'
    cmd = [BLENDER, '-b', '--factory-startup', '--python-exit-code', '1', '-t', '2', '-P', 'packages/tools/blender/turntable.py', '--', str(src), str(OUT), '--samples', '48', '--manifest', str(manifest), '--cycles-device', 'CPU']
    cmd += ['--asset', asset] if asset else ['--family']
    started = time.time()
    print('START', family, key, 'CPU / 2 threads / 48 samples / full resolution', flush=True)
    with log.open('w') as output:
        subprocess.run(cmd, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, env={**os.environ, 'PYTHONUNBUFFERED': '1'}, check=True, timeout=1800)
    info = json.loads(manifest.read_text())
    paths = info['family']['sheets'] if asset is None else [p for sheet in info['sheets'] for p in (sheet['turntable'], sheet['materials_sheet'])]
    assert paths and all(Path(p).is_file() and Path(p).stat().st_size for p in paths)
    records = [r for r in records if (r['family'], r['target']) != (family, key)]
    records.append({'family': family, 'target': key, 'source': str(src.relative_to(ROOT)), 'source_sha256': sha, 'samples': 48, 'threads': 2, 'device_override': 'CPU', 'resolution_scale': 1, 'seconds': round(time.time()-started, 2), 'manifest': str(manifest.relative_to(ROOT)), 'artifacts': [{'path': str(Path(p).relative_to(ROOT)), 'sha256': digest(Path(p))} for p in paths]})
    ledger.write_text(json.dumps(records, indent=2) + '\n')
    print('COMPLETE', family, key, records[-1]['seconds'], 'seconds', flush=True)
else:
    print('COMPLETE: all station static grader sheets', flush=True)
