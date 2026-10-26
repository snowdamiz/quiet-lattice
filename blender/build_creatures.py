# Builds the alien fauna library and exports public/models/creatures.glb.
# Run: Blender -b -P blender/build_creatures.py -- <out.glb> [preview_dir] [only=name,...] [views=side,34,...]
# (views: side, 34, front, head, posed, gait, top, lineup; only= / views= must come after the preview dir)
#
# Ten stylised alien creatures, two per body plan (quad_grazer, quad_heavy, quad_small, biped, flyer), in the
# chunky toy-like look of the flora: big readable masses, round feet, crests / frills / sails, multiple eyes,
# horns, tusks and mandibles, and bold colour regions (stripes, saddles, spots, banded legs, glowing tips).
# Bodies are "sculpted" as signed-distance fields (smooth-blended ellipsoids, tapered tubes, carved mouths),
# polygonised with surface nets, projected back onto the exact surface and collapse-decimated to a game
# budget (< 6000 tris per creature). Thin membranes (sails, fins, frills, wings) are triangulated directly,
# crystals are faceted meshes with crisp edges. Each animated part (legs, head+neck, tail, wings) is a
# separate closed shell whose root is a ball centred on its joint pivot, so rigid rotation in the vertex
# shader never opens a gap.
#
# Conventions (Blender space): +Z up, the creature faces -Y (glTF/three.js +Z). Walkers stand with every
# sole exactly on z = 0 and the origin between their feet (walkers 1.4 m tall, bipeds 1.8 m); flyers are
# centred on the body with wings spread level along +-X (1.4 m span).
# Legs are near-vertical columns under their hip pivot with the knee at KNEE (0.5) x hip height and the
# foot below ANKLE (0.13) x hip height: src/gameplay/Fauna.js bends legs there during the swing and keeps
# the planted foot level. shader_pose() below is a numpy copy of that vertex shader; the build checks the
# walk cycle with it (planted feet stay on the ground, swinging feet clear it) and renders posed previews.
# Point attributes: _limb (float id), _pivot (joint position in Blender object space, NOT converted to
# Y-up by the exporter), _glow (0/1). They export as glTF _LIMB / _PIVOT / _GLOW (three.js: _limb, ...).
# Limb ids: 0 body, 1/2 front legs (-X/+X) or biped legs, 3/4 hind legs (-X/+X), 5 tail, 6 head+neck,
# 7/8 wings (-X/+X).
# Color attribute (COLOR_0, RGBA): R primary (hide), G secondary (markings / underside), B accent (glowing
# tips, spots, stripes; R+G+B = 1), A baked ambient occlusion (eyes get a dark pupil / mid iris in A).
import bpy
import math
import os
import sys
import time

import numpy as np
from mathutils import Euler, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "creatures.glb"
PREVIEW_DIR = argv[1] if len(argv) > 1 else None
ONLY = None
PREVIEW_VIEWS = {"side", "34", "head", "posed", "gait", "top", "lineup"}
for a in argv[2:]:
    if a.startswith("only="):
        ONLY = set(a[5:].split(","))
    if a.startswith("views="):
        PREVIEW_VIEWS = set(a[6:].split(","))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

F = np.float32
BIG = F(1e3)
PAD = 0.03  # bbox culling margin (m) - must exceed a few voxels


# =====================================================================================
# Signed distance toolkit (numpy, vectorised over (N,3) float32 point arrays)
# =====================================================================================
def vec(v):
    return np.asarray(v, dtype=F)


