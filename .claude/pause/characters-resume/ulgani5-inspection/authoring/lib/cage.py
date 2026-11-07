"""The body cage: a hand-designed quad topology built ring by ring on the skeleton, so every people shares one edge
flow (loops round every joint, a 16-around torso, 8-around arms, 10-around legs, thumb and three fingers, three toes).
Rings are placed by marching rays from the bone axis to the part's own sculpt (SDF tag), then the cage is subdivided
and projected onto the full sculpt (mesh.py).

Vertex attributes kept on the cage (and interpolated by subdivision): part (int code), s (0..1 along the part), th
(angle round the part, radians), side (+1 left, -1 right, 0 centre)."""
import math

import numpy as np

from .sdf import nrm, basis

PARTS = {'torso': 0, 'arm': 1, 'hand': 2, 'leg': 3, 'foot': 4, 'finger': 5, 'thumb': 6, 'toe': 7}
MIRROR = np.array([-1.0, 1.0, 1.0])


def march(S, origins, dirs, tmax=0.4, steps=160):
    """Distance along each ray (origin inside the surface) to where the SDF first turns positive."""
    origins = np.asarray(origins, float)
    dirs = nrm(np.asarray(dirs, float))
    n = len(origins)
    ts = np.linspace(0.0, tmax, steps)
    vals = np.empty((n, steps))
    for j, t in enumerate(ts):
        vals[:, j] = S(origins + dirs * t)
    out = np.empty(n)
    for i in range(n):
        inside = vals[i] <= 0
        if inside[0]:
            pos = np.nonzero(~inside)[0]
        else:
            # the origin is outside (a ring centre that missed a thin part): march in, then out the far side; a ray
            # that never enters stops at its closest approach (the fit projects it onto the surface)
            neg = np.nonzero(inside)[0]
            if not len(neg):
                out[i] = ts[int(np.argmin(vals[i]))]
                continue
            after = np.nonzero(~inside[neg[0]:])[0]
            pos = after + neg[0] if len(after) else np.array([], int)
        if not len(pos):
            out[i] = tmax
            continue
        j = pos[0]
        if j == 0:
            out[i] = 0.0
            continue
        a, b = ts[j - 1], ts[j]
        for _ in range(20):
            m = (a + b) / 2
            if S((origins[i] + dirs[i] * m)[None])[0] > 0:
                b = m
            else:
                a = m
        out[i] = (a + b) / 2
    return out


class Cage:
    def __init__(self):
        self.co = []
        self.attr = []  # (part, s, th, side)
        self.faces = []

    def v(self, p, part, s=0.0, th=0.0, side=0.0):
        self.co.append(np.asarray(p, float))
        self.attr.append((PARTS[part], s, th, side))
        return len(self.co) - 1

    def f(self, *idx):
        self.faces.append(tuple(idx))

    def strip(self, ring_a, ring_b, closed=True):
        """Quads between two rings of equal length (same winding)."""
        n = len(ring_a)
        assert n == len(ring_b), (n, len(ring_b))
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.f(ring_a[i], ring_a[j], ring_b[j], ring_b[i])

    def ring(self, prev, pts, part, s, th, side):
        """New ring of verts at `pts`, reordered to follow `prev`, joined to it by quads."""
        co = np.array(self.co)
        o = align(co[prev], np.asarray(pts))
        th = [th[i] if hasattr(th, '__len__') else th for i in o]
        ring = [self.v(pts[i], part, s, th[k], side) for k, i in enumerate(o)]
        self.strip(prev, ring)
        return ring

    def to_mesh(self, bpy, name):
        me = bpy.data.meshes.new(name)
        co = np.array(self.co)
        me.from_pydata([tuple(c) for c in co], [], self.faces)
        me.update()
        at = np.array(self.attr, float)
        for i, key in enumerate(('part', 's', 'th', 'side')):
            a = me.attributes.new(key, 'FLOAT', 'POINT')
            a.data.foreach_set('value', at[:, i].astype(np.float32))
        for name, code in PARTS.items():
            a = me.attributes.new('p_' + name, 'FLOAT', 'POINT')
            a.data.foreach_set('value', (np.rint(at[:, 0]) == code).astype(np.float32))
        return me


