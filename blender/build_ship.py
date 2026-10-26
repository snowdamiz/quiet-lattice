# Builds the player starship procedurally and exports public/models/ship.glb.
# Run: Blender -b -P blender/build_ship.py -- <out.glb> [preview.png]
#   preview.png -> renders <preview>_<view>.png (3/4 front/rear, side, top, bottom, front, chase cam, close-up,
#   gear retracted, cockpit from the pilot eye, cockpit looking down, behind the seat).
#   SHIP_VIEWS=front34,cockpit limits the views; SHIP_DEBUG=1 paints back faces red.
#
# Blender axes: nose along +Y, up +Z (the glTF exporter maps +Y to three.js -Z).
# Conventions the game relies on:
#   - pilot eye at (0, 1.15, 1.52); canopy glass uses material "Glass", frames are named "CanopyFrame*"
#   - every main exhaust core is its own mesh with material "EngineGlow" (origin at the core, facing -Y)
#   - landing legs GearFront / GearLeft / GearRight: empties pivoting at the top of the strut,
#     pads touching z = -1.95 when extended
#   - root empty "Ship"; materials Hull, Accent, Trim, Dark, Glass, EngineGlow, NavRed, NavGreen, NavWhite
#   - first-person interior under the empty "CockpitInterior" (shown by the game only in cockpit view):
#     CockpitInteriorMesh, CockpitStick / CockpitThrottle (origins at their pivots) and the empties
#     ScreenLeft / ScreenCenter / ScreenRight (local X = width, Z = up, -Y = towards the eye)
#
# Modelling approach: every body part is a parametric surface (fuselage lofts, surfaces of revolution,
# wing sections). A dark "core" shell is built from each surface and separate armour plates are cut
# from parameter rectangles of the same surface, lifted off it and given thickness, so the gaps
# between plates read as real panel seams. Greebles are lathes, bevelled boxes and curve pipes.
# Everything is joined per material group at the end to keep draw calls low.
import bisect
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "ship.glb"
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection
EYE = Vector((0.0, 1.15, 1.52))
GROUND = -1.95


# =====================================================================================  materials
def mat(name, color, metallic=0.0, rough=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*color, 1.0)
    m.use_backface_culling = True  # all parts are closed / outward facing: export single-sided
    return m


M_HULL = mat("Hull", (0.80, 0.78, 0.74), 0.3, 0.4)
M_ACCENT = mat("Accent", (0.92, 0.30, 0.05), 0.25, 0.42)
M_TRIM = mat("Trim", (0.58, 0.60, 0.63), 1.0, 0.28)
M_DARK = mat("Dark", (0.05, 0.055, 0.065), 0.8, 0.42)
M_GLASS = mat("Glass", (0.015, 0.03, 0.045), 1.0, 0.05, emission=(0.04, 0.2, 0.3), strength=0.5)
M_ENGINE = mat("EngineGlow", (0.2, 0.6, 1.0), 0.0, 0.2, emission=(0.35, 0.75, 1.0), strength=12.0)
M_RED = mat("NavRed", (1, 0.1, 0.05), 0, 0.3, emission=(1, 0.08, 0.04), strength=20)
M_GREEN = mat("NavGreen", (0.1, 1, 0.2), 0, 0.3, emission=(0.1, 1.0, 0.25), strength=20)
M_WHITE = mat("NavWhite", (1, 1, 1), 0, 0.3, emission=(1, 0.95, 0.9), strength=25)
# extra emissive details (not used by the game code; plain glowing materials)
M_VENT = mat("VentGlow", (1.0, 0.42, 0.12), 0.0, 0.4, emission=(1.0, 0.36, 0.06), strength=8.0)
M_SENSOR = mat("SensorGlow", (0.3, 0.85, 1.0), 0.0, 0.2, emission=(0.25, 0.85, 1.0), strength=6.0)


# =====================================================================================  basics
def link(ob):
    COL.objects.link(ob)
    return ob


def new_mesh_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for m in mats:
        me.materials.append(m)
    return ob


def shade(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))


def mod_mirror(ob, merge=True):
    m = ob.modifiers.new("mirror", "MIRROR")
    m.use_axis = (True, False, False)
    m.use_mirror_merge = merge
    m.merge_threshold = 0.002
    return m


def mod_bevel(ob, width, segs=2, angle=32, harden=True):
    b = ob.modifiers.new("bevel", "BEVEL")
    b.width = width
    b.segments = segs
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(angle)
    b.harden_normals = harden
    b.use_clamp_overlap = True
    return b


def interp(pts, mode="smooth"):
    """Monotone cubic (or linear) interpolation through (x, y) knots."""
    pts = sorted(pts)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = None
    if mode != "linear":
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                h0, h1 = xs[i] - xs[i - 1], xs[i + 1] - xs[i]
                w1, w2 = 2 * h1 + h0, h1 + 2 * h0
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        k = min(bisect.bisect_right(xs, x) - 1, n - 2)
        h = xs[k + 1] - xs[k]
        t = (x - xs[k]) / h
        if m is None:
            return ys[k] + (ys[k + 1] - ys[k]) * t
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] +
                (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1])

    return f


# =====================================================================================  surfaces
class Surf:
    """Parametric surface S(u, a). sec(u) returns a polyline of 3D points (cross-section at u);
    a in [0, 1] runs along it by arc length (or by explicit knots)."""

    def __init__(self, sec, center, closed=False, half=False, uscale=1.0, M=None, knots=None, breaks=(),
                 astep=0.22):
        self.sec = sec
        self.breaks = list(breaks)  # a values of section corners (grid columns always land on them)
        self.astep = astep
        self.centerf = center
        self.closed = closed
        self.half = half  # right half of a mirrored section (ends on x = 0)
        self.uscale = uscale
        self.M = M if M is not None else Matrix.Identity(4)
        self.knots = knots
        self.cache = {}

    def _get(self, u):
        key = round(u, 6)
        c = self.cache.get(key)
        if c is None:
            pts = [Vector(p) for p in self.sec(u)]
            if self.closed:
                pts.append(pts[0].copy())
            lens = [0.0]
            for i in range(1, len(pts)):
                lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
            total = lens[-1]
            cum = list(self.knots) if self.knots else [v / total for v in lens]
            c = (pts, cum, total)
            self.cache[key] = c
        return c

    def p(self, u, a):
        pts, cum, _ = self._get(u)
        if self.closed:
            a = a % 1.0
        a = min(max(a, 0.0), 1.0)
        i = min(max(bisect.bisect_right(cum, a) - 1, 0), len(pts) - 2)
        span = cum[i + 1] - cum[i]
        t = (a - cum[i]) / span if span > 1e-12 else 0.0
        return self.M @ pts[i].lerp(pts[i + 1], t)

    def perim(self, u):
        return self._get(u)[2]

    def center(self, u):
        return self.M @ Vector(self.centerf(u))


def se_quarter(w, z0, z1, e, n=24):
    """Quarter superellipse from (w, z0) to (0, z1)."""
    out = []
    for k in range(n + 1):
        th = (math.pi / 2) * k / n
        c, s = math.cos(th), math.sin(th)
        x = w * (c ** (2.0 / e)) if k < n else 0.0
        z = z0 + (z1 - z0) * (s ** (2.0 / e))
        out.append((x, z))
    return out


class Fuse:
    """Mirrored fuselage loft: stations (y, half-width, z bottom, z widest, z top, top exp, bottom exp)."""

    def __init__(self, stations, mode="smooth"):
        keys = ("w", "zb", "zm", "zt", "et", "eb")
        self.f = {k: interp([(s[0], s[i + 1]) for s in stations], mode) for i, k in enumerate(keys)}
        ys = sorted(s[0] for s in stations)
        self.y0, self.y1 = ys[0], ys[-1]

    def par(self, y):
        return {k: f(y) for k, f in self.f.items()}

    def sec(self, y):
        p = self.par(y)
        bot = se_quarter(p["w"], p["zm"], p["zb"], p["eb"])[::-1]
        top = se_quarter(p["w"], p["zm"], p["zt"], p["et"])
        return [(x, y, z) for (x, z) in bot + top[1:]]

    def surf(self):
        return Surf(self.sec, lambda y: (0.0, y, self.par(y)["zm"]), half=True)


class Chine:
    """Mirrored faceted fuselage. Stations (y, w, zb, zl, zu, zt, bw, tw): flat bottom out to x=bw,
    lower chine up to the vertical side x=w (zl..zu), upper shoulder in to the flat top ending at x=tw.
    The six corners sit at fixed a values (self.knots) so creases stay straight along the loft."""

    keys = ("w", "zb", "zl", "zu", "zt", "bw", "tw")

    def __init__(self, stations, mode="smooth"):
        self.f = {k: interp([(s[0], s[i + 1]) for s in stations], mode) for i, k in enumerate(self.keys)}
        ys = sorted(s[0] for s in stations)
        self.y0, self.y1 = ys[0], ys[-1]
        ref = [Vector(p) for p in self.sec((self.y0 + self.y1) / 2)]
        lens = [0.0]
        for i in range(1, len(ref)):
            lens.append(lens[-1] + (ref[i] - ref[i - 1]).length)
        self.knots = [v / lens[-1] for v in lens]

    def par(self, y):
        return {k: f(y) for k, f in self.f.items()}

    def sec(self, y):
        p = self.par(y)
        return [(0.0, y, p["zb"]), (p["bw"], y, p["zb"]), (p["w"], y, p["zl"]), (p["w"], y, p["zu"]),
                (p["tw"], y, p["zt"]), (0.0, y, p["zt"])]

    def fa(self, i, t=0.0):
        """a value t of the way along facet i (0 bottom, 1 lower chine, 2 side, 3 shoulder, 4 top)."""
        if t == 0.0:
            return self.knots[i]
        return self.knots[i] + t * (self.knots[i + 1] - self.knots[i])

    def surf(self):
        return Surf(self.sec, lambda y: (0.0, y, 0.5 * (self.par(y)["zl"] + self.par(y)["zu"])), half=True,
                    knots=self.knots, breaks=self.knots[1:-1], astep=99.0)


class Canopy:
    """Mirrored bubble: stations (y, half-width at sill, sill z, top z, exponent); a: sill -> top centre."""

    def __init__(self, stations):
        keys = ("w", "s", "t", "e")
        self.f = {k: interp([(s[0], s[i + 1]) for s in stations]) for i, k in enumerate(keys)}

    def par(self, y):
        return {k: f(y) for k, f in self.f.items()}

    def sec(self, y):
        p = self.par(y)
        return [(x, y, z) for (x, z) in se_quarter(p["w"], p["s"], p["t"], p["e"], n=32)]

    def surf(self):
        return Surf(self.sec, lambda y: (0.0, y, self.par(y)["s"]), half=True)


class Rev:
    """Surface of revolution around an axis parallel to Y through (cx, cz): stations (y, r, exponent).
    a = 0 at the top, increasing towards +X (outboard on the right-hand side)."""

    def __init__(self, stations, cx, cz, n=64, mode="smooth"):
        self.fr = interp([(s[0], s[1]) for s in stations], mode)
        self.fe = interp([(s[0], s[2] if len(s) > 2 else 2.0) for s in stations], mode)
        self.cx, self.cz, self.n = cx, cz, n

    def sec(self, y):
        r, e = self.fr(y), self.fe(y)
        out = []
        for k in range(self.n):
            ph = 2 * math.pi * k / self.n
            s, c = math.sin(ph), math.cos(ph)
            out.append((self.cx + r * math.copysign(abs(s) ** (2 / e), s), y,
                        self.cz + r * math.copysign(abs(c) ** (2 / e), c)))
        return out

    def surf(self):
        return Surf(self.sec, lambda y: (self.cx, y, self.cz), closed=True)


# hexagonal hard-surface aerofoil: (chord fraction from LE, half-thickness fraction); a = 0 at the TE top
WING_CORNERS = [(1.0, 0.32), (0.84, 1.0), (0.16, 1.0), (0.0, 0.28), (0.0, -0.28), (0.16, -1.0),
                (0.84, -1.0), (1.0, -0.32)]


class Wing:
    """Wing/fin: stations (u, x, y_le, chord, z, thickness) in a local frame (span along x, chord along -y),
    mapped to the world by M. a runs around the section corners with fixed knots."""

    def __init__(self, stations, M=None, corners=WING_CORNERS, mode="linear"):
        keys = ("x", "yle", "c", "z", "t")
        self.f = {k: interp([(s[0], s[i + 1]) for s in stations], mode) for i, k in enumerate(keys)}
        self.M = M if M is not None else Matrix.Identity(4)
        self.corners = corners
        mid = self.sec(0.5)
        pts = [Vector(p) for p in mid] + [Vector(mid[0])]
        lens = [0.0]
        for i in range(1, len(pts)):
            lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
        self.knots = [v / lens[-1] for v in lens]
        x0, x1 = self.f["x"](0.0), self.f["x"](1.0)
        self.span = abs(x1 - x0)

    def sec(self, u):
        x, yle, c, z, t = (self.f[k](u) for k in ("x", "yle", "c", "z", "t"))
        return [(x, yle - s * c, z + zf * t * 0.5) for (s, zf) in self.corners]

    def K(self, i):
        return self.knots[i]

    def surf(self):
        return Surf(self.sec, lambda u: (self.f["x"](u), self.f["yle"](u) - 0.5 * self.f["c"](u), self.f["z"](u)),
                    closed=True, uscale=self.span, M=self.M, knots=self.knots, breaks=self.knots[1:-1],
                    astep=99.0)


