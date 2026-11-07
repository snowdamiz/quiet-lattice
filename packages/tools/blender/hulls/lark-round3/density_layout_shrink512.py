"""Plan source-owned 512 px/m charts using plate ds/dt and palette finishes; no save."""
import bpy, json, math, hashlib, os, sys
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
SRC = ROOT / 'assets/blend/hulls/lark.blend'
ROLES = ['Hull', 'Accent', 'Trim', 'Dark']
P = 2  # shrink path: tighter pack padding; bake margin stays separate in transfer
SIZE = 4096
PALETTE_LIMIT = 12
FINISH_PACK_BUDGET = SIZE * SIZE * 0.92  # leave headroom for packer waste
SURFACES = OUT / '20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED
assert hashlib.sha256(SURFACES.read_bytes()).hexdigest() == '5e073e5b76660581393b1cdc63950cefe4692d837ca944245ff599ea31ecb731'
VIS = json.loads((OUT / 'visibility-inventory.json').read_text())
FIELDS = np.load(SURFACES)
bpy.ops.wm.open_mainfile(filepath=str(SRC))


def area2(v):
    return abs((v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1])) * .5


def attr_values(mesh, name):
    a = mesh.attributes[name]
    if a.data_type == 'FLOAT':
        return np.array([d.value for d in a.data], np.float64)
    if a.data_type == 'INT':
        return np.array([d.value for d in a.data], np.int32)
    raise TypeError(name)


def palette_for(means, areas, channels=5, tol=.015, limit=PALETTE_LIMIT):
    v = means.copy()
    a = areas.copy()
    pal = []
    while a.sum() > 0 and len(pal) < limit:
        bins = np.round(v[:, :3] * 32).astype(int)
        ids, inv = np.unique(bins, axis=0, return_inverse=True)
        weights = np.bincount(inv, weights=a)
        idx = int(weights.argmax())
        sel = (inv == idx) & (a > 0)
        if not sel.any():
            break
        ref = np.average(v[sel], axis=0, weights=a[sel])
        matched = (np.abs(v - ref).max(1) < tol) & (a > 0)
        if not matched.any():
            a[sel] = 0
            continue
        pal.append(ref)
        a[matched] = 0
    return pal


class Bin:
    def __init__(self):
        self.free = [(0, 0, SIZE, SIZE)]

    def score(self, w, h):
        choices = []
        for x, y, a, b in self.free:
            for rotate, ww, hh in [(False, w, h), (True, h, w)]:
                if ww <= a and hh <= b:
                    choices.append(((min(a - ww, b - hh), max(a - ww, b - hh), y, x), (x, y, ww, hh, rotate)))
        return min(choices) if choices else None

    def put(self, rect):
        x, y, w, h, _ = rect
        new = []
        for a, b, c, d in self.free:
            if x >= a + c or x + w <= a or y >= b + d or y + h <= b:
                new.append((a, b, c, d))
                continue
            if x > a:
                new.append((a, b, x - a, d))
            if x + w < a + c:
                new.append((x + w, b, a + c - x - w, d))
            if y > b:
                new.append((a, b, c, y - b))
            if y + h < b + d:
                new.append((a, y + h, c, b + d - y - h))
        a = np.array([r for r in new if r[2] > 0 and r[3] > 0], np.int32)
        keep = np.ones(len(a), bool)
        indices = np.arange(len(a))
        end = a[:, :2] + a[:, 2:]
        for start in range(0, len(a), 128):
            q = a[start:start + 128]
            qe = end[start:start + 128]
            qi = indices[start:start + 128]
            contained = (q[:, None, 0] >= a[None, :, 0]) & (q[:, None, 1] >= a[None, :, 1]) & (qe[:, None, 0] <= end[None, :, 0]) & (qe[:, None, 1] <= end[None, :, 1])
            equal = (q[:, None, :] == a[None, :, :]).all(2)
            contained &= (~equal) | (qi[:, None] > indices[None, :])
            keep[start:start + len(q)] = ~contained.any(1)
        self.free = [tuple(r) for r in a[keep].tolist()]


