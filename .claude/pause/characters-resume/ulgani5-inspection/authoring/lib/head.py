"""Heads: a shared face topology per people (eye and mouth loops, lids, mouth bag) on a 32-around head that grows
out of the body's 16-around neck boundary, projected onto a per-variant head sculpt.

Cage layout (bottom to top): ring 0 = the body's neck boundary (16, identical positions), ring 1 (16), a 1->3 / 1->1
transition row to 32, rings up to the crown, and an 8x8 quad grid cap.  Eye patches and the mouth patch are faces of
the 32-around grid; insetting them gives orbital and lip loops; the opening loops are shaped explicitly (lid margins on
the eyeball, lip lines), the eye opening gets an inner lid rim, the mouth a bag.

Vertex attributes: reg (region code, see REG), and the cage ones (part, s, th, side)."""
import math

import bmesh
import numpy as np

from . import anatomy as A
from . import sdf as D
from .cage import Cage, march, place, align
from .sdf import nrm

REG = {'skin': 0, 'lid_up_L': 1, 'lid_lo_L': 2, 'lid_up_R': 3, 'lid_lo_R': 4, 'lip_up': 5, 'lip_lo': 6, 'mouth': 7,
       'orbit_L': 8, 'orbit_R': 9, 'lips_out': 10, 'neck': 11, 'eye_rim_L': 12, 'eye_rim_R': 13,
       'uorbit_L': 14, 'uorbit_R': 15, 'ulid_L': 16, 'ulid_R': 17}


# ---------------------------------------------------------------------------------------------- the sculpt
def head_sdf(ctx, P, H, body_sdf):
    """Head forms on top of the body's neck.  H: the people's (and variant's) head parameters."""
    c = ctx
    B = A.Builder(ctx)
    B.S.ops = [op for op in body_sdf.ops if op[3] == 'torso']  # neck and shoulders as the body has them
    W = A.world_axes()
    s = c.s
    hb = c.bs['head']
    base = hb['head']
    def at(x, y, z):
        return base + np.array([x, y, z]) * s
    for e in H['forms']:
        kind = e[0]
        if kind == 'ell':
            _, ctr, rad, k = e[:4]
            ax = W if len(e) < 5 else e[4]
            B.ell(at(*ctr), rad, ax, k, 'head', mirror=False)
        elif kind == 'ell2':  # mirrored pair
            _, ctr, rad, k = e[:4]
            ax = W if len(e) < 5 else e[4]
            B.ell(at(*ctr), rad, ax, k, 'head', mirror=True)
        elif kind == 'cone':
            _, a, b, ra, rb, k = e[:6]
            B.cone(at(*a), at(*b), ra, rb, k, 'head', mirror=e[6] if len(e) > 6 else False)
        elif kind == 'sub':
            _, ctr, rad, k = e[:4]
            ax = W if len(e) < 5 else e[4]
            B.ell(at(*ctr), rad, ax, k, 'head', mirror=True, op='s')
        elif kind == 'box':
            _, ctr, half, rnd, k = e[:5]
            ax = W if len(e) < 6 else e[5]
            B.box(at(*ctr), half, ax, rnd, k, 'head', mirror=False)
    for e in H.get('eyes', []):
        for side in (1, -1):
            bone = e['bone'] if side > 0 else e['bone'][:-2] + '_R'
            E, n, u, v = _eye_frame(c, bone, e['yaw'], e.get('pitch', 0.0), side)
            E = E + np.array([side * e.get('dx', 0.0), 0.0, e.get('dz', 0.0)]) * s - n * e.get('depth', 0.0) * s
            R = (e['r'] + e.get('lid', 0.0035)) * s
            B.S.add(D.Ellipsoid(E, (R, R, R)), e.get('mound_k', 0.012) * s, 'head')
    return B.S


# ---------------------------------------------------------------------------------------------- cage
def _axis_point(c, z):
    """Point on the neck/head axis at world height z (piecewise along neck_01, neck_02, head)."""
    pts = [c.bs['neck_01']['head'], c.bs['neck_02']['head'], c.bs['head']['head'], c.bs['head']['tail']]
    for a, b in zip(pts[:-1], pts[1:]):
        if a[2] <= z <= b[2] or (z < a[2] and a is pts[0]):
            t = (z - a[2]) / max(b[2] - a[2], 1e-6)
            return a + (b - a) * t
    a, b = pts[-2], pts[-1]
    t = (z - a[2]) / max(b[2] - a[2], 1e-6)
    return a + (b - a) * t