# =====================================================================================  builders
def columns(surf, a0, a1, P, wrap=False, astep=None):
    astep = astep or surf.astep
    brk = [b for b in surf.breaks if a0 + 1e-4 < b < a1 - 1e-4]
    pts = [a0] + brk + [a1]
    cols = [a0]
    for i in range(len(pts) - 1):
        n = max(1, math.ceil((pts[i + 1] - pts[i]) * P / astep - 1e-6))
        cols += [pts[i] + (pts[i + 1] - pts[i]) * k / n for k in range(1, n + 1)]
    return cols[:-1] if wrap else cols


def grid(bm, surf, u0, u1, a0, a1, nu, astep=None, gap=0.0, edges=(1, 1, 1, 1), wrap=False):
    """a0 / a1 may be callables of u (slanted plate edges); then columns are uniform fractions."""
    g = gap * 0.5
    du = g / surf.uscale
    uu0, uu1 = u0 + du * edges[0], u1 - du * edges[1]
    um = (u0 + u1) / 2
    fa0 = a0 if callable(a0) else (lambda u, v=a0: v)
    fa1 = a1 if callable(a1) else (lambda u, v=a1: v)
    slanted = callable(a0) or callable(a1)
    Pm = surf.perim(um)
    if slanted:
        n = max(1, math.ceil((fa1(um) - fa0(um)) * Pm / (astep or surf.astep) - 1e-6))
        fracs = [k / n for k in range(n + 1)]
        cols = fracs
    else:
        cols = columns(surf, a0, a1, Pm, wrap, astep)
    rows = []
    for i in range(nu + 1):
        u = uu0 + (uu1 - uu0) * i / nu
        P = surf.perim(u)
        lo, hi = fa0(u), fa1(u)
        if slanted:
            lo += g / P * edges[2]
            hi -= g / P * edges[3]
            acs = [lo + (hi - lo) * fr for fr in fracs]
        else:
            acs = list(cols)
            if not wrap:
                acs[0] = lo + g / P * edges[2]
                acs[-1] = hi - g / P * edges[3]
                for k in range(1, len(acs) - 1):
                    acs[k] = min(max(acs[k], acs[0] + 1e-4), acs[-1] - 1e-4)
        rows.append([bm.verts.new(surf.p(u, a)) for a in acs])
    na = len(cols) if wrap else len(cols) - 1
    faces = []
    for i in range(nu):
        fr = []
        for j in range(na):
            j2 = (j + 1) % na if wrap else j + 1
            fr.append(bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2])))
        faces.append(fr)
    bm.normal_update()
    score = 0.0
    for i, fr in enumerate(faces):
        c = surf.center(uu0 + (uu1 - uu0) * (i + 0.5) / nu)
        for f in fr:
            score += f.normal.dot(f.calc_center_median() - c) * f.calc_area()
    if score < 0:
        for fr in faces:
            for f in fr:
                f.normal_flip()
        bm.normal_update()
    return rows, faces


def plate(name, surf, u0, u1, a0, a1, m, thick=0.05, gap=0.045, lift=0.0, step=0.32, nu=None, astep=None,
          mirror=None, bevel=0.016, segs=1, edges=None, wrap=False, angle=32, closed=False):
    """Armour plate cut from surf over [u0,u1] x [a0,a1], lifted by lift+thick, with a skirt down to the core.
    closed=True gives it a back face too (for plates that overhang the core and can be seen from below)."""
    mir = surf.half if mirror is None else mirror
    if edges is None:
        edges = [1, 1, 1, 1]
        if surf.half:
            if not callable(a0) and a0 <= 1e-6:
                edges[2] = 0
            if not callable(a1) and a1 >= 1 - 1e-6:
                edges[3] = 0
    bm = bmesh.new()
    nu = nu or max(1, math.ceil((u1 - u0) * surf.uscale / step))
    grid(bm, surf, u0, u1, a0, a1, nu, astep=astep, gap=gap, edges=edges, wrap=wrap)
    off = lift + thick
    for v in bm.verts:
        n = v.normal.copy()
        if surf.half and abs(v.co.x) < 1e-5:
            n.x = 0.0
            n.normalize()
        v.co += n * off
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, angle)
    if mir:
        mod_mirror(ob)
    s = ob.modifiers.new("solid", "SOLIDIFY")
    s.thickness = thick if closed else off + 0.02
    s.offset = -1
    s.use_rim = True
    s.use_rim_only = not closed
    s.use_even_offset = True
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def shell(name, surf, u0, u1, mats, nu=None, astep=None, a0=0.0, a1=1.0, wrap=None, cap0=None, cap1=None,
          mirror=None, matfn=None, angle=35, bevel=0.0, segs=1, step=0.3, cap_extra=None):
    """Core surface over [u0,u1] (optionally capped). cap0/cap1 are material indices."""
    wrap = surf.closed if wrap is None else wrap
    mir = surf.half if mirror is None else mirror
    bm = bmesh.new()
    nu = nu or max(1, math.ceil((u1 - u0) * surf.uscale / step))
    rows, faces = grid(bm, surf, u0, u1, a0, a1, nu, astep=astep, wrap=wrap)
    if matfn:
        for i, fr in enumerate(faces):
            for j, f in enumerate(fr):
                c = f.calc_center_median()
                f.material_index = matfn(c)

    def cap(ring, other, mi, u):
        vs = list(ring)
        if cap_extra:
            vs += [bm.verts.new(p) for p in cap_extra(u)]
        f = bm.faces.new(vs)
        f.normal_update()
        c0 = sum((v.co for v in ring), Vector()) / len(ring)
        c1 = sum((v.co for v in other), Vector()) / len(other)
        if f.normal.dot(c0 - c1) < 0:
            f.normal_flip()
        f.material_index = mi

    if cap0 is not None:
        cap(rows[0], rows[1], cap0, u0)
    if cap1 is not None:
        cap(rows[-1], rows[-2], cap1, u1)
    ob = new_mesh_obj(name, bm, mats)
    shade(ob, angle)
    if mir:
        mod_mirror(ob)
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def lathe(name, prof, mats, segs=32, M=None, segmat=None, angle=35, bevel=0.0, bsegs=1, mirror=False,
          loc=None):
    """Surface of revolution around local +Y. prof: [(r, t)] walked with the solid on the right
    (outer surfaces towards +t) so normals face out. M maps local -> world (or local if loc is given)."""
    M = M if M is not None else Matrix.Identity(4)
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new(M @ Vector((0.0, t, 0.0)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * j / segs), t,
                                                     r * math.sin(2 * math.pi * j / segs))))
                          for j in range(segs)])
    for i in range(len(prof) - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        mi = segmat[i] if segmat else 0
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(A) == 1:
                vs = (A[0], B[j], B[j2])
            elif len(B) == 1:
                vs = (A[j], B[0], A[j2])
            else:
                vs = (A[j], B[j], B[j2], A[j2])
            f = bm.faces.new(vs)
            f.material_index = mi
    ob = new_mesh_obj(name, bm, mats)
    if loc is not None:
        ob.location = loc
    shade(ob, angle)
    if mirror:
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, bsegs, angle)
    return ob


def axis_M(p0, p1=None, direction=None):
    """Matrix placing local +Y along p0 -> p1 (or along direction) with origin at p0."""
    p0 = Vector(p0)
    d = (Vector(p1) - p0) if p1 is not None else Vector(direction)
    q = d.normalized().to_track_quat("Y", "Z")
    return Matrix.Translation(p0) @ q.to_matrix().to_4x4(), d.length


def rod(name, p0, p1, r, m, segs=12, mirror=False, caps=True):
    M, L = axis_M(p0, p1)
    prof = [(0, 0), (r, 0), (r, L), (0, L)] if caps else [(r, 0), (r, L)]
    return lathe(name, prof, [m], segs=segs, M=M, mirror=mirror)


def box(name, size, loc, m, rot=(0, 0, 0), bevel=0.02, segs=1, mirror=False, angle=30):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, angle)
    if mirror:
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def hexa(name, pts, m, bevel=0.02, segs=1, mirror=False, angle=30):
    """Closed 8-corner solid: pts[0:4] bottom loop, pts[4:8] matching top loop."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in pts]
    for idx in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in idx])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, angle)
    if mirror:
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def prism(name, poly, z0, z1, M, m, bevel=0.015, segs=1, mirror=False, angle=30):
    """Extrude a 2D polygon (local XY) between local z0..z1, mapped by M."""
    bm = bmesh.new()
    lo = [bm.verts.new(M @ Vector((x, y, z0))) for (x, y) in poly]
    hi = [bm.verts.new(M @ Vector((x, y, z1))) for (x, y) in poly]
    bm.faces.new(lo)
    bm.faces.new(hi)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, angle)
    if mirror:
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def ringloft(name, rings, m, bevel=0.02, segs=1, mirror=False, angle=30, caps=True, mats=None, matfn=None):
    """Closed solid through a list of same-size 3D polygons (rings), capped at both ends.
    matfn(face centre, face normal) -> index into mats picks per-face materials."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(vr[0])
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if matfn:
        bm.normal_update()
        for f in bm.faces:
            f.material_index = matfn(f.calc_center_median(), f.normal)
    ob = new_mesh_obj(name, bm, mats or [m])
    shade(ob, angle)
    if mirror:
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, segs, angle)
    return ob


def pipe(name, pts, r, m, mirror=False, res=6, kind="BEZIER", sides=1):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_mode = "ROUND"
    cu.bevel_depth = r
    cu.bevel_resolution = sides
    cu.resolution_u = res
    cu.use_fill_caps = True
    if kind == "BEZIER":
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = "AUTO"
            bp.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for bp, p in zip(sp.points, pts):
            bp.co = (*p, 1.0)
    cu.materials.append(m)
    ob = link(bpy.data.objects.new(name, cu))
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    shade(ob, 50)
    if mirror:
        mod_mirror(ob, merge=False)
    return ob


def sphere(name, loc, r, m, segs=12, rings=8, mirror=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, 80)
    if mirror:
        mod_mirror(ob, merge=False)
    return ob


def plates(prefix, surf, bands, **kw):
    """bands: [(u0, u1, [(a0, a1, material or None, opts dict?), ...]), ...]"""
    out = []
    for bi, (u0, u1, cells) in enumerate(bands):
        for ci, cell in enumerate(cells):
            a0, a1, m = cell[0], cell[1], cell[2]
            if m is None:
                continue
            opts = dict(kw)
            if len(cell) > 3:
                opts.update(cell[3])
            out.append(plate(f"{prefix}_{bi}_{ci}", surf, u0, u1, a0, a1, m, **opts))
    return out


H, A, T, D = M_HULL, M_ACCENT, M_TRIM, M_DARK
RY = lambda deg: Matrix.Rotation(math.radians(deg), 4, "Y")
TR = lambda *v: Matrix.Translation(Vector(v))


def lin(u0, v0, u1, v1):
    return lambda u: v0 + (v1 - v0) * (u - u0) / (u1 - u0)


def frame_at(surf, u, a, eps=1e-3):
    """Point, outward normal and along-u tangent of surf at (u, a)."""
    p = surf.p(u, a)
    du = surf.p(u + eps, a) - surf.p(u - eps, a)
    da = surf.p(u, a + eps) - surf.p(u, a - eps)
    n = du.cross(da).normalized()
    if n.dot(p - surf.center(u)) < 0:
        n = -n
    t = (du - n * du.dot(n)).normalized()
    return p, n, t


def stick(name, surf, u, a, size, m, out=0.05, mirror=None, bevel=0.0, segs=1, spin=0.0):
    """Box lying on surf at (u, a): size = (across, along, height), raised `out` above the core."""
    p, n, t = frame_at(surf, u, a)
    x = t.cross(n).normalized()
    R = Matrix((x, t, n)).transposed().to_4x4()
    if spin:
        R = R @ Matrix.Rotation(spin, 4, "Z")
    M = Matrix.Translation(p + n * (out + size[2] / 2)) @ R @ Matrix.Diagonal((*size, 1.0))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, 30)
    if (surf.half if mirror is None else mirror):
        mod_mirror(ob, merge=False)
    if bevel:
        mod_bevel(ob, bevel, segs, 30)
    return ob

