"""Resume standard station review captures only inside a coordinated GPU/browser window.

STATION_GPU_CAPTURE_WINDOW=granted SMOKE_GL=metal python3 assets/blend/stations/_authoring/capture_modules.py
Create _authoring/scratch/stop-capture to stop cleanly between modules. A completed capture is evidence, not a visual grade.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'assets/renders/stations'
STOP = HERE / 'scratch/stop-capture'
SCHEDULE = [
    ('waystation', name) for name in ('ws_cargopod', 'ws_refuelpost', 'ws_fabricator', 'ws_spine', 'ws_habitat', 'ws_baydoor', 'ws_tradedeck', 'ws_ring', 'ws_hangar')
] + [
    ('scrapyard', name) for name in ('sy_dock', 'sy_dock_l', 'sy_deck', 'sy_gangway', 'sy_mouth', 'sy_rock')
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if os.environ.get('STATION_GPU_CAPTURE_WINDOW') != 'granted':
    raise SystemExit('GPU/browser resource grant required; no capture started')
ledger = OUT / 'module_capture_manifest.json'
records = json.loads(ledger.read_text()) if ledger.exists() else []
for family, asset in SCHEDULE:
    src = ROOT / 'packages/client/public/models/stations' / f'{family}.glb'
    sha = digest(src)
    if any(r['family'] == family and r['target'] == asset and r['source_sha256'] == sha and all((ROOT / a['path']).is_file() and digest(ROOT / a['path']) == a['sha256'] for a in r['artifacts']) for r in records):
        continue
    if STOP.exists():
        print('STOPPED between modules for resource coordination', flush=True)
        break
    target = ROOT / 'assets/renders/review/stations' / family / asset
    log = HERE / 'scratch' / f'capture_{family}_{asset}.log'
    command = ['pnpm', 'capture', '--', '--review', f'stations/{family}', '--asset', asset]
    print('START', family, asset, flush=True)
    started = time.time()
    with log.open('w') as output:
        subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, check=True)
    report = json.loads((target / 'perf.json').read_text())
    assert not report['errors'], report['errors']
    names = [f'{light}_lod{lod}.png' for light in ('noon-lush', 'night-exotic', 'open-space') for lod in (0, 2)]
    names += ['wireframe_lod0.png', 'wireframe_lod2.png', 'overlay.png', 'far_lod2.png', 'sheet.png', 'perf.json']
    paths = [target / name for name in names]
    assert all(p.is_file() and p.stat().st_size for p in paths)
    records = [r for r in records if (r['family'], r['target']) != (family, asset)]
    records.append({'family': family, 'target': asset, 'source_sha256': sha, 'seconds': round(time.time()-started, 2), 'status': 'captured; raw performance and placement limitations retained in perf.json', 'artifacts': [{'path': str(p.relative_to(ROOT)), 'sha256': digest(p)} for p in paths]})
    ledger.write_text(json.dumps(records, indent=2) + '\n')
    print('COMPLETE', family, asset, records[-1]['seconds'], 'seconds', flush=True)
else:
    print('COMPLETE: all station standard review captures; inspect images before independent grading', flush=True)