def frame(z, xref=(1.0, 0.0, 0.0)):
    """Rotation (columns = local x, y, z axes in world) whose local z points along `z`."""
    z = np.asarray(z, float)
    z = z / np.linalg.norm(z)
    xr = np.asarray(xref, float)
    x = xr - z * np.dot(xr, z)
    if np.linalg.norm(x) < 1e-5:
        x = np.cross((0.0, 1.0, 0.0), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def euler(rx=0.0, ry=0.0, rz=0.0):
    return np.array(Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_matrix(), float)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def in_bb(P, bb, m):
    lo, hi = bb
    return ((P[:, 0] >= lo[0] - m) & (P[:, 0] <= hi[0] + m) & (P[:, 1] >= lo[1] - m) & (P[:, 1] <= hi[1] + m)
            & (P[:, 2] >= lo[2] - m) & (P[:, 2] <= hi[2] + m))


class Shape:
    _bb = None

    def bb(self):
        if self._bb is None:
            lo, hi = self.calc_bb()
            self._bb = (np.asarray(lo, float), np.asarray(hi, float))
        return self._bb


class Sphere(Shape):
    def __init__(s, c, r):
        s.c, s.r = vec(c), F(r)

    def ev(s, P):
        return np.sqrt(((P - s.c) ** 2).sum(1)) - s.r

    def calc_bb(s):
        return s.c - s.r, s.c + s.r


class Ell(Shape):
    """Ellipsoid (iq's bound approximation), radii r along the columns of R."""

    def __init__(s, c, r, R=None):
        s.c, s.r = vec(c), np.asarray(r, float)
        s.R = np.eye(3) if R is None else np.asarray(R, float)
        s.Rf = s.R.astype(F)
        s.ir = (1 / s.r).astype(F)
        s.ir2 = (1 / (s.r * s.r)).astype(F)

    def ev(s, P):
        Q = (P - s.c) @ s.Rf
        k0 = np.sqrt(((Q * s.ir) ** 2).sum(1))
        k1 = np.sqrt(((Q * s.ir2) ** 2).sum(1))
        return k0 * (k0 - 1) / np.maximum(k1, F(1e-6))

    def calc_bb(s):
        e = np.sqrt(((s.R * s.r[None, :]) ** 2).sum(1))
        return s.c - e, s.c + e


def ell_ab(a, b, rx, ry, ext=1.0, xref=(1.0, 0.0, 0.0)):
    """Ellipsoid spanning a->b (half length * ext) with cross radii rx (towards xref) and ry."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    return Ell((a + b) / 2, (rx, ry, np.linalg.norm(b - a) / 2 * ext), frame(b - a, xref))


class RoundCone(Shape):
    def __init__(s, a, b, ra, rb):
        s.a, s.b = np.asarray(a, float), np.asarray(b, float)
        ba = s.b - s.a
        L = np.linalg.norm(ba)
        if abs(ra - rb) > 0.97 * L:
            rb = ra - math.copysign(0.97 * L, ra - rb)
        s.ra, s.rb = F(ra), F(rb)
        s.baf = ba.astype(F)
        s.af = s.a.astype(F)
        s.l2 = F(ba @ ba)
        s.rr = F(ra - rb)
        s.a2 = F(s.l2 - s.rr * s.rr)
        s.il2 = F(1.0 / s.l2)

    def ev(s, P):
        pa = P - s.af
        y = pa @ s.baf
        z = y - s.l2
        xv = pa * s.l2 - y[:, None] * s.baf
        x2 = (xv * xv).sum(1)
        y2 = y * y * s.l2
        z2 = z * z * s.l2
        k = np.sign(s.rr) * s.rr * s.rr * x2
        d_b = np.sqrt(x2 + z2) * s.il2 - s.rb
        d_a = np.sqrt(x2 + y2) * s.il2 - s.ra
        d_m = (np.sqrt(np.maximum(x2 * s.a2 * s.il2, 0)) + y * s.rr) * s.il2 - s.ra
        return np.where(np.sign(z) * s.a2 * z2 > k, d_b, np.where(np.sign(y) * s.a2 * y2 < k, d_a, d_m))

    def calc_bb(s):
        return (np.minimum(s.a - s.ra, s.b - s.rb), np.maximum(s.a + s.ra, s.b + s.rb))


class Box(Shape):
    """Rounded oriented box: half sizes h, corner radius rad, axes = columns of R."""

    def __init__(s, c, h, rad=0.0, R=None):
        s.c, s.h, s.rad = vec(c), np.asarray(h, float), F(rad)
        s.R = np.eye(3) if R is None else np.asarray(R, float)
        s.Rf = s.R.astype(F)
        s.hf = (s.h - rad).astype(F)

    def ev(s, P):
        q = np.abs((P - s.c) @ s.Rf) - s.hf
        return np.sqrt((np.maximum(q, 0) ** 2).sum(1)) + np.minimum(q.max(1), 0) - s.rad

    def calc_bb(s):
        e = np.abs(s.R) @ s.h
        return s.c - e, s.c + e


class Plane(Shape):
    """Half space n.p <= o (inside)."""

    def __init__(s, n, o=0.0):
        s.n, s.o = vec(n), F(o)

    def ev(s, P):
        return P @ s.n - s.o

    def calc_bb(s):
        return np.full(3, -np.inf), np.full(3, np.inf)


class Union(Shape):
    def __init__(s, *ch, k=0.0):
        s.ch = [c for c in ch if c is not None]
        s.k = k

    def ev(s, P):
        d = np.full(len(P), BIG, F)
        m = s.k + PAD
        for c in s.ch:
            msk = in_bb(P, c.bb(), m)
            if not msk.any():
                continue
            if msk.all():
                d = smin(d, c.ev(P), s.k)
            else:
                d[msk] = smin(d[msk], c.ev(P[msk]), s.k)
        return d

    def calc_bb(s):
        bbs = [c.bb() for c in s.ch]
        return np.min([b[0] for b in bbs], 0), np.max([b[1] for b in bbs], 0)


class Sub(Shape):
    """a minus each of the cutters (smooth k)."""

    def __init__(s, a, *cut, k=0.0):
        s.a, s.cut, s.k = a, [c for c in cut if c is not None], k

    def ev(s, P):
        d = s.a.ev(P)
        for c in s.cut:
            msk = in_bb(P, c.bb(), s.k + PAD)
            if msk.any():
                d[msk] = smax(d[msk], -c.ev(P[msk]), s.k)
        return d

    def calc_bb(s):
        return s.a.bb()


class Inter(Shape):
    def __init__(s, a, b, k=0.0):
        s.a, s.b, s.k = a, b, k

    def ev(s, P):
        d = s.a.ev(P)
        msk = in_bb(P, s.b.bb(), s.k + PAD)
        d[~msk] = np.maximum(d[~msk], BIG)
        if msk.any():
            d[msk] = smax(d[msk], s.b.ev(P[msk]), s.k)
        return d

    def calc_bb(s):
        a, b = s.a.bb(), s.b.bb()
        return np.maximum(a[0], b[0]), np.minimum(a[1], b[1])


class Mirror(Shape):
    """Mirror a +X-side shape across x = 0."""

    def __init__(s, c):
        s.c = c

    def ev(s, P):
        Q = P.copy()
        Q[:, 0] = np.abs(Q[:, 0])
        return s.c.ev(Q)

    def calc_bb(s):
        lo, hi = s.c.bb()
        m = max(abs(lo[0]), abs(hi[0]))
        return np.array([-m, lo[1], lo[2]]), np.array([m, hi[1], hi[2]])


class Xform(Shape):
    """Child modelled in a local frame: world = t + R @ local."""

    def __init__(s, c, R, t=(0, 0, 0)):
        s.c, s.R, s.t = c, np.asarray(R, float), np.asarray(t, float)
        s.Rf, s.tf = s.R.astype(F), s.t.astype(F)

    def ev(s, P):
        return s.c.ev((P - s.tf) @ s.Rf)

    def calc_bb(s):
        lo, hi = s.c.bb()
        cs = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        w = cs @ s.R.T + s.t
        return w.min(0), w.max(0)


class Displace(Shape):
    def __init__(s, c, fn, amp):
        s.c, s.fn, s.amp = c, fn, amp

    def ev(s, P):
        return s.c.ev(P) + s.fn(P)

    def calc_bb(s):
        lo, hi = s.c.bb()
        return lo - s.amp, hi + s.amp


class Slab(Shape):
    """2D polygon (xy) inflated by a half thickness t(x, y) around a camber surface z = c(x, y)."""

    def __init__(s, poly, t_fn, c_fn, tmax, zr):
        s.poly = np.asarray(poly, float)
        s.t_fn, s.c_fn, s.tmax, s.zr = t_fn, c_fn, tmax, zr

    def ev(s, P):
        d2 = sd_polygon(P[:, :2], s.poly)
        dz = P[:, 2] - s.c_fn(P[:, 0], P[:, 1])
        return np.sqrt(np.maximum(d2, 0) ** 2 + dz * dz) - s.t_fn(P[:, 0], P[:, 1])

    def calc_bb(s):
        lo = s.poly.min(0) - s.tmax
        hi = s.poly.max(0) + s.tmax
        return np.array([lo[0], lo[1], s.zr[0]]), np.array([hi[0], hi[1], s.zr[1]])


def sd_polygon(p, v):
    v = v.astype(F)
    d = ((p - v[0]) ** 2).sum(1)
    s = np.ones(len(p), F)
    n = len(v)
    for i in range(n):
        a, b = v[i], v[(i + 1) % n]
        e = b - a
        w = p - a
        t = np.clip((w @ e) / F(e @ e), 0, 1)
        bq = w - t[:, None] * e
        d = np.minimum(d, (bq * bq).sum(1))
        c1 = p[:, 1] >= a[1]
        c2 = p[:, 1] < b[1]
        c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s[flip] *= -1
    return s * np.sqrt(d)


def catmull(pts, n=6):
    pts = np.asarray(pts, float)
    if len(pts) == 2:
        return np.array([pts[0] + (pts[1] - pts[0]) * t for t in np.linspace(0, 1, n + 1)])
    Pp = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for i in range(1, len(Pp) - 2):
        p0, p1, p2, p3 = Pp[i - 1], Pp[i], Pp[i + 1], Pp[i + 2]
        for j in range(n):
            t = j / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return np.array(out)


def tube(pts, radii, n=5, k=0.0):
    """Smooth tapered tube through control points."""
    C = catmull([list(p) + [r] for p, r in zip(pts, radii)], n)
    segs = []
    for i in range(len(C) - 1):
        a, b = C[i], C[i + 1]
        if np.linalg.norm(b[:3] - a[:3]) < 1e-5:
            continue
        segs.append(RoundCone(a[:3], b[:3], max(a[3], 0.002), max(b[3], 0.002)))
    return Union(*segs, k=k)


GROUND = Plane((0, 0, -1), 0.0)  # inside where z >= 0


def on_ground(shape):
    return Inter(shape, GROUND)


# =====================================================================================
# Polygonisation: surface nets + Newton projection + decimation
# =====================================================================================
CORNERS = [(dx, dy, dz) for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]
EDGES = [(a, b) for a in range(8) for b in range(a + 1, 8)
         if sum(abs(np.subtract(CORNERS[a], CORNERS[b]))) == 1]


def sample_grid(shape, h, sym):
    lo, hi = shape.bb()
    lo = np.asarray(lo, float) - 3 * h
    hi = np.asarray(hi, float) + 3 * h
    if sym:
        m = max(abs(lo[0]), abs(hi[0]))
        nx = int(math.ceil(2 * m / h)) + 1
        lo[0] = -h * (nx - 1) / 2
        hi[0] = -lo[0]
    n = (np.ceil((hi - lo) / h)).astype(int) + 1
    axes = [(lo[i] + h * np.arange(n[i])).astype(F) for i in range(3)]
    G = np.empty(tuple(n), F)
    yz = np.stack(np.meshgrid(axes[1], axes[2], indexing="ij"), -1).reshape(-1, 2)
    chunk = max(1, int(1_200_000 // len(yz)))
    for i0 in range(0, n[0], chunk):
        i1 = min(n[0], i0 + chunk)
        P = np.empty(((i1 - i0) * len(yz), 3), F)
        P[:, 0] = np.repeat(axes[0][i0:i1], len(yz))
        P[:, 1:] = np.tile(yz, (i1 - i0, 1))
        G[i0:i1] = shape.ev(P).reshape(i1 - i0, n[1], n[2])
    return G, lo


def surface_nets(G, lo, h):
    n = np.array(G.shape)
    inside = G < 0
    cs = tuple(n - 1)
    cnt = np.zeros(cs, np.uint8)
    for (dx, dy, dz) in CORNERS:
        cnt += inside[dx:n[0] - 1 + dx, dy:n[1] - 1 + dy, dz:n[2] - 1 + dz]
    act = (cnt > 0) & (cnt < 8)
    ci = np.argwhere(act)
    M = len(ci)
    vid = np.full(cs, -1, np.int64)
    vid[tuple(ci.T)] = np.arange(M)
    cv = np.stack([G[ci[:, 0] + dx, ci[:, 1] + dy, ci[:, 2] + dz] for (dx, dy, dz) in CORNERS], 1)
    off = np.array(CORNERS, float)
    acc = np.zeros((M, 3))
    num = np.zeros(M)
    for (a, b) in EDGES:
        f0, f1 = cv[:, a], cv[:, b]
        m = (f0 < 0) != (f1 < 0)
        t = f0[m] / (f0[m] - f1[m])
        acc[m] += off[a] + t[:, None] * (off[b] - off[a])
        num[m] += 1
    V = lo + h * (ci + acc / np.maximum(num, 1)[:, None])
    quads = []
    for ax in range(3):
        u, v = (ax + 1) % 3, (ax + 2) % 3
        s0 = [slice(None)] * 3
        s1 = [slice(None)] * 3
        s0[ax] = slice(0, n[ax] - 1)
        s1[ax] = slice(1, n[ax])
        in0 = inside[tuple(s0)]
        ch = in0 != inside[tuple(s1)]
        e = np.argwhere(ch)
        keep = (e[:, u] >= 1) & (e[:, v] >= 1) & (e[:, u] <= n[u] - 2) & (e[:, v] <= n[v] - 2)
        e = e[keep]
        lower_in = in0[tuple(e.T)]
        ids = []
        for (du, dv) in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = e.copy()
            c[:, u] += du
            c[:, v] += dv
            ids.append(vid[tuple(c.T)])
        q = np.stack(ids, 1)
        q[~lower_in] = q[~lower_in][:, ::-1]
        quads.append(q)
    Q = np.concatenate(quads)
    Q = Q[(Q >= 0).all(1)]
    return V, Q


def sdf_grad(shape, V, e):
    g = np.zeros_like(V)
    for i in range(3):
        o = np.zeros(3, F)
        o[i] = e
        g[:, i] = shape.ev(V + o) - shape.ev(V - o)
    return g / (2 * e)


def project(shape, V, h, iters=3):
    V = V.astype(F)
    e = F(h * 0.35)
    for _ in range(iters):
        d = shape.ev(V)
        g = sdf_grad(shape, V, e)
        st = (d / ((g * g).sum(1) + F(1e-9)))[:, None] * g
        ln = np.sqrt((st * st).sum(1))
        st *= np.minimum(1.0, h / np.maximum(ln, 1e-9))[:, None]
        V = V - st
    return V


def np_mesh(name, V, faces):
    faces = np.asarray(faces)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", np.asarray(V, np.float32).ravel())
    ns = faces.shape[1]
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.astype(np.int32).ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, ns, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    return me


def mesh_tris(me):
    me.calc_loop_triangles()
    V = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", V)
    T = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", T)
    return V.reshape(-1, 3).astype(F), T.reshape(-1, 3)


def decimate(V, Q, target, sym):
    me = np_mesh("tmp_dense", V, Q)
    ob = bpy.data.objects.new("tmp_dense", me)
    scene.collection.objects.link(ob)
    ratio = min(1.0, target / (2.0 * len(Q)))
    res = None
    for attempt in range(4):
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        mod.use_symmetry = sym
        mod.symmetry_axis = "X"
        dg = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        Vd, Td = mesh_tris(me2)
        bpy.data.meshes.remove(me2)
        ob.modifiers.remove(mod)
        res = (Vd, Td)
        if len(Td) <= target * 1.015 or ratio < 1e-3:
            break
        ratio *= target / len(Td) * 0.995
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return res


def weld(V, T, tol=1e-6):
    """Merge duplicate vertices (keeps the mesh closed for normals/AO)."""
    key = np.round(V / tol).astype(np.int64)
    _, idx, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    T2 = inv[T]
    ok = (T2[:, 0] != T2[:, 1]) & (T2[:, 1] != T2[:, 2]) & (T2[:, 0] != T2[:, 2])
    V2, T2 = V[idx], T2[ok]
    used = np.unique(T2)  # drop vertices no longer referenced by any face
    remap = np.full(len(V2), -1)
    remap[used] = np.arange(len(used))
    return V2[used], remap[T2]


# =====================================================================================
# Small direct meshes: eyes and bioluminescent nodules
# =====================================================================================
def eye_mesh(c, r, look, seg=10, rings=7):
    """UV sphere with its pole (the pupil) along `look`."""
    R = frame(look)
    verts = [np.array([0, 0, 1.0])]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            verts.append(np.array([math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)]))
    verts.append(np.array([0, 0, -1.0]))
    V = np.array(verts) * r @ R.T + np.asarray(c, float)
    T = []
    for j in range(seg):
        T.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 2):
        a0 = 1 + i * seg
        a1 = a0 + seg
        for j in range(seg):
            j1 = (j + 1) % seg
            T.append((a0 + j, a1 + j, a1 + j1))
            T.append((a0 + j, a1 + j1, a0 + j1))
    last = len(V) - 1
    b0 = 1 + (rings - 2) * seg
    for j in range(seg):
        T.append((b0 + j, last, b0 + (j + 1) % seg))
    return V.astype(F), np.array(T)


def dome_mesh(c, n, r, hgt, R=None, ry=None, n_seg=6):
    """Low flattened nodule sitting on a surface (open underside, sunk into the skin)."""
    Rm = frame(n) if R is None else R
    ry = r if ry is None else ry
    verts = [(0, 0, hgt)]
    for j in range(n_seg):
        a = 2 * math.pi * j / n_seg
        verts.append((0.62 * r * math.cos(a), 0.62 * ry * math.sin(a), hgt * 0.72))
    for j in range(n_seg):
        a = 2 * math.pi * (j + 0.5) / n_seg
        verts.append((r * math.cos(a), ry * math.sin(a), -hgt * 0.6 - 0.45 * max(r, ry)))
    V = np.array(verts) @ Rm.T + np.asarray(c, float)
    T = []
    for j in range(n_seg):
        j1 = (j + 1) % n_seg
        T.append((0, 1 + j, 1 + j1))
        T.append((1 + j, 1 + n_seg + j, 1 + j1))
        T.append((1 + j1, 1 + n_seg + j, 1 + n_seg + j1))
    return V.astype(F), np.array(T)


def loft_mesh(pts, radii, n_around=8, spacing=0.03, r_mod=None, start_cap=True):
    """Structured tube along a catmull path (clean rings of vertices, so colour bands stay crisp).
    r_mod(s, L) -> radius multiplier along the arc length s."""
    C = catmull([list(p) + [r] for p, r in zip(pts, radii)], 16)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C[:, :3], axis=0), axis=1))])
    L = s[-1]
    n = max(3, int(round(L / spacing)) + 1)
    ss = np.linspace(0, L, n)
    P = np.stack([np.interp(ss, s, C[:, i]) for i in range(4)], 1)
    T = np.gradient(P[:, :3], axis=0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    ref = np.array([1.0, 0, 0]) if abs(T[0, 0]) < 0.9 else np.array([0, 0, 1.0])
    Nn = ref - T[0] * (ref @ T[0])
    Nn /= np.linalg.norm(Nn)
    frames = []
    for i in range(n):
        Nn = Nn - T[i] * (Nn @ T[i])
        Nn /= np.linalg.norm(Nn)
        frames.append((Nn.copy(), np.cross(T[i], Nn)))
    verts, tris = [], []
    rad = P[:, 3] * (r_mod(ss, L) if r_mod else 1.0)
    ang = 2 * math.pi * np.arange(n_around) / n_around
    for i in range(n):
        Nf, Bf = frames[i]
        for a in ang:
            verts.append(P[i, :3] + rad[i] * (math.cos(a) * Nf + math.sin(a) * Bf))
    for i in range(n - 1):
        for j in range(n_around):
            a, b = i * n_around + j, i * n_around + (j + 1) % n_around
            tris.append((a, b + n_around, b))
            tris.append((a, a + n_around, b + n_around))

    def cap(i, sign):
        Nf, Bf = frames[i]
        base = len(verts)
        for a in ang:
            verts.append(P[i, :3] + sign * T[i] * rad[i] * 0.55 + 0.83 * rad[i] * (math.cos(a) * Nf + math.sin(a) * Bf))
        verts.append(P[i, :3] + sign * T[i] * rad[i])
        pole = len(verts) - 1
        ring = i * n_around
        for j in range(n_around):
            j1 = (j + 1) % n_around
            if sign > 0:
                tris.append((ring + j, ring + j1, base + j1))
                tris.append((ring + j, base + j1, base + j))
                tris.append((base + j, base + j1, pole))
            else:
                tris.append((ring + j, base + j1, ring + j1))
                tris.append((ring + j, base + j, base + j1))
                tris.append((base + j, pole, base + j1))
    if start_cap:
        cap(0, -1)
    cap(n - 1, 1)
    return np.array(verts, F), np.array(tris)


def membrane_mesh(poly, t_fn, c_fn, h, R=None, origin=(0, 0, 0), edge_band=None, rim_frac=0.3):
    """Thin lens-section membrane (fins, fans, sails) built directly instead of via SDF + decimation:
    a constrained Delaunay triangulation of the 2D outline (local xy) with interior points, offset by
    +-t(x, y) around the camber z = c(x, y). The thickness thins to rim_frac * t at the outline, where a
    narrow rim strip closes the shell.
    R / origin place the local frame in the world (world = origin + R @ local)."""
    from mathutils.geometry import delaunay_2d_cdt
    poly = np.asarray(poly, float)
    pts = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        n = max(1, int(math.ceil(np.linalg.norm(b - a) / h)))
        for k in range(n):
            pts.append(a + (b - a) * k / n)
    outline = np.array(pts)
    lo, hi = poly.min(0), poly.max(0)
    gy = np.arange(lo[1], hi[1] + h, h * 0.866)
    G = np.array([(x + (0.5 * h if j % 2 else 0.0), y) for j, y in enumerate(gy)
                  for x in np.arange(lo[0] - h, hi[0] + h, h)])
    dG = sd_polygon(G.astype(F), poly)
    G = G[dG < -0.55 * h]
    v2 = np.vstack([outline, G])
    res = delaunay_2d_cdt([Vector(v) for v in v2], [], [list(range(len(outline)))], 1, 1e-7)
    vout = np.array([tuple(v) for v in res[0]], float)
    tris = []
    for f in res[2]:
        f = list(f)
        for k in range(1, len(f) - 1):
            tris.append((f[0], f[k], f[k + 1]))
    tris = np.array(tris)
    cen = vout[tris].mean(1)
    tris = tris[sd_polygon(cen.astype(F), poly) < 0]
    a = vout[tris[:, 1]] - vout[tris[:, 0]]
    b = vout[tris[:, 2]] - vout[tris[:, 0]]
    flip = (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) < 0
    tris[flip] = tris[flip][:, ::-1]
    d = sd_polygon(vout.astype(F), poly)
    band = edge_band or 1.5 * h
    t = t_fn(vout[:, 0], vout[:, 1]) * (rim_frac + (1 - rim_frac) * smoothstep(0.0, band, -d))
    c = c_fn(vout[:, 0], vout[:, 1])
    n = len(vout)
    V = np.vstack([np.c_[vout, c + t], np.c_[vout, c - t]])
    T = [tris, tris[:, ::-1] + n]
    # stitch the rim: outline vertices in input order -> output indices
    o_of_i = {}
    for oi, lst in enumerate(res[3]):
        for ii in lst:
            o_of_i[ii] = oi
    ring = np.array([o_of_i[i] for i in range(len(outline))])
    area = 0.5 * np.sum(outline[:, 0] * np.roll(outline[:, 1], -1) - np.roll(outline[:, 0], -1) * outline[:, 1])
    i0, i1 = ring, np.roll(ring, -1)
    quads = np.stack([i0, i1, i1 + n, i0 + n], 1) if area < 0 else np.stack([i1, i0, i0 + n, i1 + n], 1)
    T.append(quads[:, [0, 1, 2]])
    T.append(quads[:, [0, 2, 3]])
    T = np.vstack(T)
    used = np.unique(T)
    remap = np.full(len(V), -1)
    remap[used] = np.arange(len(used))
    V, T = V[used], remap[T]
    Rm = np.eye(3) if R is None else np.asarray(R, float)
    return (V @ Rm.T + np.asarray(origin, float)).astype(F), T


def seg_param(P, segs):
    """For each point: normalised position t along the nearest of several (a, b) segments."""
    best_d = np.full(len(P), np.inf)
    best_t = np.zeros(len(P))
    for a, b in segs:
        a, b = np.asarray(a, float), np.asarray(b, float)
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        m = d < best_d
        best_d[m] = d[m]
        best_t[m] = t[m]
    return best_t


def surface_point(shape, p, h=0.004, dirn=None):
    """Project a point onto a shape's surface: march from p (along dirn, default towards the bbox centre),
    start Newton steps from the sample closest to the surface."""
    lo, hi = shape.bb()
    p = np.clip(np.asarray(p, float), lo - PAD * 0.5, hi + PAD * 0.5)
    if dirn is None:
        end = 0.5 * (lo + hi)
    else:
        end = p + np.asarray(dirn, float) / np.linalg.norm(dirn) * np.linalg.norm(hi - lo)
    line = np.array([p + (end - p) * t for t in np.linspace(0, 1, 160)], F)
    d = shape.ev(line)
    inside = np.nonzero(d <= 0)[0]
    if len(inside) and inside[0] > 0:
        p = line[inside[0] - 1]  # last sample before the first surface crossing
    else:
        p = line[np.argmin(np.where(d < BIG * 0.5, np.abs(d), np.inf))]
    V = project(shape, np.array([p], F), 0.05, iters=12)
    g = sdf_grad(shape, V, F(h))[0]
    return V[0].astype(float), g / np.linalg.norm(g)


# =====================================================================================
# Parts and creature assembly
# =====================================================================================
LIMB_MIRROR = {0: 0, 1: 2, 3: 4, 5: 5, 6: 6, 7: 8}


class Part:
    def __init__(self, name, shape=None, limb=0, pivot=(0, 0, 0), voxel=0.006, tris=400, sym=False,
                 mirror=False, mesh=None, paint=None, glow=0.0, eye=None, shade=1.0, sharp=False, ao_min=0.0):
        self.sharp, self.ao_min = sharp, ao_min
        self.name, self.shape, self.limb, self.pivot = name, shape, limb, np.asarray(pivot, float)
        self.voxel, self.tris, self.sym, self.mirror = voxel, tris, sym, mirror
        self.mesh, self.paint, self.glow, self.eye, self.shade = mesh, paint, glow, eye, shade


def build_part_mesh(p):
    if p.mesh is not None:
        print(f"   part {p.name:14s} direct mesh {len(p.mesh[1]):5d} tris" + (" (x2 mirrored)" if p.mirror else ""))
        return p.mesh
    t0 = time.time()
    G, lo = sample_grid(p.shape, p.voxel, p.sym)
    V, Q = surface_nets(G, lo, p.voxel)
    V = project(p.shape, V, p.voxel)
    Vd, Td = decimate(V, Q, p.tris, p.sym)
    print(f"   part {p.name:14s} grid {G.shape} dense {2 * len(Q):6d} -> {len(Td):5d} tris  {time.time() - t0:5.1f}s")
    return Vd, Td


def mirror_mesh(V, T):
    V2 = V.copy()
    V2[:, 0] *= -1
    return V2, T[:, ::-1].copy()


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def weights(G, B, S=None):
    """Normalise underside/accent weights into an RGB partition of unity (+ optional AO multiplier S)."""
    B = np.clip(B, 0, 1)
    G = np.clip(G, 0, 1) * (1 - B)
    cols = [1 - G - B, G, B]
    if S is not None:
        cols.append(np.broadcast_to(S, G.shape))
    return np.stack(cols, 1)


def solid(ch, S=1.0):
    """Paint a whole part with one region: ch 0 hide, 1 underside, 2 accent."""
    def fn(P, N, part):
        W = np.zeros((len(P), 4))
        W[:, ch] = 1
        W[:, 3] = S
        return W
    return fn


def path_param(P, pts, n=10):
    """Arc length (and total length) of the nearest point on a catmull path, per vertex."""
    C = catmull(pts, n)
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    d = ((P[:, None, :] - C[None, :, :]) ** 2).sum(2)
    return s[d.argmin(1)], s[-1]


def vertex_normals(V, T):
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros_like(V, dtype=float)
    for i in range(3):
        np.add.at(N, T[:, i], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]


def fib_dirs(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)


def bake_ao(V, T, N, ground, maxd, n_dirs=96, strength=1.0):
    verts = [Vector(v) for v in V.astype(float)]
    bvh = BVHTree.FromPolygons(verts, T.tolist(), epsilon=0.0)
    D = fib_dirs(n_dirs)
    ao = np.ones(len(V))
    eps = maxd * 0.012
    for i in range(len(V)):
        n = N[i]
        if not np.isfinite(n).all() or n @ n < 0.25:
            continue  # degenerate fan (zero-area corner): leave it unoccluded
        cosw = D @ n
        sel = cosw > 0.08
        dirs = D[sel]
        w = cosw[sel]
        o = Vector(V[i] + n * eps)
        occ = 0.0
        for d, wi in zip(dirs, w):
            dist = None
            hit = bvh.ray_cast(o, Vector(d), maxd)
            if hit[0] is not None:
                dist = hit[3]
            if ground and d[2] < -1e-3:
                tg = -(V[i][2] + n[2] * eps) / d[2]
                if 0 <= tg < maxd and (dist is None or tg < dist):
                    dist = tg
            if dist is not None:
                occ += wi * (1 - dist / maxd) ** 0.7
        ao[i] = 1 - strength * occ / w.sum()
    return np.clip(ao, 0.05, 1.0)


CREATURES = {}


def creature(fn):
    CREATURES[fn.__name__] = fn
    return fn


def assemble(name, spec):
    t0 = time.time()
    kind = spec["kind"]
    parts = spec["parts"]
    Vs, Ts, limb, piv, glow, paints, part_id, shade, sharp_v, ao_min = [], [], [], [], [], [], [], [], [], []
    eyes = []
    vo = 0
    for p in parts:
        V, T = build_part_mesh(p)
        V, T = weld(V, T)
        copies = [(V, T, p.limb, p.pivot)]
        if p.mirror:
            V2, T2 = mirror_mesh(V, T)
            pv = p.pivot.copy()
            pv[0] *= -1
            copies.append((V2, T2, LIMB_MIRROR[p.limb], pv))
        for ci, (V, T, lb, pv) in enumerate(copies):
            Vs.append(V)
            Ts.append(T + vo)
            n = len(V)
            limb.append(np.full(n, lb, F))
            piv.append(np.tile(pv, (n, 1)))
            if callable(p.glow):
                Pm = V.astype(float) * ((-1, 1, 1) if ci == 1 else 1)  # evaluate in the source part's space
                glow.append((p.glow(Pm) > 0.5).astype(F))
            else:
                glow.append(np.full(n, p.glow, F))
            shade.append(np.full(n, p.shade, F))
            part_id.append(np.full(n, len(paints)))
            sharp_v.append(np.full(n, 0.0 if not p.sharp else (62.0 if p.sharp is True else float(p.sharp))))
            ao_min.append(np.full(n, p.ao_min))
            paints.append((p, ci == 1))
            if p.eye is not None:
                c, look = np.asarray(p.eye[0], float), np.asarray(p.eye[1], float)
                if ci == 1:
                    c = c * (-1, 1, 1)
                    look = look * (-1, 1, 1)
                eyes.append((vo, vo + n, c, look))
            vo += n
    V = np.concatenate(Vs).astype(float)
    T = np.concatenate(Ts)
    limb = np.concatenate(limb)
    piv = np.concatenate(piv)
    glow = np.concatenate(glow)
    shade = np.concatenate(shade)
    part_id = np.concatenate(part_id)
    N = vertex_normals(V, T)

    # ---- colour regions (painted in model space) ----
    W = np.zeros((len(V), 3))
    for k, (p, mirrored) in enumerate(paints):
        m = part_id == k
        fn = p.paint or spec["paint"]
        P_, N_ = V[m].copy(), N[m].copy()
        if mirrored:  # paint functions are written for the source (left / +X modelled) side
            P_[:, 0] *= -1
            N_[:, 0] *= -1
        res = fn(P_, N_, p)
        W[m] = res[:, :3]
        if res.shape[1] > 3:
            shade[m] *= res[:, 3]

    # ---- normalise size and origin ----
    if kind == "flyer":
        span = V[:, 0].max() - V[:, 0].min()
        s = spec.get("span", 1.4) / span
        V *= s
        piv *= s
    else:
        s = spec.get("height", 1.4) / V[:, 2].max()
        V *= s
        piv *= s
        sole = V[:, 2] < 0.012
        yc = 0.5 * (V[sole, 1].min() + V[sole, 1].max())
        zmin = V[:, 2].min()
        V -= (0, yc, zmin)
        piv[limb > 0.5] -= (0, yc, zmin)
        V[V[:, 2] < 0.002, 2] = 0.0  # soles exactly on the ground plane

    # ---- baked ambient occlusion (+ ground contact for walkers) ----
    ao = bake_ao(V, T, N, ground=(kind != "flyer"), maxd=spec.get("ao_dist", 0.32), strength=spec.get("ao", 0.95))
    ao = np.maximum(ao, np.concatenate(ao_min))
    ao *= shade
    for (a, b, c, look) in eyes:
        cc = c * s - ((0, yc, zmin) if kind != "flyer" else 0)
        d = V[a:b] - cc
        d /= np.linalg.norm(d, axis=1)[:, None]
        cosv = d @ (look / np.linalg.norm(look))
        ao[a:b] = np.where(cosv > 0.86, 0.04, np.where(cosv > 0.55, 0.55, 0.22))
    rgba = np.concatenate([W, ao[:, None]], 1)
    assert np.isfinite(rgba).all() and np.isfinite(piv).all() and np.isfinite(V).all(), name

    me = np_mesh(name, V, T)
    me.shade_smooth()
    sharp_v = np.concatenate(sharp_v)
    if sharp_v.any():
        # crisp rims on thin membranes (crests, vanes, fins) and facets on crystals: split normals where faces
        # meet at more than the part's sharp angle (True = 62 degrees, or a number of degrees)
        ev = np.empty(len(me.edges) * 2, np.int32)
        me.edges.foreach_get("vertices", ev)
        ev = ev.reshape(-1, 2)
        final = np.zeros(len(me.edges), bool)
        for ang in np.unique(sharp_v[sharp_v > 0]):
            me.set_sharp_from_angle(angle=math.radians(ang))
            sh = np.empty(len(me.edges), bool)
            me.attributes["sharp_edge"].data.foreach_get("value", sh)
            final |= sh & (sharp_v[ev[:, 0]] == ang) & (sharp_v[ev[:, 1]] == ang)
        me.attributes["sharp_edge"].data.foreach_set("value", final)
    a = me.attributes.new("_limb", "FLOAT", "POINT")
    a.data.foreach_set("value", limb.astype(np.float32))
    a = me.attributes.new("_pivot", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", piv.astype(np.float32).ravel())
    a = me.attributes.new("_glow", "FLOAT", "POINT")
    a.data.foreach_set("value", glow.astype(np.float32))
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", rgba.astype(np.float32).ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    mt = bpy.data.materials.new(name + "_mat")
    mt.use_nodes = True
    bsdf = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.7
    me.materials.append(mt)
    info = dict(tris=len(T), verts=len(V), height=V[:, 2].max() - V[:, 2].min(),
                span=V[:, 0].max() - V[:, 0].min(), length=V[:, 1].max() - V[:, 1].min(),
                ymid=0.5 * (V[:, 1].max() + V[:, 1].min()), zmid=0.5 * (V[:, 2].max() + V[:, 2].min()))
    print(f"== {name}: {info['tris']} tris, h {info['height']:.2f} w {info['span']:.2f} l {info['length']:.2f}"
          f"  ({time.time() - t0:.1f}s)")
    ob["info"] = str(info)
    return ob, spec


# =====================================================================================
# Anatomy helpers
# =====================================================================================
def A(*p):
    return np.array(p[0] if len(p) == 1 else p, float)


def lerp(a, b, t):
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t




def look_dir(x, y, z):
    v = np.array([x, y, z], float)
    return v / np.linalg.norm(v)


# =====================================================================================
# Anatomy helpers (stylised: chunky toy-like masses, big round feet, bold colour regions)
# =====================================================================================
# Fauna.js animates legs rigidly about the hip pivot, bends them at KNEE * hip height and keeps the foot
# level below ANKLE * hip height, so every leg is built as a near-vertical column under its pivot with the
# knee at that height.
KNEE = 0.5
ANKLE = 0.13


def leg(hip, foot, r_hip, r_thigh, r_shin, pad, toes_n=3, toe_r=None, claw=0.0, k=0.03, knee_dy=0.0, thigh_ry=1.12):
    """Chunky leg standing on z = 0: a ball joint centred on the hip pivot, a fat drumstick thigh, a knee at
    KNEE * hip height, a slimmer shin and a big round foot pad with toe bumps (flat sole on the ground)."""
    hip, foot = A(hip), A(foot)
    pr, pl, ph = pad
    knee = A(lerp(hip[0], foot[0], 0.5), lerp(hip[1], foot[1], 0.5) + knee_dy, hip[2] * KNEE)
    ankle = foot + A(0, 0, max(ph * 1.25, hip[2] * ANKLE))
    shapes = [Sphere(hip, r_hip),
              ell_ab(hip + A(0, 0, r_hip * 0.2), knee, r_thigh, r_thigh * thigh_ry, ext=1.1),
              Sphere(knee, r_shin * 1.18),
              tube([knee, lerp(knee, ankle, 0.5), ankle], [r_shin * 1.1, r_shin * 0.92, r_shin * 0.92]),
              Ell(foot + A(0, -pl * 0.12, ph * 0.5), (pr, pl, ph))]
    tr = toe_r or pr * 0.4
    for i in range(toes_n):
        a = math.radians(0 if toes_n == 1 else -42 + 84 * i / (toes_n - 1))
        d = A(math.sin(a), -math.cos(a), 0)
        c = foot + A(d[0] * pr * 0.72, d[1] * pl * 0.92 - pl * 0.12, tr * 0.8)
        shapes.append(Sphere(c, tr))
        if claw:
            shapes.append(RoundCone(c + d * tr * 0.5 + A(0, 0, tr * 0.15), c + d * (tr + claw) + A(0, 0, -tr * 0.45),
                                    tr * 0.55, 0.004))
    return on_ground(Union(*shapes, k=k))


def eye_part(c, r, look, limb, pivot, glow=0.0, mirror=True, seg=10, rings=7):
    return Part("eye", None, limb, pivot, mesh=eye_mesh(c, r, look, seg, rings), mirror=mirror, eye=(c, look),
                paint=solid(2), glow=glow)


def dots(host, pts, r, hgt, limb=0, pivot=(0, 0, 0), name="dot", paint=None, glow=1.0, ry=None, dirn=None, mirror=True):
    out = []
    for i, p in enumerate(pts):
        c, n = surface_point(host, p, dirn=dirn)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        out.append(Part(f"{name}{i}", None, limb, pivot, mesh=dome_mesh(c, n, rr, hgt, ry=ry), mirror=mirror,
                        glow=glow, paint=paint or solid(2)))
    return out


def under(N, lo=0.05, hi=0.6):
    return smoothstep(lo, hi, -N[:, 2])


def bands(x, period, duty=0.5, soft=0.2, phase=0.0):
    """Periodic 0/1 stripes along a coordinate; duty = fraction of each period that is 'on'."""
    c = np.cos(2 * np.pi * (np.asarray(x, float) / period - phase))
    thr = math.cos(math.pi * duty)
    return smoothstep(thr - soft, thr + soft, c)


def spot_mask(P, spots, soft=0.35, mirror=True):
    """1 inside any of the (centre, radius) spots (mirrored across x = 0)."""
    Q = P.copy()
    if mirror:
        Q[:, 0] = np.abs(Q[:, 0])
    m = np.zeros(len(P))
    for c, r in spots:
        d = np.linalg.norm(Q - np.asarray(c, float), axis=1)
        m = np.maximum(m, smoothstep(r, r * (1 - soft), d))
    return m


def surf_spots(host, seeds, dirn=None):
    """Project (point, radius) seeds onto a host surface."""
    return [(surface_point(host, p, dirn=dirn)[0], r) for p, r in seeds]


def side_frame(pitch_deg=0.0):
    """Local frame for membranes in the sagittal plane: local x = back (+Y, pitched down by pitch_deg),
    local y = up, local z = the creature's +X side."""
    a = math.radians(pitch_deg)
    return np.stack([A(0, math.cos(a), -math.sin(a)), A(0, math.sin(a), math.cos(a)), A(1, 0, 0)], 1)


def leg_paint(sock_z=None, sock_ch=1, toe_ch=2, toe_z=0.05, rings=None, inner=0.3, ring_ch=1):
    """Legs: hide above, optional contrasting sock below sock_z, optional rings, coloured toe caps."""
    def fn(P, N, part):
        G = smoothstep(0.1, 0.8, N[:, 0] * np.sign(-P[:, 0] + 1e-9)) * inner + under(N) * 0.4
        B = np.zeros(len(P))
        if sock_z is not None:
            s = smoothstep(sock_z + 0.015, sock_z - 0.015, P[:, 2])
            if sock_ch == 1:
                G = np.maximum(G, s)
            else:
                B = np.maximum(B, s)
        if rings is not None:
            z0, z1, period = rings
            r = bands(P[:, 2], period, 0.45, soft=0.25) * smoothstep(z0 - 0.01, z0 + 0.01, P[:, 2]) \
                * smoothstep(z1 + 0.01, z1 - 0.01, P[:, 2])
            if ring_ch == 1:
                G = np.maximum(G * (1 - r), r)
            else:
                B = np.maximum(B, r)
        toe = smoothstep(toe_z + 0.012, toe_z - 0.008, P[:, 2]) * smoothstep(-0.2, 0.3, -N[:, 1])
        if toe_ch == 2:
            B = np.maximum(B, toe)
        elif toe_ch == 1:
            G = np.maximum(G, toe)
        return weights(G, B, 1 - 0.25 * toe)
    return fn



def near(P, c, r, mirror=True):
    """Points within r of c (mirrored across x = 0) - for glow masks."""
    Q = P.copy()
    if mirror:
        Q[:, 0] = np.abs(Q[:, 0])
    return np.linalg.norm(Q - np.asarray(c, float), axis=1) < r


def crystal_mesh(base, axis, length, r, sides=5, tip=0.34, twist=0.0):
    """Faceted crystal shard: a prism (sunk slightly below `base`) with a pointed tip, pointing along axis."""
    ax = np.asarray(axis, float)
    R = frame(ax / np.linalg.norm(ax))
    verts = []
    for z, rr in ((-0.08 * length, r * 0.85), ((1 - tip) * length, r)):
        for j in range(sides):
            a = 2 * math.pi * j / sides + twist
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    verts += [(0, 0, length), (0, 0, -0.08 * length)]
    V = np.array(verts) @ R.T + np.asarray(base, float)
    T = []
    for j in range(sides):
        j1 = (j + 1) % sides
        T += [(j, j1, sides + j1), (j, sides + j1, sides + j), (sides + j, sides + j1, 2 * sides), (j1, j, 2 * sides + 1)]
    return V.astype(F), np.array(T)


def crystal_cluster(base, up, specs):
    """Several shards from one base point: specs = [(tilt_x, tilt_y, length, radius, twist), ...] tilting off `up`."""
    meshes = []
    for tx, ty, ln, r, tw in specs:
        ax = np.asarray(up, float) + A(tx, ty, 0)
        meshes.append(crystal_mesh(np.asarray(base, float) + A(tx, ty, 0) * 0.04, ax, ln, r, twist=tw))
    V = np.concatenate([m[0] for m in meshes])
    offs = np.cumsum([0] + [len(m[0]) for m in meshes[:-1]])
    T = np.concatenate([m[1] + o for m, o in zip(meshes, offs)])
    return V, T


# =====================================================================================
# Creatures
# =====================================================================================
@creature
def quad_grazer_0():
    """Lantern-neck: plump tiger-striped barrel on stout pillar legs, a long swan neck carrying a small
    four-eyed head with two angler lures dangling glowing bulbs ahead of the face, rounded dorsal plates and a
    fan-finned tail."""
    body = Union(
        Ell((0, 0.0, 0.66), (0.22, 0.40, 0.21)),
        Ell((0, -0.22, 0.70), (0.21, 0.21, 0.21)),
        Ell((0, 0.25, 0.69), (0.205, 0.20, 0.20)),
        Ell((0, 0.0, 0.57), (0.18, 0.30, 0.14)),
        k=0.08)
    fl_pv, hl_pv = (-0.13, -0.25, 0.56), (-0.135, 0.27, 0.57)
    front = leg(fl_pv, (-0.15, -0.27, 0), 0.10, 0.095, 0.056, (0.082, 0.095, 0.05))
    hind = leg(hl_pv, (-0.15, 0.28, 0), 0.105, 0.10, 0.056, (0.082, 0.095, 0.05))

    neck_pv = (0, -0.30, 0.76)
    neck_pts = [neck_pv, (0, -0.40, 0.93), (0, -0.45, 1.08), (0, -0.48, 1.20), (0, -0.52, 1.28)]
    head = Union(
        Sphere(neck_pv, 0.13),
        tube(neck_pts, [0.12, 0.086, 0.07, 0.066, 0.066]),
        Ell((0, -0.555, 1.31), (0.088, 0.105, 0.082)),              # cranium
        Ell((0, -0.645, 1.285), (0.064, 0.075, 0.058)),              # snout
        Ell((0, -0.61, 1.25), (0.058, 0.085, 0.04)),                 # chin
        k=0.035)
    head = Sub(head, Mirror(ell_ab((0.028, -0.705, 1.262), (0.066, -0.62, 1.25), 0.0075, 0.0075)), k=0.006)
    lure_c = A(0.075, -0.775, 1.50)
    lures = Mirror(Union(
        tube([(0.032, -0.535, 1.37), (0.058, -0.55, 1.47), (0.074, -0.64, 1.545), (0.077, -0.73, 1.54),
              lure_c + (0, 0, 0.02)], [0.017, 0.013, 0.011, 0.01, 0.01]),
        Sphere(lure_c, 0.04), k=0.012))
    eyes = [((0.064, -0.605, 1.325), 0.036, look_dir(0.75, -0.55, 0.25)),
            ((0.048, -0.562, 1.38), 0.022, look_dir(0.55, -0.35, 0.75))]

    plates = []
    for y, h in ((-0.21, 0.14), (-0.05, 0.18), (0.11, 0.17), (0.26, 0.12)):
        c, n = surface_point(body, (0, y, 1.3), dirn=(0, 0, -1))
        plates.append(Ell(c + A(0, 0.02, h * 0.42), (0.032, 0.055 + h * 0.25, h * 0.72), euler(-14, 0, 0)))
    plates = Union(*plates)

    tail_pv = (0, 0.40, 0.70)
    tail_pts = [tail_pv, (0, 0.53, 0.67), (0, 0.65, 0.60), (0, 0.74, 0.53)]
    tail = Union(Sphere(tail_pv, 0.10), tube(tail_pts, [0.095, 0.07, 0.05, 0.04]), k=0.02)
    fin_o, fin_R = A(0, 0.715, 0.55), side_frame(28)
    fin_poly = [(0.0, 0.035), (0.07, 0.15), (0.16, 0.19), (0.25, 0.12), (0.28, 0.0), (0.25, -0.11), (0.16, -0.16),
                (0.07, -0.12), (0.0, -0.035)]
    fin = membrane_mesh(fin_poly, lambda x, y: 0.011 + 0 * x, lambda x, y: 0 * x, 0.03, fin_R, fin_o, rim_frac=0.6)

    def body_paint(P, N, part):
        z, y = P[:, 2], P[:, 1]
        belly = under(N, -0.15, 0.4) + smoothstep(0.60, 0.52, z)
        stripes = bands(y + 0.35 * (z - 0.66), 0.2, 0.4, soft=0.12) * smoothstep(0.64, 0.69, z)
        return weights(np.maximum(belly, stripes), np.zeros(len(P)))

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        throat = smoothstep(0.0, 0.5, -N[:, 1] - N[:, 2] * 0.5) * (y < -0.36)          # pale front of the neck
        rings = bands(seg_param(P, [(A(neck_pv), A(neck_pts[-1]))]), 0.24, 0.35, soft=0.3) * (z < 1.2) * (z > 0.86)
        muzzle = smoothstep(-0.62, -0.67, y) + under(N, 0.1, 0.5) * (z > 1.2)
        lure = smoothstep(1.39, 1.45, z) * (np.abs(P[:, 0]) > 0.02)
        return weights(np.maximum(throat, muzzle), np.maximum(rings * (1 - throat), lure))

    def plate_paint(P, N, part):
        tip = smoothstep(0.0, 0.06, P[:, 2] - (0.86 + 0.05))
        return weights(np.zeros(len(P)), 0.35 + 0.65 * tip)

    def fin_paint(P, N, part):
        L = (P - fin_o) @ fin_R
        ang = np.arctan2(L[:, 1], L[:, 0])
        rays = bands(ang, 0.42, 0.45, soft=0.3)
        return weights(rays, smoothstep(0.18, 0.24, np.linalg.norm(L[:, :2], axis=1)))

    def tail_paint(P, N, part):
        return weights(under(N, -0.1, 0.4), bands(P[:, 1], 0.1, 0.4) * smoothstep(0.45, 0.5, P[:, 1]))

    parts = [
        Part("body", body, 0, voxel=0.006, tris=1550, sym=True, paint=body_paint),
        Part("plates", plates, 0, voxel=0.0045, tris=340, sym=True, paint=plate_paint),
        Part("front_leg", front, 1, fl_pv, voxel=0.0045, tris=250, mirror=True,
             paint=leg_paint(sock_z=0.21, sock_ch=1, toe_ch=2)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.0045, tris=250, mirror=True,
             paint=leg_paint(sock_z=0.21, sock_ch=1, toe_ch=2)),
        Part("head", head, 6, neck_pv, voxel=0.0038, tris=820, sym=True, paint=head_paint),
        Part("lures", lures, 6, neck_pv, voxel=0.003, tris=300, sym=True, paint=head_paint,
             glow=lambda P: near(P, lure_c, 0.046)),
        Part("tail", tail, 5, tail_pv, voxel=0.005, tris=180, sym=True, paint=tail_paint),
        Part("tail_fin", None, 5, tail_pv, mesh=fin, paint=fin_paint, sharp=True, ao_min=0.55),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.3, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    parts += dots(body, [(-0.24, y, 0.635 + 0.05 * y) for y in (-0.22, -0.10, 0.02, 0.14, 0.26)], 0.024, 0.008,
                  dirn=(1, 0, 0))
    return dict(kind="walker", parts=parts, paint=None,
                palette=((0.16, 0.38, 0.46), (0.95, 0.86, 0.64), (1.0, 0.52, 0.16)), glow_col=(1.0, 0.6, 0.2))


@creature
def quad_grazer_1():
    """Hammerhead sail-back: round-bellied grazer on sturdy legs with a wide hammer head (an eye on each tip,
    two small front eyes and hooked mandibles), a tall ribbed sail with glowing rib tips, a dark saddle over
    spotted flanks and a long tail ending in a glowing bulb."""
    body = Union(
        Ell((0, -0.04, 0.80), (0.21, 0.33, 0.22)),
        Ell((0, -0.20, 0.84), (0.195, 0.19, 0.21)),
        Ell((0, 0.17, 0.79), (0.185, 0.18, 0.19)),
        Ell((0, -0.02, 0.69), (0.165, 0.26, 0.14)),
        k=0.07)
    fl_pv, hl_pv = (-0.125, -0.21, 0.70), (-0.125, 0.19, 0.70)
    front = leg(fl_pv, (-0.145, -0.225, 0), 0.10, 0.092, 0.055, (0.075, 0.09, 0.048))
    hind = leg(hl_pv, (-0.145, 0.205, 0), 0.105, 0.098, 0.055, (0.075, 0.09, 0.048))

    neck_pv = (0, -0.30, 0.90)
    knob_c = A(0.25, -0.51, 1.11)
    head = Union(
        Sphere(neck_pv, 0.135),
        tube([neck_pv, (0, -0.40, 1.0), (0, -0.46, 1.05)], [0.13, 0.115, 0.105]),
        Ell((0, -0.50, 1.10), (0.25, 0.08, 0.065)),                  # hammer bar
        Mirror(Sphere(knob_c, 0.072)),                                # eye knobs
        Ell((0, -0.58, 1.06), (0.11, 0.11, 0.095)),                  # face
        Ell((0, -0.65, 1.0), (0.08, 0.07, 0.06)),                    # muzzle
        Ell((0, -0.50, 1.16), (0.05, 0.08, 0.04)),                   # brow ridge
        k=0.035)
    head = Sub(head, Ell((0, -0.715, 0.99), (0.042, 0.02, 0.012)), k=0.006)
    mandibles = Mirror(tube([(0.06, -0.66, 0.98), (0.092, -0.72, 0.965), (0.076, -0.79, 0.96), (0.04, -0.815, 0.966)],
                            [0.024, 0.019, 0.013, 0.006], n=6))
    eyes = [((0.275, -0.555, 1.125), 0.048, look_dir(0.55, -0.8, 0.2)),
            ((0.05, -0.668, 1.085), 0.022, look_dir(0.3, -0.92, 0.2))]

    # tall sail along the spine: scalloped membrane between four ribs with glowing ball tips
    sail_o, sail_R = A(0, -0.27, 0.95), side_frame(0)
    ribs_xy = [(0.06, 0.38), (0.18, 0.45), (0.30, 0.41), (0.42, 0.31)]
    sail_poly = [(-0.02, 0.0), (0.0, 0.2)]
    for i, (px, py) in enumerate(ribs_xy):
        sail_poly.append((px + 0.02, py))
        if i < len(ribs_xy) - 1:
            nx, ny = ribs_xy[i + 1]
            sail_poly.append(((px + nx) / 2 + 0.02, min(py, ny) * 0.8))
    sail_poly += [(0.50, 0.16), (0.55, 0.0)]
    sail = membrane_mesh(sail_poly, lambda x, y: 0.011 + 0 * x, lambda x, y: 0 * x, 0.036, sail_R, sail_o, rim_frac=0.6)
    rib_tips = [sail_o + A(0, px + 0.02, py) for px, py in ribs_xy]
    ribs = Union(*[RoundCone(sail_o + A(0, px, 0.0), t, 0.028, 0.014) for (px, py), t in zip(ribs_xy, rib_tips)],
                 *[Sphere(t, 0.026) for t in rib_tips], k=0.01)

    tail_pv = (0, 0.32, 0.82)
    tail_pts = [tail_pv, (0, 0.48, 0.76), (0, 0.63, 0.66), (0, 0.76, 0.62), (0, 0.86, 0.66)]
    bulb_c = A(0, 0.90, 0.70)
    tail = Union(Sphere(tail_pv, 0.09), tube(tail_pts, [0.085, 0.06, 0.045, 0.036, 0.034]), Sphere(bulb_c, 0.07), k=0.025)

    flank_spots = surf_spots(body, [((0.25, -0.17, 0.82), 0.07), ((0.25, 0.01, 0.80), 0.075), ((0.25, 0.18, 0.80), 0.06),
                                    ((0.25, -0.30, 0.78), 0.045), ((0.25, 0.30, 0.76), 0.04)],
                             dirn=(-1, 0, 0))

    def body_paint(P, N, part):
        z, y = P[:, 2], P[:, 1]
        belly = under(N, -0.1, 0.4) * smoothstep(0.72, 0.66, z)
        saddle = smoothstep(0.88, 0.91, z + 0.025 * np.sin(y * 26)) * smoothstep(0.34, 0.28, np.abs(y + 0.03))
        return weights(np.maximum(belly, saddle), spot_mask(P, flank_spots) * (1 - saddle))

    def head_paint(P, N, part):
        y, z, ax = P[:, 1], P[:, 2], np.abs(P[:, 0])
        top = smoothstep(0.15, 0.5, N[:, 2]) * smoothstep(1.13, 1.16, z) * (ax < 0.22)
        muzzle = smoothstep(-0.63, -0.67, y) * smoothstep(1.05, 1.02, z)
        knob = smoothstep(0.2, 0.23, ax) * (z > 1.0)
        return weights(np.maximum(top, muzzle * 0.0), np.maximum(knob, muzzle))

    def sail_paint(P, N, part):
        L = (P - sail_o) @ sail_R
        st = bands(L[:, 0], 0.12, 0.5, soft=0.2, phase=0.25)
        return weights(st * smoothstep(0.08, 0.12, L[:, 1]), smoothstep(0.22, 0.3, L[:, 1]))

    def tail_paint(P, N, part):
        y = P[:, 1]
        r = bands(y, 0.12, 0.45, soft=0.15) * smoothstep(0.40, 0.44, y)
        return weights(r * (y < 0.82) + under(N, 0.0, 0.5) * 0.5, smoothstep(0.82, 0.84, y))

    parts = [
        Part("body", body, 0, voxel=0.006, tris=1500, sym=True, paint=body_paint),
        Part("sail", None, 0, mesh=sail, paint=sail_paint, sharp=True, ao_min=0.55),
        Part("sail_ribs", ribs, 0, voxel=0.0035, tris=240, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), np.ones(len(P))),
             glow=lambda P: np.min([np.linalg.norm(P - t, axis=1) for t in rib_tips], 0) < 0.03),
        Part("front_leg", front, 1, fl_pv, voxel=0.0042, tris=290, mirror=True,
             paint=leg_paint(sock_z=0.26, sock_ch=1, toe_ch=2)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.0042, tris=290, mirror=True,
             paint=leg_paint(sock_z=0.26, sock_ch=1, toe_ch=2)),
        Part("head", head, 6, neck_pv, voxel=0.0038, tris=820, sym=True, paint=head_paint),
        Part("mandibles", mandibles, 6, neck_pv, voxel=0.003, tris=150, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.2, smoothstep(-0.75, -0.80, P[:, 1]))),
        Part("tail", tail, 5, tail_pv, voxel=0.0042, tris=320, sym=True, paint=tail_paint,
             glow=lambda P: np.linalg.norm(P - bulb_c, axis=1) < 0.08),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.0, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    return dict(kind="walker", parts=parts, paint=None,
                palette=((0.55, 0.24, 0.45), (0.18, 0.13, 0.28), (0.30, 0.95, 0.80)), glow_col=(0.3, 1.0, 0.85))