# canopy bubble (defined first: the pod's cockpit well and the interior are fitted to it)
CAN = Canopy([
    (-1.80, 0.58, 1.00, 1.80, 2.2),
    (-1.00, 0.86, 1.00, 2.04, 2.2),
    (-0.30, 0.99, 1.00, 2.22, 2.3),
    (0.60, 1.06, 1.00, 2.32, 2.3),
    (1.50, 1.07, 1.00, 2.29, 2.3),
    (2.25, 1.03, 1.00, 2.12, 2.3),
    (2.85, 0.90, 1.00, 1.70, 2.1),
    (3.22, 0.62, 1.00, 1.12, 2.0),
])


def glass_halfwidth(y, z):
    """Half-width of the canopy dome at (y, z); -1 outside it."""
    if y < -1.8 or y > 3.22:
        return -1.0
    p = CAN.par(y)
    if z < p["s"] or z > p["t"]:
        return -1.0
    q = ((z - p["s"]) / (p["t"] - p["s"])) ** p["e"]
    return p["w"] * max(0.0, 1.0 - q) ** (1.0 / p["e"])


# cockpit well cut into the pod under the canopy (y range, floor height, half-width kept inside the glass)
WELL_Y0, WELL_Y1, FLOOR = -0.45, 2.7, 0.55


def well_w(y):
    return min(0.93, CAN.par(y)["w"] - 0.08)


# =====================================================================================  cockpit pod
POD = Chine([
    (-1.25, 1.04, -0.50, -0.12, 0.52, 0.96, 0.62, 0.72),
    (-0.75, 1.30, -0.76, -0.26, 0.60, 1.05, 0.86, 1.00),
    (2.45, 1.34, -0.82, -0.28, 0.62, 1.06, 0.86, 1.04),
    (3.25, 1.20, -0.72, -0.24, 0.55, 0.98, 0.74, 0.94),
    (3.62, 1.00, -0.54, -0.18, 0.48, 0.86, 0.58, 0.80),
])
pod = POD.surf()
f = POD.fa
pod_core = shell("PodCore", pod, -1.25, 3.62, [D], cap0=0, cap1=0)
M_INT = mat("Interior", (0.2, 0.21, 0.23), 0.55, 0.5)
_rings = []
for k in range(15):
    y = WELL_Y0 + (WELL_Y1 - WELL_Y0) * k / 14
    w = well_w(y)
    _rings.append([(-w, y, FLOOR), (w, y, FLOOR), (w, y, 1.6), (-w, y, 1.6)])
well_cutter = ringloft("WellCutter", _rings, M_INT, bevel=0)
well_cutter.data.shade_flat()
well_cutter.hide_render = True
well_cutter.display_type = "WIRE"
_bo = pod_core.modifiers.new("well", "BOOLEAN")
_bo.operation = "DIFFERENCE"
_bo.solver = "EXACT"
_bo.object = well_cutter
_bo.material_mode = "TRANSFER"


def a_rim(y):
    """a on the pod's top facet just outside the well edge (the top plates stop there)."""
    tw = POD.par(y)["tw"]
    x = min(well_w(y) + 0.02, tw - 0.03)
    return f(4) + (f(5) - f(4)) * (tw - x) / tw


sl0 = lin(2.75, f(2, 0.7), 3.62, f(2, 0.36))  # livery stripe, slanting down into the nose stripe
sl1 = lin(2.75, f(2, 0.92), 3.62, f(2, 0.62))
UPPER = [(f(2, 0.72), f(3), H), (f(3), f(4), H), (f(4), f(5), H)]
RIM = [(f(2, 0.72), f(3), H), (f(3), f(4), H), (f(4), a_rim, H)]  # top facet trimmed around the well
plates("Pod", pod, [
    (-1.25, WELL_Y0, [(f(0), f(0, 0.45), D), (f(0, 0.45), f(1), H), (f(1), f(2), H)] + UPPER),
    (WELL_Y0, 0.62, [(f(0), f(0, 0.45), D), (f(0, 0.45), f(1), H), (f(1), f(2), H)] + RIM),
    (0.62, 1.85, [(f(0), f(0, 0.45), D), (f(0, 0.45), f(1), H), (f(1), f(2), H)] + RIM),
    (1.85, 2.75, [(f(0, 0.45), f(1), H), (f(1), f(2), H)] + RIM),
    (2.75, 3.62, [(f(0), f(0, 0.45), D), (f(0, 0.45), f(1), H), (f(1), f(2), H), (f(2), sl0, H), (sl0, sl1, A),
                  (sl1, f(3), H), (f(3), f(5), H)]),
])
# pod details: deck ahead of the windshield, shoulder hatches, chine running lights
stick("DeckHatch", pod, 3.38, f(4, 0.5), (0.5, 0.3, 0.015), T, out=0.05, mirror=False)
for k in (-1, 1):
    p, n, t = frame_at(pod, 3.3, f(4, 0.25))
    sphere(f"DeckDome{k}", (k * p.x, p.y, p.z + 0.05), 0.07, M_SENSOR if k > 0 else T, segs=10, rings=6)
for k, y in enumerate((1.2, 2.3)):
    stick(f"PodHatch{k}", pod, y, f(3, 0.5), (0.26, 0.55, 0.02), D, out=0.05)
    stick(f"PodHatchH{k}", pod, y - 0.18, f(3, 0.5), (0.12, 0.04, 0.03), T, out=0.07)
for k in range(3):
    stick(f"PodLight{k}", pod, 2.95 + k * 0.17, f(1, 0.5), (0.06, 0.09, 0.02), M_WHITE, out=0.05)
stick("PodVent", pod, 3.25, f(3, 0.45), (0.2, 0.42, 0.015), M_VENT, out=0.05)
for k in range(4):
    stick(f"PodVentSlat{k}", pod, 3.1 + k * 0.1, f(3, 0.45), (0.24, 0.035, 0.03), D, out=0.05)
# front gear bay frame
box("GearBayFront", (0.08, 1.0, 0.06), (0.36, 2.28, -0.86), T, bevel=0.01, mirror=True)

# armoured sponsons along the pod flanks: three segments over a dark core, intake mouth + cannon at the front
SP = [(1.18, -0.34), (1.5, -0.34), (1.64, -0.19), (1.64, 0.25), (1.5, 0.42), (1.18, 0.42)]


def sp_ring(y, slant=0.0, inset=0.0):
    out = []
    for (x, z) in SP:
        xi = x - inset if x > 1.3 else x
        zi = z + (inset if z < 0 else -inset)
        out.append((xi, y + slant * (zi + 0.34), zi))
    return out


ringloft("SponsonCore", [sp_ring(-0.95, -0.25, 0.035), sp_ring(2.86, -0.4, 0.035)], D, bevel=0, mirror=True)
for k, (y0, s0, y1, s1) in enumerate(((-1.12, -0.25, -0.12, 0.0), (-0.06, 0.0, 1.32, 0.0), (1.38, 0.0, 2.92, -0.4))):
    ringloft(f"Sponson{k}", [sp_ring(y0, s0), sp_ring(y1, s1)], H, bevel=0.025, segs=2, mirror=True)
box("SponsonStripe", (0.2, 3.55, 0.03), (1.33, 0.72, 0.43), A, bevel=0.0, mirror=True)
for k in range(4):
    box(f"SponsonVent{k}", (0.03, 0.08, 0.22), (1.65, 0.25 + k * 0.16, 0.12), D, bevel=0.0, mirror=True)
box("SponsonHatch", (0.03, 0.55, 0.3), (1.65, -0.65, 0.06), T, bevel=0.0, mirror=True)
box("SponsonLamp", (0.03, 0.12, 0.05), (1.65, 2.2, 0.15), M_WHITE, bevel=0.0, mirror=True)
box("SponsonStripe2", (0.03, 2.9, 0.1), (1.655, 0.4, -0.04), A, bevel=0.0, mirror=True)
mouth_lo, mouth_hi = 0.06, 0.34
ringloft("SponsonMouth", [[(1.24, 2.93 - 0.4 * (z + 0.34), z) for z in (mouth_lo, mouth_hi)] +
                          [(1.58, 2.93 - 0.4 * (z + 0.34), z) for z in (mouth_hi, mouth_lo)],
                          [(1.26, 2.9 - 0.4 * (z + 0.34), z) for z in (mouth_lo + 0.02, mouth_hi - 0.02)] +
                          [(1.56, 2.9 - 0.4 * (z + 0.34), z) for z in (mouth_hi - 0.02, mouth_lo + 0.02)]],
         D, bevel=0, mirror=True)
for k in range(3):
    z = mouth_lo + 0.07 + k * 0.075
    box(f"SponsonSlat{k}", (0.36, 0.035, 0.03), (1.41, 2.94 - 0.4 * (z + 0.34), z), T, bevel=0.0, mirror=True)
# cannons out of the sponson fronts
GM = TR(1.41, 0, -0.14)
lathe("GunShroud", [(0, 2.55), (0.13, 2.55), (0.15, 2.7), (0.15, 3.45), (0.11, 3.58), (0, 3.58)], [D], segs=16,
      M=GM, mirror=True, angle=40)
lathe("GunBand", [(0.155, 3.0), (0.163, 3.0), (0.163, 3.2), (0.155, 3.2)], [A], segs=16, M=GM, mirror=True)
lathe("GunBarrel", [(0, 3.5), (0.05, 3.5), (0.05, 4.45), (0.075, 4.48), (0.075, 4.72), (0.04, 4.72), (0.04, 4.6),
                    (0.0, 4.6)], [T], segs=12, M=GM, mirror=True, angle=40)

# =====================================================================================  nose module
NOSE = Chine([
    (3.40, 0.98, -0.58, -0.12, 0.38, 0.86, 0.45, 0.62),
    (4.50, 0.90, -0.52, -0.15, 0.22, 0.66, 0.40, 0.50),
    (5.40, 0.66, -0.38, -0.14, 0.06, 0.38, 0.28, 0.34),
    (5.95, 0.42, -0.24, -0.12, -0.02, 0.14, 0.18, 0.20),
])
nose = NOSE.surf()
g = NOSE.fa
shell("NoseCore", nose, 3.40, 5.95, [D], cap1=0)
nsl0 = lin(3.62, g(2, 0.37), 4.6, g(2, 0.2))
nsl1 = lin(3.62, g(2, 0.63), 4.6, g(2, 0.48))
plates("Nose", nose, [
    (3.62, 4.6, [(g(0), g(0, 0.5), D), (g(0, 0.5), g(1), H), (g(1), g(2), H), (g(2), nsl0, H), (nsl0, nsl1, A),
                 (nsl1, g(3), H), (g(3), g(4), H), (g(4), g(5), H)]),
    (4.6, 5.3, [(g(0), g(0, 0.5), D), (g(0, 0.5), g(1), H), (g(1), g(5), A)]),
    (5.3, 5.95, [(g(0), g(1), D), (g(1), g(5), A)]),
], thick=0.06)
for k in range(3):
    stick(f"NoseGrille{k}", nose, 4.05 + k * 0.17, g(3, 0.55), (0.3, 0.07, 0.02), D, out=0.06)
for k, y in enumerate((4.0, 4.45)):
    p, n, t = frame_at(nose, y, g(1, 0.5))
    sphere(f"NoseBlister{k}", tuple(p + n * 0.05), 0.07 if k else 0.09, T, segs=10, rings=6, mirror=True)
stick("NoseHatch", nose, 4.15, g(4, 0.4), (0.4, 0.6, 0.015), T, out=0.06, mirror=False)
box("NoseSensor", (0.46, 0.03, 0.06), (0, 5.965, -0.08), M_SENSOR, bevel=0)
box("NoseSensorHood", (0.52, 0.08, 0.035), (0, 5.97, -0.025), T, bevel=0.01)
# chin sensor turret
lathe("ChinTurret", [(0, -0.30), (0.2, -0.30), (0.22, -0.15), (0.17, 0.0), (0.0, 0.05)], [T], segs=20,
      M=TR(0, 4.55, -0.52) @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Rotation(math.pi, 4, "Z"), angle=50)
sphere("ChinLens", (0, 4.72, -0.68), 0.075, M_SENSOR)
# downswept "mandible" canards under the nose
CAN_FIN = Wing([(0.0, 0.0, 5.25, 1.15, 0.0, 0.12), (1.0, 0.95, 4.75, 0.5, 0.0, 0.07)], M=TR(0.62, 0, -0.32) @ RY(38))
cfin = CAN_FIN.surf()
shell("CanardCore", cfin, 0, 1, [D], nu=1, mirror=True, cap1=0)
plates("Canard", cfin, [(0.2, 1.0, [(CAN_FIN.K(2), CAN_FIN.K(5), A), (CAN_FIN.K(5), 1.0, H),
                                    (0.0, CAN_FIN.K(2), H)])], mirror=True, thick=0.025)