def resolve_parts(me):
    """After subdivision: part = argmax of the one-hot part attributes (codes never interpolate between parts)."""
    names = list(PARTS)
    oh = []
    for n in names:
        a = me.attributes.get('p_' + n)
        v = np.zeros(len(me.vertices), np.float32)
        if a is not None:
            a.data.foreach_get('value', v)
        oh.append(v)
    code = np.array([PARTS[n] for n in names])[np.argmax(np.stack(oh, 1), 1)]
    me.attributes['part'].data.foreach_set('value', code.astype(np.float32))
    side = np.empty(len(me.vertices), np.float32)
    me.attributes['side'].data.foreach_get('value', side)
    me.attributes['side'].data.foreach_set('value', np.sign(np.round(side, 3)).astype(np.float32))


def align(prev_pts, pts):
    """Index order of `pts` (cyclic shift, maybe reversed) that best follows `prev_pts` (no twisted strips)."""
    n = len(pts)
    best, order = None, None
    for rev in (False, True):
        base = list(range(n))[::-1] if rev else list(range(n))
        for sh in range(n):
            o = base[sh:] + base[:sh]
            d = np.linalg.norm(np.asarray(prev_pts) - pts[o], axis=1).sum()
            if best is None or d < best:
                best, order = d, o
    return order


def ring_dirs(axes, angles):
    """Unit vectors round an axis frame (rows x, v, z): angle 0 = +z (front), increasing toward -x."""
    x, v, z = axes
    return np.array([z * math.cos(a) - x * math.sin(a) for a in angles])


def place(S, center, dirs, tmax=0.35):
    center = np.asarray(center, float)
    dirs = nrm(np.asarray(dirs, float))
    org = center if center.ndim == 2 else np.repeat(center[None], len(dirs), 0)
    t = march(S, org, dirs, tmax)
    return org + dirs * t[:, None]