@creature
def quad_heavy_0():
    """Shellback ram: a tank under a domed carapace of raised scutes split by glowing seams, short elephantine
    legs, a low broad head with two forward-curving ram horns and four eyes, and a spiked club tail."""
    body = Union(
        Ell((0, 0.0, 0.58), (0.29, 0.44, 0.25)),
        Ell((0, -0.30, 0.56), (0.25, 0.20, 0.22)),
        Ell((0, 0.28, 0.56), (0.26, 0.20, 0.22)),
        k=0.08)
    sc, sr = A(0, 0.0, 0.60), A(0.40, 0.56, 0.36)
    dome = Inter(Ell(sc, sr), Plane((0, 0, -1), -0.57), k=0.035)
    scutes = []
    for x, ys in ((0.0, (-0.36, -0.12, 0.12, 0.36)), (0.2, (-0.24, 0.0, 0.24)), (0.325, (-0.30, -0.10, 0.10, 0.30))):
        for y in ys:
            for sx in ((1,) if x == 0 else (1, -1)):
                q = A(sx * x, y, 0)
                z = sc[2] + sr[2] * math.sqrt(max(0.0, 1 - (q[0] / sr[0]) ** 2 - (q[1] / sr[1]) ** 2))
                p = A(q[0], q[1], z)
                n = (p - sc) / sr ** 2
                n /= np.linalg.norm(n)
                scutes.append((p, n))
    cells = np.array([p for p, n in scutes], F)

    def cell_gap(P):
        # distance to the nearest scute border (second-nearest minus nearest centre distance): Voronoi plates
        D = np.sort(np.sqrt(((P[:, None, :] - cells[None, :, :]) ** 2).sum(2)), axis=1)
        return D[:, 1] - D[:, 0]

    shell = Displace(dome, lambda P: (F(-0.032) * smoothstep(F(0.0), F(0.05), cell_gap(P))).astype(F), 0.035)
    crystals = []
    for y, s in ((-0.22, 0.85), (0.04, 1.0), (0.30, 0.75)):
        z = sc[2] + sr[2] * math.sqrt(1 - (y / sr[1]) ** 2)
        crystals.append(crystal_cluster((0, y, z - 0.02), (0, 0.25, 1), [(0, 0, 0.34 * s, 0.065 * s, 0.3), (0.55, 0.15, 0.2 * s, 0.045 * s, 0.9),
                                                                (-0.55, 0.15, 0.2 * s, 0.045 * s, 1.7), (0.1, -0.5, 0.15 * s, 0.035 * s, 0.1)]))
    crystals = (np.concatenate([c[0] for c in crystals]),
                np.concatenate([c[1] + o for c, o in zip(crystals, np.cumsum([0] + [len(c[0]) for c in crystals[:-1]]))]))

    fl_pv, hl_pv = (-0.19, -0.27, 0.46), (-0.19, 0.29, 0.46)
    front = leg(fl_pv, (-0.21, -0.285, 0), 0.13, 0.13, 0.095, (0.12, 0.12, 0.06), toe_r=0.045)
    hind = leg(hl_pv, (-0.21, 0.30, 0), 0.13, 0.13, 0.095, (0.12, 0.12, 0.06), toe_r=0.045)

    neck_pv = (0, -0.40, 0.56)
    head = Union(
        Sphere(neck_pv, 0.17),
        tube([neck_pv, (0, -0.52, 0.54)], [0.17, 0.16]),
        Ell((0, -0.62, 0.53), (0.18, 0.15, 0.15)),                   # skull
        Ell((0, -0.745, 0.47), (0.13, 0.10, 0.10)),                  # snout
        Ell((0, -0.66, 0.42), (0.14, 0.14, 0.07)),                   # jaw
        k=0.04)
    head = Sub(head, Mirror(Ell((0.045, -0.84, 0.49), (0.018, 0.015, 0.022))),
               Mirror(ell_ab((0.03, -0.83, 0.42), (0.12, -0.72, 0.42), 0.009, 0.009)), k=0.008)
    horn_root = A(0.12, -0.64, 0.63)
    horns = Mirror(Union(
        Sphere(horn_root, 0.06),
        tube([horn_root, (0.17, -0.75, 0.69), (0.185, -0.88, 0.67), (0.16, -0.99, 0.61)], [0.058, 0.046, 0.03, 0.01], n=6),
        k=0.02))
    eyes = [((0.135, -0.725, 0.555), 0.032, look_dir(0.7, -0.65, 0.2)),
            ((0.095, -0.772, 0.595), 0.021, look_dir(0.4, -0.85, 0.35))]

    tail_pv = (0, 0.44, 0.55)
    club_c = A(0, 0.79, 0.40)
    spike_tips = [club_c + A(0, 0.03, 0.19), club_c + A(0.18, 0.02, 0.04), club_c + A(-0.18, 0.02, 0.04), club_c + A(0, 0.19, 0.0)]
    tail = Union(Sphere(tail_pv, 0.11), tube([tail_pv, (0, 0.58, 0.48), (0, 0.70, 0.42)], [0.105, 0.08, 0.065]),
                 Sphere(club_c, 0.105), *[RoundCone(club_c, t, 0.06, 0.008) for t in spike_tips], k=0.025)

    def seam(P):
        return smoothstep(0.03, 0.012, cell_gap(P.astype(F))) * smoothstep(0.62, 0.66, P[:, 2])

    def shell_paint(P, N, part):
        rim = smoothstep(0.64, 0.6, P[:, 2])
        return weights(rim, seam(P) * (1 - rim))

    def body_paint(P, N, part):
        return weights(0.7 + 0.3 * under(N), np.zeros(len(P)))

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        top = smoothstep(0.1, 0.5, N[:, 2]) * smoothstep(0.55, 0.6, z) * smoothstep(-0.8, -0.72, y)
        return weights(1 - top, np.zeros(len(P)))

    parts = [
        Part("shell", shell, 0, voxel=0.0065, tris=1500, sym=True, paint=shell_paint),
        Part("crystals", None, 0, mesh=crystals, sharp=25, ao_min=0.5,
             paint=lambda P, N, p: weights(np.zeros(len(P)), np.ones(len(P))), glow=1.0),
        Part("body", body, 0, voxel=0.008, tris=500, sym=True, paint=body_paint),
        Part("front_leg", front, 1, fl_pv, voxel=0.0055, tris=250, mirror=True,
             paint=leg_paint(sock_z=0.2, sock_ch=1, toe_ch=2, toe_z=0.07, inner=0.2)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.0055, tris=250, mirror=True,
             paint=leg_paint(sock_z=0.2, sock_ch=1, toe_ch=2, toe_z=0.07, inner=0.2)),
        Part("head", head, 6, neck_pv, voxel=0.0045, tris=800, sym=True, paint=head_paint),
        Part("horns", horns, 6, neck_pv, voxel=0.0038, tris=300, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.15, smoothstep(-0.86, -0.95, P[:, 1]))),
        Part("tail", tail, 5, tail_pv, voxel=0.005, tris=360, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.7,
                                           np.max([smoothstep(0.09, 0.05, np.linalg.norm(P - t, axis=1)) for t in spike_tips], 0))),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.0, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    return dict(kind="walker", parts=parts, paint=None, ao_dist=0.4,
                palette=((0.28, 0.42, 0.30), (0.80, 0.70, 0.52), (1.0, 0.45, 0.15)), glow_col=(1.0, 0.5, 0.2))


