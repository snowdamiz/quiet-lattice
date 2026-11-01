"""Modelling helpers for the station kits: every surface is a grid patch whose faces map onto one trim-sheet strip in
world metres (u along the patch, 8 m per texture repeat; v across the strip), so LOD0..LOD3 share materials and maps
and only the geometry thins out."""
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "tex")
U_PER_M = 1.0 / 8.0
INSET = 0.004

STRIPS = {}
for fn in os.listdir(TEX) if os.path.isdir(TEX) else []:
    if fn.endswith("_strips.json"):
        STRIPS[fn[: -len("_strips.json")]] = json.load(open(os.path.join(TEX, fn)))


def strip_v(mat, key):
    if key is None:
        return None
    v0, v1 = STRIPS[mat][key]
    return v0 + INSET, v1 - INSET


class Mesh:
    """Geometry for one object, faces grouped by material."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.fmat = []
        self.fsmooth = []
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, pts, uvs, mat, smooth=False, away=None, toward=None):
        if away is not None or toward is not None:
            P = np.asarray(pts, np.float64)
            n = np.zeros(3)
            for a, b in zip(P, np.roll(P, -1, 0)):
                n += np.cross(a, b)
            c = P.mean(0)
            ref = away(c) if callable(away) else away
            if ref is not None:
                d = c - np.asarray(ref, np.float64)
            else:
                ref = toward(c) if callable(toward) else toward
                d = np.asarray(ref, np.float64) - c
            if np.dot(n, d) < 0:
                pts, uvs = list(pts)[::-1], list(uvs)[::-1]
        base = len(self.verts)
        self.verts.extend(tuple(map(float, p)) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.uvs.append([tuple(map(float, t)) for t in uvs])
        self.fmat.append(self.mi(mat))
        self.fsmooth.append(smooth)

    def extend(self, other, xf):
        """Appends another Mesh transformed by the 4x4 matrix `xf` (a part built once, placed many times)."""
        M = np.array(xf)
        for f, uv, mi, sm in zip(other.faces, other.uvs, other.fmat, other.fsmooth):
            pts = [M[:3, :3] @ np.asarray(other.verts[i]) + M[:3, 3] for i in f]
            if np.linalg.det(M[:3, :3]) < 0:
                pts, uv = pts[::-1], uv[::-1]
            self.add(pts, uv, other.mats[mi], sm)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name, coll, weld=True):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        bverts = [bm.verts.new(v) for v in self.verts]
        for f, uv, m, sm in zip(self.faces, self.uvs, self.fmat, self.fsmooth):
            try:
                face = bm.faces.new([bverts[i] for i in f])
            except ValueError:
                continue
            face.material_index = m
            face.smooth = sm
            for loop, t in zip(face.loops, uv):
                loop[uvl].uv = t
        if weld:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(bpy.data.materials[m])
        # hard edges where smooth faces meet flat ones or turn sharply
        me.set_sharp_from_angle(angle=math.radians(40))
        o = bpy.data.objects.new(name, me)
        coll.objects.link(o)
        return o


def _cum(pts):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


def patch(m, grid, mat, key=None, smooth=False, u_off=0.0, flip=False, t_range=(0.0, 1.0), v_metres=None, uv_fn=None, away=None, toward=None, away_rows=None):
    """grid: (nu, nv, 3). u runs along axis 0 in metres, v across axis 1 normalised into the strip `key` (or, with
    v_metres, in metres from the strip bottom; or uv_fn(point) -> (u, v) for planar maps)."""
    g = np.asarray(grid, np.float64)
    nu, nv = g.shape[:2]
    us = np.stack([_cum(g[:, j]) for j in range(nv)], 1) * U_PER_M + u_off
    vs = np.stack([_cum(g[i]) for i in range(nu)], 0)
    sv = strip_v(mat, key) if key else (0.0, 1.0)
    if key is None and v_metres is None:
        vs = vs * U_PER_M  # a tileable material: metres in both directions
    elif v_metres is not None:
        span = (sv[1] - sv[0])
        vs = sv[0] + np.clip(vs / v_metres, 0, 1) * span
    else:
        tot = np.maximum(vs[:, -1:], 1e-9)
        t = t_range[0] + vs / tot * (t_range[1] - t_range[0])
        vs = sv[0] + t * (sv[1] - sv[0])
    for i in range(nu - 1):
        for j in range(nv - 1):
            idx = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if flip:
                idx = idx[::-1]
            pts = [g[a, b] for a, b in idx]
            if uv_fn:
                uvs = [uv_fn(p) for p in pts]
            else:
                uvs = [(us[a, b], vs[a, b]) for a, b in idx]
            aw = away_rows[i] if away_rows is not None else away
            m.add(pts, uvs, mat, smooth, away=aw, toward=toward)


def planar(m, pts, mat, scale=U_PER_M, off=(0.0, 0.0), axes=(0, 1), flip=False, toward=None):
    """A convex polygon with planar UVs (tileable materials)."""
    pts = [np.asarray(p, np.float64) for p in pts]
    if flip:
        pts = pts[::-1]
    uvs = [(p[axes[0]] * scale + off[0], p[axes[1]] * scale + off[1]) for p in pts]
    if toward is None:
        toward = lambda c: c + np.array([0, 0, 1.0])
    m.add(pts, uvs, mat, False, toward=toward)


def box(m, mn, mx, mat, key=None, keys=None, u_off=0.0, skip=(), xf=None):
    """Axis-aligned box (optionally transformed by the 4x4 `xf`); each face maps along its longer side."""
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    P = lambda x, y, z: np.array([x, y, z], np.float64)
    faces = {
        "-z": [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],
        "+z": [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        "-y": [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
        "+y": [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)],
        "-x": [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)],
        "+x": [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
    }
    for k, q in faces.items():
        if k in skip:
            continue
        if xf is not None:
            q = [np.array(xf @ Vector(p)) for p in q]
        a = np.linalg.norm(q[1] - q[0])
        b = np.linalg.norm(q[3] - q[0])
        if a >= b:
            grid = [[q[0], q[3]], [q[1], q[2]]]
        else:
            grid = [[q[1], q[0]], [q[2], q[3]]]
        kk = (keys or {}).get(k, key)
        bc = np.array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
        if xf is not None:
            bc = np.array(xf @ Vector(bc))
        patch(m, grid, mat, kk, u_off=u_off, away=bc)


def frames(path, up=(0, 0, 1)):
    """Tangent, normal, binormal along a polyline (parallel transport from `up`)."""
    path = np.asarray(path, np.float64)
    n = len(path)
    T = np.zeros_like(path)
    T[1:-1] = path[2:] - path[:-2]
    T[0] = path[1] - path[0]
    T[-1] = path[-1] - path[-2]
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    up = np.asarray(up, np.float64)
    if abs(np.dot(up, T[0])) > 0.95:
        up = np.array([1.0, 0, 0]) if abs(T[0][0]) < 0.9 else np.array([0, 1.0, 0])
    N = np.zeros_like(path)
    N[0] = np.cross(T[0], np.cross(up, T[0]))
    N[0] = np.cross(np.cross(T[0], up), T[0])
    N[0] /= np.linalg.norm(N[0])
    for i in range(1, n):
        v = N[i - 1] - np.dot(N[i - 1], T[i]) * T[i]
        N[i] = v / np.linalg.norm(v)
    B = np.cross(T, N)
    return T, N, B


def tube(m, path, radius, sides, mat, key, smooth=True, up=(0, 0, 1), caps=False, u_off=0.0, profile=None):
    """A swept tube; `profile` (list of (x, y) around the section) overrides the circle."""
    path = np.asarray(path, np.float64)
    T, N, B = frames(path, up)
    if profile is None:
        ang = np.linspace(0, 2 * np.pi, sides + 1)
        profile = [(math.cos(a) * radius, math.sin(a) * radius) for a in ang]
    grid = np.zeros((len(path), len(profile), 3))
    for i, p in enumerate(path):
        for j, (a, b) in enumerate(profile):
            grid[i, j] = p + N[i] * a + B[i] * b
    mids = [(path[i] + path[i + 1]) / 2 for i in range(len(path) - 1)]
    patch(m, grid, mat, key, smooth=smooth, u_off=u_off, away_rows=mids)
    if caps:
        for end, sgn in ((0, -1), (-1, 1)):
            ring = grid[end, :-1]
            pts = list(ring) if sgn > 0 else list(ring)[::-1]
            c = ring.mean(0)
            sv = strip_v(mat, key)
            uvs = [((p - c)[0] * U_PER_M * 0.5 + 0.5 * U_PER_M, sv[0] + (sv[1] - sv[0]) * 0.5) for p in pts]
            m.add(pts, uvs, mat, False, away=path[1] if end == 0 else path[-2])


def beam(m, a, b, w, h, mat, key, up=(0, 0, 1), bevel=0.0, u_off=0.0):
    """Rectangular member from a to b (bevelled corners when bevel > 0), mapped around its girth."""
    hw, hh = w / 2, h / 2
    if bevel > 0:
        c = bevel
        prof = [(-hw + c, -hh), (hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c), (-hw + c, -hh)]
    else:
        prof = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh), (-hw, -hh)]
    tube(m, [a, b], 0, 0, mat, key, smooth=False, up=up, caps=True, u_off=u_off, profile=[(y, x) for x, y in prof])


def revolve(m, prof, n, mat, key, a0=0.0, a1=2 * math.pi, center=(0, 0, 0), axis="z", smooth=True, flip=False, u_off=0.0, v_metres=None, away=None, toward=None):
    """Revolve a profile of (r, h) points round `axis` through `center`; u runs around, v along the profile."""
    c = np.asarray(center, np.float64)
    ang = np.linspace(a0, a1, n + 1)
    grid = np.zeros((n + 1, len(prof), 3))
    for i, a in enumerate(ang):
        ca, sa = math.cos(a), math.sin(a)
        for j, (r, h) in enumerate(prof):
            if axis == "z":
                p = (r * ca, r * sa, h)
            elif axis == "y":
                p = (r * ca, h, r * sa)
            else:
                p = (h, r * ca, r * sa)
            grid[i, j] = c + np.array(p)
    patch(m, grid, mat, key, smooth=smooth, flip=flip, u_off=u_off, v_metres=v_metres, away=away, toward=toward)
    return grid


def arc_pts(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(a), cz + r * math.sin(a)) for a in np.linspace(a0, a1, n + 1)]


def resample(pts, step):
    """Points along a 2D polyline every `step` metres (keeping the ends)."""
    pts = np.asarray(pts, np.float64)
    c = _cum(pts)
    n = max(1, int(round(c[-1] / step)))
    s = np.linspace(0, c[-1], n + 1)
    return np.stack([np.interp(s, c, pts[:, k]) for k in range(pts.shape[1])], 1)


def lapped_rows(m, prof, y0, y1, mat, keys, row=2.0, lap=0.14, lod=0, ny=1, flip=False, u_jitter=True, seed=0, x_of=None, away=None, toward=None, axis="y"):
    """A shell of lapped plate rows: `prof` is the section (x, z) from the eave up to the crown, extruded along y.
    Each row's lower edge stands proud by `lap` (a shingle), mapped to one plate strip; keys cycle per row index via
    keys(i) -> strip key. LOD2+ drops the lap steps but keeps the same strips, so the read does not pop."""
    prof = np.asarray(prof, np.float64)
    c = _cum(prof)
    nrow = max(1, int(round(c[-1] / row)))
    edges = np.linspace(0, c[-1], nrow + 1)
    rng = np.random.default_rng(seed)
    # outward normals of the section (to the left of the direction of travel when flip is False)
    def at(s):
        x = np.interp(s, c, prof[:, 0])
        z = np.interp(s, c, prof[:, 1])
        return np.array([x, z])

    def nrm(s):
        e = 1e-3
        d = at(min(s + e, c[-1])) - at(max(s - e, 0))
        n = np.array([d[1], -d[0]])
        if flip:
            n = -n
        return n / (np.linalg.norm(n) + 1e-12)

    ys = np.linspace(y0, y1, ny + 1)
    for i in range(nrow):
        sa, sb = edges[i], edges[i + 1]
        k = max(2, int(math.ceil((sb - sa) / 1.2)) + 1) if lod <= 1 else 2
        ss = np.linspace(sa, sb, k)
        sec = []
        for j, s in enumerate(ss):
            t = (s - sa) / (sb - sa)
            off = lap * (1 - t) if lod <= 1 else 0.0
            p = at(s) + nrm(s) * off
            sec.append(p)
        grid = np.zeros((len(ys), len(sec), 3))
        for a, y in enumerate(ys):
            for b, p in enumerate(sec):
                grid[a, b] = (p[0], y, p[1]) if axis == "y" else (y, p[0], p[1])
        uo = float(rng.random() * 8) if u_jitter else 0.0
        patch(m, grid, mat, keys(i), smooth=True, flip=flip, u_off=uo, away=away, toward=toward)
        if lod <= 1 and lap > 0:
            # the exposed lap edge: a thin face from the proud lower edge back to the shell
            p0 = at(sa)
            p1 = at(sa) + nrm(sa) * lap
            eg = np.zeros((len(ys), 2, 3))
            for a, y in enumerate(ys):
                eg[a, 0] = (p0[0], y, p0[1]) if axis == "y" else (y, p0[0], p0[1])
                eg[a, 1] = (p1[0], y, p1[1]) if axis == "y" else (y, p1[0], p1[1])
            patch(m, eg, "WS_Shell", "lip", smooth=False, flip=flip, u_off=uo, t_range=(0.0, 0.15), away=away, toward=toward)
    return nrow


def collider(coll, name, mn, mx, xf=None):
    """A box collider mesh (no material: colliders never draw)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    vs = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    if xf is not None:
        o.matrix_world = xf
    o.display_type = "WIRE"
    coll.objects.link(o)
    return o


def collider_mesh(coll, name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    o.display_type = "WIRE"
    coll.objects.link(o)
    return o


def empty(coll, name, loc, rot=(0, 0, 0), size=1.0, kind="ARROWS", props=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = size
    o.location = loc
    o.rotation_euler = rot
    for k, v in (props or {}).items():
        o[k] = v
    coll.objects.link(o)
    return o


def new_collection(name, parent):
    c = bpy.data.collections.new(name)
    parent.children.link(c)
    return c
