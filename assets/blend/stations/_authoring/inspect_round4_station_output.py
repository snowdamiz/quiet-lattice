"""CPU-only full-raster artifact inspection after an owned station stage has drained."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[4]
STANDARD_NAMES = {'noon-lush_lod0.png', 'noon-lush_lod2.png', 'night-exotic_lod0.png', 'night-exotic_lod2.png',
                  'open-space_lod0.png', 'open-space_lod2.png', 'wireframe_lod0.png', 'wireframe_lod2.png',
                  'overlay.png', 'far_lod2.png', 'sheet.png', 'perf.json'}


def inspect(stage, root=ROOT):
    assert pillow_version == '12.0.0'
    root = Path(root)
    out = root / stage['out_path']
    assert out.is_dir() and not out.is_symlink()
    if stage['kind'] == 'standard':
        expected = STANDARD_NAMES
    else:
        shots = [dict(part.split('=', 1) for part in value.split(',')) for value in stage['requested_shots']]
        expected = {s['name'] + '.png' for s in shots} | {'shots.json'}
    assert {p.name for p in out.iterdir()} == expected, 'Missing or unexpected output files'
    records = []
    for path in sorted(out.iterdir()):
        assert path.is_file() and not path.is_symlink()
        record = {'path': str(path.relative_to(root)), 'bytes': path.stat().st_size,
                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        if path.suffix == '.png':
            with Image.open(path) as image: image.verify()
            with Image.open(path) as image:
                image.load()
                assert image.size == ((1920, 2876) if path.name == 'sheet.png' else (1920, 1080)), 'Resolution changed'
                rgba = image.convert('RGBA')
                record.update(pixels=list(image.size), decoded_rgba_sha256=hashlib.sha256(rgba.tobytes()).hexdigest(),
                              extrema=rgba.getextrema(), decoder='Pillow12 verify and full raster load')
        records.append(record)
    if stage['kind'] == 'standard':
        report = json.loads((out / 'perf.json').read_text())
        assert report['file'] == 'stations/scrapyard' and report['asset'] == report['variant'] == 'sy_rock'
        assert report['gl'] == 'metal' and report['viewport'] == [1920, 1080] and report['errors'] == []
        assert len(report['perf']) == 3 and report['class'] == 'building'
        metadata = {'actual_backend': 'UNKNOWN; unchanged standard helper records requested gl only',
                    'raw_perf_qualification': 'UNQUALIFIED_E14_T13', 'perf_errors': report['errors']}
    else:
        rows = json.loads((out / 'shots.json').read_text())
        assert len(rows) == len(shots)
        expected_spec = Path(stage['argv'][stage['argv'].index('--glb') + 1]).name if '--glb' in stage['argv'] else stage['argv'][stage['argv'].index('--spec') + 1]
        for row, requested in zip(rows, shots):
            assert row['name'] == requested['name'] and row['shot'] == requested, 'Requested shot mismatch'
            assert row['spec'] == expected_spec and row['viewport'] == [1920, 1080]
            assert row['gl'] == 'metal' and 'metal' in row['renderer'].lower()
            assert row['errors'] == [] and row['perf'] == [], 'Supplement must retain zero perf calls'
        metadata = {'actual_backend': [r['renderer'] for r in rows],
                    'requested_shots': shots, 'actual_shot_metadata': rows,
                    'requested_actual_camera_equivalence_claimed': False,
                    'ground_occlusion_is_an_evidence_limit': True, 'supplement_perf_calls': 0}
    return {'valid': True, 'stage': stage['id'], 'files': records, 'metadata': metadata,
            'visual_grade': 'PENDING_INDEPENDENT_FOURTH_REVIEW'}


if __name__ == '__main__':
    assert len(sys.argv) == 2
    print(json.dumps(inspect(json.loads(sys.argv[1]))))