@creature
def quad_heavy_1():
    """Bigmouth bruiser: a squat tiger-striped hulk with a head as big as its body, a wide grinning underbite
    with two upturned tusks, three eyes on top of the skull, a row of thick back spines and a knob tail."""
    body = Union(
        Ell((0, 0.05, 0.62), (0.30, 0.38, 0.27)),
        Ell((0, -0.16, 0.74), (0.29, 0.22, 0.24)),                   # shoulder hump
        Ell((0, 0.30, 0.56), (0.24, 0.19, 0.22)),                    # rump
        Ell((0, 0.02, 0.48), (0.24, 0.30, 0.15)),                    # belly
        k=0.09)
    fl_pv, hl_pv = (-0.20, -0.18, 0.56), (-0.18, 0.31, 0.46)
    front = leg(fl_pv, (-0.225, -0.20, 0), 0.14, 0.135, 0.09, (0.11, 0.115, 0.055), toe_r=0.042)
    hind = leg(hl_pv, (-0.20, 0.32, 0), 0.13, 0.125, 0.085, (0.10, 0.11, 0.055), toe_r=0.04)

    neck_pv = (0, -0.32, 0.70)
    head = Union(
        Sphere(neck_pv, 0.2),
        Ell((0, -0.56, 0.71), (0.30, 0.26, 0.22)),                   # skull
        Ell((0, -0.61, 0.54), (0.285, 0.25, 0.13)),                  # underbite jaw
        Mirror(Ell((0.13, -0.66, 0.875), (0.075, 0.075, 0.06))),     # side eye bumps
        Ell((0, -0.70, 0.895), (0.085, 0.08, 0.07)),                 # central eye bump
        k=0.06)
    head = Sub(head, Inter(Ell((0, -0.585, 0.615), (0.295, 0.28, 0.016)), Plane((0, 1, 0), -0.56), k=0.01), k=0.008)
    tusk_tips = [A(0.165, -0.775, 0.84)]
    tusks = Mirror(tube([(0.18, -0.74, 0.56), (0.21, -0.79, 0.67), (0.195, -0.80, 0.77), tusk_tips[0]],
                        [0.048, 0.038, 0.024, 0.009], n=6))
    eyes = [((0, -0.765, 0.915), 0.052, look_dir(0, -0.88, 0.45), False),
            ((0.15, -0.72, 0.895), 0.034, look_dir(0.6, -0.7, 0.4), True)]

    spines, spine_tips = [], []
    for y, ln in ((-0.28, 0.20), (-0.12, 0.26), (0.04, 0.25), (0.19, 0.2), (0.33, 0.13)):
        c, n = surface_point(body, (0, y, 1.3), dirn=(0, 0, -1))
        tip = c + look_dir(0, 0.55, 0.84) * ln
        spines.append(RoundCone(c - n * 0.03, tip, 0.055, 0.012))
        spine_tips.append(tip)
    spines = Union(*spines)

    tail_pv = (0, 0.46, 0.60)
    knob_c = A(0, 0.66, 0.60)
    tail = Union(Sphere(tail_pv, 0.09), tube([tail_pv, (0, 0.56, 0.63), knob_c], [0.085, 0.06, 0.05]),
                 Sphere(knob_c + (0, 0.03, 0.01), 0.075), k=0.03)

    def stripes(P, N):
        y, z = P[:, 1], P[:, 2]
        return bands(y - 0.4 * np.abs(P[:, 0]), 0.16, 0.44, soft=0.12) * smoothstep(0.55, 0.65, z) * smoothstep(-0.4, 0.1, N[:, 2])

    def body_paint(P, N, part):
        belly = under(N, -0.1, 0.4) * smoothstep(0.62, 0.55, P[:, 2])
        return weights(np.maximum(belly, stripes(P, N)), np.zeros(len(P)))

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        jaw = smoothstep(0.62, 0.58, z) * smoothstep(-0.5, -0.56, y)
        brow = bands(np.abs(P[:, 0]), 0.14, 0.4, soft=0.15, phase=0.5) * smoothstep(0.8, 0.86, z) * smoothstep(-0.62, -0.5, y)
        bumps = smoothstep(0.86, 0.9, z) * smoothstep(-0.6, -0.66, y)
        return weights(np.maximum(jaw, brow), bumps)

    parts = [
        Part("body", body, 0, voxel=0.007, tris=1350, sym=True, paint=body_paint),
        Part("spines", spines, 0, voxel=0.0045, tris=320, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), np.max([smoothstep(0.12, 0.05, np.linalg.norm(P - t, axis=1))
                                                                     for t in spine_tips], 0)),
             glow=lambda P: np.min([np.linalg.norm(P - t, axis=1) for t in spine_tips], 0) < 0.05),
        Part("front_leg", front, 1, fl_pv, voxel=0.0055, tris=260, mirror=True,
             paint=leg_paint(rings=(0.22, 0.5, 0.11), toe_ch=2, toe_z=0.065, inner=0.2)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.0055, tris=250, mirror=True,
             paint=leg_paint(rings=(0.18, 0.4, 0.11), toe_ch=2, toe_z=0.065, inner=0.2)),
        Part("head", head, 6, neck_pv, voxel=0.005, tris=1050, sym=True, paint=head_paint),
        Part("tusks", tusks, 6, neck_pv, voxel=0.0038, tris=220, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)), smoothstep(0.74, 0.82, P[:, 2]))),
        Part("tail", tail, 5, tail_pv, voxel=0.005, tris=200, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.64, 0.68, P[:, 1])),
             glow=lambda P: P[:, 1] > 0.66),
    ]
    for c, r, lk, mir in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.25, mirror=mir, seg=10, rings=7))
    parts += dots(head, [(-0.3, y, 0.66) for y in (-0.48, -0.58, -0.68)], [0.022, 0.026, 0.022], 0.008, limb=6,
                  pivot=neck_pv, name="cheek", dirn=(1, 0, 0))
    return dict(kind="walker", parts=parts, paint=None, ao_dist=0.4,
                palette=((0.62, 0.36, 0.22), (0.18, 0.14, 0.16), (0.40, 0.95, 0.35)), glow_col=(0.45, 1.0, 0.35))


