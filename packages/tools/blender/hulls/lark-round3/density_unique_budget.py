"""Classify remaining unique area into cockpit-forced / emission-scorch / palette-far. Read-only."""
import bpy, hashlib, json, math, os
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
SURFACES = OUT / '20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
VIS = json.loads((OUT / 'visibility-inventory.json').read_text())
FIELDS = np.load(SURFACES)
ROLES = ['Hull', 'Accent', 'Trim', 'Dark']
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
bpy.ops.wm.open_mainfile(filepath=str(CANON))


def palette_for(means, areas):
    order = np.argsort(-areas)
    means, areas = means[order], areas[order]
    pals = []
    for mean, area in zip(means, areas):
        if any(np.max(np.abs(mean - p)) < 0.015 for p in pals):
            continue
        pals.append(mean)
        if len(pals) >= 24:
            break
    return pals


report = {'states': {}}
for state in ('lark', 'lark_damaged', 'lark_husked'):
    face_samples = []
    emission = None
    # load emission atlas if present in fields
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
            face_samples.append((o.name, p.index, role, float(p.area), values.mean(0), values.min(0), values.max(0), np.array([l.uv[:] for l in (m.uv_layers.active.data[i] for i in loops)])))
    palettes = {}
    for role in ROLES:
        rows = [r for r in face_samples if r[2] == role]
        if not rows:
            palettes[role] = []
            continue
        means = np.array([r[4] for r in rows])
        areas = np.array([r[3] for r in rows], np.float64)
        palettes[role] = palette_for(means, areas)

    # Try to get emission image from blend materials for scorch test
    em_img = None
    for img in bpy.data.images:
        if state.replace('lark_', '').replace('lark', 'lark') in img.name and 'emiss' in img.name.lower():
            em_img = img
            break
    # Use packed emission from Body material if any
    buckets = {
        'strict_finish': 0.0,
        'snap_finish_0_08': 0.0,
        'cockpit_forced_unique': 0.0,
        'emission_forced_unique': 0.0,
        'palette_far_unique': 0.0,
    }
    for o_name, face, role, area, mean, lo, hi, uvs in face_samples:
        finish = None
        for i, ref in enumerate(palettes[role]):
            if max(np.max(hi - ref), np.max(ref - lo)) < 0.015:
                finish = i
                break
        snapped = False
        if finish is None:
            best_d = min((float(np.max(np.abs(mean - ref))) for ref in palettes[role]), default=1e9)
            if best_d <= 0.08:
                snapped = True
        reason = None
        if finish is not None:
            reason = 'strict_finish'
        elif snapped:
            reason = 'snap_finish_0_08'
        elif o_name.startswith('Cockpit'):
            reason = 'cockpit_forced_unique'
        else:
            # emission check using UV sample if emission map exists on object
            reason = 'palette_far_unique'
            o = bpy.data.objects.get(o_name)
            if o and role in ('Hull', 'Accent'):
                for s in o.material_slots:
                    if not s.material or s.material.get('engine_name') != role:
                        continue
                    nt = s.material.node_tree
                    if not nt:
                        continue
                    for n in nt.nodes:
                        if n.type == 'TEX_IMAGE' and n.image and 'emiss' in n.image.name.lower():
                            img = n.image
                            w, h = img.size
                            px = np.array(img.pixels[:]).reshape(h, w, 4)
                            xy = np.clip(np.floor(uvs * [w, h]).astype(int), 0, [w - 1, h - 1])
                            if px[xy[:, 1], xy[:, 0], :3].max() > 0.005:
                                reason = 'emission_forced_unique'
                            break
                    break
        buckets[reason] += area
    # Ideal unique after removing cockpit force + allowing snap
    remaining_if_cockpit_shared = buckets['palette_far_unique'] + buckets['emission_forced_unique']
    report['states'][state] = {
        'buckets_m2': buckets,
        'unique_if_cockpit_may_share_m2': remaining_if_cockpit_shared,
        'unique_ideal_pages_at_512': remaining_if_cockpit_shared * 512 ** 2 / (4096 ** 2),
    }
    print(state, json.dumps(report['states'][state], indent=2), flush=True)

out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-unique-budget.json')
with out.open('x') as f:
    json.dump(report, f, indent=2)
print('UNIQUE_BUDGET', out.name, flush=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