def build_head_cage(c, S, neck_pts, H):
    """Returns (bmesh with attributes, info dict)."""
    s = c.s
    C = Cage()
    N0 = len(neck_pts)
    assert N0 == 16
    r0 = [C.v(p, 'torso', 0.0, 2 * math.pi * k / 16, 0) for k, p in enumerate(neck_pts)]
    base = c.bs['head']['head']
    # ring heights relative to the eye (metres, canonical, the eye row at 0.085 above the head joint), scaled
    ez = c.bs['eye_L']['head'][2]
    hz = [ez + (h - 0.085) * s for h in H['rings']]
    th16 = [2 * math.pi * k / 16 for k in range(16)]
    th32 = [2 * math.pi * k / 32 for k in range(32)]
    off = H.get('ring_off', {})  # ring index -> forward offset of the ray origin (metres)

    def ring_pts(z, th, fwd=0.0):
        o = _axis_point(c, z) + np.array([0, -fwd * s, 0])
        dirs = np.array([(math.sin(a), -math.cos(a), 0.0) for a in th])
        return place(S, o, dirs, 0.3)

    # ring 1: 16 round, upper neck
    p1 = ring_pts(hz[0], th16)
    r1 = C.ring(r0, p1, 'torso', 0.1, th16, 0)
    # transition 16 -> 32 between r1 and r2: expanded segments (1 -> 3, two interior verts) on mirror pairs
    # E = {0, 15, 2, 13, 4, 11, 6, 9}, plain quads (1 -> 1) on the others; symmetric about the front.
    E = {0, 2, 4, 6, 9, 11, 13, 15}
    step = math.radians(22.5)
    ang2 = []
    for i in range(16):
        ang2 += [i * step + j * step / 3 for j in range(3)] if i in E else [i * step]
    p2 = ring_pts(hz[1], ang2, off.get(1, 0.0))
    r2 = [C.v(p2[k], 'torso', 0.2, ang2[k], 0) for k in range(32)]
    t = 0
    for i in range(16):
        a0, a1 = r1[i], r1[(i + 1) % 16]
        n = 3 if i in E else 1
        tops = [r2[(t + j) % 32] for j in range(n + 1)]
        t += n
        if n == 1:
            C.f(a0, a1, tops[1], tops[0])
        else:
            pa, pb = np.array(C.co[a0]), np.array(C.co[a1])
            q = [np.array(C.co[x]) for x in tops]
            m0 = C.v((pa * 2 + q[1] * 3 + q[0]) / 6, 'torso', 0.15, 0.0, 0)
            m1 = C.v((pb * 2 + q[2] * 3 + q[3]) / 6, 'torso', 0.15, 0.0, 0)
            C.f(a0, m0, tops[1], tops[0])
            C.f(m0, m1, tops[2], tops[1])
            C.f(m1, a1, tops[3], tops[2])
            C.f(a0, a1, m1, m0)
    rings = [r2]
    prev = r2
    for ri, z in enumerate(hz[2:], start=2):
        w = 0.5 if ri == 2 else 1.0
        th = [a2 * (1 - w) + a3 * w for a2, a3 in zip(ang2, th32)]
        p = ring_pts(z, th, off.get(ri, 0.0))
        ring = [C.v(p[k], 'torso', 0.2 + ri * 0.05, th32[k], 0) for k in range(32)]
        C.strip(prev, ring)
        rings.append(ring)
        prev = ring
    # crown cap: an 8x8 grid whose boundary (32 verts) is the last ring
    last = prev
    o = _axis_point(c, hz[-1]) + np.array([0, -H.get('cap_fwd', 0.0) * s, -0.04 * s])
    G = 8
    grid = {}
    # boundary order: walk the square boundary counter-clockwise from the front-centre (k=0 at (0,-1))
    bpos = []
    for k in range(32):
        a = th32[k]
        # square boundary point for angle a (front = -y)
        x, y = math.sin(a), -math.cos(a)
        m = max(abs(x), abs(y))
        bpos.append((x / m, y / m))
    # map square coords to grid indices
    for k, (x, y) in enumerate(bpos):
        i = int(round((x + 1) / 2 * G))
        j = int(round((y + 1) / 2 * G))
        grid[(i, j)] = last[k]
    for i in range(G + 1):
        for j in range(G + 1):
            if (i, j) in grid:
                continue
            u, v = i / G * 2 - 1, j / G * 2 - 1
            # interior grid point: a direction from below the crown
            d = np.array([u * 0.75, v * 0.75, 1.0])
            grid[(i, j)] = None
    interior = [(i, j) for i in range(G + 1) for j in range(G + 1) if grid[(i, j)] is None]
    dirs = []
    lastp = np.array(C.co)[last]
    R_last = np.mean(np.linalg.norm((lastp - o)[:, :2], axis=1))
    el_last = math.atan2(0.04 * s, R_last)
    for (i, j) in interior:
        u, v = i / G * 2 - 1, j / G * 2 - 1
        r = max(abs(u), abs(v))  # square rings of the grid map to cones of equal elevation
        el = el_last + (0.5 * math.pi - el_last) * (1 - r)
        az = math.atan2(u, -v) if (u or v) else 0.0
        dirs.append(np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)]))
    pts = place(S, o, np.array(dirs), 0.35)
    for (ij, p) in zip(interior, pts):
        grid[ij] = C.v(p, 'torso', 1.0, 0.0, 0)
    for i in range(G):
        for j in range(G):
            C.f(grid[(i, j)], grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)])
    info = {'rings': rings, 'r0': r0, 'r1': r1, 'hz': hz}
    return C, info