@creature
def quad_small_0():
    """Puff-cyclops: a fluffy-round critter with one huge eye (and two tiny ones), a smile, two long floppy
    antenna-ears with glowing bulbs, stubby legs on round feet, polka-dot hide and a curled pom-pom tail."""
    body = Union(
        Ell((0, 0.06, 0.53), (0.30, 0.33, 0.29)),
        Ell((0, 0.06, 0.40), (0.24, 0.28, 0.16)),
        k=0.08)
    fl_pv, hl_pv = (-0.15, -0.14, 0.32), (-0.16, 0.24, 0.32)
    front = leg(fl_pv, (-0.17, -0.16, 0), 0.09, 0.085, 0.05, (0.075, 0.085, 0.045), toe_r=0.032)
    hind = leg(hl_pv, (-0.18, 0.25, 0), 0.095, 0.09, 0.05, (0.075, 0.085, 0.045), toe_r=0.032)

    neck_pv = (0, -0.12, 0.62)
    head_c = A(0, -0.25, 0.70)
    bulb_c = A(0.30, 0.12, 1.14)
    head = Union(
        Sphere(neck_pv, 0.2),
        Sphere(head_c, 0.245),
        Mirror(Ell((0.13, -0.38, 0.60), (0.08, 0.08, 0.07))),       # cheeks
        k=0.05)
    head = Sub(head, Sphere((0, -0.475, 0.74), 0.098),               # socket for the big eye
               tube([(-0.085, -0.448, 0.605), (0, -0.476, 0.578), (0.085, -0.448, 0.605)], [0.011, 0.012, 0.011]), k=0.012)
    ears = Mirror(Union(
        tube([(0.08, -0.24, 0.92), (0.15, -0.18, 1.10), (0.23, -0.04, 1.20), (0.29, 0.08, 1.17), bulb_c],
             [0.034, 0.028, 0.022, 0.02, 0.02], n=6),
        Sphere(bulb_c, 0.055), k=0.015))
    eyes = [((0, -0.47, 0.745), 0.10, look_dir(0, -1, 0.12), False, 12, 9),
            ((0.155, -0.415, 0.665), 0.036, look_dir(0.55, -0.8, 0.2), True, 8, 5)]

    tail_pv = (0, 0.36, 0.55)
    pom_c = A(0, 0.43, 0.82)
    tail = Union(Sphere(tail_pv, 0.075), tube([tail_pv, (0, 0.48, 0.62), (0, 0.52, 0.74), (0, 0.47, 0.80)],
                                              [0.07, 0.05, 0.042, 0.04]), Sphere(pom_c, 0.075), k=0.025)

    body_spots = surf_spots(body, [((0.32, -0.04, 0.58), 0.10), ((0.30, 0.20, 0.66), 0.085), ((0.28, 0.14, 0.40), 0.065),
                                   ((0.16, 0.06, 0.88), 0.09), ((0.0, 0.28, 0.80), 0.08), ((0.2, 0.36, 0.52), 0.06),
                                   ((0.27, -0.14, 0.80), 0.06)], dirn=None)

    def body_paint(P, N, part):
        return weights(np.maximum(under(N, -0.2, 0.3), spot_mask(P, body_spots, soft=0.2)), np.zeros(len(P)))

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        face = smoothstep(-0.36, -0.42, y) * smoothstep(0.84, 0.78, z) + under(N, -0.1, 0.4)
        ring = smoothstep(0.15, 0.11, np.linalg.norm(P - (0, -0.47, 0.745), axis=1))
        ear = smoothstep(0.93, 0.98, z)
        return weights(face, np.maximum(ring, ear))

    parts = [
        Part("body", body, 0, voxel=0.006, tris=1300, sym=True, paint=body_paint),
        Part("front_leg", front, 1, fl_pv, voxel=0.004, tris=240, mirror=True,
             paint=leg_paint(sock_z=0.1, sock_ch=1, toe_ch=2, toe_z=0.05)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.004, tris=240, mirror=True,
             paint=leg_paint(sock_z=0.1, sock_ch=1, toe_ch=2, toe_z=0.05)),
        Part("head", head, 6, neck_pv, voxel=0.0045, tris=1000, sym=True, paint=head_paint),
        Part("ears", ears, 6, neck_pv, voxel=0.0035, tris=380, sym=True, paint=head_paint,
             glow=lambda P: near(P, bulb_c, 0.06)),
        Part("tail", tail, 5, tail_pv, voxel=0.004, tris=260, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.72, 0.76, P[:, 2])),
             glow=lambda P: np.linalg.norm(P - pom_c, axis=1) < 0.08),
    ]
    for c, r, lk, mir, sg, rg in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.0, mirror=mir, seg=sg, rings=rg))
    return dict(kind="walker", parts=parts, paint=None,
                palette=((0.85, 0.55, 0.65), (0.98, 0.94, 0.82), (0.25, 0.55, 1.0)), glow_col=(0.4, 0.7, 1.0))


