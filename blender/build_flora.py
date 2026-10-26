# Builds the planet-surface flora / mineral model library and exports public/models/flora.glb.
# Run: Blender -b -P blender/build_flora.py -- <out.glb> [preview_dir]
#
# Every model is one mesh object at the origin (base centre on the ground, +Z up in Blender -> +Y in glTF),
# plus a "<name>_lod1" version (grass has none). Colour is not baked: the COLOR_0 attribute (RGBA, per corner)
# holds channel weights R = primary part, G = secondary part, B = accent / glow part (R+G+B = 1) and
# A = ambient occlusion (1 = open), computed geometrically by ray casting against the mesh and the ground plane.
# Fully deterministic: all randomness comes from seeded random.Random instances and position-based noise.
#
# Dev helpers (env vars): FLORA_ONLY=prefix,prefix  build only matching models; FLORA_NOLOD=1 skip lod1.
import bpy
import bmesh
import math
import os
import random
import sys
import time
from math import pi, sin, cos, sqrt, exp, atan2

import numpy as np
from mathutils import Vector, Matrix, Quaternion, noise
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.abspath("flora.glb")
PREVIEW_DIR = argv[1] if len(argv) > 1 else None
ONLY = [s for s in os.environ.get("FLORA_ONLY", "").split(",") if s]
NO_LOD = os.environ.get("FLORA_NOLOD") == "1"
T0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

UP = Vector((0, 0, 1))
P = (1.0, 0.0, 0.0)  # primary weight
S = (0.0, 1.0, 0.0)  # secondary weight
A = (0.0, 0.0, 1.0)  # accent / glow weight
SMOOTH = 10.0  # face "sharp angle" that never splits normals
HARD = 0.42  # crystals (~24 deg)
FACET = 0.42  # rock facets (~24 deg)
LEAF = 1.25  # thin leaves: split only the folded-back rim


# =====================================================================================
# small math helpers
# =====================================================================================
def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return a if x < a else (b if x > b else x)


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def mixw(a, b, t):
    t = clamp(t)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def nz(p, seed=0.0):
    return noise.noise(Vector((p[0] + seed * 17.13, p[1] - seed * 9.71, p[2] + seed * 5.37)))


def fbm(p, seed=0.0, octaves=3):
    s, a, f, norm = 0.0, 1.0, 1.0, 0.0
    p = Vector(p)
    for o in range(octaves):
        s += a * nz(p * f, seed + o * 3.1)
        norm += a
        a *= 0.5
        f *= 2.03
    return s / norm


def rand_dir(rng, zmin=-1.0, zmax=1.0):
    z = rng.uniform(zmin, zmax)
    a = rng.uniform(0, 2 * pi)
    r = sqrt(max(0.0, 1 - z * z))
    return Vector((r * cos(a), r * sin(a), z))


def sph(az, el):
    return Vector((cos(az) * cos(el), sin(az) * cos(el), sin(el)))


def rot_to(d):
    return UP.rotation_difference(Vector(d).normalized())


def lin(n, p=1.0):
    return [(i / (n - 1)) ** p for i in range(n)]


# =====================================================================================
# mesh accumulation
# =====================================================================================
class MB:
    """Accumulates vertices (with RGB part weights) and faces (with a per-face sharp-angle threshold)."""

    def __init__(self):
        self.v, self.w, self.f, self.fa, self.fw = [], [], [], [], []
        self.n = {}  # vertex index -> custom shading normal (leaves borrow their crown's)
        self.aoref = {}  # vertex index -> (vertex whose occlusion it takes, factor)

    def vert(self, co, w, n=None):
        self.v.append(Vector(co))
        self.w.append(tuple(w))
        if n is not None:
            self.n[len(self.v) - 1] = Vector(n).normalized()
        return len(self.v) - 1

    def face(self, idx, ang=SMOOTH, fw=None):
        self.f.append(tuple(idx))
        self.fa.append(ang)
        self.fw.append(fw)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def add(self, verts, faces, w, ang=SMOOTH):
        b = len(self.v)
        for co in verts:
            self.vert(co, w(co) if callable(w) else w)
        for f in faces:
            self.face([b + i for i in f], ang)

    def xform(self, i0, fn):
        for i in range(i0, len(self.v)):
            self.v[i] = fn(self.v[i])


def loft(mb, rings, ws, ang=SMOOTH):
    """Join consecutive rings (lists of Vector, or a single Vector = pole) with quads / fans.
    Ring vertices must run CCW around the direction of travel for outward normals."""
    idx = []
    for r, w in zip(rings, ws):
        if isinstance(r, Vector):
            idx.append(mb.vert(r, w if isinstance(w, tuple) else w[0]))
        else:
            idx.append([mb.vert(cc, w[j] if isinstance(w, list) else w) for j, cc in enumerate(r)])
    for i in range(len(idx) - 1):
        a, b = idx[i], idx[i + 1]
        if isinstance(a, int) and isinstance(b, int):
            continue
        if isinstance(a, int):
            n = len(b)
            for j in range(n):
                mb.face((a, b[(j + 1) % n], b[j]), ang)
        elif isinstance(b, int):
            n = len(a)
            for j in range(n):
                mb.face((a[j], a[(j + 1) % n], b), ang)
        else:
            n = len(a)
            for j in range(n):
                k = (j + 1) % n
                mb.face((a[j], a[k], b[k], b[j]), ang)
    return idx


def spline(ctrl, us):
    """Catmull-Rom through ctrl, sampled at parameters us in [0, 1]."""
    c = [Vector(p) for p in ctrl]
    ext = [2 * c[0] - c[1]] + c + [2 * c[-1] - c[-2]]
    segs = len(c) - 1
    out = []
    for u in us:
        x = clamp(u) * segs
        k = min(int(x), segs - 1)
        f = x - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        out.append(0.5 * ((2 * p1) + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * (f * f)
                          + (3 * p1 - p0 - 3 * p2 + p3) * (f * f * f)))
    return out


def path_frames(pts):
    n = len(pts)
    tans = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        tans.append(t.normalized())
    t0 = tans[0]
    ref = Vector((1, 0, 0)) if abs(t0.x) < 0.9 else Vector((0, 1, 0))
    nr = (ref - t0 * ref.dot(t0)).normalized()
    out = []
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i])
            nr = q @ nr
            nr = (nr - tans[i] * nr.dot(tans[i])).normalized()
        out.append((tans[i], nr, tans[i].cross(nr)))
    return out


def arclen(pts):
    L = [0.0]
    for i in range(1, len(pts)):
        L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    tot = L[-1] or 1.0
    return [x / tot for x in L], tot


def tube(mb, pts, radii, sides, w, ang=SMOOTH, rfn=None, start=None, end='dome', phase=0.0):
    """Swept circle along pts. w: rgb tuple or fn(u, a). rfn(u, a, p) -> radius multiplier."""
    fr = path_frames(pts)
    us, _ = arclen(pts)
    rings, ws = [], []
    for i, p in enumerate(pts):
        t, nr, bn = fr[i]
        ring, wl = [], []
        for j in range(sides):
            a = phase + 2 * pi * j / sides
            m = rfn(us[i], a, p) if rfn else 1.0
            ring.append(p + (nr * cos(a) + bn * sin(a)) * (radii[i] * m))
            wl.append(w(us[i], a) if callable(w) else w)
        rings.append(ring)
        ws.append(wl)
    if end in ('dome', 'point', 'cap'):
        t = fr[-1][0]
        r = radii[-1]
        p = pts[-1]
        wend = w(1.0, 0.0) if callable(w) else w
        if end == 'dome':
            rings.append([p + (cc - p) * 0.72 + t * (r * 0.62) for cc in rings[-1]])
            ws.append(ws[-1])
            rings.append(p + t * (r * 0.95))
            ws.append(wend)
        elif end == 'point':
            rings.append(p + t * (r * 1.5))
            ws.append(wend)
        else:
            rings.append(p.copy())
            ws.append(wend)
    if start in ('cap', 'dome'):
        t = fr[0][0]
        r = radii[0]
        p = pts[0]
        w0 = w(0.0, 0.0) if callable(w) else w
        if start == 'dome':
            rings.insert(0, [p + (cc - p) * 0.72 - t * (r * 0.62) for cc in rings[0]])
            ws.insert(0, ws[0])
            rings.insert(0, p - t * (r * 0.95))
            ws.insert(0, w0)
        else:
            rings.insert(0, p.copy())
            ws.insert(0, w0)
    return loft(mb, rings, ws, ang)


def lathe(mb, center, prof, sides, w, ang=SMOOTH, rmod=None, zmod=None, rot=None, phase=0.0):
    """Surface of revolution of prof [(r, z)] about local +Z. Outside is to the right of the profile
    direction (bottom->top gives outward normals). Callbacks get (ring index, u, angle)."""
    rings, ws = [], []
    n = len(prof)
    for i, (r, z) in enumerate(prof):
        u = i / (n - 1)
        if r <= 1e-6:
            zz = z + (zmod(i, u, 0.0) if zmod else 0.0)
            lp = Vector((0, 0, zz))
            rings.append(center + (rot @ lp if rot else lp))
            ws.append(w(i, u, 0.0) if callable(w) else w)
            continue
        ring, wl = [], []
        for j in range(sides):
            a = phase + 2 * pi * j / sides
            rr = r * (rmod(i, u, a) if rmod else 1.0)
            zz = z + (zmod(i, u, a) if zmod else 0.0)
            lp = Vector((cos(a) * rr, sin(a) * rr, zz))
            ring.append(center + (rot @ lp if rot else lp))
            wl.append(w(i, u, a) if callable(w) else w)
        rings.append(ring)
        ws.append(wl)
    return loft(mb, rings, ws, ang)


def ball(mb, c, r, segs, rings, w, scale=(1, 1, 1), rot=None, ang=SMOOTH, jitter=0.0, seed=0.0):
    prof = [(sin(pi * i / rings), -cos(pi * i / rings)) for i in range(rings + 1)]
    i0 = len(mb.v)
    lathe(mb, Vector((0, 0, 0)), prof, segs, w, ang)
    sx, sy, sz = scale

    def f(v):
        lv = Vector((v.x * r * sx, v.y * r * sy, v.z * r * sz))
        if jitter:
            lv *= 1 + jitter * nz(v * 1.7, seed)
        return c + (rot @ lv if rot else lv)

    mb.xform(i0, f)


def arc_path(base, d0, length, bend, n, power=1.5, side=None):
    """Spine that starts along d0 and bends about 'side' (positive bend droops). Returns points, tangents."""
    d0 = Vector(d0).normalized()
    if side is None:
        side = UP.cross(d0)
        if side.length < 1e-4:
            side = Vector((0, 1, 0))
    side = Vector(side).normalized()
    sub = 48
    pts = [Vector(base)]
    tans = [d0.copy()]
    p = Vector(base)
    for k in range(1, sub + 1):
        s = (k - 0.5) / sub
        t = Quaternion(side, bend * s ** power) @ d0
        p = p + t * (length / sub)
        pts.append(p.copy())
        tans.append((Quaternion(side, bend * (k / sub) ** power) @ d0))
    op, ot = [], []
    for i in range(n):
        x = i / (n - 1) * sub
        k = min(int(x), sub - 1)
        f = x - k
        op.append(pts[k].lerp(pts[k + 1], f))
        ot.append(tans[k].lerp(tans[k + 1], f).normalized())
    return op, ot


def blade(mb, pts, tans, side, widths, thick, w, ring=4, fold=0.0, ang=LEAF, fwd=None, base_pole=True,
          tip_pole=True):
    """Closed thin leaf strip along a spine. ring=4: lens section (top, edge, bottom, edge);
    ring=3: ridge on top, flat underside (fold must be <= 0). fold lifts/lowers the edges."""
    n = len(pts)
    rings, ws = [], []
    for i in range(n):
        s = i / (n - 1)
        t = tans[i]
        sd = (side - t * side.dot(t))
        sd = sd.normalized() if sd.length > 1e-6 else Vector((1, 0, 0))
        nr = t.cross(sd)
        bn = t.cross(nr)
        wd = max(widths[i], 1e-3) * 0.5
        th = max(thick[i], 1e-4) * 0.5
        p = pts[i]
        lift = nr * (fold * wd)
        f = t * (fwd[i] if fwd else 0.0)
        e1 = p + bn * wd + lift + f
        e2 = p - bn * wd + lift + f
        ww = w(s) if callable(w) else w
        if (i == 0 and base_pole) or (i == n - 1 and tip_pole):
            rings.append(p.copy())
        elif ring == 4:
            rings.append([p + nr * th, e1, p - nr * th, e2])
        else:
            rings.append([p + nr * th, e1, e2])
        ws.append(ww)
    return loft(mb, rings, ws, ang)


# =====================================================================================
# metaballs / decimation / rocks
# =====================================================================================
MBK = 0.575  # surface radius of a lone metaball (stiffness 2, threshold 0.6) relative to its radius
_mbn = [0]


