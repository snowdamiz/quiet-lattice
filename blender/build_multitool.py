# Builds the first-person multitool and exports public/models/multitool.glb.
# Run: Blender -b -P blender/build_multitool.py -- <out.glb> [preview.png]
#
# Conventions the game relies on:
#   * Blender +Y = barrel / muzzle direction (exported to three.js -Z), +Z up.
#   * Muzzle: prong tips at y = 0.463 around the bore axis (x 0, z 0.028); the glowing
#     emitter lens/crystal sits at y 0.41-0.444 on that axis. Seen through the game's view
#     transform (pos 0.16,-0.15,-0.42, rot 0.03,0.06,0, scale 0.72, 60 deg view camera) the
#     beam it starts at view (0.16,-0.14,-0.66) emerges from the muzzle, and the muzzle
#     light at view (0.17,-0.12,-0.75) sits at the prong tips.
#   * Overall about 0.09 x 0.66 x 0.29 (x, y, z); triangle budget <= 25k.
#   * Material names: ToolBody, ToolAccent, ToolDark, ToolGlow (replaced in game by an
#     emissive material), ToolMetal, ToolGlass.
#   * The tool is the node "Multitool". A second node "Hand" holds the gloved right hand
#     gripping it plus the wrist cuff and a stub of suit sleeve (materials Glove,
#     GloveAccent, Sleeve; about 9.4k triangles), so the tool itself is unchanged.
# If a preview path is given, several renders are written next to it:
#   <preview>.png         in-game first-person framing (view camera, 16:9)
#   <preview>_zoom.png    same framing, 2x resolution, cropped to the tool
#   <preview>_fire.png    same framing with a proxy of the mining beam
#   <preview>_34.png      3/4 front-left view
#   <preview>_rear.png    3/4 rear-left view (close to the player's angle)
#   <preview>_side.png    left orthographic side view
#   <preview>_top.png     orthographic top view
#   <preview>_hand.png    hand close-up, 3/4 from the front-left (thumb side)
#   <preview>_hand_r.png  hand close-up from the right (back of the hand)
#   <preview>_hand_low.png  hand close-up from the front, below (wrapped fingers)
import bpy
import bmesh
import math
import os
import sys
from math import sin, cos, pi, radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "multitool.glb"
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection
PARTS = []

# ---------------------------------------------------------------- materials


def mat(name, color, metallic=0.0, rough=0.5, emission=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    return m


BODY = mat("ToolBody", (0.74, 0.73, 0.70), 0.25, 0.36)
ACCENT = mat("ToolAccent", (0.92, 0.30, 0.05), 0.25, 0.38)
DARK = mat("ToolDark", (0.035, 0.038, 0.043), 0.45, 0.48)
METAL = mat("ToolMetal", (0.56, 0.57, 0.59), 0.55, 0.30)  # moderate: the view scene has no env map
GLOW = mat("ToolGlow", (0.3, 0.85, 1.0), 0.0, 0.2, emission=(0.4, 0.9, 1.0), strength=6.0)
GLASS = mat("ToolGlass", (0.55, 0.85, 0.95), 0.0, 0.06, alpha=0.28)

# ---------------------------------------------------------------- math helpers


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(t):
    return max(0.0, min(1.0, t))


def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


class Curve:
    """Monotone cubic (PCHIP-like) interpolation through (x, y) keys."""

    def __init__(self, xs, ys):
        self.x, self.y = list(xs), list(ys)
        n = len(xs)
        d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            m[i] = 0.0 if d[i - 1] * d[i] <= 0 else 2.0 / (1.0 / d[i - 1] + 1.0 / d[i])
        self.m = m

    def __call__(self, x):
        xs = self.x
        if x <= xs[0]:
            return self.y[0]
        if x >= xs[-1]:
            return self.y[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.y[i] + (t3 - 2 * t2 + t) * h * self.m[i]
                + (-2 * t3 + 3 * t2) * self.y[i + 1] + (t3 - t2) * h * self.m[i + 1])


def spline(pts, n=8, closed=False):
    """Catmull-Rom through control points, n samples per segment."""
    P = [Vector(p) for p in pts]
    out = []
    cnt = len(P) if closed else len(P) - 1
    for i in range(cnt):
        p0 = P[(i - 1) % len(P)] if closed else P[max(i - 1, 0)]
        p1 = P[i]
        p2 = P[(i + 1) % len(P)]
        p3 = P[(i + 2) % len(P)] if closed else P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1].copy())
    return out


def basis(d, ref=None):
    """Orthonormal (u, v, d) with v = u x d; for d = +Y: u = +X, v = +Z."""
    d = Vector(d).normalized()
    ref = Vector(ref) if ref else Vector((1, 0, 0))
    if abs(ref.dot(d)) > 0.95:
        ref = Vector((0, 0, 1))
    u = (ref - d * ref.dot(d)).normalized()
    v = u.cross(d)
    return u, v, d


# ---------------------------------------------------------------- mesh helpers