# =====================================================================================  neck + main body
NECK = Fuse([(-1.9, 0.9, -0.42, 0.25, 1.15, 2.6, 2.6), (-1.0, 0.9, -0.42, 0.25, 1.05, 2.6, 2.6)])
shell("NeckCore", NECK.surf(), -1.9, -1.0, [D], nu=3)
for k, (z, x) in enumerate(((0.75, 0.92), (0.45, 0.98), (-0.05, 0.95))):
    pipe(f"NeckPipe{k}", [(x - 0.1, -0.95, z), (x + 0.04, -1.45, z + 0.04), (x - 0.1, -1.95, z)], 0.055,
         T if k != 1 else A, mirror=True)

BODY = Chine([
    (-5.35, 1.20, -0.50, -0.15, 1.00, 1.50, 0.70, 0.65),
    (-4.90, 1.42, -0.70, -0.25, 1.15, 1.78, 0.90, 0.80),
    (-3.50, 1.55, -0.85, -0.30, 1.20, 1.88, 1.00, 0.85),
    (-2.10, 1.50, -0.82, -0.30, 1.15, 1.82, 0.95, 0.80),
    (-1.50, 1.20, -0.60, -0.20, 0.85, 1.72, 0.70, 0.60),
])
body = BODY.surf()
b = BODY.fa
shell("BodyCore", body, -5.35, -1.5, [D], cap0=0, cap1=0)
top_split = b(4, 0.45)
BOT = [(b(0), b(0, 0.4), D), (b(0, 0.4), b(1), H), (b(1), b(2), H)]
plates("Body", body, [
    (-5.35, -4.45, BOT + [(b(2), b(2, 0.55), H), (b(2, 0.55), b(2, 0.75), A), (b(2, 0.75), b(3), H), (b(3), b(4), H),
                          (b(4), top_split, H), (top_split, b(5), H)]),
    (-4.35, -2.95, BOT + [(b(2, 0.55), b(2, 0.75), A), (b(2, 0.75), b(3), H), (b(3), b(4), H),
                          (top_split, b(5), H)]),
    (-2.85, -1.5, BOT + [(b(2), b(2, 0.55), H), (b(2, 0.55), b(2, 0.75), A), (b(2, 0.75), b(3), H), (b(3), b(4), H),
                         (b(4), top_split, H), (top_split, b(5), H)]),
])
# layered shoulder armour (second plate layer)
plate("BodyArmour", body, -4.6, -2.15, b(3, 0.08), lin(-4.6, b(3, 0.75), -2.15, b(3, 0.95)), A, lift=0.05,
      thick=0.05, gap=0.0)
plate("BodyArmour2", body, -2.05, -1.62, b(3, 0.2), b(3, 0.95), D, lift=0.05, thick=0.04, gap=0.0)
stick("BodyHatch", body, -5.0, b(2, 0.3), (0.5, 0.55, 0.02), D, out=0.05)
stick("BodyHatchH", body, -4.86, b(2, 0.3), (0.06, 0.18, 0.03), T, out=0.07)
stick("BodyAccess", body, -2.3, b(2, 0.3), (0.42, 0.42, 0.02), T, out=0.05)
for k in range(3):
    stick(f"BodyLight{k}", body, -5.15 + k * 0.18, b(1, 0.5), (0.06, 0.09, 0.02), M_RED if k == 1 else M_WHITE,
          out=0.05)
# side vents (in the gap left in the mid band)
box("SideVentGlow", (0.03, 1.25, 0.62), (1.565, -3.65, 0.27), M_VENT, bevel=0, mirror=True)
for k in range(7):
    box(f"SideVentSlat{k}", (0.07, 0.05, 0.66), (1.6, -3.15 - k * 0.165, 0.27), D, bevel=0.0, mirror=True)
# top vents
box("TopVentGlow", (0.36, 1.25, 0.03), (0.6, -3.65, 1.87), M_VENT, bevel=0, mirror=True)
for k in range(7):
    box(f"TopVentSlat{k}", (0.42, 0.05, 0.07), (0.6, -3.15 - k * 0.165, 1.92), D, bevel=0.0, mirror=True)
# dorsal spine ridge
hexa("Spine", [(0.0, -1.75, 1.6), (0.3, -1.85, 1.6), (0.3, -5.0, 1.75), (0.0, -5.0, 1.75),
               (0.0, -1.95, 2.02), (0.2, -2.05, 2.02), (0.2, -4.9, 2.06), (0.0, -4.9, 2.06)], A, bevel=0.03, segs=2,
     mirror=True)
for k in range(4):
    box(f"SpineVent{k}", (0.26, 0.09, 0.03), (0.0, -2.5 - k * 0.16, 2.035), D, bevel=0.0)
box("SpineHatch", (0.3, 0.55, 0.03), (0.0, -4.2, 2.06), T, bevel=0.01)
for k, x in enumerate((0.55, 0.7)):
    pipe(f"BellyPipe{k}", [(x, -1.6, -0.62), (x + 0.05, -2.3, -0.86), (x + 0.05, -4.2, -0.9), (x - 0.05, -4.9, -0.75)],
         0.045, T if k == 0 else D, mirror=True)
# ventral keel
KEEL = Wing([(0.0, 0.0, -2.95, 2.0, 0.0, 0.18), (1.0, 0.5, -3.7, 1.4, 0.0, 0.1)],
            M=TR(0, 0, -0.62) @ RY(90))
keel = KEEL.surf()
shell("KeelCore", keel, 0, 1, [D], nu=2, cap0=0, cap1=0)
plates("Keel", keel, [(0.15, 1.0, [(KEEL.K(2), KEEL.K(5), A), (KEEL.K(5), 1.0, D), (0.0, KEEL.K(2), D)])],
       mirror=False, thick=0.03)
# hull-coloured frame around the dark rear face
def rear_frame(name, y, depth, scale_in, m):
    p = BODY.par(y)
    half = [(0.0, p["zb"]), (p["bw"], p["zb"]), (p["w"], p["zl"]), (p["w"], p["zu"]), (p["tw"], p["zt"]),
            (0.0, p["zt"])]
    loop = half + [(-x, z) for (x, z) in reversed(half[1:-1])]
    cz = 0.5 * (p["zl"] + p["zu"])
    bm = bmesh.new()
    rings = []
    for yy in (y + 0.02, y - depth):
        outer = [bm.verts.new((x, yy, z)) for (x, z) in loop]
        inner = [bm.verts.new((x * scale_in, yy, cz + (z - cz) * scale_in)) for (x, z) in loop]
        rings.append((outer, inner))
    n = len(loop)
    (o0, i0), (o1, i1) = rings
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((o1[i], o1[j], i1[j], i1[i]))  # back face
        bm.faces.new((o0[i], o0[j], o1[j], o1[i]))  # outer wall
        bm.faces.new((i0[i], i1[i], i1[j], i0[j]))  # inner wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the front of the frame is buried in the hull, so it stays open; make sure the back face points -Y
    bm.normal_update()
    back = [f for f in bm.faces if all(abs(v.co.y - (y - depth)) < 1e-6 for v in f.verts)]
    if back and back[0].normal.y > 0:
        for f in bm.faces:
            f.normal_flip()
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, 30)
    mod_bevel(ob, 0.02, 1, 30)
    return ob


rear_frame("RearFrame", -5.35, 0.07, 0.8, H)
box("TailLightL", (0.16, 0.03, 0.06), (-0.95, -5.43, 1.18), M_RED, bevel=0)
box("TailLightR", (0.16, 0.03, 0.06), (0.95, -5.43, 1.18), M_RED, bevel=0)
box("RearHatch", (0.7, 0.03, 0.2), (0.0, -5.37, 1.12), T, bevel=0)
# rear heat vents flanking the centre engine
for sx in (-1, 1):
    box(f"RearVent{sx}", (0.32, 0.03, 0.75), (sx * 0.72, -5.36, 0.55), M_VENT, bevel=0)
    for k in range(5):
        box(f"RearVentSlat{sx}{k}", (0.36, 0.07, 0.05), (sx * 0.72, -5.4, 0.25 + k * 0.15), D, bevel=0)

# =====================================================================================  canopy
can = CAN.surf()
glass = shell("CanopyGlass", can, -1.80, 3.22, [M_GLASS], nu=36, astep=0.16, cap1=0,
              cap_extra=lambda y: [(0.0, y, CAN.par(y)["s"])], angle=60)
plates("Cowl", can, [(-1.80, -0.62, [(0, 0.45, H), (0.45, 1, H)])], thick=0.05, step=0.2)
plate("CowlStripe", can, -1.8, -0.66, 0.9, 1.0, A, thick=0.07, gap=0.03, step=0.2)
frames = []
frames.append(plate("CanopyFrameSill", can, -0.62, 3.22, 0.0, 0.06, D, thick=0.04, gap=0.0, bevel=0.01, step=0.2))
for k, (y0, y1) in enumerate(((-0.68, -0.54), (0.46, 0.55), (2.17, 2.27))):
    frames.append(plate(f"CanopyFrameArch{k}", can, y0, y1, 0.0, 1.0, D, thick=0.04, gap=0.0, bevel=0.01,
                        astep=0.15))
rod("CowlAntenna", (0.0, -1.2, 2.05), (0.0, -1.5, 2.6), 0.018, T, segs=6)
sphere("CowlAntennaTip", (0.0, -1.5, 2.62), 0.03, M_WHITE, segs=8, rings=6)

# =====================================================================================  engines
NX, NZ = 2.75, 0.30
NAC = Rev([(-5.50, 0.90, 2.4), (-5.35, 0.98, 2.4), (-4.80, 0.98, 2.4), (-4.65, 0.93, 2.4),
           (-1.30, 0.90, 2.4), (-0.95, 0.84, 2.4)], NX, NZ, n=64)
nac = NAC.surf()
shell("NacCore", nac, -5.5, -0.95, [D], mirror=True, cap0=0, step=0.45, astep=0.2)
NC = [(-0.08, 0.08, H), (0.08, 0.2, H), (0.2, 0.3, A), (0.3, 0.45, H), (0.45, 0.55, D), (0.55, 0.7, H),
      (0.7, 0.8, D), (0.8, 0.92, H)]
plates("Nac", nac, [
    (-2.35, -1.0, NC),
    (-3.55, -2.45, [c if c[0] != -0.08 else (-0.08, 0.08, None) for c in NC]),
    (-4.62, -3.65, [c if c[0] != 0.45 else (0.45, 0.55, None) for c in NC]),
    (-5.45, -4.72, [(k / 6 + 0.02, (k + 1) / 6 + 0.02, T) for k in range(6)]),
], mirror=True, step=0.4, astep=0.2)
# armoured hood over each intake
HOOD = Rev([(-1.9, 1.0, 2.4), (-0.75, 1.0, 2.4), (-0.5, 0.97, 2.4)], NX, NZ, n=64).surf()
plate("NacHoodL", HOOD, -1.9, -0.62, -0.17, -0.02, H, thick=0.06, gap=0.04, mirror=True, step=0.3, astep=0.15,
      closed=True)
plate("NacHoodR", HOOD, -1.9, -0.62, 0.02, 0.17, H, thick=0.06, gap=0.04, mirror=True, step=0.3, astep=0.15,
      closed=True)
stick("NacHoodVent", HOOD, -1.3, 0.0, (0.1, 0.9, 0.04), M_VENT, out=0.0, mirror=True)
plate("NacHoodEdge", HOOD, -0.62, -0.5, -0.17, 0.17, A, thick=0.06, gap=0.0, mirror=True, step=0.3, astep=0.15,
      closed=True)
stick("NacHatch", nac, -4.2, 0.62, (0.4, 0.5, 0.02), D, out=0.05, mirror=True)
stick("NacSideHatch", nac, -1.75, 0.37, (0.34, 0.6, 0.02), D, out=0.05, mirror=True)
stick("NacSideHatchH", nac, -1.52, 0.37, (0.14, 0.04, 0.03), T, out=0.07, mirror=True)
stick("NacSideTag", nac, -4.1, 0.37, (0.3, 0.3, 0.015), A, out=0.05, mirror=True)
for k in range(4):
    stick(f"NacSideVent{k}", nac, -2.75 - k * 0.15, 0.36, (0.32, 0.06, 0.025), D, out=0.05, mirror=True)
stick("NacLamp", nac, -1.6, 0.6, (0.08, 0.1, 0.03), M_RED, out=0.05, mirror=True)
# heat-sink fins over a glowing slot on top of each nacelle
for k in range(9):
    box(f"NacFin{k}", (0.035, 0.08, 0.3), (NX, -2.52 - k * 0.12, NZ + 1.0), T if k % 2 else D, bevel=0.0,
        mirror=True)