def to_bmesh(C):
    bm = bmesh.new()
    lay = {k: bm.verts.layers.float.new(k) for k in ('part', 's', 'th', 'side', 'reg')}
    vs = [bm.verts.new(tuple(p)) for p in C.co]
    bm.verts.ensure_lookup_table()
    for f in C.faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    for v, a in zip(vs, C.attr):
        for k, x in zip(('part', 's', 'th', 'side'), a):
            v[lay[k]] = x
        v[lay['reg']] = 0.0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------------------------------------- features
def patch_faces(bm, info, rows, cols):
    """Faces of the 32-around grid between ring indices rows[0]..rows[1] and columns cols[0]..cols[1] (column k at
    angle 2*pi*k/32; negative columns wrap)."""
    rings = info['rings']
    want = set()
    for r in range(rows[0], rows[1]):
        for k in range(cols[0], cols[1]):
            a = rings[r][k % 32]
            b = rings[r][(k + 1) % 32]
            c_ = rings[r + 1][(k + 1) % 32]
            d = rings[r + 1][k % 32]
            want.add(frozenset((a, b, c_, d)))
    bm.verts.ensure_lookup_table()
    return [f for f in bm.faces if frozenset(v.index for v in f.verts) in want]


def inset_loops(bm, faces, n):
    """Insets the region n times; returns the list of boundary loops [outer, l1, .., ln] as vertex lists in order
    and the inner faces."""
    loops = []
    region = faces
    for i in range(n):
        res = bmesh.ops.inset_region(bm, faces=region, thickness=0.004, depth=0.0, use_even_offset=True,
                                     use_boundary=True)
        region = region  # the same face objects remain the inner region
    return region


def inset_rings(bm, faces, n, thickness):
    """Insets the region n times; returns ([outer, ..., innermost] loops, region).  The loops are found after the
    insets by growing the region one strip at a time (inset_region may move the original boundary verts inward)."""
    region = list(faces)
    for i in range(n):
        bmesh.ops.inset_region(bm, faces=region, thickness=thickness, depth=0.0, use_even_offset=True)
    R = set(region)
    loops = [ordered_boundary(list(R))]
    for i in range(n):
        bedges = [e for f in R for e in f.edges if sum(1 for lf in e.link_faces if lf in R) == 1]
        grow = {lf for e in bedges for lf in e.link_faces if lf not in R}
        R |= grow
        loops.insert(0, ordered_boundary(list(R)))
    return loops, region


def ordered_boundary(faces):
    """Ordered loop of boundary vertices of a face region."""
    fs = set(faces)
    edges = []
    for f in faces:
        for e in f.edges:
            if sum(1 for lf in e.link_faces if lf in fs) == 1:
                edges.append(e)
    if not edges:
        return []
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = edges[0].verts[0]
    loop = [start]
    prev = None
    cur = start
    while True:
        nxt = [v for v in adj[cur] if v is not prev]
        if not nxt:
            break
        nv = nxt[0]
        if nv is start:
            break
        loop.append(nv)
        prev, cur = cur, nv
        if len(loop) > 10000:
            break
    return loop


