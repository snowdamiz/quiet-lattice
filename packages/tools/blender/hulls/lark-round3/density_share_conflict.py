"""Measure orientation/AO disagreement among shared finish UV templates; no save."""
import hashlib, json, os, math
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parents[5] / 'assets/renders/hulls/lark-round3-current/density-20261107'
MANIFEST = OUT / os.environ.get(
    'LARK_LAYOUT_MANIFEST',
    '20261107T130210350281Z-layout-preflight-v10-flat-share-policy-layout.json',
)
SURFACES = OUT / '20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
assert hashlib.sha256(SURFACES.read_bytes()).hexdigest() == '5e073e5b76660581393b1cdc63950cefe4692d837ca944245ff599ea31ecb731'
surf = np.load(SURFACES)
manifest = json.loads(MANIFEST.read_text())
report = {
    'layout_manifest': MANIFEST.name,
    'premise': 'Shared finish templates are bake-safe for colour/ORM when AO agrees. Opposite world normals are acceptable when the bake policy uses flat tangent normals and constant AO on shared islands.',
    'shared_finish_bake_policy': manifest.get('shared_finish_bake_policy'),
    'states': {},
}

for state, stats in manifest['states'].items():
    shared = {}
    for r in stats['regions']:
        if r['finish'] is None:
            continue
        shared.setdefault((r['role'], r['finish']), []).append(r)
    rows = []
    worst = 0.0
    worst_ao = 0.0
    for key, regs in shared.items():
        if len(regs) < 2:
            continue
        means = []
        aos = []
        areas = []
        for r in regs:
            skey = f'{state}_LOD0/{r["object"]}'
            if skey + '/normal' not in surf.files or skey + '/orm' not in surf.files:
                continue
            # Average corner normals/AO over region loops via face vertex gather from surfaces triangles is heavy;
            # use face-area-weighted normals from polygon face list approximated by unique loops in layout archive if present.
            # Fallback: object-level role mask average for faces listed.
            normals = surf[skey + '/normal']
            orm = surf[skey + '/orm']
            # Region face indices refer to mesh polygons; map through polygon attribute on surfaces.
            if skey + '/polygon' not in surf.files:
                continue
            poly = surf[skey + '/polygon']
            tris = surf[skey + '/triangles']
            face_set = set(r['faces'])
            sel = np.isin(poly, list(face_set))
            if not sel.any():
                continue
            n = normals[tris[sel]].reshape(-1, 3).mean(0)
            n = n / max(np.linalg.norm(n), 1e-12)
            ao = float(orm[tris[sel]].reshape(-1, orm.shape[-1])[:, 0].mean())
            means.append(n)
            aos.append(ao)
            areas.append(r['world_area'])
        if len(means) < 2:
            continue
        means = np.array(means)
        # Max angle between any pair of region mean normals.
        dots = np.clip(means @ means.T, -1, 1)
        angles = np.degrees(np.arccos(np.triu(dots, 1)))
        angles = angles[angles > 0]
        max_angle = float(angles.max()) if len(angles) else 0.0
        ao_span = float(np.ptp(aos))
        worst = max(worst, max_angle)
        worst_ao = max(worst_ao, ao_span)
        rows.append({
            'role': key[0], 'finish': key[1], 'regions': len(regs), 'compared': len(means),
            'total_area_m2': float(sum(areas)), 'max_mean_normal_angle_deg': max_angle, 'ao_span': ao_span,
        })
    rows.sort(key=lambda r: -r['max_mean_normal_angle_deg'])
    authorized = worst_ao <= 1e-3
    report['states'][state] = {
        'shared_finish_groups': len(shared),
        'compared_groups': len(rows),
        'worst_mean_normal_angle_deg': worst,
        'worst_ao_span': worst_ao,
        'flat_normal_constant_ao_authorized': authorized,
        'authorization': (
            'AO span ~0 across shared finish groups; opposite world normals deferred to flat tangent fill at bake'
            if authorized else 'AO disagreement blocks shared finish bake'
        ),
        'top_conflicts': rows[:12],
    }
    print(state, 'worst_normal_angle_deg', worst, 'worst_ao_span', worst_ao, 'authorized', authorized, 'groups', len(rows), flush=True)

out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-share-conflict.json')
with out.open('x') as f:
    json.dump(report, f, indent=2)
print('wrote', out.name, flush=True)
