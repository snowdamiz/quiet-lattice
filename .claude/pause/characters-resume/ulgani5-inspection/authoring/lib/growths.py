"""Grown parts: Ixari living crystal (irregular hexagonal shafts with stepped growth terraces and faceted tips, set in
a slate socket collar) and Ulgani spore-fronds (curling stalks with pinnate leaflets and luminous spore nodules).
Attributes: 'glow' (crystal growth lines / spore nodules), 'gpart' (0 shaft, 1 collar, 2 leaflet, 3 nodule), 'gv'
(0 root .. 1 tip), 'flare' (mood display displacement)."""
import math

import bmesh
import bpy
import numpy as np

from .sdf import nrm


def _frame(d, hint=(0.0, 0.0, 1.0)):
    d = nrm(d)
    h = np.asarray(hint, float)
    if abs(np.dot(h, d)) > 0.95:
        h = np.array([1.0, 0, 0])
    u = nrm(np.cross(h, d))
    v = np.cross(d, u)
    return u, v, d


# The hand-made kit of shafts: (section sides, flattening, terraces, tip kind, tip length, radius and length factors).
# Neighbouring shafts of a cluster take different kinds.
KIT = {
    'hex': (6, 0.86, 3, 'point', 0.26, 1.0, 1.0),
    'rhomb': (4, 0.62, 2, 'point', 0.3, 1.05, 0.95),
    'broken': (6, 0.8, 2, 'broken', 0.0, 1.05, 0.8),
    'chisel': (6, 0.62, 3, 'chisel', 0.2, 1.0, 1.0),
    'needle': (4, 0.7, 4, 'point', 0.38, 0.72, 1.25),
    'stub': (6, 0.9, 2, 'point', 0.16, 1.22, 0.6),
    'sceptre': (6, 0.84, 3, 'point', 0.24, 0.92, 1.05),
}
KINDS = list(KIT)