def meta_mesh(elems, res):
    _mbn[0] += 1
    nm = "mbz%d" % _mbn[0]
    d = bpy.data.metaballs.new(nm)
    d.resolution = res
    d.render_resolution = res
    d.threshold = 0.6
    for e in elems:
        el = d.elements.new()
        el.co = e['co']
        el.radius = e['r'] / MBK
        el.stiffness = 2.0
    ob = bpy.data.objects.new(nm, d)
    scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    verts = [v.co.copy() for v in me.vertices]
    norms = [v.normal.copy() for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(d)
    bpy.data.meshes.remove(me)
    return verts, norms, faces


def meta_w(p, elems, power=2.0):
    acc = [0.0, 0.0, 0.0]
    tot = 0.0
    best, bd = None, 1e9
    for e in elems:
        R = e['r'] / MBK
        d2 = (p - e['co']).length_squared / (R * R)
        if d2 < bd:
            bd, best = d2, e
        if d2 < 1.0:
            f = ((1 - d2) ** 3) ** power
            w = e['w']
            acc[0] += w[0] * f
            acc[1] += w[1] * f
            acc[2] += w[2] * f
            tot += f
    if tot <= 1e-12:
        return best['w']
    return (acc[0] / tot, acc[1] / tot, acc[2] / tot)


def decimate(verts, faces, target):
    tris = sum(len(f) - 2 for f in faces)
    if tris <= target:
        return verts, faces
    me = bpy.data.meshes.new("_dec")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new("_dec", me)
    scene.collection.objects.link(ob)
    md = ob.modifiers.new("dec", 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = target / tris
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    m2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    v2 = [v.co.copy() for v in m2.vertices]
    f2 = [tuple(p.vertices) for p in m2.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(m2)
    return v2, f2


def ell_normal(p, dims):
    n = Vector((p.x / (dims[0] ** 2), p.y / (dims[1] ** 2), p.z / (dims[2] ** 2)))
    return n.normalized() if n.length > 1e-9 else UP.copy()


def rock_mesh(seed, dims, subdiv=5, planes=12, depth=(0.7, 0.95), amp=0.22, freq=1.1, flat_bottom=0.55,
              sink=0.06, post=None, target=480, pz=(-0.5, 1.0), detail=0.0):
    """Faceted stone: noisy ellipsoid, chipped by clamping against random planes, optional post(p) deform,
    decimated to target triangles. Bottom sits at z = -sink."""
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    verts = [v.co.copy() for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    so = rng.uniform(0, 50)
    dx, dy, dz = dims
    pls = []
    for i in range(planes):
        n = rand_dir(rng, *pz)
        f = rng.uniform(*depth)
        ext = sqrt((dx * n.x) ** 2 + (dy * n.y) ** 2 + (dz * n.z) ** 2)
        pls.append((n, f * ext))
    out = []
    for v in verts:
        p = v * (1 + amp * fbm(v * freq, so, 3))
        p = Vector((p.x * dx, p.y * dy, p.z * dz))
        for n, d in pls:
            k = p.dot(n) - d
            if k > 0:
                p = p - n * k
        if detail:
            p = p + v * (detail * nz(v * 5.0, so + 2))
        if flat_bottom:
            zb = -flat_bottom * dz
            if p.z < zb:
                p.z = zb
        if post:
            p = post(p)
        out.append(p)
    zmin = min(p.z for p in out)
    out = [Vector((p.x, p.y, p.z - zmin - sink)) for p in out]
    return decimate(out, faces, target)


# =====================================================================================
# finishing: mesh object, sharp edges, AO, colour attribute
# =====================================================================================
def hemi_dirs(k):
    out = []
    ga = pi * (3 - sqrt(5))
    for i in range(k):
        u = (i + 0.5) / k
        r = sqrt(u)
        a = i * ga
        out.append(Vector((r * cos(a), r * sin(a), sqrt(max(0.0, 1 - u)))))
    return out


HEMI = hemi_dirs(40)


def compute_ao(me, maxdist, ground_dist, ground_w=0.45, strength=1.0):
    n = len(me.vertices)
    co = [v.co.copy() for v in me.vertices]
    nr = [v.normal.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    bvh = BVHTree.FromPolygons(co, polys, all_triangles=True)
    eps = max(0.003, maxdist * 0.004)
    K = len(HEMI)
    ao = np.ones(n)
    for i in range(n):
        p = co[i]
        nn = nr[i]
        if nn.length < 0.5:
            nn = UP
        if p.z < -0.02:
            ao[i] = clamp(0.45 + p.z * 2.0, 0.15, 0.45)
            continue
        tx = nn.orthogonal().normalized()
        ty = nn.cross(tx)
        M = Matrix((tx, ty, nn)).transposed()
        o = p + nn * eps
        occ = 0.0
        for d0 in HEMI:
            d = M @ d0
            loc, _, _, dist = bvh.ray_cast(o, d, maxdist)
            if loc is not None:
                occ += 1.0 - dist / maxdist
            elif d.z < -0.02:
                tg = max(0.0, -o.z / d.z)
                g = 0.0
                if tg < maxdist:
                    g = 1.0 - tg / maxdist
                if tg < ground_dist:
                    g = max(g, ground_w * (1.0 - tg / ground_dist))
                occ += g
        ao[i] = 1.0 - strength * occ / K
    # one smoothing pass over edge neighbours
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    acc = np.zeros(n)
    cnt = np.zeros(n)
    np.add.at(acc, ev[:, 0], ao[ev[:, 1]])
    np.add.at(acc, ev[:, 1], ao[ev[:, 0]])
    np.add.at(cnt, ev[:, 0], 1)
    np.add.at(cnt, ev[:, 1], 1)
    sm = np.where(cnt > 0, acc / np.maximum(cnt, 1), ao)
    ao = 0.55 * ao + 0.45 * sm
    return np.clip(ao, 0.08, 1.0)


EXPORT_MAT = bpy.data.materials.new("flora")
EXPORT_MAT.use_nodes = True
_b = next(n for n in EXPORT_MAT.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
_b.inputs["Base Color"].default_value = (1, 1, 1, 1)
_b.inputs["Roughness"].default_value = 0.85

OBJ = {}
INFO = {}


def finish(name, mb, opts):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in mb.v]
    bm.verts.ensure_lookup_table()
    la = bm.faces.layers.float.new("ang")
    lw = bm.faces.layers.int.new("fw")
    fws = []
    bad = 0
    for f, ang, fw in zip(mb.f, mb.fa, mb.fw):
        if len(set(f)) < len(f):
            ff = []
            for x in f:
                if not ff or ff[-1] != x:
                    ff.append(x)
            if len(ff) > 1 and ff[0] == ff[-1]:
                ff.pop()
            f = ff
            if len(f) < 3 or len(set(f)) < len(f):
                bad += 1
                continue
        try:
            face = bm.faces.new([vs[i] for i in f])
        except ValueError:
            bad += 1
            continue
        face[la] = ang
        if fw is None:
            face[lw] = -1
        else:
            face[lw] = len(fws)
            fws.append(fw)
    bm.normal_update()
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            thr = min(lf[0][la], lf[1][la])
            if thr < 3.0 and e.calc_face_angle(0.0) > thr:
                e.smooth = False
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    loose = [v for v in bm.verts if not v.link_faces]
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    # per-face weight overrides
    nf = len(me.polygons)
    fwa = np.full(nf, -1, dtype=np.int64)
    if "fw" in me.attributes:
        tmp = np.empty(nf, dtype=np.int32)
        me.attributes["fw"].data.foreach_get("value", tmp)
        fwa = tmp.astype(np.int64)
    for an in ("fw", "ang"):
        if an in me.attributes:
            me.attributes.remove(me.attributes[an])
    me.update()
    nv = len(me.vertices)
    W = np.array(mb.w[:nv], dtype=np.float64)
    W = np.clip(W, 0, None)
    W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    if opts.get('ao_fn'):
        ao = np.array([opts['ao_fn'](v.co) for v in me.vertices])
    else:
        ao = compute_ao(me, opts.get('ao', 1.0), opts.get('gd', 8.0), opts.get('gw', 0.6),
                        opts.get('aos', 1.0))
        ao = ao ** opts.get('aog', 1.5)
        # height term: everything gets a little darker toward the ground (sky visibility)
        zs = np.array([v.co.z for v in me.vertices])
        hmax = max(zs.max(), 0.05)
        lo = opts.get('hlo', 0.7)
        t = np.clip(zs / hmax, 0, 1)
        ao = ao * (lo + (1 - lo) * (t * t * (3 - 2 * t)) ** 0.7)
        ao = np.clip(ao, 0.12, 1.0)
    for vi, (ri, f) in mb.aoref.items():
        if vi < nv and ri < nv:
            ao[vi] = ao[ri] * f
    if os.environ.get("FLORA_DEBUG"):
        print("   AO %s min %.2f mean %.2f max %.2f" % (name, ao.min(), ao.mean(), ao.max()))
    nl = len(me.loops)
    lv = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    data = np.zeros((nl, 4), dtype=np.float32)
    data[:, :3] = W[lv]
    data[:, 3] = ao[lv]
    if fws:
        ls = np.empty(nf, dtype=np.int64)
        lt = np.empty(nf, dtype=np.int64)
        me.polygons.foreach_get("loop_start", ls)
        me.polygons.foreach_get("loop_total", lt)
        for fi in np.nonzero(fwa >= 0)[0]:
            ww = np.array(fws[fwa[fi]], dtype=np.float32)
            data[ls[fi]:ls[fi] + lt[fi], :3] = ww / max(ww.sum(), 1e-9)
    col = me.color_attributes.new("Color", 'FLOAT_COLOR', 'CORNER')
    col.data.foreach_set("color", data.ravel())
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    if opts.get('up_normals'):
        me.normals_split_custom_set_from_vertices([(0.0, 0.0, 1.0)] * nv)
    elif mb.n:
        cn = np.empty(nl * 3, dtype=np.float32)
        me.corner_normals.foreach_get("vector", cn)
        cn = cn.reshape(nl, 3)
        for li in range(nl):
            n = mb.n.get(int(lv[li]))
            if n is not None:
                cn[li] = (n.x, n.y, n.z)
        me.normals_split_custom_set([tuple(x) for x in cn])
    me.materials.append(EXPORT_MAT)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    OBJ[name] = ob
    zs = [v.co.z for v in me.vertices]
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    INFO[name] = dict(tris=len(me.polygons), h=max(zs), zmin=min(zs), w=max(max(xs) - min(xs), max(ys) - min(ys)),
                      bad=bad, loose=len(loose), cat=opts.get('cat', 'plant'))
    return ob


class Ctx:
    STORE = {}

    def __init__(self, name, seed, lod, variant, budget):
        self.name, self.seed, self.lod, self.v, self.budget = name, seed, lod, variant, budget
        self.rng = random.Random(seed)

    def r(self, a, b):
        return a if self.lod == 0 else b

    def target(self, key, lod0_value, ratio=0.25):
        k = (self.name, key)
        if self.lod == 0:
            Ctx.STORE[k] = int(lod0_value)
            return int(lod0_value)
        return max(12, int(Ctx.STORE.get(k, lod0_value) * ratio))


# =====================================================================================
# shared plant parts
# =====================================================================================
def tree_trunk(c, mb, H, r0, lean, lobes=5, flare=0.8, sides=(12, 6), rings=(16, 6), twist=1.0, sink=0.45,
               taper=0.5, bark=0.05, w=S):
    rng = c.rng
    phi = rng.uniform(0, 2 * pi)
    j = [rand_dir(rng, -0.2, 0.2) for _ in range(3)]
    lp = Vector((cos(phi), sin(phi), 0)) * lean
    ctrl = [Vector((0, 0, -sink)), Vector((0, 0, 0.6)) + j[0] * 0.06,
            lp * 0.3 + Vector((0, 0, H * 0.5)) + j[1] * 0.25, lp + Vector((0, 0, H)) + j[2] * 0.2]
    lph = rng.uniform(0, 2 * pi)
    n = c.r(*rings)
    us = lin(n)
    pts = spline(ctrl, us)
    radii = [r0 * (1 - taper * u) for u in us]

    def rfn(u, a, p):
        z = max(p.z, 0.0)
        fl = flare * exp(-z / 0.55)
        lob = max(0.0, cos(lobes * (a - lph))) ** 1.5
        return 1.0 + fl * (0.2 + 0.8 * lob) + bark * cos(6 * a + twist * 2 * pi * u)

    tube(mb, pts, radii, c.r(*sides), w, rfn=rfn, end='cap', start='cap')
    return pts, ctrl, radii


def point_at_height(pts, z):
    for i in range(len(pts) - 1):
        if pts[i].z <= z <= pts[i + 1].z:
            f = (z - pts[i].z) / max(pts[i + 1].z - pts[i].z, 1e-6)
            return pts[i].lerp(pts[i + 1], f)
    return pts[-1].copy() if z > pts[-1].z else pts[0].copy()


def clump_disp(p, scale, seed):
    """Cellular 'leaf clump' relief: domes inside voronoi cells, creases along the cell borders."""
    d, _ = noise.voronoi(p * (1.0 / scale) + Vector((seed * 3.7, seed * 1.3, -seed * 2.1)), distance_metric='DISTANCE')
    e = clamp((d[1] - d[0]) / 0.38)
    return sqrt(e) - 0.55


def laplace(verts, faces, iters=1, k=0.5):
    V = np.array([tuple(v) for v in verts], dtype=np.float64)
    E = []
    for f in faces:
        for i in range(len(f)):
            E.append((f[i], f[(i + 1) % len(f)]))
    E = np.array(E, dtype=np.int64)
    for _ in range(iters):
        acc = np.zeros_like(V)
        cnt = np.zeros(len(V))
        np.add.at(acc, E[:, 0], V[E[:, 1]])
        np.add.at(cnt, E[:, 0], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        V = V + k * (avg - V)
    return [Vector(x) for x in V]


def canopy(c, mb, clusters, target, res=0.09, amp=0.18, flat=0.7, lumps=18, seed=0.0, w=P, clump=1.25, camp=0.36):
    rng = c.rng
    elems = []
    for (cc, R) in clusters:
        for k in range(3):
            off = rand_dir(rng) * (R * 0.28)
            off.z *= 0.45
            elems.append({'co': cc + off, 'r': R * rng.uniform(0.55, 0.68), 'w': w})
        for k in range(lumps):
            d = rand_dir(rng, -0.55, 1.0)
            pos = cc + Vector((d.x * R * 0.7, d.y * R * 0.7, d.z * R * 0.58 * flat + R * 0.04))
            elems.append({'co': pos, 'r': R * rng.uniform(0.26, 0.4), 'w': w})
    verts, norms, faces = meta_mesh(elems, res)
    out = []
    for v, n in zip(verts, norms):
        dd = amp * fbm(v * 0.8, seed, 2) + camp * clump_disp(v, clump, seed)
        if n.z < 0:  # flatter, tucked-in undersides
            dd -= 0.12 * (-n.z)
        out.append(v + n * dd)
    out = laplace(out, faces, 2, 0.5)
    verts, faces = decimate(out, faces, target)
    mb.add(verts, faces, w)
    return elems, verts, faces


def surface_samples(rng, verts, faces, n):
    """n random points (with interpolated normals) spread evenly by area over a mesh."""
    vn = [Vector((0, 0, 0)) for _ in verts]
    tris, areas = [], []
    for f in faces:
        for k in range(1, len(f) - 1):
            a, b, cc = verts[f[0]], verts[f[k]], verts[f[k + 1]]
            cr = (b - a).cross(cc - a)
            for i in (f[0], f[k], f[k + 1]):
                vn[i] += cr
            tris.append((f[0], f[k], f[k + 1]))
            areas.append(cr.length * 0.5)
    vn = [x.normalized() if x.length > 1e-12 else Vector((0, 0, 1)) for x in vn]
    tot = sum(areas)
    cum, acc = [], 0.0
    for a in areas:
        acc += a
        cum.append(acc)
    out = []
    import bisect
    for _ in range(n):
        t = tris[min(len(tris) - 1, bisect.bisect_left(cum, rng.random() * tot))]
        u, v = rng.random(), rng.random()
        if u + v > 1:
            u, v = 1 - u, 1 - v
        p = verts[t[0]] * (1 - u - v) + verts[t[1]] * u + verts[t[2]] * v
        nn = (vn[t[0]] * (1 - u - v) + vn[t[1]] * u + vn[t[2]] * v).normalized()
        bw = (1 - u - v, u, v)
        out.append((p, nn, t[max(range(3), key=lambda k: bw[k])]))
    return out


def leaf_shell(c, mb, verts, faces, vbase, count, size, tilt=(0.12, 0.5), width=0.62, fold=0.18, sink=0.12,
               var=0.15, droop=0.3, w0=P, w1=S):
    """Shingle a crown's surface (verts/faces, already added to mb at index vbase) with small
    blunt leaves. Every leaf shades with the crown's outward normal and takes the occlusion of
    the crown surface under it, so the crown still reads as one soft volume, but its outline and
    surface break up into foliage instead of a smooth gumdrop."""
    rng = random.Random(c.seed * 7 + 13 + c.lod)
    if c.lod:
        # the far model is seen from 60-300 m: a few big leaves are enough to keep the outline ruffled
        count, size = max(8, count // 8), size * 2.4
    for p, n, ref in surface_samples(rng, verts, faces, count):
        L = size * rng.uniform(0.75, 1.25)
        t = n.cross(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))).normalized()
        # leaves hang a little: bias the tangent downward on the flanks
        t = (t - UP * (droop * max(0.0, 1.0 - abs(n.z)))).normalized()
        a = rng.uniform(*tilt)
        d = (t * cos(a) + n * sin(a)).normalized()
        s_ = n.cross(d).normalized()
        ln = d.cross(s_).normalized()
        if ln.dot(n) < 0:
            ln = -ln
        W = L * width * rng.uniform(0.85, 1.15)
        base = p - n * (L * sink) - d * (L * 0.15)
        back = -ln * (W * fold)
        l1 = base + d * (L * 0.45) + s_ * (W * 0.5) + back
        r1 = base + d * (L * 0.45) - s_ * (W * 0.5) + back
        l2 = base + d * (L * 0.9) + s_ * (W * 0.22) + back * 0.5
        r2 = base + d * (L * 0.9) - s_ * (W * 0.22) + back * 0.5
        v = rng.random() ** 2 * var
        ww = tuple(w0[k] * (1 - v) + w1[k] * v for k in range(3))
        sn = (n * 0.85 + ln * 0.15 + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.08).normalized()
        ids = [mb.vert(q, ww, sn) for q in (base, r1, r2, l2, l1)]
        # base a touch darker than the tip, so the leaves read as shingles
        for k, iv in enumerate(ids):
            mb.aoref[iv] = (vbase + ref, 0.84 if k == 0 else 1.0)
        mb.face((ids[0], ids[1], ids[2]), LEAF)
        mb.face((ids[0], ids[2], ids[3]), LEAF)
        mb.face((ids[0], ids[3], ids[4]), LEAF)


def crozier(base, d, up, rho0, turns=1.6, n=14, decay=0.3):
    """Fiddlehead / scroll curl path starting at base going up, curling outward along d."""
    d = Vector(d).normalized()
    up = Vector(up).normalized()
    c = base + d * rho0
    pts = []
    for i in range(n):
        ph = turns * pi * i / (n - 1)
        rho = rho0 * exp(-decay * ph)
        pts.append(c + (-d * cos(ph) + up * sin(ph)) * rho)
    return pts


# =====================================================================================
# TREES
# =====================================================================================
def build_round(c):
    rng = c.rng
    mb = MB()
    v = c.v
    cfg = [dict(H=3.4, r0=0.5, lean=0.6, nl=4, el=(0.4, 0.75), ln=(2.6, 3.2), cr=(1.8, 2.2), top=2.1, subs=1, flat=0.75),
           dict(H=4.4, r0=0.4, lean=0.5, nl=3, el=(1.0, 1.25), ln=(2.8, 3.6), cr=(1.3, 1.7), top=1.7, subs=2, flat=0.95),
           dict(H=3.0, r0=0.42, lean=1.7, nl=4, el=(0.3, 0.6), ln=(3.0, 3.8), cr=(1.5, 2.0), top=0.0, subs=1, flat=0.55)][v]
    pts, ctrl, radii = tree_trunk(c, mb, cfg['H'], cfg['r0'], cfg['lean'], flare=1.0, bark=0.07)
    top = pts[-1]
    ttan = (pts[-1] - pts[-2]).normalized()
    r_top = radii[-1]
    clusters = []
    phi0 = rng.uniform(0, 2 * pi)
    for k in range(cfg['nl']):
        az = phi0 + 2 * pi * k / cfg['nl'] + rng.uniform(-0.4, 0.4)
        el = rng.uniform(*cfg['el'])
        ln = rng.uniform(*cfg['ln'])
        d = sph(az, el)
        start = top - ttan * rng.uniform(0.3, 0.7)
        jit = rand_dir(rng) * (0.06 * ln)
        ctrl_l = [start, start + d * (ln * 0.32), start + d * (ln * 0.66) + jit,
                  start + d * ln + Vector((0, 0, 0.3 * ln * (1.2 - el)))]
        n = c.r(9, 4)
        lp = spline(ctrl_l, lin(n))
        rl = r_top * rng.uniform(0.62, 0.8)
        tube(mb, lp, [rl * (1 - 0.72 * u) for u in lin(n)], c.r(7, 4), S, end='point')
        R = rng.uniform(*cfg['cr'])
        clusters.append((lp[-1] + Vector((0, 0, R * 0.42)), R))
        for s_ in range(cfg['subs']):
            u0 = rng.uniform(0.38, 0.62)
            sp = spline(ctrl_l, [u0])[0]
            az2 = az + rng.choice((-1, 1)) * rng.uniform(0.6, 1.1)
            el2 = clamp(el + rng.uniform(-0.15, 0.3), 0.15, 1.35)
            ln2 = ln * rng.uniform(0.45, 0.62)
            d2 = sph(az2, el2)
            ctrl_s = [sp - d2 * 0.05, sp + d2 * (ln2 * 0.5) + rand_dir(rng) * 0.1, sp + d2 * ln2]
            ns = c.r(6, 3)
            spp = spline(ctrl_s, lin(ns))
            rs = rl * (1 - 0.72 * u0) * 0.72
            tube(mb, spp, [rs * (1 - 0.7 * u) for u in lin(ns)], c.r(5, 3), S, end='point')
            R2 = R * rng.uniform(0.6, 0.76)
            clusters.append((spp[-1] + Vector((0, 0, R2 * 0.38)), R2))
    if cfg['top'] > 0:
        clusters.append((top + Vector((0, 0, cfg['top'] * 0.95)), cfg['top']))
    if v == 2:  # hanging fruit pods (accent)
        for k in range(7):
            cc, R = clusters[rng.randrange(len(clusters))]
            a = rng.uniform(0, 2 * pi)
            fp = cc + Vector((cos(a) * R * 0.45, sin(a) * R * 0.45, -R * 0.62))
            ball(mb, fp, 0.15, c.r(7, 4), c.r(5, 3), A, scale=(1, 1, 1.25))
    used = mb.tris()
    nleaf = 1200
    tgt = c.target('canopy', max(500, c.budget - used - 30 - nleaf * 3))
    vb = len(mb.v)
    _, cv, cf = canopy(c, mb, clusters, tgt, flat=cfg['flat'], seed=c.seed * 0.37)
    leaf_shell(c, mb, cv, cf, vb, nleaf, 0.58)
    return mb, dict(ao=3.0, gd=14.0)


def conifer_tier(c, mb, center, R, h, D, lobes, th0, seed):
    nS = lobes * c.r(3, 2)
    under = c.r([0.42, 0.78], [])
    top = c.r([0.9, 0.72, 0.5, 0.26], [0.55])
    spec = [('pu', 0)] + [('u', x) for x in under] + [('rim', 1.0)] + [('t', x) for x in top] + [('pt', 0)]
    rings, ws = [], []
    for kind, x in spec:
        if kind == 'pu':
            rings.append(center + Vector((0, 0, -h * 0.3)))
            ws.append(P)
            continue
        if kind == 'pt':
            rings.append(center + Vector((0, 0, h * 0.62)))
            ws.append(P)
            continue
        ring = []
        for j in range(nS):
            a = 2 * pi * j / nS
            lb = (0.5 + 0.5 * cos(lobes * (a - th0))) ** 1.6
            rim = R * (0.68 + 0.32 * lb)
            rr = x * rim
            dz = -D * (x ** 2) * (0.65 + 0.5 * lb)
            if kind == 't':
                dz += h * 0.62 * (1 - x) ** 1.15 + 0.12 * h * lb * sin(pi * x)
            elif kind == 'u':
                dz += -h * 0.3 * (1 - x)
            p = center + Vector((cos(a) * rr, sin(a) * rr, dz))
            p += Vector((nz(p * 1.1, seed), nz(p * 1.1, seed + 3), 0.6 * nz(p * 1.1, seed + 7))) * (0.09 * R)
            ring.append(p)
        rings.append(ring)
        ws.append(P)
    loft(mb, rings, ws, ang=1.3)


def build_conifer(c):
    rng = c.rng
    mb = MB()
    v = c.v
    cfg = [dict(H=10.5, R=2.5, T=9, droop=0.55, lobes=7, r0=0.34, bare=1.5, th=1.5),
           dict(H=12.0, R=2.3, T=7, droop=0.38, lobes=6, r0=0.38, bare=3.8, th=1.25),
           dict(H=9.0, R=2.6, T=6, droop=1.05, lobes=5, r0=0.3, bare=2.9, th=1.0)][v]
    H = cfg['H']
    pts, ctrl, radii = tree_trunk(c, mb, H * 0.86, cfg['r0'], 0.25, lobes=4, flare=0.55, taper=0.85,
                                  rings=(14, 5), sides=(9, 5), bark=0.03)
    T = cfg['T']
    pods = []
    last = None
    for i in range(T):
        f = i / (T - 1)
        za = lerp(cfg['bare'], H * 0.84, f ** 0.92) + rng.uniform(-0.12, 0.12)
        R = lerp(cfg['R'], 0.55, f ** 0.85) * rng.uniform(0.9, 1.1)
        h = lerp(cfg['th'], 0.7, f)
        D = cfg['droop'] * R * rng.uniform(0.85, 1.15)
        za = max(za, D * 1.15 + 0.35)
        th0 = rng.uniform(0, 2 * pi)
        center = point_at_height(pts, za)
        conifer_tier(c, mb, center, R, h, D, cfg['lobes'], th0, c.seed + i * 1.7)
        last = (center, h)
        if v == 2 and i < T - 2:
            for k in range(2):
                a = th0 + (k + 0.5) * 2 * pi / cfg['lobes'] + rng.uniform(-0.2, 0.2)
                pods.append(center + Vector((cos(a) * R * 0.62, sin(a) * R * 0.62, -D * 0.55 - h * 0.25)))
    sb = last[0] + Vector((0, 0, last[1] * 0.35))
    sl = max(0.8, H - sb.z)
    lathe(mb, sb, [(0, -0.3), (0.2, 0.0), (0.13, sl * 0.4), (0.06, sl * 0.75), (0, sl)], c.r(8, 4), P,
          rmod=lambda i, u, a: 1 + 0.18 * cos(4 * a) * sin(pi * u))
    for pp in pods:
        ball(mb, pp, 0.13, c.r(6, 4), c.r(4, 3), A, scale=(1, 1, 1.5))
    return mb, dict(ao=2.8, gd=14.0, aog=1.25)


def build_palm(c):
    rng = c.rng
    mb = MB()
    v = c.v
    cfg = [dict(H=9.2, lean=2.4, r=0.22, F=10, fl=(3.4, 4.2), segs=(22, 8), pods=4, bottle=0.0, el=(-0.15, 0.7)),
           dict(H=6.4, lean=0.7, r=0.3, F=12, fl=(2.8, 3.4), segs=(16, 6), pods=0, bottle=0.55, el=(0.0, 0.95))][v]
    az = rng.uniform(0, 2 * pi)
    dl = Vector((cos(az), sin(az), 0))
    H = cfg['H']
    L = cfg['lean']
    sj = Vector((-dl.y, dl.x, 0)) * rng.uniform(-0.4, 0.4)
    ctrl = [Vector((0, 0, -0.35)), dl * (L * 0.04) + Vector((0, 0, H * 0.25)),
            dl * (L * 0.28) + sj * 0.5 + Vector((0, 0, H * 0.6)), dl * L + sj + Vector((0, 0, H))]
    K = c.r(*cfg['segs'])
    us = []
    for k in range(K):
        if c.lod == 0:
            us += [k / K + 0.012, (k + 1) / K]
        else:
            us.append(k / (K - 1))
    us[0] = 0.0
    pts = spline(ctrl, us)

    def rad(u, i):
        z = max(pts[i].z, 0)
        r = cfg['r'] * (1 - 0.25 * u) * (1 + 0.9 * exp(-z / 0.45))
        r *= 1 + cfg['bottle'] * sin(pi * min(1.0, u / 0.75)) ** 2 * (1.2 - u)
        if c.lod == 0:
            r *= 0.92 if i % 2 == 0 else 1.04
        return r

    radii = [rad(u, i) for i, u in enumerate(us)]
    tube(mb, pts, radii, c.r(9, 5), S, end='cap', start='cap', rfn=lambda u, a, p: 1 + 0.035 * nz(p * 4, 3))
    top = pts[-1]
    tt = (pts[-1] - pts[-2]).normalized()
    rt = radii[-1]
    q = rot_to(tt)
    lathe(mb, top, [(rt * 0.8, -0.15), (rt * 1.3, 0.25), (rt * 1.2, 0.55), (rt * 0.7, 0.78), (0, 0.88)],
          c.r(9, 5), mixw(S, P, 0.35), rot=q)
    crown = top + tt * 0.62
    for k in range(cfg['F']):
        faz = 2 * pi * k / cfg['F'] + rng.uniform(-0.25, 0.25)
        el = rng.uniform(*cfg['el'])
        ln = rng.uniform(*cfg['fl'])
        bend = rng.uniform(1.1, 1.8)
        W = ln * rng.uniform(0.2, 0.25)
        d0 = sph(faz, el)
        sd = Vector((-sin(faz), cos(faz), 0))
        n = c.r(27, 7)
        fp, ft = arc_path(crown + d0 * 0.12, d0, ln, bend, n, power=1.4, side=sd)
        widths, thick, fwd = [], [], []
        for i in range(n):
            s = i / (n - 1)
            env = W * sin(pi * clamp((s - 0.08) / 0.92)) ** 0.7
            notch = c.lod == 0 and i % 2 == 1
            widths.append(env * (0.12 if notch else 1.0) + 0.02)
            thick.append(0.03 * (1 - s) + 0.008)
            fwd.append(0.0 if notch else 0.35 * ln / n)
        blade(mb, fp, ft, sd, widths, thick, lambda s: mixw(S, P, s / 0.12), ring=3, fold=-0.55, fwd=fwd)
    for k in range(cfg['pods']):
        a = rng.uniform(0, 2 * pi)
        pp = top + Vector((cos(a), sin(a), 0)) * (rt * 1.6) + tt * rng.uniform(0.1, 0.4)
        ball(mb, pp, 0.17, c.r(7, 4), c.r(5, 3), A, scale=(1, 1, 1.15))
    return mb, dict(ao=2.5, gd=14.0)


# =====================================================================================
# ALIEN TREES
# =====================================================================================
def mushroom(c, mb, base, Hs, rs, Rc, kind, ribs, rib_amp, spots, ring, lean, small=False):
    rng = c.rng
    az = rng.uniform(0, 2 * pi)
    dl = Vector((cos(az), sin(az), 0))
    j = rand_dir(rng, -0.2, 0.2)
    sc = Hs / 5.0
    ctrl = [base + Vector((0, 0, -0.4 * sc)), base + Vector((0, 0, Hs * 0.3)) + j * (0.12 * sc),
            base + dl * (lean * 0.45) + Vector((0, 0, Hs * 0.66)), base + dl * lean + Vector((0, 0, Hs))]
    n = c.r(14, 5) if not small else c.r(9, 4)
    us = lin(n)
    pts = spline(ctrl, us)
    rph = rng.uniform(0, 2 * pi)
    rph2 = rng.uniform(0, 2 * pi)

    def rad(i, u):
        z = pts[i].z - base.z
        return rs * (0.8 + 0.32 * u ** 1.6) * (1 + 0.8 * exp(-(max(z, 0) / (0.4 * sc)) ** 2))

    radii = [rad(i, u) for i, u in enumerate(us)]
    sides = c.r(14, 6) if not small else c.r(10, 4)
    tube(mb, pts, radii, sides, S, rfn=lambda u, a, p: 1 + 0.035 * cos(7 * a + 3 * u + rph), end='cap', start='cap')
    t_top = (pts[-1] - pts[-2]).normalized()
    q = Quaternion().slerp(rot_to(t_top), 0.6)
    cen = pts[-1]
    rt = radii[-1]
    if kind == 'dome':
        Hc = Rc * 0.56
        under = [(rt * 0.8, -0.05), (Rc * 0.3, -0.2 * sc), (Rc * 0.55, -0.27 * sc), (Rc * 0.78, -0.26 * sc),
                 (Rc * 0.93, -0.16 * sc)]
        top = [(Rc, 0.0), (Rc * 0.998, Hc * 0.06), (Rc * 0.985, Hc * 0.2), (Rc * 0.88, Hc * 0.48), (Rc * 0.68, Hc * 0.74), (Rc * 0.42, Hc * 0.92),
               (Rc * 0.16, Hc * 0.995), (0, Hc)]
    elif kind == 'bell':
        Hc = Rc * 1.05
        drop = Rc * 0.7
        under = [(rt * 0.8, -0.05), (Rc * 0.38, -drop * 0.3), (Rc * 0.64, -drop * 0.62), (Rc * 0.86, -drop * 0.9)]
        top = [(Rc, -drop), (Rc * 0.995, -drop * 0.9), (Rc * 0.98, -drop * 0.62), (Rc * 0.9, -drop * 0.1), (Rc * 0.76, Hc * 0.3),
               (Rc * 0.56, Hc * 0.58), (Rc * 0.3, Hc * 0.82), (Rc * 0.1, Hc * 0.9), (0, Hc * 0.92)]
    else:  # funnel-shaped parasol with upturned wavy rim and a central boss
        under = [(rt * 0.8, -0.05), (Rc * 0.35, -0.02 * sc), (Rc * 0.68, 0.22 * sc), (Rc * 0.92, 0.5 * sc)]
        top = [(Rc, 0.68 * sc), (Rc * 0.99, 0.77 * sc), (Rc * 0.975, 0.84 * sc), (Rc * 0.86, 0.76 * sc), (Rc * 0.62, 0.52 * sc),
               (Rc * 0.36, 0.38 * sc), (Rc * 0.15, 0.4 * sc), (0, 0.56 * sc)]
    prof = under + top
    nu = len(under)
    cs = (c.r(48, 12) if kind != 'flat' else c.r(40, 12)) if not small else c.r(24, 8)
    gdep = 0.22 * Rc / 2.7

    def rmod(i, u, a):
        rr = prof[i][0] / Rc
        return 1 + rib_amp * cos(ribs * a + rph2) * rr ** 3

    wave = 0.3 * sc if kind == 'flat' else 0.0

    def zmod(i, u, a):
        rr = prof[i][0] / Rc
        z = wave * sin(5 * a + rph) * rr ** 2
        if 0 < i < nu:
            return z - gdep * sin(pi * i / nu) * (0.5 + 0.5 * cos(cs / 2 * a))
        if i >= nu:
            return z + rib_amp * 0.9 * Rc * cos(ribs * a + rph2) * rr * (1 - rr) * 1.5
        return z

    def wfn(i, u, a):
        if i == 0:
            return S
        if i < nu:
            rr = prof[i][0] / Rc
            return mixw(S, mixw(P, A, 0.8), smoothstep(0.15, 0.55, rr))
        if i == nu:
            return mixw(P, A, 0.55)
        return P

    lathe(mb, cen, prof, cs, wfn, rot=q, rmod=rmod, zmod=zmod)
    # glowing warts on the cap
    tp = top
    for k in range(spots):
        t = rng.uniform(0.12, 0.8)
        a = rng.uniform(0, 2 * pi)
        sz = rng.uniform(0.09, 0.22) * Rc / 2.7
        x = t * (len(tp) - 1)
        i0 = min(int(x), len(tp) - 2)
        f = x - i0
        r = lerp(tp[i0][0], tp[i0 + 1][0], f)
        z = lerp(tp[i0][1], tp[i0 + 1][1], f)
        dr = tp[i0 + 1][0] - tp[i0][0]
        dz = tp[i0 + 1][1] - tp[i0][1]
        ii = nu + i0
        rr = r / Rc
        r *= 1 + rib_amp * cos(ribs * a + rph2) * rr ** 3
        z += rib_amp * 0.9 * Rc * cos(ribs * a + rph2) * rr * (1 - rr) * 1.5 + wave * sin(5 * a + rph) * rr ** 2
        nl = Vector((dz, -dr)).normalized()
        lp = Vector((cos(a) * r, sin(a) * r, z))
        ln_ = Vector((cos(a) * nl.x, sin(a) * nl.x, nl.y))
        wp = cen + q @ lp
        wn = (q @ ln_).normalized()
        lathe(mb, wp - wn * 0.03, [(sz, -0.02), (sz * 0.78, sz * 0.28), (sz * 0.4, sz * 0.45), (0, sz * 0.5)],
              c.r(7, 3), A, rot=rot_to(wn))
    if ring:
        u0 = 0.66
        rp = spline(ctrl, [u0 - 0.02, u0, u0 + 0.02])
        rt2 = (rp[2] - rp[0]).normalized()
        ri = int(u0 * (n - 1))
        rr0 = lerp(radii[ri], radii[min(ri + 1, n - 1)], u0 * (n - 1) - ri)
        Ls = 0.45 * sc
        rprof = [(rr0 * 0.9, -0.02), (rr0 + 0.18 * Ls, -0.35 * Ls), (rr0 + 0.42 * Ls, -0.85 * Ls),
                 (rr0 + 0.5 * Ls, -1.0 * Ls), (rr0 + 0.47 * Ls, -0.88 * Ls), (rr0 + 0.25 * Ls, -0.3 * Ls),
                 (rr0 * 0.9, 0.06)]
        lathe(mb, rp[1], rprof, c.r(22, 6), S, rot=rot_to(rt2),
              rmod=lambda i, u, a: 1 + 0.07 * sin(9 * a) * sin(pi * u),
              zmod=lambda i, u, a: 0.14 * Ls * sin(9 * a) * sin(pi * u) ** 2)
    return pts[-1]


def build_mushroom(c):
    mb = MB()
    v = c.v
    O = Vector((0, 0, 0))
    if v == 0:
        mushroom(c, mb, O, 4.6, 0.42, 2.7, 'dome', 14, 0.035, 16, True, 0.5)
    elif v == 1:
        mushroom(c, mb, O, 6.3, 0.34, 1.9, 'bell', 16, 0.07, 0, True, 0.9)
    else:
        mushroom(c, mb, O, 3.6, 0.5, 3.1, 'flat', 20, 0.05, 7, False, 0.35)
        mushroom(c, mb, Vector((1.7, 0.9, 0)), 1.2, 0.13, 0.62, 'dome', 10, 0.03, 0, False, 0.15, small=True)
        mushroom(c, mb, Vector((-1.1, 1.5, 0)), 0.75, 0.09, 0.4, 'bell', 10, 0.04, 0, False, 0.1, small=True)
    return mb, dict(ao=2.6, gd=12.0)


def build_spiral(c):
    rng = c.rng
    mb = MB()
    v = c.v
    if v == 0:
        H = 6.6
        turns = 1.6
        ph0 = rng.uniform(0, 2 * pi)
        N = c.r(34, 12)
        tops = []
        for k in range(2):
            pts, radii = [], []
            for i in range(N):
                s = i / (N - 1)
                ang = ph0 + k * pi + turns * 2 * pi * s
                rh = 0.8 * (1 - s) ** 0.8 + 0.16
                z = -0.35 + s * (H + 0.35)
                pts.append(Vector((cos(ang) * rh, sin(ang) * rh, z)))
                radii.append(0.27 * (1 - 0.62 * s) * (1 + 0.7 * exp(-max(z, 0) / 0.45)))
            # scroll curl continuing from the strand top
            dtop = Vector((pts[-1].x, pts[-1].y, 0)).normalized()
            curl = crozier(pts[-1], dtop, (pts[-1] - pts[-2]).normalized() * 0.4 + UP, 0.85, turns=1.75,
                           n=c.r(16, 6), decay=0.32)
            r_end = radii[-1]
            cr = [r_end * (1 - 0.7 * (i / (len(curl) - 1))) for i in range(len(curl))]
            allp = pts + curl[1:]
            allr = radii + cr[1:]
            ns = len(pts)

            def wf(u, a, ns=ns, tot=len(allp)):
                return S if u < 0.78 else mixw(mixw(S, P, 0.6), A, smoothstep(0.86, 1.0, u))

            tube(mb, allp, allr, c.r(8, 5), wf, end='dome', start='cap',
                 rfn=lambda u, a, p: 1 + 0.06 * cos(4 * a + 9 * u))
            tops.append(allp[-1])
            # leaves along the strand
            for li in range(6):
                s = 0.22 + li * 0.11 + rng.uniform(-0.03, 0.03)
                ii = int(s * (N - 1))
                bp = pts[ii]
                out = Vector((bp.x, bp.y, 0)).normalized()
                laz = atan2(out.y, out.x) + rng.uniform(-0.5, 0.5)
                lel = rng.uniform(0.1, 0.6)
                d0 = sph(laz, lel)
                sd = Vector((-sin(laz), cos(laz), 0))
                nl = c.r(5, 3)
                lp, lt = arc_path(bp + d0 * radii[ii] * 0.6, d0, rng.uniform(0.55, 0.8), rng.uniform(0.6, 1.2), nl,
                                  side=sd)
                wl = rng.uniform(0.2, 0.28)
                blade(mb, lp, lt, sd, [wl * sin(pi * min(1, (i / (nl - 1)) * 1.1)) ** 0.8 for i in range(nl)],
                      [0.02] * nl, P, ring=4, fold=0.2)
        for tp in tops:
            ball(mb, tp, 0.2, c.r(8, 5), c.r(6, 3), A)
        # glow orbs nestled where the strands cross
        for k in range(3):
            s = 0.3 + 0.2 * k
            ang = ph0 + turns * 2 * pi * s + pi * 0.5
            rh = 0.8 * (1 - s) ** 0.8 + 0.16
            ball(mb, Vector((cos(ang) * rh * 0.3, sin(ang) * rh * 0.3, s * H)), 0.16, c.r(7, 4), c.r(5, 3), A)
        return mb, dict(ao=2.0, gd=12.0)
    # v == 1: corkscrew: three-lobed trunk twisted ~2.5 turns, crown of curling tendrils
    H = 7.0
    T = 2.4
    j = [rand_dir(rng, -0.15, 0.15) for _ in range(3)]
    ctrl = [Vector((0, 0, -0.4)), Vector((0, 0, 1.8)) + j[0] * 0.5, Vector((0, 0, 4.2)) + j[1] * 0.9,
            Vector((0, 0, H)) + j[2] * 0.7]
    N = c.r(46, 14)
    us = lin(N)
    pts = spline(ctrl, us)
    radii = [(0.42 * (1 - u) ** 0.9 + 0.08) * (1 + 0.5 * exp(-max(pts[i].z, 0) / 0.5)) for i, u in enumerate(us)]
    lobe = 0.38 if c.lod == 0 else 0.25

    def rf(u, a, p):
        return 1 + lobe * cos(3 * (a - 2 * pi * T * u))

    def wf(u, a):
        return mixw(S, P, (0.5 + 0.5 * cos(3 * (a - 2 * pi * T * u))) ** 2)

    tube(mb, pts, radii, c.r(15, 6), wf, rfn=rf, end='dome', start='cap')
    topp = pts[-1]
    ball(mb, topp + Vector((0, 0, 0.2)), 0.36, c.r(10, 6), c.r(7, 4), A, jitter=0.12, seed=c.seed)
    ui = int(0.86 * (N - 1))
    for k in range(5):
        taz = 2 * pi * k / 5 + rng.uniform(-0.3, 0.3)
        d = Vector((cos(taz), sin(taz), 0))
        bp = pts[ui] + d * radii[ui] * 0.5
        cp = crozier(bp, d, UP + d * 0.3, rng.uniform(0.45, 0.65), turns=rng.uniform(1.6, 2.0), n=c.r(15, 6),
                     decay=0.28)
        cr = [0.1 * (1 - 0.75 * i / (len(cp) - 1)) for i in range(len(cp))]
        tube(mb, cp, cr, c.r(6, 4), lambda u, a: mixw(P, A, smoothstep(0.65, 1.0, u)), end='dome')
    # thorny side spurs along the ridges
    for k in range(6):
        u = 0.25 + 0.1 * k
        ii = int(u * (N - 1))
        a = 2 * pi * T * u + rng.choice((0, 2 * pi / 3, 4 * pi / 3))
        t_, nr_, bn_ = path_frames(pts)[ii]
        dirv = (nr_ * cos(a) + bn_ * sin(a)).normalized()
        bp = pts[ii] + dirv * radii[ii] * (1 + lobe) * 0.8
        sp = [bp, bp + (dirv + UP * 0.6).normalized() * 0.4, bp + (dirv * 0.6 + UP).normalized() * 0.75]
        tube(mb, spline(sp, lin(c.r(5, 3))), [0.07, 0.05, 0.035, 0.025, 0.015][:c.r(5, 3)] if c.lod == 0 else [0.07, 0.04, 0.015],
             c.r(5, 3), lambda u, a: mixw(P, A, smoothstep(0.5, 1.0, u)), end='point')
    return mb, dict(ao=2.0, gd=12.0)


def build_coral(c):
    rng = c.rng
    mb = MB()
    v = c.v
    seedf = c.seed * 0.13
    sides_l = c.r([9, 7, 6, 5], [5, 4, 3, 3])
    rings_l = c.r([8, 7, 6, 6], [3, 3, 3, 3])
    maxd = 3 if v == 0 else 2
    cups = []

    def grow(p, d, length, r, depth):
        up_pull = 0.55 if v == 0 else 0.5
        dj = rand_dir(rng) * 0.15
        d1 = (d + dj).normalized()
        d2 = (d1 + UP * up_pull).normalized()
        ctrl = [p - d * (r * 0.5), p + d1 * (length * 0.4), p + d1 * (length * 0.55) + d2 * (length * 0.45)]
        n = rings_l[depth]
        pts = spline(ctrl, lin(n))
        rend = r * ((0.62 if depth < maxd else 0.55) if v == 1 else (0.8 if depth < maxd else 0.7))
        radii = [lerp(r, rend, u) for u in lin(n)]
        terminal = depth == maxd
        if depth == 0:
            fl = 0.7

            def rfn(u, a, pp):
                return 1 + fl * exp(-max(pp.z, 0) / 0.4) * (0.3 + 0.7 * max(0, cos(4 * a)) ** 2) \
                    + 0.08 * nz(pp * 3.0, seedf)
        else:
            def rfn(u, a, pp):
                return 1 + 0.09 * nz(pp * 3.0, seedf)
        if terminal and v == 0:
            def wf(u, a):
                return mixw(P, A, smoothstep(0.55, 1.0, u))
        elif depth == 0:
            def wf(u, a):
                return mixw(S, P, smoothstep(0.4, 1.0, u) * 0.5)
        else:
            def wf(u, a):
                return mixw(mixw(S, P, 0.5), P, u) if depth == 1 else P
        tube(mb, pts, radii, sides_l[depth], wf, rfn=rfn, end='dome', start='cap' if depth == 0 else None)
        tip = pts[-1]
        tdir = (pts[-1] - pts[-2]).normalized()
        if terminal:
            if v == 1:
                cups.append((tip, tdir, rend, rng.uniform(0.38, 0.6)))
            return
        kids = 3 if depth == 0 else rng.choice((2, 2, 3))
        if v == 1 and depth == 1:
            kids = rng.choice((1, 2))
        base_az = rng.uniform(0, 2 * pi)
        for kk in range(kids):
            u0 = rng.uniform(0.45, 0.85)
            az = base_az + 2 * pi * kk / kids + rng.uniform(-0.4, 0.4)
            tilt = rng.uniform(0.35, 0.75) if (v == 1 or depth == 0) else rng.uniform(0.3, 0.6)
            lr = rng.uniform(0.62, 0.8) if v == 1 else rng.uniform(0.7, 0.85)
            rr_ = rng.uniform(0.6, 0.7) if v == 1 else rng.uniform(0.74, 0.84)
            side = Vector((cos(az), sin(az), 0))
            if kk == 0:  # leader continues smoothly from the tip
                sp = tip - tdir * (rend * 0.3)
                tilt *= 0.45
                rch = rend
            else:
                sp = spline(ctrl, [u0])[0]
                rch = min(r * rr_, lerp(r, rend, u0) * 0.85)
            nd = (tdir * cos(tilt) + side * sin(tilt)).normalized()
            grow(sp, nd, length * lr, rch, depth + 1)

    if v == 0:
        grow(Vector((0, 0, -0.35)), UP, 2.4, 0.46, 0)
    else:
        grow(Vector((0, 0, -0.35)), UP, 2.6, 0.38, 0)
    for (tip, tdir, rb, Rcup) in cups:
        q = rot_to(tdir)
        cprof = [(rb * 0.85, -0.12), (rb * 1.05, 0.12), (Rcup * 0.5, 0.42 * Rcup / 0.5), (Rcup * 0.9, 0.7 * Rcup / 0.5),
                 (Rcup, 0.78 * Rcup / 0.5), (Rcup * 0.94, 0.84 * Rcup / 0.5), (Rcup * 0.8, 0.76 * Rcup / 0.5),
                 (Rcup * 0.42, 0.5 * Rcup / 0.5), (0, 0.34 * Rcup / 0.5)]
        ph = rng.uniform(0, 2 * pi)

        def cw(i, u, a):
            return [mixw(P, S, 0.3), P, P, P, mixw(P, A, 0.4), mixw(P, A, 0.7), A, A, A][i]

        lathe(mb, tip, cprof, c.r(16, 5), cw, rot=q,
              rmod=lambda i, u, a, ph=ph: 1 + (0.08 * cos(5 * a + ph) if 3 <= i <= 6 else 0),
              zmod=lambda i, u, a, ph=ph: (0.07 * sin(5 * a + ph) if 3 <= i <= 6 else 0))
    return mb, dict(ao=2.2, gd=12.0)


def meta_dom(p, elems):
    best, bf = None, -1.0
    for e in elems:
        R = e['r'] / MBK
        d2 = (p - e['co']).length_squared / (R * R)
        f = (1 - d2) ** 3 if d2 < 1 else 0.0
        if f > bf:
            bf, best = f, e
    return best


def build_blob(c):
    rng = c.rng
    mb = MB()
    v = c.v
    elems = []

    def chain(p0, p1, r0, r1, w, n=None):
        L = (p1 - p0).length
        n = n or max(2, int(L / (min(r0, r1) * 0.55)) + 1)
        for i in range(n):
            f = i / (n - 1)
            elems.append({'co': p0.lerp(p1, f), 'r': lerp(r0, r1, f), 'w': w})

    extra_mb = MB()
    if v == 0:  # balloon tree: bottle trunk, arms ending in ribbed balloons dotted with glowing nodules
        for k in range(5):
            a = 2 * pi * k / 5 + rng.uniform(-0.3, 0.3)
            elems.append({'co': Vector((cos(a) * 0.62, sin(a) * 0.62, 0.05)), 'r': 0.42, 'w': S})
        lean = rand_dir(rng, 0, 0) * 0.35
        spine = [Vector((0, 0, 0.2)), Vector((0, 0, 1.3)) + lean * 0.4, Vector((0, 0, 2.4)) + lean * 0.8,
                 Vector((0, 0, 3.3)) + lean]
        rads = [0.75, 0.95, 0.62, 0.46]
        for i in range(3):
            chain(spine[i], spine[i + 1], rads[i], rads[i + 1], S)
        topc = spine[-1]
        phi = rng.uniform(0, 2 * pi)
        for k in range(3):
            a = phi + 2 * pi * k / 3 + rng.uniform(-0.25, 0.25)
            el = rng.uniform(0.45, 0.8)
            ln = rng.uniform(1.9, 2.4)
            end = topc + sph(a, el) * ln
            chain(topc, end, 0.36, 0.24, S)
            Rb = rng.uniform(0.95, 1.2)
            bc = end + Vector((0, 0, Rb * 0.8))
            elems.append({'co': bc, 'r': Rb, 'w': P, 'rib': (8, 0.07 * Rb, bc)})
            elems.append({'co': bc + Vector((0, 0, Rb * 0.4)), 'r': Rb * 0.82, 'w': P, 'rib': (8, 0.07 * Rb, bc)})
            for m in range(6):
                d = rand_dir(rng, -0.5, 0.85)
                elems.append({'co': bc + d * (Rb * 1.02), 'r': Rb * rng.uniform(0.17, 0.23), 'w': A})
        # central smaller balloon on top
        Rb = 0.8
        bc = topc + Vector((0, 0, 1.6))
        chain(topc, bc, 0.36, 0.25, S)
        elems.append({'co': bc + Vector((0, 0, 0.3)), 'r': Rb, 'w': P, 'rib': (8, 0.07 * Rb, bc)})
        res = 0.07
    else:  # stacked gourd column with pinched necks, hanging glow sacs, curling tendrils
        zc = 0.0
        sizes = [1.1, 0.92, 0.75, 0.58, 0.42]
        cent = []
        off = Vector((0, 0, 0))
        prev = None
        for i, R in enumerate(sizes):
            off = off + rand_dir(rng, 0, 0) * 0.15
            zc += R * 0.9 if i == 0 else (prev[1] + R) * 1.02
            cc = Vector((off.x, off.y, zc))
            w = mixw(S, P, min(1.0, i / 2.5))
            elems.append({'co': cc, 'r': R, 'w': w, 'rib': (7, 0.06 * R, cc)})
            if prev is not None:
                elems.append({'co': prev[0].lerp(cc, prev[1] / (prev[1] + R)), 'r': min(R, prev[1]) * 0.45, 'w': w})
            prev = (cc, R)
            cent.append((cc, R))
        for k in range(4):
            a = 2 * pi * k / 4 + rng.uniform(-0.4, 0.4)
            elems.append({'co': Vector((cos(a) * 0.85, sin(a) * 0.85, 0.08)), 'r': 0.36, 'w': S})
        res = 0.06
        # hanging sacs on arching stalks and tendrils at the crown (tubes: too thin for metaballs)
        for k in range(5):
            cc, R = cent[k % 3 + (1 if k > 2 else 0)]
            a = rng.uniform(0, 2 * pi)
            d = Vector((cos(a), sin(a), 0))
            sp = cc + d * (R * 0.9) + Vector((0, 0, R * 0.15))
            dl = rng.uniform(0.45, 0.8)
            mid = sp + d * 0.38 + Vector((0, 0, 0.12))
            endp = mid + d * 0.12 - Vector((0, 0, dl))
            stem = spline([sp - d * 0.1, mid, endp], lin(c.r(6, 3)))
            tube(extra_mb, stem, [0.055 * (1 - 0.3 * u) for u in lin(len(stem))], c.r(5, 3), S, end='cap')
            ball(extra_mb, endp - Vector((0, 0, 0.2)), 0.22, c.r(9, 5), c.r(7, 4), A, scale=(1, 1, 1.35),
                 jitter=0.08, seed=k)
        cc, R = cent[-1]
        for k in range(4):
            a = 2 * pi * k / 4 + rng.uniform(-0.3, 0.3)
            d = Vector((cos(a), sin(a), 0))
            bp = cc + d * (R * 0.4) + Vector((0, 0, R * 0.7))
            cp = crozier(bp, d, UP, rng.uniform(0.35, 0.5), turns=1.8, n=c.r(14, 6), decay=0.3)
            tube(extra_mb, cp, [0.1 * (1 - 0.75 * i / (len(cp) - 1)) for i in range(len(cp))], c.r(6, 4),
                 lambda u, a: mixw(P, A, smoothstep(0.6, 1.0, u)), end='dome')
    verts, norms, faces = meta_mesh(elems, res)
    sd = c.seed * 0.71
    nv = []
    for p, n in zip(verts, norms):
        w = meta_w(p, elems)
        dd = 0.04 * fbm(p * 1.4, sd, 2) + 0.035 * cos(9 * atan2(p.y, p.x)) * w[1]
        e = meta_dom(p, elems)
        if e is not None and 'rib' in e:
            cnt, amp, ctr = e['rib']
            q = p - ctr
            hz = sqrt(q.x * q.x + q.y * q.y)
            fall = hz / max(q.length, 1e-6)
            dd += amp * (abs(cos(cnt * 0.5 * atan2(q.y, q.x))) * 2 - 1.2) * fall * w[0]
        nv.append(p + n * dd)
    tgt = c.target('blob', c.budget - extra_mb.tris() - 30)
    nv, faces = decimate(nv, faces, tgt)
    mb.add(nv, faces, lambda p: meta_w(p, elems))
    off = len(mb.v)
    mb.v += extra_mb.v
    mb.w += extra_mb.w
    for f, a, fw in zip(extra_mb.f, extra_mb.fa, extra_mb.fw):
        mb.face([off + i for i in f], a, fw)
    return mb, dict(ao=2.2, gd=12.0)


# =====================================================================================
# CACTUS / BUSH / FERN / RESOURCE PLANTS / GRASS
# =====================================================================================
def small_flower(c, mb, p, d, r, petals=5):
    q = rot_to(d)
    lathe(mb, p, [(r * 0.35, -0.04), (r * 0.6, r * 0.3), (r, r * 0.65), (r * 0.5, r * 0.5), (0, r * 0.35)],
          c.r(petals * 2, petals), lambda i, u, a: A if i >= 2 else mixw(P, A, 0.5), rot=q,
          rmod=lambda i, u, a: 1 + (0.3 * cos(petals * a) if i == 2 else 0))


def build_cactus(c):
    rng = c.rng
    mb = MB()
    v = c.v
    if v == 0:  # saguaro with ribbed column and elbowed arms
        H = 3.5
        j = rand_dir(rng, 0, 0) * 0.12
        ctrl = [Vector((0, 0, -0.3)), Vector((0, 0, H * 0.4)), Vector((0, 0, H * 0.75)) + j * 0.5, Vector((0, 0, H)) + j]
        n = c.r(12, 5)
        pts = spline(ctrl, lin(n))
        radii = [0.32 * (1 - 0.15 * u) for u in lin(n)]
        ribs = 9
        tube(mb, pts, radii, c.r(18, 8), P, end='dome', start='cap', ang=0.75,
             rfn=(lambda u, a, p: 1 + 0.1 * cos(ribs * a)) if c.lod == 0 else None)
        small_flower(c, mb, pts[-1] + Vector((0, 0, 0.28)), UP, 0.12)
        phi = rng.uniform(0, 2 * pi)
        arms = [(1.15, 1.25, 0.21), (1.75, 0.95, 0.19), (2.3, 0.6, 0.15)]
        for k, (z, up, ra) in enumerate(arms):
            a = phi + k * 2.3 + rng.uniform(-0.3, 0.3)
            d = Vector((cos(a), sin(a), 0))
            base = point_at_height(pts, z)
            out = rng.uniform(0.45, 0.6)
            actrl = [base, base + d * (out * 0.75) + Vector((0, 0, 0.04)), base + d * out + Vector((0, 0, 0.32)),
                     base + d * (out + 0.03) + Vector((0, 0, up * 0.7)), base + d * (out - 0.02) + Vector((0, 0, up))]
            na = c.r(10, 4) if k < 2 else c.r(7, 3)
            ap = spline(actrl, lin(na))
            tube(mb, ap, [ra * (1 - 0.12 * u) for u in lin(na)], c.r(14, 6), P, end='dome', ang=0.75,
                 rfn=(lambda u, a, p: 1 + 0.1 * cos(7 * a)) if c.lod == 0 else None)
            if k < 2:
                small_flower(c, mb, ap[-1] + Vector((0, 0, ra * 0.85)), UP, 0.09)
        return mb, dict(ao=1.5, gd=8.0)
    # prickly pear: flat pads budding off each other's rims, fruit on the top pads
    pads = []
    tr = spline([Vector((0, 0, -0.2)), Vector((0, 0, 0.2)), Vector((0.05, 0, 0.45))], lin(c.r(4, 3)))
    tube(mb, tr, [0.13, 0.11, 0.1, 0.09][:len(tr)] if c.lod == 0 else [0.13, 0.1, 0.09], c.r(7, 4), S, end='cap')
    fruits = []

    def pad(base, d, side, size, level):
        h = size
        wdt = size * 0.8
        th = 0.075 + 0.02 * size
        q = Quaternion(d, rng.uniform(-0.4, 0.4))
        sd = q @ side
        nrm = d.cross(sd).normalized()
        M = Matrix((sd * wdt, nrm * th, d * h * 0.5)).transposed()
        cen = base + d * (h * 0.48)
        i0 = len(mb.v)
        ball(mb, Vector((0, 0, 0)), 1.0, c.r(9, 5), c.r(6, 3), mixw(S, P, min(1, 0.45 + level * 0.3)),
             jitter=0.06, seed=level + size)
        mb.xform(i0, lambda p: cen + M @ p)
        pads.append(cen)
        if level >= 2:
            for k in range(rng.choice((1, 2, 3))):
                t = rng.uniform(-0.7, 0.7)
                fp = cen + d * (h * 0.47 * cos(t * 0.9)) + sd * (wdt * 0.5 * sin(t))
                fruits.append((fp, d))
            return
        kids = rng.choice((1, 2)) if level else 2
        for k in range(kids):
            t = rng.uniform(-0.75, 0.75)
            tilt = t * 0.9 + rng.uniform(-0.2, 0.2)
            nb = cen + d * (h * 0.44 * cos(t)) + sd * (wdt * 0.46 * sin(t))
            nd = (d * cos(tilt) + sd * sin(tilt)).normalized()
            nd = (nd + UP * 0.25).normalized()
            twist = Quaternion(nd, rng.uniform(-0.9, 0.9))
            pad(nb, nd, twist @ sd, size * rng.uniform(0.78, 0.92), level + 1)

    a0 = rng.uniform(0, 2 * pi)
    for k in range(2):
        a = a0 + k * pi + rng.uniform(-0.3, 0.3)
        d = (UP + Vector((cos(a), sin(a), 0)) * 0.35).normalized()
        pad(Vector((0, 0, 0.35)), d, Vector((-sin(a), cos(a), 0)), 0.92 * (1 - 0.1 * k), 0)
    for fp, d in fruits:
        ball(mb, fp + d * 0.06, 0.08, c.r(5, 3), c.r(3, 2), A, scale=(1, 1, 1.35), rot=rot_to(d))
    return mb, dict(ao=1.2, gd=6.0)


def leaf_rosette(c, mb, n, center, el0, el1, len0, len1, wid, thick, bend0, bend1, w, fold=0.2, segs=(6, 3),
                 ring=(4, 3), golden=True, prof=None, radius0=0.04):
    rng = c.rng
    for i in range(n):
        f = i / max(1, n - 1)
        az = i * 2.39996 + rng.uniform(-0.15, 0.15) if golden else 2 * pi * i / n + rng.uniform(-0.2, 0.2)
        el = lerp(el0, el1, f) + rng.uniform(-0.1, 0.1)
        ln = lerp(len0, len1, f) * rng.uniform(0.88, 1.1)
        bend = lerp(bend0, bend1, f) * rng.uniform(0.8, 1.2)
        d0 = sph(az, el)
        sd = Vector((-sin(az), cos(az), 0))
        ns = c.r(*segs) + 1
        lp, lt = arc_path(center + Vector((cos(az), sin(az), 0)) * radius0, d0, ln, bend, ns, power=1.6, side=sd)
        prof_ = prof or (lambda s: sin(pi * min(1.0, 0.12 + s * 0.95)) ** 0.7)
        widths = [wid * prof_(k / (ns - 1)) for k in range(ns)]
        th = [thick * (1 - 0.8 * k / (ns - 1)) for k in range(ns)]
        blade(mb, lp, lt, sd, widths, th, w, ring=c.r(*ring), fold=fold)


def build_bush(c):
    rng = c.rng
    mb = MB()
    v = c.v
    if v == 1:  # spiky succulent rosette with glowing tips and a flower spike
        leaf_rosette(c, mb, 19, Vector((0, 0, 0.02)), 1.3, 0.22, 0.65, 1.05, 0.27, 0.07, 0.05, 0.8,
                     lambda s: mixw(P, A, smoothstep(0.72, 1.0, s)), fold=0.28,
                     prof=lambda s: (1 - s) ** 0.75 * (0.55 + 0.45 * sin(pi * min(1, s * 1.6))), segs=(6, 2))
        sp = spline([Vector((0, 0, 0)), Vector((0.03, 0, 0.8)), Vector((0.1, 0.05, 1.75))], lin(c.r(7, 3)))
        tube(mb, sp, [0.045 * (1 - 0.6 * u) for u in lin(len(sp))], c.r(5, 3), S, end='cap')
        for k in range(6):
            u = 0.55 + 0.08 * k
            bp = spline([Vector((0, 0, 0)), Vector((0.03, 0, 0.8)), Vector((0.1, 0.05, 1.75))], [u])[0]
            a = k * 2.4
            ball(mb, bp + Vector((cos(a) * 0.05, sin(a) * 0.05, 0)), 0.06, c.r(6, 4), c.r(4, 3), A,
                 scale=(1, 1, 1.4))
        return mb, dict(ao=0.8, gd=4.0)
    if v == 0:  # rounded leafy shrub: clumpy foliage over a few woody stems, berries
        cores = []
        for k in range(4):
            a = 2 * pi * k / 4 + rng.uniform(-0.4, 0.4)
            rr = rng.uniform(0.25, 0.4)
            cores.append((Vector((cos(a) * rr, sin(a) * rr, rng.uniform(0.72, 0.88))), rng.uniform(0.42, 0.5)))
        for (cc, R) in cores:
            sp = spline([Vector((0, 0, -0.1)), cc * 0.5 + Vector((0, 0, 0.05)), cc - Vector((0, 0, R * 0.3))],
                        lin(c.r(5, 3)))
            tube(mb, sp, [0.05 * (1 - 0.55 * u) for u in lin(len(sp))], c.r(5, 3), S, end='cap')
        elems = []
        for (cc, R) in cores:
            elems.append({'co': cc, 'r': R, 'w': P})
        lumps = []
        for k in range(26):
            cc, R = cores[k % 4]
            d = rand_dir(rng, -0.35, 1.0)
            pos = cc + d * (R * 0.78)
            rr = rng.uniform(0.2, 0.28)
            elems.append({'co': pos, 'r': rr, 'w': P})
            lumps.append((pos, d, rr))
        berries = []
        for k in range(12):
            pos, d, rr = lumps[rng.randrange(len(lumps))]
            dd = (d + rand_dir(rng) * 0.5).normalized()
            berries.append(pos + dd * (rr * 1.1))
        for bp in berries:
            ball(mb, bp, 0.06, c.r(5, 3), c.r(4, 2), A)
        verts, norms, faces = meta_mesh(elems, 0.04)
        verts = [p + n * (0.03 * fbm(p * 3.0, c.seed, 2) + 0.1 * clump_disp(p, 0.3, c.seed)) for p, n in zip(verts, norms)]
        verts = laplace(verts, faces, 1, 0.5)
        nleaf = 560
        verts, faces = decimate(verts, faces, c.target('fol', max(300, c.budget - mb.tris() - 20 - nleaf * 3)))
        vb = len(mb.v)
        mb.add(verts, faces, P)
        leaf_shell(c, mb, verts, faces, vb, nleaf, 0.2)
        return mb, dict(ao=0.9, gd=4.0)
    # v == 2: open flowering shrub: branching woody stems, leaf clumps, glowing flower heads
    elems = []
    heads = []
    for k in range(6):
        a = 2 * pi * k / 6 + rng.uniform(-0.3, 0.3)
        el = rng.uniform(0.95, 1.3)
        ln = rng.uniform(1.0, 1.45)
        d = sph(a, el)
        mid = d * (ln * 0.5) + Vector((0, 0, 0.05))
        end = d * ln
        sp = spline([Vector((0, 0, -0.08)), mid, end], lin(c.r(6, 3)))
        tube(mb, sp, [0.04 * (1 - 0.6 * u) for u in lin(len(sp))], c.r(5, 3), S, end='cap')
        R = rng.uniform(0.24, 0.32)
        elems.append({'co': end, 'r': R, 'w': P})
        elems.append({'co': end.lerp(mid, 0.35) + rand_dir(rng) * 0.08, 'r': R * 0.75, 'w': P})
        for m in range(3):
            dd = rand_dir(rng, -0.2, 1.0)
            elems.append({'co': end + dd * (R * 0.7), 'r': R * 0.5, 'w': P})
        hd = rand_dir(rng, 0.3, 1.0)
        heads.append((end + hd * (R * 0.85), hd))
    for hp, hd in heads:
        ball(mb, hp, 0.13, c.r(8, 5), c.r(5, 3), A, scale=(1, 1, 0.7), rot=rot_to(hd), jitter=0.15, seed=hp.x)
    verts, norms, faces = meta_mesh(elems, 0.04)
    verts = [p + n * (0.03 * fbm(p * 3.2, c.seed, 2) + 0.08 * clump_disp(p, 0.26, c.seed)) for p, n in zip(verts, norms)]
    verts = laplace(verts, faces, 1, 0.5)
    nleaf = 380
    verts, faces = decimate(verts, faces, c.target('fol', max(300, c.budget - mb.tris() - 20 - nleaf * 3)))
    vb = len(mb.v)
    mb.add(verts, faces, P)
    leaf_shell(c, mb, verts, faces, vb, nleaf, 0.15)
    return mb, dict(ao=0.9, gd=4.0)


def fern_frond(c, mb, base, az, el, ln, bend, W, K, w, power=1.6, notch=0.22, fold=-0.15):
    d0 = sph(az, el)
    sd = Vector((-sin(az), cos(az), 0))
    fp, ft = arc_path(base, d0, ln, bend, K, power=power, side=sd)
    widths, thick, fwd = [], [], []
    for i in range(K):
        s = i / (K - 1)
        env = W * sin(pi * clamp((s - 0.1) / 0.9) ** 0.85) ** 0.8
        nt = c.lod == 0 and i % 2 == 1
        widths.append(env * (notch if nt else 1.0) + 0.01)
        thick.append(0.014 * (1 - s) + 0.004)
        fwd.append(0.0 if nt else 0.3 * ln / K)
    blade(mb, fp, ft, sd, widths, thick, w, ring=3, fold=fold, fwd=fwd)


def build_fern(c):
    rng = c.rng
    mb = MB()
    v = c.v
    if v == 0:
        nf = 8
        for k in range(nf):
            az = 2 * pi * k / nf + rng.uniform(-0.25, 0.25)
            fern_frond(c, mb, Vector((cos(az) * 0.04, sin(az) * 0.04, 0.0)), az, rng.uniform(1.0, 1.35),
                       rng.uniform(1.1, 1.35), rng.uniform(1.5, 2.1), 0.32, c.r(15, 5),
                       lambda s: mixw(S, P, smoothstep(0.0, 0.15, s)))
        cp = crozier(Vector((0.02, 0.0, 0.0)), Vector((1, 0.3, 0)), UP, 0.09, turns=2.0, n=c.r(11, 5), decay=0.25)
        cp = [Vector((0, 0, -0.02))] + [p + Vector((0, 0, 0.32)) for p in cp]
        tube(mb, cp, [0.018 * (1 - 0.5 * i / (len(cp) - 1)) for i in range(len(cp))], c.r(4, 3), P, end='dome')
        return mb, dict(ao=0.6, gd=3.0)
    # v == 1: alien strap fern: long undivided ruffled fronds whose tips roll into glowing scrolls
    nf = 7
    for k in range(nf):
        az = 2 * pi * k / nf + rng.uniform(-0.3, 0.3)
        el = rng.uniform(1.2, 1.45)
        ln = rng.uniform(1.2, 1.4)
        d0 = sph(az, el)
        sd = Vector((-sin(az), cos(az), 0))
        ns = c.r(13, 5)
        fp, ft = arc_path(Vector((cos(az) * 0.05, sin(az) * 0.05, 0.0)), d0, ln, rng.uniform(3.6, 4.4), ns,
                          power=3.0, side=sd)
        W = rng.uniform(0.17, 0.22)
        widths = [W * sin(pi * min(1.0, 0.06 + s * 0.98)) ** 0.55 * (1 - 0.55 * s) + 0.01 for s in lin(ns)]
        blade(mb, fp, ft, sd, widths, [0.02 * (1 - 0.6 * s) for s in lin(ns)],
              lambda s: mixw(mixw(S, P, smoothstep(0.0, 0.12, s)), A, smoothstep(0.72, 1.0, s)),
              ring=c.r(4, 3), fold=0.35 if c.lod == 0 else 0.0)
    for k in range(2):
        a = rng.uniform(0, 2 * pi)
        cp = crozier(Vector((cos(a) * 0.05, sin(a) * 0.05, 0.0)), Vector((cos(a), sin(a), 0)), UP, 0.08,
                     turns=2.0, n=c.r(10, 5), decay=0.25)
        cp = [Vector((cos(a) * 0.05, sin(a) * 0.05, -0.02))] + [p + Vector((0, 0, 0.42 + 0.15 * k)) for p in cp]
        tube(mb, cp, [0.02 * (1 - 0.5 * i / (len(cp) - 1)) for i in range(len(cp))], c.r(4, 3),
             lambda u, a: mixw(P, A, smoothstep(0.6, 1.0, u)), end='dome')
    return mb, dict(ao=0.6, gd=3.0)


def build_plant(c):
    rng = c.rng
    mb = MB()
    v = c.v
    if v == 0:  # glowing ribbed bulb on a stalk, broad basal leaves, cupping sepals, side buds
        leaf_rosette(c, mb, 6, Vector((0, 0, 0.0)), 0.75, 0.35, 0.5, 0.65, 0.17, 0.025, 0.5, 1.1, P, fold=0.3,
                     segs=(5, 2), golden=False)
        ctrl = [Vector((0, 0, -0.05)), Vector((0.04, 0.02, 0.4)), Vector((-0.03, 0.03, 0.75)), Vector((0, 0, 0.92))]
        sp = spline(ctrl, lin(c.r(9, 4)))
        tube(mb, sp, [0.035 * (1 - 0.3 * u) for u in lin(len(sp))], c.r(6, 4), S, end='cap')
        bc = sp[-1]
        bprof = [(0, -0.04), (0.1, 0.0), (0.2, 0.08), (0.25, 0.18), (0.24, 0.28), (0.19, 0.38), (0.11, 0.46),
                 (0.04, 0.52), (0, 0.56)]
        lathe(mb, bc + Vector((0, 0, 0.05)), bprof, c.r(24, 7), A, ang=1.0,
              rmod=lambda i, u, a: 1 + 0.16 * cos(6 * a) * sin(pi * u))
        for k in range(4):
            a = 2 * pi * k / 4 + 0.4
            d0 = sph(a, 0.9)
            sd = Vector((-sin(a), cos(a), 0))
            ns = c.r(4, 2) + 1
            lp, lt = arc_path(bc + Vector((cos(a), sin(a), 0)) * 0.03, sph(a, 0.55), 0.3, -0.6, ns, side=sd)
            blade(mb, lp, lt, sd, [0.13 * sin(pi * min(1, 0.15 + s * 0.9)) for s in lin(ns)], [0.012] * ns,
                  mixw(P, S, 0.5), ring=c.r(4, 3), fold=0.35 if c.lod == 0 else 0.0)
        for k in range(2):
            a = rng.uniform(0, 2 * pi)
            bs = spline(ctrl, [0.45 + 0.2 * k])[0]
            d = Vector((cos(a), sin(a), 0))
            bsp = spline([bs, bs + d * 0.12 + Vector((0, 0, 0.05)), bs + d * 0.18 + Vector((0, 0, 0.16))], lin(c.r(4, 3)))
            tube(mb, bsp, [0.018] * len(bsp), c.r(4, 3), S, end='cap')
            ball(mb, bsp[-1] + Vector((0, 0, 0.05)), 0.065, c.r(8, 5), c.r(5, 3), A, scale=(1, 1, 1.3))
        return mb, dict(ao=0.6, gd=3.0)
    # v == 1: resource flower with glowing petals
    ctrl = [Vector((0, 0, -0.05)), Vector((0.05, 0, 0.35)), Vector((0.02, 0.04, 0.7)), Vector((0.09, 0.02, 0.92))]
    sp = spline(ctrl, lin(c.r(9, 4)))
    tube(mb, sp, [0.03 * (1 - 0.3 * u) for u in lin(len(sp))], c.r(6, 4), S, end='cap')
    leaf_rosette(c, mb, 4, Vector((0, 0, 0)), 0.7, 0.3, 0.38, 0.48, 0.13, 0.02, 0.6, 1.0, P, fold=0.3, segs=(5, 2),
                 golden=False)
    for k in range(2):
        u = 0.35 + 0.22 * k
        bp = spline(ctrl, [u])[0]
        a = rng.uniform(0, 2 * pi)
        d0 = sph(a, 0.5)
        sd = Vector((-sin(a), cos(a), 0))
        ns = c.r(5, 2) + 1
        lp, lt = arc_path(bp, d0, 0.32, 0.8, ns, side=sd)
        blade(mb, lp, lt, sd, [0.1 * sin(pi * min(1, 0.1 + s * 0.95)) ** 0.7 for s in lin(ns)], [0.012] * ns, P,
              ring=c.r(4, 3), fold=0.3 if c.lod == 0 else 0.0)
    head = sp[-1]
    hd = (sp[-1] - sp[-2]).normalized()
    hd = (hd + UP).normalized()
    q = rot_to(hd)
    # receptacle + sepals
    lathe(mb, head, [(0.0, -0.06), (0.05, -0.04), (0.07, 0.02), (0.05, 0.05), (0, 0.06)], c.r(10, 5), mixw(S, P, 0.5),
          rot=q)
    npt = 7
    ph = rng.uniform(0, 2 * pi)
    for k in range(npt):
        a = ph + 2 * pi * k / npt
        loc = Vector((cos(a), sin(a), 0))
        dl = (q @ (loc * cos(0.55) + Vector((0, 0, sin(0.55))))).normalized()
        sd = (q @ Vector((-sin(a), cos(a), 0))).normalized()
        ns = c.r(6, 3)
        lp, lt = arc_path(head + q @ (loc * 0.04 + Vector((0, 0, 0.03))), dl, 0.3, -0.9, ns, power=1.3, side=sd)
        blade(mb, lp, lt, sd, [0.17 * sin(pi * min(1, 0.08 + s * 0.85)) ** 0.6 for s in lin(ns)],
              [0.016 * (1 - 0.7 * s) for s in lin(ns)], lambda s: mixw(mixw(P, A, 0.5), A, smoothstep(0.0, 0.4, s)),
              ring=c.r(4, 3), fold=0.35 if c.lod == 0 else 0.0)
    # glowing core with stamens
    lathe(mb, head + q @ Vector((0, 0, 0.04)), [(0.05, -0.01), (0.055, 0.03), (0.03, 0.06), (0, 0.065)],
          c.r(10, 5), A, rot=q)
    if c.lod == 0:
        for k in range(6):
            a = ph + 2 * pi * k / 6 + 0.3
            loc = Vector((cos(a) * 0.025, sin(a) * 0.025, 0.06))
            dd = (q @ (Vector((cos(a), sin(a), 0)) * 0.35 + UP)).normalized()
            p0 = head + q @ loc
            tube(mb, [p0, p0 + dd * 0.07, p0 + dd * 0.14], [0.006, 0.005, 0.004], 3, mixw(P, A, 0.5), end=None)
            ball(mb, p0 + dd * 0.15, 0.013, 5, 3, A)
    return mb, dict(ao=0.55, gd=3.0)


def build_grass(c):
    rng = c.rng
    mb = MB()
    v = c.v
    nb = 20 if v == 0 else 15
    hr = (0.22, 0.5) if v == 0 else (0.32, 0.62)
    for k in range(nb):
        a = rng.uniform(0, 2 * pi)
        r = sqrt(rng.uniform(0, 1)) * 0.2
        x, y = cos(a) * r, sin(a) * r
        h = rng.uniform(*hr)
        wb = rng.uniform(0.03, 0.05) if v == 0 else rng.uniform(0.04, 0.065)
        ba = rng.uniform(0, pi)
        tx, ty = cos(ba) * wb * 0.5, sin(ba) * wb * 0.5
        out = Vector((x, y, 0)).normalized() if r > 0.01 else Vector((cos(a), sin(a), 0))
        lean = out * rng.uniform(0.06, 0.2) + rand_dir(rng, 0, 0) * 0.05
        g = rng.uniform(0.0, 0.35)
        wbase = mixw(P, S, g + 0.25)
        wtop = mixw(P, S, g)
        mid = Vector((x, y, h * 0.5)) + lean * 0.35
        tip = Vector((x, y, h)) + lean * 1.0 - Vector((0, 0, 0.12 * lean.length))
        b0 = mb.vert((x - tx, y - ty, -0.02), wbase)
        b1 = mb.vert((x + tx, y + ty, -0.02), wbase)
        m0 = mb.vert(mid + Vector((-tx * 0.75, -ty * 0.75, 0)), wtop)
        m1 = mb.vert(mid + Vector((tx * 0.75, ty * 0.75, 0)), wtop)
        t = mb.vert(tip, wtop)
        mb.face((b0, b1, m1, m0))
        mb.face((m0, m1, t))
    if v == 1:  # seed stalks with glowing heads
        for k in range(3):
            a = 2 * pi * k / 3 + rng.uniform(-0.4, 0.4)
            r = rng.uniform(0.03, 0.12)
            x, y = cos(a) * r, sin(a) * r
            h = rng.uniform(0.72, 0.88)
            out = Vector((cos(a), sin(a), 0)) * rng.uniform(0.08, 0.16)
            ba = a + pi / 2
            tx, ty = cos(ba) * 0.006, sin(ba) * 0.006
            hx, hy = cos(ba) * 0.022, sin(ba) * 0.022
            st = Vector((x, y, h * 0.72)) + out * 0.6
            hb = Vector((x, y, h * 0.8)) + out * 0.75
            tip = Vector((x, y, h)) + out
            b0 = mb.vert((x - tx, y - ty, -0.02), mixw(P, S, 0.4))
            b1 = mb.vert((x + tx, y + ty, -0.02), mixw(P, S, 0.4))
            s0 = mb.vert(st + Vector((-tx, -ty, 0)), mixw(P, S, 0.2))
            s1 = mb.vert(st + Vector((tx, ty, 0)), mixw(P, S, 0.2))
            h0 = mb.vert(hb + Vector((-hx, -hy, 0)), A)
            h1 = mb.vert(hb + Vector((hx, hy, 0)), A)
            tt = mb.vert(tip, A)
            mb.face((b0, b1, s1, s0))
            mb.face((s0, s1, h1, h0))
            mb.face((h0, h1, tt))

    def aof(p):
        return clamp(0.32 + 0.68 * (max(p.z, 0) / 0.55) ** 0.8, 0.3, 1.0)

    return mb, dict(ao_fn=aof, up_normals=True)


# =====================================================================================
# MINERALS
# =====================================================================================
def mottled(seed, sw=0.45, freq=2.6):
    def w(p):
        s = smoothstep(-0.05, 0.4, fbm(p * freq, seed, 2)) * sw
        return mixw(P, S, s)

    return w


def build_rock(c):
    v = c.v
    mb = MB()
    tgt = c.target('rock', c.budget - 10)
    if v == 0:  # rounded river stone
        rv, rf = rock_mesh(c.seed, (0.34, 0.25, 0.17), planes=4, depth=(0.86, 0.95), amp=0.14, freq=0.9,
                           target=tgt, flat_bottom=0.6, sink=0.04)
        mb.add(rv, rf, mottled(c.seed, 0.4), ang=1.0)
    elif v == 1:  # angular chunk
        rv, rf = rock_mesh(c.seed, (0.42, 0.34, 0.33), planes=20, depth=(0.5, 0.86), amp=0.12, target=tgt,
                           flat_bottom=0.5, sink=0.06)
        mb.add(rv, rf, mottled(c.seed, 0.5), ang=FACET)
    elif v == 2:  # flat layered slab
        def strata(p):
            s = (p.z + 0.12 * p.x) / 0.085 + 0.3 * fbm(p * 2.0, 4.0, 2)
            f = s - math.floor(s)
            g = exp(-((min(f, 1 - f)) / 0.12) ** 2)
            h = Vector((p.x, p.y, 0))
            if h.length > 1e-6:
                p = p - h.normalized() * (0.028 * g)
            return p

        rv, rf = rock_mesh(c.seed, (0.52, 0.38, 0.19), planes=9, depth=(0.6, 0.9), amp=0.12, target=tgt,
                           flat_bottom=0.55, sink=0.04, post=strata, pz=(-0.3, 0.6))

        def w(p):
            s = (p.z + 0.12 * p.x) / 0.085 + 0.3 * fbm(p * 2.0, 4.0, 2)
            f = s - math.floor(s)
            g = exp(-((min(f, 1 - f)) / 0.14) ** 2)
            return mixw(P, S, 0.25 + 0.6 * g if int(math.floor(s)) % 2 else 0.6 * g)

        mb.add(rv, rf, w, ang=FACET)
    else:  # cluster of small stones
        each = tgt // 3
        for k, (dims, off) in enumerate([((0.19, 0.15, 0.12), (0, 0, 0)), ((0.13, 0.1, 0.09), (0.27, 0.1, 0)),
                                         ((0.1, 0.08, 0.07), (-0.08, 0.24, 0))]):
            rv, rf = rock_mesh(c.seed + k * 11, dims, planes=9, depth=(0.6, 0.92), amp=0.2, target=each,
                               flat_bottom=0.5, sink=0.03, subdiv=4)
            o = Vector(off)
            mb.add([p + o for p in rv], rf, mottled(c.seed + k, 0.45), ang=FACET)
    return mb, dict(ao=0.35, gd=2.0, cat='rock')


def build_boulder(c):
    v = c.v
    mb = MB()
    rng = c.rng
    tgt = c.target('rock', c.budget - 10)
    cfg = [dict(dims=(1.6, 1.3, 1.25), planes=18, depth=(0.62, 0.92), sp=0.34, gd=0.05, ledge=0.04, tilt=0.12,
                amp=0.14, crack=0),
           dict(dims=(1.15, 0.85, 2.05), planes=18, depth=(0.6, 0.9), sp=0.42, gd=0.07, ledge=0.07, tilt=0.18,
                amp=0.12, crack=0),
           dict(dims=(1.45, 1.2, 1.1), planes=15, depth=(0.62, 0.92), sp=0.3, gd=0.04, ledge=0.03, tilt=0.08,
                amp=0.14, crack=1)][v]
    dims = cfg['dims']
    so = c.seed * 0.31
    tl = cfg['tilt']
    ca = rng.uniform(0, pi)
    cn = Vector((cos(ca), sin(ca), 0))
    hashes = [rng.uniform(-1, 1) for _ in range(64)]

    def band(p):
        s = (p.z + tl * p.x) / cfg['sp'] + 0.2 * fbm(p * 0.7, so, 2)
        b = int(math.floor(s))
        f = s - b
        return s, b, f

    def post(p):
        s, b, f = band(p)
        g = exp(-((min(f, 1 - f)) / 0.1) ** 2)
        led = lerp(hashes[b % 64], hashes[(b + 1) % 64], smoothstep(0.82, 1.0, f))
        n = ell_normal(p, dims)
        side = sqrt(max(0.0, 1 - n.z * n.z))
        h = Vector((n.x, n.y, 0))
        if h.length > 1e-6:
            h.normalize()
            p = p + h * ((led * cfg['ledge'] - g * cfg['gd']) * side)
        if cfg['crack']:
            dd = p.dot(cn) + 0.12 * fbm(p * 0.9, so + 4, 2)
            cr = exp(-(dd / 0.09) ** 2)
            depth = 0.35 * smoothstep(-0.9, 0.6, p.z / dims[2])
            p = p - n * (cr * depth)
        return p

    rv, rf = rock_mesh(c.seed, dims, subdiv=6, planes=cfg['planes'], depth=cfg['depth'], amp=cfg['amp'], freq=0.85,
                       target=tgt, flat_bottom=0.55, sink=0.15, post=post)

    def w(p):
        q = Vector((p.x, p.y, p.z - 0.0))
        s, b, f = band(q)
        g = exp(-((min(f, 1 - f)) / 0.13) ** 2)
        base = 0.3 if (b % 3 == 1) else 0.0
        mott = smoothstep(0.0, 0.45, fbm(p * 1.3, so + 9, 2)) * 0.3
        sw = clamp(base + 0.65 * g + mott)
        if cfg['crack']:
            dd = p.dot(cn) + 0.12 * fbm(p * 0.9, so + 4, 2)
            sw = max(sw, exp(-(dd / 0.14) ** 2))
        return mixw(P, S, sw)

    mb.add(rv, rf, w, ang=FACET)
    return mb, dict(ao=1.1, gd=4.0, cat='rock')


def crystal_prism(c, mb, base, d, length, radius, rng, tip=1.6, flat=False, chamfer=True, embed=0.25,
                  wbody=P, wtip=A, glow=0.75, keep=True):
    q = rot_to(d)
    ph = rng.uniform(0, 2 * pi)
    rj = [1 + rng.uniform(-0.16, 0.16) for _ in range(6)]
    jit = [rng.uniform(-0.1, 0.1) for _ in range(6)]
    sides = 6 if (c.lod == 0 or radius >= 0.2) else (5 if radius >= 0.1 else 4)
    aj = [ph + 2 * pi * j / sides + jit[j] for j in range(sides)]
    aoff = Vector((rng.uniform(-0.28, 0.28), rng.uniform(-0.28, 0.28), 0)) * radius
    taper = rng.uniform(0.84, 0.97)
    tl = radius * tip * rng.uniform(0.8, 1.2)
    if not keep:
        return
    sh = length - tl

    def ring(z, s, o=None):
        o = o or Vector((0, 0, 0))
        return [base + q @ (Vector((cos(aj[j]) * radius * rj[j] * s, sin(aj[j]) * radius * rj[j] * s, z)) + o)
                for j in range(sides)]

    rings = [ring(-embed, 1.0)]
    ws = [wbody]
    if c.lod == 0:
        rings.append(ring(sh * 0.55, lerp(1.0, taper, 0.55)))
        ws.append(wbody)
    rings.append(ring(sh, taper))
    ws.append(mixw(wbody, wtip, glow * 0.3))
    if flat:
        if c.lod == 0:
            rings.append(ring(sh + tl * 0.45, taper * 0.7, aoff * 0.3))
            ws.append(mixw(wbody, wtip, glow * 0.7))
        rings.append(ring(length, taper * 0.42, aoff * 0.5))
        ws.append(mixw(wbody, wtip, glow))
        rings.append(base + q @ (Vector((0, 0, length)) + aoff * 0.5))
        ws.append(mixw(wbody, wtip, glow))
    else:
        if c.lod == 0 and chamfer:
            rings.append(ring(sh + tl * 0.2, taper * 0.8, aoff * 0.2))
            ws.append(mixw(wbody, wtip, glow * 0.55))
        rings.append(base + q @ (Vector((0, 0, length)) + aoff))
        ws.append(mixw(wbody, wtip, glow))
    loft(mb, rings, ws, ang=HARD)


def surface_z(bvh, x, y, default=0.0):
    hit = bvh.ray_cast(Vector((x, y, 50.0)), Vector((0, 0, -1)), 100.0)
    return hit[0].z if hit[0] is not None else default


def build_crystal(c):
    rng = c.rng
    mb = MB()
    v = c.v
    cfg = [dict(rock=(1.05, 0.95, 0.42), main=3.6, n=9, rad=(0.17, 0.3), mr=0.34, small=8, tilt=(0.25, 0.75),
                flat=False),
           dict(rock=(0.85, 0.75, 0.36), main=2.2, n=15, rad=(0.08, 0.15), mr=0.17, small=6, tilt=(0.08, 0.5),
                flat=False),
           dict(rock=(1.2, 1.05, 0.48), main=3.4, n=4, rad=(0.36, 0.48), mr=0.55, small=7, tilt=(0.2, 0.55),
                flat=True)][v]
    rv, rf = rock_mesh(c.seed * 7 + 1, cfg['rock'], subdiv=5, planes=10, depth=(0.62, 0.92), amp=0.25,
                       target=c.target('rock', 440), flat_bottom=0.5, sink=0.14)
    mb.add(rv, rf, S, ang=FACET)
    bvh = BVHTree.FromPolygons(rv, rf)
    rx, ry = cfg['rock'][0], cfg['rock'][1]
    # main crystal
    items = []
    items.append((Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0)), rng.uniform(0.02, 0.12),
                  rng.uniform(0, 2 * pi), cfg['main'], cfg['mr'], True))
    for i in range(cfg['n'] - 1):
        a = rng.uniform(0, 2 * pi)
        rr = sqrt(rng.uniform(0.04, 1.0)) * 0.55
        pos = Vector((cos(a) * rr * rx, sin(a) * rr * ry, 0))
        tilt = lerp(cfg['tilt'][0], cfg['tilt'][1], rr / 0.55) + rng.uniform(-0.1, 0.1)
        ln = cfg['main'] * rng.uniform(0.4, 0.82) * (1 - 0.35 * rr)
        rad = rng.uniform(*cfg['rad'])
        items.append((pos, tilt, a + rng.uniform(-0.4, 0.4), ln, rad, True))
    for i in range(cfg['small']):
        a = rng.uniform(0, 2 * pi)
        rr = rng.uniform(0.55, 0.85)
        pos = Vector((cos(a) * rr * rx, sin(a) * rr * ry, 0))
        ln = rng.uniform(0.3, 0.75)
        rad = rng.uniform(0.05, 0.1) * (1.6 if v == 2 else 1.0)
        items.append((pos, rng.uniform(0.6, 1.1), a + rng.uniform(-0.3, 0.3), ln, rad, c.lod == 0 or ln > 0.55))
    for (pos, tilt, az, ln, rad, keep) in items:
        z = surface_z(bvh, pos.x, pos.y, 0.0)
        d = sph(az, pi / 2 - tilt)
        crystal_prism(c, mb, Vector((pos.x, pos.y, z - 0.05)), d, ln, rad, rng, tip=1.5 if not cfg['flat'] else 1.2,
                      flat=cfg['flat'] and rad > 0.2, embed=0.3, keep=keep)
    return mb, dict(ao=1.0, gd=4.0, cat='crystal')


def build_deposit(c):
    rng = c.rng
    mb = MB()
    v = c.v
    so = c.seed * 0.53
    if v == 0:
        dims = (1.35, 1.05, 0.68)
        planes, amp, depth = 13, 0.2, (0.6, 0.92)
    else:
        dims = (1.25, 1.15, 0.68)
        planes, amp, depth = 5, 0.3, (0.8, 0.95)

    def vein(p):
        return abs(fbm(p * 1.1 + Vector((3.1, 1.7, 0.4)), so, 2))

    def post(p):
        vv = vein(p)
        m = 1 - smoothstep(0.0, 0.035, vv)
        return p + ell_normal(p, dims) * (0.045 * m)

    rv, rf = rock_mesh(c.seed, dims, subdiv=6, planes=planes, depth=depth, amp=amp, freq=0.9, post=post,
                       target=c.target('rock', 820 if v == 0 else 760), flat_bottom=0.5, sink=0.12, detail=0.01)

    def w(p):
        mott = smoothstep(0.0, 0.4, fbm(p * 1.8, so + 3, 2)) * 0.45
        return mixw(P, S, mott)

    f0 = len(mb.f)
    mb.add(rv, rf, w, ang=FACET)
    # ore veins: whole faces along the raised vein ridges (crisp, per-corner colour)
    for fi, f in enumerate(rf):
        cen = sum((rv[i] for i in f), Vector()) / len(f)
        if vein(cen) < 0.042:
            mb.fw[f0 + fi] = mixw(A, S, 0.15)
    bvh = BVHTree.FromPolygons(rv, rf)
    # ore crystal clusters bursting out of the rock
    ncl = 3 if v == 0 else 2
    for k in range(ncl):
        a = rng.uniform(0, 2 * pi)
        rr = rng.uniform(0.15, 0.55)
        cx, cy = cos(a) * rr * dims[0], sin(a) * rr * dims[1]
        z = surface_z(bvh, cx, cy, 0.3)
        outd = (Vector((cos(a) * rr, sin(a) * rr, 0)) + UP * 0.9).normalized()
        for m in range(5 if v == 0 else 3):
            dd = (outd + rand_dir(rng) * 0.55).normalized()
            if dd.z < 0.2:
                dd = (dd + UP * 0.5).normalized()
            off = Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0))
            ln = rng.uniform(0.35, 0.95) * (1.0 if m else 1.25)
            crystal_prism(c, mb, Vector((cx, cy, z - 0.05)) + off, dd, ln, rng.uniform(0.06, 0.12), rng, tip=1.5,
                          embed=0.2, wbody=A, wtip=A, glow=1.0, keep=c.lod == 0 or m < 3)
    if v == 1:  # metallic nuggets half-buried in the mound
        for k in range(7):
            a = rng.uniform(0, 2 * pi)
            rr = rng.uniform(0.2, 0.8)
            cx, cy = cos(a) * rr * dims[0], sin(a) * rr * dims[1]
            z = surface_z(bvh, cx, cy, 0.2)
            rad = rng.uniform(0.1, 0.2)
            ball(mb, Vector((cx, cy, z - rad * 0.35)), rad, c.r(7, 4), c.r(5, 3), A, scale=(1.2, 1, 0.8),
                 rot=Quaternion(UP, rng.uniform(0, pi)), ang=FACET, jitter=0.25, seed=k + so)
    return mb, dict(ao=1.0, gd=4.0, cat='rock')


# =====================================================================================
# model table
# =====================================================================================
SPECS = []


def spec(prefix, fn, n, budget, seed0, lod=True):
    for i in range(n):
        SPECS.append(("%s_%d" % (prefix, i), fn, seed0 + i * 101, i, budget, lod))


spec("tree_round", build_round, 3, 6000, 1000)
spec("tree_conifer", build_conifer, 3, 3500, 2000)
spec("tree_palm", build_palm, 2, 3500, 3000)
spec("tree_blob", build_blob, 2, 3000, 4000)
spec("tree_mushroom", build_mushroom, 3, 3000, 5000)
spec("tree_spiral", build_spiral, 2, 3000, 6000)
spec("tree_coral", build_coral, 2, 3000, 7000)
spec("cactus", build_cactus, 2, 1500, 8000)
spec("crystal", build_crystal, 3, 1500, 9000)
spec("bush", build_bush, 3, 2600, 10000)
spec("fern", build_fern, 2, 800, 11000)
spec("rock", build_rock, 4, 500, 12000)
spec("boulder", build_boulder, 3, 1500, 13000)
spec("deposit", build_deposit, 2, 1500, 14000)
SPECS.append(("plant_bulb_0", build_plant, 15000, 0, 1200, True))
SPECS.append(("plant_flower_0", build_plant, 15101, 1, 1200, True))
spec("grass", build_grass, 2, 60, 16000, lod=False)

for (name, fn, seed, variant, budget, haslod) in SPECS:
    if ONLY and not any(name.startswith(p) for p in ONLY):
        continue
    t = time.time()
    for lod in ((0, 1) if (haslod and not NO_LOD) else (0,)):
        c = Ctx(name, seed, lod, variant, budget)
        mb, opts = fn(c)
        finish(name if lod == 0 else name + "_lod1", mb, opts)
    i0 = INFO[name]
    i1 = INFO.get(name + "_lod1")
    print("MODEL %-16s lod0 %5d tris  lod1 %5s  h=%.2f w=%.2f zmin=%.2f bad=%d  (%.1fs)" % (
        name, i0['tris'], i1['tris'] if i1 else '-', i0['h'], i0['w'], i0['zmin'], i0['bad'], time.time() - t))
    if i0['tris'] > budget:
        print("   !!! OVER BUDGET", name, i0['tris'], budget)

# =====================================================================================
# export
# =====================================================================================
bpy.ops.object.select_all(action="DESELECT")
for ob in OBJ.values():
    ob.select_set(True)
bpy.context.view_layer.objects.active = next(iter(OBJ.values()))
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    use_selection=True,
    export_normals=True,
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
    export_texcoords=False,
    export_materials='EXPORT',
)
print("EXPORTED", OUT, len(OBJ), "objects  %.1fs" % (time.time() - T0))