def make(name, verts, faces, m, sharp=32, bevel=0.0, segs=2, smooth=True, recalc=True, harden=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update(calc_edges=True)
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    me.materials.append(m)
    if smooth:
        me.shade_smooth()
        if sharp:
            me.set_sharp_from_angle(angle=radians(sharp))
    else:
        me.shade_flat()
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segs
        b.limit_method = "ANGLE"
        b.angle_limit = radians(sharp if sharp else 30)
        b.harden_normals = harden
    PARTS.append(ob)
    return ob


def loft_faces(nr, nv, cap0=True, cap1=True, closed_path=False, closed_loop=True):
    f = []
    for i in range(nr if closed_path else nr - 1):
        i2 = (i + 1) % nr
        for j in range(nv if closed_loop else nv - 1):
            j2 = (j + 1) % nv
            f.append((i * nv + j, i * nv + j2, i2 * nv + j2, i2 * nv + j))
    if cap0 and not closed_path:
        f.append(tuple(reversed(range(nv))))
    if cap1 and not closed_path:
        f.append(tuple((nr - 1) * nv + j for j in range(nv)))
    return f


def loft(name, m, rings, cap0=True, cap1=True, closed_path=False, **kw):
    verts = [p for r in rings for p in r]
    return make(name, verts, loft_faces(len(rings), len(rings[0]), cap0, cap1, closed_path), m, **kw)


def chamfer(prof, c, closed=False):
    """Cut every sharp profile corner with a small chamfer of size c (cheap bevel)."""
    out = []
    n = len(prof)
    for i, p in enumerate(prof):
        if not closed and (i == 0 or i == n - 1 or p[0] == 0):
            out.append(p)
            continue
        b = Vector(p)
        d1 = Vector(prof[i - 1]) - b
        d2 = Vector(prof[(i + 1) % n]) - b
        if d1.length < 2.2 * c or d2.length < 2.2 * c or d1.normalized().dot(d2.normalized()) < -0.94:
            out.append(p)
            continue
        out.append(tuple(b + d1.normalized() * c))
        out.append(tuple(b + d2.normalized() * c))
    return out


def lathe(name, m, prof, segs=24, loc=(0, 0, 0), d=(0, 1, 0), ref=None, closed=False, rfun=None,
          phase=0.0, arc=None, ch=0.0, **kw):
    """Surface of revolution. prof = [(r, h)], h along d. r == 0 points become poles.
    closed=True treats prof as a closed loop (ring/torus-like part).
    rfun(r, h, phi) -> r lets a part be knurled or fluted. ch = corner chamfer size."""
    if ch:
        prof = chamfer(prof, ch, closed)
    u, v, d = basis(d, ref)
    c = Vector(loc)
    verts, faces = [], []
    ids = []
    full = arc is None
    nseg = segs if full else segs + 1
    for (r, h) in prof:
        row = []
        if r == 0 and not closed:
            verts.append(c + d * h)
            row = [len(verts) - 1] * nseg
        else:
            for j in range(nseg):
                phi = phase + (2 * pi * j / segs if full else arc[0] + (arc[1] - arc[0]) * j / segs)
                rr = rfun(r, h, phi) if rfun else r
                verts.append(c + u * (rr * cos(phi)) + v * (rr * sin(phi)) + d * h)
                row.append(len(verts) - 1)
        ids.append(row)
    n = len(prof)
    for i in range(n if closed else n - 1):
        a, b = ids[i], ids[(i + 1) % n]
        for j in range(nseg if full else nseg - 1):
            j2 = (j + 1) % nseg
            q = [a[j], a[j2], b[j2], b[j]]
            q2 = []
            for x in q:
                if x not in q2:
                    q2.append(x)
            if len(q2) >= 3:
                faces.append(tuple(q2))
    if not closed:
        for row, rev in ((ids[0], True), (ids[-1], False)):
            if len(set(row)) > 2 and full:
                faces.append(tuple(reversed(row)) if rev else tuple(row))
    return make(name, verts, faces, m, **kw)


def frames(path, up, closed=False):
    T = []
    n = len(path)
    for i in range(n):
        if closed:
            a, b = path[i - 1], path[(i + 1) % n]
        else:
            a, b = path[max(i - 1, 0)], path[min(i + 1, n - 1)]
        T.append((b - a).normalized())
    up = Vector(up)
    N = [(up - T[0] * up.dot(T[0])).normalized()]
    for i in range(1, n):
        p = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(p.normalized())
    B = [T[i].cross(N[i]) for i in range(n)]
    return T, N, B


def sweep(name, m, path, prof, up=(0, 0, 1), scales=None, cap0=True, cap1=True, closed_path=False, **kw):
    path = [Vector(p) for p in path]
    T, N, B = frames(path, up, closed_path)
    rings = []
    for i, p in enumerate(path):
        s = scales[i] if scales else (1.0, 1.0)
        rings.append([p + N[i] * (a * s[0]) + B[i] * (b * s[1]) for (a, b) in prof])
    return loft(name, m, rings, cap0, cap1, closed_path, **kw)


def circle(r, n=8):
    return [(r * cos(2 * pi * i / n), r * sin(2 * pi * i / n)) for i in range(n)]


def rrect(w, h, r, n=3):
    """Rounded rectangle profile, half sizes w, h, corner radius r."""
    pts = []
    for cx, cy, a0 in ((w - r, h - r, 0), (-w + r, h - r, 90), (-w + r, -h + r, 180), (w - r, -h + r, 270)):
        for k in range(n + 1):
            a = radians(a0 + 90 * k / n)
            pts.append((cx + r * cos(a), cy + r * sin(a)))
    return pts


def prism(name, m, prof, depth, M, loc, **kw):
    """Extrude a 2D profile along local Z of rotation M (0..depth)."""
    c = Vector(loc)
    r0 = [c + M @ Vector((x, y, 0)) for (x, y) in prof]
    r1 = [c + M @ Vector((x, y, depth)) for (x, y) in prof]
    return loft(name, m, [r0, r1], **kw)


def box(name, m, size, loc, M=None, **kw):
    M = M or Matrix.Identity(3)
    w, h, d = size[0] / 2, size[1] / 2, size[2]
    return prism(name, m, [(w, h), (-w, h), (-w, -h), (w, -h)], d, M, Vector(loc) - M @ Vector((0, 0, d / 2)), **kw)


def orient(n, up=(0, 0, 1)):
    """Rotation whose local Z = n and local Y roughly = up."""
    z = Vector(n).normalized()
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


# ---------------------------------------------------------------- parametric surfaces


class Receiver:
    """Main body: superellipse sections along Y with rounded ends."""

    def __init__(self, keys, rr0, rr1, shear=0.0, sh_range=(0, 0), sh_z=0.0):
        cols = list(zip(*keys))
        self.y0, self.y1 = cols[0][0], cols[0][-1]
        self.c = [Curve(cols[0], cols[i]) for i in range(1, 6)]
        self.rr0, self.rr1 = rr0, rr1
        self.shear, self.sh_range, self.sh_z = shear, sh_range, sh_z

    def sec(self, y):
        hw, ht, hb, cz, ex = (c(y) for c in self.c)
        s = 0.0
        if y < self.y0 + self.rr0:
            d = clamp01((self.y0 + self.rr0 - y) / self.rr0)
            s = self.rr0 * (1 - math.sqrt(max(0.0, 1 - d * d)))
        if y > self.y1 - self.rr1:
            d = clamp01((y - (self.y1 - self.rr1)) / self.rr1)
            s = self.rr1 * (1 - math.sqrt(max(0.0, 1 - d * d)))
        return hw - s, ht - s, hb - s, cz, ex

    def P(self, y, th):
        hw, ht, hb, cz, ex = self.sec(y)
        c, s = cos(th), sin(th)
        p = 2.0 / ex
        x = hw * math.copysign(abs(c) ** p, c)
        z = cz + (ht if s > 0 else hb) * math.copysign(abs(s) ** p, s)
        if self.shear:  # slant the rear end: bottom further back than the top
            y += self.shear * (z - self.sh_z) * (1 - smoothstep(self.sh_range[0], self.sh_range[1], y))
        return Vector((x, y, z))

    def C(self, y):
        return Vector((0, y, self.sec(y)[3]))


class Grip:
    """Pistol grip: egg-shaped sections along a raked axis, finger grooves and side ridges."""

    def __init__(self, top, bot):
        self.top, self.bot = Vector(top), Vector(bot)
        self.A = (self.bot - self.top)
        self.L = self.A.length
        self.A.normalize()
        self.F = Vector((0, -self.A.z, self.A.y)).normalized()  # forward (+Y-ish)
        self.X = Vector((1, 0, 0))
        self.hw = Curve([0, 0.3, 0.6, 0.85, 1.0], [0.0150, 0.0158, 0.0164, 0.0160, 0.0152])
        self.fr = Curve([0, 0.25, 0.5, 0.8, 1.0], [0.0175, 0.0182, 0.0185, 0.0180, 0.0172])
        self.bk = Curve([0, 0.2, 0.45, 0.75, 1.0], [0.0190, 0.0215, 0.0232, 0.0222, 0.0200])

    def C(self, t):
        return self.top + self.A * (t * self.L)

    def P(self, t, th):
        c, s = cos(th), sin(th)
        hw = self.hw(t)
        if s > 0:  # front: finger grooves below the trigger guard
            g = smoothstep(0.33, 0.40, t) * (1 - smoothstep(0.86, 0.93, t))
            f = self.fr(t) - 0.0028 * g * (0.5 + 0.5 * cos(2 * pi * (t - 0.40) / 0.165))
        else:
            f = self.bk(t)
        # grip texture: ridges on the sides
        side = abs(c) ** 6
        rg = smoothstep(0.30, 0.36, t) * (1 - smoothstep(0.86, 0.9, t))
        hw += 0.0008 * side * rg * (0.5 + 0.5 * sin(2 * pi * t * 12))
        # rounded bottom
        sh = 0.0
        if t > 0.93:
            d = (t - 0.93) / 0.07
            sh = 0.006 * (1 - math.sqrt(max(0.0, 1 - d * d)))
        p = 2.0 / 2.3
        x = (hw - sh) * math.copysign(abs(c) ** p, c)
        y = (f - sh) * math.copysign(abs(s) ** p, s)
        return self.C(t) + self.X * x + self.F * y


def surf_normal(S, a, th, ea=1e-4, et=1e-4):
    Pa = S.P(a + ea, th) - S.P(a - ea, th)
    Pt = S.P(a, th + et) - S.P(a, th - et)
    n = Pa.cross(Pt)
    if n.length < 1e-12:
        n = S.P(a, th) - S.C(a)
    n.normalize()
    if n.dot(S.P(a, th) - S.C(a)) < 0:
        n = -n
    return n


def surf_rings(S, a_list, nv, th0=0.0):
    return [[S.P(a, th0 + 2 * pi * j / nv) for j in range(nv)] for a in a_list]


def patch(name, m, S, a0, a1, th0, th1, off, thick, nu, nv, bevel=0.0010, segs=2, sharp=60, sink=0.0015, **kw):
    """Armour plate following surface S: an open shell (outer skin + walls sunk into the
    core). a0/a1 = (value at v=0, at v=1) along the surface, th0/th1 = (value at u=0,
    at u=1) around it, in degrees; plain numbers mean constant."""
    a0 = a0 if isinstance(a0, tuple) else (a0, a0)
    a1 = a1 if isinstance(a1, tuple) else (a1, a1)
    th0 = th0 if isinstance(th0, tuple) else (th0, th0)
    th1 = th1 if isinstance(th1, tuple) else (th1, th1)
    W = nv + 1
    verts, base = [], {}
    for i in range(nu + 1):
        u = i / nu
        for j in range(nv + 1):
            v = j / nv
            a = lerp(lerp(a0[0], a0[1], v), lerp(a1[0], a1[1], v), u)
            th = radians(lerp(lerp(th0[0], th0[1], u), lerp(th1[0], th1[1], u), v))
            P = S.P(a, th)
            n = surf_normal(S, a, th)
            verts.append(P + n * (off + thick))
            base[i * W + j] = P + n * (off - sink)
    faces = []
    for i in range(nu):
        for j in range(nv):
            faces.append((i * W + j, i * W + j + 1, (i + 1) * W + j + 1, (i + 1) * W + j))
    border = ([(0, j) for j in range(nv)] + [(i, nv) for i in range(nu)]
              + [(nu, j) for j in range(nv, 0, -1)] + [(i, 0) for i in range(nu, 0, -1)])
    inner = {}
    for (i, j) in border:
        inner[i * W + j] = len(verts)
        verts.append(base[i * W + j])
    for k in range(len(border)):
        i1, j1 = border[k]
        i2, j2 = border[(k + 1) % len(border)]
        p, q = i1 * W + j1, i2 * W + j2
        faces.append((q, p, inner[p], inner[q]))
    # orient outward
    ci, cj = nu // 2, nv // 2
    a_, b_, c_ = verts[ci * W + cj], verts[ci * W + cj + 1], verts[(ci + 1) * W + cj + 1]
    fn = (b_ - a_).cross(c_ - b_)
    am = lerp(lerp(a0[0], a0[1], 0.5), lerp(a1[0], a1[1], 0.5), 0.5)
    tm = radians(lerp(lerp(th0[0], th0[1], 0.5), lerp(th1[0], th1[1], 0.5), 0.5))
    if fn.dot(surf_normal(S, am, tm)) < 0:
        faces = [tuple(reversed(f)) for f in faces]
    return make(name, verts, faces, m, bevel=bevel, segs=segs, sharp=sharp, recalc=False, **kw)


def on_surf(S, a, th_deg, off):
    th = radians(th_deg)
    n = surf_normal(S, a, th)
    return S.P(a, th) + n * off, n


def screw(name, S, a, th, off, r=0.0019, m=None):
    p, n = on_surf(S, a, th, off)
    prof = [(0, 0.0011), (r * 0.55, 0.0011), (r, 0.0005), (r, -0.0006)]
    return lathe(name, m or METAL, prof, segs=6, loc=p, d=n, sharp=50)


# ================================================================ BUILD
AZ = 0.028  # bore axis height


def se_ring(y, cx, cz, hw, ht, hb, ex=2.6, n=16):
    p = 2.0 / ex
    out = []
    for j in range(n):
        t = 2 * pi * j / n
        c, s = cos(t), sin(t)
        out.append(Vector((cx + hw * math.copysign(abs(c) ** p, c), y,
                           cz + (ht if s > 0 else hb) * math.copysign(abs(s) ** p, s))))
    return out


def mirror_th(a, sx):
    """Plate angles are written for the left (-X) side; mirror them for the right."""
    if isinstance(a, tuple):
        return tuple(mirror_th(x, sx) for x in a)
    return a if sx == 1 else 180 - a


# ---------------------------------------------------------------- receiver core
REC = Receiver([
    # y,     hw,     ht,     hb,     cz,    exponent
    (-0.176, 0.0375, 0.0470, 0.0430, 0.032, 3.4),
    (-0.130, 0.0400, 0.0515, 0.0500, 0.032, 3.3),
    (-0.060, 0.0400, 0.0525, 0.0540, 0.030, 3.1),
    (0.012, 0.0385, 0.0505, 0.0520, 0.029, 3.0),
    (0.052, 0.0348, 0.0425, 0.0465, 0.028, 2.9),
    (0.110, 0.0320, 0.0378, 0.0400, 0.028, 2.7),
    (0.165, 0.0292, 0.0322, 0.0322, 0.028, 2.45),
    (0.200, 0.0272, 0.0282, 0.0282, 0.028, 2.25),
], 0.012, 0.004, shear=0.30, sh_range=(-0.165, -0.050), sh_z=0.034)
REAR_N = Vector((0, -1, REC.shear)).normalized()  # rear face normal


def rear_pt(x, z, out=0.0):
    """Point on the flat, slanted rear face."""
    return Vector((x, REC.y0 + REC.shear * (z - REC.sh_z), z)) + REAR_N * out


ys = [REC.y0 + REC.rr0 * (1 - sin(radians(a))) for a in (90, 68, 46, 24)]
ys += [lerp(REC.y0 + REC.rr0, REC.y1 - REC.rr1, k / 18) for k in range(19)]
ys += [REC.y1 - REC.rr1 + REC.rr1 * sin(radians(a)) for a in (45, 90)]
loft("receiver_core", DARK, surf_rings(REC, ys, 24), sharp=60)

# ---------------------------------------------------------------- armour plates
PO, PT = 0.0006, 0.0032  # plate offset / thickness
PTOP = PO + PT


def lod(n, side):
    """The right side faces away from the player: lighter plate tessellation."""
    return n if side == "L" else max(2, int(round(n * 0.7)))


for side, sx in (("L", 1), ("R", -1)):
    def th(a):
        return mirror_th(a, sx)
    patch(f"plate_top_rear_{side}", BODY, REC, -0.165, -0.079, th(97), th(152), PO, PT, lod(6, side), lod(8, side))
    patch(f"plate_top_mid_{side}", BODY, REC, -0.047, (0.026, 0.014), th(97), th(152), PO, PT, lod(6, side), lod(8, side))
    patch(f"plate_top_front_{side}", ACCENT, REC, (0.033, 0.021), (0.186, 0.168), th(97), th((150, 147)),
          PO, PT, lod(9, side), lod(7, side))
    # orange stripe laid over the rear plate
    patch(f"stripe_{side}", ACCENT, REC, -0.158, (-0.092, -0.100), th(137), th(146), PTOP - 0.0004, 0.0012, 4, 2,
          bevel=0.0004)
    # top vent between rear and mid plates
    patch(f"topvent_glow_{side}", GLOW, REC, -0.076, -0.050, th(99), th(151), 0.0, 0.0004, 2, 6, bevel=0)
    for k in range(3):
        y = -0.0735 + k * 0.0080
        patch(f"topvent_slat_{side}{k}", METAL, REC, y, y + 0.0040, th(100), th(150), 0.0005, 0.0027, 1, 5,
              bevel=0.0005, segs=1)
    patch(f"plate_side_rear_{side}", BODY, REC, -0.165, -0.071, th(157), th(203), PO, PT, lod(5, side), lod(6, side))
    patch(f"plate_side_front_{side}", BODY, REC, (-0.024, -0.030), (0.186, 0.166), th(156), th(206),
          PO, PT, lod(10, side), lod(6, side))
    patch(f"plate_low_{side}", BODY, REC, (-0.070, -0.050), (0.150, 0.128), th((213, 214)), th((246, 240)),
          PO, PT, lod(8, side), 4, segs=1)
    # side vent
    patch(f"vent_glow_{side}", GLOW, REC, -0.067, -0.028, th(160), th(200), 0.0, 0.0004, 3, 4, bevel=0)
    for k in range(5):
        y = -0.0635 + k * 0.0076
        patch(f"vent_slat_{side}{k}", METAL, REC, y, y + 0.0036, th(158), th(202), 0.0005, 0.0027, 1, 4,
              bevel=0.0005, segs=1)
    # dark rail in the gap between side and lower plates
    rail = []
    for k in range(15):
        y = lerp(-0.160, 0.172, k / 14)
        p, n = on_surf(REC, y, th(209.5), 0.0012)
        rail.append(p)
    sweep(f"rail_{side}", DARK, rail, rrect(0.0021, 0.0024, 0.0010, 1), up=(0, 0, 1), sharp=40)

# rubber thumb rest on the left rear plate
patch("thumb_pad", DARK, REC, (-0.152, -0.149), (-0.094, -0.100), 166, 194, PTOP - 0.0004, 0.0009, 4, 3,
      bevel=0.0004, segs=1)
for k in range(6):
    y = -0.147 + k * 0.0080
    patch(f"thumb_ridge{k}", DARK, REC, y, y + 0.0032, 168, 192, PTOP + 0.0003, 0.0011, 1, 4, bevel=0.0004,
          segs=1, sharp=30)

# glowing seam between top and side plates (left side faces the player)
patch("seam_glow", GLOW, REC, -0.158, 0.120, 152.6, 155.6, 0.0, 0.0011, 14, 1, bevel=0)
# small side display on the left front plate
TAGT = PTOP - 0.0003 + 0.0010
patch("tag", DARK, REC, 0.080, 0.130, 172, 192, PTOP - 0.0003, 0.0010, 3, 3, bevel=0.0004, segs=1)
for k, (t, y0, y1) in enumerate(((177.5, 0.085, 0.118), (182.0, 0.085, 0.104), (186.5, 0.085, 0.124))):
    patch(f"tag_bar{k}", GLOW, REC, y0, y1, t - 1.2, t + 1.2, TAGT - 0.0002, 0.0004, 2, 1, bevel=0)
p, n = on_surf(REC, 0.1245, 177.5, TAGT)
lathe("tag_led", ACCENT, [(0, 0.0006), (0.0013, 0.0004), (0.0013, -0.0005), (0, -0.0005)], segs=8, loc=p, d=n,
      sharp=0)

# screws on plate corners
for (a, t) in ((-0.159, 103), (-0.159, 146), (-0.041, 103), (0.012, 104), (-0.159, 197),
               (-0.077, 163), (-0.077, 197), (-0.016, 163), (0.160, 200), (0.040, 220),
               (0.120, 236), (0.165, 140)):
    screw(f"screw_L{a}_{t}", REC, a, t, PTOP)
    if t < 200:
        screw(f"screw_R{a}_{t}", REC, a, 180 - t, PTOP)

# ---------------------------------------------------------------- rear: frame, screen, coupling
ring = []
for k in range(24):
    p, n = on_surf(REC, -0.1675, k * 360 / 24, 0.0004)
    ring.append(p)
sweep("rear_frame", ACCENT, ring, rrect(0.0032, 0.0030, 0.0013, 1), up=(0, -1, 0), closed_path=True, sharp=40)

RM = orient(REAR_N)
RX, RY = RM.col[0], RM.col[1]
RO = 0.0022  # rear plate thickness above the face
face = surf_rings(REC, [REC.y0], 24)[0]
fcen = sum(face, Vector()) / len(face)
rp2 = [((p - fcen) * (1 - 0.0026 / (p - fcen).length)) for p in face]
prism("rear_plate", BODY, [(q.dot(RX), q.dot(RY)) for q in rp2], RO + 0.0006, RM, fcen - REAR_N * 0.0006,
      bevel=0.0009, segs=1, sharp=40)
for (x, z) in ((-0.0215, 0.0045), (0.0215, 0.0045), (-0.0225, 0.0255), (0.0235, 0.0275)):
    lathe(f"rear_screw{x}{z}", METAL, [(0, 0.0010), (0.0010, 0.0010), (0.0016, 0.0005), (0.0016, -0.0005)], segs=6,
          loc=rear_pt(x, z, RO), d=REAR_N, sharp=50)
SN = (REAR_N + Vector((-0.30, 0, 0.06))).normalized()  # screen turned toward the player
SM = orient(SN)
SX, SY = SM.col[0], SM.col[1]
sc = rear_pt(-0.003, 0.0465, RO)
# bezel frame with a recessed screen
fo, fi = rrect(0.0225, 0.0158, 0.0048, 2), rrect(0.0186, 0.0122, 0.0030, 2)
rings_ = [[sc + SM @ Vector((x, y, z)) for (x, y) in pr] for pr, z in ((fo, -0.005), (fo, 0.0060), (fi, 0.0060),
                                                                       (fi, 0.0036))]
loft("screen_frame", METAL, rings_, cap0=True, cap1=True, sharp=40, bevel=0.0006, segs=1)
prism("screen_glass", DARK, fi, 0.0004, SM, sc + SN * 0.0036, smooth=False)
s0 = sc + SN * 0.0042


def scr(x, y, z=0.0):
    return s0 + SX * x + SY * y + SN * z


arc_pts = [scr(-0.0085 + 0.0062 * cos(radians(a)), 0.0062 * sin(radians(a))) for a in range(40, 361, 20)]
sweep("screen_arc", GLOW, arc_pts, circle(0.00048, 4), up=SN, sharp=0)
sweep("screen_arc2", GLOW, [scr(-0.0085 + 0.0032 * cos(radians(a)), 0.0032 * sin(radians(a)))
                            for a in range(0, 360, 30)], circle(0.0003, 4), up=SN, sharp=0, closed_path=True)
sweep("screen_sweep", GLOW, [scr(-0.0085, 0.0), scr(-0.0085 + 0.0044, 0.0044)], circle(0.0003, 4), up=SN, sharp=0)
for k, ln in enumerate((0.0110, 0.0080, 0.0130)):
    box(f"screen_bar{k}", GLOW, (ln, 0.0018, 0.0005), scr(0.0010 + ln / 2, 0.0060 - k * 0.0055), SM, smooth=False)
box("screen_blip", ACCENT, (0.0018, 0.0018, 0.0006), scr(-0.0062, 0.0035), SM, smooth=False)

# lower rear: louvred vent + power coupling
vc = rear_pt(-0.0110, 0.0160, RO)
box("rear_vent_glow", GLOW, (0.0185, 0.0150, 0.0010), vc, RM, smooth=False)
box("rear_vent_frame", DARK, (0.0225, 0.0190, 0.0012), vc - REAR_N * 0.0004, RM, bevel=0.0004, segs=1)
for k in range(3):
    box(f"rear_louver{k}", METAL, (0.0200, 0.0026, 0.0030), vc + RY * (0.0050 - k * 0.0050) + REAR_N * 0.0012, RM,
        bevel=0.0005, segs=1)
rc = rear_pt(0.0125, 0.0155, RO)
lathe("rear_coupling", METAL, [(0, -0.0090), (0.0060, -0.0090), (0.0070, -0.0080), (0.0070, -0.0052),
                               (0.0086, -0.0048), (0.0086, -0.0010), (0.0100, -0.0004), (0.0100, 0.003),
                               (0, 0.003)], segs=16, loc=rc, d=-REAR_N, sharp=40)
lathe("rear_coupling_knurl", DARK, [(0.0080, -0.0046), (0.0090, -0.0046), (0.0090, -0.0016), (0.0080, -0.0016)],
      segs=24, loc=rc, d=-REAR_N, closed=True, rfun=lambda r, h, f: r + 0.0006 * (0.5 + 0.5 * cos(12 * f)),
      sharp=50)
lathe("rear_coupling_glow", GLOW, [(0, -0.0093), (0.0036, -0.0093), (0.0036, -0.0085), (0, -0.0085)],
      segs=10, loc=rc, d=-REAR_N, sharp=0)

# ---------------------------------------------------------------- energy canister (top)
CZ, CR = 0.1005, 0.0135
cl = Vector((0, 0, CZ))


def knurl(n, amp):
    return lambda r, h, phi: r + amp * (0.5 + 0.5 * cos(phi * n))


lathe("can_rear_cap", METAL, [(0, -0.1360), (0.0106, -0.1360), (0.0130, -0.1340), (0.0130, -0.1300),
                              (0.0150, -0.1290), (0.0150, -0.1190), (0.0158, -0.1180), (0.0158, -0.1066),
                              (0.0150, -0.1055), (0.0135, -0.1050), (0, -0.1050)], segs=20, loc=cl, sharp=40)
lathe("can_rear_knurl", DARK, [(0.0124, -0.1336), (0.0136, -0.1336), (0.0136, -0.1298), (0.0124, -0.1298)],
      segs=32, loc=cl, closed=True, rfun=knurl(16, 0.0009), sharp=50)
lathe("can_rear_knob", ACCENT, [(0, -0.1405), (0.0050, -0.1405), (0.0064, -0.1385), (0.0064, -0.1355),
                                (0, -0.1355)], segs=14, loc=cl, ch=0.0004, sharp=40)
lathe("can_glass", GLASS, [(0, -0.107), (CR - 0.0012, -0.107), (CR - 0.0012, 0.040), (0, 0.040)],
      segs=24, loc=cl, sharp=80)
lathe("can_core", GLOW, [(0, -0.104)] + [(0.0046 + 0.0012 * cos(2 * pi * k / 18 * 6), -0.102 + 0.140 * k / 18)
                                          for k in range(19)] + [(0, 0.038)], segs=8, loc=cl, sharp=0)
hel = [Vector((0.0078 * cos(2 * pi * 3 * k / 24), -0.100 + 0.136 * k / 24, CZ + 0.0078 * sin(2 * pi * 3 * k / 24)))
       for k in range(25)]
sweep("can_filament", METAL, hel, circle(0.0006, 4), up=(0, 1, 0), sharp=0)
lathe("can_front_cap", METAL, [(0, 0.0380), (0.0135, 0.0380), (0.0158, 0.0400), (0.0158, 0.0545), (0.0148, 0.0555),
                               (0.0148, 0.0600), (0.0122, 0.0650), (0.0070, 0.0665), (0, 0.0665)],
      segs=20, loc=cl, ch=0.0004, sharp=40)
lathe("can_front_band", ACCENT, [(0.0153, 0.0425), (0.0164, 0.0430), (0.0164, 0.0500), (0.0153, 0.0505)],
      segs=20, loc=cl, closed=True, sharp=50)
for k, y in enumerate((-0.080, -0.022)):
    lathe(f"can_clamp{k}", DARK, [(CR - 0.0003, y), (CR + 0.0019, y + 0.0003), (CR + 0.0019, y + 0.0064),
                                  (CR - 0.0003, y + 0.0067)], segs=20, loc=cl, closed=True, sharp=40)
    box(f"can_saddle{k}", DARK, (0.017, 0.0067, 0.018), (0, y + 0.00335, CZ - CR - 0.005), bevel=0.0008)
box("can_saddle_f", DARK, (0.020, 0.018, 0.024), (0, 0.050, CZ - CR - 0.0095), bevel=0.001)
box("can_saddle_r", DARK, (0.020, 0.026, 0.012), (0, -0.121, CZ - CR - 0.004), bevel=0.001)


# hoses: canister -> emitter collar, lying on the shell
def hose_path(sx, lift):
    out = [Vector((-sx * 0.0135, 0.054, CZ - 0.004)), Vector((-sx * 0.0190, 0.064, CZ - 0.011))]
    for (y, t) in ((0.086, 129), (0.110, 144), (0.138, 155), (0.164, 162)):
        p, n = on_surf(REC, y, mirror_th(t, sx), PTOP + lift)
        out.append(p)
    out.append(Vector((-sx * 0.0270, 0.192, 0.046)))
    return spline(out, n=4)


hl = hose_path(1, 0.0030)
rib = [(1.0 + 0.15 * (0.5 + 0.5 * cos(2 * pi * k / 3)),) * 2 for k in range(len(hl))]
sweep("hose_L", DARK, hl, circle(0.0029, 7), up=(0, 0, 1), scales=rib, sharp=50)
hr = hose_path(-1, 0.0023)
sweep("hose_R", ACCENT, hr, circle(0.0022, 6), up=(0, 0, 1), sharp=50)
for sx, hp, r in ((1, hl, 0.0034), (-1, hr, 0.0026)):
    i = len(hp) // 2 + 1
    lathe(f"hose_clip{sx}", METAL, [(r, -0.0035), (r + 0.0008, -0.0028), (r + 0.0008, 0.0028), (r, 0.0035)],
          segs=10, loc=hp[i], d=hp[i + 1] - hp[i - 1], closed=True, sharp=40)

# ---------------------------------------------------------------- scanner pod (top front)
pod = [se_ring(0.068, 0, 0.0745, 0.0035, 0.0030, 0.0030, 2.4),
       se_ring(0.074, 0, 0.0750, 0.0085, 0.0075, 0.0075, 2.6),
       se_ring(0.086, 0, 0.0752, 0.0118, 0.0098, 0.0098, 2.8),
       se_ring(0.138, 0, 0.0728, 0.0124, 0.0098, 0.0098, 2.8),
       se_ring(0.152, 0, 0.0722, 0.0116, 0.0090, 0.0090, 2.8),
       se_ring(0.1565, 0, 0.0722, 0.0098, 0.0074, 0.0074, 2.6)]
loft("scanner_pod", BODY, pod, sharp=45)
box("scanner_band", DARK, (0.0262, 0.006, 0.0210), (0, 0.1305, 0.0730), Matrix.Rotation(radians(-90), 3, "X"),
    bevel=0.0006)
for k, (x, z, r) in enumerate(((-0.0050, 0.0745, 0.0040), (0.0050, 0.0745, 0.0040), (0.0, 0.0680, 0.0024))):
    lp = Vector((x, 0.1560, z))
    lathe(f"lens_rim{k}", DARK, [(r * 0.85, -0.002), (r + 0.0008, 0.0), (r + 0.0008, 0.0020), (r, 0.0024),
                                 (r * 0.75, 0.0014), (0, 0.0014)], segs=12, loc=lp, sharp=40)
    lathe(f"lens_eye{k}", GLOW, [(0, 0.0022), (r * 0.42, 0.0019), (r * 0.75, 0.0014), (0, 0.0014)], segs=10,
          loc=lp, sharp=0)
box("scanner_led", GLOW, (0.010, 0.0011, 0.0016), (0, 0.0742, 0.0808), Matrix.Rotation(radians(-55), 3, "X"),
    smooth=False)
# dish on the right shoulder + antenna at the rear
dp = Vector((0.030, 0.006, 0.083))
dn = Vector((0.55, 0.30, 0.78)).normalized()
lathe("dish_mast", METAL, [(0, -0.012), (0.0024, -0.012), (0.0024, 0.0), (0, 0.0)], segs=10, loc=dp, d=dn, sharp=40)
dish = [(0.0, 0.0), (0.0045, 0.0004), (0.0090, 0.0017), (0.0128, 0.0036), (0.0142, 0.0045), (0.0136, 0.0054),
        (0.0120, 0.0048), (0.0083, 0.0030), (0.0042, 0.0019), (0.0, 0.0015)]
lathe("dish", BODY, dish, segs=16, loc=dp, d=dn, closed=True, sharp=45)
lathe("dish_horn", DARK, [(0, 0.0015), (0.0015, 0.0015), (0.0011, 0.0090), (0, 0.0095)], segs=8, loc=dp, d=dn,
      sharp=40)
lathe("dish_tip", GLOW, [(0, 0.0086), (0.0013, 0.0093), (0, 0.0102)], segs=8, loc=dp, d=dn, sharp=0)
ant_base = Vector((0.022, -0.140, 0.080))
ant_d = Vector((0.12, -0.25, 1))
lathe("antenna", METAL, [(0, 0), (0.0020, 0), (0.0020, 0.0045), (0.0009, 0.0065), (0.0006, 0.052), (0, 0.052)],
      segs=8, loc=ant_base, d=ant_d, sharp=40)
lathe("antenna_tip", ACCENT, [(0, 0.050), (0.0022, 0.0525), (0.0022, 0.0555), (0, 0.058)], segs=10,
      loc=ant_base, d=ant_d, sharp=40)

# ---------------------------------------------------------------- under-barrel module
JAW = Receiver([
    # y,    hw,     ht,     hb,     cz,     exponent
    (0.018, 0.0170, 0.0150, 0.0150, -0.010, 2.9),
    (0.050, 0.0215, 0.0170, 0.0195, -0.010, 3.0),
    (0.105, 0.0215, 0.0175, 0.0185, -0.007, 3.0),
    (0.155, 0.0195, 0.0165, 0.0145, -0.001, 2.9),
    (0.198, 0.0160, 0.0130, 0.0100, 0.006, 2.7),
], 0.008, 0.006)
jy = [JAW.y0 + JAW.rr0 * (1 - sin(radians(a))) for a in (90, 60, 30)]
jy += [lerp(JAW.y0 + JAW.rr0, JAW.y1 - JAW.rr1, k / 9) for k in range(10)]
jy += [JAW.y1 - JAW.rr1 + JAW.rr1 * sin(radians(a)) for a in (30, 60, 90)]
loft("jaw_core", DARK, surf_rings(JAW, jy, 16), sharp=50)
for side, sx in (("L", 1), ("R", -1)):
    def th(a):
        return mirror_th(a, sx)
    patch(f"jaw_plate_r_{side}", ACCENT, JAW, (0.024, 0.032), (0.078, 0.070), th(150), th(258), 0.0004, 0.0026, 4, 8)
    patch(f"jaw_plate_f_{side}", ACCENT, JAW, (0.126, 0.118), (0.193, 0.181), th(150), th(258), 0.0004, 0.0026, 4, 8)
    patch(f"jaw_vent_glow_{side}", GLOW, JAW, 0.078, 0.120, th(196), th(246), 0.0, 0.0004, 2, 3, bevel=0)
    for k in range(3):
        y = 0.0820 + k * 0.0128
        patch(f"jaw_slat_{side}{k}", DARK, JAW, y, y + 0.0060, th(190), th(252), 0.0004, 0.0024, 1, 4,
              bevel=0.0004, segs=1)

# ---------------------------------------------------------------- emitter / barrel assembly
B0 = Vector((0, 0, AZ))
lathe("collar", DARK, [(0, 0.184), (0.0280, 0.184), (0.0322, 0.1872), (0.0332, 0.1900), (0.0332, 0.1985),
                       (0.0310, 0.2005), (0.0310, 0.2075), (0.0332, 0.2095), (0.0332, 0.2190), (0.0322, 0.2220),
                       (0.0300, 0.2265), (0.0220, 0.230), (0, 0.230)], segs=24, loc=B0, sharp=40)
lathe("collar_band", ACCENT, [(0.0309, 0.2010), (0.0320, 0.2020), (0.0320, 0.2060), (0.0309, 0.2070)],
      segs=28, loc=B0, closed=True, sharp=50)
lathe("barrel_core", METAL, [(0, 0.226), (0.0105, 0.226), (0.0105, 0.405), (0, 0.405)], segs=16, loc=B0, sharp=60)
turns, n = 7, 7 * 10
coil = [Vector((0.0162 * cos(2 * pi * turns * k / n), 0.2405 + 0.0625 * k / n,
                AZ + 0.0162 * sin(2 * pi * turns * k / n))) for k in range(n + 1)]
sweep("coil", ACCENT, coil, circle(0.0027, 5), up=(0, 1, 0), sharp=0)
for k, y in enumerate((0.2335, 0.3035)):
    lathe(f"coil_ring{k}", DARK, [(0.0100, y), (0.0232, y), (0.0240, y + 0.0010), (0.0240, y + 0.0055),
                                  (0.0232, y + 0.0065), (0.0100, y + 0.0065)], segs=18, loc=B0, closed=True,
          sharp=40)
for k, ang in enumerate((45, 135, 225, 315)):
    e = Vector((cos(radians(ang)), 0, sin(radians(ang))))
    pts = [B0 + e * r + Vector((0, y, 0)) for (r, y) in ((0.0285, 0.222), (0.0318, 0.250), (0.0325, 0.285),
                                                         (0.0312, 0.318), (0.0300, 0.340))]
    sweep(f"strut{k}", BODY if k < 2 else DARK, spline(pts, n=3), rrect(0.0028, 0.0044, 0.0014, 1), up=e,
          sharp=40)
fin = [(0, 0.3095), (0.0120, 0.3095)]
for k in range(3):
    y = 0.3110 + k * 0.0075
    fin += [(0.0120, y), (0.0300, y + 0.0004), (0.0300, y + 0.0022), (0.0120, y + 0.0026)]
fin += [(0.0120, 0.335), (0, 0.335)]
lathe("fins", DARK, fin, segs=20, loc=B0, sharp=40)
lathe("emitter_housing", BODY, [(0, 0.333), (0.0300, 0.333), (0.0334, 0.337), (0.0344, 0.352), (0.0334, 0.366),
                                 (0.0334, 0.384), (0.0316, 0.397), (0.0292, 0.401), (0, 0.401)], segs=28, loc=B0,
      ch=0.0005, sharp=40)
lathe("emitter_band", ACCENT, [(0.0330, 0.3680), (0.0346, 0.3695), (0.0346, 0.3815), (0.0330, 0.3830)],
      segs=28, loc=B0, closed=True, sharp=50)
lathe("emitter_vents", GLOW, [(0.0338, 0.3545), (0.0344, 0.3545), (0.0344, 0.3615), (0.0338, 0.3615)],
      segs=24, loc=B0, closed=True, sharp=0)
for k in range(12):
    a = 2 * pi * k / 12
    e = Vector((cos(a), 0, sin(a)))
    f = Vector((-sin(a), 0, cos(a)))
    M = Matrix((f, Vector((0, 1, 0)), e)).transposed()
    box(f"vent_bar{k}", DARK, (0.0052, 0.0080, 0.0018), B0 + e * 0.0341 + Vector((0, 0.358, 0)), M, smooth=False)
lathe("muzzle_ring", DARK, [(0.0155, 0.399), (0.0278, 0.399), (0.0288, 0.402), (0.0288, 0.418), (0.0262, 0.4245),
                            (0.0185, 0.4245), (0.0155, 0.421)], segs=28, loc=B0, closed=True, sharp=40)
lathe("muzzle_lens", GLOW, [(0, 0.4080), (0.0158, 0.4080), (0.0158, 0.4110), (0.0070, 0.4150), (0, 0.4160)],
      segs=24, loc=B0, sharp=0)
lathe("muzzle_crystal", GLOW, [(0, 0.4130), (0.0040, 0.4150), (0.0034, 0.4300), (0, 0.4440)], segs=6,
      loc=B0, sharp=30)
for k, ang in enumerate((90, 210, 330)):
    e = Vector((cos(radians(ang)), 0, sin(radians(ang))))
    rp = [(0.0250, 0.392), (0.0318, 0.408), (0.0330, 0.425), (0.0300, 0.444), (0.0238, 0.457), (0.0182, 0.463)]
    path = spline([B0 + e * r + Vector((0, y, 0)) for (r, y) in rp], n=3)
    sc_ = [(lerp(1.0, 0.55, (i / (len(path) - 1)) ** 1.5), lerp(1.0, 0.45, (i / (len(path) - 1)) ** 1.2))
           for i in range(len(path))]
    sweep(f"prong{k}", ACCENT, path, rrect(0.0030, 0.0055, 0.0014, 1), up=e, scales=sc_, sharp=40)
    tip = path[-3]
    lathe(f"prong_node{k}", GLOW, [(0, 0.0), (0.0017, 0.0003), (0.0017, 0.0016), (0, 0.0023)], segs=8,
          loc=tip - e * 0.0020, d=-e, sharp=0)

# ---------------------------------------------------------------- grip
GR = Grip((0, -0.070, 0.004), (0, -0.120, -0.150))
gt = [k * 0.30 / 8 for k in range(8)] + [0.30 + k / 36 for k in range(int(0.58 * 36))] + [0.88 + k * 0.12 / 6 for k in range(7)]
loft("grip_core", DARK, surf_rings(GR, gt, 16), sharp=70)
patch("grip_back", BODY, GR, (0.06, 0.10), 0.925, 224, 316, 0.0004, 0.0030, 11, 6)
pd = GR.A
lathe("pommel", BODY, [(0, -0.002), (0.0150, -0.002), (0.0200, 0.0005), (0.0215, 0.0045), (0.0205, 0.0080),
                       (0.0170, 0.0100), (0, 0.0100)], segs=20, loc=GR.C(0.93), d=pd, ref=GR.F, sharp=40)
lathe("pommel_band", ACCENT, [(0.0205, 0.0010), (0.0219, 0.0020), (0.0219, 0.0045), (0.0205, 0.0055)],
      segs=20, loc=GR.C(0.93), d=pd, ref=GR.F, closed=True, sharp=50)
guard = spline([(0, 0.036, -0.018), (0, 0.031, -0.040), (0, 0.017, -0.057), (0, -0.012, -0.065),
                (0, -0.044, -0.064), (0, -0.076, -0.055)], n=4)
gsc = [(1.0 + 0.25 * math.sin(pi * i / (len(guard) - 1)), 1.0) for i in range(len(guard))]
sweep("trigger_guard", BODY, guard, rrect(0.0054, 0.0034, 0.0017, 1), up=(1, 0, 0), scales=gsc, sharp=40)
trig = spline([(0, -0.026, -0.016), (0, -0.024, -0.034), (0, -0.018, -0.047), (0, -0.011, -0.052)], n=4)
tsc = [(1.0, lerp(1.0, 0.75, i / (len(trig) - 1))) for i in range(len(trig))]
sweep("trigger", ACCENT, trig, rrect(0.0034, 0.0022, 0.0010, 1), up=(1, 0, 0), scales=tsc, sharp=40)

# ================================================================ gloved hand
# Right hand in a space-suit glove holding the grip: middle/ring/little fingers wrapped
# around it, index finger through the guard on the trigger, thumb wrapped over the
# middle finger on the left side, a wrist cuff with an accent band and bearing ring,
# and a short stub of suit sleeve that leaves the view toward the lower right (Blender
# +X, -Y, -Z = three.js view +X, +Z, -Y). Exported as its own node "Hand" with its own
# materials, so the tool's node, materials and geometry stay exactly as they were.
TOOL_PARTS = list(PARTS)
PARTS.clear()

GLOVE = mat("Glove", (0.100, 0.104, 0.112), 0.0, 0.68)
GACC = mat("GloveAccent", (0.90, 0.32, 0.05), 0.0, 0.50)
SLEEVE = mat("Sleeve", (0.70, 0.68, 0.63), 0.0, 0.82)


def G(gx, gf, ga):
    """Grip frame: gx to the right, gf forward (normal to the raked grip), ga down the
    grip axis from its top point."""
    return GR.top + GR.X * gx + GR.F * gf + GR.A * ga


class Seg:
    """Padded capsule from joint a to joint b (a phalanx). th = 0 faces `out` (the back
    of the finger); fu / fv scale the section toward out / sideways."""

    def __init__(self, a, b, r, out, r1=None, fu=1.0, fv=1.0, cap=0.65, pad=0.10):
        self.a, self.b = Vector(a), Vector(b)
        self.L = (self.b - self.a).length
        self.u, self.v, self.d = basis(self.b - self.a, out)
        self.r0, self.r1 = r, (r1 if r1 else r)
        self.fu, self.fv, self.cap, self.pad = fu, fv, cap, pad

    def ends(self):
        return self.cap * self.r0 / self.L, self.cap * self.r1 / self.L

    def rad(self, h):
        e0, e1 = self.ends()
        k = 1.0 - self.pad
        if h < 0:
            x = min(1.0, -h / e0)
            return k * self.r0 * math.sqrt(max(0.0, 1 - x * x))
        if h > 1:
            x = min(1.0, (h - 1) / e1)
            return k * self.r1 * math.sqrt(max(0.0, 1 - x * x))
        return lerp(self.r0, self.r1, h) * (k + self.pad * sin(pi * h) ** 0.6)

    def C(self, h):
        return self.a + self.d * (h * self.L)

    def P(self, h, th):
        r = self.rad(h)
        return self.C(h) + self.u * (r * self.fu * cos(th)) + self.v * (r * self.fv * sin(th))


def tube(name, m, rings, p0=None, p1=None, **kw):
    """Loft of rings, ends closed by a pole vertex (or a flat cap when no pole given)."""
    nv = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = loft_faces(len(rings), nv, p0 is None, p1 is None)
    if p0 is not None:
        verts.append(p0)
        faces += [(len(verts) - 1, (j + 1) % nv, j) for j in range(nv)]
    if p1 is not None:
        verts.append(p1)
        b = (len(rings) - 1) * nv
        faces += [(len(verts) - 1, b + j, b + (j + 1) % nv) for j in range(nv)]
    return make(name, verts, faces, m, **kw)


def seg_mesh(name, m, S, nv=12, body=(0.0, 0.3, 0.5, 0.7, 1.0), **kw):
    e0, e1 = S.ends()
    hs = [-e0 * cos(radians(a)) for a in (35, 65)] + list(body) + [1 + e1 * cos(radians(a)) for a in (65, 35)]
    rings = [[S.P(h, 2 * pi * j / nv) for j in range(nv)] for h in hs]
    kw.setdefault("sharp", 0)
    return tube(name, m, rings, S.C(-e0), S.C(1 + e1), **kw)


def pillow(name, m, S, a0, a1, t0, t1, off, thick, n=16, sq=0.35, roll=None, dome=0.2, sink=0.0015, **kw):
    """Padded plate on surface S: a rounded rectangle over a0..a1 (surface parameter) and
    t0..t1 (degrees around it) with a rolled edge and a slightly domed top; its skirt
    sinks into the surface so no gap shows at grazing angles."""
    ac, tc = (a0 + a1) / 2, (t0 + t1) / 2
    ha, ht = (a1 - a0) / 2, (t1 - t0) / 2
    e = 1e-4
    la = (S.P(ac + e, radians(tc)) - S.P(ac - e, radians(tc))).length / (2 * e)
    lt = (S.P(ac, radians(tc + 0.05)) - S.P(ac, radians(tc - 0.05))).length / 0.1
    roll = roll or thick * 0.9
    outline = [(math.copysign(abs(cos(g)) ** sq, cos(g)), math.copysign(abs(sin(g)) ** sq, sin(g)))
               for g in (2 * pi * j / n for j in range(n))]
    rings = []
    for ins, hf in ((0.0, -sink / thick), (0.0, 0.45), (0.3 * roll, 0.86), (roll, 1.0), (None, 1 + dome * 0.7)):
        if ins is None:  # halfway between the rolled edge and the centre
            ia, it = (ha + roll / la) * 0.5, (ht + roll / lt) * 0.5
        else:
            ia, it = ins / la, ins / lt
        ring = []
        for ca, st in outline:
            a, th = ac + ca * (ha - ia), radians(tc + st * (ht - it))
            ring.append(S.P(a, th) + surf_normal(S, a, th) * (off + thick * hf))
        rings.append(ring)
    top = S.P(ac, radians(tc)) + surf_normal(S, ac, radians(tc)) * (off + thick * (1 + dome))
    kw.setdefault("sharp", 0)
    return tube(name, m, rings, None, top, **kw)


class Shell:
    """Superellipse sections along an arbitrary axis with separate half sizes on each
    side (u+, u-, v+, v-), a centre offset (cu, cv) and a rounded far end."""

    def __init__(self, origin, d, ref, keys, rr1=0.0):
        self.o = Vector(origin)
        self.u, self.v, self.d = basis(d, ref)
        cols = list(zip(*keys))
        self.s0, self.s1 = cols[0][0], cols[0][-1]
        self.c = [Curve(cols[0], cols[i]) for i in range(1, 8)]
        self.rr1 = rr1

    def sec(self, s):
        up, un, vp, vn, cu, cv, ex = (c(s) for c in self.c)
        k = 0.0
        if self.rr1 and s > self.s1 - self.rr1:
            dd = clamp01((s - (self.s1 - self.rr1)) / self.rr1)
            k = self.rr1 * (1 - math.sqrt(max(0.0, 1 - dd * dd)))
        return up - k, un - k, vp - k, vn - k, cu, cv, ex

    def C(self, s):
        sec = self.sec(s)
        return self.o + self.d * s + self.u * sec[4] + self.v * sec[5]

    def P(self, s, th):
        up, un, vp, vn, cu, cv, ex = self.sec(s)
        c, sn = cos(th), sin(th)
        p = 2.0 / ex
        x = (up if c > 0 else un) * math.copysign(abs(c) ** p, c)
        y = (vp if sn > 0 else vn) * math.copysign(abs(sn) ** p, sn)
        return self.o + self.d * s + self.u * (cu + x) + self.v * (cv + y)


# ---------------------------------------------------------------- palm / back of the hand
HW = G(0.012, -0.090, 0.088)  # wrist centre, tucked under the receiver's rear overhang
HK = G(0.031, 0.004, 0.078)  # middle of the knuckle line, right-front of the grip
PALM_L = (HK - HW).length
PALM = Shell(HW, HK - HW, GR.A, [
    # s,      u+ (little), u- (index), v+ (back), v- (palm), cu,    cv,    exponent
    (-0.018, 0.0230, 0.0230, 0.0165, 0.0165, 0.000, 0.000, 2.3),
    (0.000, 0.0290, 0.0280, 0.0190, 0.0200, 0.000, 0.000, 2.3),
    (0.025, 0.0350, 0.0320, 0.0208, 0.0220, 0.001, 0.000, 2.4),
    (0.050, 0.0410, 0.0385, 0.0205, 0.0215, 0.001, 0.000, 2.5),
    (0.075, 0.0455, 0.0445, 0.0188, 0.0180, 0.000, 0.000, 2.6),
    (PALM_L, 0.0485, 0.0495, 0.0170, 0.0155, 0.000, 0.000, 2.6),
    (PALM_L + 0.008, 0.0485, 0.0495, 0.0170, 0.0155, 0.000, 0.000, 2.6),
], rr1=0.010)
ps = [lerp(PALM.s0, PALM.s1 - PALM.rr1, k / 11) for k in range(12)]
ps += [PALM.s1 - PALM.rr1 + PALM.rr1 * sin(radians(a)) for a in (35, 65, 90)]
loft("glove_palm", GLOVE, surf_rings(PALM, ps, 24), sharp=0)

# padded knuckle bar and back-of-hand plate (knuckle guards on the bar are added below)
KB_T = 0.0034
pillow("glove_knuckle_bar", GLOVE, PALM, 0.066, PALM_L - 0.001, 26, 154, 0.0003, KB_T, n=24, sq=0.3, dome=0.15)
pillow("glove_back_plate", GLOVE, PALM, 0.012, 0.062, 50, 130, 0.0003, 0.0026, n=16, sq=0.4)
# padded heel of the palm and the little-finger edge
pillow("glove_palm_pad", GLOVE, PALM, 0.004, 0.052, 214, 316, 0.0003, 0.0030, n=16, sq=0.4)
pillow("glove_edge_pad", GLOVE, PALM, 0.010, 0.066, -34, 28, 0.0003, 0.0026, n=14, sq=0.4)
# seams along both edges of the hand
for nm, t in (("glove_seam_top", 174), ("glove_seam_low", 6)):
    pts = [on_surf(PALM, s, t, 0.0004)[0] for s in [lerp(0.0, PALM_L - 0.004, k / 9) for k in range(10)]]
    sweep(nm, GLOVE, pts, circle(0.0008, 4), up=PALM.v, sharp=0)

# ---------------------------------------------------------------- fingers
FINGERS = []


def grip_joint(ga, th, lift):
    """Joint centre outside the grip surface at height ga, angle th (deg, 0 = right side,
    90 = front, 180 = left)."""
    t = ga / GR.L
    return GR.P(t, radians(th)) + surf_normal(GR, t, radians(th)) * lift


def wrap(mcp, ga, lens, radii, dga=0.0):
    """Walk around the grip from the knuckle: each joint is placed where the phalanx of
    the given length meets the contour, so the fingers hug the handle."""
    js = [Vector(mcp)]
    th = 20.0
    for i, (ln, r) in enumerate(zip(lens, radii)):
        g = ga + dga * (i + 1)
        while th < 260:
            p = grip_joint(g, th, r * 1.05)
            if (p - js[-1]).length >= ln:
                break
            th += 0.5
        js.append(p)
    return js


def build_finger(name, js, radii, axis_pts=None, pads=(0, 1), tip=True):
    segs = []
    for i in range(3):
        a, b = js[i], js[i + 1]
        mid = (a + b) * 0.5
        c = axis_pts[i] if axis_pts else GR.C(clamp01((mid - GR.top).dot(GR.A) / GR.L))
        out = mid - c
        out -= GR.A * out.dot(GR.A)
        r0, r1 = radii[i], radii[i + 1] if i < 2 else radii[i] * 0.92
        S = Seg(a, b, r0, out, r1=r1, fu=0.95, fv=1.08)
        seg_mesh(f"{name}_{i}", GLOVE, S, nv=12)
        segs.append(S)
    for i in pads:
        pillow(f"{name}_pad{i}", GLOVE, segs[i], 0.12, 0.88, -50, 50, 0.0002, 0.0024, n=12, sq=0.4)
    if tip:
        S = segs[2]
        pillow(f"{name}_tip", GLOVE, S, 0.28, 1.0 + 0.6 * S.ends()[1], -64, 64, 0.0002, 0.0024, n=12, sq=0.45)
    FINGERS.append(segs)
    return segs


for nm, ga, gf, lens, radii in (
        ("glove_middle", 0.0700, 0.006, (0.046, 0.029, 0.023), (0.0115, 0.0108, 0.0100)),
        ("glove_ring", 0.0942, 0.005, (0.043, 0.027, 0.022), (0.0113, 0.0106, 0.0098)),
        ("glove_little", 0.1185, 0.001, (0.036, 0.022, 0.019), (0.0100, 0.0094, 0.0088))):
    js = wrap(G(0.031, gf, ga), ga, lens, radii, dga=0.0015)
    build_finger(nm, js, radii)

# index finger: along the right side of the guard opening, curled onto the trigger
IDX = [G(0.028, 0.002, 0.036), G(0.021, 0.045, 0.035), G(0.007, 0.065, 0.0345), G(-0.002, 0.075, 0.031)]
build_finger("glove_index", IDX, (0.0108, 0.0100, 0.0093),
             axis_pts=[G(0.0, 0.02, 0.04), G(-0.005, 0.04, 0.04), G(-0.005, 0.04, 0.04)])


def palm_th(s, uoff):
    """Angle (deg) on the back of the hand whose point lies at offset uoff across the hand."""
    return min(range(0, 181, 2), key=lambda a: abs((PALM.P(s, radians(a)) - PALM.C(s)).dot(PALM.u) - uoff))


# knuckle guards on the plate, one over each knuckle
for k, f in enumerate(FINGERS):
    mcp = f[0].a
    s = min((mcp - PALM.o).dot(PALM.d), PALM_L - 0.004) - 0.006
    p, n = on_surf(PALM, s, palm_th(s, (mcp - PALM.C(s)).dot(PALM.u)), 0.0003 + KB_T * 1.05)
    S = Seg(p - PALM.d * 0.0065, p + PALM.d * 0.0050, f[0].r0 * 0.52, n, fu=0.50,
            fv=1.15, cap=0.8, pad=0.15)
    seg_mesh(f"glove_knuckle{k}", GLOVE, S, nv=10, body=(0.0, 0.5, 1.0))

# ---------------------------------------------------------------- thumb
TH_OUT = (-GR.X - GR.A * 0.55).normalized()
THUMB = [G(0.010, -0.074, 0.075), G(-0.017, -0.038, 0.0505), G(-0.030, -0.006, 0.0405), G(-0.029, 0.020, 0.0450)]
tr = (0.0158, 0.0126, 0.0116)
tsegs = []
for i in range(3):
    S = Seg(THUMB[i], THUMB[i + 1], tr[i], TH_OUT, r1=tr[i + 1] if i < 2 else tr[2] * 0.9, fu=0.92, fv=1.08)
    seg_mesh(f"glove_thumb_{i}", GLOVE, S, nv=16)
    tsegs.append(S)
pillow("glove_thumb_pad0", GLOVE, tsegs[0], 0.22, 0.86, -55, 45, 0.0002, 0.0028, n=16, sq=0.4)
pillow("glove_thumb_pad1", GLOVE, tsegs[1], 0.12, 0.88, -50, 50, 0.0002, 0.0026, n=16, sq=0.4)
pillow("glove_thumb_tip", GLOVE, tsegs[2], 0.28, 1.0 + 0.6 * tsegs[2].ends()[1], -64, 64, 0.0002, 0.0026,
       n=16, sq=0.45)

# ---------------------------------------------------------------- cuff, ring and sleeve
FA = Vector((0.16, -0.95, -0.22)).normalized()  # forearm, toward the player's elbow
FU = (PALM.u - FA * PALM.u.dot(FA)).normalized()


def ell(fv):
    return lambda r, h, phi: r * fv / math.sqrt((fv * cos(phi)) ** 2 + sin(phi) ** 2)


lathe("glove_cuff", GLOVE, [(0, -0.008), (0.0200, -0.0080), (0.0270, -0.0150), (0.0318, -0.0170),
                            (0.0348, -0.0150), (0.0356, -0.0100), (0.0352, 0.0000), (0.0366, 0.0100),
                            (0.0388, 0.0200), (0.0405, 0.0280), (0.0408, 0.0320), (0, 0.0320)],
      segs=24, loc=HW, d=FA, ref=FU, rfun=ell(0.86), sharp=0)
lathe("glove_cuff_band", GACC, [(0.0380, 0.0215), (0.0412, 0.0225), (0.0420, 0.0320), (0.0395, 0.0330)],
      segs=24, loc=HW, d=FA, ref=FU, closed=True, rfun=ell(0.86), sharp=50)
lathe("glove_wrist_ring", GLOVE, [(0.0360, 0.0320), (0.0428, 0.0326), (0.0440, 0.0350), (0.0440, 0.0392),
                                  (0.0422, 0.0402), (0.0422, 0.0430), (0.0444, 0.0440), (0.0444, 0.0480),
                                  (0.0428, 0.0494), (0.0360, 0.0494)],
      segs=28, loc=HW, d=FA, ref=FU, closed=True, rfun=ell(0.88), sharp=40)
for k, a in enumerate((70, 160, 250, 340)):
    phi = radians(a)
    rr = ell(0.88)(0.0440, 0, phi)
    FV = FU.cross(FA)
    n = (FU * cos(phi) + FV * sin(phi) / 0.88 ** 2).normalized()
    p = HW + FA * 0.0371 + FU * (rr * cos(phi)) + FV * (rr * sin(phi))
    lathe(f"glove_ring_lug{k}", GACC, [(0, 0.0022), (0.0020, 0.0020), (0.0026, 0.0008), (0.0026, -0.0004),
                                       (0, -0.0004)], segs=8, loc=p, d=n, sharp=40)
sl = [(0, 0.200), (0.0520, 0.200), (0.0520, 0.180)]
for k in range(10):
    h = lerp(0.170, 0.048, k / 9)
    sl.append((lerp(0.0420, 0.0510, (h - 0.048) / 0.122) + 0.0016 * (0.5 + 0.5 * cos(2 * pi * (h - 0.048) / 0.040)),
               h))
sl += [(0.0400, 0.0440), (0, 0.0440)]
sl.reverse()
lathe("sleeve", SLEEVE, sl, segs=20, loc=HW, d=FA, ref=FU, sharp=0,
      rfun=lambda r, h, phi: ell(0.90)(r, h, phi) * (1 + 0.035 * smoothstep(0.06, 0.12, h) * cos(3 * phi + 30 * h)))

# ================================================================ finalize
HAND_PARTS = list(PARTS)
deps = bpy.context.evaluated_depsgraph_get()


def report(label, parts):
    tot = 0
    stats = []
    for ob in parts:
        e = ob.evaluated_get(deps)
        me = e.to_mesh()
        t = sum(len(p.vertices) - 2 for p in me.polygons)
        e.to_mesh_clear()
        tot += t
        stats.append((t, ob.name))
    stats.sort(reverse=True)
    print(label, "TOP PARTS", stats[:45])
    groups = {}
    for t, nm in stats:
        g = nm.split("_")[0].rstrip("0123456789LR")
        groups[g] = groups.get(g, 0) + t
    print(label, "GROUPS", sorted(((v, k) for k, v in groups.items()), reverse=True))
    print(label, "TRIS", tot, "PARTS", len(parts))


def join(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    mn = Vector([min(v.co[i] for v in ob.data.vertices) for i in range(3)])
    mx = Vector([max(v.co[i] for v in ob.data.vertices) for i in range(3)])
    print(name, "BOUNDS", tuple(round(c, 4) for c in mn), tuple(round(c, 4) for c in mx),
          "SIZE", tuple(round(c, 4) for c in (mx - mn)))
    print(name, "FINAL TRIS", sum(len(p.vertices) - 2 for p in ob.data.polygons))
    return ob


report("TOOL", TOOL_PARTS)
report("HAND", HAND_PARTS)
tool = join(TOOL_PARTS, "Multitool")
hand = join(HAND_PARTS, "Hand")

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True)
print("EXPORTED", OUT)

# ================================================================ previews
if PREVIEW:
    base, ext = os.path.splitext(PREVIEW)
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    try:
        scene.eevee.taa_render_samples = 48
        scene.eevee.use_raytracing = True
    except Exception:
        pass
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass

    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mr = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.40, (0.05, 0.045, 0.04, 1)
    els[1].position, els[1].color = 0.75, (0.20, 0.30, 0.48, 1)
    e2 = els.new(0.5)
    e2.color = (0.55, 0.50, 0.45, 1)
    bg.inputs["Strength"].default_value = 0.9

    def sun(name, rot, energy, color=(1, 1, 1), angle=3):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        ld.color = color
        ld.angle = radians(angle)
        try:  # the tool is tiny: default shadow-map texels are too coarse and alias
            ld.shadow_maximum_resolution = 0.00005
            ld.use_shadow_jitter = True
        except Exception:
            pass
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = [radians(a) for a in rot]
        COL.objects.link(lo)
        return lo

    key = sun("key", (50, 0, -35), 3.2, (1.0, 0.96, 0.9))
    rim = sun("rim", (-60, 0, 150), 2.0, (0.7, 0.85, 1.0))

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    COL.objects.link(cam)
    scene.camera = cam
    cam_data.clip_start = 0.005
    cam_data.clip_end = 2000

    def shoot(path, loc, target, lens=50, ortho=None, res=(1100, 760), rot=None):
        cam.location = loc
        cam.rotation_euler = rot or (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = lens
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("RENDERED", path)

    tgt = Vector((0, 0.15, -0.02))
    shoot(base + "_34" + ext, tgt + Vector((-0.78, 0.52, 0.42)) * 1.05, tgt)
    shoot(base + "_rear" + ext, tgt + Vector((-0.55, -0.85, 0.45)) * 1.05, tgt)
    shoot(base + "_side" + ext, (-1.0, 0.15, -0.02), (0, 0.15, -0.02), ortho=0.72)
    shoot(base + "_top" + ext, (0, 0.15, 1.0), (0, 0.15, 0), ortho=0.72, rot=(0, 0, radians(-90)))
    # gloved hand close-ups: 3/4 from the front-left (thumb side) and from the right (back of the hand)
    hc = G(0.0, -0.02, 0.07)
    shoot(base + "_hand" + ext, hc + Vector((-0.30, 0.22, 0.13)), hc)
    shoot(base + "_hand_r" + ext, hc + Vector((0.30, -0.06, 0.16)), hc)
    shoot(base + "_hand_low" + ext, hc + Vector((-0.16, 0.26, -0.20)), hc)

    # in-game first-person framing: three.js view space -> Blender (x, -z, y)
    C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    T3 = (Matrix.Translation((0.16, -0.15, -0.42)) @ Matrix.Rotation(0.03, 4, "X")
          @ Matrix.Rotation(0.06, 4, "Y") @ Matrix.Scale(0.72, 4))
    tool.matrix_world = hand.matrix_world = C4 @ T3 @ C4.inverted()
    cam_data.sensor_fit = "VERTICAL"
    cam_data.type = "PERSP"
    cam_data.angle_y = radians(60)  # Engine.viewCamera fov
    cam.location = (0, 0, 0)
    cam.rotation_euler = (radians(90), 0, 0)
    key.rotation_euler = [radians(a) for a in (55, 0, -30)]
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("RENDERED", PREVIEW)
    # same framing, cropped to the tool at 2x resolution to judge detail
    scene.render.resolution_x, scene.render.resolution_y = 2560, 1440
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_max_x = 0.54, 0.86
    scene.render.border_min_y, scene.render.border_max_y = 0.0, 0.40
    scene.render.filepath = base + "_zoom" + ext
    bpy.ops.render.render(write_still=True)
    print("RENDERED", base + "_zoom" + ext)
    scene.render.use_border = False
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720

    # beam proxy: the game draws the beam with the 70 deg world camera before the
    # view model; scale x/y by tan(30)/tan(35) to land on the same pixels here and
    # push it far away so the tool occludes it like the depth-cleared view pass.
    k = math.tan(radians(30)) / math.tan(radians(35))
    def v2b(v, push=20.0):
        return Vector((v[0] * k * push, -v[2] * push, v[1] * k * push))
    st, en = Vector((0.16, -0.14, -0.66)), Vector((0.0, 0.0, -30.0))
    bpts = [v2b(st.lerp(en, t)) for t in (0.0, 0.02, 0.1, 0.4, 1.0)]
    beam_mat = mat("beam", (1, 0.5, 0.2), 0.0, 0.5, emission=(1.0, 0.5, 0.2), strength=25)
    sweep("beam", beam_mat, bpts, circle(0.025 * k * 20, 12), up=(0, 0, 1), sharp=0)
    pl = bpy.data.lights.new("vm", "POINT")
    pl.energy = 3.0
    pl.color = (1.0, 0.6, 0.31)
    pl.shadow_soft_size = 0.01
    plo = bpy.data.objects.new("vm", pl)
    plo.location = (0.17, 0.75, -0.12)
    COL.objects.link(plo)
    scene.render.filepath = base + "_fire" + ext
    bpy.ops.render.render(write_still=True)
    print("RENDERED", base + "_fire" + ext)