def _rot(v, axis, ang):
    axis = nrm(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


def crystal(bm, lay, base, d, length, radius, rng, sides=6, terraces=3, tip=0.32, sink=0.006, lean_hint=None,
            collar=True, flat=0.75, kind=None):
    """Adds one crystal shaft to bmesh `bm`: a kit shaft (KIT) with a hexagonal or rhombic section, growth terraces
    that step in as real ledges, a pointed, chisel or broken tip, leaning 5-20 degrees off `d`, set in a raised slate
    socket.  Attributes: glow 1 on the terrace ledges, core 1 down the middle of every facet (the light inside the
    crystal seen through it), gv 0 root .. 1 tip, gpart 0 shaft / 1 socket."""
    if kind is not None:
        sides, flat, terraces, tipk, tip, rf, lf = KIT[kind]
        radius *= rf
        length *= lf
    else:
        tipk = 'point'
    length *= rng.uniform(0.8, 1.2)
    u0, v0, d0 = _frame(d, lean_hint if lean_hint is not None else (0, 0, 1))
    phi = rng.uniform(0, 2 * math.pi)
    d = nrm(_rot(d0, u0 * math.cos(phi) + v0 * math.sin(phi), math.radians(rng.uniform(5.0, 20.0))))
    u, v, d = _frame(d, lean_hint if lean_hint is not None else (0, 0, 1))
    rad = radius * (1 + rng.uniform(-0.12, 0.12, sides))
    if sides == 4:
        ang = np.radians([0.0, 64.0, 180.0, 244.0]) + rng.uniform(-0.06, 0.06, 4)
        rad = radius * np.array([1.0, flat, 1.0, flat]) * (1 + rng.uniform(-0.08, 0.08, 4))
    else:
        rad *= np.array([1.0, flat] * (sides // 2) + [1.0] * (sides % 2))
        ang = np.linspace(0, 2 * math.pi, sides, endpoint=False) + rng.uniform(-0.1, 0.1, sides)
    corners = [u * math.cos(a) * r + v * math.sin(a) * r for a, r in zip(ang, rad)]
    sec = []
    for k in range(sides):
        sec.append((corners[k], 0.0))
        sec.append(((corners[k] + corners[(k + 1) % sides]) / 2, 1.0))
    n = len(sec)
    body = length * (1 - tip)
    cuts = np.sort(rng.uniform(0.18, 0.9, terraces)) * body
    # (height, scale, glow) per ring; a terrace is a ledge: the section steps in at one height
    prof = [(-sink, 1.0, 0.0), (0.0, 1.0, 0.0)]
    sc = 1.0
    for ci, c in enumerate(cuts):
        step = rng.uniform(0.8, 0.88) if not (kind == 'sceptre' and ci == len(cuts) - 1) else rng.uniform(1.08, 1.14)
        prof += [(c, sc, 1.0), (c + 0.0006, sc * step, 1.0)]
        sc *= step
    prof.append((body, sc, 0.0))
    rings = []
    for h, scl, gl in prof:
        ring = []
        for p, core in sec:
            vv = bm.verts.new(tuple(base + d * h + p * scl))
            vv[lay['gv']] = max(0.0, h / length)
            vv[lay['glow']] = gl
            vv[lay['core']] = core
            vv[lay['gpart']] = 0.0
            ring.append(vv)
        rings.append(ring)
    faces = []
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append(bm.faces.new((a[k], a[k2], b[k2], b[k])))
    top = rings[-1]
    tipv = None
    if tipk == 'point':
        tipv = bm.verts.new(tuple(base + d * length + u * radius * rng.uniform(-0.2, 0.2) + v * radius * rng.uniform(-0.2, 0.2)))
        for k in range(n):
            faces.append(bm.faces.new((top[k], top[(k + 1) % n], tipv)))
    elif tipk == 'chisel':
        # two long faces meet in a ridge across the shaft
        e0 = bm.verts.new(tuple(base + d * length + corners[0] * sc * 0.55))
        e1 = bm.verts.new(tuple(base + d * length + corners[sides // 2] * sc * 0.55))
        for vv in (e0, e1):
            vv[lay['gv']] = 1.0
        near = [e0 if np.linalg.norm(np.array(t.co) - np.array(e0.co)) <= np.linalg.norm(np.array(t.co) - np.array(e1.co)) else e1
                for t in top]
        for k in range(n):
            k2 = (k + 1) % n
            if near[k] is near[k2]:
                faces.append(bm.faces.new((top[k], top[k2], near[k])))
            else:
                faces.append(bm.faces.new((top[k], top[k2], near[k2], near[k])))
        tipv = e0
    else:
        # broken: a slanted fracture with a chip out of one edge
        sl = rng.uniform(0.18, 0.32)
        cap = []
        for k, (p, core) in enumerate(sec):
            h = body + (p @ u) / max(radius, 1e-9) * sl * radius * 2.2
            if k in (2, 3):
                h -= radius * 0.35
            vv = bm.verts.new(tuple(base + d * h + p * sc * 0.98))
            vv[lay['gv']] = 1.0
            vv[lay['glow']] = 0.6
            cap.append(vv)
        for k in range(n):
            k2 = (k + 1) % n
            faces.append(bm.faces.new((top[k], top[k2], cap[k2], cap[k])))
        faces.append(bm.faces.new(cap))
        tipv = cap[0]
    if tipv is not None:
        tipv[lay['gv']] = 1.0
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    for f in faces:
        f.smooth = False
    if collar:
        # the slate socket: a raised lip of stone the shaft grows out of, wider than the shaft and stepped
        cr = []
        for hh, rr in ((-0.004, 1.8), (0.003, 1.66), (0.0078, 1.36), (0.0092, 1.12), (0.0065, 1.04)):
            cr.append([bm.verts.new(tuple(base + d * hh + p * rr)) for p, _ in sec])
        for a, b in zip(cr[:-1], cr[1:]):
            for k in range(n):
                k2 = (k + 1) % n
                f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
                f.smooth = True
        for ring in cr:
            for vv in ring:
                vv[lay['gpart']] = 1.0
                vv[lay['gv']] = 0.0
                vv[lay['glow']] = 0.0
                vv[lay['core']] = 0.0
    return tipv


def crystal_mesh(name, specs, seed=1):
    """specs: list of dict(base, dir, length, radius[, terraces, tip, lean, kind]).  Shafts without a kind take the
    kit's kinds in turn, so no two neighbours match."""
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    lay = {k: bm.verts.layers.float.new(k) for k in ('glow', 'gpart', 'gv', 'core')}
    for i, sp in enumerate(specs):
        kind = sp.get('kind', KINDS[(i * 3 + seed) % len(KINDS)])
        crystal(bm, lay, np.asarray(sp['base'], float), np.asarray(sp['dir'], float), sp['length'], sp['radius'], rng,
                sides=sp.get('sides', 6), terraces=sp.get('terraces', 3), tip=sp.get('tip', 0.3), sink=sp.get('sink', 0.006),
                lean_hint=sp.get('lean'), collar=sp.get('collar', True), flat=sp.get('flat', 0.75), kind=kind)
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    _uv_by_projection(me)
    return me


def _uv_by_projection(me):
    component_uvs(me)


def component_uvs(me):
    """One UV island per connected piece (a stalk, a leaflet, a pod, a cap, a crystal shaft): elongated pieces are
    mapped round their long axis (u round, v along; the wrap is cut so the piece stays one island), compact ones are
    projected on their two widest axes.  Scaled to true size (the atlas packer evens the density)."""
    nv = len(me.vertices)
    co = np.empty(nv * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    parent = np.arange(nv)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    ev = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', ev)
    for a, b in ev.reshape(-1, 2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    comp = np.array([find(i) for i in range(nv)])
    uvl = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    uv = np.zeros((len(me.loops), 2))
    frames = {}
    for c in np.unique(comp):
        idx = np.nonzero(comp == c)[0]
        P = co[idx]
        m = P.mean(0)
        if len(idx) < 3:
            frames[c] = ('plane', m, np.eye(3), 1.0)
            continue
        w, V = np.linalg.eigh(np.cov((P - m).T) + np.eye(3) * 1e-12)
        V = V[:, ::-1]
        w = w[::-1]
        Q = (P - m) @ V
        rad = float(np.sqrt(Q[:, 1] ** 2 + Q[:, 2] ** 2).mean()) + 1e-6
        frames[c] = ('cyl' if w[0] > 5 * max(w[1], 1e-12) else 'plane', m, V, rad)
    for f in me.polygons:
        li = list(f.loop_indices)
        vi = lv[li]
        kind, m, V, rad = frames[comp[vi[0]]]
        Q = (co[vi] - m) @ V
        if kind == 'cyl':
            # one radius per piece, so neighbouring faces agree on the shared vertices' u (one island per piece)
            ang = np.arctan2(Q[:, 2], Q[:, 1])
            if ang.max() - ang.min() > math.pi:
                ang = np.where(ang < 0, ang + 2 * math.pi, ang)
            uv[li] = np.stack([ang * rad, Q[:, 0]], 1)
        else:
            uv[li] = Q[:, :2]
    uvl.data.foreach_set('uv', uv.ravel())


# ---------------------------------------------------------------------------------------------- fronds
def _ovoid(bm, lay, c, axis, r_long, r_short, gpart, glow, gv, segs=8, rings=6):
    """A smooth ovoid (spore pod or nodule) centred at c, long axis `axis`."""
    u, v, d = _frame(axis)
    verts = []
    top = bm.verts.new(tuple(c + d * r_long))
    bot = bm.verts.new(tuple(c - d * r_long))
    for i in range(1, rings):
        th = math.pi * i / rings
        row = []
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            p = c + d * math.cos(th) * r_long + (u * math.cos(ph) + v * math.sin(ph)) * math.sin(th) * r_short
            row.append(bm.verts.new(tuple(p)))
        verts.append(row)
    for vv in [top, bot] + [x for row in verts for x in row]:
        vv[lay['gpart']] = gpart
        vv[lay['glow']] = glow
        vv[lay['gv']] = gv
    for j in range(segs):
        j2 = (j + 1) % segs
        bm.faces.new((top, verts[0][j], verts[0][j2]))
        bm.faces.new((bot, verts[-1][j2], verts[-1][j]))
    for i in range(len(verts) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j2], verts[i][j2]))


def _spore_cap(bm, lay, c, axis, R, gv, ribs=10):
    """A small mushroom cap at a frond tip: a domed top and radial gill lamellae underneath (they carry the glow)."""
    u, v, d = _frame(axis)
    nseg, nrow = 16, 4
    rows = []
    for i in range(nrow + 1):
        t = i / nrow                      # 0 at the crown, 1 at the rim
        el = (1 - t) * math.pi / 2 * 0.95
        rr = R * math.cos(el) * (1.0 + 0.08 * t)
        hh = R * 0.62 * math.sin(el) + (-0.12 * R * t * t)
        row = []
        for j in range(nseg):
            ph = 2 * math.pi * j / nseg
            wav = 1.0 + 0.06 * math.sin(ph * 5 + 0.7) * t
            p = c + d * hh + (u * math.cos(ph) + v * math.sin(ph)) * rr * wav
            vv = bm.verts.new(tuple(p))
            vv[lay['gpart']] = 4.0
            vv[lay['glow']] = 0.0
            vv[lay['gv']] = gv
            row.append(vv)
        rows.append(row)
    apex = bm.verts.new(tuple(c + d * R * 0.66))
    apex[lay['gpart']] = 4.0
    apex[lay['glow']] = 0.0
    apex[lay['gv']] = gv
    for j in range(nseg):
        bm.faces.new((apex, rows[0][j], rows[0][(j + 1) % nseg]))
    for i in range(nrow):
        for j in range(nseg):
            j2 = (j + 1) % nseg
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2]))
    # underside: a shallow cone back to the stalk, its surface the gills (glowing spore surface)
    under = []
    for j in range(nseg):
        ph = 2 * math.pi * j / nseg
        p = c - d * R * 0.1 + (u * math.cos(ph) + v * math.sin(ph)) * R * 0.35
        vv = bm.verts.new(tuple(p))
        vv[lay['gpart']] = 4.0
        vv[lay['glow']] = 1.0
        vv[lay['gv']] = gv
        under.append(vv)
    for j in range(nseg):
        j2 = (j + 1) % nseg
        bm.faces.new((rows[-1][j2], under[j2], under[j], rows[-1][j]))
    # gill lamellae: thin radial fins from the inner ring to the rim
    for k in range(ribs):
        ph = 2 * math.pi * (k + 0.5) / ribs
        rd = u * math.cos(ph) + v * math.sin(ph)
        tg = np.cross(d, rd)
        q = []
        for f, h in ((0.38, -0.08), (0.95, -0.1)):
            for dz in (0.0, -0.18):
                q.append(c + d * R * (h + dz * (1.0 - f)) + rd * R * f)
        vs = [bm.verts.new(tuple(x + tg * R * 0.02)) for x in q] + [bm.verts.new(tuple(x - tg * R * 0.02)) for x in q]
        for vv in vs:
            vv[lay['gpart']] = 4.0
            vv[lay['glow']] = 1.0
            vv[lay['gv']] = gv
        a0, a1, b0, b1, a0b, a1b, b0b, b1b = vs
        bm.faces.new((a0, b0, b1, a1))
        bm.faces.new((a0b, a1b, b1b, b0b))


def _plate(bm, lay, grid, normals, thick, gv, rng, gill_side=-1, closed=False, glow_p=0.22):
    """A thin two-skin plate over a grid of points (rows run from the root to the rim) with per-point normals, stitched
    along its border, thinning toward the rim.  The gill side (-1 the bottom skin, +1 the top) carries radial gill
    ribs and scattered spore-light points toward the rim (LIB_CapFlesh)."""
    na, nr = len(grid), len(grid[0])
    top = [[None] * nr for _ in range(na)]
    bot = [[None] * nr for _ in range(na)]
    for i in range(na):
        for j in range(nr):
            f = j / (nr - 1)
            th = thick * (1 - 0.6 * f) / 2
            n = normals[i][j]
            rib = thick * 0.9 * f * (1.0 if i % 2 == 0 else 0.0)
            pt = grid[i][j] + n * (th + (rib if gill_side > 0 else 0.0))
            pb = grid[i][j] - n * (th + (rib if gill_side < 0 else 0.0))
            vt, vb = bm.verts.new(tuple(pt)), bm.verts.new(tuple(pb))
            for vv in (vt, vb):
                vv[lay['gpart']] = 4.0
                vv[lay['gv']] = gv
                vv[lay['glow']] = 0.0
            gs = vb if gill_side < 0 else vt
            gs[lay['gill']] = 1.0
            if f > 0.45 and rng.uniform() < glow_p:
                gs[lay['glow']] = 1.0
            top[i][j], bot[i][j] = vt, vb
    ia = range(na) if closed else range(na - 1)
    for i in ia:
        i2 = (i + 1) % na
        for j in range(nr - 1):
            bm.faces.new((top[i][j], top[i2][j], top[i2][j + 1], top[i][j + 1]))
            bm.faces.new((bot[i][j + 1], bot[i2][j + 1], bot[i2][j], bot[i][j]))
        for j in (0, nr - 1):
            q = (top[i][j], bot[i][j], bot[i2][j], top[i2][j])
            bm.faces.new(q if j == nr - 1 else q[::-1])
    if not closed:
        for i in (0, na - 1):
            for j in range(nr - 1):
                q = (top[i][j], top[i][j + 1], bot[i][j + 1], bot[i][j])
                bm.faces.new(q if i == 0 else q[::-1])


def _tube(bm, lay, pts, r0, r1, gv0, gv1, sides=5):
    """A thin tapering tube along `pts` (a filament), closed at the tip."""
    rings = []
    n = len(pts)
    for i, q in enumerate(pts):
        t = i / (n - 1)
        tg = nrm(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        u, v, _ = _frame(tg)
        r = r0 + (r1 - r0) * t
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            vv = bm.verts.new(tuple(q + (u * math.cos(a) + v * math.sin(a)) * r))
            vv[lay['gpart']] = 0.0
            vv[lay['gv']] = gv0 + (gv1 - gv0) * t
            vv[lay['glow']] = 0.0
            ring.append(vv)
        rings.append(ring)
    for a_, b_ in zip(rings[:-1], rings[1:]):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((a_[k], a_[k2], b_[k2], b_[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def _form(bm, lay, form, pts, tans, normal, w, length, stalk_r, rng, gv0, gv1):
    """The head-specific growth on a frond's stalk (heads.UL_VARIANTS 'form'): filament tufts, a gill-lined fan, a
    cupped tip, or stacked gill shelves."""
    seg = len(pts) - 1
    gv = lambda t: gv0 + (gv1 - gv0) * t
    if form == 'filament':
        for k in range(int(rng.integers(6, 9))):
            t0 = 0.5 + 0.48 * k / 8
            i = min(int(t0 * seg), seg)
            az = rng.uniform(0, 2 * math.pi)
            out = nrm(normal * math.cos(az) + nrm(np.cross(tans[i], normal)) * math.sin(az))
            d0 = nrm(tans[i] + out * rng.uniform(0.5, 1.1))
            L = length * rng.uniform(0.32, 0.55)
            cu = rng.uniform(0.6, 1.4)
            fp, q = [], pts[i].copy()
            for j in range(9):
                f = j / 8
                dirv = nrm(d0 * math.cos(cu * f * f) + out * math.sin(cu * f * f))
                fp.append(q.copy())
                q = q + dirv * L / 8
            _tube(bm, lay, np.array(fp), stalk_r * 0.32, stalk_r * 0.12, gv(t0), gv(1.0))
            _ovoid(bm, lay, fp[-1] + nrm(fp[-1] - fp[-2]) * stalk_r * 0.3, nrm(fp[-1] - fp[-2]), stalk_r * 0.62, stalk_r * 0.42,
                   3.0, 1.0, gv(1.0), segs=6, rings=4)
    elif form == 'gillfan':
        R = length * 0.34
        c, tg = pts[-1], tans[-1]
        side = nrm(np.cross(normal, tg))
        grid, nrms = [], []
        for i, a in enumerate(np.radians(np.linspace(-68, 68, 13))):
            row, nr_ = [], []
            for j, f in enumerate(np.linspace(0.08, 1.0, 6)):
                r = R * f * (1.0 + 0.07 * math.sin(i * 1.7) * f)
                p = c + (tg * math.cos(a) + side * math.sin(a)) * r + normal * (0.14 * R * f * f)
                row.append(p)
                nr_.append(nrm(normal - (tg * math.cos(a) + side * math.sin(a)) * 0.28 * f))
            grid.append(row)
            nrms.append(nr_)
        _plate(bm, lay, grid, nrms, stalk_r * 0.5, gv(1.0), rng, gill_side=-1)
    elif form == 'cup':
        R = length * 0.17
        c, tg = pts[-1], tans[-1]
        u, v, _ = _frame(tg)
        grid, nrms = [], []
        for i, a in enumerate(np.linspace(0, 2 * math.pi, 16, endpoint=False)):
            rd = u * math.cos(a) + v * math.sin(a)
            row, nr_ = [], []
            for j, f in enumerate(np.linspace(0.12, 1.0, 6)):
                lip = 0.18 * max(0.0, (f - 0.8) / 0.2)
                p = c + rd * R * f * (1 + 0.05 * math.sin(a * 5)) + tg * R * (0.55 * f * f - lip)
                row.append(p)
                nr_.append(nrm(tg - rd * 1.1 * f))
            grid.append(row)
            nrms.append(nr_)
        _plate(bm, lay, grid, nrms, stalk_r * 0.55, gv(1.0), rng, gill_side=1, closed=True, glow_p=0.3)
    elif form == 'lamella':
        for k, t in enumerate((0.36, 0.56, 0.74, 0.9)):
            i = min(int(t * seg), seg)
            q, tg = pts[i], tans[i]
            R = length * (0.2 - 0.03 * k) * rng.uniform(0.9, 1.1)
            wd = nrm(w - tg * (w @ tg))
            bd = nrm(np.cross(tg, wd))
            grid, nrms = [], []
            for a in np.radians(np.linspace(-95, 95, 11)):
                row, nr_ = [], []
                for f in np.linspace(0.0, 1.0, 5):
                    r = stalk_r * 0.9 + (R - stalk_r * 0.9) * f
                    p = q + (wd * math.cos(a) + bd * math.sin(a)) * r - tg * 0.22 * r * f
                    row.append(p)
                    nr_.append(tg)
                grid.append(row)
                nrms.append(nr_)
            _plate(bm, lay, grid, nrms, stalk_r * 0.45, gv(t), rng, gill_side=-1)


LEAF = {
    'willow': lambda f: math.sin(math.pi * min(0.97, 0.1 + 0.9 * f)) * (1 - 0.2 * f),
    'obovate': lambda f: 2.1 * f ** 0.8 * max(1 - f, 0.0) ** 0.35,
    'strap': lambda f: 0.7 * min(1.0, 4 * f) * min(1.0, 3.5 * (1 - f) + 0.08),
    'fan': lambda f: (0.25 + 0.95 * f) * min(1.0, 5 * (1 - f) + 0.1),
    'lobed': lambda f: math.sin(math.pi * min(0.97, 0.1 + 0.9 * f)) * (0.72 + 0.28 * math.cos(f * 6 * math.pi)),
}


def frond(bm, lay, base, d, side_dir, length, rng, curl=1.4, leaflets=7, leaf_len=0.35, stalk_r=0.0032, nodules=True,
          rise_axis=None, seg=18, tip='pods', leaf_w=0.32, frill=0.18, fork=0, gv0=0.0, gv1=1.0, shape='willow', crowd=1.0,
          nod_p=0.55, form='pinnate'):
    """A spore-frond: a stalk that flares into the scalp and tapers to the tip, swelling where it branches, curling in
    the plane (d, side_dir); alternating gill-lamella leaflets with frilled edges; a varied tip (a spore cap with
    glowing gills underneath, or a cluster of ovoid spore pods) and pods of varied size on some leaflet tips."""
    d = nrm(d)
    w = nrm(side_dir - np.dot(side_dir, d) * d)
    pts, tans = [], []
    p = np.array(base, float)
    step = length / seg
    wob = rng.uniform(-0.08, 0.08)
    for i in range(seg + 1):
        t = i / seg
        a = curl * t ** 2.0 + wob * math.sin(t * 6.0)
        dirv = d * math.cos(a) + w * math.sin(a)
        pts.append(p.copy())
        tans.append(dirv)
        p = p + dirv * step
    pts = np.array(pts)
    tans = np.array(tans)
    normal = nrm(np.cross(d, w))
    if form != 'pinnate':
        leaflets = min(leaflets, 4)
        leaf_len *= 0.55
    leaf_t = [0.2 + (0.72 if form == 'pinnate' else 0.3) * (j / max(leaflets - 1, 1)) ** (1.0 / crowd) for j in range(leaflets)]
    wfn = LEAF[shape]
    nsides = 8
    rings = []
    for i, (q, tg) in enumerate(zip(pts, tans)):
        t = i / seg
        r = stalk_r * (1.0 - 0.68 * t)
        r *= 1.0 + 1.1 * max(0.0, 1.0 - t / 0.12) ** 2         # a fillet where it grows out of the scalp
        r *= 1.0 + 0.16 * sum(math.exp(-((t - lt) / 0.03) ** 2) for lt in leaf_t)   # nodes where leaflets branch
        q = q - d * (stalk_r * 1.5 if i == 0 else 0.0)        # the root sinks under the skin
        bnorm = nrm(np.cross(tg, normal))
        ring = []
        for k in range(nsides):
            a = 2 * math.pi * k / nsides
            vv = bm.verts.new(tuple(q + (normal * math.cos(a) + bnorm * math.sin(a)) * r))
            vv[lay['gpart']] = 0.0
            vv[lay['gv']] = gv0 + (gv1 - gv0) * t
            vv[lay['glow']] = 0.0
            ring.append(vv)
        rings.append(ring)
    for a_, b_ in zip(rings[:-1], rings[1:]):
        for k in range(nsides):
            k2 = (k + 1) % nsides
            bm.faces.new((a_[k], a_[k2], b_[k2], b_[k]))
    tipv = bm.verts.new(tuple(pts[-1] + tans[-1] * stalk_r * 0.4))
    tipv[lay['gv']] = 1.0
    tipv[lay['gpart']] = 0.0
    tipv[lay['glow']] = 0.0
    for k in range(nsides):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % nsides], tipv))
    bm.faces.new(list(reversed(rings[0])))
    # leaflets: gill-lamella blades, frilled along the free edge
    tips = []
    for j, t in enumerate(leaf_t):
        i = min(int(t * seg), seg - 1)
        q, tg = pts[i], tans[i]
        sgn = 1 if j % 2 == 0 else -1
        bn = nrm(np.cross(tg, normal)) * sgn
        L = length * leaf_len * (1 - (0.5 if crowd <= 1.0 else 0.25) * t) * rng.uniform(0.8, 1.2)
        ldir = nrm(bn * 0.8 + tg * 0.6)
        W = L * leaf_w
        nl, nw = 7, 4
        top, bot = [], []
        ph0 = rng.uniform(0, 6.28)
        for a in range(nl):
            f = a / (nl - 1)
            c = q + ldir * L * f + normal * (0.12 * L * f * f)
            ww = W * wfn(f)
            ct, cb = [], []
            for b2 in range(nw):
                e = -1 + 2 * b2 / (nw - 1)
                pp = c + tg * ww * 0.5 * e
                fr_ = frill * ww * math.sin(ph0 + f * 9.0 + e * 2.0) * abs(e) ** 1.5
                th = 0.0006 * (1 - f) + 0.00025
                vt = bm.verts.new(tuple(pp + normal * (th + fr_)))
                vb = bm.verts.new(tuple(pp - normal * (th - fr_)))
                for vv in (vt, vb):
                    vv[lay['gpart']] = 2.0
                    vv[lay['gv']] = t + (1 - t) * f * 0.3
                    vv[lay['glow']] = 0.0
                # the underside of the outer leaf: gill lamellae (painted and bumped by the frond material)
                vb[lay['gill']] = min(1.0, max(0.0, (f - 0.25) / 0.35))
                ct.append(vt)
                cb.append(vb)
            top.append(ct)
            bot.append(cb)
        for a in range(nl - 1):
            for b2 in range(nw - 1):
                bm.faces.new((top[a][b2], top[a][b2 + 1], top[a + 1][b2 + 1], top[a + 1][b2]))
                bm.faces.new((bot[a + 1][b2], bot[a + 1][b2 + 1], bot[a][b2 + 1], bot[a][b2]))
            for b2 in (0, nw - 1):
                q4 = (top[a][b2], top[a + 1][b2], bot[a + 1][b2], bot[a][b2])
                bm.faces.new(q4 if b2 == 0 else q4[::-1])
        for b2 in range(nw - 1):
            bm.faces.new((top[-1][b2], bot[-1][b2], bot[-1][b2 + 1], top[-1][b2 + 1]))
        tips.append((q + ldir * L, ldir, t))
    if form != 'pinnate':
        _form(bm, lay, form, pts, tans, normal, w, length, stalk_r, rng, gv0, gv1)
    # forks: side branches that leave the stalk part-way and carry their own leaflets and tip
    for fk in range(fork):
        tb = rng.uniform(0.32, 0.55)
        i = int(tb * seg)
        bdir = nrm(tans[i] + nrm(np.cross(tans[i], normal)) * (0.75 if fk % 2 == 0 else -0.75) + normal * rng.uniform(-0.3, 0.3))
        frond(bm, lay, pts[i] - tans[i] * stalk_r, bdir, w, length * (1 - tb) * rng.uniform(0.6, 0.8), rng, curl=curl * 0.8,
              leaflets=max(3, leaflets - 3), leaf_len=leaf_len, stalk_r=stalk_r * (1 - 0.68 * tb) * 0.85, nodules=nodules,
              seg=12, tip='pods' if tip == 'cap' else 'cap', leaf_w=leaf_w, frill=frill, fork=0,
              gv0=gv0 + (gv1 - gv0) * tb, gv1=gv1, shape=shape, crowd=crowd, nod_p=nod_p, form=form)
    if nodules and form == 'pinnate':
        for c, dd, t in tips:
            if rng.uniform() < nod_p:
                rr = stalk_r * rng.uniform(0.7, 1.25)
                _ovoid(bm, lay, c + dd * rr * 0.6, dd, rr * rng.uniform(1.2, 1.7), rr, 3.0, 1.0, t)
        if tip == 'cap':
            _spore_cap(bm, lay, pts[-1] + tans[-1] * stalk_r * 0.2, tans[-1], stalk_r * rng.uniform(2.6, 3.4), 1.0)
        else:
            for k in range(int(rng.integers(2, 5))):
                dd = nrm(tans[-1] + normal * rng.uniform(-0.6, 0.6) + w * rng.uniform(-0.6, 0.6))
                rr = stalk_r * rng.uniform(0.75, 1.2)
                _ovoid(bm, lay, pts[-1] + dd * rr * 1.2, dd, rr * rng.uniform(1.3, 1.9), rr, 3.0, 1.0, 1.0)
    return pts


def frond_mesh(name, specs, seed=3):
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    lay = {k: bm.verts.layers.float.new(k) for k in ('glow', 'gpart', 'gv', 'gill')}
    for sp in specs:
        frond(bm, lay, np.asarray(sp['base'], float), np.asarray(sp['dir'], float), np.asarray(sp['side'], float),
              sp['length'], rng, curl=sp.get('curl', 1.4), leaflets=sp.get('leaflets', 7), leaf_len=sp.get('leaf', 0.35),
              stalk_r=sp.get('r', 0.0032), nodules=sp.get('nodules', True), tip=sp.get('tip', 'pods'),
              leaf_w=sp.get('leaf_w', 0.32), frill=sp.get('frill', 0.18), fork=sp.get('fork', 0),
              shape=sp.get('shape', 'willow'), crowd=sp.get('crowd', 1.0), nod_p=sp.get('nod_p', 0.55),
              form=sp.get('form', 'pinnate'))
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    component_uvs(me)
    return me