def build_body(ctx, sdfs, prm):
    """sdfs: dict tag -> SDF of that part only (torso, arm, hand, leg, foot).  Returns a Cage (left side built,
    right mirrored), the ring index of the neck boundary (16 vertex ids) and named vertex groups of interest."""
    c = ctx
    C = Cage()
    T = sdfs['torso']
    bs = c.bs
    # ------------------------------------------------------------------ torso rings (16 round, k=0 front, k=4 left)
    N = 16
    levels = prm.get('torso_levels', [('pelvis', -0.45), ('pelvis', 0.15), ('pelvis', 0.75), ('spine_01', 0.45),
                                       ('spine_02', 0.05), ('spine_02', 0.6), ('spine_03', 0.12), ('spine_03', 0.45),
                                       ('spine_03', 0.76), ('neck_01', 0.2)])
    th = [2 * math.pi * k / N for k in range(N)]
    rings = []
    for li, (bone, t) in enumerate(levels):
        b = bs[bone]
        ctr = b['head'] + (b['tail'] - b['head']) * t
        ctr = ctr * np.array([0, 1, 1])
        dirs = np.array([(math.sin(a), -math.cos(a), 0.0) for a in th])
        if li == len(levels) - 1:
            # the neck boundary: a plane tilted with the neck
            up = nrm(bs['neck_01']['tail'] - bs['neck_01']['head'])
            dirs = dirs - np.outer(dirs @ up, up)
            dirs = nrm(dirs)
        pts = place(T, ctr, dirs)
        s = li / (len(levels) - 1)
        rings.append([C.v(pts[k], 'torso', s, th[k], 0.0 if k in (0, 8) else (1.0 if k < 8 else -1.0)) for k in range(N)])
    # torso faces, leaving the arm holes: rows 6->7 and 7->8 (levels 6..8), columns 3->4->5 and 11->12->13
    hole_rows = (6, 7)
    hole_cols_L = (3, 4)
    hole_cols_R = (11, 12)
    for r in range(len(rings) - 1):
        for k in range(N):
            if r in hole_rows and (k in hole_cols_L or k in hole_cols_R):
                continue
            k2 = (k + 1) % N
            C.f(rings[r][k], rings[r][k2], rings[r + 1][k2], rings[r + 1][k])
    neck = rings[-1]

    # ------------------------------------------------------------------ arms (8 round)
    def arm_side(sign):
        R = rings
        if sign > 0:
            loop = [R[6][3], R[6][4], R[6][5], R[7][5], R[8][5], R[8][4], R[8][3], R[7][3]]
        else:
            loop = [R[6][13], R[6][12], R[6][11], R[7][11], R[8][11], R[8][12], R[8][13], R[7][13]]
        # directions in the arm frame for the loop order: (x+z), x, (x-z), -z, (-x-z), -x, (-x+z), z  (x medial)
        ang = [math.radians(a) for a in (-45, -90, -135, 180, 135, 90, 45, 0)]
        if sign < 0:
            pass  # mirrored frame handles it
        return loop, ang

    def bone_mirror(name, sign):
        return name if sign > 0 else name[:-2] + '_R'

    def axes_of(name, sign):
        x, v, z = c.fr[name]
        if sign < 0:
            pass
        return np.array([x, v, z])

    hand_rings = {}
    for sign in (1, -1):
        loop, ang = arm_side(sign)
        A = sdfs['arm']
        ua = bone_mirror('upperarm_L', sign)
        la = bone_mirror('lowerarm_L', sign)
        # reposition the hole loop round the shoulder joint
        b = bs[ua]
        ax = axes_of(ua, sign)
        if sign < 0:
            ax = np.array([ax[0], ax[1], ax[2]])
        root_t = prm.get('arm_root_t', 0.0)
        ctr = b['head'] + (b['tail'] - b['head']) * root_t
        dirs = ring_dirs(ax, ang if sign > 0 else [-a for a in ang])
        # the hole loop: the arm's own section at the shoulder joint, pulled toward the torso ring it replaces
        pts = place(A, ctr, dirs)
        wa = prm.get('arm_root_blend', 0.65)
        for i, vi in enumerate(loop):
            C.co[vi] = pts[i] * wa + C.co[vi] * (1 - wa)
            C.attr[vi] = (PARTS['arm'], 0.0, ang[i], sign)
        prev = loop
        arm_ts = prm.get('arm_rings', [(ua, 0.12), (ua, 0.32), (ua, 0.52), (ua, 0.72), (ua, 0.88), (la, -0.02),
                                       (la, 0.08), (la, 0.28), (la, 0.5), (la, 0.72), (la, 0.9), (la, 1.0)])
        n_arm = len(arm_ts)
        for ri, (bn, t) in enumerate(arm_ts):
            bn = bone_mirror(bn[:-2] + '_L', sign)
            bb = bs[bn]
            ax = axes_of(bn, sign)
            ctr = bb['head'] + (bb['tail'] - bb['head']) * t
            dirs = ring_dirs(ax, ang if sign > 0 else [-a for a in ang])
            pts = place(A, ctr, dirs)
            s = (ri + 1) / n_arm
            prev = C.ring(prev, pts, 'arm', s, ang, sign)
        hand_rings[sign] = prev
    # ------------------------------------------------------------------ hands
    for sign in (1, -1):
        build_hand(c, C, sdfs['hand'], hand_rings[sign], sign, prm)
    # ------------------------------------------------------------------ legs (10 round) and crotch
    crotch_bone = bs['pelvis']
    cz = prm.get('crotch_z', None)
    bottom = rings[0]
    ctr = (bs['thigh_L']['head'] + bs['thigh_R']['head']) / 2
    cpt = ctr + np.array([0, 0.0, -0.035]) * c.s
    cp = place(T, ctr + np.array([0, 0, 0.02]), np.array([[0, 0.05, -1.0]]))[0]
    crotch = C.v(cp, 'torso', 0.0, 0.0, 0.0)
    for sign in (1, -1):
        if sign > 0:
            loop = [bottom[k] for k in range(0, 9)] + [crotch]
        else:
            loop = [bottom[0], crotch] + [bottom[k] for k in range(8, 16)]
            loop = loop[::-1]
            # mirror order: start at front centre going round the right side to the back, then the crotch
            loop = [bottom[0]] + [bottom[k] for k in range(15, 7, -1)] + [crotch]
        build_leg(c, C, sdfs, loop, sign, prm)
    return C, neck


