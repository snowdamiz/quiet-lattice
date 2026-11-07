"""Suits: a fabric layer that reuses the body's own topology (so it deforms with the body), plus parametric plates,
bands (straps, belts, cuffs, collars) and fittings placed on the body through a body map: (part, side, s, th, offset)
-> a point on the sculpt pushed out by `offset`.

Body map conventions (left side; the right mirrors):
  torso: s 0 at the crotch .. 1 at the neck base; th degrees round the spine, 0 front, +90 left, 180 back.
  arm:   s 0 at the shoulder joint .. 1 at the wrist; th round the arm, 0 front, +90 up/out, -90 under.
  leg:   s 0 at the hip joint .. 1 at the ankle; th round the leg, 0 front, +90 outer, -90 inner.
Attributes on suit meshes: 'kind' (0 fabric, 1 plate, 2 band, 3 fitting, 4 lining), 'edge' (1 near a border),
'sv' / 'tv' (map coordinates), 'pid' (piece id) for the material's masks."""
import math

import bmesh
import bpy
import numpy as np

from . import mesh as M
from .cage import march
from .sdf import nrm

KIND = {'fabric': 0, 'plate': 1, 'band': 2, 'fitting': 3, 'lining': 4, 'trim': 5}


class BodyMap:
    def __init__(self, ctx, S, sd):
        self.c = ctx
        self.S = S
        self.sd = sd
        bs = ctx.bs
        self.z0 = (bs['thigh_L']['head'][2] + bs['pelvis']['head'][2]) / 2 - 0.08 * ctx.s
        self.z1 = bs['neck_01']['head'][2] + (bs['neck_01']['tail'][2] - bs['neck_01']['head'][2]) * 0.2

    def _spine_axis(self, z):
        bs = self.c.bs
        pts = [bs[n]['head'] for n in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01')] + [bs['neck_01']['tail']]
        pts = np.array(pts)
        y = np.interp(z, pts[:, 2], pts[:, 1])
        return np.stack([np.zeros_like(z), y, z], -1)

    def _chain(self, names, s):
        bs = self.c.bs
        heads = np.array([bs[n]['head'] for n in names])
        tails = np.array([bs[n]['tail'] for n in names])
        lens = np.linalg.norm(tails - heads, axis=1)
        cum = np.concatenate([[0], np.cumsum(lens)])
        t = np.clip(s, 0, 1) * cum[-1]
        i = np.clip(np.searchsorted(cum, t, side='right') - 1, 0, len(names) - 1)
        f = (t - cum[i]) / lens[i]
        P = heads[i] + (tails[i] - heads[i]) * f[:, None]
        return P, i

    def point(self, part, side, s, th, off, tmax=0.3):
        """Arrays s, th (degrees) -> points on the sculpt offset by `off` (scalar or array), and outward normals."""
        s = np.atleast_1d(np.asarray(s, float))
        th = np.radians(np.atleast_1d(np.asarray(th, float)))
        off = np.broadcast_to(np.asarray(off, float), s.shape)
        c = self.c
        sfx = '_L' if side > 0 else '_R'
        if part == 'torso':
            z = self.z0 + s * (self.z1 - self.z0)
            O = self._spine_axis(z)
            D = np.stack([np.sin(th) * (1 if side >= 0 else -1), -np.cos(th), np.zeros_like(th)], -1)
            S = self.sd['torso']
        else:
            names = {'arm': ['upperarm', 'lowerarm'], 'leg': ['thigh', 'calf']}[part]
            names = [n + sfx for n in names]
            O, idx = self._chain(names, s)
            D = np.empty_like(O)
            for k, n in enumerate(names):
                x, v, zz = c.fr[n]
                sel = idx == k
                a = th[sel] if side > 0 else -th[sel]
                # arms and legs: angle 0 front, +90 toward -x of the bone frame (lateral for the left)
                D[sel] = np.outer(np.cos(a), zz) - np.outer(np.sin(a), x)
            S = self.sd[part]
        t = march(S, O, D, tmax)
        P = O + D * t[:, None]
        # outward normal from the sculpt gradient
        g = self.S.grad(P)
        N = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        return P + N * off[:, None], N


# ---------------------------------------------------------------------------------------------- body coordinates
def body_coords(me, ctx, bmap):
    """(part code, side, s, th) per vertex of the body mesh, from geometry (not interpolated attributes)."""
    P = M.coords(me)
    part = np.rint(M.attr(me, 'part')).astype(int)
    side = np.sign(P[:, 0])
    s = np.zeros(len(P))
    th = np.zeros(len(P))
    bs = ctx.bs
    tor = part == 0
    z = P[:, 2]
    s[tor] = (z[tor] - bmap.z0) / (bmap.z1 - bmap.z0)
    ax = bmap._spine_axis(z[tor])
    th[tor] = np.degrees(np.arctan2(np.abs(P[tor, 0]), -(P[tor, 1] - ax[:, 1])))
    for code, names in ((1, ['upperarm', 'lowerarm']), (3, ['thigh', 'calf'])):
        for sg, sfx in ((1, '_L'), (-1, '_R')):
            sel = (part == code) & (side * sg > 0)
            if not sel.any():
                continue
            Q = P[sel]
            ns = [n + sfx for n in names]
            heads = np.array([bs[n]['head'] for n in ns])
            tails = np.array([bs[n]['tail'] for n in ns])
            lens = np.linalg.norm(tails - heads, axis=1)
            best = np.full(len(Q), np.inf)
            sv = np.zeros(len(Q))
            tv = np.zeros(len(Q))
            start = 0.0
            for k, n in enumerate(ns):
                ab = tails[k] - heads[k]
                t = ((Q - heads[k]) @ ab) / (ab @ ab)
                tc = np.clip(t, 0 if k else -0.3, 1 if k < len(ns) - 1 else 1.3)
                q = heads[k] + tc[:, None] * ab
                d = np.linalg.norm(Q - q, axis=1)
                x, v, zz = ctx.fr[n]
                rel = Q - q
                a = np.degrees(np.arctan2(-(rel @ x), rel @ zz)) * sg
                better = d < best
                best = np.where(better, d, best)
                sv = np.where(better, (start + tc * lens[k]) / lens.sum(), sv)
                tv = np.where(better, a, tv)
                start += lens[k]
            s[sel] = sv
            th[sel] = tv
    return part, side, s, th


# ---------------------------------------------------------------------------------------------- pieces
def _mesh_from_grid(name, G, closed_u=False):
    """G: (nu, nv, 3) grid -> quads (open in v, optionally closed in u)."""
    nu, nv, _ = G.shape
    verts = G.reshape(-1, 3)
    faces = []
    for i in range(nu if closed_u else nu - 1):
        i2 = (i + 1) % nu
        for j in range(nv - 1):
            faces.append((i * nv + j, i2 * nv + j, i2 * nv + j + 1, i * nv + j + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in verts], [], faces)
    me.update()
    return me


def solid_grid(name, top, bot, closed_u=False, rim=True):
    """A closed slab from two matching grids (outer `top`, inner `bot`) of shape (nu, nv, 3)."""
    nu, nv, _ = top.shape
    bm = bmesh.new()
    vt = [[bm.verts.new(tuple(top[i, j])) for j in range(nv)] for i in range(nu)]
    vb = [[bm.verts.new(tuple(bot[i, j])) for j in range(nv)] for i in range(nu)]
    rng = range(nu if closed_u else nu - 1)
    for i in rng:
        i2 = (i + 1) % nu
        for j in range(nv - 1):
            bm.faces.new((vt[i][j], vt[i2][j], vt[i2][j + 1], vt[i][j + 1]))
            bm.faces.new((vb[i][j + 1], vb[i2][j + 1], vb[i2][j], vb[i][j]))
    if rim:
        for i in rng:
            i2 = (i + 1) % nu
            for j in (0, nv - 1):
                q = (vt[i][j], vt[i2][j], vb[i2][j], vb[i][j])
                bm.faces.new(q if j == 0 else q[::-1])
        if not closed_u:
            for i in (0, nu - 1):
                for j in range(nv - 1):
                    q = (vt[i][j], vt[i][j + 1], vb[i][j + 1], vb[i][j])
                    bm.faces.new(q[::-1] if i == 0 else q)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def plate(bmap, name, part, side, s_rng, th_rng, off, thick, nu=24, nv=12, shape=None, lift=None, round_edge=0.6, flat=False):
    """A plate over a (th, s) patch of a part, its outline shaped by `shape(u, v) -> (s, th)` overrides.  `lift(u, v)`
    adds height (ribs, bosses).  Edges round over: the outer skin dips toward the inner one at the border."""
    u = np.linspace(0, 1, nu)
    v = np.linspace(0, 1, nv)
    U, V = np.meshgrid(u, v, indexing='ij')
    if shape is not None:
        Sg, Tg = shape(U, V)
    else:
        Sg = s_rng[0] + (s_rng[1] - s_rng[0]) * V
        Tg = th_rng[0] + (th_rng[1] - th_rng[0]) * U
    border = np.minimum(np.minimum(U, 1 - U) * nu, np.minimum(V, 1 - V) * nv) / 2.0
    rnd = np.clip(border, 0, 1) ** round_edge
    extra = lift(U, V) if lift is not None else 0.0
    out_off = off + thick * (0.35 + 0.65 * rnd) + extra
    Ptop, N = bmap.point(part, side, Sg.ravel(), Tg.ravel(), np.ravel(out_off))
    Pbot, _ = bmap.point(part, side, Sg.ravel(), Tg.ravel(), off)
    top = Ptop.reshape(nu, nv, 3)
    bot = Pbot.reshape(nu, nv, 3)
    me = solid_grid(name, top, bot)
    _grid_attrs(me, U, V, Sg, Tg, rnd, KIND['plate'])
    if flat:
        for p in me.polygons:
            p.use_smooth = False
    return me


def _grid_attrs(me, U, V, Sg, Tg, rnd, kind):
    n = len(me.vertices)
    half = n // 2
    for key, vals in (('sv', Sg), ('tv', Tg), ('edge', 1 - rnd)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        arr = np.concatenate([vals.ravel(), vals.ravel()])[:n]
        a.data.foreach_set('value', arr.astype(np.float32))
    a = me.attributes.new('kind', 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.full(n, kind, np.float32))
    # UVs: the (u, v) grid, outer skin in the lower half of the tile, inner skin above
    uvl = me.uv_layers.new(name='UVMap')
    uu = np.concatenate([U.ravel(), U.ravel()])
    vv = np.concatenate([V.ravel() * 0.5, 1 - V.ravel() * 0.5])
    luv = np.empty(len(me.loops) * 2)
    vidx = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', vidx)
    luv = np.stack([uu[vidx], vv[vidx]], 1)
    uvl.data.foreach_set('uv', luv.ravel())


def band(bmap, name, part, side, s_pts, th_pts, width, off, thick, closed=False, n=48, nw=4, flat=False):
    """A strap or belt along a curve given in map coordinates (interpolated), `width` metres across."""
    s_pts = np.asarray(s_pts, float)
    th_pts = np.asarray(th_pts, float)
    k = np.linspace(0, 1, len(s_pts))
    t = np.linspace(0, 1, n, endpoint=not closed)
    sc = np.interp(t, k, s_pts)
    tc = np.interp(t, k, th_pts)
    P, N = bmap.point(part, side, sc, tc, off)
    T = np.gradient(P, axis=0)
    if closed:
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    T = nrm(T)
    B = nrm(np.cross(N, T))
    w = np.linspace(-0.5, 0.5, nw) * width
    top = np.stack([P + N * thick + B * wi for wi in w], 1)
    bot = np.stack([P - N * 0.0005 + B * wi for wi in w], 1)
    # rounded edges: pull the outer skin in at the band's sides
    rnd = 1 - np.abs(np.linspace(-1, 1, nw)) ** 4 * 0.6
    top = bot + (top - bot) * rnd[None, :, None]
    me = solid_grid(name, top, bot, closed_u=closed)
    U, V = np.meshgrid(t, np.linspace(0, 1, nw), indexing='ij')
    _grid_attrs(me, U, V, np.repeat(sc[:, None], nw, 1), np.repeat(tc[:, None], nw, 1), np.repeat(rnd[None], n, 0), KIND['band'])
    if flat:
        for p in me.polygons:
            p.use_smooth = False
    return me


def ring(bmap, name, part, side, s, width, off, thick, n=64, nw=5, th0=-180, th1=180):
    """A cuff or collar round a limb (closed) at s."""
    ths = np.linspace(th0, th1, n, endpoint=False)
    return band(bmap, name, part, side, [s] * 2, [th0, th1 - (th1 - th0) / n], width, off, thick, closed=True, n=n, nw=nw)


def capsule(name, a, b, r, seg=16, rings=8):
    """A canister / tank: a capsule from a to b."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings * 2, radius=r)
    ax = b - a
    L = np.linalg.norm(ax)
    d = ax / L
    for v in bm.verts:
        p = np.array(v.co)
        # stretch the upper hemisphere along +z by L
        if p[2] > 0:
            p[2] += L
        v.co = p
    # orient +z to d
    from mathutils import Vector
    q = Vector((0, 0, 1)).rotation_difference(Vector(d))
    for v in bm.verts:
        v.co = q @ v.co + Vector(a)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            p = np.array(l.vert.co) - a
            h = p @ d / (L + 2 * r)
            ang = math.atan2(p @ nrm(np.cross(d, [0.3, 0.5, 0.8])), p @ nrm(np.cross(d, np.cross(d, [0.3, 0.5, 0.8]))))
            l[uv].uv = (ang / (2 * math.pi) + 0.5, h + 0.5)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    n = len(me.vertices)
    for key, val in (('kind', KIND['fitting']), ('edge', 0.0)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(n, val, np.float32))
    return me


# ---------------------------------------------------------------------------------------------- the fabric layer
def hop_distance(me, seeds, maxhops=12):
    off, nb = M.neighbours(me)
    d = np.full(len(me.vertices), maxhops, float)
    d[seeds] = 0
    front = np.asarray(seeds)
    for h in range(1, maxhops):
        if not len(front):
            break
        nxt = np.unique(np.concatenate([nb[off[i]:off[i + 1]] for i in front]))
        nxt = nxt[d[nxt] > h]
        d[nxt] = h
        front = nxt
    return d


def fabric(body, name, cover, thick, S, smooth_iters=3, rim=0.003):
    """Copies the body faces whose verts all have cover > 0.5 and lays them `thick` (per body vertex) outside the
    sculpt, softened (a suit does not follow every muscle).  The open borders roll inward into a rim so the fabric has
    an edge.  Returns the mesh; 'bidx' holds each vertex's body index (weights and UV come from the body)."""
    me = body.data
    nb_ = len(me.vertices)
    a = me.attributes.get('bidx') or me.attributes.new('bidx', 'INT', 'POINT')
    a.data.foreach_set('value', np.arange(nb_, dtype=np.int32))
    cov = np.asarray(cover, float)
    bm = bmesh.new()
    bm.from_mesh(me)
    keep = {f for f in bm.faces if all(cov[v.index] > 0.5 for v in f.verts)}
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context='EDGES')
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    idx = M.attr(out, 'bidx').astype(int) if False else None
    ia = np.empty(len(out.vertices), np.int32)
    out.attributes['bidx'].data.foreach_get('value', ia)
    P = M.coords(me)[ia]
    N = M.vertex_normals(me)[ia]
    t = np.asarray(thick, float)[ia] if np.ndim(thick) else np.full(len(ia), float(thick))
    co = P + N * t[:, None]
    M.set_coords(out, co)
    # soften, then keep at least the thickness outside the sculpt
    bnd = M.boundary_verts(out)
    for _ in range(smooth_iters):
        co = M.relax(out, co, fixed=bnd, iters=2, lam=0.5)
        d = S(co)
        g = S.grad(co)
        g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        push = np.maximum(t * 0.9 - d, 0)
        co = co + g * push[:, None]
    M.set_coords(out, co)
    # rim: roll the open borders inward
    bm = bmesh.new()
    bm.from_mesh(out)
    bedges = [e for e in bm.edges if e.is_boundary]
    if bedges and rim > 0:
        res = bmesh.ops.extrude_edge_only(bm, edges=bedges)
        nv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            n = np.array(v.normal) if v.normal.length > 0 else np.zeros(3)
            # move toward the body: against the vertex normal of the neighbouring fabric
            nn = np.zeros(3)
            for e in v.link_edges:
                o = e.other_vert(v)
                nn += np.array(o.normal)
            nn = nn / (np.linalg.norm(nn) + 1e-9)
            v.co = np.array(v.co) - nn * (t.mean() + rim)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(out)
    bm.free()
    for p in out.polygons:
        p.use_smooth = True
    n = len(out.vertices)
    ia = np.empty(n, np.int32)
    out.attributes['bidx'].data.foreach_get('value', ia)
    k = out.attributes.new('kind', 'FLOAT', 'POINT')
    kind = np.zeros(n, np.float32)
    k.data.foreach_set('value', kind)
    bnd = M.boundary_verts(out)
    hd = hop_distance(out, bnd, 10)
    e = out.attributes.new('edge', 'FLOAT', 'POINT')
    e.data.foreach_set('value', np.exp(-hd / 2.5).astype(np.float32))
    return out


def node(name, P, r):
    """A fused joint: a small sphere where lattice members meet."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    from mathutils import Vector
    for v in bm.verts:
        v.co = v.co + Vector(tuple(P))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.uv_layers.new(name='UVMap')
    n = len(me.vertices)
    for key, val in (('kind', KIND['band']), ('edge', 0.0)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(n, val, np.float32))
    return me


# ---------------------------------------------------------------------------------------------- grown members (Ulgani chitin)
KIND.update({'chitin': 6, 'joint': 7, 'sac': 8, 'port': 9})


def catmull(P, n):
    """Catmull-Rom through the control points P (k, 3) -> n samples."""
    P = np.asarray(P, float)
    if len(P) == 2:
        return P[0] + (P[1] - P[0]) * np.linspace(0, 1, n)[:, None]
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    segs = len(P) - 1
    out = []
    for t in np.linspace(0, segs, n):
        i = min(int(t), segs - 1)
        u = t - i
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def surface_curve(S, ctrl, n, off, bow=0.0):
    """A curve through control points laid on the sculpt and lifted `off` (+ a bow at mid-span) along the normal."""
    C = catmull(ctrl, n)
    Q = S.project(C, iters=10)
    N = S.grad(Q)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    t = np.linspace(0, 1, n)
    return Q + N * (off + bow * np.sin(np.pi * t))[:, None], N


def tube(name, C, R, sides=8, kind='chitin', caps=True, closed=False):
    """A swept tube along C (n, 3) with radii R (n): parallel-transport frames; attributes kind, mt (0..1 along),
    fillet (1 at the fused ends), edge 0; one UV island (u round, v along)."""
    C = np.asarray(C, float)
    n = len(C)
    T = np.gradient(C, axis=0)
    if closed:
        T = np.roll(C, -1, 0) - np.roll(C, 1, 0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    a = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    U = [nrm(np.cross(T[0], a))]
    for i in range(1, n):
        u = U[-1] - np.dot(U[-1], T[i]) * T[i]
        U.append(nrm(u))
    U = np.array(U)
    V = np.cross(T, U)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    lay = {k: bm.verts.layers.float.new(k) for k in ('kind', 'mt', 'fillet', 'edge')}
    t = np.linspace(0, 1, n)
    fil = np.exp(-(t / 0.14) ** 2) + np.exp(-((1 - t) / 0.14) ** 2) if not closed else np.zeros(n)
    rings = []
    for i in range(n):
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            v = bm.verts.new(tuple(C[i] + (U[i] * math.cos(ang) + V[i] * math.sin(ang)) * R[i]))
            v[lay['kind']] = KIND[kind]
            v[lay['mt']] = t[i]
            v[lay['fillet']] = min(1.0, fil[i])
            v[lay['edge']] = 0.0
            ring.append(v)
        rings.append(ring)
    L = np.sum(np.linalg.norm(np.diff(C, axis=0), axis=1))
    circ = 2 * math.pi * float(np.mean(R))
    vs = L / max(circ, 1e-6)
    m = n if closed else n - 1
    for i in range(m):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            f = bm.faces.new((rings[i][k], rings[i][k2], rings[i2][k2], rings[i2][k]))
            uk, uk2 = k / sides, (k + 1) / sides
            vv, vv2 = t[i] * vs, (t[i2] if i2 > i else 1.0) * vs
            for l, uv in zip(f.loops, ((uk, vv), (uk2, vv), (uk2, vv2), (uk, vv2))):
                l[uvl].uv = uv
    if caps and not closed:
        for i, sgn in ((0, -1), (n - 1, 1)):
            c = bm.verts.new(tuple(C[i] + T[i] * sgn * R[i] * 0.5))
            c[lay['kind']] = KIND[kind]
            c[lay['mt']] = t[i]
            c[lay['fillet']] = 1.0
            for k in range(sides):
                k2 = (k + 1) % sides
                q = (rings[i][k], rings[i][k2], c) if sgn > 0 else (rings[i][k2], rings[i][k], c)
                f = bm.faces.new(q)
                for l in f.loops:
                    l[uvl].uv = (0.5 + 0.0, 0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def member(name, S, ctrl, off, r, bow=0.0, n=None, flare=0.9, sides=7, seed=0, kind='chitin', closed=False):
    """A grown chitin member through control points on the sculpt: lightly curved (bow), swelling where it fuses
    into the next member (flare at the ends), a little irregular along its length."""
    rng = np.random.default_rng(seed)
    L = np.sum(np.linalg.norm(np.diff(np.asarray(ctrl, float), axis=0), axis=1))
    n = n or max(7, int(L / 0.016) + 2)
    if closed:
        ctrl = list(ctrl) + [ctrl[0]]
    C, N = surface_curve(S, ctrl, n, off, bow)
    t = np.linspace(0, 1, n)
    R = r * (1 + 0.12 * np.sin(t * rng.uniform(5, 9) + rng.uniform(0, 6)))
    if not closed:
        # one end grown thicker than the other, and a fillet swelling into the knot at each end
        R = R * (1 + rng.uniform(-0.32, 0.32) * (1 - 2 * t))
        R = R * (1 + flare * (np.exp(-(t / 0.15) ** 2) + np.exp(-((1 - t) / 0.15) ** 2)))
    if closed:
        C, R = C[:-1], R[:-1]
    return tube(name, C, R, sides=sides, kind=kind, closed=closed), C


def joint(name, P, N, r, squash=0.6, kind='joint'):
    """A fused node where members meet: a smooth knot flattened against the body."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=1.0)
    u = nrm(np.cross(N, [0.3, 0.5, 0.8]))
    v = np.cross(N, u)
    for vv in bm.verts:
        q = np.array(vv.co)
        vv.co = tuple(P + (u * q[0] + v * q[1]) * r + N * q[2] * r * squash)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            q = np.array(l.vert.co) - P
            l[uvl].uv = (0.5 + 0.5 * (q @ u) / r, 0.5 + 0.5 * (q @ v) / r)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    nv = len(me.vertices)
    for key, val in (('kind', KIND[kind]), ('mt', 0.5), ('fillet', 1.0), ('edge', 0.0)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(nv, val, np.float32))
    return me


def ovoid_sac(name, c, axis, r_long, r_short, kind='sac'):
    """A membrane spore sac (ovoid)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
    d = nrm(axis)
    u = nrm(np.cross(d, [0.3, 0.5, 0.8]))
    v = np.cross(d, u)
    for vv in bm.verts:
        q = np.array(vv.co)
        vv.co = tuple(c + (u * q[0] + v * q[1]) * r_short + d * q[2] * r_long)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            q = nrm(np.array(l.vert.co) - c)
            l[uvl].uv = (0.5 + math.atan2(q @ v, q @ u) / (2 * math.pi), 0.5 + 0.5 * (q @ d))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    nv = len(me.vertices)
    for key, val in (('kind', KIND[kind]), ('mt', 0.5), ('fillet', 0.0), ('edge', 0.0)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(nv, val, np.float32))
    return me


def node_grid(bmap, part, side, ss, ths, rng=None, jitter=(0.0, 0.0)):
    """Lattice nodes on the sculpt at map coordinates (len(ss) x len(ths)), jittered for a grown, irregular look."""
    rng = rng or np.random.default_rng(1)
    G = np.zeros((len(ss), len(ths), 3))
    Nn = np.zeros_like(G)
    for i, sv in enumerate(ss):
        js = np.asarray(ths, float) + rng.uniform(-jitter[1], jitter[1], len(ths))
        sj = np.full(len(ths), sv) + rng.uniform(-jitter[0], jitter[0], len(ths))
        P, N = bmap.point(part, side, sj, js, 0.0)
        G[i] = P
        Nn[i] = N
    return G, Nn


def lattice(pieces, S, G, Nn, name, off, r, rj, seed=0, diag=True, skip=0.0, closed_th=False, bow=0.004, wrap_rows=True):
    """Triangulated lattice over a node grid (rows along s, columns along th): rows, columns and one diagonal per cell,
    members lightly bowed and flared where they fuse, a knot at every node.  Returns the member sample points."""
    rng = np.random.default_rng(seed)
    ns, nt = G.shape[:2]
    pts = []
    k = 0

    def add(a, b, rr):
        nonlocal k
        # bent: the mid-span pushed sideways and the member bowed off the body by a varied amount
        ab = b - a
        side_ = nrm(np.cross(ab, S.grad(((a + b) / 2)[None])[0]))
        mid = (a + b) / 2 + side_ * rng.uniform(-0.09, 0.09) * np.linalg.norm(ab) + rng.normal(0, 0.002, 3)
        ctrl = [a, mid, b]
        me, C = member(f'{name}_m{k}', S, ctrl, off, rr * rng.uniform(0.72, 1.3), bow=bow * rng.uniform(0.6, 2.2),
                       seed=seed * 1000 + k, flare=1.15)
        pieces.append((f'{name}_m{k}', me, False))
        pts.append(C)
        k += 1
    jmax = nt if closed_th else nt - 1
    for i in range(ns):
        for j in range(jmax):
            if rng.uniform() < skip:
                continue
            add(G[i, j], G[i, (j + 1) % nt], r)
    for i in range(ns - 1):
        for j in range(nt):
            add(G[i, j], G[i + 1, j], r)
    if diag:
        for i in range(ns - 1):
            for j in range(jmax):
                if rng.uniform() < skip * 0.5:
                    continue
                if (i + j) % 2 == 0:
                    add(G[i, j], G[i + 1, (j + 1) % nt], r * 0.8)
                else:
                    add(G[i, (j + 1) % nt], G[i + 1, j], r * 0.8)
    for i in range(ns):
        for j in range(nt):
            P = S.project(G[i, j][None], iters=8)[0] + Nn[i, j] * off
            pieces.append((f'{name}_j{k}', joint(f'{name}_j{k}', P, Nn[i, j], rj * rng.uniform(0.9, 1.15)), False))
            k += 1
    return pts


def sag_thickness(body, pts, base, lift, w):
    """Membrane thickness per body vertex: lifted to the members where they run, sagging between them (the membrane
    is stretched over the lattice)."""
    P = M.coords(body.data)
    Q = np.concatenate([np.asarray(p) for p in pts]) if pts else np.zeros((0, 3))
    if not len(Q):
        return np.full(len(P), base)
    d = np.full(len(P), 1.0)
    for i in range(0, len(P), 600):
        dd = np.linalg.norm(P[i:i + 600, None, :] - Q[None, :, :], axis=2)
        d[i:i + 600] = dd.min(1)
    return base + lift * np.exp(-(d / w) ** 2)


# ---------------------------------------------------------------------------------------------- grown facets (Ixari)
KIND.update({'facet': 9, 'collar': 10})


def facet_plate(bmap, name, part, side, centre, R, height, off=0.004, sides=6, rot=0.0, stretch=1.0, collar_w=0.006,
                collar_h=0.003, sink=0.002, ridge=0.0, lean=(0.0, 0.0), terrace=False):
    """A grown crystal plate: a hexagonal (or rhombic, sides=4) slab whose top is cut into flat facets rising to a
    central point or ridge, its walls bevelled, set in a dark slate socket collar that rings its base.  Facets are
    flat-shaded (true facets, not a faceted curve).  Attributes: kind (9 facet, 10 collar), seam (1 where crystal
    meets collar: the glowing seam), edge."""
    sv, th = centre
    P0, _ = bmap.point(part, side, [sv, sv + 0.01, sv], [th, th, th + 2.0], 0.0)
    ms = np.linalg.norm(P0[1] - P0[0]) / 0.01
    mth = np.linalg.norm(P0[2] - P0[0]) / 2.0
    ang = np.radians(rot) + 2 * np.pi * np.arange(sides) / sides
    ox = np.cos(ang) * stretch
    oy = np.sin(ang)

    def ring(scale, h):
        ss = sv + oy * R * scale / ms
        tt = th + ox * R * scale / mth
        P, N = bmap.point(part, side, ss, tt, 0.0)
        return P, N
    Pb, Nb = ring(1.0, 0.0)
    Nc = Nb.mean(0)
    Nc /= np.linalg.norm(Nc)
    Pc, _ = bmap.point(part, side, [sv], [th], 0.0)
    Pc = Pc[0]
    bm = bmesh.new()
    lay = {k: bm.verts.layers.float.new(k) for k in ('kind', 'seam', 'edge', 'mt', 'fillet')}

    def V(p, kind, seam=0.0, edge=0.0):
        v = bm.verts.new(tuple(p))
        v[lay['kind']] = KIND[kind]
        v[lay['seam']] = seam
        v[lay['edge']] = edge
        return v
    base = [V(Pb[i] + Nb[i] * (off - sink), 'facet', 1.0, 1.0) for i in range(sides)]
    top = [V(Pb[i] + Nb[i] * (off + height * 0.35), 'facet', 0.0, 1.0) for i in range(sides)]
    # (lean: the crystal grows tilted, its upper rings and apex carried sideways along the plate's own axes)
    tu = (Pb[0] - Pc) / max(np.linalg.norm(Pb[0] - Pc), 1e-9)
    tv = np.cross(Nc, tu)
    sh = (tu * lean[0] + tv * lean[1]) * height
    Pi, Ni = ring(0.55, 0.0)
    mid = [V(Pi[i] + Ni[i] * (off + height * 0.8) + sh * 0.8, 'facet') for i in range(sides)]
    if ridge > 0:
        dr = (Pb[0] - Pb[sides // 2]) / 2 * ridge
        apex = [V(Pc + Nc * (off + height) + dr + sh, 'facet'), V(Pc + Nc * (off + height) - dr + sh, 'facet')]
    else:
        apex = [V(Pc + Nc * (off + height) + sh, 'facet')]
    if terrace:
        # a growth terrace: a flat step ring part-way up the walls
        Pt, Nt = ring(0.8, 0.0)
        step = [V(Pt[i] + Nt[i] * (off + height * 0.5) + sh * 0.5, 'facet', 0.0, 1.0) for i in range(sides)]
        ledge = [V(Pb[i] + Nb[i] * (off + height * 0.5) + sh * 0.5 + (Pt[i] - Pb[i]) * 0.0, 'facet', 0.0, 1.0) for i in range(sides)]
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append(bm.faces.new((base[i], base[j], top[j], top[i])))          # bevelled wall
        if terrace:
            faces.append(bm.faces.new((top[i], top[j], ledge[j], ledge[i])))
            faces.append(bm.faces.new((ledge[i], ledge[j], step[j], step[i])))
            faces.append(bm.faces.new((step[i], step[j], mid[j], mid[i])))
        else:
            faces.append(bm.faces.new((top[i], top[j], mid[j], mid[i])))        # outer facet
        if len(apex) == 1:
            faces.append(bm.faces.new((mid[i], mid[j], apex[0])))
        else:
            grp = lambda q: apex[0] if q < sides // 2 or q == sides - 1 else apex[1]
            a, b = grp(i), grp(j)
            if a is b:
                faces.append(bm.faces.new((mid[i], mid[j], a)))
            else:
                faces.append(bm.faces.new((mid[i], mid[j], b, a)))
    if len(apex) == 2:
        pass
    bottom = bm.faces.new(list(reversed(base)))
    for f in faces + [bottom]:
        f.smooth = False
    # slate collar round the base: an inner and outer ring, raised a little
    Po, No = ring(1.0 + collar_w / R, 0.0)
    cin = [V(Pb[i] + Nb[i] * (off - sink * 0.5), 'collar', 1.0) for i in range(sides)]
    cup = [V(Pb[i] + Nb[i] * (off + collar_h) + (Pb[i] - Pc) / np.linalg.norm(Pb[i] - Pc) * collar_w * 0.3, 'collar') for i in range(sides)]
    cout = [V(Po[i] + No[i] * (off * 0.3), 'collar') for i in range(sides)]
    cbot = [V(Po[i] + No[i] * (-0.002), 'collar') for i in range(sides)]
    for i in range(sides):
        j = (i + 1) % sides
        for a, b in ((cin, cup), (cup, cout), (cout, cbot)):
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uvl = bm.loops.layers.uv.new('UVMap')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    from .growths import component_uvs
    component_uvs(me)
    return me


def facet_tiles(bmap, pieces, name, part, side, s_rng, th_rng, R, height, off, rows, cols, skip=None, closed=False, seed=0):
    """A carapace of hexagonal facet plates tiled over a map patch (alternate rows offset), each in its own collar,
    the gaps between them glowing seams."""
    rng = np.random.default_rng(seed)
    ss = np.linspace(s_rng[0], s_rng[1], rows)
    k = 0
    for i, sv in enumerate(ss):
        n = cols
        ths = np.linspace(th_rng[0], th_rng[1], n, endpoint=not closed)
        if i % 2:
            ths = ths + (ths[1] - ths[0]) * 0.5 if n > 1 else ths
        for th in ths:
            if skip is not None and skip(sv, th):
                continue
            me = facet_plate(bmap, f'{name}{k}', part, side, (sv, th), R * rng.uniform(0.92, 1.05), height * rng.uniform(0.8, 1.2), off,
                             rot=30.0 + rng.uniform(-6, 6))
            pieces.append((f'{name}{k}', me, False))
            k += 1


def hex_tiles(bmap, pieces, name, part, side, s_rng, th_rng, R, height, off, gap=0.0035, skip=None, seed=0, rim=0.0, grown=True):
    """A close carapace: hexagonal facet plates packed edge to edge over a map patch (pointy along the map's s axis,
    alternate rows offset half a plate), only a narrow glowing seam and the slate collar between neighbours; rows and
    columns follow from the patch's size on the body.  `rim` > 0 grows the plates on the patch border that much taller
    (a raised edge to the shell)."""
    rng = np.random.default_rng(seed)
    sc, tc = (s_rng[0] + s_rng[1]) / 2, (th_rng[0] + th_rng[1]) / 2
    P0, _ = bmap.point(part, side, [sc, sc + 0.01, sc], [tc, tc, tc + 2.0], 0.0)
    ms = np.linalg.norm(P0[1] - P0[0]) / 0.01
    mth = np.linalg.norm(P0[2] - P0[0]) / 2.0
    Re = R + gap
    rows = max(1, int(round((s_rng[1] - s_rng[0]) * ms / (1.5 * Re))) + 1)
    cols = max(1, int(round((th_rng[1] - th_rng[0]) * mth / (np.sqrt(3) * Re))) + 1)
    ss = np.linspace(s_rng[0], s_rng[1], rows)
    ths0 = np.linspace(th_rng[0], th_rng[1], cols)
    dth = ths0[1] - ths0[0] if cols > 1 else 0.0
    k = 0
    for i, sv in enumerate(ss):
        ths = ths0 + dth * 0.5 if i % 2 else ths0
        if i % 2 and cols > 1:
            ths = ths[:-1]
        for j, th in enumerate(ths):
            if skip is not None and skip(sv, th):
                continue
            border = i in (0, rows - 1) or j in (0, len(ths) - 1)
            if grown:
                # grown, not tiled: clusters with gaps between them (a smooth field over the patch), plates of mixed
                # size and height, turned and leaning, the bigger ones terraced
                field = math.sin(sv * 23.0 + seed) * math.cos(th * 0.11 + seed * 1.7) + 0.6 * math.sin(th * 0.05 - sv * 9.0 + seed)
                if field < -0.55 or rng.uniform() < 0.1:
                    continue
                size = rng.uniform(0.62, 1.22) * (1.1 if field > 0.6 else 1.0)
                h = height * rng.uniform(0.6, 1.7) * size * (1.0 + rim * border)
                me = facet_plate(bmap, f'{name}{k}', part, side, (sv + rng.uniform(-0.2, 0.2) * R / ms, th + rng.uniform(-0.2, 0.2) * R / mth),
                                 R * size, h, off, rot=30.0 + rng.uniform(-14, 14), collar_w=0.0045 * rng.uniform(0.8, 1.4),
                                 ridge=0.35 if (i + j) % 3 == 0 else 0.0, lean=(rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45)),
                                 terrace=size > 0.95)
            else:
                h = height * rng.uniform(0.85, 1.15) * (1.0 + rim * border)
                me = facet_plate(bmap, f'{name}{k}', part, side, (sv, th), R * rng.uniform(0.96, 1.03), h, off,
                                 rot=30.0 + rng.uniform(-3, 3), collar_w=0.0045, ridge=0.35 if (i + j) % 3 == 0 else 0.0)
            pieces.append((f'{name}{k}', me, False))
            k += 1
    return k


def prism(name, base, d, length, radius, sides=4, terraces=2, collar=True, seed=0):
    """A grown prism standing off the suit (rhombic section), its terraces glowing, set in a slate socket."""
    from . import growths
    me = growths.crystal_mesh(name, [dict(base=base, dir=d, length=length, radius=radius, sides=sides, terraces=terraces,
                                           tip=0.3, flat=0.6, collar=collar)], seed=seed)
    n = len(me.vertices)
    gp = np.empty(n)
    me.attributes['gpart'].data.foreach_get('value', gp)
    gl = np.empty(n)
    me.attributes['glow'].data.foreach_get('value', gl)
    kind = np.where(gp > 0.5, KIND['collar'], KIND['facet']).astype(np.float32)
    for key, val in (('kind', kind), ('seam', gl.astype(np.float32)), ('edge', np.zeros(n, np.float32)), ('mt', np.zeros(n, np.float32)),
                     ('fillet', np.zeros(n, np.float32))):
        a = me.attributes.get(key) or me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', val)
    return me