@creature
def quad_small_1():
    """Pincer scuttler: a low armoured critter of banded body segments with a glowing dot on each, big hooked
    pincer mandibles, four eyes, swept-back glowing antennae, short clawed legs and a flat paddle tail."""
    segs = [(-0.17, 0.40, 0.19, 0.15, 0.15), (0.0, 0.41, 0.205, 0.15, 0.16), (0.17, 0.40, 0.19, 0.145, 0.15),
            (0.32, 0.38, 0.15, 0.12, 0.12)]
    body = Union(*[Ell((0, y, z), (rx, ry, rz)) for y, z, rx, ry, rz in segs],
                 Ell((0, 0.06, 0.33), (0.15, 0.36, 0.1)), k=0.035)
    fl_pv, hl_pv = (-0.13, -0.13, 0.30), (-0.13, 0.21, 0.30)
    front = leg(fl_pv, (-0.155, -0.15, 0), 0.075, 0.068, 0.04, (0.06, 0.07, 0.035), claw=0.022, toe_r=0.022)
    hind = leg(hl_pv, (-0.155, 0.225, 0), 0.075, 0.068, 0.04, (0.06, 0.07, 0.035), claw=0.022, toe_r=0.022)

    neck_pv = (0, -0.25, 0.40)
    ant_tip = A(0.21, -0.16, 0.76)
    head = Union(
        Sphere(neck_pv, 0.12),
        Ell((0, -0.37, 0.43), (0.165, 0.14, 0.12)),
        Ell((0, -0.47, 0.39), (0.11, 0.08, 0.075)),
        Mirror(Ell((0.085, -0.44, 0.50), (0.05, 0.05, 0.04))),       # eye turrets
        k=0.03)
    antennae = Mirror(Union(
        tube([(0.05, -0.42, 0.52), (0.09, -0.42, 0.64), (0.15, -0.32, 0.74), ant_tip], [0.013, 0.011, 0.009, 0.008], n=6),
        Sphere(ant_tip, 0.026), k=0.008))
    mandibles = Mirror(Union(
        tube([(0.07, -0.50, 0.36), (0.13, -0.60, 0.355), (0.115, -0.71, 0.36), (0.05, -0.76, 0.37)],
             [0.034, 0.028, 0.018, 0.007], n=6),
        RoundCone((0.125, -0.64, 0.355), (0.085, -0.655, 0.35), 0.012, 0.004), k=0.008))
    eyes = [((0.092, -0.465, 0.52), 0.036, look_dir(0.55, -0.7, 0.45)),
            ((0.05, -0.53, 0.45), 0.02, look_dir(0.35, -0.9, 0.2))]

    tail_pv = (0, 0.40, 0.37)
    fl_o = A(0, 0.50, 0.33)
    tail = Union(Sphere(tail_pv, 0.075), tube([tail_pv, (0, 0.47, 0.35), fl_o], [0.07, 0.05, 0.04]), k=0.02)
    fluke_poly = [(0.0, -0.02), (0.09, 0.03), (0.15, 0.13), (0.10, 0.19), (0.04, 0.15), (0.0, 0.17), (-0.04, 0.15),
                  (-0.10, 0.19), (-0.15, 0.13), (-0.09, 0.03)]
    fluke = membrane_mesh(fluke_poly, lambda x, y: 0.012 + 0 * x, lambda x, y: -0.15 * y, 0.028, None, fl_o, rim_frac=0.6)

    def body_paint(P, N, part):
        y = P[:, 1]
        seg_band = ((y > -0.085) & (y < 0.085)) | (y > 0.25)
        G = np.where(seg_band, 1.0, 0.0) * smoothstep(-0.3, 0.2, N[:, 2]) + under(N, 0.0, 0.5)
        return weights(G, np.zeros(len(P)))

    def head_paint(P, N, part):
        G = under(N, -0.1, 0.4) + smoothstep(-0.46, -0.5, P[:, 1]) * 0.8
        tur = smoothstep(0.48, 0.5, P[:, 2]) * smoothstep(0.04, 0.06, np.abs(P[:, 0]))
        return weights(G, tur)

    parts = [
        Part("body", body, 0, voxel=0.005, tris=1350, sym=True, paint=body_paint),
        Part("front_leg", front, 1, fl_pv, voxel=0.0035, tris=260, mirror=True,
             paint=leg_paint(sock_z=0.12, sock_ch=2, toe_ch=1, toe_z=0.04)),
        Part("hind_leg", hind, 3, hl_pv, voxel=0.0035, tris=260, mirror=True,
             paint=leg_paint(sock_z=0.12, sock_ch=2, toe_ch=1, toe_z=0.04)),
        Part("head", head, 6, neck_pv, voxel=0.0035, tris=800, sym=True, paint=head_paint),
        Part("mandibles", mandibles, 6, neck_pv, voxel=0.003, tris=260, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.3, smoothstep(-0.66, -0.74, P[:, 1]))),
        Part("antennae", antennae, 6, neck_pv, voxel=0.0026, tris=200, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.66, 0.72, P[:, 2])),
             glow=lambda P: near(P, ant_tip, 0.032)),
        Part("tail", tail, 5, tail_pv, voxel=0.004, tris=150, sym=True, paint=lambda P, N, p: weights(under(N), np.zeros(len(P)))),
        Part("fluke", None, 5, tail_pv, mesh=fluke, sharp=True, ao_min=0.6,
             paint=lambda P, N, p: weights(bands(np.linalg.norm(P[:, :2] - fl_o[:2], axis=1), 0.07, 0.4, soft=0.3),
                                           smoothstep(0.15, 0.18, np.linalg.norm(P[:, :2] - fl_o[:2], axis=1)))),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.3, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    parts += dots(body, [(0, y, 0.7) for y, *_ in segs], [0.028, 0.03, 0.028, 0.022], 0.01, dirn=(0, 0, -1),
                  mirror=False, name="sdot")
    return dict(kind="walker", parts=parts, paint=None,
                palette=((0.30, 0.50, 0.20), (0.92, 0.82, 0.40), (0.95, 0.35, 0.65)), glow_col=(1.0, 0.4, 0.75))


@creature
def biped_0():
    """Frill-gourd strider: an upright gourd of a body on two thick legs with big clawed feet, a beaky four-eyed
    head framed by a ribbed fan frill with glowing rib tips, stubby little arms, a banded belly shield and a
    short bulb tail."""
    body = Union(
        Ell((0, 0.0, 1.0), (0.25, 0.24, 0.33)),
        Ell((0, -0.05, 0.90), (0.22, 0.2, 0.26)),
        Ell((0, 0.04, 0.80), (0.24, 0.2, 0.18)),
        k=0.08)
    arm_hand = A(0.235, -0.27, 0.95)
    arms = Mirror(Union(Sphere((0.20, -0.10, 1.10), 0.055),
                        tube([(0.20, -0.10, 1.10), (0.25, -0.19, 1.02), arm_hand], [0.05, 0.04, 0.036]),
                        *[RoundCone(arm_hand, arm_hand + A(dx, -0.05, -0.03), 0.02, 0.006) for dx in (-0.02, 0.02)],
                        k=0.02))
    body = Union(body, arms, k=0.03)
    l_pv = (-0.14, 0.04, 0.74)
    leg_ = leg(l_pv, (-0.16, 0.0, 0), 0.125, 0.12, 0.062, (0.09, 0.13, 0.055), toe_r=0.038, claw=0.035)

    neck_pv = (0, -0.06, 1.24)
    fr_o = A(0, -0.06, 1.43)
    head = Union(
        Sphere(neck_pv, 0.15),
        Ell((0, -0.13, 1.42), (0.17, 0.16, 0.15)),
        Ell((0, -0.29, 1.385), (0.12, 0.11, 0.07)),                  # upper beak
        Ell((0, -0.27, 1.32), (0.10, 0.10, 0.045)),                  # lower beak
        Mirror(Ell((0.10, -0.22, 1.50), (0.06, 0.06, 0.045))),       # brow bumps
        k=0.035)
    head = Sub(head, Ell((0, -0.30, 1.348), (0.11, 0.1, 0.008)), k=0.006)
    eyes = [((0.112, -0.245, 1.47), 0.043, look_dir(0.6, -0.75, 0.2)),
            ((0.07, -0.255, 1.535), 0.024, look_dir(0.35, -0.75, 0.55))]
    # fan frill behind the head, tilted back 25 degrees, facing forward
    a = math.radians(25)
    fr_R = np.stack([A(1, 0, 0), A(0, math.sin(a), math.cos(a)), A(0, -math.cos(a), math.sin(a))], 1)
    lobes = np.radians(np.linspace(-96, 96, 7))
    fr_poly = [(0.06 * math.sin(-1.75), 0.06 * math.cos(-1.75))]
    for i, la in enumerate(lobes):
        for da, rr in ((-0.09, 0.33), (0.0, 0.36), (0.09, 0.33)):
            fr_poly.append((rr * math.sin(la + da), rr * math.cos(la + da)))
        if i < len(lobes) - 1:
            ma = 0.5 * (la + lobes[i + 1])
            fr_poly.append((0.27 * math.sin(ma), 0.27 * math.cos(ma)))
    fr_poly += [(0.06 * math.sin(1.75), 0.06 * math.cos(1.75)), (0.0, -0.05)]
    frill = membrane_mesh(fr_poly, lambda x, y: 0.011 + 0 * x, lambda x, y: 0.05 * (x * x + y * y), 0.034, fr_R, fr_o,
                          rim_frac=0.6)
    rib_tips = [fr_o + fr_R @ A(0.355 * math.sin(la), 0.355 * math.cos(la), 0.05 * 0.355 ** 2 + 0.01) for la in lobes]
    ribs = Union(*[RoundCone(fr_o + fr_R @ A(0.05 * math.sin(la), 0.05 * math.cos(la), 0.01), t, 0.02, 0.012)
                   for la, t in zip(lobes, rib_tips)], *[Sphere(t, 0.022) for t in rib_tips], k=0.008)

    tail_pv = (0, 0.18, 0.86)
    bulb_c = A(0, 0.52, 0.60)
    tail = Union(Sphere(tail_pv, 0.13), tube([tail_pv, (0, 0.33, 0.74), (0, 0.46, 0.65)], [0.12, 0.085, 0.06]),
                 Sphere(bulb_c, 0.095), k=0.03)

    def body_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        shield = smoothstep(0.15, 0.35, -N[:, 1] - 0.4 * np.abs(N[:, 0])) * smoothstep(0.6, 0.66, z) * smoothstep(1.2, 1.14, z)
        rows = shield
        back = bands(z + 0.3 * np.abs(P[:, 0]), 0.14, 0.4, soft=0.15) * smoothstep(0.0, 0.3, N[:, 1]) * smoothstep(0.75, 0.85, z)
        hand = smoothstep(-0.25, -0.29, y) * (np.abs(P[:, 0]) > 0.18)
        return weights(np.maximum(rows, under(N, 0.0, 0.5)), np.maximum(back, hand))

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        beak = smoothstep(-0.22, -0.27, y) * smoothstep(1.43, 1.40, z)
        brow = smoothstep(1.49, 1.53, z) * smoothstep(0.03, 0.06, np.abs(P[:, 0]))
        return weights(np.maximum(beak, under(N, 0.0, 0.5)), brow)

    def frill_paint(P, N, part):
        L = (P - fr_o) @ fr_R
        r = np.linalg.norm(L[:, :2], axis=1)
        ang = np.arctan2(L[:, 0], L[:, 1])
        rays = bands(ang, (lobes[1] - lobes[0]), 0.5, soft=0.25, phase=0.5)
        return weights(rays * smoothstep(0.1, 0.14, r), smoothstep(0.25, 0.29, r))

    parts = [
        Part("body", body, 0, voxel=0.0065, tris=1650, sym=True, paint=body_paint),
        Part("leg", leg_, 1, l_pv, voxel=0.0045, tris=520, mirror=True,
             paint=leg_paint(sock_z=0.3, sock_ch=1, toe_ch=2, toe_z=0.06, inner=0.2)),
        Part("head", head, 6, neck_pv, voxel=0.0042, tris=900, sym=True, paint=head_paint),
        Part("frill", None, 6, neck_pv, mesh=frill, paint=frill_paint, sharp=True, ao_min=0.55),
        Part("frill_ribs", ribs, 6, neck_pv, voxel=0.0032, tris=420, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), np.ones(len(P))),
             glow=lambda P: np.min([np.linalg.norm(P - t, axis=1) for t in rib_tips], 0) < 0.026),
        Part("tail", tail, 5, tail_pv, voxel=0.005, tris=260, sym=True,
             paint=lambda P, N, p: weights(under(N), smoothstep(0.42, 0.45, P[:, 1])),
             glow=lambda P: np.linalg.norm(P - bulb_c, axis=1) < 0.105),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.0, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    return dict(kind="biped", parts=parts, paint=None, height=1.8,
                palette=((0.30, 0.45, 0.70), (0.95, 0.85, 0.55), (0.95, 0.30, 0.45)), glow_col=(1.0, 0.4, 0.55))


@creature
def biped_1():
    """Sail-backed lancer: a horizontal-bodied runner with a tall striped dorsal sail, a long head with two
    forward lance horns, side mandibles and four eyes, clawed little arms, and a long tail with a fin and a
    glowing tip bulb."""
    body = Union(
        Ell((0, 0.0, 0.98), (0.17, 0.33, 0.19)),
        Ell((0, -0.22, 1.02), (0.16, 0.17, 0.185)),
        Ell((0, 0.15, 0.97), (0.165, 0.17, 0.17)),
        k=0.07)
    hand = A(0.15, -0.40, 0.86)
    arms = Mirror(Union(Sphere((0.13, -0.26, 0.98), 0.045),
                        tube([(0.13, -0.26, 0.98), (0.16, -0.33, 0.89), hand], [0.04, 0.032, 0.026]),
                        *[RoundCone(hand, hand + A(dx, -0.05, -0.04), 0.016, 0.004) for dx in (-0.015, 0.015)],
                        k=0.015))
    body = Union(body, arms, k=0.025)
    l_pv = (-0.13, 0.05, 0.88)
    leg_ = leg(l_pv, (-0.15, 0.02, 0), 0.12, 0.115, 0.055, (0.075, 0.12, 0.05), toe_r=0.032, claw=0.04)

    neck_pv = (0, -0.28, 1.06)
    head = Union(
        Sphere(neck_pv, 0.13),
        tube([neck_pv, (0, -0.40, 1.21), (0, -0.46, 1.31)], [0.12, 0.09, 0.085]),
        Ell((0, -0.55, 1.36), (0.11, 0.15, 0.10)),
        Ell((0, -0.70, 1.33), (0.078, 0.10, 0.068)),
        Ell((0, -0.60, 1.30), (0.085, 0.12, 0.05)),
        k=0.03)
    head = Sub(head, Mirror(ell_ab((0.03, -0.79, 1.31), (0.08, -0.62, 1.30), 0.007, 0.007)), k=0.006)
    horn_tip = A(0.055, -0.98, 1.43)
    horns = Mirror(Union(Sphere((0.06, -0.58, 1.43), 0.035),
                         tube([(0.06, -0.58, 1.43), (0.08, -0.70, 1.48), (0.075, -0.85, 1.48), horn_tip],
                              [0.034, 0.027, 0.017, 0.006], n=6), k=0.01))
    mandibles = Mirror(tube([(0.075, -0.66, 1.29), (0.125, -0.72, 1.28), (0.115, -0.80, 1.28), (0.075, -0.84, 1.29)],
                            [0.024, 0.02, 0.013, 0.005], n=6))
    eyes = [((0.092, -0.60, 1.385), 0.032, look_dir(0.75, -0.6, 0.2)),
            ((0.075, -0.665, 1.40), 0.021, look_dir(0.55, -0.75, 0.35))]

    sail_o = A(0, -0.26, 1.05)
    peaks = [(0.05, 0.30), (0.16, 0.42), (0.27, 0.46), (0.38, 0.40), (0.48, 0.27)]
    sail_poly = [(-0.03, 0.0), (0.0, 0.12)]
    for i, (px, py) in enumerate(peaks):
        sail_poly.append((px + 0.02, py))
        if i < len(peaks) - 1:
            nx, ny = peaks[i + 1]
            sail_poly.append(((px + nx) / 2 + 0.02, min(py, ny) * 0.78))
    sail_poly += [(0.55, 0.08), (0.58, -0.02)]
    sail = membrane_mesh(sail_poly, lambda x, y: 0.01 + 0 * x, lambda x, y: 0 * x, 0.036, side_frame(0), sail_o, rim_frac=0.6)
    sail_tips = [sail_o + A(0, px + 0.02, py) for px, py in peaks]
    sail_ribs = Union(*[RoundCone(sail_o + A(0, px, 0.0), t, 0.028, 0.013) for (px, py), t in zip(peaks, sail_tips)],
                      *[Sphere(t, 0.025) for t in sail_tips], k=0.008)

    tail_pv = (0, 0.28, 0.98)
    tail_pts = [tail_pv, (0, 0.50, 0.95), (0, 0.72, 0.90), (0, 0.92, 0.87), (0, 1.06, 0.87)]
    bulb_c = A(0, 1.10, 0.88)
    tail = Union(Sphere(tail_pv, 0.12), tube(tail_pts, [0.12, 0.085, 0.06, 0.042, 0.034]), Sphere(bulb_c, 0.06), k=0.025)
    tfin_o = A(0, 0.70, 0.92)
    tfin = membrane_mesh([(0.0, -0.02), (0.06, 0.10), (0.16, 0.13), (0.24, 0.06), (0.27, -0.02)],
                         lambda x, y: 0.009 + 0 * x, lambda x, y: 0 * x, 0.03, side_frame(10), tfin_o, rim_frac=0.6)

    def body_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        stripes = bands(y - 0.5 * (z - 1.0), 0.13, 0.4, soft=0.15) * smoothstep(0.96, 1.02, z) * smoothstep(-0.2, 0.2, N[:, 2])
        belly = under(N, -0.15, 0.4) + smoothstep(-0.2, -0.35, y) * smoothstep(0.3, 0.6, -N[:, 1])
        claws = smoothstep(-0.40, -0.43, y) * (z < 0.9)
        return weights(np.maximum(belly, stripes), claws)

    def head_paint(P, N, part):
        y, z = P[:, 1], P[:, 2]
        mask = smoothstep(1.36, 1.40, z) * smoothstep(0.02, 0.05, np.abs(P[:, 0])) * smoothstep(-0.5, -0.56, y)
        jaw = under(N, -0.1, 0.4) * (y < -0.45)
        return weights(jaw, mask)

    def sail_paint(P, N, part):
        L = (P - sail_o) @ side_frame(0)
        eye = smoothstep(0.09, 0.075, np.linalg.norm(L[:, :2] - (0.28, 0.24), axis=1))
        pupil = smoothstep(0.042, 0.03, np.linalg.norm(L[:, :2] - (0.28, 0.24), axis=1))
        st = bands(L[:, 0], 0.11, 0.45, soft=0.2) * smoothstep(0.06, 0.1, L[:, 1])
        return weights(np.maximum(st * (1 - eye), pupil), eye * (1 - pupil))

    def tail_paint(P, N, part):
        y = P[:, 1]
        return weights(np.maximum(bands(y, 0.14, 0.4, soft=0.15) * smoothstep(0.4, 0.45, y) * (y < 1.02), under(N, -0.1, 0.4)),
                       smoothstep(1.02, 1.05, y))

    parts = [
        Part("body", body, 0, voxel=0.0055, tris=1400, sym=True, paint=body_paint),
        Part("sail", None, 0, mesh=sail, paint=sail_paint, sharp=True, ao_min=0.55),
        Part("sail_ribs", sail_ribs, 0, voxel=0.0032, tris=300, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.08, 0.04, np.min([np.linalg.norm(P - t, axis=1) for t in sail_tips], 0))),
             glow=lambda P: np.min([np.linalg.norm(P - t, axis=1) for t in sail_tips], 0) < 0.025),
        Part("leg", leg_, 1, l_pv, voxel=0.0045, tris=470, mirror=True,
             paint=leg_paint(sock_z=0.36, sock_ch=1, toe_ch=2, toe_z=0.06, inner=0.2)),
        Part("head", head, 6, neck_pv, voxel=0.0038, tris=740, sym=True, paint=head_paint),
        Part("horns", horns, 6, neck_pv, voxel=0.003, tris=260, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.6, smoothstep(-0.85, -0.95, P[:, 1]))),
        Part("mandibles", mandibles, 6, neck_pv, voxel=0.003, tris=150, sym=True,
             paint=lambda P, N, p: weights(np.ones(len(P)) * 0.6, smoothstep(-0.78, -0.84, P[:, 1]))),
        Part("tail", tail, 5, tail_pv, voxel=0.005, tris=380, sym=True, paint=tail_paint,
             glow=lambda P: np.linalg.norm(P - bulb_c, axis=1) < 0.07),
        Part("tail_fin", None, 5, tail_pv, mesh=tfin, sharp=True, ao_min=0.55,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.98, 1.02, P[:, 2]))),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.35, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    return dict(kind="biped", parts=parts, paint=None, height=1.8,
                palette=((0.62, 0.30, 0.18), (0.95, 0.85, 0.62), (0.25, 0.70, 1.0)), glow_col=(0.3, 0.75, 1.0))