def build_hand(c, C, H, wrist, sign, prm):
    """Palm rings (4 dorsal + 4 palmar), thumb from the index side near the wrist, three fingers from the end cap."""
    hn = 'hand_L' if sign > 0 else 'hand_R'
    b = c.bs[hn]
    x, v, z = c.fr[hn]  # x toward index (left; flipped by the mirrored frame on the right), z dorsal
    x = x * sign
    L = np.linalg.norm(b['tail'] - b['head'])
    pw = prm['palm_w'] * c.s
    us = [1.5, 0.5, -0.5, -1.5]
    palm_ts = prm.get('palm_rings', [0.3, 0.62, 0.92])
    web = prm.get('web_rings', [])
    rings = []
    prev = wrist
    allts = palm_ts + web
    for ri, t in enumerate(allts):
        ctr = b['head'] + (b['tail'] - b['head']) * t
        wfac = 0.8 + 0.25 * min(t, 1.0)
        pts_d = [ctr + x * (u / 1.5) * pw * wfac + z * 0.02 for u in us]
        pts_p = [ctr + x * (u / 1.5) * pw * wfac - z * 0.02 for u in us]
        # project each point on the hand sculpt along +-z from the palm midplane
        P0 = np.array([ctr + x * (u / 1.5) * pw * wfac * 0.92 for u in us] * 2)
        dirs = np.array([z] * 4 + [-z] * 4)
        if t > 1.0:
            # web rings: centres follow the fingers
            P0 = np.array([_web_point(c, sign, u, t) for u in us] * 2)
        pts = place(H, P0, dirs, 0.06) if False else _place_pairs(H, P0, dirs)
        # loop order to match the wrist ring: p(+1.5) p(+0.5) p(-0.5) p(-1.5) d(-1.5) d(-0.5) d(+0.5) d(+1.5)
        order = [4, 5, 6, 7, 3, 2, 1, 0]
        s = 1.0 + (ri + 1) / (len(allts) + 3)
        ring = []
        for k, o in enumerate(order):
            ring.append(C.v(pts[o], 'hand', s, k * math.pi / 4, sign))
        rings.append(ring)
        if ri == 0:
            # wrist -> first palm ring (matched by the best cyclic order), leaving the thumb root open: the face
            # whose palm edge is d(+1.5)-p(+1.5), the index side
            co = np.array(C.co)
            o = align(co[prev], co[ring])
            n = 8
            for i in range(n):
                j = (i + 1) % n
                a, b2 = o[i], o[j]
                if {a, b2} == {0, 7}:
                    thumb_root = [prev[i], prev[j], ring[b2], ring[a]]
                    continue
                C.f(prev[i], prev[j], ring[b2], ring[a])
        else:
            C.strip(prev, ring)
        prev = ring
    # end cap -> three finger roots (index: cols +1.5..+0.5, middle +0.5..-0.5, ring -0.5..-1.5)
    p_, d_ = prev[0:4], prev[4:8][::-1]  # p(+1.5..-1.5), d(+1.5..-1.5)
    roots = {
        'index': [d_[0], d_[1], p_[1], p_[0]],
        'middle': [d_[1], d_[2], p_[2], p_[1]],
        'ring': [d_[2], d_[3], p_[3], p_[2]],
    }
    for fname, root in roots.items():
        build_finger(c, C, H, root, fname, sign, prm)
    build_finger(c, C, H, thumb_root, 'thumb', sign, prm, thumb=True)


def _place_pairs(H, P0, dirs):
    return place(H, P0, dirs, 0.08)


def _web_point(c, sign, u, t):
    """Point on the web between the fingers at 'ring' t>1 (t=1 knuckles; webs follow the first phalanges)."""
    sfx = '_L' if sign > 0 else '_R'
    names = ['index', 'middle', 'ring']
    # columns at u=+1.5 (outer index), +0.5 (between index-middle), -0.5 (middle-ring), -1.5 (outer ring)
    f = t - 1.0
    def pt(n):
        b = c.bs[f'{n}_01{sfx}']
        return b['head'] + (b['tail'] - b['head']) * min(f / 0.5, 1.0) * 0.9
    if u > 1.0:
        p = pt('index')
        x = c.fr[f'index_01{sfx}'][0]
        return p + x * sign * 0.006 * c.s
    if u > 0:
        return (pt('index') + pt('middle')) / 2
    if u > -1.0:
        return (pt('middle') + pt('ring')) / 2
    p = pt('ring')
    x = c.fr[f'ring_01{sfx}'][0]
    return p - x * sign * 0.006 * c.s