archive = {}
manifest = {
    'source_sha256': EXPECTED,
    'exact_surfaces': SURFACES.name,
    'exact_surfaces_sha256': '5e073e5b76660581393b1cdc63950cefe4692d837ca944245ff599ea31ecb731',
    'visible_target_px_per_m': 512,
    'fully_enclosed_target_px_per_m': 512,
    'method': 'Plate ds/dt multi-finish palette sharing with near-palette unique snap (mean Δ≤0.20), Cockpit may share, palette_limit=12, pack pad=2 into one 4096 atlas at true 512 px/m; large finish templates reshape to area-preserving strips so leftover fits peer squares; shared islands use flat tangent normal + constant AO; no force-fit scale; no source save.',
    'atlas_pages': 1,
    'unique_snap_mean_tol': 0.20,
    'finish_span_tol': 0.015,
    'stock_texture_max_px': 4096,
    'shared_finish_bake_policy': {
        'color_orm': 'Shared physical-density template; member islands sample the same uniform finish.',
        'normal': 'Flat tangent-space normal for shared islands (panels are unmarked finish, not bevel detail).',
        'occlusion': 'Constant AO on shared islands; location-specific AO remains only on unique marked islands.',
        'rationale': 'Opposite shell sides share flat finish without baking conflicting world-space curvature or cavity AO into one texel.',
    },
    'states': {},
}
all_ok = True