@creature
def flyer_0():
    """Lantern dragon-moth: a stout furry thorax with two pairs of wings (striped forewings, eye-spotted
    hindwings), a round head with huge eyes plus two small ones and glowing antenna bulbs, and a ringed
    abdomen ending in a glowing lantern."""
    body = Union(Ell((0, 0.0, 0.0), (0.085, 0.13, 0.08)), Ell((0, -0.02, 0.03), (0.07, 0.09, 0.07)), k=0.03)
    neck_pv = (0, -0.10, 0.01)
    ant_tip = A(0.11, -0.42, 0.16)
    head = Union(Sphere(neck_pv, 0.06), Sphere((0, -0.17, 0.02), 0.072), Ell((0, -0.23, 0.0), (0.04, 0.035, 0.035)), k=0.02)
    antennae = Mirror(Union(tube([(0.025, -0.21, 0.07), (0.05, -0.29, 0.14), (0.085, -0.37, 0.17), ant_tip],
                                 [0.009, 0.008, 0.007, 0.007], n=6), Sphere(ant_tip, 0.022), k=0.006))
    eyes = [((0.052, -0.19, 0.04), 0.048, look_dir(0.85, -0.45, 0.25), 10, 7),
            ((0.022, -0.245, 0.005), 0.016, look_dir(0.3, -0.95, 0.05), 8, 5)]

    tail_pv = (0, 0.10, 0.0)
    ab_pts = [tail_pv, (0, 0.22, -0.01), (0, 0.36, -0.02), (0, 0.50, -0.02)]
    lantern_c = A(0, 0.56, -0.02)
    ring = lambda s, L: 2 * math.pi * s / 0.07
    abdomen = loft_mesh(ab_pts + [(0, 0.53, -0.02)], [0.07, 0.068, 0.055, 0.04, 0.035], n_around=10, spacing=0.018,
                        r_mod=lambda s, L: 1 + 0.08 * np.cos(ring(s, L)))
    lantern = eye_mesh(lantern_c, 0.042, (0, 1, 0), seg=10, rings=7)

    w_pv = (-0.06, -0.03, 0.035)
    fw_o, hw_o = A(-0.06, -0.06, 0.035), A(-0.06, 0.0, 0.03)
    fw_poly = [(0.0, -0.01), (-0.12, -0.06), (-0.32, -0.10), (-0.52, -0.12), (-0.66, -0.10), (-0.71, -0.06), (-0.68, -0.01),
               (-0.55, 0.02), (-0.36, 0.04), (-0.16, 0.05), (0.0, 0.04)]
    hw_poly = [(0.0, 0.0), (-0.12, 0.02), (-0.30, 0.04), (-0.46, 0.08), (-0.52, 0.14), (-0.48, 0.21), (-0.36, 0.25),
               (-0.22, 0.24), (-0.10, 0.17), (0.0, 0.08)]
    fw = membrane_mesh(fw_poly, lambda x, y: 0.0055 + 0 * x, lambda x, y: 0.03 * (x / 0.7) ** 2, 0.034, None, fw_o, rim_frac=0.7)
    hw = membrane_mesh(hw_poly, lambda x, y: 0.0055 + 0 * x, lambda x, y: -0.008 + 0.02 * (x / 0.5) ** 2, 0.032, None, hw_o,
                       rim_frac=0.7)
    veins = Union(Sphere(w_pv, 0.03),
                  tube([w_pv, fw_o + (-0.2, -0.065, 0.004), fw_o + (-0.45, -0.105, 0.008), fw_o + (-0.66, -0.095, 0.013)],
                       [0.022, 0.014, 0.01, 0.006], n=4),
                  tube([w_pv, hw_o + (-0.16, 0.03, 0.001), hw_o + (-0.36, 0.06, 0.004)], [0.018, 0.011, 0.006], n=4),
                  k=0.01)
    spot_c = hw_o + A(-0.33, 0.14, 0.0)

    def fw_paint(P, N, part):
        u = -(P[:, 0] - fw_o[0])
        st = bands(u, 0.14, 0.35, soft=0.25, phase=0.3) * smoothstep(0.08, 0.14, u)
        tip = smoothstep(0.55, 0.6, u)
        return weights(st * (1 - tip), tip)

    def hw_paint(P, N, part):
        d = np.linalg.norm(P[:, :2] - spot_c[:2], axis=1)
        eye = smoothstep(0.085, 0.07, d)
        pupil = smoothstep(0.04, 0.03, d)
        edge = smoothstep(0.42, 0.48, -(P[:, 0] - hw_o[0])) * 0.0
        return weights(np.maximum(pupil, edge), eye * (1 - pupil))

    def ab_paint(P, N, part):
        s = P[:, 1] - 0.10
        return weights(bands(s, 0.07, 0.4, soft=0.3) * smoothstep(0.02, 0.05, s), smoothstep(0.47, 0.5, P[:, 1]))

    parts = [
        Part("body", body, 0, voxel=0.003, tris=600, sym=True,
             paint=lambda P, N, p: weights(smoothstep(-0.1, 0.4, -N[:, 2]), np.zeros(len(P)))),
        Part("head", head, 6, neck_pv, voxel=0.003, tris=500, sym=True,
             paint=lambda P, N, p: weights(smoothstep(-0.2, -0.24, P[:, 1]), np.zeros(len(P)))),
        Part("antennae", antennae, 6, neck_pv, voxel=0.002, tris=200, sym=True,
             paint=lambda P, N, p: weights(np.zeros(len(P)), smoothstep(0.13, 0.15, P[:, 2])),
             glow=lambda P: near(P, ant_tip, 0.028)),
        Part("abdomen", None, 5, tail_pv, mesh=abdomen, paint=ab_paint),
        Part("lantern", None, 5, tail_pv, mesh=lantern, paint=solid(2), glow=1.0, ao_min=0.9),
        Part("forewing", None, 7, w_pv, mesh=fw, mirror=True, paint=fw_paint, sharp=True, ao_min=0.7),
        Part("hindwing", None, 7, w_pv, mesh=hw, mirror=True, paint=hw_paint, sharp=True, ao_min=0.7),
        Part("veins", veins, 7, w_pv, voxel=0.0025, tris=260, mirror=True, paint=solid(0)),
    ]
    for c, r, lk, sg, rg in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.3, seg=sg, rings=rg))
    return dict(kind="flyer", parts=parts, paint=None, span=1.4, ao_dist=0.1,
                palette=((0.28, 0.22, 0.45), (0.95, 0.80, 0.40), (0.30, 0.95, 0.75)), glow_col=(0.35, 1.0, 0.8))


@creature
def flyer_1():
    """Puffwing: a plump round flier with broad bat wings on three finger ribs (scalloped, banded trailing
    edges), a crested head with a hooked beak and four eyes, and a long whip tail ending in a glowing
    diamond fin."""
    body = Union(Ell((0, 0.0, 0.0), (0.12, 0.17, 0.11)), Ell((0, -0.02, -0.04), (0.10, 0.13, 0.08)),
                 Mirror(Sphere((0.05, 0.10, -0.10), 0.03)), k=0.04)
    neck_pv = (0, -0.14, 0.03)
    stalk_top = A(0.07, -0.26, 0.19)
    head = Union(Sphere(neck_pv, 0.075), Ell((0, -0.24, 0.05), (0.105, 0.10, 0.085)),
                 Ell((0, -0.30, 0.02), (0.085, 0.06, 0.05)),
                 Mirror(tube([(0.04, -0.24, 0.11), (0.06, -0.25, 0.16), stalk_top], [0.022, 0.018, 0.017], n=4)), k=0.02)
    head = Sub(head, Inter(Ell((0, -0.27, 0.02), (0.09, 0.08, 0.008)), Plane((0, 1, 0), -0.28)), k=0.006)
    crest_o = A(0, -0.20, 0.12)
    crest_poly = [(0.0, 0.0), (0.03, 0.07), (0.08, 0.09), (0.11, 0.045), (0.16, 0.075), (0.19, 0.02), (0.24, 0.03), (0.19, -0.04)]
    crest = membrane_mesh(crest_poly, lambda x, y: 0.007 + 0 * x, lambda x, y: 0 * x, 0.022, side_frame(15), crest_o, rim_frac=0.6)
    eyes = [(stalk_top + A(0.0, -0.01, 0.01), 0.034, look_dir(0.55, -0.75, 0.3)),
            ((0.055, -0.315, 0.06), 0.016, look_dir(0.45, -0.85, 0.2))]

    w_pv = (-0.08, -0.03, 0.03)
    wrist = A(-0.33, -0.07, 0.04)
    tips = [A(-0.70, -0.01, 0.06), A(-0.60, 0.15, 0.05), A(-0.42, 0.22, 0.04)]
    w_poly = [(-0.06, -0.09), (-0.20, -0.11), (wrist[0], wrist[1] - 0.025), (-0.52, -0.06), (tips[0][0], tips[0][1]),
              (-0.62, 0.05), (tips[1][0], tips[1][1]), (-0.48, 0.15), (tips[2][0], tips[2][1]), (-0.30, 0.17),
              (-0.18, 0.15), (-0.08, 0.12)]
    wing = membrane_mesh(w_poly, lambda x, y: 0.006 + 0 * x, lambda x, y: 0.035 * (x / 0.7) ** 2, 0.036, None, (0, 0, 0.03),
                         rim_frac=0.7)
    bones = Union(Sphere(w_pv, 0.04), tube([w_pv, (-0.2, -0.085, 0.04), wrist], [0.035, 0.026, 0.022], n=4),
                  *[tube([wrist, lerp(wrist, t, 0.5) + A(0, 0, 0.012), t], [0.016, 0.011, 0.006], n=4) for t in tips],
                  Sphere(wrist, 0.026), k=0.012)

    tail_pv = (0, 0.15, 0.0)
    fin_c = A(0, 0.58, 0.02)
    tail = Union(Sphere(tail_pv, 0.05), tube([tail_pv, (0, 0.30, -0.01), (0, 0.45, 0.0), fin_c], [0.05, 0.022, 0.014, 0.012]),
                 k=0.012)
    fin = membrane_mesh([(0.0, -0.06), (0.07, 0.03), (0.0, 0.10), (-0.07, 0.03)], lambda x, y: 0.008 + 0 * x,
                        lambda x, y: 0 * x, 0.018, None, fin_c, rim_frac=0.6)

    def wing_paint(P, N, part):
        y = P[:, 1]
        edge = smoothstep(0.06, 0.1, y + 0.16 * (P[:, 0] + 0.1))
        lead = smoothstep(-0.03, -0.07, y - 0.1 * (P[:, 0] + 0.1))
        return weights(np.maximum(lead, smoothstep(-0.1, 0.4, -N[:, 2]) * 0.6) * (1 - edge), edge)

    parts = [
        Part("body", body, 0, voxel=0.0032, tris=750, sym=True,
             paint=lambda P, N, p: weights(smoothstep(-0.1, 0.4, -N[:, 2]), bands(P[:, 1], 0.08, 0.3, soft=0.2)
                                           * smoothstep(0.3, 0.7, N[:, 2]) * smoothstep(-0.08, -0.02, P[:, 1]))),
        Part("head", head, 6, neck_pv, voxel=0.0024, tris=760, sym=True,
             paint=lambda P, N, p: weights(smoothstep(-0.1, 0.4, -N[:, 2]) + smoothstep(-0.30, -0.33, P[:, 1]),
                                           smoothstep(0.14, 0.17, P[:, 2]))),
        Part("crest", None, 6, neck_pv, mesh=crest, sharp=True, ao_min=0.6,
             paint=lambda P, N, p: weights(np.zeros(len(P)), np.ones(len(P))), glow=1.0),
        Part("wing", None, 7, w_pv, mesh=wing, mirror=True, paint=wing_paint, sharp=True, ao_min=0.7),
        Part("bones", bones, 7, w_pv, voxel=0.0026, tris=380, mirror=True,
             paint=lambda P, N, p: weights(smoothstep(-0.1, 0.4, -N[:, 2]), np.zeros(len(P)))),
        Part("tail", tail, 5, tail_pv, voxel=0.0025, tris=200, sym=True,
             paint=lambda P, N, p: weights(smoothstep(-0.1, 0.4, -N[:, 2]), np.zeros(len(P)))),
        Part("tail_fin", None, 5, tail_pv, mesh=fin, sharp=True, ao_min=0.7, paint=solid(2), glow=1.0),
    ]
    for c, r, lk in eyes:
        parts.append(eye_part(c, r, lk, 6, neck_pv, glow=0.0, seg=10 if r > 0.025 else 8, rings=7 if r > 0.025 else 5))
    for i, (x, y) in enumerate([(-0.27, 0.06), (-0.43, 0.05), (-0.55, 0.0)]):
        c = A(x, y, 0.03 + 0.035 * (x / 0.7) ** 2 + 0.006)
        parts.append(Part(f"wspot{i}", None, 7, w_pv, mesh=dome_mesh(c, (0, 0, 1), 0.026 - 0.003 * i, 0.004), mirror=True,
                          glow=1.0, paint=solid(2)))
    return dict(kind="flyer", parts=parts, paint=None, span=1.4, ao_dist=0.1,
                palette=((0.80, 0.40, 0.20), (0.98, 0.90, 0.75), (0.45, 0.30, 0.85)), glow_col=(0.65, 0.45, 1.0))