# =====================================================================================
# contact-sheet previews (example palettes applied via the colour weights)
# =====================================================================================
def palette_material(name, prim, sec, acc, glow=2.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    ca = nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Color"
    sep = nodes.new("ShaderNodeSeparateColor")
    links.new(ca.outputs["Color"], sep.inputs[0])

    def scale(col, sock):
        n = nodes.new("ShaderNodeVectorMath")
        n.operation = 'SCALE'
        n.inputs[0].default_value = col
        links.new(sock, n.inputs["Scale"])
        return n.outputs[0]

    def add(a, b):
        n = nodes.new("ShaderNodeVectorMath")
        n.operation = 'ADD'
        links.new(a, n.inputs[0])
        links.new(b, n.inputs[1])
        return n.outputs[0]

    base = add(add(scale(prim, sep.outputs[0]), scale(sec, sep.outputs[1])), scale(acc, sep.outputs[2]))
    if os.environ.get("FLORA_AOVIEW"):
        base = scale((0.3, 0.3, 0.3), ca.outputs["Alpha"])
        glow = 0.0
    ao = nodes.new("ShaderNodeVectorMath")
    ao.operation = 'SCALE'
    links.new(base, ao.inputs[0])
    links.new(ca.outputs["Alpha"], ao.inputs["Scale"])
    links.new(ao.outputs[0], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    mul = nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY'
    links.new(sep.outputs[2], mul.inputs[0])
    mul.inputs[1].default_value = glow
    bsdf.inputs["Emission Color"].default_value = (*acc, 1.0)
    links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
    return m


def flat_mat(name, col, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = 1.0
    if emit:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def render_previews(outdir):
    os.makedirs(outdir, exist_ok=True)
    def L(cc):  # palette values are display (sRGB) colours
        return tuple(x ** 2.2 for x in cc)

    m_plant = palette_material("pv_plant", L((0.25, 0.55, 0.2)), L((0.35, 0.25, 0.18)), L((1.0, 0.55, 0.15)), 1.0)
    m_rock = palette_material("pv_rock", L((0.45, 0.43, 0.4)), L((0.3, 0.28, 0.26)), L((0.3, 0.9, 1.0)), 1.0)
    m_cry = palette_material("pv_crystal", L((0.55, 0.4, 0.85)), L((0.3, 0.28, 0.26)), L((0.3, 0.9, 1.0)), 1.0)
    for nm, ob in OBJ.items():
        base = nm.replace("_lod1", "")
        cat = INFO[base]['cat'] if base in INFO else 'plant'
        ob.data.materials[0] = {'rock': m_rock, 'crystal': m_cry}.get(cat, m_plant)
    # ground, light, world
    bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.data.materials.append(flat_mat("pv_ground", (0.2, 0.19, 0.17)))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.2
    sun.angle = math.radians(4)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(42), math.radians(0), math.radians(-35))
    scene.collection.objects.link(so)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.8, 1)
    bg.inputs["Strength"].default_value = 0.55
    scene.world = world
    scene.render.engine = 'BLENDER_EEVEE'
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    scene.view_settings.view_transform = 'Standard'
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    txt_mat = flat_mat("pv_text", (0.95, 0.95, 0.9), emit=0.6)
    labels = []

    def render_row(names, path, width=1800, D=Vector((0.42, -1.0, 0.5))):
        D = D.normalized()
        cam.rotation_euler = (-D).to_track_quat('-Z', 'Y').to_euler()
        R = cam.rotation_euler.to_matrix() @ Vector((1, 0, 0))
        U = cam.rotation_euler.to_matrix() @ Vector((0, 1, 0))
        for o in OBJ.values():
            o.hide_render = True
        for l in labels:
            bpy.data.objects.remove(l)
        labels.clear()
        obs = [OBJ[n] for n in names if n in OBJ]
        if not obs:
            return None
        bbs = []
        for o in obs:
            cs = [Vector(x) for x in o.bound_box]
            mn = Vector((min(p.x for p in cs), min(p.y for p in cs), min(p.z for p in cs)))
            mx = Vector((max(p.x for p in cs), max(p.y for p in cs), max(p.z for p in cs)))
            bbs.append((mn, mx))
        ws = [max(mx.x - mn.x, mx.y - mn.y) for mn, mx in bbs]
        gap = 0.18 * sum(ws) / len(ws)
        x = 0.0
        corners = []
        for o, (mn, mx), w in zip(obs, bbs, ws):
            o.location = (x + w / 2 - (mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, 0)
            o.hide_render = False
            for cc in o.bound_box:
                corners.append(o.matrix_world @ Vector(cc) if False else Vector(cc) + Vector(o.location))
            x += w + gap
        tsize = max(0.08, x * 0.014)
        for o, (mn, mx), w in zip(obs, bbs, ws):
            cu = bpy.data.curves.new("lbl", 'FONT')
            cu.body = o.name
            cu.size = tsize
            cu.align_x = 'CENTER'
            lo = bpy.data.objects.new("lbl", cu)
            lo.data.materials.append(txt_mat)
            lo.location = Vector((o.location[0] + (mn.x + mx.x) / 2, o.location[1] + mn.y - tsize * 0.8, 0.03))
            lo.rotation_euler = cam.rotation_euler
            scene.collection.objects.link(lo)
            labels.append(lo)
            corners.append(lo.location - U * (tsize * 0.3))
        pr = [p.dot(R) for p in corners]
        pu = [p.dot(U) for p in corners]
        pd = [p.dot(D) for p in corners]
        wR = max(pr) - min(pr)
        wU = max(pu) - min(pu)
        cr = (max(pr) + min(pr)) / 2
        cu_ = (max(pu) + min(pu)) / 2
        res_y = int(clamp(width * wU / wR * 1.1, 380, 1150))
        scene.render.resolution_x = width
        scene.render.resolution_y = res_y
        cam_data.ortho_scale = max(wR * 1.06, wU * 1.08 * width / res_y)
        cam.location = R * cr + U * cu_ + D * (max(pd) + 60)
        cam_data.clip_end = 400
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return path

    def stack(paths, out):
        imgs = [bpy.data.images.load(p) for p in paths if p]
        if not imgs:
            return
        W = imgs[0].size[0]
        Ht = sum(im.size[1] for im in imgs) + 6 * (len(imgs) - 1)
        buf = np.zeros((Ht, W, 4), dtype=np.float32)
        buf[:, :, 3] = 1
        y = Ht
        for im in imgs:
            w, h = im.size
            a = np.empty(w * h * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            a = a.reshape(h, w, 4)
            y -= h
            buf[y:y + h, :w] = a
            y -= 6
        res = bpy.data.images.new("sheet", W, Ht, alpha=False)
        res.pixels.foreach_set(buf.ravel())
        res.filepath_raw = out
        res.file_format = 'PNG'
        res.save()
        print("SHEET", out)

    sheets = {
        'trees': [['tree_round_0', 'tree_round_1', 'tree_round_2', 'tree_palm_0'],
                  ['tree_conifer_0', 'tree_conifer_1', 'tree_conifer_2', 'tree_palm_1']],
        'alien': [['tree_mushroom_0', 'tree_mushroom_1', 'tree_mushroom_2'],
                  ['tree_blob_0', 'tree_blob_1', 'tree_spiral_0', 'tree_spiral_1'],
                  ['tree_coral_0', 'tree_coral_1']],
        'plants': [['cactus_0', 'cactus_1', 'bush_0', 'bush_1', 'bush_2'],
                   ['fern_0', 'fern_1', 'plant_bulb_0', 'plant_flower_0', 'grass_0', 'grass_1']],
        'minerals': [['crystal_0', 'crystal_1', 'crystal_2', 'deposit_0', 'deposit_1'],
                     ['boulder_0', 'boulder_1', 'boulder_2'], ['rock_0', 'rock_1', 'rock_2', 'rock_3']],
    }
    views = {'trees': Vector((0.4, -1.0, 0.3)), 'alien': Vector((0.4, -1.0, 0.33)),
             'plants': Vector((0.42, -1.0, 0.45)), 'minerals': Vector((0.42, -1.0, 0.5))}
    if os.environ.get("FLORA_ROWS"):
        sheets = {'custom': [r.split(",") for r in os.environ["FLORA_ROWS"].split(";")]}
        views['custom'] = Vector((0.4, -1.0, float(os.environ.get("FLORA_EL", "0.35"))))
    for sname, rows in sheets.items():
        for suffix in ('', '_lod1'):
            paths = []
            for k, row in enumerate(rows):
                names = [n + suffix for n in row]
                p = render_row(names, os.path.join(outdir, "_row_%s%s_%d.png" % (sname, suffix, k)), D=views[sname])
                if p:
                    paths.append(p)
            if paths:
                stack(paths, os.path.join(outdir, "sheet_%s%s.png" % (sname, suffix)))
    print("PREVIEWS DONE %.1fs" % (time.time() - T0))


if PREVIEW_DIR:
    render_previews(PREVIEW_DIR)
