"""Ribbed membranes (Thalune gill-frills, fins and webs): a fan or blade grown from a root line on the skin, with
radiating ribs, a scalloped edge, droop and curl, built as a closed thin solid (two skins stitched at the edge; the
root is sunk into the skin).  UVs: the (u along the root, v toward the edge) grid, top skin in the lower half of the
part's tile, bottom skin in the upper half.  Attributes: 'rib' (1 on ribs), 'edge' (v), 'mrg' (membrane id)."""
import math

import bmesh
import bpy
import numpy as np

from .sdf import nrm


def _interp(pts, u):
    pts = np.asarray(pts, float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < 1e-12:
        return np.repeat(pts[:1], len(np.atleast_1d(u)), 0)
    s /= s[-1]
    return np.array([np.interp(u, s, pts[:, i]) for i in range(pts.shape[1])]).T


def build(name, root, out_dir, normal_hint, length, M=24, K=10, rays=5, scallop=0.25, droop=0.0, curl=0.0,
          thick=0.0016, rib_h=0.0018, rib_w=0.18, sink=0.003, fan=0.0, edge_thin=0.35, profile=None, ray_len=None,
          twist=0.0):
    """root: list of 3D points along the attachment line; out_dir: list (per root point) of the direction the
    membrane grows; normal_hint: per root point, the membrane's face normal side; length: scalar or per-point list."""
    u = np.linspace(0, 1, M)
    R = _interp(root, u)
    D = nrm(_interp(out_dir, u))
    Nh = nrm(_interp(normal_hint, u))
    L = np.interp(u, np.linspace(0, 1, len(np.atleast_1d(length))), np.atleast_1d(length).astype(float))
    if profile is not None:
        L = L * profile(u)
    # scallop: the edge dips between ribs
    if rays > 0:
        ray_u = (np.arange(rays) + 0.5) / rays
        ph = np.cos(2 * math.pi * (u * rays))  # 1 on ray boundaries... use distance to nearest ray instead
        d_ray = np.min(np.abs(u[:, None] - ray_u[None]), axis=1) * rays  # 0 on a ray, 0.5 midway
        lobe = np.clip(np.cos(math.pi * d_ray), 0, 1) ** 0.6   # rounded lobes at the rays, pinched notches between
        edge = (1 - scallop) + scallop * lobe
        if ray_len is not None:
            edge = edge * np.interp(u, ray_u, ray_len)
    else:
        d_ray = np.full(M, 0.5)
        edge = np.ones(M)
    v = np.linspace(0, 1, K)
    top, bot = [], []
    for i in range(M):
        n0 = Nh[i] - np.dot(Nh[i], D[i]) * D[i]
        n0 = nrm(n0)
        side = nrm(np.cross(D[i], n0))
        # fan: rays spread along the root direction as they grow
        rowt, rowb = [], []
        for j, vv in enumerate(v):
            t = vv * L[i] * edge[i]
            dd = nrm(D[i] + side * fan * (u[i] - 0.5) * vv)
            p = R[i] - D[i] * sink + dd * (t + sink)
            # droop (toward -normal side: gravity-like bend) and curl (around the root axis)
            p = p - n0 * droop * (vv ** 2) * L[i] + side * 0.0
            if curl:
                a = curl * vv * vv
                p = p + n0 * math.sin(a) * t * 0.5
            if twist:
                p = p + side * twist * vv * L[i] * (u[i] - 0.5)
            # thickness: base membrane plus ribs, thinning toward the edge
            rib = math.exp(-(d_ray[i] / rib_w) ** 2) if rays > 0 else 0.0
            h = (thick * (1 - edge_thin * vv) + rib_h * rib * (1 - 0.6 * vv)) * 0.5
            rowt.append((p + n0 * h, rib, vv))
            rowb.append((p - n0 * h, rib, vv))
        top.append(rowt)
        bot.append(rowb)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    lr = bm.verts.layers.float.new('rib')
    le = bm.verts.layers.float.new('edge')
    vt = [[None] * K for _ in range(M)]
    vb = [[None] * K for _ in range(M)]
    for i in range(M):
        for j in range(K):
            p, rib, vv = top[i][j]
            a = bm.verts.new(tuple(p))
            a[lr], a[le] = rib, vv
            vt[i][j] = a
            if j == K - 1:
                vb[i][j] = a  # shared edge verts: the two skins meet at the edge
            else:
                p, rib, vv = bot[i][j]
                b = bm.verts.new(tuple(p))
                b[lr], b[le] = rib, vv
                vb[i][j] = b
    def uvq(i, j, bottom):
        return (u[i], (0.5 * v[j]) if not bottom else (1.0 - 0.5 * v[j]))
    for i in range(M - 1):
        for j in range(K - 1):
            f = bm.faces.new((vt[i][j], vt[i + 1][j], vt[i + 1][j + 1], vt[i][j + 1]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = uvq(ii, jj, False)
            f = bm.faces.new((vb[i][j + 1], vb[i + 1][j + 1], vb[i + 1][j], vb[i][j]))
            for l, (ii, jj) in zip(f.loops, ((i, j + 1), (i + 1, j + 1), (i + 1, j), (i, j))):
                l[uvl].uv = uvq(ii, jj, True)
    # close the two ends (u = 0 and u = 1) with strips
    for i in (0, M - 1):
        for j in range(K - 2):
            vs = (vt[i][j], vt[i][j + 1], vb[i][j + 1], vb[i][j])
            if i == M - 1:
                vs = vs[::-1]
            f = bm.faces.new(vs)
            for l in f.loops:
                l[uvl].uv = (u[i], 0.5)
        vs = (vt[i][K - 2], vt[i][K - 1], vb[i][K - 2])
        if i == M - 1:
            vs = vs[::-1]
        f = bm.faces.new(vs)
        for l in f.loops:
            l[uvl].uv = (u[i], 0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me