box("NacVentGlow", (0.22, 1.1, 0.04), (NX, -3.0, NZ + 0.915), M_VENT, bevel=0, mirror=True)
# conduits along the outboard flank
for k, (a, r, m) in enumerate(((0.155, 0.055, T), (0.185, 0.045, D))):
    pts = []
    for y in (-1.35, -2.2, -3.1, -4.0, -4.55):
        p = nac.p(y, a)
        n = (p - Vector((NX, y, NZ))).normalized()
        pts.append(tuple(p + n * (0.06 + r)))
    pipe(f"NacPipe{k}", pts, r, m, mirror=True)
for k, y in enumerate((-1.7, -2.9, -4.1)):
    p = nac.p(y, 0.17)
    n = (p - Vector((NX, y, NZ))).normalized()
    c = p + n * 0.1
    box(f"NacClamp{k}", (0.2, 0.08, 0.22), tuple(c), T, rot=(0, -math.atan2(n.z, n.x) + math.pi / 2, 0),
        bevel=0.01, mirror=True)

# intake lip, duct, spinner and fan
lathe("NacLip", [(0.92, -1.35), (0.88, -0.98), (0.82, -0.82), (0.74, -0.78), (0.67, -0.84), (0.63, -1.05),
                 (0.61, -1.4)], [A], segs=40, M=TR(NX, 0, NZ), mirror=True, angle=40)
lathe("NacDuct", [(0.62, -1.3), (0.60, -1.72), (0.0, -1.72)], [D], segs=32, M=TR(NX, 0, NZ), mirror=True)
lathe("NacSpinner", [(0, -1.72), (0.26, -1.72), (0.25, -1.52), (0.16, -1.3), (0.05, -1.16), (0, -1.14)],
      [T], segs=24, M=TR(NX, 0, NZ), mirror=True, angle=50)
for k in range(12):
    ang = 2 * math.pi * k / 12
    c, s = math.cos(ang), math.sin(ang)
    box(f"FanBlade{k}", (0.33, 0.12, 0.022), (NX + 0.43 * c, -1.6, NZ + 0.43 * s), D,
        rot=(0.5, -ang, 0), bevel=0, mirror=True)


def nozzle(prefix, cx, cz, r, y0, length, petals=12):
    """Converging nozzle with petals, accent ring, exhaust spike and the glowing core (returned)."""
    M = TR(cx, 0, cz)
    y1 = y0 - length
    lathe(prefix + "Shell", [(r * 0.72, y0 - 0.1), (r * 0.76, y1 + 0.05), (r * 0.82, y1 - 0.02),
                             (r * 0.9, y1 + 0.02), (r * 0.98, y0 + 0.02), (r * 1.04, y0 + 0.1)],
          [D], segs=40, M=M, angle=40)
    rev = Rev([(y1 + 0.02, r * 0.93), (y0 + 0.02, r * 1.03)], cx, cz, n=48).surf()
    for k in range(petals):
        plate(f"{prefix}Petal{k}", rev, y1 + 0.02, y0 - 0.05, k / petals, (k + 1) / petals, T,
              thick=0.035, gap=0.05, step=1.0, astep=0.2, mirror=False, bevel=0.008, segs=1)
    lathe(prefix + "Ring", [(r * 1.0, y0 - 0.02), (r * 1.08, y0 - 0.02), (r * 1.08, y0 + 0.14),
                            (r * 1.0, y0 + 0.14)], [A], segs=40, M=M, angle=40)
    gy = y1 + 0.32
    lathe(prefix + "Spike", [(0, gy - 0.42), (r * 0.08, gy - 0.4), (r * 0.2, gy - 0.22), (r * 0.24, gy + 0.02),
                             (0, gy + 0.02)], [T], segs=20, M=M, angle=50)
    return lathe(prefix + "Glow", [(0, -0.05), (r * 0.5, -0.035), (r * 0.74, 0.0)], [M_ENGINE], segs=32,
                 loc=(cx, gy, cz), angle=80)


glows = []
for side, nm in ((1, "R"), (-1, "L")):
    gl = nozzle(f"Nac{nm}", NX * side, NZ, 0.92, -5.42, 0.78)
    gl.name = f"EngineGlow{nm}"
    glows.append(gl)
gl = nozzle("Center", 0.0, 0.62, 0.56, -5.30, 0.55, petals=10)
gl.name = "EngineGlowC"
glows.append(gl)

# pylons between body and nacelles
hexa("PylonTop", [(1.25, -1.7, 0.62), (2.35, -2.0, 0.62), (2.35, -4.6, 0.62), (1.25, -4.75, 0.62),
                  (1.25, -1.9, 0.98), (2.35, -2.2, 0.9), (2.35, -4.45, 0.9), (1.25, -4.6, 0.98)],
     H, bevel=0.03, segs=2, mirror=True)
box("PylonStripe", (0.9, 0.12, 0.03), (1.8, -2.35, 0.93), A, bevel=0.0, mirror=True, rot=(0, -0.07, -0.27))
hexa("PylonLow", [(1.25, -2.3, -0.32), (2.3, -2.6, -0.32), (2.3, -4.2, -0.32), (1.25, -4.35, -0.32),
                  (1.25, -2.4, -0.05), (2.3, -2.7, -0.05), (2.3, -4.1, -0.05), (1.25, -4.25, -0.05)],
     D, bevel=0.03, segs=1, mirror=True)
for k, (z, x0) in enumerate(((0.38, 1.3), (0.2, 1.3), (0.05, 1.35))):
    pipe(f"PylonPipe{k}", [(x0, -2.4 - k * 0.5, z), (1.75, -2.6 - k * 0.5, z + 0.05), (2.2, -2.8 - k * 0.5, z)],
         0.05, T if k != 1 else A, mirror=True)

# =====================================================================================  wings
# inner panel and a dogtoothed outer panel (leading edge steps forward, trailing edge sweeps forward)
WING = Wing([(0.0, 3.30, -1.30, 3.80, 0.42, 0.40), (1.0, 4.60, -2.05, 2.95, 0.53, 0.30)])
wing = WING.surf()
K = WING.K
shell("WingCore", wing, 0.0, 1.0, [D], nu=2, mirror=True, cap0=0, cap1=0)
WC = [(K(2), K(5), A), (K(1), K(2), H), (K(0), K(1), D), (K(5), K(7), H)]
plates("Wing", wing, [(0.3, 1.0, WC)], mirror=True, thick=0.04)
WING2 = Wing([(0.0, 4.55, -1.82, 3.12, 0.53, 0.30), (0.55, 5.55, -2.2, 2.5, 0.65, 0.24),
              (1.0, 6.38, -2.5, 1.6, 0.76, 0.18)])
wing2 = WING2.surf()
shell("Wing2Core", wing2, 0.0, 1.0, [D], nu=3, mirror=True, cap0=0, cap1=0)
plates("Wing2", wing2, [(0.0, 0.55, WC), (0.55, 1.0, [(K(2), K(5), A), (K(1), K(2), A), (K(0), K(1), D),
                                                       (K(5), K(7), H)])], mirror=True, thick=0.04)
stick("WingHatch", wing2, 0.25, (K(1) + K(2)) / 2, (0.55, 0.7, 0.015), D, out=0.04, mirror=True)
stick("WingHatch2", wing, 0.65, K(1) + 0.3 * (K(2) - K(1)), (0.5, 0.5, 0.015), T, out=0.04, mirror=True)
for k in range(3):
    stick(f"WingVent{k}", wing, 0.62, K(1) + (0.62 + 0.09 * k) * (K(2) - K(1)), (0.7, 0.05, 0.02), D, out=0.04,
          mirror=True)
# wing fence at the kink
WP = WING.surf()
fence_c = WP.p(0.97, (K(1) + K(2)) / 2)
box("WingFence", (0.04, 2.6, 0.16), (fence_c.x, fence_c.y + 0.1, fence_c.z + 0.12), T, bevel=0.01, mirror=True,
    rot=(0, -0.08, 0))
# hardpoint + missile pod under the outer wing
hp = wing2.p(0.4, (K(5) + K(7)) / 2)
box("HardpointPylon", (0.1, 1.0, 0.3), (hp.x, hp.y + 0.15, hp.z - 0.15), D, bevel=0.02, mirror=True)
box("MissilePod", (0.34, 1.5, 0.3), (hp.x, hp.y + 0.1, hp.z - 0.42), D, bevel=0.035, segs=2, mirror=True)
for i in range(2):
    for j in range(2):
        lathe(f"Missile{i}{j}", [(0, 0.0), (0.06, 0.0), (0.06, 0.12), (0.0, 0.2)], [A if j == 0 else T], segs=10,
              M=TR(hp.x - 0.08 + 0.16 * i, hp.y + 0.85, hp.z - 0.49 + 0.14 * j), mirror=True, angle=50)

# wingtip pod + fin
lathe("TipPod", [(0, -5.25), (0.15, -5.25), (0.2, -5.05), (0.2, -2.5), (0.18, -2.1), (0.08, -1.55), (0, -1.5)],
      [D, T, H, A], segmat=[0, 1, 2, 3, 3, 3], segs=20, M=TR(6.42, 0, 0.74), mirror=True, angle=40)
FIN_TIP = Wing([(0.0, 0.0, -3.0, 1.9, 0.0, 0.16), (1.0, 1.05, -3.85, 0.95, 0.0, 0.1)],
               M=TR(6.42, 0, 0.85) @ RY(-80))
fin_tip = FIN_TIP.surf()
shell("TipFinCore", fin_tip, 0, 1, [D], nu=2, mirror=True, cap1=0)
Kf = FIN_TIP.K
plates("TipFin", fin_tip, [(0.05, 0.8, [(Kf(2), Kf(5), A), (Kf(5), 1.0, H), (0.0, Kf(2), H)]),
                           (0.8, 1.0, [(Kf(2), Kf(5), A), (Kf(5), 1.0, A), (0.0, Kf(2), A)])],
       mirror=True, thick=0.03)

# lower strakes (anhedral) with a gun pod at the tip
STRAKE = Wing([(0.0, 0.0, -2.0, 2.4, 0.0, 0.26), (1.0, 1.75, -2.95, 1.25, 0.0, 0.14)], M=TR(3.2, 0, -0.12) @ RY(25))
strake = STRAKE.surf()
Ks = STRAKE.K
shell("StrakeCore", strake, 0, 1, [D], nu=2, mirror=True, cap0=0, cap1=0)
plates("Strake", strake, [(0.3, 1.0, [(Ks(2), Ks(5), A), (Ks(1), Ks(2), H), (Ks(0), Ks(1), D), (Ks(5), 1.0, D)])],
       mirror=True, thick=0.03)
st_tip = strake.p(1.0, 0.0)
lathe("StrakePod", [(0, -4.35), (0.12, -4.35), (0.15, -4.2), (0.15, -2.6), (0.1, -2.3), (0.0, -2.25)],
      [D, T, D, T, T], segmat=[0, 1, 2, 3, 3], segs=16, M=TR(4.83, 0, -0.9), mirror=True, angle=40)
rod("StrakeGun", (4.83, -2.3, -0.9), (4.83, -1.7, -0.9), 0.04, T, segs=8, mirror=True)

# dorsal tail fins
FIN = Wing([(0.0, 0.0, -3.1, 1.85, 0.0, 0.2), (1.0, 1.0, -4.45, 1.05, 0.0, 0.11)],
           M=TR(0.62, 0, 1.78) @ RY(-68))
fin = FIN.surf()
shell("TailFinCore", fin, 0, 1, [D], nu=2, mirror=True, cap0=0, cap1=0)
Kt = FIN.K
plates("TailFin", fin, [(0.12, 0.78, [(Kt(2), Kt(5), A), (Kt(5), 1.0, H), (0.0, Kt(2), H)]),
                        (0.78, 1.0, [(Kt(2), Kt(5), A), (Kt(5), 1.0, A), (0.0, Kt(2), A)])],
       mirror=True, thick=0.03)

stick("TailFinPanel", fin, 0.45, (Kt(5) + 1.0) / 2 + 0.03, (0.25, 0.6, 0.012), D, out=0.03, mirror=True)
stick("TailFinPanelR", fin, 0.45, Kt(2) / 2 - 0.03, (0.25, 0.6, 0.012), D, out=0.03, mirror=True)

# =====================================================================================  sensors / antennas (asymmetric)
box("AntennaBase", (0.3, 0.4, 0.12), (-0.6, -2.05, 1.95), D, bevel=0.02)
for k, (p0, p1) in enumerate((((-0.6, -1.95, 2.0), (-0.6, -1.95, 2.75)), ((-0.5, -2.12, 2.0), (-0.44, -2.2, 2.45)),
                               ((-0.7, -2.1, 2.0), (-0.8, -2.15, 2.3)))):
    rod(f"Antenna{k}", p0, p1, 0.018 if k else 0.024, T, segs=6)
    sphere(f"AntennaTip{k}", p1, 0.035, M_RED if k == 0 else T, segs=8, rings=6)