THALUNE_HEAD = dict(
    rings=[-0.08, -0.045, -0.02, 0.0, 0.012, 0.024, 0.034, 0.044, 0.058, 0.071, 0.085, 0.099, 0.113, 0.131, 0.15,
           0.168, 0.186, 0.2],
    forms=[
        ('ell', (0, 0.002, 0.112), (0.084, 0.096, 0.094), 0.045),        # broad dome
        ('ell', (0, 0.04, 0.075), (0.07, 0.06, 0.07), 0.04),             # occiput
        ('ell', (0, -0.048, 0.05), (0.073, 0.056, 0.055), 0.045),        # broad lower face
        ('ell', (0, -0.03, 0.012), (0.066, 0.062, 0.034), 0.045),        # wide jaw
        ('ell', (0, -0.072, 0.022), (0.036, 0.026, 0.022), 0.03),        # chin
        ('ell2', (0.052, -0.038, 0.056), (0.034, 0.035, 0.03), 0.03),    # cheeks
    ],
)


# ---------------------------------------------------------------------------------------------- face features
def _layers(bm):
    L = {}
    for k in ('free', 'eyer', 'reg', 'jaw'):
        lay = bm.verts.layers.float.get(k)
        if lay is None:
            lay = bm.verts.layers.float.new(k)
            if k == 'free':
                for v in bm.verts:
                    v[lay] = 1.0
        L[k] = lay
    return L


def region_masks(bm):
    """One-hot float layers from the region codes (codes interpolate across faces and through subdivision, so the
    shaders read these masks, never the code itself): m_mouth (inside the bag), m_lip (lip borders), m_rim (the lids'
    inner rims), m_lid (lid skin)."""
    reg = bm.verts.layers.float.get('reg')
    want = {'m_mouth': (REG['mouth'],), 'm_lip': (REG['lip_up'], REG['lip_lo']),
            'm_rim': (REG['eye_rim_L'], REG['eye_rim_R']),
            'm_lid': (REG['lid_up_L'], REG['lid_lo_L'], REG['lid_up_R'], REG['lid_lo_R'], REG['ulid_L'], REG['ulid_R'])}
    for name, codes in want.items():
        lay = bm.verts.layers.float.get(name) or bm.verts.layers.float.new(name)
        for v in bm.verts:
            v[lay] = 1.0 if int(round(v[reg])) in codes else 0.0


def _loop_from(bm, region):
    return ordered_boundary(region)


def _eye_frame(c, bone, yaw, pitch, side):
    b = c.bs[bone]
    E = b['head']
    n = nrm(b['tail'] - b['head'])
    # yaw outward (toward the eye's side), pitch up
    up = np.array([0, 0, 1.0])
    lat = np.array([side, 0, 0.0])
    a = math.radians(yaw)
    n = nrm(n * math.cos(a) + lat * math.sin(a))
    p = math.radians(pitch)
    n = nrm(n * math.cos(p) + up * math.sin(p))
    u = nrm(np.cross(up, n)) * (-side)  # points to the outer corner
    if np.dot(u, lat) < 0:
        u = -u
    v = nrm(np.cross(n, u))
    if v[2] < 0:
        v = -v
    return E, n, u, v


def _beta(alpha, eye):
    """Half-angle of the lid opening at polar angle alpha (0 outer corner, 90 up, 180 inner, 270 down)."""
    bh, bu, bd = (math.radians(x) for x in eye['open'])
    bv = bu if math.sin(alpha) >= 0 else bd
    # superellipse-ish almond
    ca, sa = abs(math.cos(alpha)), abs(math.sin(alpha))
    e = eye.get('almond', 2.2)
    r = 1.0 / ((ca / bh) ** e + (sa / bv) ** e) ** (1 / e)
    return r


def _sphere_pt(E, n, u, v, r, alpha, beta, tilt=0.0):
    a = alpha
    d = n * math.cos(beta) + (u * math.cos(a) + v * math.sin(a)) * math.sin(beta)
    # tilt: outer corner up
    return E + nrm(d) * r