def build_finger(c, C, H, root, fname, sign, prm, thumb=False):
    """4-around rings along the three phalanges with paired rings at each joint, capped at the tip."""
    sfx = '_L' if sign > 0 else '_R'
    names = [f'{fname}_0{i}{sfx}' for i in (1, 2, 3)]
    part = 'thumb' if thumb else 'finger'
    ts = prm.get('finger_rings', [(0, 0.18), (0, 0.55), (0, 0.86), (1, 0.12), (1, 0.55), (1, 0.85), (2, 0.15), (2, 0.55), (2, 0.86)])
    if thumb:
        ts = [(0, 0.35), (0, 0.7), (0, 0.92), (1, 0.1), (1, 0.5), (1, 0.86), (2, 0.15), (2, 0.55), (2, 0.86)]
    prev = root
    # root ring corners in the finger frame: (dorsal +x), (dorsal -x), (palmar -x), (palmar +x)  [x toward index]
    ang = [math.radians(a) for a in (45, -45, -135, 135)]
    if prm.get('web_rings') and not thumb:
        skip = len(prm['web_rings'])
        ts = ts[min(skip, 3):]
    for ri, (k, t) in enumerate(ts):
        n = names[k]
        b = c.bs[n]
        x, v, z = c.fr[n]
        ctr = b['head'] + (b['tail'] - b['head']) * t
        # z dorsal: angle 0 = +z, toward -x as the angle grows; corners at +-45 and +-135
        dirs = np.array([z * math.cos(a) - x * math.sin(a) for a in ang])
        if sign < 0:
            dirs = np.array([z * math.cos(a) + x * math.sin(a) for a in ang])
        pts = place(H, ctr, dirs, 0.05)
        s = 2.0 + (k + t) / 3.0
        prev = C.ring(prev, pts, part, s, ang, sign)
    # tip cap: a pole-free cap = one quad, pushed out to the fingertip
    C.f(prev[0], prev[1], prev[2], prev[3])


def build_leg(c, C, sdfs, loop, sign, prm):
    sfx = '_L' if sign > 0 else '_R'
    th, ca = f'thigh{sfx}', f'calf{sfx}'
    Lg = sdfs['leg']
    # angles of the root loop round the thigh axis, then relaxed toward an even spread down the leg
    b = c.bs[th]
    x, v, z = c.fr[th]
    ctr0 = b['head']
    rel = np.array(C.co)[loop] - ctr0
    ang0 = np.arctan2(-(rel @ x), rel @ z)
    ang0 = np.unwrap(ang0)
    n = len(loop)
    step = 2 * math.pi / n
    off = math.pi / n  # 18 degrees for 10: top/bottom pairs and two sides once the tube turns into the foot
    start = round((ang0[0] - off) / step) * step + off
    even = start + np.sign(ang0[-1] - ang0[0]) * np.arange(n) * step
    ts = prm.get('leg_rings', [(th, 0.1), (th, 0.28), (th, 0.48), (th, 0.68), (th, 0.86), (ca, -0.04), (ca, 0.05),
                               (ca, 0.16), (ca, 0.34), (ca, 0.54), (ca, 0.74), (ca, 0.9)])
    prev = loop
    for ri, (bn, t) in enumerate(ts):
        bn = bn[:-2] + sfx
        bb = c.bs[bn]
        xx, vv, zz = c.fr[bn]
        w = min(1.0, (ri + 1) / 4.0)
        ang = ang0 * (1 - w) + even * w
        ctr = bb['head'] + (bb['tail'] - bb['head']) * t
        dirs = np.array([zz * math.cos(a) - xx * math.sin(a) for a in ang])
        pts = place(Lg, ctr, dirs, 0.3)
        s = (ri + 1) / (len(ts) + 1)
        prev = C.ring(prev, pts, 'leg', s, list(ang), sign)
    build_foot(c, C, sdfs, prev, ang, sign, prm)


def _bezier(p0, p1, p2, p3, u):
    a = (1 - u) ** 3
    b = 3 * (1 - u) ** 2 * u
    c = 3 * (1 - u) * u * u
    d = u ** 3
    return a * p0 + b * p1 + c * p2 + d * p3