for state in ['lark', 'lark_damaged', 'lark_husked']:
    emission = None
    if state == 'lark_husked':
        im = bpy.data.images['lark_husked_4k_emissive']
        a = np.empty(len(im.pixels), np.float32)
        im.pixels.foreach_get(a)
        emission = a.reshape(4096, 4096, 4)
    # Build finish palettes from exact corner fields on LOD0 painted objects.
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
    finish_of = {}
    snapped = 0
    snapped_area = 0.0
    for o_name, face, role, area, mean, lo, hi in face_samples:
        finish = None
        for i, ref in enumerate(palettes[role]):
            if max(np.max(hi - ref), np.max(ref - lo)) < .015:
                finish = i
                break
        if finish is None:
            # Unique-paint shrink: demote near-palette faces into shared finish.
            best_i, best_d = None, 1e9
            for i, ref in enumerate(palettes[role]):
                d = float(np.max(np.abs(mean - ref)))
                if d < best_d:
                    best_d, best_i = d, i
            if best_i is not None and best_d <= 0.20:
                finish = best_i
                snapped += 1
                snapped_area += float(area)
        finish_of[(o_name, face)] = finish
    print(state, 'near_palette_snap_faces', snapped, 'snap_area_m2', round(snapped_area, 3), flush=True)

    regions = []
    object_meta = {}
    for o in bpy.data.collections[state + '_LOD0'].objects:
        if o.type != 'MESH' or o.name not in VIS[state + '_LOD0']['objects']:
            continue
        m = o.data
        m.calc_loop_triangles()
        old_uv = np.array([l.uv for l in m.uv_layers.active.data], np.float64)
        uv = old_uv.copy()
        has_plate = all(n in m.attributes for n in ('ds', 'dt', 'pid'))
        pid = attr_values(m, 'pid') if has_plate else np.arange(len(m.polygons), dtype=np.int32)
        ds = attr_values(m, 'ds') if has_plate else None
        dt = attr_values(m, 'dt') if has_plate else None
        metre_per_param = 1.0
        if has_plate:
            scales = []
            for e in m.edges:
                a, b = e.vertices
                dpar = math.hypot(ds[a] - ds[b], dt[a] - dt[b])
                if dpar < 1e-8:
                    continue
                wa = o.matrix_world @ m.vertices[a].co
                wb = o.matrix_world @ m.vertices[b].co
                scales.append((wa - wb).length / dpar)
            if scales:
                metre_per_param = float(np.median(scales))

        # Component frames for rail/cylinder unwraps (LandingMechanism and tubular parts).
        parents = list(range(len(m.vertices)))

        def root(v):
            while parents[v] != v:
                parents[v] = parents[parents[v]]
                v = parents[v]
            return v

        for edge in m.edges:
            a, b = edge.vertices
            parents[root(a)] = root(b)
        comp_indices = {}
        for v in m.vertices:
            comp_indices.setdefault(root(v.index), []).append(v.index)
        component_data = {}
        for ci, ids in comp_indices.items():
            if len(ids) < 3:
                continue
            co = np.array([o.matrix_world @ m.vertices[i].co for i in ids])
            center = co.mean(0)
            _, _, basis = np.linalg.svd(co - center, full_matrices=False)
            q = (co - center) @ basis.T
            span = np.ptp(q, axis=0)
            cylindrical = span[0] > 3 * max(span[1], span[2])
            rail = o.name.startswith('LandingMechanism') and np.ptp(co, axis=0)[2] > 2 and np.ptp(co, axis=0)[1] < .2
            t = q[:, 0]
            cross = q[:, 1:]
            radius = np.median(np.linalg.norm(cross, axis=1))
            if rail:
                path = np.array([[-3, .95, -1.95], [-2.25, .95, 1.10], [-.92, .95, 1.48]])
                dirs = np.diff(path, axis=0)
                lengths = np.linalg.norm(dirs, axis=1)
                dirs /= lengths[:, None]
                dist = []
                along = []
                crosses = []
                for j in range(2):
                    d = dirs[j]
                    delta = co - path[j]
                    tt = delta @ d
                    nearest = path[j] + np.clip(tt, 0, lengths[j])[:, None] * d
                    dist.append(np.linalg.norm(co[:, [0, 2]] - nearest[:, [0, 2]], axis=1))
                    along.append(tt + (lengths[0] if j else 0))
                    crosses.append(delta @ np.array([d[2], 0, -d[0]]))
                which = np.argmin(np.array(dist), axis=0)
                ii = np.arange(len(ids))
                t = np.array(along)[which, ii]
                cc = np.array(crosses)[which, ii]
                cross = np.column_stack((cc - np.median(cc), co[:, 1] - center[1]))
                radius = np.percentile(np.linalg.norm(cross, axis=1), 85)
                cylindrical = True
            values = {vi: (q[k], float(t[k]), float(math.atan2(cross[k, 1], cross[k, 0]))) for k, vi in enumerate(ids)}
            component_data[ci] = (center, basis, cylindrical, radius, values)

        def planar_uv(face_ids):
            ids = sorted({m.loops[li].vertex_index for fi in face_ids for li in m.polygons[fi].loop_indices})
            co = np.array([o.matrix_world @ m.vertices[i].co for i in ids])
            center = co.mean(0)
            _, _, basis = np.linalg.svd(co - center, full_matrices=False)
            q = (co - center) @ basis.T[:, :2]
            local = {vi: q[k] for k, vi in enumerate(ids)}
            out = np.zeros((len(m.loops), 2), np.float64)
            for fi in face_ids:
                for li in m.polygons[fi].loop_indices:
                    out[li] = local[m.loops[li].vertex_index]
            return out

        def rail_or_cylinder_uv(face_ids):
            out = np.zeros((len(m.loops), 2), np.float64)
            for fi in face_ids:
                p = m.polygons[fi]
                ci = root(p.vertices[0])
                if ci not in component_data:
                    return None
                center, basis, cyl, radius, values = component_data[ci]
                normal = np.array(o.matrix_world.to_3x3() @ p.normal) @ basis.T
                if cyl and abs(normal[0]) < .85:
                    angles = np.array([values[m.loops[li].vertex_index][2] for li in p.loop_indices])
                    if np.ptp(angles) > math.pi:
                        angles[angles < 0] += 2 * math.pi
                    for li, angle in zip(p.loop_indices, angles):
                        out[li] = [values[m.loops[li].vertex_index][1], angle * radius]
                else:
                    drop = int(np.argmax(np.abs(normal)))
                    axes = [i for i in range(3) if i != drop]
                    for li in p.loop_indices:
                        out[li] = values[m.loops[li].vertex_index][0][axes]
            return out

        def compact_local(points, world_area):
            """Area-preserving chart when parametric unwraps fold or degenerate."""
            q = points - points.mean(0)
            _, _, vh = np.linalg.svd(q, full_matrices=False)
            q = q @ vh[:2].T
            q -= q.min(0)
            extents = np.maximum(np.ptp(q, axis=0), 1e-9)
            target_area = max(world_area, 1e-8) * 512 ** 2
            aspect = extents[0] / extents[1]
            # Keep charts packable: extreme needles are UV failures, not real panels.
            aspect = min(max(aspect, 1 / 8), 8)
            height = math.sqrt(target_area / aspect)
            width = aspect * height
            if max(width, height) > SIZE - 2 * P:
                side = math.sqrt(target_area)
                width = height = side
            local = np.column_stack((q[:, 0] / extents[0] * width, q[:, 1] / extents[1] * height))
            return local, np.array([width, height], np.float64)

        visible = set(VIS[state + '_LOD0']['objects'][o.name]['visible_polygons'])
        labels = {}
        edges = {}
        parent = list(range(len(m.polygons)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for p in m.polygons:
            role = m.materials[p.material_index].get('engine_name')
            if role not in ROLES:
                continue
            finish = finish_of.get((o.name, p.index))
            # Shrink path: allow Cockpit to share near-palette finish (was forced unique).
            # Shrink path: do not carve emission/scorch into exclusive unique charts.
            # Scorch remains in source maps but shares near-palette finish UV islands.
            if False and emission is not None and role in ('Hull', 'Accent') and finish is not None:
                loops = list(p.loop_indices)
                xy = np.clip(np.floor(old_uv[loops] * 4096).astype(int), 0, 4095)
                if emission[xy[:, 1], xy[:, 0], :3].max() > .005:
                    finish = None
            plate = int(pid[p.index])
            label = (role, finish, plate)
            labels[p.index] = label
            # Connect only by mesh edges, not by UV identity, so plate param seams stay separate charts.
            for a, b in zip(p.vertices, list(p.vertices[1:]) + [p.vertices[0]]):
                key = (label, tuple(sorted((a, b))))
                if key in edges:
                    parent[find(p.index)] = find(edges[key])
                else:
                    edges[key] = p.index
        groups = {}
        for p in m.polygons:
            if p.index in labels:
                groups.setdefault(find(p.index), []).append(p.index)
        tris_by_face = {}
        for tri in m.loop_triangles:
            tris_by_face.setdefault(tri.polygon_index, []).append(tri)
        chart_uv = old_uv.copy()
        for idx, face_ids in groups.items():
            role, finish, _ = labels[face_ids[0]]
            seen = any(fi in visible for fi in face_ids)
            world_area = 0.0
            for fi in face_ids:
                for t in tris_by_face[fi]:
                    ps = [o.matrix_world @ m.vertices[i].co for i in t.vertices]
                    world_area += (ps[1] - ps[0]).cross(ps[2] - ps[0]).length * .5
            if world_area < 1e-12:
                continue
            method = 'planar'
            chart_uv_local = None
            if o.name.startswith('LandingMechanism') or any(o.name.startswith(p) for p in ('Lens',)):
                chart_uv_local = rail_or_cylinder_uv(face_ids)
                if chart_uv_local is not None:
                    method = 'rail-cylinder'
            if chart_uv_local is None and has_plate:
                chart_uv_local = np.zeros((len(m.loops), 2), np.float64)
                for fi in face_ids:
                    for li in m.polygons[fi].loop_indices:
                        v = m.loops[li].vertex_index
                        chart_uv_local[li] = (ds[v] * metre_per_param, dt[v] * metre_per_param)
                method = 'plate-ds-dt'
            if chart_uv_local is None:
                chart_uv_local = planar_uv(face_ids)
                method = 'planar'
            for fi in face_ids:
                for li in m.polygons[fi].loop_indices:
                    chart_uv[li] = chart_uv_local[li]
            uv_area = 0.0
            for fi in face_ids:
                for t in tris_by_face[fi]:
                    uv_area += area2(chart_uv[list(t.loops)])
            loops = np.array([l for fi in face_ids for l in m.polygons[fi].loop_indices], np.int32)
            points = chart_uv[loops]
            target = 512
            ratio = uv_area / world_area if world_area else 0.0
            use_compact = uv_area < 1e-14 or ratio < .05 or ratio > 20
            if not use_compact:
                factor = target * math.sqrt(world_area / max(uv_area, 1e-18))
                best = None
                for angle in np.linspace(0, math.pi / 2, 19):
                    rot = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
                    q = points @ rot
                    span = np.ptp(q, axis=0) * factor
                    if best is None or np.prod(span) < best[0]:
                        best = (np.prod(span), rot, q.min(0), span)
                _, rot, lo, span = best
                if span[0] > span[1]:
                    rot = rot[:, ::-1]
                    lo = lo[::-1]
                    span = span[::-1]
                local = (points @ rot - lo) * factor
                if max(span) > SIZE - 2 * P or span[0] * span[1] > world_area * 512 ** 2 * 20:
                    use_compact = True
            if use_compact:
                local, span = compact_local(points if uv_area >= 1e-14 else planar_uv(face_ids)[loops], world_area)
                method = method + '+area-compact'
                rot = np.eye(2).tolist()
                lo = [0.0, 0.0]
                factor = 1.0
            if max(span) > SIZE - 2 * P:
                # Still oversized after compact (very large connected plate): keep unique and mark failure later via packer.
                pass
            ri = len(regions)
            key = f'{state}/{o.name}/{ri}'
            archive[key + '/loops'] = loops
            archive[key + '/local'] = local.astype(np.float32)
            regions.append({'id': ri, 'object': o.name, 'faces': face_ids, 'role': role, 'finish': finish, 'visible': seen, 'world_area': world_area, 'uv_area_before': uv_area, 'target': target, 'width_px': float(span[0]), 'height_px': float(span[1]), 'rotation': rot if isinstance(rot, list) else rot.tolist(), 'low': lo if isinstance(lo, list) else lo.tolist(), 'factor': factor, 'key': key, 'method': method})
            for li in loops:
                uv[li] = chart_uv[li]
        archive[state + '/' + o.name + '/old_uv'] = old_uv.astype(np.float32)
        archive[state + '/' + o.name + '/reference_uv'] = uv.astype(np.float32)
        object_meta[o.name] = {'vertices': len(m.vertices), 'polygons': len(m.polygons), 'loops': len(m.loops), 'plate_param': has_plate}
    if emission is not None:
        del emission
    items = []
    common = {}
    for r in regions:
        if r['finish'] is not None:
            k = (r['role'], r['finish'], r['target'])
            item = common.setdefault(k, {'regions': [], 'role': r['role'], 'width': 0, 'height': 0, 'forced': None, 'finish': True})
            # Uniform finish templates are sized by physical area, not the worst AABB.
            side = math.sqrt(max(r['world_area'], 1e-8)) * 512
            item['width'] = max(item['width'], side)
            item['height'] = max(item['height'], side)
            item['regions'].append(r['id'])
            r['shared_finish_bake'] = 'flat_normal_constant_ao'
            # Single atlas: assemblies no longer reserve exclusive pages.
            item['forced'] = None
        else:
            w, h = r['width_px'], r['height_px']
            if max(w, h) > SIZE - 2 * P:
                side = math.sqrt(max(r['world_area'], 1e-8)) * 512
                w = h = side
                r['width_px'] = w
                r['height_px'] = h
                r['method'] = r.get('method', '') + '+page-square'
            items.append({'regions': [r['id']], 'role': r['role'], 'width': w, 'height': h, 'forced': None, 'finish': False})
    items.extend(common.values())
    # Merge same-role finish templates (keep max side) until padded area fits one page.
    def padded_area(items_):
        return sum((math.ceil(i['width']) + P) * (math.ceil(i['height']) + P) for i in items_)

    finish_items = [i for i in items if i.get('finish')]
    unique_items = [i for i in items if not i.get('finish')]
    merges = 0
    while padded_area(finish_items + unique_items) > FINISH_PACK_BUDGET and len(finish_items) > 4:
        # Merge the two smallest same-role finish templates.
        by_role = {}
        for i, it in enumerate(finish_items):
            by_role.setdefault(it['role'], []).append((i, it))
        best = None
        for role, rows in by_role.items():
            if len(rows) < 2:
                continue
            rows = sorted(rows, key=lambda r: r[1]['width'] * r[1]['height'])
            a, b = rows[0], rows[1]
            gain = (math.ceil(a[1]['width']) + P) * (math.ceil(a[1]['height']) + P)
            cand = (gain, role, a[0], b[0])
            if best is None or cand[0] > best[0]:
                best = cand
        if best is None:
            break
        _, role, ia, ib = best
        if ia > ib:
            ia, ib = ib, ia
        keep, drop = finish_items[ia], finish_items[ib]
        keep['width'] = max(keep['width'], drop['width'])
        keep['height'] = max(keep['height'], drop['height'])
        keep['regions'] = list(keep['regions']) + list(drop['regions'])
        finish_items.pop(ib)
        merges += 1
    items = unique_items + finish_items
    print(state, 'finish_merges', merges, 'finish_templates', len(finish_items), 'padded_pages', round(padded_area(items) / (SIZE * SIZE), 4), flush=True)
    # True 512 only — no force-fit downscale (parent rejected force-fit promote).
    base_items = [{**i, 'width': float(i['width']), 'height': float(i['height'])} for i in items]
    scale = 1.0
    items = base_items

    def reshape_finish_rects(items_):
        """Keep finish texel area (= a_max·512²) but avoid square charts that starve the leftover strip.

        Husked Dark a_max≈29.6 m² → 2784² square leaves only 1312 px free; Trim needs 1314.
        Reshape to a full-width strip (area-preserving) so peers still fit at true 512.
        """
        finish = [i for i in items_ if i.get('finish')]
        if len(finish) < 2:
            return
        for it in finish:
            it['_need'] = max(float(it['width']) * float(it['height']), 1.0)
        ranked = sorted(finish, key=lambda i: -i['_need'])
        for i, it in enumerate(ranked):
            need = it['_need']
            side = math.sqrt(need)
            peers = ranked[i + 1:]
            max_peer = max((math.sqrt(p['_need']) for p in peers), default=0.0)
            leftover = SIZE - math.ceil(side) - P
            # Reshape when leftover cannot hold the next-largest peer, or the square dominates the page.
            if leftover >= math.ceil(max_peer) + P and side <= SIZE * 0.55:
                continue
            w = SIZE - P
            h = int(math.ceil(need / w))
            if h + P > SIZE:
                h = SIZE - P
                w = int(math.ceil(need / h))
            if w + P <= SIZE and h + P <= SIZE and w * h + 1e-6 >= need:
                it['width'] = float(w)
                it['height'] = float(h)
                it['reshaped_strip'] = True
        for it in finish:
            it.pop('_need', None)

    # Keep merging same-role finish leftovers until maxrects or shelf packs cleanly.
    for _merge_round in range(24):
        reshape_finish_rects(items)
        order = sorted(items, key=lambda i: (-max(float(i['width']), float(i['height'])), -float(i['width']) * float(i['height'])))
        bins = [Bin()]
        failed, placed = [], []
        # Explicitly corner-place the largest chart first.
        if order:
            first = order[0]
            fw = math.ceil(float(first['width'])) + P
            fh = math.ceil(float(first['height'])) + P
            if fw <= SIZE and fh <= SIZE:
                rect = (0, 0, fw, fh, False)
                bins[0].put(rect)
                placed.append((first, rect))
                order = order[1:]
            else:
                failed.append({'role': first['role'], 'regions': first['regions'], 'w': fw, 'h': fh, 'forced': None})
                order = order[1:]
        for item in order:
            w = math.ceil(float(item['width'])) + P
            h = math.ceil(float(item['height'])) + P
            if w > SIZE or h > SIZE:
                failed.append({'role': item['role'], 'regions': item['regions'], 'w': w, 'h': h, 'forced': None})
                continue
            score = bins[0].score(w, h)
            if not score:
                failed.append({'role': item['role'], 'regions': item['regions'], 'w': w, 'h': h, 'forced': None})
                continue
            rect = score[1]
            bins[0].put(rect)
            placed.append((item, rect))
        if not failed:
            break
        # Shelf fallback
        shelf_failed, shelf_placed = [], []
        x = y = row_h = 0
        for item in sorted(items, key=lambda i: (-max(float(i['width']), float(i['height'])), -float(i['width']) * float(i['height']))):
            w = math.ceil(float(item['width'])) + P
            h = math.ceil(float(item['height'])) + P
            if w > SIZE or h > SIZE:
                shelf_failed.append({'role': item['role'], 'regions': item['regions'], 'w': w, 'h': h, 'forced': None})
                continue
            if x + w > SIZE:
                x = 0
                y += row_h
                row_h = 0
            if y + h > SIZE:
                shelf_failed.append({'role': item['role'], 'regions': item['regions'], 'w': w, 'h': h, 'forced': None})
                continue
            shelf_placed.append((item, (x, y, w, h, False)))
            x += w
            row_h = max(row_h, h)
        if not shelf_failed:
            failed, placed = shelf_failed, shelf_placed
            print(state, 'shelf_packer_clean', flush=True)
            break
        if len(shelf_failed) < len(failed):
            failed, placed = shelf_failed, shelf_placed
        # Merge one failed finish into smallest same-role peer and retry.
        f = failed[0]
        src = next((i for i in items if tuple(i['regions']) == tuple(f['regions'])), None)
        peers = [i for i in items if src is not None and i is not src and i.get('finish') and i['role'] == src['role']]
        if src is None or not peers:
            break
        peer = min(peers, key=lambda i: float(i['width']) * float(i['height']))
        peer['width'] = max(float(peer['width']), float(src['width']))
        peer['height'] = max(float(peer['height']), float(src['height']))
        peer['regions'] = list(peer['regions']) + list(src['regions'])
        items = [i for i in items if i is not src]
        print(state, 'merge_retry', src['role'], 'templates_left', len(items), flush=True)
    for item, rect in placed:
        x, y, w, h, swap = rect
        for ri in item['regions']:
            r = regions[ri]
            q = archive[r['key'] + '/local'].astype(np.float64)
            if item.get('finish'):
                q = q - q.min(0)
                ext = np.maximum(q.max(0), 1e-12)
                q = q / ext * np.array([item['width'], item['height']], np.float64)
            if swap:
                q = q[:, ::-1]
            q += (x + P / 2, y + P / 2)
            archive[r['key'] + '/uv'] = (q / 4096).astype(np.float32)
            r['page'] = 0
            r['packing'] = {'x': x, 'y': y, 'w': w, 'h': h, 'swap': swap}
            r['force_fit_scale'] = scale
            r['achieved_target_px_per_m'] = 512 * scale
    stats = {
        'objects': object_meta,
        'region_count': len(regions),
        'item_count': len(items),
        'physical_surface_m2': sum(r['world_area'] for r in regions),
        'finish_surface_m2': sum(r['world_area'] for r in regions if r['finish'] is not None),
        'unique_surface_m2': sum(r['world_area'] for r in regions if r['finish'] is None),
        'visible_surface_m2': sum(r['world_area'] for r in regions if r['visible']),
        'rectangle_pixels_with_padding': sum((math.ceil(i['width']) + P) * (math.ceil(i['height']) + P) for i in items),
        'force_fit_scale': scale,
        'achieved_target_px_per_m': 512 * scale,
        'near_palette_snap_faces': snapped,
        'near_palette_snap_area_m2': snapped_area,
        'palette_sizes': {role: len(palettes[role]) for role in ROLES},
        'failed': failed,
        'regions': regions,
    }
    manifest['states'][state] = stats
    all_ok &= not failed
    with (OUT / (os.environ['LARK_ATTEMPT_ID'] + '-' + state + '-layout.json')).open('x') as f:
        json.dump(stats, f, indent=2)
    print(state, json.dumps({k: v for k, v in stats.items() if k not in ['regions', 'objects', 'failed']}), 'FAILED', len(failed), [{k: v for k, v in f.items() if k != 'regions'} for f in failed[:4]], flush=True)

name = os.environ['LARK_ATTEMPT_ID']
manifest['layout_fits'] = all_ok
with (OUT / (name + '-layout.json')).open('x') as f:
    json.dump(manifest, f, indent=2)
if all_ok:
    np.savez_compressed(OUT / (name + '-layout.npz'), **archive)
assert all_ok, 'Shrink-512 one-atlas layout did not fit at true 512; source untouched, no bake started.'