def add_eye(bm, info, c, H, eye, side, S):
    """Insets the eye patch, opens it, shapes orbit/lid loops on the eyeball sphere and adds the inner lid rim."""
    L = _layers(bm)
    rows, cols = eye['rows'], eye['cols']
    if side < 0:
        cols = (32 - cols[1], 32 - cols[0])
    faces = patch_faces(bm, info, rows, cols)
    loops, region = inset_rings(bm, faces, 3, eye.get('inset', 0.004))
    # open the eye: delete the inner region (faces and the verts not on its boundary)
    inner_verts = {v for f in region for v in f.verts} - set(loops[-1])
    bmesh.ops.delete(bm, geom=list(region), context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in inner_verts if v.is_valid], context='VERTS')
    bone = eye['bone'] if side > 0 else eye['bone'][:-2] + '_R'
    E, n, u, v = _eye_frame(c, bone, eye['yaw'], eye.get('pitch', 0.0), side)
    E = E + np.array([side * eye.get('dx', 0.0), 0.0, eye.get('dz', 0.0)]) * c.s - n * eye.get('depth', 0.0) * c.s
    r = eye['r'] * c.s
    lid = eye.get('lid', 0.0035) * c.s
    tilt = math.radians(eye.get('tilt', 0.0))
    # loop k: (beta scale, radius, free)
    # loops (outer to inner): (opening-angle scale, height over the eyeball in lid units, free); the last is the margin
    lspec = eye.get('loops', [(None, None, 1.0), (1.22, 1.3, 1.0), (1.08, 1.0, 0.0), (1.0, 0.0011 * c.s / lid, 0.0)])
    spec = [(a, None if b is None else r + lid * b, f) for a, b, f in lspec]
    # the almond's tilt: rotate the lid frame about the gaze (outer corner up)
    u, v = u * math.cos(tilt) + v * math.sin(tilt), -u * math.sin(tilt) + v * math.cos(tilt)
    orders = []
    for loop in loops:
        # each vertex keeps its angular rank round the eye (radially connected vertices of neighbouring loops share a
        # rank), and the ranks are spread evenly from the outer corner: no reliance on the loop's traversal direction
        P = np.array([vv.co for vv in loop])
        rel = P - E
        al = np.arctan2(rel @ v, rel @ u)
        i0 = int(np.argmin(np.abs(np.angle(np.exp(1j * al)))))
        rk = np.argsort(np.mod(al - al[i0], 2 * math.pi), kind='stable')
        order = [loop[j] for j in rk]
        orders.append((order, 1.0))
    L0pos = [np.array(vv.co) for vv in orders[0][0]]
    shell = {}
    # upper and lower lids differ: the upper lid stands higher over the eye, the lower one lies flatter
    hup, hlo = eye.get('lid_h', (1.0, 1.0))
    crease = eye.get('crease', 0.0)

    def height(rad, a):
        # radius over the eyeball scaled per lid (rad = r + lid * frac)
        f = hup if math.sin(a) >= 0 else hlo
        blend = min(1.0, abs(math.sin(a)) * 3.0)
        f = 1.0 + (f - 1.0) * blend
        return r + (rad - r) * f
    for li in range(len(loops) - 1, 0, -1):
        order, sgn = orders[li]
        bs_, rad, fr = spec[li]
        m = len(order)
        for k, vv in enumerate(order):
            a = sgn * 2 * math.pi * k / m
            if li == 1:
                # orbit: between the patch boundary vertex nearest this angle and the lid fold at this angle
                angs0 = np.array([np.arctan2((q - E) @ v, (q - E) @ u) for q in L0pos])
                j0 = int(np.argmin(np.abs(np.angle(np.exp(1j * (angs0 - a))))))
                q0 = L0pos[j0]
                b2s, r2, _ = spec[2]
                q2 = _sphere_pt(E, n, u, v, height(r2, a), a, _beta(a, eye) * b2s)
                p = q0 * 0.45 + q2 * 0.55
                # the chord from the patch edge to the fold can cut into a large eye: keep the orbit off the eyeball
                dp = p - E
                dl = np.linalg.norm(dp)
                p = E + dp / dl * max(dl, height(r2, a) + 0.6 * lid)
                if crease > 0 and math.sin(a) > 0:
                    # the upper lid's crease: the orbit loop above the lid sinks toward the eye
                    w = math.sin(a) ** 2
                    p = p - nrm(p - E) * crease * c.s * w
            else:
                b = _beta(a, eye) * bs_
                p = _sphere_pt(E, n, u, v, height(rad, a), a, b)
                shell[(li, k)] = p
            vv.co = p
            vv[L['free']] = fr if not (li == 1 and crease > 0 and math.sin(a) > 0.2) else 0.35
            vv[L['eyer']] = height(rad, a) if fr < 1.0 else 0.0
            vv[L['reg']] = (REG['lid_up_L'] if math.sin(a) >= 0 else REG['lid_lo_L']) if side > 0 else (REG['lid_up_R'] if math.sin(a) >= 0 else REG['lid_lo_R'])
            if li == 1:
                vv[L['reg']] = REG['orbit_L'] if side > 0 else REG['orbit_R']
    # inner lid rim: extrude the opening edge loop toward the eye centre
    opening = loops[-1]
    edges = [e for e in bm.edges if e.is_boundary and e.verts[0] in set(opening) and e.verts[1] in set(opening)]
    res = bmesh.ops.extrude_edge_only(bm, edges=edges)
    newv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    for vv in newv:
        d = nrm(np.array(vv.co) - E)
        vv.co = E + d * (r - 0.0016 * c.s) - n * 0.0004
        vv[L['free']] = 0.0
        vv[L['eyer']] = r - 0.0016 * c.s
        vv[L['reg']] = REG['eye_rim_L'] if side > 0 else REG['eye_rim_R']
    return dict(E=E, n=n, u=u, v=v, r=r, open_up=eye['open'][1], open_lo=eye['open'][2], upper=eye.get('upper', False),
                spec=eye)