def _rotate(v, axis, ang):
    axis = nrm(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


def build_foot(c, C, sdfs, ankle, ang, sign, prm):
    """Continues the 10-around leg tube along a curve that turns from the shin into the foot (front of the shin ->
    top of the foot, back -> sole, the heel bulging behind the bend), then splits the end ring into three toes."""
    sfx = '_L' if sign > 0 else '_R'
    LF = sdfs['leg_foot']
    ca = c.bs[f'calf{sfx}']
    fb = c.bs[f'foot{sfx}']
    bb = c.bs[f'ball{sfx}']
    xx, vv, zz = c.fr[f'calf{sfx}']
    shin = nrm(ca['tail'] - ca['head'])
    fdir = nrm(bb['head'] - fb['head'])
    # the bend: ring planes fan round the lateral axis through the instep, so the back of the rings sweeps evenly
    # round the heel (Achilles -> heel -> sole) while the front gathers at the instep crease
    A = nrm(np.cross(shin, zz))  # lateral-ish axis (sign irrelevant: we rotate F toward up)
    ank = fb['head']
    r_ank = prm.get('ankle_r', 0.034) * c.s
    O = ank + zz * r_ank * 0.75 + np.array([0, 0, 0.004]) * c.s
    v0 = (ank - O)
    # choose the rotation sign that turns the shin-front toward world up
    sgn = 1.0 if np.dot(_rotate(zz, A, 0.5), np.array([0, 0, 1.0])) > np.dot(zz, [0, 0, 1.0]) else -1.0
    phis = prm.get('heel_fan', [0, 16, 32, 48, 64, 80])
    F = zz.copy()
    Lt = -xx.copy()
    prev = ankle
    n = len(ankle)
    sv = 1.0
    for ri, ph in enumerate(phis):
        a = math.radians(ph) * sgn
        Fp = _rotate(zz, A, a)
        Lp = _rotate(-xx, A, a)
        ctr = O + _rotate(v0, A, a) * prm.get('heel_reach', 1.0)
        dirs = np.array([Fp * math.cos(q) + Lp * math.sin(q) for q in ang])
        pts = place(LF, ctr, dirs, 0.12)
        sv += 0.06
        prev = C.ring(prev, pts, 'foot', sv, list(ang), sign)
    F, Lt = _rotate(zz, A, math.radians(90) * sgn), _rotate(-xx, A, math.radians(90) * sgn)
    base = O + _rotate(v0, A, math.radians(90) * sgn)
    p3 = bb['head'] + np.array([0, 0, -0.002]) * c.s
    for ri, t in enumerate(prm.get('foot_ts', [0.3, 0.6, 0.85, 1.0])):
        ctr = base * (1 - t) + p3 * t
        D = nrm(p3 - base)
        dirs = np.array([F * math.cos(q) + Lt * math.sin(q) for q in ang])
        dirs = nrm(dirs - np.outer(dirs @ D, D))
        pts = place(LF, ctr, dirs, 0.12)
        sv += 0.06
        prev = C.ring(prev, pts, 'foot', sv, list(ang), sign)
    # web rings (optional) continue toward the toes
    D = nrm(bb['tail'] - bb['head'])
    for ri, t in enumerate(prm.get('foot_web', [])):
        ctr = bb['head'] + (bb['tail'] - bb['head']) * t + np.array([0, 0, -0.002]) * c.s
        dirs = np.array([F * math.cos(a) + Lt * math.sin(a) for a in ang])
        dirs = nrm(dirs - np.outer(dirs @ D, D))
        pts = place(LF, ctr, dirs, 0.12)
        prev = C.ring(prev, pts, 'foot', 1.8 + ri * 0.05, list(ang), sign)
    build_toes(c, C, LF, prev, sign, prm, F, Lt, D)


def build_toes(c, C, Fo, end, sign, prm, F, Lt, D):
    """The end ring (10, at 18 + 36k degrees) has four top, two side and four bottom verts; two new centre verts give
    three toes 6-around roots."""
    co = np.array(C.co)
    ctr = co[end].mean(0)
    rel = co[end] - ctr
    a = np.arctan2(rel @ Lt, rel @ F)
    top = [end[i] for i in range(len(end)) if abs(a[i]) < math.radians(72)]
    bot = [end[i] for i in range(len(end)) if abs(a[i]) > math.radians(108)]
    sides = [end[i] for i in range(len(end)) if math.radians(72) <= abs(a[i]) <= math.radians(108)]
    assert len(top) == 4 and len(bot) == 4 and len(sides) == 2, (len(top), len(bot), len(sides), np.degrees(a))
    across = lambda vi: (co[vi] - ctr) @ Lt
    top = sorted(top, key=across)
    bot = sorted(bot, key=across)
    sides = sorted(sides, key=across)
    # seat the ring on the toes it splits into: the top and sole verts straight above and below the outer edges of
    # the outer toes and the valleys between neighbours, and each fork (m1, m2) on the forefoot's front between two
    # toes (verts left where the ring's own rays put them landed on the middle toe, and the outer toes' tubes then
    # cut through it: the torn shards)
    from .anatomy import toe_axes
    up = nrm(F - D * (F @ D))
    lat = nrm(Lt - D * (Lt @ D) - up * (Lt @ up))
    xs, rs = [], []
    for b0, b1, r in sorted(toe_axes(c, prm, sign), key=lambda t: (t[0] - ctr) @ lat):
        d = nrm(b1 - b0)
        q = b0 + d * (((ctr - b0) @ D) / max(d @ D, 1e-6))
        xs.append((q - ctr) @ lat)
        rs.append(r * c.s)
    tx = [xs[0] - 0.45 * rs[0], (xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2, xs[2] + 0.45 * rs[2]]
    ray = lambda x, d, back=0.0: place(Fo, ctr + lat * x - D * back, np.array([d]), 0.08)[0]
    for vi, x in zip(top, tx):
        C.co[vi] = ray(x, up)
    for vi, x in zip(bot, tx):
        C.co[vi] = ray(x, -up)
    C.co[sides[0]] = ray(0.0, -lat)
    C.co[sides[1]] = ray(0.0, lat)
    m1 = C.v(ray(tx[1], D, 0.02), 'foot', 1.95, 0.0, sign)
    m2 = C.v(ray(tx[2], D, 0.02), 'foot', 1.95, 0.0, sign)
    roots = [
        [top[0], top[1], m1, bot[1], bot[0], sides[0]],
        [top[1], top[2], m2, bot[2], bot[1], m1],
        [top[2], top[3], sides[1], bot[3], bot[2], m2],
    ]
    # toes listed medial -> lateral in prm['toes']; Lt points lateral for both feet
    for ti, root in enumerate(roots):
        build_toe(c, C, Fo, root, ti if sign > 0 else 2 - ti, sign, prm, D, F, Lt, ti)


def build_toe(c, C, Fo, root, ti, sign, prm, d, up, lat, order_i=None):
    co = np.array(C.co)
    base = co[root].mean(0)
    dx, ln, r = prm['toes'][ti]
    ln = ln * c.s
    rel = co[root] - base
    angs = np.arctan2(rel @ lat, rel @ up)
    prev = root
    splay = prm.get('toe_splay', 0.0) * ((ti if order_i is None else order_i) - 1)
    dd = nrm(d + lat * splay)
    # follow the sculpt's own toe (anatomy.foot): the nearest toe axis to this root, so the ring centres stay inside
    # the toe they wrap (a centre outside a toe collapsed rings into shards)
    from .anatomy import toe_axes
    axes = [(b0, b1) for b0, b1, _ in toe_axes(c, prm, sign)]
    k = int(np.argmin([np.linalg.norm(a[0] - base) for a in axes]))
    a0, a1 = axes[k]
    dd = nrm(a1 - a0)
    for si, t in enumerate(prm.get('toe_rings', [0.22, 0.5, 0.78])):
        ctr = base * (1 - t) + (a0 + (a1 - a0) * min(1.0, t + 0.1)) * t
        dirs = np.array([up * math.cos(a) + lat * math.sin(a) for a in angs])
        dirs = nrm(dirs - np.outer(dirs @ dd, dd))
        pts = place(Fo, ctr, dirs, 0.05)
        prev = C.ring(prev, pts, 'toe', 2.0 + t, list(angs), sign)
    C.f(prev[0], prev[1], prev[2], prev[3])
    C.f(prev[3], prev[4], prev[5], prev[0])
