"""Offline-in-Blender: how much unique area is near-palette, and whether snap-to-finish packs one 4096 at 512. Private analysis only."""
import bpy, hashlib, json, math, os
import numpy as np
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
SURFACES = OUT / '20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
VIS = json.loads((OUT / 'visibility-inventory.json').read_text())
FIELDS = np.load(SURFACES)
ROLES = ['Hull', 'Accent', 'Trim', 'Dark']
SIZE = 4096
P = 2
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
bpy.ops.wm.open_mainfile(filepath=str(CANON))


def palette_for(means, areas):
    order = np.argsort(-areas)
    means = means[order]
    areas = areas[order]
    pals = []
    for mean, area in zip(means, areas):
        if any(np.max(np.abs(mean - p)) < 0.015 for p in pals):
            continue
        pals.append(mean)
        if len(pals) >= 24:
            break
    return pals


def pack_pages(items):
    rect_px = sum((math.ceil(i['width']) + P) * (math.ceil(i['height']) + P) for i in items)
    return rect_px / (SIZE * SIZE), rect_px


report = {
    'canonical_sha256': EXPECTED,
    'goal': 'unique snap-to-finish toward one 4096 @ 512',
    'states': {},
}

for state in ('lark', 'lark_damaged', 'lark_husked'):
    face_samples = []
    for o in bpy.data.collections[state + '_LOD0'].objects:
        if o.type != 'MESH' or o.name not in VIS[state + '_LOD0']['objects']:
            continue
        key = state + '_LOD0/' + o.name
        if key + '/color' not in FIELDS.files:
            continue
        m = o.data
        color = FIELDS[key + '/color']
        orm = FIELDS[key + '/orm']
        for p in m.polygons:
            role = m.materials[p.material_index].get('engine_name')
            if role not in ROLES:
                continue
            loops = list(p.loop_indices)
            values = np.concatenate((color[loops, :3], orm[loops, 1:3]), axis=1)
            face_samples.append((o.name, p.index, role, p.area, values.mean(0), values.min(0), values.max(0)))
    palettes = {}
    for role in ROLES:
        rows = [r for r in face_samples if r[2] == role]
        if not rows:
            palettes[role] = []
            continue
        means = np.array([r[4] for r in rows])
        areas = np.array([r[3] for r in rows], np.float64)
        palettes[role] = palette_for(means, areas)

    # Per-face distance to nearest palette and classification under tolerances
    tol_stats = {}
    for tol in (0.015, 0.03, 0.05, 0.08, 0.12, 0.20):
        finish_area = unique_area = 0.0
        finish_of = {}
        for o_name, face, role, area, mean, lo, hi in face_samples:
            finish = None
            best = 1e9
            for i, ref in enumerate(palettes[role]):
                # span-based match like layout, but also record mean distance
                span = max(np.max(hi - ref), np.max(ref - lo))
                best = min(best, float(np.max(np.abs(mean - ref))))
                if span < tol:
                    finish = i
                    break
            if finish is None and tol > 0.015:
                # mean-snap fallback for shrink analysis
                for i, ref in enumerate(palettes[role]):
                    if float(np.max(np.abs(mean - ref))) < tol:
                        finish = i
                        break
            finish_of[(o_name, face)] = finish
            if finish is None:
                unique_area += area
            else:
                finish_area += area
        # Build plate regions roughly like layout: group connected same (role,finish,plate)
        # For pack estimate use face areas as island proxies via existing plate components is heavy;
        # instead estimate finish templates from max face-area per (role,finish) *and*
        # unique as square charts per contiguous plate group using pid when present.
        items = []
        common = {}
        unique_groups = defaultdict(float)  # key -> area
        for o in bpy.data.collections[state + '_LOD0'].objects:
            if o.type != 'MESH' or o.name not in VIS[state + '_LOD0']['objects']:
                continue
            m = o.data
            has_plate = all(n in m.attributes for n in ('ds', 'dt', 'pid'))
            pid = np.array([m.attributes['pid'].data[i].value for i in range(len(m.polygons))], np.int32) if has_plate else np.arange(len(m.polygons), dtype=np.int32)
            for p in m.polygons:
                role = m.materials[p.material_index].get('engine_name')
                if role not in ROLES:
                    continue
                fin = finish_of.get((o.name, p.index))
                if fin is not None:
                    k = (role, fin)
                    side = math.sqrt(max(p.area, 1e-8)) * 512
                    item = common.setdefault(k, {'width': 0, 'height': 0, 'role': role, 'finish': True})
                    item['width'] = max(item['width'], side)
                    item['height'] = max(item['height'], side)
                else:
                    unique_groups[(o.name, role, int(pid[p.index]))] += p.area
        items.extend(common.values())
        for area in unique_groups.values():
            side = math.sqrt(max(area, 1e-8)) * 512
            items.append({'width': side, 'height': side, 'role': 'unique', 'finish': False})
        pages, rect_px = pack_pages(items)
        tol_stats[str(tol)] = {
            'finish_area_m2': finish_area,
            'unique_area_m2': unique_area,
            'finish_templates': len(common),
            'unique_islands': len(unique_groups),
            'pack_pages_at_512': pages,
            'rect_px': rect_px,
            'fits_one_page': pages <= 0.90,
        }
    report['states'][state] = {
        'palette_sizes': {role: len(palettes[role]) for role in ROLES},
        'tolerances': tol_stats,
    }
    print(state, json.dumps(tol_stats, indent=2), flush=True)

# Also: finish-only (force all faces to nearest palette by mean)
force = {}
for state in ('lark', 'lark_damaged', 'lark_husked'):
    # reuse last face classification path quickly from report tolerances
    force[state] = report['states'][state]['tolerances'].get('0.2', {})
report['interpretation'] = (
    'Finish templates size by max member sqrt(area)*512. Unique AABB pages dominate. '
    'If near-palette unique snaps into existing finishes without growing the max member, '
    'one-page @512 may fit; if unique is far from palette, snap grows templates or remains unique.'
)
out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-shrink-preflight.json')
with out.open('x') as f:
    json.dump(report, f, indent=2)
print('SHRINK_PREFLIGHT', out.name, flush=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