def add_mouth(bm, info, c, H, mo, S):
    """Lip loops by inset, the opening on designed lip lines, and the mouth bag."""
    L = _layers(bm)
    rows, cols = mo['rows'], mo['cols']
    faces = patch_faces(bm, info, rows, cols)
    loops, region = inset_rings(bm, faces, 2, mo.get('inset', 0.004))
    inner_verts = {v for f in region for v in f.verts} - set(loops[-1])
    bmesh.ops.delete(bm, geom=list(region), context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in inner_verts if v.is_valid], context='VERTS')
    s = c.s
    ez = c.bs['eye_L']['head'][2]
    zc = ez + (mo['z'] - 0.085) * s
    w = mo['w'] * s
    axis = _axis_point(c, zc)
    # the mouth's surface point straight ahead
    hit = place(S, axis, np.array([[0, -1.0, 0]]), 0.3)[0]
    M = hit
    fwd = np.array([0, -1.0, 0])
    def curve(x):
        t = x / w
        return mo.get('smile', 0.0) * s * t * t
    def onface(x, z, inset):
        # point on the face at lateral x and height z (a ray straight ahead from the head axis), pushed `inset` back
        o = _axis_point(c, z)
        p = place(S, np.array([x, o[1], z]), np.array([[0, -1.0, 0.0]]), 0.3)[0]
        return p - fwd * inset
    for li, loop in enumerate(loops):
        if li == 0:
            continue
        P = np.array([vv.co for vv in loop])
        # classify: corners = extreme x; upper = above the centre line, lower = below
        xs = P[:, 0]
        iL, iR = int(np.argmin(xs)), int(np.argmax(xs))
        m = len(loop)
        # walk from the left corner to the right corner along the upper side, then back along the lower side
        seq = loop[iL:] + loop[:iL]
        iR2 = seq.index(loop[iR])
        sideA = seq[:iR2 + 1]
        sideB = [seq[0]] + seq[iR2:][::-1]
        za = np.mean([vv.co[2] for vv in sideA[1:-1]]) if len(sideA) > 2 else 0
        zb = np.mean([vv.co[2] for vv in sideB[1:-1]]) if len(sideB) > 2 else 0
        upper, lower = (sideA, sideB) if za > zb else (sideB, sideA)
        if li == len(loops) - 1:
            hw, du, dl, inset, lip = w, mo.get('gap', 0.0006) * s, mo.get('gap', 0.0006) * s, mo.get('lip_in', 0.003) * s, 1
        else:
            hw, du, dl, inset, lip = w + mo.get('border_x', 0.005) * s, mo['lip_up'] * s, mo['lip_lo'] * s, -mo.get('lip_out', 0.0015) * s, 0
        for side_list, sign in ((upper, 1), (lower, -1)):
            n_ = len(side_list) - 1
            for k, vv in enumerate(side_list):
                t = -1 + 2 * k / n_
                x = t * hw
                # corners stay on the centre line; the lip lines arc
                env = math.sqrt(max(0.0, 1 - t * t)) ** mo.get('arc', 0.6)
                z = zc + curve(x) + sign * (du if sign > 0 else dl) * env
                p = onface(x, z, inset)
                if lip:
                    p = p - fwd * 0.0 + np.array([0, 0, 0])
                vv.co = p
                vv[L['free']] = 0.0 if lip else 0.4
                vv[L['reg']] = (REG['lip_up'] if sign > 0 else REG['lip_lo']) if abs(t) < 0.999 else REG['lips_out']
                vv[L['jaw']] = 1.0 if sign < 0 and abs(t) < 0.999 else (0.5 if abs(t) >= 0.999 else 0.0)
    # mouth bag: extrude the opening three times inward, then close
    opening = loops[-1]
    ring = opening
    depth = mo.get('bag', [(0.004, 0.92, 0.001), (0.014, 0.9, 0.008), (0.012, 0.75, 0.002), (0.012, 0.6, -0.004)])
    prev_edges = [e for e in bm.edges if e.is_boundary and e.verts[0] in set(ring) and e.verts[1] in set(ring)]
    cur = ring
    for di, (dd, sc, gap) in enumerate(depth):
        res = bmesh.ops.extrude_edge_only(bm, edges=prev_edges)
        newv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        newe = [g for g in res['geom'] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
        for vv in newv:
            p = np.array(vv.co)
            cx = 0.0
            x = p[0] * sc
            z = zc + (p[2] - zc) * sc + (np.sign(p[2] - zc) * gap * s if abs(p[2] - zc) > 2e-4 else 0.0)
            y = p[1] + dd * s
            vv.co = (x, y, z)
            vv[L['free']] = 0.0
            vv[L['reg']] = REG['mouth']
            vv[L['jaw']] = 1.0 if p[2] < zc - 1e-5 else (0.5 if abs(p[2] - zc) <= 1e-5 else 0.0)
        prev_edges = newe
    # close the back
    bv = list({v for e in prev_edges for v in e.verts})
    if bv:
        res = bmesh.ops.contextual_create(bm, geom=prev_edges)
        fs = [g for g in res['faces']]
        if fs:
            bmesh.ops.triangulate(bm, faces=fs)
    return dict(M=M, zc=zc)


def eyeball(bpy, name, E, n, u, v, r, segs=24, rings=16):
    """UV sphere eyeball with its pole along the gaze, a slight corneal bulge, UVs: polar (iris at the centre)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    verts = []
    for i in range(rings + 1):
        th = math.pi * i / rings
        row = []
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            d = n * math.cos(th) + (u * math.cos(ph) + v * math.sin(ph)) * math.sin(th)
            rr = r * (1.0 + 0.06 * max(0.0, math.cos(th) - 0.82) / 0.18)
            if i in (0, rings):
                if j > 0:
                    row.append(row[0])
                    continue
            row.append(bm.verts.new(tuple(E + d * rr)))
        verts.append(row)
    for i in range(rings):
        for j in range(segs):
            a, b = verts[i][j], verts[i][(j + 1) % segs]
            c_, d_ = verts[i + 1][(j + 1) % segs], verts[i + 1][j]
            vs = []
            for x in (a, b, c_, d_):
                if x not in vs:
                    vs.append(x)
            if len(vs) < 3:
                continue
            f = bm.faces.new(vs)
            for l in f.loops:
                p = np.array(l.vert.co) - E
                th = math.acos(max(-1, min(1, np.dot(nrm(p), n))))
                ph = math.atan2(np.dot(p, v), np.dot(p, u))
                rr = th / math.pi * 0.5
                l[uv].uv = (0.5 + rr * math.cos(ph), 0.5 + rr * math.sin(ph))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def fit_head(obj, S, eyes, iters=3):
    """Projects free skin onto the sculpt, eye-region verts onto their eyeball shells, blends by 'free'."""
    from . import mesh as MM
    me = obj.data
    co = MM.coords(me)
    free = MM.attr(me, 'free')
    eyer = MM.attr(me, 'eyer')
    # subdivision blends eyer toward 0 next to free skin (whose eyer is 0): undo that dilution, or the blended
    # vertices are pulled onto a shell inside the eyeball
    eyer = np.where(free < 0.999, eyer / np.maximum(1.0 - free, 1e-3), eyer)
    E = np.array([e['E'] for e in eyes])
    def eye_proj(P):
        out = P.copy()
        idx = np.nonzero(eyer > 1e-5)[0]
        if not len(idx):
            return out
        d = np.linalg.norm(P[idx, None, :] - E[None], axis=2)
        k = np.argmin(d, axis=1)
        dirv = P[idx] - E[k]
        dirv /= np.linalg.norm(dirv, axis=1, keepdims=True) + 1e-12
        out[idx] = E[k] + dirv * eyer[idx, None]
        return out
    designed = co.copy()
    for it in range(iters + 1):
        Psdf = S.project(co, iters=8 if it == 0 else 4)
        Peye = eye_proj(co)
        base = np.where((eyer > 1e-5)[:, None], Peye, designed)
        co = Psdf * free[:, None] + base * (1 - free[:, None])
        MM.set_coords(me, co)
        if it < iters:
            n = MM.vertex_normals(me)
            bnd = MM.boundary_verts(me)
            r = MM.relax(me, co, fixed=bnd, iters=2, lam=0.4, normals=n)
            w = (0.25 + 0.75 * free)[:, None]
            co = co * (1 - w) + r * w
            designed = co * (1 - free[:, None]) + designed * free[:, None]
    return co

THALUNE_HEAD['eyes'] = [dict(bone='eye_L', r=0.0195, yaw=32, pitch=6, open=(56, 40, 34), almond=2.4, tilt=6, depth=0.004,
                             rows=(8, 11), cols=(1, 5), lid=0.0032, mound_k=0.016)]
THALUNE_HEAD['mouth'] = dict(z=0.034, w=0.034, rows=(4, 6), cols=(-3, 3), smile=0.0025, gap=0.0006, lip_in=0.003,
                             border_x=0.006, lip_up=0.0065, lip_lo=0.006, lip_out=0.0012, arc=0.5)


def nictitating(bpy, name, E, n, u, v, r, eye, nh=10, na=12, gap=None, thick=0.0003):
    """The Thalune second lid: a thin membrane on a shell just outside the eyeball, folded at the inner corner at rest
    (a narrow crescent between the lids); the lid_nict bone sweeps it across the eye."""
    gap = r * 0.068 + 0.0003 if gap is None else gap      # clear of the corneal bulge (eyeball() swells 6% at the pole)
    bh, bu, bd = (math.radians(x) for x in eye['open'])
    hs = np.linspace(bh * 0.86, bh * 1.22, nh)         # from the inner corner inward (toward -u), tucked under the lids
    a_s = np.linspace(-bd * 1.05, bu * 1.05, na)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = {}
    for side, rr in ((0, r + gap + thick), (1, r + gap)):
        for i, h in enumerate(hs):
            for j, a in enumerate(a_s):
                d = nrm(n * math.cos(h) * math.cos(a) - u * math.sin(h) * math.cos(a) + v * math.sin(a))
                grid[(side, i, j)] = bm.verts.new(tuple(E + d * rr))
    for side in (0, 1):
        for i in range(nh - 1):
            for j in range(na - 1):
                q = [grid[(side, i, j)], grid[(side, i + 1, j)], grid[(side, i + 1, j + 1)], grid[(side, i, j + 1)]]
                f = bm.faces.new(q if side == 0 else q[::-1])
                for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)) if side == 0 else
                                       ((i, j + 1), (i + 1, j + 1), (i + 1, j), (i, j))):
                    l[uvl].uv = (ii / (nh - 1), (jj / (na - 1)) * 0.5 + 0.5 * side)
    # close the free edge (the membrane's rim) between the skins
    for i in range(nh - 1):
        for j in (0, na - 1):
            q = [grid[(0, i, j)], grid[(0, i + 1, j)], grid[(1, i + 1, j)], grid[(1, i, j)]]
            f = bm.faces.new(q if j == 0 else q[::-1])
            for l in f.loops:
                l[uvl].uv = (i / (nh - 1), 0.5)
    for j in range(na - 1):
        for i in (0, nh - 1):
            q = [grid[(0, i, j)], grid[(0, i, j + 1)], grid[(1, i, j + 1)], grid[(1, i, j)]]
            f = bm.faces.new(q if i == nh - 1 else q[::-1])
            for l in f.loops:
                l[uvl].uv = (i / (nh - 1), 0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    n_ = len(me.vertices)
    for key, val in (('rib', 0.0), ('edge', 0.25)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(n_, val, np.float32))
    a = me.attributes.new('flare', 'FLOAT_VECTOR', 'POINT')
    return me