rod("DishStalk", (0.62, -2.0, 1.9), (0.62, -2.0, 2.2), 0.05, T, segs=10)
DM, _ = axis_M((0.62, -2.0, 2.2), direction=(0.45, 0.35, 1.0))
lathe("Dish", [(0, -0.03), (0.32, 0.07), (0.34, 0.12), (0.3, 0.11), (0.0, 0.03)], [T], segs=20, M=DM, angle=60)
lathe("DishHorn", [(0, 0.03), (0.025, 0.03), (0.025, 0.3), (0.0, 0.32)], [D], segs=8, M=DM)
sphere("DishFeed", tuple(DM @ Vector((0, 0.32, 0))), 0.04, M_SENSOR, segs=8, rings=6)


# RCS thruster quads
def rcs(name, loc, rot_z=0.0, mirror=True):
    box(name, (0.2, 0.22, 0.16), loc, D, rot=(0, 0, rot_z), bevel=0.02, mirror=mirror)
    d = Matrix.Rotation(rot_z, 3, "Z") @ Vector((1, 0, 0))
    for k, off in enumerate((-0.055, 0.055)):
        p = Vector(loc) + Matrix.Rotation(rot_z, 3, "Z") @ Vector((0.1, off, 0))
        M, _ = axis_M(p, direction=d)
        lathe(f"{name}N{k}", [(0.035, -0.02), (0.045, 0.06), (0.03, 0.06), (0.0, 0.02)], [T], segs=8, M=M,
              mirror=mirror)


rcs("RcsNose", (1.17, 3.05, 0.42))
rcs("RcsTail", (1.24, -5.0, 1.32))

# =====================================================================================  lights
sphere("NavR", (-6.42, -1.52, 0.74), 0.07, M_RED)
sphere("NavG", (6.42, -1.52, 0.74), 0.07, M_GREEN)
sphere("NavTop", (1.0, -4.95, 2.73), 0.06, M_WHITE)
box("NavBelly", (0.18, 0.18, 0.04), (0, -1.3, -0.62), M_WHITE, bevel=0.0)


# =====================================================================================  landing gear
def gear(name, pivot, foot_r=0.34, light=False):
    px, py, pz = pivot
    L = pz - GROUND
    root = link(bpy.data.objects.new(name, None))
    root.empty_display_type = "PLAIN_AXES"
    root.location = pivot
    parts = []
    parts.append(box(name + "_yoke", (0.34, 0.3, 0.24), (px, py, pz), D, bevel=0.03))
    parts.append(rod(name + "_axle", (px - 0.22, py, pz), (px + 0.22, py, pz), 0.07, T))
    zk = pz - 0.55 * L
    parts.append(rod(name + "_strut", (px, py, pz), (px, py, zk), 0.12, D, segs=16))
    parts.append(rod(name + "_collar", (px, py, zk - 0.02), (px, py, zk + 0.08), 0.145, A, segs=16))
    zf = GROUND + 0.2
    parts.append(rod(name + "_oleo", (px, py, zk), (px, py, zf), 0.075, T, segs=16))
    knee = (px, py + 0.2, (zk + zf) / 2)
    parts.append(rod(name + "_link0", (px, py + 0.08, zk - 0.02), knee, 0.035, D, segs=8))
    parts.append(rod(name + "_link1", knee, (px, py + 0.08, zf + 0.04), 0.035, D, segs=8))
    a0 = Vector((px, py - 0.35, pz - 0.05))
    a1 = Vector((px, py - 0.1, zk + 0.15))
    parts.append(rod(name + "_act", a0, (a0 + a1) / 2, 0.06, D, segs=10))
    parts.append(rod(name + "_actrod", (a0 + a1) / 2, a1, 0.032, T, segs=8))
    parts.append(rod(name + "_ankle", (px - 0.16, py, zf), (px + 0.16, py, zf), 0.07, T))
    Mz = TR(px, py, 0) @ Matrix.Rotation(math.pi / 2, 4, "X")
    parts.append(lathe(name + "_pad", [(0, GROUND), (foot_r, GROUND), (foot_r, GROUND + 0.06),
                                       (foot_r * 0.78, GROUND + 0.13), (0.1, GROUND + 0.15), (0, GROUND + 0.15)],
                       [D], segs=20, M=Mz, angle=40))
    parts.append(lathe(name + "_padring", [(foot_r - 0.01, GROUND + 0.012), (foot_r + 0.02, GROUND + 0.012),
                                           (foot_r + 0.02, GROUND + 0.055), (foot_r - 0.01, GROUND + 0.055)],
                       [A], segs=20, M=Mz))
    if light:
        parts.append(box(name + "_lamp", (0.16, 0.06, 0.1), (px, py + 0.13, zk - 0.05), M_WHITE, bevel=0.01))
    inv = TR(px, py, pz).inverted()
    for p in parts:
        p.parent = root
        p.matrix_parent_inverse = inv
    return root


gears = [gear("GearFront", (0.0, 2.45, -0.5), foot_r=0.3, light=True),
         gear("GearLeft", (-NX, -3.6, -0.35)),
         gear("GearRight", (NX, -3.6, -0.35))]


# =====================================================================================  cockpit interior
# Shown by the game only in first-person view. Everything sits inside the canopy dome or down in the
# cockpit well (both hidden from outside by the opaque glass); verify_interior() checks this.
I = M_INT
_before_interior = set(o.name for o in scene.objects)
cockpit_root = link(bpy.data.objects.new("CockpitInterior", None))
cockpit_root.empty_display_type = "PLAIN_AXES"
cockpit_root.empty_display_size = 0.3
B2T = lambda v: Vector((v.x, -v.z, v.y))  # three.js axes -> Blender axes
K_TILT = math.tan(0.4)  # the screens lean back 0.4 rad


