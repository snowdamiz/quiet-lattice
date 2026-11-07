"""UV island packing across several objects into one atlas (Blender's pack op only packs the active object's islands
in background mode).  Islands are UV-connected face sets; each is scaled to a common texel density (times a per-object
boost), rotated to its principal axis, and shelf-packed into the unit square with a margin; the global scale is the
largest that fits (binary search)."""
import math

import bmesh
import numpy as np


def islands(bm, uvl, eps=1e-6):
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    bm.faces.ensure_lookup_table()
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2 or e.seam:
            continue
        f0, f1 = lf
        def uvs(f):
            d = {}
            for l in f.loops:
                d[l.vert.index] = l[uvl].uv.copy()
            return d
        a, b = uvs(f0), uvs(f1)
        ok = all((a[v.index] - b[v.index]).length < eps for v in e.verts)
        if ok:
            ra, rb = find(f0.index), find(f1.index)
            if ra != rb:
                parent[ra] = rb
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def pack(objs, boosts=None, margin=0.004, rotate=True):
    """Packs the UVs of every mesh object in `objs` together.  boosts: per object texel-density multiplier."""
    boosts = boosts or [1.0] * len(objs)
    data = []  # (obj index, bm, uvl, faces, points (n,2), area3d, areauv)
    bms = []
    for oi, o in enumerate(objs):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        uvl = bm.loops.layers.uv.active
        bms.append((o, bm, uvl))
        for faces in islands(bm, uvl):
            pts = np.array([[l[uvl].uv.x, l[uvl].uv.y] for f in faces for l in f.loops])
            a3 = sum(f.calc_area() for f in faces)
            auv = 0.0
            for f in faces:
                p = np.array([[l[uvl].uv.x, l[uvl].uv.y] for l in f.loops])
                x, y = p[:, 0], p[:, 1]
                auv += 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
            data.append([oi, faces, pts, a3, max(auv, 1e-12)])
    # per-island transform: scale to density, rotate to principal axis
    items = []
    for oi, faces, pts, a3, auv in data:
        k = math.sqrt(a3 / auv) * boosts[oi]
        c = pts.mean(0)
        q = (pts - c) * k
        ang = 0.0
        if rotate and len(q) > 2:
            cov = np.cov(q.T)
            w, v = np.linalg.eigh(cov)
            major = v[:, np.argmax(w)]
            ang = -math.atan2(major[1], major[0])
            R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
            q = q @ R.T
        lo, hi = q.min(0), q.max(0)
        items.append(dict(oi=oi, faces=faces, c=c, k=k, ang=ang, lo=lo, size=hi - lo))
    order = sorted(range(len(items)), key=lambda i: -items[i]['size'][1])

    def shelf(scale):
        x = y = shelf_h = 0.0
        pos = {}
        for i in order:
            w, h = items[i]['size'] * scale
            if w + 2 * margin > 1.0:
                return None
            if x + w + margin * 2 > 1.0:
                y += shelf_h + margin
                x = 0.0
                shelf_h = 0.0
            pos[i] = (x + margin, y + margin)
            x += w + margin
            shelf_h = max(shelf_h, h + margin)
        if y + shelf_h + margin > 1.0:
            return None
        return pos

    lo_s, hi_s = 1e-4, 100.0
    best = None
    for _ in range(40):
        mid = math.sqrt(lo_s * hi_s)
        p = shelf(mid)
        if p is None:
            hi_s = mid
        else:
            lo_s, best = mid, (mid, p)
    if best is None:
        # too many islands for this margin: try a finer one
        for o, bm, uvl in bms:
            bm.free()
        if margin < 1e-4:
            raise RuntimeError(f'pack: {len(items)} islands do not fit')
        return pack(objs, boosts, margin * 0.5, rotate)
    scale, pos = best
    for i, it in enumerate(items):
        R = np.array([[math.cos(it['ang']), -math.sin(it['ang'])], [math.sin(it['ang']), math.cos(it['ang'])]])
        o, bm, uvl = bms[it['oi']]
        px, py = pos[i]
        for f in it['faces']:
            for l in f.loops:
                p = (np.array([l[uvl].uv.x, l[uvl].uv.y]) - it['c']) * it['k']
                p = R @ p
                p = (p - it['lo']) * scale + np.array([px, py])
                l[uvl].uv = (float(p[0]), float(p[1]))
    for o, bm, uvl in bms:
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    return scale