# =====================================================================================
# Build, checks, export, preview
# =====================================================================================
objs = []
for nm, fn in CREATURES.items():
    if ONLY and nm not in ONLY:
        continue
    print("building", nm)
    objs.append(assemble(nm, fn()))


def mesh_arrays(ob):
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    lb = np.empty(n, np.float32)
    me.attributes["_limb"].data.foreach_get("value", lb)
    pv = np.empty(n * 3, np.float32)
    me.attributes["_pivot"].data.foreach_get("vector", pv)
    return co.reshape(-1, 3).astype(float), lb, pv.reshape(-1, 3).astype(float)


def hip_height(lb, pv):
    m = (lb > 0.5) & (lb < 4.5)
    return float(pv[m, 2].mean()) if m.any() else 0.0


# ---- numpy reference of the Fauna.js vertex-shader animation (keep in sync with creatureMaterial / legAmp) ----
def _rx(p, a):
    c, s = np.cos(a), np.sin(a)
    return np.stack([p[:, 0], c * p[:, 1] - s * p[:, 2], s * p[:, 1] + c * p[:, 2]], 1)


def _ry(p, a):
    c, s = np.cos(a), np.sin(a)
    return np.stack([c * p[:, 0] + s * p[:, 2], p[:, 1], -s * p[:, 0] + c * p[:, 2]], 1)


def _rz(p, a):
    c, s = np.cos(a), np.sin(a)
    return np.stack([c * p[:, 0] - s * p[:, 1], s * p[:, 0] + c * p[:, 1], p[:, 2]], 1)


def _ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def leg_amp(g):
    return 0.38 * min(g, 1.0) + 0.55 * max(g - 1.0, 0.0)


def leg_pose(u, amp):
    if u < 0.5:
        return -amp + 2 * amp * (u * 2.0), 0.0
    s = u * 2.0 - 1.0
    e = s * s * (3 - 2 * s)
    return amp + (-2 * amp) * e, math.sin(math.pi * s)


def shader_pose(co, lb, pv, phase, gait, L, plan=0, t=0.0, seed=0.0):
    """co / pv in Blender axes; returns posed Blender-axis positions."""
    P = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    Pv = np.stack([pv[:, 0], pv[:, 2], -pv[:, 1]], 1)
    limb = np.round(lb).astype(int)
    out = P.copy()
    g, gw = gait, min(gait, 1.0)
    sd = seed * 2 * math.pi
    lp = P - Pv
    if plan == 2:
        glide = float(_ss(0.3, 0.9, math.sin(t * 0.33 + sd)))
        flap = math.sin(phase) * (0.85 + (0.1 - 0.85) * glide) + (0.1 + 0.1 * glide)
        for lid, a in ((7, -flap), (8, flap)):
            m = limb == lid
            out[m] = Pv[m] + _rz(lp[m], a)
        m = limb == 5
        out[m] = Pv[m] + _rx(_ry(lp[m], math.sin(phase * 0.5 + sd) * 0.22), math.sin(phase - 0.8) * 0.1 * (1 - glide))
        m = limb == 6
        out[m] = Pv[m] + _rx(_ry(lp[m], math.sin(t * 0.6 + sd) * 0.3), math.sin(phase + 0.5) * 0.06 * (1 - glide))
        out[:, 1] += math.cos(phase) * 0.025 * (1 - glide)
    else:
        amp = leg_amp(g)
        cyc = phase / (2 * math.pi)
        ths = -amp + 2 * amp * ((cyc * 2.0) % 1.0)
        sink = (1 - ANKLE) * (1 - math.cos(ths))  # x hip height: the drop that keeps planted feet down
        pitch = 0.025 * gw * math.sin(cyc * 4 * math.pi + 1.3)
        roll = (0.07 if plan == 1 else 0.025) * gw * math.sin(cyc * 2 * math.pi)
        C = np.array([0.0, L, 0.0])
        for lid in (1, 2, 3, 4):
            m = limb == lid
            if not m.any():
                continue
            th, lift = leg_pose((cyc + (0.0 if lid in (1, 4) else 0.5)) % 1.0, amp)
            kap = lift * math.sqrt(gw) * (1.05 + 0.4 * max(g - 1.0, 0.0))
            pvm = Pv[m]
            hy = np.maximum(pvm[:, 1:2], 1e-3)
            K = np.concatenate([pvm[:, :1], hy * 0.5, pvm[:, 2:]], 1)
            y0 = P[m, 1:2]
            p = K + _rx(P[m] - K, (kap * (1 - _ss(hy * 0.38, hy * 0.62, y0)))[:, 0])
            Ak = K + _rx(np.concatenate([0 * hy, -hy * 0.37, 0 * hy], 1), kap)
            p = Ak + _rx(p - Ak, (-(th + 0.85 * kap) * (1 - _ss(hy * 0.1, hy * 0.24, y0)))[:, 0])
            p = pvm + _rx(p - pvm, th)
            p[:, 1] += lift * math.sqrt(gw) * 0.04 * hy[:, 0] - hy[:, 0] * sink
            out[m] = p
        rest = (limb < 1) | (limb > 4)
        m = limb == 0
        br = math.sin(t * 1.9 + sd) * (0.02 - 0.01 * gw)
        out[m, 0] *= 1 + br
        out[m, 1] += np.maximum(out[m, 1] - L, 0) * br * 0.8
        m = limb == 5
        sway = math.sin(cyc * 2 * math.pi + 1.2) * 0.3 * gw + math.sin(t * 1.3 + sd) * 0.18 * (1 - gw)
        lift = 0.06 * gw * math.sin(cyc * 4 * math.pi + 0.5) + 0.05 * math.sin(t * 0.8 + sd * 1.3)
        out[m] = Pv[m] + _rx(_ry(lp[m], sway), -lift)
        m = limb == 6
        idle = 1 - gw
        look = (math.sin(t * 0.45 + sd) + 0.6 * math.sin(t * 1.17 + sd * 2.1)) * 0.3 * idle
        graze = float(_ss(0.4, 0.95, math.sin(t * 0.19 + sd * 1.7))) * (0.12 if plan == 1 else 0.5) * idle
        nod = 0.07 * gw * math.sin(cyc * 4 * math.pi + 0.3) + 0.035 * math.sin(t * 1.6 + sd) * idle
        out[m] = Pv[m] + _rx(_ry(lp[m], look), nod + graze)
        out[rest] = C + _rz(_rx(out[rest] - C, pitch), roll)
        out[rest, 1] -= L * sink
    return np.stack([out[:, 0], -out[:, 2], out[:, 1]], 1)


problems = []
for ob, spec in objs:
    co, lb, pv = mesh_arrays(ob)
    info = eval(ob["info"])
    if info["tris"] > 6000:
        problems.append(f"{ob.name}: {info['tris']} tris (budget 6000)")
    if spec["kind"] == "flyer":
        continue
    legs = [l for l in (1, 2, 3, 4) if (np.abs(lb - l) < 0.5).any()]
    want = 2 if spec["kind"] == "biped" else 4
    if len(legs) != want:
        problems.append(f"{ob.name}: legs {legs}")
    for l in legs:
        m = np.abs(lb - l) < 0.5
        zmin, hip = co[m, 2].min(), pv[m][0]
        foot = co[m][co[m, 2] < 0.01]
        if abs(zmin) > 1e-4 or len(foot) < 6:
            problems.append(f"{ob.name}: leg {l} sole at z={zmin:.4f} ({len(foot)} sole verts)")
        # the foot should stand roughly under its hip so the shader's knee / ankle model fits
        off = np.abs(0.5 * (foot[:, :2].min(0) + foot[:, :2].max(0)) - hip[:2]) if len(foot) else np.zeros(2)
        if off[1] > 0.2 * hip[2] or off[0] > 0.12 * hip[2]:
            problems.append(f"{ob.name}: leg {l} foot offset {off.round(3)} from hip {hip.round(3)}")
    body = co[np.abs(lb) < 0.5]
    if body[:, 2].min() < 0.05:
        problems.append(f"{ob.name}: body dips to z={body[:, 2].min():.3f}")
    # walk cycle: planted (stance) feet must stay on the ground, swinging feet must clear it
    L = hip_height(lb, pv)
    plan = 1 if spec["kind"] == "biped" else 0
    worst_stance, min_clear = 0.0, 9.0
    for g in (0.5, 1.0, 1.4):
        for k in range(16):
            cyc = k / 16
            posed = shader_pose(co, lb, pv, 2 * math.pi * cyc, g, L, plan)
            for l in legs:
                u = (cyc + (0.0 if l in (1, 4) else 0.5)) % 1.0
                z = posed[np.abs(lb - l) < 0.5, 2].min()
                if u < 0.5:
                    worst_stance = max(worst_stance, abs(z))
                elif abs(u - 0.75) < 0.07:
                    min_clear = min(min_clear, z)
    if worst_stance > 0.02 * L:
        problems.append(f"{ob.name}: planted feet drift {worst_stance:.3f} off the ground")
    print(f"   {ob.name}: hip height {L:.3f}, legs {legs}, planted-foot error {worst_stance:.4f}, "
          f"mid-swing clearance {min_clear:.3f}")
for p in problems:
    print("PROBLEM", p)

bpy.ops.object.select_all(action="DESELECT")
for ob, _ in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0][0]
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_attributes=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_materials="EXPORT",
    export_animations=False,
)
print("EXPORTED", OUT)


def preview_material(name, pal, glow_col):
    hide, belly, acc = pal
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(ca.outputs["Color"], sep.inputs["Color"])
    acc_sum = None
    for ch, col in zip(("Red", "Green", "Blue"), (hide, belly, acc)):
        sc = nt.nodes.new("ShaderNodeVectorMath")
        sc.operation = "SCALE"
        sc.inputs[0].default_value = col
        nt.links.new(sep.outputs[ch], sc.inputs["Scale"])
        if acc_sum is None:
            acc_sum = sc
        else:
            ad = nt.nodes.new("ShaderNodeVectorMath")
            ad.operation = "ADD"
            nt.links.new(acc_sum.outputs[0], ad.inputs[0])
            nt.links.new(sc.outputs[0], ad.inputs[1])
            acc_sum = ad
    ao = nt.nodes.new("ShaderNodeVectorMath")
    ao.operation = "SCALE"
    nt.links.new(acc_sum.outputs[0], ao.inputs[0])
    nt.links.new(ca.outputs["Alpha"], ao.inputs["Scale"])
    nt.links.new(ao.outputs[0], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "_glow"
    bsdf.inputs["Emission Color"].default_value = (*glow_col, 1)
    nt.links.new(at.outputs["Fac"], bsdf.inputs["Emission Strength"])
    return m


def posed_copy(ob, spec, phase, gait=1.0, t=0.0, suffix="_posed"):
    """A copy deformed exactly like the game's vertex shader at the given gait phase."""
    co, lb, pv = mesh_arrays(ob)
    plan = 2 if spec["kind"] == "flyer" else (1 if spec["kind"] == "biped" else 0)
    posed = shader_pose(co, lb, pv, phase, gait, hip_height(lb, pv), plan, t=t)
    me = ob.data.copy()
    me.vertices.foreach_set("co", posed.astype(np.float32).ravel())
    me.update()
    o2 = bpy.data.objects.new(ob.name + suffix, me)
    scene.collection.objects.link(o2)
    o2.data.materials.clear()
    o2.data.materials.append(ob.data.materials[0])
    return o2


if PREVIEW_DIR:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.render.resolution_x = 900
    scene.render.resolution_y = 640
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.70, 1)
    bg.inputs["Strength"].default_value = 0.75
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.4
    sun.angle = math.radians(6)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(45), math.radians(-10), math.radians(-35))
    scene.collection.objects.link(so)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gb = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (0.20, 0.36, 0.16, 1)
    gb.inputs["Roughness"].default_value = 0.95
    ground.data.materials.append(gm)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def shoot(path, target, loc, lens=60, ortho=None):
        cam.location = loc
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = lens
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def only(visible):
        for o in scene.objects:
            if o.type == "MESH" and o is not ground:
                o.hide_render = o not in visible

    for ob, spec in objs:
        ob.data.materials.clear()
        ob.data.materials.append(preview_material(ob.name + "_pv", spec["palette"], spec.get("glow_col", spec["palette"][2])))
    views = PREVIEW_VIEWS
    for ob, spec in objs:
        flyer = spec["kind"] == "flyer"
        ground.hide_render = flyer
        only([ob])
        info = eval(ob["info"])
        h, ln, w = info["height"], info["length"], info["span"]
        c = (0, info["ymid"], info["zmid"])
        base = os.path.join(PREVIEW_DIR, ob.name)
        size = max(ln, w, h)
        if "side" in views:
            shoot(base + "_side.png", c, (6, c[1], c[2]), ortho=max(ln * 1.15, h * 1.15 * 900 / 640))
        if "34" in views:
            d = Vector((-0.55, -0.72, 0.38)).normalized() * size * 2.25
            shoot(base + "_34.png", c, (c[0] + d.x, c[1] + d.y, c[2] + d.z), lens=50)
        if "front" in views:
            shoot(base + "_front.png", c, (0, c[1] - 6, c[2]), ortho=max(w * 1.2, h * 1.2 * 900 / 640))
        if flyer and "top" in views:
            shoot(base + "_top.png", c, (0.0, c[1] + 0.001, 6), ortho=max(w, ln * 900 / 640) * 1.1)
        if "head" in views:
            co, lb, pv = mesh_arrays(ob)
            sel = co[np.abs(lb - 6) < 0.5]
            if len(sel):
                cc = 0.5 * (sel.min(0) + sel.max(0))
                ext = float(np.max(sel.max(0) - sel.min(0)))
                d = Vector((-0.75, -0.62, 0.4)).normalized() * ext * 2.1
                shoot(base + "_head.png", tuple(cc), tuple(Vector(cc) + d), lens=50)
        if "posed" in views:
            p = posed_copy(ob, spec, phase=2 * math.pi * (0.25 if flyer else 0.75), gait=1.0)
            only([p])
            d = Vector((0.6, -0.68, 0.42)).normalized() * size * 2.3
            shoot(base + "_posed.png", c, (c[0] + d.x, c[1] + d.y, c[2] + d.z), lens=50)
            bpy.data.objects.remove(p)
        if "gait" in views and not flyer:
            # side view of eight phases of the walk cycle, laid out front to back (feet should stay planted)
            strip = []
            for k in range(8):
                p = posed_copy(ob, spec, phase=2 * math.pi * k / 8, gait=1.0, suffix=f"_g{k}")
                p.location = (0, k * ln * 1.15, 0)
                strip.append(p)
            only(strip)
            mid = (0, c[1] + 3.5 * ln * 1.15, c[2])
            scene.render.resolution_x, scene.render.resolution_y = 1800, 360
            shoot(base + "_gait.png", mid, (12, mid[1], mid[2]), ortho=8 * ln * 1.15 + 0.2)
            scene.render.resolution_x, scene.render.resolution_y = 900, 640
            for p in strip:
                bpy.data.objects.remove(p)
    if "lineup" in views and len(objs) > 1:
        # all creatures side by side at their normalised sizes, seen from their left
        ground.hide_render = False
        only([o for o, _ in objs])
        x = 0.0
        for ob, spec in objs:
            info = eval(ob["info"])
            fly = spec["kind"] == "flyer"
            ext = info["span"] if fly else info["length"]
            ob.rotation_euler = (math.radians(25), 0, 0) if fly else (0, 0, math.radians(90))
            ob.location = (x + ext / 2, 0, 1.5 if fly else 0)
            x += ext + 0.3
        scene.render.resolution_x = 1800
        scene.render.resolution_y = 520
        cx = x / 2
        shoot(os.path.join(PREVIEW_DIR, "lineup.png"), (cx, 0, 1.0), (cx, -12, 1.6), ortho=x * 1.02)
    print("PREVIEWS", PREVIEW_DIR)