def lbox(name, M, size, center, m, bevel=0.0, segs=1):
    """Box in a local frame M (4x4)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=M @ Matrix.Translation(center) @ Matrix.Diagonal((*size, 1.0)), verts=bm.verts)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, 30)
    if bevel:
        mod_bevel(ob, bevel, segs, 30)
    return ob


def frame_solid(name, M, outer, inner, n0, n1, m, bevel=0.004):
    """Rectangular frame (outer minus inner rectangle in the local u-v plane) between local n0..n1."""
    bm = bmesh.new()

    def rect(r, n):
        u0, u1, v0, v1 = r
        return [bm.verts.new(M @ Vector((u, v, n))) for (u, v) in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]

    of, ob_, inf, inb = rect(outer, n1), rect(outer, n0), rect(inner, n1), rect(inner, n0)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob_[i], inb[i], inb[j], ob_[j]))
        bm.faces.new((of[i], ob_[i], ob_[j], of[j]))
        bm.faces.new((inf[i], inf[j], inb[j], inb[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_obj(name, bm, [m])
    shade(ob, 30)
    if bevel:
        mod_bevel(ob, bevel, 1, 30)
    return ob


# ---- screen modules: recessed bezels around the game's canvas screens -------------------------------
SCREENS = [("ScreenLeft", (-0.46, 2.12, 1.22), -0.4, 0.3, 0.30, 0.19),
           ("ScreenCenter", (0.0, 2.20, 1.24), -0.4, 0.0, 0.27, 0.27),
           ("ScreenRight", (0.46, 2.12, 1.22), -0.4, -0.3, 0.30, 0.19)]
screen_empties = []
GLOW_CYCLE = [M_SENSOR, M_VENT, M_SENSOR, M_GREEN, M_SENSOR, M_RED]
for si, (nm, c, rx, ry, w, h) in enumerate(SCREENS):
    R3 = Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(ry, 3, "Y")  # three.js Euler XYZ
    X, Y, N = (B2T(R3 @ Vector(v)) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
    MS = Matrix.Translation(c) @ Matrix((X, Y, N)).transposed().to_4x4()  # local u (width), v (up), n (to eye)
    mt = 0.02 if nm == "ScreenCenter" else 0.025  # top border (kept thin under the glare shield)
    ms, mb = 0.035, 0.05
    lbox(f"CpHousing{si}", MS, (w + 2 * ms, h + mt + mb, 0.08), (0, (mt - mb) / 2, -0.052), D)
    frame_solid(f"CpBezel{si}", MS, (-w / 2 - ms, w / 2 + ms, -h / 2 - mb, h / 2 + mt),
                (-w / 2 - 0.004, w / 2 + 0.004, -h / 2 - 0.004, h / 2 + 0.004), -0.012, 0.022, I)
    frame_solid(f"CpBezelLip{si}", MS, (-w / 2 - 0.012, w / 2 + 0.012, -h / 2 - 0.012, h / 2 + 0.012),
                (-w / 2 - 0.004, w / 2 + 0.004, -h / 2 - 0.004, h / 2 + 0.004), 0.0, 0.026, D, bevel=0.002)
    for k in range(5):  # soft-key row under each screen
        u = (k - 2) * (w / 5.2)
        lbox(f"CpKey{si}{k}", MS, (w / 7.5, 0.016, 0.008), (u, -h / 2 - mb / 2 - 0.004, 0.026),
             GLOW_CYCLE[(k + si) % len(GLOW_CYCLE)])
    emp = link(bpy.data.objects.new(nm, None))
    emp.empty_display_type = "ARROWS"
    emp.empty_display_size = 0.08
    emp.parent = cockpit_root
    # local X = screen width, local Z = screen up, local -Y = screen normal (towards the eye); exported to
    # glTF this is exactly three.js Euler(rx, ry, 0), so a PlaneGeometry child faces the pilot.
    emp.matrix_basis = Matrix.Translation(c) @ Matrix((X, -N, Y)).transposed().to_4x4()
    screen_empties.append(emp)

# ---- dashboard body: lofted across x, its face follows the screens, glare-shield brow on top ----------
yface = interp([(0.0, 2.24), (0.2, 2.235), (0.32, 2.215), (0.46, 2.17), (0.62, 2.11), (0.76, 2.02),
                (0.86, 1.93)])
ztop = interp([(0.0, 1.395), (0.17, 1.395), (0.27, 1.37), (0.4, 1.37), (0.66, 1.375), (0.76, 1.29),
               (0.86, 1.18)])


def y_front(x, z=1.14):
    y = 2.95
    while y > 2.2 and glass_halfwidth(y, z + 0.03) < abs(x) + 0.06:
        y -= 0.01
    return y


def dash_ring(x):
    ax = abs(x)
    zt = ztop(ax)
    yF = lambda z: yface(ax) + (z - 1.24) * K_TILT
    yf = y_front(x)
    yb = min(2.64, yf - 0.02)
    pts = [(yF(1.10) - 0.06, FLOOR), (yF(1.10) - 0.13, 1.0), (yF(1.10) - 0.15, 1.065), (yF(1.10) - 0.13, 1.088),
           (yF(1.10), 1.10), (yF(zt), zt), (yF(zt) - 0.035, zt + 0.004), (yF(zt) + 0.05, zt + 0.012),
           (yf, 1.14), (yf, 1.0), (yb, 1.0), (yb, FLOOR)]
    return [(x, y, z) for (y, z) in pts]


DX = [0.0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.38, 0.46, 0.54, 0.62, 0.68, 0.74, 0.8, 0.86]
dash = ringloft("CpDash", [dash_ring(x) for x in [-v for v in DX[:0:-1]] + DX], I, bevel=0.01, angle=28,
                mats=[I, D], matfn=lambda c, n: 1 if (n.z > 0.45 and c.z > 1.2) else 0)
# shelf switches between the screen modules and warning lights under the brow lip
for sx in (-1, 1):
    for k in range(3):
        box(f"CpShelfSw{sx}{k}", (0.014, 0.014, 0.04), (sx * (0.2 + k * 0.035), 2.09, 1.105), T, rot=(-0.4, 0, 0))
    for k in range(4):
        z = 1.16 + k * 0.045
        box(f"CpGapBtn{sx}{k}", (0.026, 0.012, 0.026), (sx * 0.222, yface(0.222) + (z - 1.24) * K_TILT - 0.003, z),
            GLOW_CYCLE[(k + (sx > 0)) % len(GLOW_CYCLE)], rot=(-0.4, 0, 0))
for k in range(7):
    x = (k - 3) * 0.04
    box(f"CpWarn{k}", (0.026, 0.014, 0.01), (x, 2.292, 1.405), [M_RED, M_VENT, M_GREEN][k % 3] if k != 3 else M_SENSOR)
# accent piping along the shelf edge, metal piping along the glare-shield lip
PX = [-0.8, -0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8]
pipe("CpShelfPiping", [(x, yface(abs(x)) - 0.059 - 0.134, 1.09) for x in PX], 0.008, A, res=3, sides=0)
pipe("CpBrowPiping", [(x, yface(abs(x)) + (ztop(abs(x)) - 1.24) * K_TILT - 0.037, ztop(abs(x)) + 0.004)
                      for x in PX], 0.007, T, res=3, sides=0)


def face_frame(x, z):
    """Local frame on the dashboard face at (x, z): u along the face, v up the face, n towards the pilot."""
    dy = (yface(abs(x) + 0.01) - yface(max(abs(x) - 0.01, 0.0))) / 0.02 * (1 if x >= 0 else -1)
    p = Vector((x, yface(abs(x)) + (z - 1.24) * K_TILT, z))
    u = Vector((1.0, dy, 0.0)).normalized()
    v = Vector((0.0, K_TILT, 1.0)).normalized()
    n = u.cross(v).normalized()
    if n.y > 0:
        n = -n
    v = n.cross(u).normalized() if n.cross(u).z > 0 else -n.cross(u).normalized()
    return Matrix.Translation(p) @ Matrix((u, v, n)).transposed().to_4x4()


# switch clusters on the dashboard wings, following the curving face
for sx in (-1, 1):
    for r in range(2):
        FM = face_frame(sx * 0.71, 1.17 + r * 0.075)
        lbox(f"CpWingPlate{sx}{r}", FM, (0.15, 0.055, 0.012), (0, 0, 0.002), D)
        for k in range(3):
            lbox(f"CpWingSw{sx}{r}{k}", FM, (0.026, 0.022, 0.012), ((k - 1) * 0.045, 0, 0.01),
                 T if (k + r) % 2 else GLOW_CYCLE[(k + 2 * r + (sx > 0)) % len(GLOW_CYCLE)])
# knee panel details
for sx in (-1, 1):
    yk = lambda z: yface(0.3) - 0.059 - 0.06 - 0.07 * (z - FLOOR) / (1.0 - FLOOR)  # knee face y at height z
    box(f"CpKneePanel{sx}", (0.26, 0.012, 0.2), (sx * 0.3, yk(0.84) - 0.003, 0.84), D, rot=(0.155, 0, 0))
    for k in range(3):
        box(f"CpKneeLight{sx}{k}", (0.03, 0.008, 0.012), (sx * (0.22 + k * 0.05), yk(0.96) - 0.003, 0.96), M_VENT,
            rot=(0.155, 0, 0))

# ---- side consoles (mirrored base) with switch banks, buttons and readouts ---------------------------
CONS = lambda y, x0=0.47, x1=0.9: [(x0, y, FLOOR), (x0, y, 1.10), (x0 + 0.03, y, 1.135), (x1 - 0.04, y, 1.16),
                                   (x1, y, 1.13), (x1, y, FLOOR)]
cons_front = [(x, yface(x) - 0.12, z) for (x, _, z) in CONS(0.0)]
ringloft("CpConsole", [CONS(0.45), CONS(0.6), CONS(1.6), cons_front], I, bevel=0.012, mirror=True)
ctop = lambda x: 1.135 + (abs(x) - 0.5) / 0.36 * 0.025
for sx in (-1, 1):
    # rear switch bank
    box(f"CpSwPlate{sx}", (0.3, 0.34, 0.01), (sx * 0.68, 0.9, ctop(0.68) + 0.004), D)
    for r, y in enumerate((0.8, 0.98)):
        for k in range(5):
            x = sx * (0.57 + k * 0.055)
            box(f"CpToggle{sx}{r}{k}", (0.012, 0.012, 0.045), (x, y, ctop(x) + 0.03), T, rot=(0.35, 0, 0))
            box(f"CpToggleLed{sx}{r}{k}", (0.016, 0.012, 0.006), (x, y + 0.045, ctop(x) + 0.01),
                M_GREEN if (k + r) % 3 else M_VENT)
    # front readout + knobs
    box(f"CpReadout{sx}", (0.24, 0.07, 0.006), (sx * 0.66, 1.72, ctop(0.66) + 0.006), M_SENSOR if sx > 0 else M_VENT)
    box(f"CpReadoutHood{sx}", (0.27, 0.012, 0.03), (sx * 0.66, 1.765, ctop(0.66) + 0.015), D)
    for k in range(2):
        x = sx * (0.6 + k * 0.12)
        lathe(f"CpKnob{sx}{k}", [(0, 0), (0.022, 0), (0.02, 0.028), (0, 0.03)], [T], segs=12,
              M=TR(x, 1.86, ctop(x)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    # inner side vents
    for k in range(4):
        box(f"CpConsVent{sx}{k}", (0.012, 0.2, 0.025), (sx * 0.466, 1.2, 0.85 + k * 0.05), D)
for sx in (-1, 1):
    box(f"CpConsEdge{sx}", (0.012, 1.4, 0.012), (sx * 0.5, 1.2, 1.137), A)
    box(f"CpConsFrontPlate{sx}", (0.3, 0.12, 0.008), (sx * 0.67, 1.56, ctop(0.67) + 0.003), D)
    for k in range(4):
        x = sx * (0.57 + k * 0.065)
        box(f"CpConsFrontBtn{sx}{k}", (0.03, 0.03, 0.01), (x, 1.56, ctop(abs(x)) + 0.008),
            GLOW_CYCLE[(k + 3 * (sx > 0)) % len(GLOW_CYCLE)] if k % 2 == 0 else T)
# right: button grid
for r in range(4):
    for k in range(3):
        x = 0.6 + k * 0.07
        box(f"CpBtn{r}{k}", (0.04, 0.04, 0.01), (x, 1.2 + r * 0.075, ctop(x) + 0.006),
            GLOW_CYCLE[(r * 3 + k) % len(GLOW_CYCLE)] if (r + k) % 2 == 0 else T)
box("CpBtnPlate", (0.25, 0.32, 0.008), (0.67, 1.31, ctop(0.67) + 0.002), D)
# left: throttle track + side buttons
box("CpThrottleTrack", (0.036, 0.56, 0.012), (-0.55, 1.36, ctop(0.55) + 0.003), D)
for sx in (-1, 1):
    box(f"CpThrottleRail{sx}", (0.012, 0.56, 0.014), (-0.55 + sx * 0.03, 1.36, ctop(0.55) + 0.006), T)
for k in range(4):
    box(f"CpThrBtn{k}", (0.035, 0.035, 0.01), (-0.72, 1.18 + k * 0.08, ctop(0.72) + 0.006),
        GLOW_CYCLE[k + 1])

# ---- floor, pedestal, pedals -------------------------------------------------------------------------
for k in range(3):
    box(f"CpFloorGrate{k}", (0.7, 0.32, 0.012), (0.0, 1.35 + k * 0.36, FLOOR + 0.006), D)
box("CpPedestal", (0.2, 0.32, 0.44), (0.0, 1.7, FLOOR + 0.22), I, bevel=0.012)
box("CpPedestalTop", (0.22, 0.34, 0.02), (0.0, 1.7, FLOOR + 0.45), D, bevel=0.005)
for sx in (-1, 1):
    box(f"CpPedal{sx}", (0.12, 0.05, 0.22), (sx * 0.17, 1.98, FLOOR + 0.13), T, rot=(-0.45, 0, 0), bevel=0.008)

# ---- seat ----------------------------------------------------------------------------------------------
box("CpSeatBase", (0.36, 0.42, 0.2), (0.0, 0.96, FLOOR + 0.1), D, bevel=0.015)
box("CpSeatPan", (0.54, 0.52, 0.09), (0.0, 0.98, 0.74), I, rot=(0.12, 0, 0), bevel=0.02, segs=2)
box("CpSeatCushion", (0.42, 0.44, 0.04), (0.0, 0.99, 0.79), D, rot=(0.12, 0, 0), bevel=0.012, segs=2)
box("CpSeatBack", (0.52, 0.1, 0.74), (0.0, 0.74, 1.14), I, rot=(0.25, 0, 0), bevel=0.02, segs=2)
box("CpSeatBackPad", (0.4, 0.04, 0.6), (0.0, 0.8, 1.15), D, rot=(0.25, 0, 0), bevel=0.012, segs=2)
for sx in (-1, 1):
    box(f"CpSeatBolster{sx}", (0.07, 0.16, 0.6), (sx * 0.27, 0.78, 1.12), I, rot=(0.25, 0, 0), bevel=0.015)
    box(f"CpSeatStrap{sx}", (0.05, 0.012, 0.5), (sx * 0.1, 0.835, 1.2), A, rot=(0.25, 0, 0))
    box(f"CpSeatHandle{sx}", (0.03, 0.18, 0.03), (sx * 0.31, 1.15, 0.72), A, bevel=0.006)
box("CpSeatBuckle", (0.09, 0.02, 0.07), (0.0, 0.875, 1.0), T, rot=(0.25, 0, 0), bevel=0.005)
box("CpHeadrest", (0.3, 0.12, 0.2), (0.0, 0.66, 1.6), I, rot=(0.25, 0, 0), bevel=0.02, segs=2)
box("CpHeadrestPad", (0.22, 0.03, 0.14), (0.0, 0.725, 1.61), D, rot=(0.25, 0, 0), bevel=0.008)
box("CpSeatPack", (0.36, 0.1, 0.4), (0.0, 0.6, 1.0), D, rot=(0.25, 0, 0), bevel=0.015)
box("CpSeatPackLight", (0.2, 0.01, 0.02), (0.0, 0.545, 1.12), M_VENT, rot=(0.25, 0, 0))

# ---- canopy interior: ribs matching the outside arches, sill lining with conduits ---------------------
for k, (y0, y1) in enumerate(((-0.64, -0.58), (0.475, 0.535), (2.19, 2.245))):
    plate(f"CpRib{k}", can, y0, y1, 0.165, 1.0, D, thick=0.03, lift=-0.08, gap=0.0, bevel=0.006, closed=True,
          astep=0.13)
for k, (y0, y1) in enumerate(((-0.42, 0.42), (0.58, 1.42), (1.48, 2.12), (2.3, 2.62))):
    plate(f"CpLining{k}", can, y0, y1, 0.0, 0.135, I, thick=0.04, lift=-0.1, gap=0.04, bevel=0.01, closed=True,
          step=0.25)
plate("CpRail", can, -0.42, 2.62, 0.135, 0.165, D, thick=0.05, lift=-0.115, gap=0.0, bevel=0.008, closed=True,
      step=0.25)
for k, a in enumerate((0.05, 0.095)):
    pts = []
    for y in (-0.38, 0.3, 1.0, 1.7, 2.3, 2.58):
        p, n, t = frame_at(can, y, a)
        pts.append(tuple(p - n * (0.125 + 0.018 * k)))
    pipe(f"CpConduit{k}", pts, 0.018 if k == 0 else 0.013, T if k == 0 else A, mirror=True, res=3)
for k, y in enumerate((0.0, 1.45, 2.2)):
    p, n, t = frame_at(can, y, 0.07)
    q = p - n * 0.13
    box(f"CpClamp{k}", (0.05, 0.05, 0.13), tuple(q), D, mirror=True, rot=(0, -math.atan2(n.z, n.x) + math.pi / 2, 0))
for k, y in enumerate((0.2, 1.0, 1.8)):
    p, n, t = frame_at(can, y, 0.15)
    box(f"CpRailLight{k}", (0.02, 0.3, 0.012), tuple(p - n * 0.12 - Vector((0, 0, 0.03))), M_SENSOR, mirror=True)
# grab handle on the front arch
top_y = 2.21
z_h = CAN.par(top_y)["t"] - 0.17
rod("CpGrip", (-0.11, top_y, z_h), (0.11, top_y, z_h), 0.014, T, segs=8)
for sx in (-1, 1):
    rod(f"CpGripPost{sx}", (sx * 0.11, top_y, z_h), (sx * 0.11, top_y, z_h + 0.09), 0.012, T, segs=8)

# ---- flight stick (pivot at its base) and throttle lever (pivot at its base) -------------------------
STICK_PIVOT = Vector((0.0, 1.67, 1.02))
THROTTLE_PIVOT = Vector((-0.55, 1.25, 1.15))
MZ = lambda p: Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, "X")  # local +Y -> world +Z
lathe("CockpitStick_boot", [(0, -0.03), (0.075, -0.03), (0.07, 0.0), (0.045, 0.05), (0.024, 0.085), (0, 0.085)],
      [D], segs=16, M=MZ(STICK_PIVOT), angle=50)
rod("CockpitStick_shaft", STICK_PIVOT + Vector((0, 0, 0.04)), STICK_PIVOT + Vector((0, -0.02, 0.2)), 0.015, T,
    segs=10)
GM_, _ = axis_M(STICK_PIVOT + Vector((0, -0.02, 0.185)), direction=(0, 0.25, 1.0))
lathe("CockpitStick_grip", [(0, 0.0), (0.03, 0.004), (0.035, 0.04), (0.033, 0.085), (0.028, 0.115), (0.014, 0.135),
                            (0, 0.138)], [I], segs=14, M=GM_, angle=50)
lathe("CockpitStick_cap", [(0, 0.125), (0.022, 0.126), (0.016, 0.142), (0, 0.145)], [D], segs=12, M=GM_)
sphere("CockpitStick_hat", tuple(GM_ @ Vector((0.0, 0.145, 0.0))), 0.011, M_SENSOR, segs=8, rings=6)
lbox("CockpitStick_trigger", GM_, (0.018, 0.04, 0.028), (0.0, 0.07, -0.035), A)
lbox("CockpitStick_button", GM_, (0.012, 0.016, 0.012), (-0.033, 0.105, 0.0), M_RED)
box("CockpitThrottle_base", (0.07, 0.1, 0.024), tuple(THROTTLE_PIVOT + Vector((0, 0, 0.002))), D, bevel=0.005)
rod("CockpitThrottle_lever", THROTTLE_PIVOT + Vector((0, 0, 0.01)), THROTTLE_PIVOT + Vector((0.0, 0.045, 0.17)),
    0.012, T, segs=8)
box("CockpitThrottle_grip", (0.055, 0.08, 0.075), tuple(THROTTLE_PIVOT + Vector((0.004, 0.06, 0.2))), I,
    rot=(-0.25, 0, 0), bevel=0.012, segs=2)
box("CockpitThrottle_band", (0.058, 0.02, 0.078), tuple(THROTTLE_PIVOT + Vector((0.004, 0.025, 0.205))), A,
    rot=(-0.25, 0, 0))
box("CockpitThrottle_btn", (0.016, 0.016, 0.008), tuple(THROTTLE_PIVOT + Vector((0.004, 0.075, 0.24))), M_SENSOR,
    rot=(-0.25, 0, 0))

# everything created above belongs to the interior
INTERIOR = [o for o in scene.objects if o.name not in _before_interior and o is not cockpit_root]
for o in INTERIOR:
    if o.parent is None:
        o.parent = cockpit_root
# =====================================================================================  stats / join / export
def tri_count(obs):
    dg = bpy.context.evaluated_depsgraph_get()
    tot = 0
    per = []
    for ob in obs:
        if ob.type not in ("MESH", "CURVE"):
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        ev.to_mesh_clear()
        tot += n
        per.append((n, ob.name))
    return tot, sorted(per, reverse=True)


tot, per = tri_count(list(scene.objects))
print("TRIS", tot)
itot, iper = tri_count(INTERIOR)
print("TRIS_INTERIOR", itot)
if os.environ.get("SHIP_DEBUG"):
    for n, nm in iper[:25]:
        print("   ", n, nm)


def pod_halfwidth(y, z):
    if y < POD.y0 or y > POD.y1:
        return -1.0
    p = POD.par(y)
    if z < p["zb"] or z > p["zt"]:
        return -1.0
    if z < p["zl"]:
        return p["bw"] + (p["w"] - p["bw"]) * (z - p["zb"]) / (p["zl"] - p["zb"])
    if z <= p["zu"]:
        return p["w"]
    return p["w"] + (p["tw"] - p["w"]) * (z - p["zu"]) / (p["zt"] - p["zu"])


def verify_interior(obs, margin=0.01):
    """Every interior vertex must lie inside the canopy dome or inside the pod hull envelope."""
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for ob in obs:
        if ob.type not in ("MESH", "CURVE"):
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ob.matrix_world @ v.co
            x = abs(p.x)
            if glass_halfwidth(p.y, p.z) - margin < x and pod_halfwidth(p.y, p.z) - margin < x:
                bad.append((ob.name, tuple(round(c, 3) for c in p)))
        ev.to_mesh_clear()
    print("INTERIOR_OUTSIDE", len(bad), bad[:12])


verify_interior(INTERIOR)
for n, nm in per[:12]:
    print("   ", n, nm)

# root
root = link(bpy.data.objects.new("Ship", None))
for ob in list(scene.objects):
    if ob is root or ob.parent is not None:
        continue
    ob.parent = root

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "ship.blend"))


def select_only(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def join(obs, name):
    select_only(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# apply all modifiers
meshes = [o for o in scene.objects if o.type in ("MESH", "CURVE")]
select_only(meshes)
bpy.ops.object.convert(target="MESH")
meshes = [o for o in scene.objects if o.type == "MESH"]
bpy.data.objects.remove(bpy.data.objects["WellCutter"], do_unlink=True)  # boolean already applied
meshes = [o for o in scene.objects if o.type == "MESH"]
interior_set = set(o.name for o in meshes if o.parent is cockpit_root)
stick_obs = [o for o in meshes if o.name.startswith("CockpitStick_")]
throttle_obs = [o for o in meshes if o.name.startswith("CockpitThrottle_")]
cp_static = [o for o in meshes if o.name in interior_set and o not in stick_obs and o not in throttle_obs]
glow_set = set(g.name for g in glows)
frame_obs = [o for o in meshes if o.name.startswith("CanopyFrame")]
glass_obs = [o for o in meshes if o.name.startswith("CanopyGlass")]
gear_parts = {g.name: [o for o in meshes if o.parent is g] for g in gears}
special = set(o.name for o in frame_obs + glass_obs) | glow_set | interior_set
for lst in gear_parts.values():
    special |= set(o.name for o in lst)
body_obs = [o for o in meshes if o.name not in special]
join(body_obs, "Body")
join(frame_obs, "CanopyFrame")
join(glass_obs, "CanopyGlass")
for gname, lst in gear_parts.items():
    join(lst, gname + "_Leg")
join(cp_static, "CockpitInteriorMesh")
for lst, nm, pivot in ((stick_obs, "CockpitStick", STICK_PIVOT), (throttle_obs, "CockpitThrottle", THROTTLE_PIVOT)):
    ob = join(lst, nm)
    ob.data.transform(Matrix.Translation(-pivot))  # origin at the pivot (the game rotates / slides it)
    ob.matrix_basis = Matrix.Translation(pivot)
for e in screen_empties:
    print("SCREEN", e.name, "loc", tuple(round(c, 4) for c in e.matrix_world.translation),
          "rot_euler_deg", tuple(round(math.degrees(a), 2) for a in e.matrix_world.to_euler()))

# dimensions
dg = bpy.context.evaluated_depsgraph_get()
lo = Vector((1e9, 1e9, 1e9))
hi = -lo
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
print("BOUNDS", tuple(round(c, 3) for c in lo), tuple(round(c, 3) for c in hi))
print("SIZE length %.2f span %.2f height %.2f" % (hi.y - lo.y, hi.x - lo.x, hi.z - lo.z))
for g in glows:
    print("GLOW", g.name, tuple(round(c, 3) for c in g.matrix_world.translation))
tot, _ = tri_count([o for o in scene.objects if o.type == "MESH"])
print("TRIS_FINAL", tot)

select_only([o for o in scene.objects])
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    use_selection=False,
)
print("EXPORTED", OUT)


# =====================================================================================  previews
def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


if PREVIEW:
    base = PREVIEW[:-4] if PREVIEW.endswith(".png") else PREVIEW
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.32, 0.36, 0.42, 1)
    bg.inputs["Strength"].default_value = 0.55
    scene.world = world
    for nm, energy, rot in (("key", 4.5, (50, 8, 35)), ("fill", 1.2, (65, -10, 210)), ("rim", 2.5, (120, 0, 160))):
        L = bpy.data.lights.new(nm, "SUN")
        L.energy = energy
        L.angle = math.radians(3)
        lo_ = link(bpy.data.objects.new(nm, L))
        lo_.rotation_euler = tuple(math.radians(v) for v in rot)
    # ground disc at pad level
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=40, segments=64)
    bmesh.ops.translate(bm, vec=Vector((0, 0, GROUND)), verts=bm.verts)
    floor = new_mesh_obj("Floor", bm, [mat("FloorMat", (0.16, 0.17, 0.19), 0.0, 0.7)])
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 48
        scene.eevee.use_shadows = True
    except Exception:
        pass
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam = link(bpy.data.objects.new("cam", cam_data))
    scene.camera = cam
    canopy_obs = [o for o in scene.objects if o.type == "MESH" and
                  (o.name.startswith("CanopyFrame") or o.name.startswith("CanopyGlass"))]

    # preview-only stand-ins for the game's canvas screens, placed on the Screen* empties
    scr_mat = mat("PreviewScreen", (0.02, 0.06, 0.08), 0.0, 0.3, emission=(0.08, 0.42, 0.55), strength=1.2)
    mock = []
    for (nm, c, rx, ry, w, h) in SCREENS:
        emp = scene.objects[nm]
        bm = bmesh.new()
        vs = [bm.verts.new(emp.matrix_world @ Vector(p)) for p in
              ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
        bm.faces.new(vs)  # normal = local -Y = towards the pilot
        mock.append(new_mesh_obj("PreviewScreen" + nm, bm, [scr_mat]))

    # previews approximate the game's look: dark nozzle throat, emissive core
    eng = next(n for n in M_ENGINE.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    eng.inputs["Base Color"].default_value = (0.02, 0.025, 0.03, 1)
    eng.inputs["Emission Strength"].default_value = 1.2
    gear_roots = [o for o in scene.objects if o.name in ("GearFront", "GearLeft", "GearRight")]

    views = [
        ("closeup", dict(loc=(5.2, 7.6, 2.4), tgt=(1.2, 1.6, 0.2), lens=32)),
        ("intake", dict(loc=(3.6, 2.6, -1.2), tgt=(2.3, -1.1, -0.1), lens=35, extra=True)),
        ("lowfront", dict(loc=(7.5, 11.0, -1.6), tgt=(0, 0, 0.2), lens=35, extra=True)),
        ("lowrear", dict(loc=(-8.0, -11.0, -1.4), tgt=(0, -1.0, 0.3), lens=35, extra=True)),
        ("gearup", dict(loc=(15, -9, -3.2), tgt=(0, -0.5, -0.2), lens=40, gearup=True)),
        ("front34", dict(loc=(12.5, 14.0, 5.5), tgt=(0, 0.3, 0.1), lens=40)),
        ("rear34", dict(loc=(-11.5, -15.0, 6.5), tgt=(0, -0.8, 0.3), lens=40)),
        ("side", dict(loc=(24, 0, 0.4), tgt=(0, 0, 0.4), ortho=15.5)),
        ("top", dict(loc=(0, 0, 25), rot=(0, 0, math.pi / 2), ortho=15.0)),
        ("bottom", dict(loc=(0, 0, -25), rot=(math.pi, 0, math.pi / 2), ortho=15.0)),
        ("front", dict(loc=(0, 25, 0.4), tgt=(0, 0, 0.4), ortho=15.5)),
        ("chase", dict(loc=(0, -23, 5.6), rot=(math.pi / 2, 0, 0), fov=70)),
        ("cockpit", dict(loc=tuple(EYE), rot=(math.pi / 2, 0, 0), fov=72, inside=True)),
        ("cockpit_down", dict(loc=tuple(EYE), rot=(math.pi / 2 - 0.42, 0, 0), fov=72, inside=True)),
        ("seat", dict(loc=(0.0, 0.32, 2.08), tgt=(0.0, 2.0, 1.12), fov=70, inside=True)),
    ]
    if os.environ.get("SHIP_DEBUG"):
        # debug: paint back faces red to catch flipped normals (the game renders single-sided)
        dbg = bpy.data.materials.new("Debug")
        dbg.use_nodes = True
        nt = dbg.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["A"].default_value = (0.6, 0.6, 0.6, 1)
        mix.inputs["B"].default_value = (1, 0, 0, 1)
        nt.links.new(geo.outputs["Backfacing"], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.3
        dbg.use_backface_culling = False
        bpy.context.view_layer.material_override = dbg
    only = os.environ.get("SHIP_VIEWS")
    for name, v in views:
        if (only and name not in only.split(",")) or (not only and v.get("extra")):
            continue
        cam.location = v["loc"]
        if "rot" in v:
            cam.rotation_euler = v["rot"]
        else:
            look_at(cam, v["tgt"])
        if "ortho" in v:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = v["ortho"]
        else:
            cam_data.type = "PERSP"
        if "fov" in v:
            cam_data.sensor_fit = "VERTICAL"
            cam_data.angle_y = math.radians(v["fov"])
            scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        elif name in ("top", "bottom"):
            cam_data.sensor_fit = "AUTO"
            scene.render.resolution_x, scene.render.resolution_y = 1100, 1100
        else:
            cam_data.sensor_fit = "AUTO"
            if "lens" in v:
                cam_data.lens = v["lens"]
            scene.render.resolution_x, scene.render.resolution_y = 1200, 800
        cam_data.clip_start = 0.05
        inside = bool(v.get("inside"))  # first-person: the game hides glass + frames and shows the screens
        for o in canopy_obs:
            o.hide_render = inside
        for o in mock:
            o.hide_render = not inside
        floor.hide_render = inside or name in ("top", "bottom", "gearup")
        for gr in gear_roots:
            gr.rotation_euler = (-1.35, 0, 0) if v.get("gearup") else (0, 0, 0)
            gr.scale = (0.35,) * 3 if v.get("gearup") else (1, 1, 1)
        scene.render.filepath = f"{base}_{name}.png"
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
