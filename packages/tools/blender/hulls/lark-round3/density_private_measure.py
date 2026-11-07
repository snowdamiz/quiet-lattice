"""Measure LOD0 UVDensity on the private candidate; canonical untouched."""
import bpy, hashlib, json, math, os
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
PRIVATE = OUT / 'private-candidate/lark.blend'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
ATLAS = 4096
ROLES = ['Hull', 'Accent', 'Trim', 'Dark']

assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
report = {
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'private_sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'canonical_sha256': EXPECTED,
    'atlas_pixels': ATLAS,
    'density': [],
}

for coll in bpy.data.collections:
    if not coll.name.endswith('_LOD0') or not coll.name.startswith('lark'):
        continue
    for o in coll.objects:
        if o.type != 'MESH' or 'UVDensity' not in o.data.uv_layers:
            continue
        m = o.data
        uv = np.array([l.uv for l in m.uv_layers['UVDensity'].data], np.float64)
        m.calc_loop_triangles()
        buckets = {role: {'area': 0.0, 'uv_area': 0.0, 'edges': []} for role in ROLES}
        for tri in m.loop_triangles:
            role = m.materials[tri.material_index].get('engine_name') if m.materials[tri.material_index] else None
            if role not in buckets:
                continue
            pts = [o.matrix_world @ m.vertices[i].co for i in tri.vertices]
            area = (pts[1] - pts[0]).cross(pts[2] - pts[0]).length * .5
            uvs = uv[list(tri.loops)]
            uv_area = abs((uvs[1, 0] - uvs[0, 0]) * (uvs[2, 1] - uvs[0, 1]) - (uvs[2, 0] - uvs[0, 0]) * (uvs[1, 1] - uvs[0, 1])) * .5
            buckets[role]['area'] += area
            buckets[role]['uv_area'] += uv_area
            for a, b in ((0, 1), (1, 2), (2, 0)):
                world = (pts[b] - pts[a]).length
                span = float(np.linalg.norm(uvs[b] - uvs[a]))
                if world > 1e-4 and span > 1e-8:
                    buckets[role]['edges'].append(ATLAS * span / world)
        for role, b in buckets.items():
            if not b['edges']:
                continue
            vals = np.array(b['edges'])
            row = {
                'key': f'{coll.name}/{o.name}/{role}',
                'area_m2': b['area'],
                'uv_area': b['uv_area'],
                'area_px_per_m': ATLAS * math.sqrt(b['uv_area'] / b['area']) if b['area'] else None,
                'edge_p10_p50_p90': np.percentile(vals, [10, 50, 90]).tolist(),
                'median_px_per_m': float(np.median(vals)),
                'edges': int(len(vals)),
            }
            report['density'].append(row)
            print(row['key'], 'median', round(row['median_px_per_m'], 1), 'area_px_per_m', round(row['area_px_per_m'] or 0, 1), flush=True)

medians = [r['median_px_per_m'] for r in report['density']]
report['summary'] = {
    'roles': len(medians),
    'median_of_medians': float(np.median(medians)) if medians else None,
    'min_median': float(min(medians)) if medians else None,
    'max_median': float(max(medians)) if medians else None,
    'target_px_per_m': 512,
}
out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-density.json')
with out.open('x') as f:
    json.dump(report, f, indent=2)
print('PRIVATE_DENSITY', out.name, report['summary'], flush=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
