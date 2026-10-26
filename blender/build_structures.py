# Builds the planet points of interest (abandoned outposts, alien monoliths, signal beacons) and exports
# public/models/structures.glb.
# Run: Blender -b -P blender/build_structures.py -- <out.glb> [preview_dir]
#   preview_dir -> renders <preview_dir>/<model>_<view>.png (eye: 3/4 from a person's height, high: 3/4 from
#   above, close: at the interaction point, back: rear 3/4). STRUCT_ONLY=outpost_0,beacon_1 limits the models,
#   STRUCT_VIEWS=eye,high limits the views.
#
# Blender axes: +Z up, ground z = 0 at the site centre, the front (door / terminal / altar / console) faces -Y
# (the glTF exporter maps -Y to three.js +Z). Foundations and skirts reach down to z = -3 for uneven terrain.
# Every model is one root empty (outpost_0, outpost_1, monolith_0, monolith_1, beacon_0, beacon_1) with children:
#   <model>_mesh   all static geometry joined into one mesh (one glTF primitive per material)
#   Interact       empty where the player presses E (in front of the terminal / altar / console, knee height)
#   COL_*          axis-aligned box meshes in root space covering the solid parts (colliders, hidden by the game)
#   Light_<n>      empties for point lights; extras: color (hex), intensity, distance
#   Blink          beacons: empty at the lamp; its child BlinkLens (material Lamp) is the lamp glass
#   Spin           monoliths: empty on a vertical axis; its child SpinCrystal (GlyphGlow) can be rotated / bobbed
# Materials: Hull, Dark, Accent, Warm, Glow, Stone, GlyphGlow, Lamp, plus Metal (bare steel), Solar, Glass.
# Blender makes object names unique with ".001" suffixes; those are stripped from the GLB node names after export.
# Fully deterministic: every model uses its own seeded random.Random and position based noise.
import bisect
import json
import math
import os
import random
import re
import struct
import sys
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.abspath("structures.glb")
PREVIEW_DIR = argv[1] if len(argv) > 1 else None
ONLY = [s for s in os.environ.get("STRUCT_ONLY", "").split(",") if s]
VIEWS = [s for s in os.environ.get("STRUCT_VIEWS", "").split(",") if s]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COLL = scene.collection
pi = math.pi
sin, cos = math.sin, math.cos


def rad(d):
    return math.radians(d)


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
    m.use_backface_culling = True  # closed, outward facing parts: export single-sided
    return m


H = mat("Hull", (0.62, 0.60, 0.555), 0.35, 0.5)
D = mat("Dark", (0.045, 0.05, 0.058), 0.7, 0.45)
A = mat("Accent", (0.78, 0.24, 0.045), 0.25, 0.45)
WARM = mat("Warm", (0.08, 0.05, 0.02), 0.0, 0.4, emission=(1.0, 0.62, 0.30), strength=3.0)
GLOW = mat("Glow", (0.02, 0.06, 0.08), 0.0, 0.3, emission=(0.35, 0.85, 1.0), strength=3.0)
STONE = mat("Stone", (0.095, 0.09, 0.10), 0.1, 0.62)
GLYPH = mat("GlyphGlow", (0.05, 0.03, 0.08), 0.0, 0.3, emission=(0.55, 0.3, 1.0), strength=3.5)
LAMP = mat("Lamp", (0.3, 0.02, 0.01), 0.0, 0.3, emission=(1.0, 0.06, 0.03), strength=6.0)
METAL = mat("Metal", (0.50, 0.52, 0.55), 1.0, 0.33)
SOLAR = mat("Solar", (0.015, 0.03, 0.075), 0.9, 0.16)
GLASS = mat("Glass", (0.012, 0.018, 0.025), 1.0, 0.08)


# =====================================================================================  model registry
XF = [Matrix.Identity(4)]  # transform stack (component placement)
MODELS = []
CUR = None


class Model:
    def __init__(self, name):
        self.name = name
        self.obs = []  # static mesh / curve objects, joined into <name>_mesh
        self.sep = {}  # marker name -> objects that stay separate (children of that marker)
        self.cols = []  # (name, lo, hi) in root space
        self.marks = []  # (name, location, props)


def begin(name):
    global CUR
    CUR = Model(name)
    MODELS.append(CUR)
    return CUR


@contextmanager
def at(loc=(0, 0, 0), rz=0.0, M=None):
    """Place everything created inside at loc, rotated rz (radians) about +Z (or by the matrix M)."""
    m = M if M is not None else Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, "Z")
    XF.append(XF[-1] @ m)
    try:
        yield
    finally:
        XF.pop()


@contextmanager
def separate(marker):
    """Objects created inside become children of the marker empty instead of being joined."""
    n0 = len(CUR.obs)
    try:
        yield
    finally:
        CUR.sep.setdefault(marker, []).extend(CUR.obs[n0:])
        del CUR.obs[n0:]


def col(name, lo, hi):
    M = XF[-1]
    cs = [M @ Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    CUR.cols.append((name, Vector([min(c[i] for c in cs) for i in range(3)]),
                     Vector([max(c[i] for c in cs) for i in range(3)])))


def mark(name, loc, **props):
    CUR.marks.append((name, XF[-1] @ Vector(loc), props))


# =====================================================================================  basics
def link(ob):
    COLL.objects.link(ob)
    ob.matrix_world = XF[-1] @ ob.matrix_world
    if CUR is not None:
        CUR.obs.append(ob)
    return ob


def as_list(m):
    return list(m) if isinstance(m, (list, tuple)) else [m]


def new_mesh_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for m in as_list(mats):
        me.materials.append(m)
    return ob


def shade(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))


def mod_bevel(ob, width, segs=1, angle=32, harden=True):
    b = ob.modifiers.new("bevel", "BEVEL")
    b.width = width
    b.segments = segs
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(angle)
    b.harden_normals = harden
    b.use_clamp_overlap = True
    return b


def finish(bm, name, mats, angle=35, bevel=0.0, bsegs=1, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_obj(name, bm, mats)
    shade(ob, angle)
    if bevel:
        mod_bevel(ob, bevel, bsegs, angle)
    return ob


def inset(bm, faces, thick, depth=0.0, rim=None, inner=None):
    """Inset faces individually; rim faces get material index `rim`, the inner faces `inner`."""
    faces = [f for f in faces if f.is_valid]
    if not faces:
        return []
    res = bmesh.ops.inset_individual(bm, faces=faces, thickness=thick, depth=depth, use_even_offset=True)
    if rim is not None:
        for f in res["faces"]:
            f.material_index = rim
    if inner is not None:
        for f in faces:
            f.material_index = inner
    return res["faces"]


def bm_cut(bm, axis, positions):
    for p in positions:
        co = Vector((0.0, 0.0, 0.0))
        co[axis] = p
        no = Vector((0.0, 0.0, 0.0))
        no[axis] = 1.0
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)


def frange(a, b, step):
    n = max(1, int(round((b - a) / step)))
    return [a + (b - a) * k / n for k in range(1, n)]


def lathe(name, prof, mats, segs=24, M=None, segmat=None, angle=35, bevel=0.0, bsegs=1, post=None, a0=0.0,
          recalc=True):
    """Surface of revolution around local +Y: prof = [(r, t)]. post(bm, F) gets F[(segment, sector)] -> face."""
    M = M if M is not None else Matrix.Identity(4)
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new(M @ Vector((0.0, t, 0.0)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * cos(a0 + 2 * pi * j / segs), t,
                                                     r * sin(a0 + 2 * pi * j / segs)))) for j in range(segs)])
    F = {}
    for i in range(len(prof) - 1):
        P, Q = rings[i], rings[i + 1]
        if len(P) == 1 and len(Q) == 1:
            continue
        mi = segmat[i] if segmat else 0
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(P) == 1:
                vs = (P[0], Q[j], Q[j2])
            elif len(Q) == 1:
                vs = (P[j], Q[0], P[j2])
            else:
                vs = (P[j], Q[j], Q[j2], P[j2])
            f = bm.faces.new(vs)
            f.material_index = mi
            F[(i, j)] = f
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    if post:
        post(bm, F)
    ob = new_mesh_obj(name, bm, mats)
    shade(ob, angle)
    if bevel:
        mod_bevel(ob, bevel, bsegs, angle)
    return ob


RX90 = Matrix.Rotation(pi / 2, 4, "X")  # local +Y -> +Z


def lathe_z(name, prof, mats, loc=(0, 0, 0), **kw):
    """Lathe around a vertical axis through loc: prof = [(r, z)]."""
    return lathe(name, prof, mats, M=Matrix.Translation(Vector(loc)) @ RX90, **kw)


def axis_M(p0, p1=None, direction=None):
    """Matrix placing local +Y along p0 -> p1 (or along direction) with origin at p0."""
    p0 = Vector(p0)
    d = (Vector(p1) - p0) if p1 is not None else Vector(direction)
    up = "Z" if abs(d.normalized().z) < 0.99 else "X"
    q = d.normalized().to_track_quat("Y", up)
    return Matrix.Translation(p0) @ q.to_matrix().to_4x4(), d.length


def rod(name, p0, p1, r, m, segs=8, caps=True, r1=None):
    M, L = axis_M(p0, p1)
    r1 = r if r1 is None else r1
    prof = [(0, 0), (r, 0), (r1, L), (0, L)] if caps else [(r, 0), (r1, L)]
    return lathe(name, prof, [m], segs=segs, M=M, angle=50, recalc=caps)


def bar(name, p0, p1, w, t, m, up=(0, 0, 1)):
    """Rectangular beam (w across, t along `up`) from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    u = Vector(up)
    if abs(d.dot(u.normalized())) > 0.98:
        u = Vector((1, 0, 0))
    s = d.cross(u).normalized()
    u = s.cross(d).normalized()
    ring = lambda p: [p + s * (-w / 2) + u * (-t / 2), p + s * (w / 2) + u * (-t / 2),
                      p + s * (w / 2) + u * (t / 2), p + s * (-w / 2) + u * (t / 2)]
    return ringloft(name, [ring(p0), ring(p1)], m, angle=30)


def box(name, size, loc, m, rot=(0, 0, 0), bevel=0.02, segs=1, angle=30):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    M = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return finish(bm, name, m, angle, bevel, segs, recalc=False)


def boxlh(name, lo, hi, m, bevel=0.02, segs=1, angle=30):
    lo, hi = Vector(lo), Vector(hi)
    return box(name, tuple(hi - lo), tuple((lo + hi) / 2), m, bevel=bevel, segs=segs, angle=angle)


def ibox(name, size, loc, mats, rot=(0, 0, 0), face=(0, -1, 0), thick=0.05, depth=-0.02, inner=1, rim=None,
         bevel=0.0, angle=30, panels=None):
    """Box whose face(s) along `face` are inset (screens, vents, recessed panels). mats: list."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.normal_update()
    fv = Vector(face)
    fs = [f for f in bm.faces if f.normal.dot(fv) > 0.9]
    inset(bm, fs, thick, depth, rim=rim, inner=inner)
    if panels:
        ps = [f for f in bm.faces if f.normal.dot(fv) < 0.9 and f.normal.z > -0.5 and len(f.verts) == 4
              and f.calc_area() > 0.05]
        inset(bm, ps, panels[0], panels[1], rim=panels[2] if len(panels) > 2 else None)
    M = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return finish(bm, name, mats, angle, bevel, recalc=False)


def hexa(name, pts, m, bevel=0.02, segs=1, angle=30):
    """Closed 8-corner solid: pts[0:4] bottom loop, pts[4:8] matching top loop."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in pts]
    for idx in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in idx])
    return finish(bm, name, m, angle, bevel, segs)


def taper_box(name, w0, d0, w1, d1, z0, z1, m, cx=0.0, cy=0.0, bevel=0.02, angle=30):
    pts = [(cx + sx * w / 2, cy + sy * d / 2, z) for (w, d, z) in ((w0, d0, z0), (w1, d1, z1))
           for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return hexa(name, pts, m, bevel=bevel, angle=angle)


def prism(name, poly, z0, z1, m, M=None, bevel=0.015, segs=1, angle=30, post=None):
    """Extrude a 2D polygon (local XY) between local z0..z1, mapped by M."""
    M = M if M is not None else Matrix.Identity(4)
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
    bm.normal_update()
    if post:
        post(bm)
    return finish(bm, name, m, angle, bevel, segs, recalc=False)


def ringloft(name, rings, m, bevel=0.0, segs=1, angle=30, caps=True, post=None, closed=True):
    """Solid through a list of same-size 3D polygons (rings), capped at both ends."""
    bm = bmesh.new()
    vr = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(vr[0])
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    if post:
        post(bm, vr)
    return finish(bm, name, m, angle, bevel, segs, recalc=False)


def fillet(pts, radius, n=3):
    """Round the corners of a polyline with quadratic arcs."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, p, b = pts[i - 1], pts[i], pts[i + 1]
        r = min(radius, 0.45 * (a - p).length, 0.45 * (b - p).length)
        q1 = p + (a - p).normalized() * r
        q2 = p + (b - p).normalized() * r
        for k in range(n + 1):
            t = k / n
            out.append(q1 * (1 - t) ** 2 + p * 2 * t * (1 - t) + q2 * t * t)
    out.append(pts[-1])
    return out


def pipe(name, pts, r, m, res=1, kind="POLY", bend=None, smooth=True):
    if bend:
        pts = fillet(pts, bend)
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_mode = "ROUND"
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.resolution_u = 6
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
    sp.use_smooth = smooth
    cu.materials.append(m)
    return link(bpy.data.objects.new(name, cu))


def sphere(name, loc, r, m, segs=12, rings=8, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(loc)) @ Matrix.Diagonal((*scale, 1.0)), verts=bm.verts)
    return finish(bm, name, m, 80, recalc=False)


def ngon(r, n, c=(0, 0), rot=0.0):
    return [(c[0] + r * cos(rot + 2 * pi * k / n), c[1] + r * sin(rot + 2 * pi * k / n)) for k in range(n)]


def offset_loop(loop, d):
    """Miter offset of a closed 2D polygon (outwards for d > 0)."""
    n = len(loop)
    area = sum(loop[i][0] * loop[(i + 1) % n][1] - loop[(i + 1) % n][0] * loop[i][1] for i in range(n))
    s = 1.0 if area > 0 else -1.0
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(loop[i - 1]), Vector(loop[i]), Vector(loop[(i + 1) % n])
        e1 = (p1 - p0).normalized()
        e2 = (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x)) * s
        n2 = Vector((e2.y, -e2.x)) * s
        q = p1 + (n1 + n2) * (d / (1.0 + n1.dot(n2)))
        out.append((q.x, q.y))
    return out


def clip_poly(poly, axis, val, keep_ge=True):
    """Clip a closed 2D polygon to the half plane p[axis] >= val (or <= val)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        pin = (p[axis] >= val) if keep_ge else (p[axis] <= val)
        qin = (q[axis] >= val) if keep_ge else (q[axis] <= val)
        if pin:
            out.append(tuple(p))
        if pin != qin:
            t = (val - p[axis]) / (q[axis] - p[axis])
            out.append(tuple(p[k] + (q[k] - p[k]) * t for k in range(2)))
    return out


def rrect_loop(w, h, c, z0=0.0, extra_z=()):
    """Chamfered rectangle (half-width w, height h, chamfer c, bottom z0) in the XZ plane, counter-clockwise.
    extra_z adds vertices on the vertical sides (window / stripe bands)."""
    zs = sorted(set(round(z, 5) for z in extra_z if z0 + c + 0.01 < z < z0 + h - c - 0.01))
    right = [(w, z0 + c)] + [(w, z) for z in zs] + [(w, z0 + h - c)]
    left = [(-w, z) for (_, z) in right[::-1]]
    return [(-w + c, z0), (w - c, z0)] + right + [(w - c, z0 + h), (-w + c, z0 + h)] + left


def frame_ring(name, outer, inner, y0, y1, m, M=None, bevel=0.0, angle=30):
    """Closed ring solid between two XZ loops (same vertex count), extruded along local Y."""
    M = M if M is not None else Matrix.Identity(4)
    bm = bmesh.new()

    def ring(loop, y):
        return [bm.verts.new(M @ Vector((x, y, z))) for (x, z) in loop]

    o0, o1, i0, i1 = ring(outer, y0), ring(outer, y1), ring(inner, y0), ring(inner, y1)
    n = len(outer)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((o0[k], o0[j], o1[j], o1[k]))
        bm.faces.new((i0[k], i1[k], i1[j], i0[j]))
        bm.faces.new((o0[k], i0[k], i0[j], o0[j]))
        bm.faces.new((o1[k], o1[j], i1[j], i1[k]))
    return finish(bm, name, m, angle, bevel)


def hazard(name, p0, u, v, n=8, slant=0.6, lift=0.006, mats=None):
    """Hazard stripes on the plane through p0 spanned by u (length) and v (width): alternating parallelograms."""
    p0, u, v = Vector(p0), Vector(u), Vector(v)
    nrm = u.cross(v).normalized()
    L = u.length
    sk = slant * v.length / L
    bm = bmesh.new()
    for k in range(-1, n + 1):
        a, b = k / n, (k + 1) / n
        cs = [(a, 0), (b, 0), (b + sk, 1), (a + sk, 1)]
        cs = [(min(max(s, 0.0), 1.0), t) for (s, t) in cs]
        if cs[1][0] - cs[0][0] < 1e-4 and cs[2][0] - cs[3][0] < 1e-4:
            continue
        pts = [p0 + u * s + v * t + nrm * lift for (s, t) in cs]
        uniq = []
        for p in pts:
            if not uniq or (p - uniq[-1]).length > 1e-5:
                uniq.append(p)
        if len(uniq) > 2 and (uniq[0] - uniq[-1]).length < 1e-5:
            uniq.pop()
        if len(uniq) < 3:
            continue
        f = bm.faces.new([bm.verts.new(p) for p in uniq])
        f.material_index = k % 2
        f.normal_update()
        if f.normal.dot(nrm) < 0:
            f.normal_flip()
    ob = new_mesh_obj(name, bm, mats or [A, D])
    ob.data.shade_flat()
    return ob


# =====================================================================================  stone (noise)
def fbm(p, octaves=4, seed=0.0):
    p = Vector(p) + Vector((seed * 17.31, seed * 5.77, seed * 11.13))
    s, amp, tot = 0.0, 1.0, 0.0
    for _ in range(octaves):
        s += noise.noise(p) * amp
        tot += amp
        p = p * 2.03
        amp *= 0.5
    return s / tot


# =====================================================================================  common tech parts
def slab(name, poly, top, mats=(D, D), bottom=-3.0, chamfer=0.1, cell=1.6, panel=(0.03, 0.012), edge=None):
    """Foundation: polygon prism from `bottom` to `top`, chamfered top edge, top split into raised deck plates."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, bottom)) for x, y in poly]
    hi = [bm.verts.new((x, y, top)) for x, y in poly]
    bm.faces.new(lo)
    bm.faces.new(hi)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    tops = [e for e in bm.edges if all(abs(v.co.z - top) < 1e-5 for v in e.verts)]
    if chamfer:
        bmesh.ops.bevel(bm, geom=tops, offset=chamfer, segments=1, affect="EDGES", profile=0.5)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    if cell:
        bm_cut(bm, 0, frange(min(xs), max(xs), cell))
        bm_cut(bm, 1, frange(min(ys), max(ys), cell))
    bm.normal_update()
    if panel:
        fs = [f for f in bm.faces if f.normal.z > 0.99 and abs(f.calc_center_median().z - top) < 1e-3]
        inset(bm, fs, panel[0], panel[1], rim=1)
    return finish(bm, name, list(mats), 12, recalc=False)


def steps(name, x0, x1, y_edge, top, n, depth=0.42, m=D, direction=-1):
    """Stairs descending away from a deck edge at y_edge (towards -Y for direction=-1)."""
    obs = []
    for k in range(1, n):
        z = top * (n - k) / n
        ya, yb = y_edge + direction * depth * (k - 1), y_edge + direction * depth * k
        obs.append(boxlh(f"{name}{k}", (x0, min(ya, yb), -3.0), (x1, max(ya, yb), z), m, bevel=0.03))
    return obs


def hab_module(name, L, w, h, z0=0.0, c=0.5, bay=2.0, rib=0.24, win=None, win_pick=None, stripe=None,
               caps=(True, True), rng=None, unlit=0.25, rib_mat=None, legs=None, split=True):
    """Prefab module along local Y centred on the origin: chamfered shell of raised panels with dark seams,
    frame ribs, a window band (win = (z_lo, z_hi) above z0) and an accent stripe band."""
    rng = rng or random.Random(0)
    nb = max(1, round(L / bay))
    ribs = [-L / 2 + L * k / nb for k in range(nb + 1)]
    ribs[0] += rib / 2
    ribs[-1] -= rib / 2
    extra = []
    if win:
        extra += [z0 + win[0], z0 + win[1]]
    if stripe:
        extra += [z0 + stripe[0], z0 + stripe[1]]
    loop = rrect_loop(w, h, c, z0, extra)
    st = {-L / 2, L / 2}
    for y in ribs:
        st |= {y - rib / 2, y + rib / 2}
    for a, b in zip(ribs[:-1], ribs[1:]):
        if split:
            st.add((a + b) / 2)
    st = sorted(round(y, 5) for y in st)
    st = [y for y in st if -L / 2 - 1e-6 <= y <= L / 2 + 1e-6]
    rings = [[(x, y, z) for (x, z) in loop] for y in st]

    def post(bm, vr):
        panels, wins, dark, strip = [], [], [], []
        for f in bm.faces:
            cc = f.calc_center_median()
            nz = f.normal
            if abs(nz.y) > 0.9:
                continue  # caps
            if any(abs(cc.y - r) < rib / 2 for r in ribs):
                continue  # under a rib frame
            if nz.z < -0.5:
                continue
            if win and abs(nz.x) > 0.9 and z0 + win[0] < cc.z < z0 + win[1] and (win_pick is None or win_pick(cc)):
                (dark if rng.random() < unlit else wins).append(f)
            elif stripe and abs(nz.x) > 0.9 and z0 + stripe[0] < cc.z < z0 + stripe[1]:
                strip.append(f)
            else:
                panels.append(f)
        inset(bm, panels, 0.028, 0.018, rim=1)
        inset(bm, strip, 0.028, 0.018, rim=1, inner=3)
        inset(bm, wins, 0.07, -0.07, rim=1, inner=2)
        inset(bm, dark, 0.07, -0.07, rim=1, inner=4)
        capf = [f for f in bm.faces if abs(f.normal.y) > 0.9 and abs(abs(f.calc_center_median().y) - L / 2) < 1e-3]
        capf = [f for f in capf if (caps[0] and f.calc_center_median().y < 0) or (caps[1] and f.calc_center_median().y > 0)]
        inset(bm, capf, 0.16, -0.05, rim=1)
        inset(bm, capf, 0.08, 0.025, rim=1)

    obs = [ringloft(name, rings, [H, D, WARM, A, GLASS], post=post, angle=12)]
    outer = offset_loop(loop, 0.075)
    inner = offset_loop(loop, -0.03)
    for k, y in enumerate(ribs):
        e = 0.05 if k in (0, len(ribs) - 1) else 0.0
        y0 = y - rib / 2 - (e if k == 0 else 0)
        y1 = y + rib / 2 + (e if k == len(ribs) - 1 else 0)
        obs.append(frame_ring(f"{name}_rib{k}", outer, inner, y0, y1, rib_mat or D, bevel=0.018))
    if legs is not None:
        for k, y in enumerate(ribs):
            for sx in (-1, 1):
                x = sx * (w - 0.35)
                obs.append(boxlh(f"{name}_leg{k}{sx}", (x - 0.1, y - 0.1, legs), (x + 0.1, y + 0.1, z0 + 0.05), METAL,
                                 bevel=0.02))
                obs.append(boxlh(f"{name}_foot{k}{sx}", (x - 0.22, y - 0.22, legs), (x + 0.22, y + 0.22, legs + 0.07), D,
                                 bevel=0.015))
    return obs, loop


def door(name, w=1.4, h=2.3, depth=0.32, frame=0.28, light=True):
    """Airlock door in the local XZ plane at y = 0, facing -Y, sill at z = 0."""
    c = 0.32
    inner = rrect_loop(w / 2, h, c * 0.8)
    outer = rrect_loop(w / 2 + frame, h + frame, c * 1.3, -0.0)
    outer = [(x, max(z, 0.0)) for (x, z) in outer]
    frame_ring(f"{name}_frame", outer, inner, -depth, 0.04, H, bevel=0.03)
    liner = offset_loop(inner, 0.035)
    frame_ring(f"{name}_liner", liner, inner, -depth - 0.02, -depth + 0.07, A, bevel=0.0)
    # door leaves (split vertically), recessed
    for sx in (-1, 1):
        x0, x1 = (0.012, w / 2) if sx > 0 else (-w / 2, -0.012)
        poly = clip_poly(offset_loop(inner, 0.02), 0, sx * 0.012, keep_ge=sx > 0)
        Mleaf = Matrix.Translation((0, -0.02, 0)) @ RX90
        prism(f"{name}_leaf{sx}", poly, 0.0, 0.08, [D], M=Mleaf, bevel=0.012)
        # leaf details: window slot + hazard stripe
        box(f"{name}_slot{sx}", (0.12, 0.02, 0.55), (sx * 0.24, -0.105, h * 0.62), GLOW, bevel=0.0)
        hazard(f"{name}_hz{sx}", (x0, -0.105, 0.12), (x1 - x0, 0, 0), (0, 0, 0.3), n=4, slant=0.8)
    box(f"{name}_head", (w * 0.7, 0.18, 0.16), (0, -depth - 0.05, h + frame * 0.55), D, bevel=0.03)
    box(f"{name}_lamp", (w * 0.5, 0.04, 0.05), (0, -depth - 0.14, h + frame * 0.5), WARM, bevel=0.0)
    box(f"{name}_stat", (0.07, 0.04, 0.22), (w / 2 + frame * 0.55, -depth - 0.02, h * 0.5), GLOW, bevel=0.0)


def terminal(name):
    """Access terminal on a pedestal, front facing -Y, feet at z = 0. Returns the interact point."""
    box(f"{name}_base", (0.95, 0.75, 0.1), (0, 0.05, 0.05), D, bevel=0.03)
    taper_box(f"{name}_col", 0.46, 0.36, 0.36, 0.28, 0.1, 1.0, H, cy=0.06, bevel=0.03)
    box(f"{name}_band", (0.42, 0.33, 0.07), (0, 0.06, 0.78), A, bevel=0.01)
    box(f"{name}_vent", (0.25, 0.03, 0.3), (0, -0.13, 0.42), D, bevel=0.0)
    ibox(f"{name}_head", (0.92, 0.14, 0.62), (0, 0.04, 1.3), [D, GLOW, H], rot=(-0.62, 0, 0), thick=0.06,
         depth=-0.025, inner=1, rim=0, bevel=0.012)
    box(f"{name}_hood", (0.98, 0.32, 0.05), (0, 0.24, 1.58), H, rot=(-0.25, 0, 0), bevel=0.015)
    ibox(f"{name}_pad", (0.62, 0.26, 0.07), (0, -0.2, 0.98), [H, D], rot=(-0.25, 0, 0), face=(0, 0, 1),
         thick=0.03, depth=-0.012, inner=1, bevel=0.01)
    for k in range(4):
        box(f"{name}_key{k}", (0.09, 0.07, 0.02), (-0.17 + k * 0.115, -0.21, 1.0), GLOW, rot=(-0.25, 0, 0), bevel=0.0)
    for sx in (-1, 1):
        rod(f"{name}_grip{sx}", (sx * 0.5, -0.05, 1.05), (sx * 0.5, 0.15, 1.5), 0.022, METAL, segs=6)
    pipe(f"{name}_cable", [(0.1, 0.2, 0.5), (0.12, 0.45, 0.35), (0.15, 0.7, 0.02)], 0.035, D, bend=0.15)
    rod(f"{name}_ant", (0.38, 0.2, 1.5), (0.38, 0.2, 2.1), 0.012, METAL, segs=4)
    sphere(f"{name}_antb", (0.38, 0.2, 2.1), 0.03, GLOW, segs=6, rings=4)
    col(f"{name}", (-0.5, -0.35, 0.0), (0.5, 0.42, 1.6))
    return Vector((0, -1.05, 0.5))


def crate(name, size, loc, rz=0.0, m=None, rng=None):
    rng = rng or random.Random(0)
    m = m or (A if rng.random() < 0.4 else H)
    sx, sy, sz = size
    with at(loc, rz):
        ibox(name, size, (0, 0, sz / 2), [m, D], face=(0, 0, 1), thick=0.06, depth=-0.03, inner=1, bevel=0.025,
             panels=(0.07, 0.025, 1))
        for zz in (0.12, sz - 0.12):
            box(f"{name}_band{zz}", (sx + 0.04, sy + 0.04, 0.08), (0, 0, zz), D, bevel=0.012)
        col(name, (-sx / 2, -sy / 2, 0), (sx / 2, sy / 2, sz))


def barrel(name, loc, r=0.32, h=0.95, m=None, tip=None):
    m = m or A
    prof = [(0, 0), (r, 0), (r, 0.14), (r + 0.025, 0.16), (r, 0.18), (r, h - 0.18), (r + 0.025, h - 0.16),
            (r, h - 0.14), (r, h), (r - 0.07, h), (r - 0.07, h - 0.03), (0, h - 0.03)]
    segmat = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1]
    M = Matrix.Translation(Vector(loc)) @ (tip if tip is not None else Matrix.Identity(4)) @ RX90
    lathe(name, prof, [m, D], segs=12, M=M, segmat=segmat, angle=40)


def container(name, L=6.0, W=2.4, Hc=2.6, paint=None, doors_open=False):
    """Corrugated cargo container along local Y, bottom at z = 0, doors at +Y."""
    paint = paint or A
    p = 0.15
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f"{name}_post{sx}{sy}", (p, p, Hc), (sx * (W / 2 - p / 2), sy * (L / 2 - p / 2), Hc / 2), D, bevel=0)
        for zz in (p / 2, Hc - p / 2):
            box(f"{name}_rail{sx}{zz}", (p, L - 2 * p, p), (sx * (W / 2 - p / 2), 0, zz), D, bevel=0)
    for sy in (-1, 1):
        for zz in (p / 2, Hc - p / 2):
            box(f"{name}_end{sy}{zz}", (W - 2 * p, p, p), (0, sy * (L / 2 - p / 2), zz), D, bevel=0)
    # corrugated walls
    nw = int((L - 2 * p) / 0.42)
    lam = (L - 2 * p) / nw
    for sx in (-1, 1):
        xo, xi, xb = W / 2 - 0.035, W / 2 - 0.1, W / 2 - 0.14
        pts = []
        for k in range(nw):
            y = -L / 2 + p + k * lam
            pts += [(xo, y + lam * 0.08), (xo, y + lam * 0.42), (xi, y + lam * 0.58), (xi, y + lam * 0.92)]
        poly = [(xb, -L / 2 + p)] + pts + [(xb, L / 2 - p)]
        if sx < 0:
            poly = [(-x, y) for (x, y) in poly][::-1]
        prism(f"{name}_wall{sx}", poly, p, Hc - p, paint, bevel=0.0, angle=50)
    ibox(f"{name}_roof", (W - 2 * p + 0.04, L - 2 * p + 0.04, 0.08), (0, 0, Hc - 0.09), [paint, D], face=(0, 0, 1),
         thick=0.12, depth=-0.03, inner=0, rim=1)
    # front end (-Y): recessed panel with stencil stripe
    ibox(f"{name}_front", (W - 2 * p + 0.02, 0.1, Hc - 2 * p + 0.02), (0, -L / 2 + 0.1, Hc / 2), [paint, D],
         thick=0.1, depth=-0.04, inner=0, rim=1)
    box(f"{name}_stencil", (W * 0.5, 0.02, 0.22), (0, -L / 2 + 0.035, Hc * 0.72), H, bevel=0.0)
    # doors (+Y) with lock bars
    for sx in (-1, 1):
        ang = 1.9 if (doors_open and sx > 0) else 0.0
        hx = sx * (W / 2 - p)
        Md = Matrix.Translation((hx, L / 2 - 0.05, 0)) @ Matrix.Rotation(-sx * ang, 4, "Z")
        with at(M=Md):
            ibox(f"{name}_door{sx}", ((W - 2 * p) / 2 - 0.01, 0.07, Hc - 2 * p), (-sx * ((W - 2 * p) / 4), 0, Hc / 2),
                 [paint, D], face=(0, 1, 0), thick=0.1, depth=-0.025, inner=0, rim=1)
            for k in (0.3, 0.75):
                xb_ = -sx * ((W - 2 * p) / 2) * k
                rod(f"{name}_lock{sx}{k}", (xb_, 0.06, p + 0.05), (xb_, 0.06, Hc - p - 0.05), 0.025, METAL, segs=6)
                box(f"{name}_hdl{sx}{k}", (0.05, 0.08, 0.3), (xb_ - sx * 0.07, 0.08, Hc * 0.45), METAL, bevel=0.01)
    col(name, (-W / 2, -L / 2, 0), (W / 2, L / 2, Hc))


def solar_rack(name, n=3, tilt=28, pw=1.1, pl=1.75, h=0.75, broken=None):
    """Row of solar panels along local X facing -Y (tilted up), on a frame; feet at z = 0."""
    gap = 0.07
    span = n * pw + (n - 1) * gap
    for i in range(n):
        x = -span / 2 + pw / 2 + i * (pw + gap)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(pw, pl, 0.05), verts=bm.verts)
        bm_cut(bm, 0, [0.0])
        bm_cut(bm, 1, [-pl / 6, pl / 6])
        bm.normal_update()
        inset(bm, [f for f in bm.faces if f.normal.z > 0.9], 0.03, -0.008, rim=1, inner=0)
        t = rad(tilt)
        if broken is not None and i == broken:
            R = Matrix.Rotation(t + 0.5, 4, "X") @ Matrix.Rotation(0.3, 4, "Y")
            zoff = -0.25
        else:
            R = Matrix.Rotation(t, 4, "X")
            zoff = 0.0
        bmesh.ops.transform(bm, matrix=Matrix.Translation((x, 0, h + 0.45 + zoff)) @ R, verts=bm.verts)
        finish(bm, f"{name}_p{i}", [SOLAR, METAL], 30, recalc=False)
    t = rad(tilt)
    zf = h + 0.45 - sin(t) * pl * 0.4 - 0.06
    zb = h + 0.45 + sin(t) * pl * 0.4 - 0.06
    yf, yb = -cos(t) * pl * 0.4, cos(t) * pl * 0.4
    for (yy, zz) in ((yf, zf), (yb, zb)):
        box(f"{name}_beam{yy}", (span, 0.08, 0.08), (0, yy, zz), METAL, bevel=0.01)
    for x in (-span / 2 + 0.3, 0.0, span / 2 - 0.3):
        bar(f"{name}_lf{x}", (x, yf, 0), (x, yf, zf), 0.07, 0.07, D)
        bar(f"{name}_lb{x}", (x, yb, 0), (x, yb, zb), 0.07, 0.07, D)
        bar(f"{name}_br{x}", (x, yf, 0.1), (x, yb, zb - 0.1), 0.04, 0.04, METAL)
        box(f"{name}_ft{x}", (0.25, 0.25, 0.06), (x, yf, 0.03), D, bevel=0.01)
        box(f"{name}_fb{x}", (0.25, 0.25, 0.06), (x, yb, 0.03), D, bevel=0.01)
    box(f"{name}_jbox", (0.35, 0.18, 0.3), (span / 2 - 0.3, yb + 0.1, 0.45), D, bevel=0.02)
    col(name, (-span / 2, yf - 0.25, 0), (span / 2, yb + 0.3, zb + 0.4))


def dish(name, R=1.3, f=0.9, segs=18):
    """Parabolic dish, boresight along local +Y, vertex at the origin; feed horn on three struts."""
    n = 5
    tf = lambda r: r * r / (4 * f)
    tb = lambda r: tf(r) - 0.05 - 0.1 * (1 - r / R)
    prof = [(0, tb(0))] + [(R * k / n, tb(R * k / n)) for k in range(1, n + 1)] + [(R + 0.05, tf(R) + 0.015)]
    prof += [(R * k / n, tf(R * k / n) + 0.004) for k in range(n, 0, -1)] + [(0, tf(0) + 0.004)]
    segmat = [1] * n + [1] + [0] * (n + 1)
    lathe(name, prof, [H, METAL], segs=segs, segmat=segmat, angle=50)
    lathe(f"{name}_hub", [(0, -0.45), (0.22, -0.45), (0.25, -0.3), (0.25, -0.05), (0, -0.05)], [D], segs=10)
    tip = Vector((0, f * 0.92, 0))
    for k in range(3):
        a = pi / 2 + 2 * pi * k / 3
        p = Vector((R * 0.92 * cos(a), tf(R * 0.92), R * 0.92 * sin(a)))
        rod(f"{name}_strut{k}", p, tip, 0.02, METAL, segs=4)
    lathe(f"{name}_feed", [(0, f * 0.84), (0.07, f * 0.84), (0.12, f * 0.98), (0.1, f), (0, f * 0.97)], [D], segs=10)


def comm_mast(name, h=12.0, dish_R=1.3, rng=None):
    """Communications mast: equipment housing, flanged tapered tube, rungs, dish, panel antennas, guy wires."""
    rng = rng or random.Random(0)
    ibox(f"{name}_house", (1.6, 1.6, 1.15), (0, 0, 0.575), [H, D], face=(0, -1, 0), thick=0.18, depth=-0.04,
         inner=1, rim=1, bevel=0.03, panels=(0.06, 0.02, 1))
    for k in range(5):
        box(f"{name}_vent{k}", (1.1, 0.05, 0.04), (0, -0.83, 0.35 + k * 0.1), METAL, bevel=0.0)
    box(f"{name}_cap", (1.75, 1.75, 0.1), (0, 0, 1.2), D, bevel=0.03)
    prof = [(0, 1.25), (0.34, 1.25), (0.34, 1.45), (0.24, 1.5)]
    segmat = [1, 1, 1]
    z = 1.5
    for zf in [z for z in (4.0, 6.8, 9.6) if z < h - 1.5]:
        r = 0.24 - 0.1 * (zf / h)
        prof += [(r, zf - 0.08), (r + 0.06, zf - 0.04), (r + 0.06, zf + 0.04), (r, zf + 0.08)]
        segmat += [0, 1, 1, 1]
    prof += [(0.12, h), (0.16, h + 0.05), (0.16, h + 0.2), (0, h + 0.22)]
    segmat += [0, 1, 1, 1]
    lathe_z(f"{name}_tube", prof, [H, METAL], segs=10, segmat=segmat, angle=40)
    for k in range(int((h - 2.0) / 0.5)):
        zz = 1.8 + k * 0.5
        r = 0.24 - 0.1 * (zz / h)
        box(f"{name}_rung{k}", (0.32, 0.03, 0.03), (0, r + 0.13, zz), METAL, bevel=0.0)
    for sx in (-1, 1):
        rod(f"{name}_rail{sx}", (sx * 0.16, 0.36, 1.7), (sx * 0.16, 0.24, h - 1.0), 0.018, METAL, segs=4)
    # panel antennas at 3/4 height
    za = h * 0.72
    for k in range(3):
        a = rad(90 + 120 * k)
        rr = 0.24 - 0.1 * (za / h) + 0.28
        p = (rr * cos(a), rr * sin(a), za)
        box(f"{name}_pan{k}", (0.32, 0.12, 1.1), p, H, rot=(0, 0, a + pi / 2), bevel=0.03)
        rod(f"{name}_panarm{k}", (0, 0, za), p, 0.03, METAL, segs=4, caps=False)
    # dish on a yoke near the top, aimed forward and up
    zt = h - 1.1
    rod(f"{name}_arm", (0, 0, zt), (0, -0.55, zt), 0.06, D, segs=8)
    d = Vector((0.25, -0.95, 0.42)).normalized()
    with at(M=axis_M((0, -0.62, zt), direction=d)[0]):
        dish(f"{name}_dish", R=dish_R, f=dish_R * 0.7)
    for k in range(2):
        x = (-0.08, 0.1)[k]
        rod(f"{name}_whip{k}", (x, 0.05, h + 0.2), (x, 0.05, h + 2.2 + k * 0.7), 0.016, METAL, segs=4, r1=0.006)
    sphere(f"{name}_avl", (0, -0.05, h + 0.32), 0.09, LAMP, segs=8, rings=5)
    # guy wires
    for k in range(3):
        a = rad(-60 + 120 * k)
        g = Vector((3.6 * cos(a), 3.6 * sin(a), 0.0))
        rod(f"{name}_guy{k}", (0, 0, h * 0.62), g + Vector((0, 0, 0.25)), 0.012, METAL, segs=4, caps=False)
        box(f"{name}_anchor{k}", (0.45, 0.45, 0.3), (g.x, g.y, 0.12), D, bevel=0.04)
        box(f"{name}_turn{k}", (0.08, 0.08, 0.25), (g.x * 0.94, g.y * 0.94, 0.62), METAL, bevel=0.0,
            rot=(0, 0.6, a))
        col(f"{name}_anchor{k}", (g.x - 0.25, g.y - 0.25, 0), (g.x + 0.25, g.y + 0.25, 0.3))
    col(name, (-0.85, -0.85, 0), (0.85, 0.85, h))


def landing_pad(name, R=5.8, top=0.32, rng=None):
    """Circular landing pad around the local origin with skirt, hazard ring, panel deck, edge lights, markings."""
    rng = rng or random.Random(0)
    prof = [(0, -3.0), (R - 0.55, -3.0), (R - 0.55, top - 0.5), (R, top - 0.3), (R, top - 0.07), (R - 0.07, top),
            (R - 0.62, top), (R - 1.15, top), (R - 2.3, top), (R - 3.4, top), (1.1, top), (0, top)]
    segmat = [1, 1, 1, 1, 2, 3, 1, 1, 1, 1, 1]
    segs = 28

    def post(bm, F):
        hz, deck = [], []
        for (i, j), f in F.items():
            if i == 5:
                f.material_index = 3 if j % 2 == 0 else 1
            elif i in (7, 8, 9):
                deck.append(f)
            elif i == 6:
                hz.append(f)
        inset(bm, deck, 0.035, 0.022, rim=2)
        inset(bm, hz, 0.03, -0.012, rim=2)

    lathe_z(name, prof, [H, D, METAL, A], segs=segs, segmat=segmat, angle=20, post=post, a0=pi / segs)
    # central marking: hexagon ring + three chevrons pointing in
    hex_o = ngon(1.75, 6, rot=pi / 6)
    hex_i = ngon(1.45, 6, rot=pi / 6)
    frame_ring(f"{name}_hex", hex_o, hex_i, -top - 0.035, -top + 0.004, H, M=Matrix.Rotation(-pi / 2, 4, "X"))
    for k in range(3):
        a = rad(90 + 120 * k)
        u = Vector((-cos(a), -sin(a)))
        v = Vector((-sin(a), cos(a)))
        C = -u * 3.3
        pts = [(0.0, 0.7), (0.75, 0.0), (0.75, -0.35), (0.0, 0.35), (-0.75, -0.35), (-0.75, 0.0)]
        poly = [tuple(C + v * x + u * y) for (x, y) in pts]
        prism(f"{name}_chev{k}", poly, top - 0.01, top + 0.03, H, bevel=0.0, angle=10)
    for k in range(8):
        a = 2 * pi * k / 8 + pi / 16
        p = Vector(((R - 0.88) * cos(a), (R - 0.88) * sin(a), top))
        box(f"{name}_lh{k}", (0.32, 0.32, 0.08), p + Vector((0, 0, 0.02)), D, rot=(0, 0, a), bevel=0.02)
        box(f"{name}_lg{k}", (0.2, 0.2, 0.04), p + Vector((0, 0, 0.07)), GLOW, rot=(0, 0, a), bevel=0.0)
    for k in range(8):
        a = 2 * pi * k / 8
        p0 = Vector(((R - 0.8) * cos(a), (R - 0.8) * sin(a), top - 0.45))
        rod(f"{name}_leg{k}", p0, p0 + Vector((0.25 * cos(a), 0.25 * sin(a), -2.6)), 0.12, METAL, segs=6, caps=False)
    col(name, (-R * 0.72, -R * 0.72, -1.0), (R * 0.72, R * 0.72, top))
    col(f"{name}_x", (-R * 0.95, -R * 0.38, -1.0), (R * 0.95, R * 0.38, top))
    col(f"{name}_y", (-R * 0.38, -R * 0.95, -1.0), (R * 0.38, R * 0.95, top))


def flood_pole(name, h=4.2, aim=(0, -1, -0.5)):
    """Lamp post with a floodlight head; returns the head position (local)."""
    box(f"{name}_base", (0.45, 0.45, 0.25), (0, 0, 0.125), D, bevel=0.03)
    rod(f"{name}_pole", (0, 0, 0.25), (0, 0, h), 0.07, H, segs=8, r1=0.05)
    d = Vector(aim).normalized()
    head = Vector((0, 0, h)) + Vector((d.x, d.y, 0)).normalized() * 0.25
    with at(M=axis_M(head, direction=d)[0]):
        lathe(f"{name}_head", [(0, -0.25), (0.18, -0.25), (0.24, 0.0), (0.24, 0.08), (0.2, 0.1), (0, 0.1)], [D, WARM],
              segs=10, segmat=[0, 0, 0, 0, 1])
    rod(f"{name}_arm", (0, 0, h - 0.05), head, 0.04, D, segs=6)
    col(name, (-0.25, -0.25, 0), (0.25, 0.25, h))
    return head


def pipe_run(name, pts, r, m=METAL, supports=(), flanges=True, ground=0.0):
    """Industrial pipe with filleted bends, flange collars at the ends and stands at the given points."""
    pts = [Vector(p) for p in pts]
    pipe(name, pts, r, m, res=1, bend=r * 4)
    if flanges:
        for p, q in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            d = (q - p).normalized()
            rod(f"{name}_fl", p + d * 0.02, p + d * 0.14, r * 1.5, D, segs=10)
    for s in supports:
        s = Vector(s)
        rod(f"{name}_sp", (s.x, s.y, ground), (s.x, s.y, s.z - r), 0.04, D, segs=6)
        box(f"{name}_sc", (r * 3, 0.08, 0.06), (s.x, s.y, s.z - r - 0.03), D, bevel=0.0)
        box(f"{name}_sf", (0.25, 0.25, 0.05), (s.x, s.y, ground + 0.025), D, bevel=0.0)


def debris(name, rng, center, radius, n, mats=(D, H, A)):
    for k in range(n):
        a = rng.uniform(0, 2 * pi)
        d = radius * math.sqrt(rng.random())
        p = (center[0] + d * cos(a), center[1] + d * sin(a), 0.03)
        s = (rng.uniform(0.2, 0.9), rng.uniform(0.15, 0.6), rng.uniform(0.03, 0.08))
        box(f"{name}{k}", s, p, mats[k % len(mats)], rot=(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2),
                                                        rng.uniform(0, pi)), bevel=0.0)


# =====================================================================================  outposts
def hab_dome(name, R, z0, H_, segs=24, rng=None, win_ok=None, missing=3):
    """Panelled dome habitat around the local origin: base ring, low wall with a window band, raised panels,
    meridian ribs and a vented cupola."""
    rng = rng or random.Random(0)
    zw0, zw1, zw2 = z0 + 0.95, z0 + 1.75, z0 + 2.2
    Hd = H_ - zw2
    phis = [rad(v) for v in (13, 26, 39, 51, 62, 72)]
    prof = [(0, z0 - 0.05), (R + 0.24, z0 - 0.05), (R + 0.24, z0 + 0.34), (R + 0.02, z0 + 0.46), (R, zw0), (R, zw1),
            (R, zw2)]
    prof += [(R * cos(ph), zw2 + Hd * sin(ph)) for ph in phis]
    ztop = prof[-1][1]
    rtop = prof[-1][0]
    prof.append((0, ztop))
    segmat = [1, 1, 1, 0, 0, 0] + [0] * len(phis) + [1]
    miss = set(rng.sample(range(segs * 3), missing))

    def post(bm, F):
        wins, dark, panels, acc, gone = [], [], [], [], []
        for (i, j), f in F.items():
            c = f.calc_center_median()
            az = math.atan2(c.y, c.x)
            if i == 4:
                if win_ok is None or win_ok(az):
                    (dark if rng.random() < 0.3 else wins).append(f)
                else:
                    panels.append(f)
            elif i == 3:
                panels.append(f)
            elif 6 <= i < 6 + len(phis):
                k = (i - 6) * segs + j
                if i == 7 and j % 4 == 0:
                    acc.append(f)
                elif (i - 6) < 3 and k in miss:
                    gone.append(f)
                else:
                    panels.append(f)
        inset(bm, panels, 0.028, 0.022, rim=1)
        inset(bm, acc, 0.028, 0.022, rim=1, inner=3)
        inset(bm, gone, 0.05, -0.05, rim=1, inner=1)
        inset(bm, wins, 0.09, -0.07, rim=1, inner=2)
        inset(bm, dark, 0.09, -0.07, rim=1, inner=4)

    lathe_z(name, prof, [H, D, WARM, A, GLASS], segs=segs, segmat=segmat, angle=28, post=post, a0=pi / segs)
    # meridian ribs (every third sector seam)
    for k in range(0, segs, 3):
        a = -(2 * pi * k / segs + pi / segs)  # lathe_z mirrors the sector angle
        er = Vector((cos(a), sin(a), 0))
        et = Vector((-sin(a), cos(a), 0))
        path = [(R + 0.02, z0 + 0.46, Vector((1, 0, 0))), (R, zw2, Vector((1, 0, 0)))]
        for ph in [0.0] + phis:
            n2 = Vector((Hd * cos(ph), R * sin(ph))).normalized()
            path.append((R * cos(ph), zw2 + Hd * sin(ph), Vector((n2.x, 0, n2.y))))
        rings = []
        for (r, z, n) in path[1:]:
            P = er * r + Vector((0, 0, z))
            N = er * n.x + Vector((0, 0, n.z))
            rings.append([P + et * (-0.09) + N * (-0.02), P + et * 0.09 + N * (-0.02), P + et * 0.09 + N * 0.1,
                          P + et * (-0.09) + N * 0.1])
        ringloft(f"{name}_rib{k}", rings, D, bevel=0.012, angle=40)
    # cupola
    zt = ztop
    cprof = [(0, zt - 0.2), (rtop + 0.18, zt - 0.2), (rtop + 0.18, zt + 0.12), (rtop - 0.05, zt + 0.22),
             (rtop - 0.05, zt + 0.62), (rtop + 0.06, zt + 0.7), (rtop - 0.25, zt + 0.86), (0, zt + 0.9)]

    def cpost(bm, F):
        inset(bm, [f for (i, j), f in F.items() if i == 4], 0.05, -0.06, rim=1, inner=1)

    lathe_z(f"{name}_cupola", cprof, [H, D], segs=16, segmat=[1, 1, 0, 0, 0, 0, 0], angle=35, post=cpost)
    rod(f"{name}_mastlet", (0.3, 0.2, zt + 0.85), (0.3, 0.2, zt + 2.2), 0.025, METAL, segs=5, r1=0.012)
    sphere(f"{name}_tip", (0.3, 0.2, zt + 2.2), 0.05, LAMP, segs=6, rings=4)
    return ztop


def capsule_module(name, L, r, segs=20, rng=None, win_sides=(1, -1)):
    """Horizontal pressurised capsule along local Y centred on the origin (axis at z = 0)."""
    rng = rng or random.Random(0)
    nb = 3
    ys = [-L / 2 + L * k / nb for k in range(nb + 1)]
    prof = [(0, -L / 2 - 0.62 * r)]
    for k in range(1, 5):
        th = rad(90 - 22.5 * k)
        prof.append((r * sin(rad(22.5 * k)), -L / 2 - 0.62 * r * cos(rad(22.5 * k))))
    body = [-L / 2]
    for a, b in zip(ys[:-1], ys[1:]):
        body += [a + 0.14, b - 0.14, b]
    prof += [(r, y) for y in body]
    for k in range(3, -1, -1):
        prof.append((r * sin(rad(22.5 * k)), L / 2 + 0.62 * r * cos(rad(22.5 * k))))
    segmat = [0] * (len(prof) - 1)

    def post(bm, F):
        wins, dark, panels = [], [], []
        for (i, j), f in F.items():
            c = f.calc_center_median()
            if not (-L / 2 + 0.01 < c.y < L / 2 - 0.01):
                continue
            if any(abs(c.y - y) < 0.14 for y in ys):
                continue
            ca = c.x / max(1e-6, math.hypot(c.x, c.z))
            if abs(c.z) < r * 0.3 and any(ca * s > 0.85 for s in win_sides):
                (dark if rng.random() < 0.3 else wins).append(f)
            elif c.z > -r * 0.5:
                panels.append(f)
        inset(bm, panels, 0.025, 0.02, rim=1)
        inset(bm, wins, 0.06, -0.06, rim=1, inner=2)
        inset(bm, dark, 0.06, -0.06, rim=1, inner=3)

    lathe(name, prof, [H, D, WARM, GLASS], segs=segs, segmat=segmat, angle=30, post=post, a0=pi / segs)
    for k, y in enumerate(ys):
        rp = [(r - 0.03, y - 0.13), (r + 0.07, y - 0.1), (r + 0.07, y + 0.1), (r - 0.03, y + 0.13), (r - 0.03, y - 0.13)]
        lathe(f"{name}_rib{k}", rp, [D], segs=segs, angle=40, a0=pi / segs)
    # end hatch
    lathe(f"{name}_hatch", [(0, L / 2 + 0.62 * r + 0.02), (0.42, L / 2 + 0.62 * r - 0.05),
                            (0.5, L / 2 + 0.62 * r - 0.25), (0, L / 2 + 0.62 * r - 0.25)], [D], segs=12)


def build_outpost_0():
    begin("outpost_0")
    rng = random.Random(1001)
    FT = 0.4
    DC = Vector((-3.2, 3.0, 0))
    R = 5.0
    # --- foundations
    slab("o0_slab", ngon(6.4, 8, DC, rot=pi / 8), FT)
    slab("o0_slabA", [(-12.6, -1.4), (-8.6, -1.4), (-8.6, 8.4), (-12.6, 8.4)], FT - 0.05, cell=1.4)
    yd = DC.y - R - 2.4  # door plane
    slab("o0_deck", [(DC.x - 2.3, yd - 1.7), (DC.x + 3.6, yd - 1.7), (DC.x + 3.6, DC.y - 4.0), (DC.x - 2.3, DC.y - 4.0)],
         FT, cell=1.2)
    steps("o0_step", DC.x - 2.3, DC.x + 3.6, yd - 1.7, FT, 2)
    hazard("o0_hzdeck", (DC.x - 2.3, yd - 1.72, FT - 0.2), (5.9, 0, 0), (0, 0, 0.1), n=22, slant=1.2)
    col("slab_a", (DC.x - 6.0, DC.y - 2.5, -3), (DC.x + 6.0, DC.y + 2.5, FT))
    col("slab_b", (DC.x - 2.5, DC.y - 6.0, -3), (DC.x + 2.5, DC.y + 6.0, FT))
    col("slab_c", (DC.x - 4.5, DC.y - 4.5, -3), (DC.x + 4.5, DC.y + 4.5, FT))
    col("slab_m", (-12.6, -1.4, -3), (-8.6, 8.4, FT - 0.05))
    col("deck", (DC.x - 2.3, yd - 1.7, -3), (DC.x + 3.6, DC.y - 4.0, FT))
    col("step", (DC.x - 2.3, yd - 2.12, -3), (DC.x + 3.6, yd - 1.7, FT / 2))
    # --- main dome
    with at(DC):
        def win_ok(az):
            d = math.degrees(az)
            return not (-112 < d < -68) and not (165 < abs(d)) and not (40 < d < 140)
        ztop = hab_dome("o0_dome", R, FT, 6.3, rng=rng, win_ok=win_ok)
        col("dome", (-3.9, -3.9, 0), (3.9, 3.9, ztop))
        col("dome_x", (-R - 0.2, -2.1, 0), (R + 0.2, 2.1, FT + 2.4))
        col("dome_y", (-2.1, -R - 0.2, 0), (2.1, R + 0.2, FT + 2.4))
    # wall lamps above the windows, a vent unit at the back, small dish on the capsule
    for k, th in enumerate((rad(-40), rad(-145), rad(10))):
        er = Vector((cos(th), sin(th), 0))
        p = DC + er * (R + 0.1) + Vector((0, 0, FT + 2.02))
        box(f"o0_wl{k}", (0.36, 0.22, 0.14), p, D, rot=(0, 0, th + pi / 2), bevel=0.02)
        box(f"o0_wlg{k}", (0.28, 0.16, 0.02), p + Vector((0, 0, -0.075)) + er * 0.02, WARM, rot=(0, 0, th + pi / 2),
            bevel=0.0)
    with at(DC + Vector((1.2, R + 0.55, 0)), rz=0.0):
        ibox("o0_vent", (1.6, 0.9, 1.0), (0, 0, FT + 0.5), [H, D], face=(0, 1, 0), thick=0.1, depth=-0.06, inner=1,
             bevel=0.03, panels=(0.05, 0.015, 1))
        for k in range(5):
            box(f"o0_vslat{k}", (1.3, 0.04, 0.05), (0, 0.42, FT + 0.2 + k * 0.15), METAL, rot=(0.5, 0, 0), bevel=0.0)
        col("vent", (-0.8, -0.45, 0), (0.8, 0.45, FT + 1.0))
    with at((-10.6, 5.6, FT + 0.35 + 1.55 + 1.5)):
        rod("o0_cmast", (0, 0, 0), (0, 0, 0.9), 0.05, D, segs=6)
        with at(M=axis_M((0, -0.1, 0.9), direction=(0.3, -0.6, 0.75))[0]):
            dish("o0_cdish", R=0.5, f=0.35, segs=14)
        rod("o0_cwhip", (0.15, 0.1, 0.0), (0.15, 0.1, 2.2), 0.014, METAL, segs=4, r1=0.006)
    # --- airlock tunnel + door
    L_al = (DC.y - R + 1.2) - yd
    with at((DC.x, (yd + DC.y - R + 1.2) / 2, 0)):
        hab_module("o0_airlock", L_al, 1.45, 3.0, z0=FT, c=0.5, bay=L_al / 2, win=None, stripe=(2.05, 2.35),
                   caps=(False, False))
    with at((DC.x, yd - 0.05, FT)):
        door("o0_door", w=1.5, h=2.25)
    col("airlock", (DC.x - 1.55, yd - 0.4, 0), (DC.x + 1.55, DC.y - 3.5, FT + 3.1))
    mark("Light_0", (DC.x, yd - 0.9, FT + 3.0), color="#ffc890", intensity=60.0, distance=22.0)
    # --- terminal by the door
    tpos = Vector((DC.x + 2.4, yd - 0.75, FT))
    with at(tpos):
        ip = terminal("o0_term")
        mark("Interact", ip)
    pipe("o0_tcable", [(tpos.x + 0.15, tpos.y + 0.7, FT + 0.02), (tpos.x + 0.15, yd + 0.3, FT + 0.02),
                       (DC.x + 1.55, yd + 0.3, FT + 0.02), (DC.x + 1.5, yd + 0.3, FT + 1.2)], 0.035, D, bend=0.2)
    # --- side capsule module (left)
    cz = FT + 0.35 + 1.55
    with at((-10.6, 3.4, cz)):
        capsule_module("o0_capsule", 6.4, 1.55, rng=rng, win_sides=(-1,))
    for y in (1.0, 5.8):
        arc = [(1.58 * cos(rad(a)), 1.58 * sin(rad(a))) for a in range(-30, -151, -15)]
        poly = [(1.35, -1.55 - 0.35), (1.35, -0.7)] + arc + [(-1.35, -0.7), (-1.35, -1.55 - 0.35)]
        with at(M=Matrix.Translation((-10.6, y, cz)) @ RX90):
            prism(f"o0_cradle{y}", poly, -0.18, 0.18, D, bevel=0.03)
    with at(M=axis_M((DC.x - R + 0.4, DC.y + 0.4, FT + 1.75), (-10.6 + 0.8, DC.y + 0.4, FT + 1.75))[0]):
        Lc = (DC.x - R + 0.4) - (-10.6 + 0.8)
        lathe("o0_conn", [(0, 0), (0.85, 0), (0.85, 0.25), (0.75, 0.3), (0.75, Lc - 0.3), (0.85, Lc - 0.25),
                          (0.85, Lc), (0, Lc)], [H, D], segs=14, segmat=[1, 1, 1, 0, 1, 1, 1], angle=35)
    col("capsule", (-12.2, -0.2, 0), (-9.0, 7.0, cz + 1.6))
    col("conn", (-9.4, DC.y - 0.6, 0), (DC.x - R + 0.6, DC.y + 1.4, FT + 2.7))
    # --- generator / storage module (back right)
    GC = Vector((3.6, 7.3, 0))
    slab("o0_slabG", [(GC.x - 2.9, GC.y - 2.2), (GC.x + 2.9, GC.y - 2.2), (GC.x + 2.9, GC.y + 2.2),
                      (GC.x - 2.9, GC.y + 2.2)], FT - 0.1, cell=1.4)
    with at(GC, rz=pi / 2):
        hab_module("o0_gen", 4.6, 1.5, 2.6, z0=FT - 0.1, c=0.45, bay=2.3, win=(1.0, 1.6),
                   win_pick=lambda c: c.x < 0, stripe=(1.75, 1.95), rng=rng)
    zr = FT - 0.1 + 2.6
    for k in range(9):
        box(f"o0_fin{k}", (0.05, 1.5, 0.55), (GC.x - 1.4 + k * 0.16, GC.y + 0.2, zr + 0.3), METAL, bevel=0.0)
    box("o0_finbase", (1.6, 1.7, 0.08), (GC.x - 0.76, GC.y + 0.2, zr + 0.03), D, bevel=0.01)
    lathe_z("o0_stack", [(0, zr), (0.3, zr), (0.3, zr + 0.25), (0.2, zr + 0.3), (0.2, zr + 1.6), (0.26, zr + 1.65),
                         (0.26, zr + 1.85), (0.17, zr + 1.85), (0.17, zr + 1.7), (0, zr + 1.7)], [D], segs=10,
            loc=(GC.x + 1.4, GC.y - 0.5, 0))
    for k in range(2):
        lathe_z(f"o0_fan{k}", [(0, zr), (0.48, zr), (0.48, zr + 0.3), (0.42, zr + 0.3), (0.42, zr + 0.22),
                               (0, zr + 0.22)], [H], segs=14, loc=(GC.x + 0.6, GC.y + (0.9 if k == 0 else -0.2), 0))
    col("gen", (GC.x - 2.4, GC.y - 1.6, 0), (GC.x + 2.4, GC.y + 1.6, zr + 0.8))
    col("slab_g", (GC.x - 2.9, GC.y - 2.2, -3), (GC.x + 2.9, GC.y + 2.2, FT - 0.1))
    # pipes generator -> dome
    pipe_run("o0_pipe0", [(GC.x - 2.35, GC.y - 0.8, FT + 0.9), (GC.x - 3.2, GC.y - 0.8, FT + 0.9),
                          (DC.x + 3.6, DC.y + 2.6, FT + 0.9), (DC.x + 3.25, DC.y + 2.35, FT + 1.4)], 0.11,
             supports=[(GC.x - 3.0, GC.y - 0.8, FT + 0.9)], ground=FT)
    pipe_run("o0_pipe1", [(GC.x - 2.35, GC.y - 1.15, FT + 0.55), (GC.x - 3.5, GC.y - 1.15, FT + 0.55),
                          (DC.x + 3.4, DC.y + 2.05, FT + 0.55), (DC.x + 3.05, DC.y + 1.85, FT + 0.9)], 0.08, m=A,
             supports=[(GC.x - 3.3, GC.y - 1.15, FT + 0.55)], ground=FT)
    # --- comms mast (back right)
    with at((9.0, 6.6, 0)):
        comm_mast("o0_mast", h=12.5, dish_R=1.35, rng=rng)
    pipe("o0_mcable", [(GC.x + 2.4, GC.y + 0.9, FT + 0.3), (7.6, 7.2, 0.15), (8.2, 6.6, 0.15), (8.2, 6.6, 0.5)],
         0.05, D, bend=0.4)
    # --- solar racks (right)
    for k, y in enumerate((0.0, 2.6)):
        with at((8.6, y, 0)):
            solar_rack(f"o0_solar{k}", n=3, broken=(1 if k == 1 else None))
    pipe("o0_scable", [(10.0, 3.6, 0.05), (10.0, 4.6, 0.05), (GC.x + 2.5, 5.8, 0.05), (GC.x + 2.5, 5.8, 0.6)], 0.045, D,
         bend=0.4)
    # --- landing pad (front right) with flood light and fuel post
    PC = Vector((6.4, -8.2, 0))
    with at(PC):
        landing_pad("o0_pad", R=5.8, top=0.32, rng=rng)
    with at((0.6, -13.0, 0), rz=rad(-35)):
        head = flood_pole("o0_flood", 4.4, aim=(0.0, 1.0, -0.6))
        mark("Light_1", head + Vector((0, 0.5, -0.3)), color="#cfe6ff", intensity=45.0, distance=20.0)
    with at((PC.x - 5.2, PC.y + 3.4, 0), rz=rad(30)):
        ibox("o0_fuel", (0.7, 0.5, 1.3), (0, 0, 0.65), [A, D], thick=0.08, depth=-0.03, inner=1, bevel=0.03)
        box("o0_fuelg", (0.3, 0.03, 0.12), (0, -0.27, 1.0), GLOW, bevel=0.0)
        pipe("o0_hose", [(0.3, -0.1, 0.9), (0.6, -0.4, 0.5), (0.9, -0.5, 0.05), (1.6, -0.2, 0.05)], 0.04, D,
             kind="BEZIER")
        col("fuel", (-0.35, -0.25, 0), (0.35, 0.25, 1.3))
    # --- cargo (front left)
    with at((-9.8, -6.4, 0), rz=rad(8)):
        container("o0_cont0", L=5.6, W=2.3, Hc=2.5, paint=A)
    with at((-9.6, -6.0, 2.5), rz=rad(-4)):
        container("o0_cont1", L=5.6, W=2.3, Hc=2.5, paint=H, doors_open=True)
    with at((-6.0, -9.2, 0), rz=rad(70)):
        container("o0_cont2", L=4.2, W=2.2, Hc=2.4, paint=H)
    crate("o0_crate0", (1.2, 1.0, 0.9), (-6.6, -5.0, 0), rz=0.3, rng=rng)
    crate("o0_crate1", (1.0, 1.0, 0.8), (-6.4, -5.1, 0.9), rz=0.6, rng=rng)
    crate("o0_crate2", (1.3, 0.9, 0.7), (-7.6, -3.4, 0), rz=-0.2, rng=rng)
    crate("o0_crate3", (0.9, 0.9, 0.9), (1.8, 9.9, 0), rz=0.4, rng=rng)
    barrel("o0_bar0", (-5.2, -6.6, 0), m=A)
    barrel("o0_bar1", (-4.6, -6.1, 0), m=H)
    barrel("o0_bar2", (-7.2, -7.6, 0.32), m=A, tip=Matrix.Rotation(pi / 2, 4, "X") @ Matrix.Rotation(0.4, 4, "Z"))
    col("barrels", (-5.6, -7.0, 0), (-4.2, -5.7, 1.0))
    debris("o0_deb", rng, (-1.0, -9.5), 3.0, 6)
    debris("o0_deb2", rng, (10.0, -1.5), 1.6, 4)
    mark("Light_2", (DC.x - 4.6, DC.y - 3.5, FT + 2.6), color="#ffb070", intensity=25.0, distance=14.0)


# =====================================================================================  outpost 1 (prefab)
def build_outpost_1():
    begin("outpost_1")
    rng = random.Random(2002)
    FT = 0.4
    # deck under the modules
    deck = [(-9.5, -0.6), (8.6, -0.6), (8.6, 9.6), (-9.5, 9.6)]
    slab("o1_deck", deck, FT, cell=1.5)
    col("deck", (-9.5, -0.6, -3), (8.6, 9.6, FT))
    # main module along X (back), raised on legs
    Z0 = FT + 0.5
    MC = Vector((-1.6, 5.8, 0))
    with at(MC, rz=pi / 2):
        hab_module("o1_main", 10.0, 2.0, 3.3, z0=Z0, c=0.55, bay=2.0, win=(1.15, 2.0), stripe=(2.35, 2.6), rng=rng,
                   legs=FT, split=False)
    col("main", (MC.x - 5.1, MC.y - 2.1, 0), (MC.x + 5.1, MC.y + 2.1, Z0 + 3.3))
    # side module along Y (right), forming an L
    SC = Vector((5.9, 4.6, 0))
    with at(SC):
        hab_module("o1_side", 7.6, 1.7, 3.0, z0=Z0, c=0.5, bay=1.9, win=(1.1, 1.85), stripe=(2.15, 2.35),
                   win_pick=lambda c: c.y < 1.5, rng=rng, legs=FT, split=False)
    col("side", (SC.x - 1.8, SC.y - 3.85, 0), (SC.x + 1.8, SC.y + 3.85, Z0 + 3.0))
    # connector between them
    with at((SC.x - 2.6, 5.8, 0), rz=pi / 2):
        hab_module("o1_link", 1.8, 1.0, 2.6, z0=Z0 + 0.2, c=0.35, bay=0.9, caps=(False, False), rng=rng)
    # airlock vestibule in front of the main module, door facing -Y
    VC = Vector((-2.6, 2.4, 0))
    with at(VC):
        hab_module("o1_vest", 3.2, 1.4, 3.0, z0=FT, c=0.45, bay=1.6, stripe=(2.0, 2.3), caps=(False, True), rng=rng)
    yd = VC.y - 1.6
    with at((VC.x, yd - 0.04, FT)):
        door("o1_door", w=1.5, h=2.3)
    col("vest", (VC.x - 1.5, yd - 0.4, 0), (VC.x + 1.5, VC.y + 1.6, FT + 3.0))
    mark("Light_0", (VC.x, yd - 0.9, FT + 3.0), color="#ffc890", intensity=60.0, distance=22.0)
    # front apron + steps
    slab("o1_apron", [(-6.2, -2.6), (1.4, -2.6), (1.4, -0.4), (-6.2, -0.4)], FT, cell=1.3)
    steps("o1_steps", -6.2, 1.4, -2.6, FT, 2)
    hazard("o1_hz", (-6.2, -2.62, FT - 0.2), (7.6, 0, 0), (0, 0, 0.1), n=28, slant=1.2)
    col("apron", (-6.2, -2.6, -3), (1.4, -0.4, FT))
    col("steps", (-6.2, -3.02, -3), (1.4, -2.6, FT / 2))
    tpos = Vector((VC.x + 2.3, yd - 0.9, FT))
    with at(tpos):
        ip = terminal("o1_term")
        mark("Interact", ip)
    # observation cupola on the main module roof
    zr = Z0 + 3.3
    cx, cy = MC.x - 2.6, MC.y
    lathe_z("o1_cupbase", [(0, zr - 0.1), (1.35, zr - 0.1), (1.35, zr + 0.2), (1.2, zr + 0.3), (0, zr + 0.3)], [D],
            segs=20, loc=(cx, cy, 0))
    gp = [(1.15, zr + 0.3)] + [(1.15 * cos(rad(a)), zr + 0.3 + 1.0 * sin(rad(a))) for a in (20, 40, 60, 78)] + [
        (0, zr + 1.32)]
    gp = [(0, zr + 0.3)] + gp

    def gpost(bm, F):
        fs = [f for (i, j), f in F.items() if 1 <= i <= 4]
        inset(bm, fs, 0.06, -0.02, rim=1, inner=0)

    lathe_z("o1_cupglass", gp, [GLASS, H], segs=12, segmat=[1, 0, 0, 0, 0, 1], angle=25, post=gpost, loc=(cx, cy, 0))
    # roof greebles: AC units, vents, antenna, solar on side module
    for k, x in enumerate((MC.x + 0.4, MC.x + 2.6)):
        ibox(f"o1_ac{k}", (1.3, 1.1, 0.55), (x, MC.y + 0.3, zr + 0.27), [H, D], face=(0, 0, 1), thick=0.1, depth=-0.06,
             inner=1, bevel=0.03, panels=(0.05, 0.015, 1))
        lathe_z(f"o1_acfan{k}", [(0, zr + 0.5), (0.38, zr + 0.5), (0.38, zr + 0.6), (0.32, zr + 0.6),
                                 (0.32, zr + 0.55), (0, zr + 0.55)], [D], segs=12, loc=(x, MC.y + 0.3, 0))
    for k in range(3):
        box(f"o1_vent{k}", (0.5, 0.35, 0.25), (MC.x + 4.0, MC.y - 1.0 + k * 0.6, zr + 0.12), D, bevel=0.03)
    rod("o1_ant", (MC.x + 4.2, MC.y + 1.2, zr), (MC.x + 4.2, MC.y + 1.2, zr + 3.5), 0.03, METAL, segs=5, r1=0.01)
    sphere("o1_anttip", (MC.x + 4.2, MC.y + 1.2, zr + 3.5), 0.05, LAMP, segs=6, rings=4)
    with at((SC.x, SC.y - 0.6, Z0 + 3.0 - 0.75 + 0.05)):
        solar_rack("o1_roofsolar", n=2, tilt=20, h=0.15)
    # comms mast: lattice tripod at back left
    with at((-8.0, 9.0 + 2.0, 0)):
        comm_mast("o1_mast", h=11.0, dish_R=1.2, rng=rng)
    # fuel tank on saddles (left)
    TC = Vector((-8.0, 3.6, 0))
    with at(TC):
        lathe("o1_tank", [(0, -2.6), (0.7, -2.5), (1.05, -2.2), (1.15, -1.8), (1.15, -1.6), (1.22, -1.55),
                          (1.22, -1.4), (1.15, -1.35), (1.15, 1.35), (1.22, 1.4), (1.22, 1.55), (1.15, 1.6),
                          (1.15, 1.8), (1.05, 2.2), (0.7, 2.5), (0, 2.6)],
              [H, D], segs=18, segmat=[0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0],
              M=Matrix.Translation((0, 0, FT + 1.65)), angle=35)
        for y in (-1.2, 1.2):
            arc = [(1.2 * cos(rad(a)), 1.25 + 1.2 * sin(rad(a))) for a in range(-25, -160, -15)]
            poly = [(1.0, 0.0), (1.0, 0.7)] + arc + [(-1.0, 0.7), (-1.0, 0.0)]
            with at(M=Matrix.Translation((0, y, FT)) @ RX90):
                prism(f"o1_saddle{y}", poly, -0.15, 0.15, D, bevel=0.03)
        hazard("o1_tankhz", (-1.165, 0.6, FT + 1.75), (0, -1.2, 0), (0, 0, 0.3), n=5, slant=0.8)
        box("o1_tankplate", (0.04, 0.9, 0.45), (-1.16, 0.0, FT + 1.3), H, bevel=0.0)
        col("tank", (-1.25, -2.6, 0), (1.25, 2.6, FT + 2.9))
    pipe_run("o1_tpipe", [(TC.x + 0.3, TC.y + 2.3, FT + 1.9), (TC.x + 0.3, TC.y + 3.0, FT + 1.9),
                          (MC.x - 4.6, MC.y - 1.3, FT + 1.9)], 0.1, supports=[(TC.x + 0.3, TC.y + 2.9, FT + 1.9)],
             ground=FT)
    pipe_run("o1_tpipe2", [(TC.x + 0.9, TC.y - 1.0, FT + 1.1), (VC.x - 1.42, TC.y - 1.0, FT + 1.1),
                           (VC.x - 1.42, VC.y - 0.4, FT + 1.1)], 0.07, m=A,
             supports=[(TC.x + 2.4, TC.y - 1.0, FT + 1.1)], ground=FT)
    # landing pad (front left)
    PC = Vector((-4.6, -9.2, 0))
    with at(PC):
        landing_pad("o1_pad", R=5.8, top=0.32, rng=rng)
    with at((2.4, -11.6, 0), rz=rad(40)):
        head = flood_pole("o1_flood", 4.4, aim=(0.0, 1.0, -0.6))
        mark("Light_1", head + Vector((0, 0.5, -0.3)), color="#cfe6ff", intensity=45.0, distance=20.0)
    # cargo + solar field (front right)
    with at((7.0, -4.6, 0), rz=rad(-6)):
        container("o1_cont0", L=5.6, W=2.3, Hc=2.5, paint=H)
    with at((4.2, -6.2, 0), rz=rad(84)):
        container("o1_cont1", L=4.4, W=2.2, Hc=2.4, paint=A, doors_open=True)
    for k, y in enumerate((-9.6, -12.2)):
        with at((8.0, y, 0)):
            solar_rack(f"o1_solar{k}", n=3, broken=(2 if k == 0 else None))
    pipe("o1_scable", [(9.6, -9.2, 0.05), (10.2, -9.0, 0.05), (10.2, -2.0, 0.05), (8.6, -0.4, 0.3)], 0.045, D,
         bend=0.5)
    crate("o1_crate0", (1.1, 1.0, 0.9), (3.0, -2.6, 0), rz=0.2, rng=rng)
    crate("o1_crate1", (0.9, 0.9, 0.7), (3.6, -1.6, 0), rz=-0.4, rng=rng)
    crate("o1_crate2", (1.0, 0.8, 0.8), (3.1, -2.5, 0.9), rz=0.5, rng=rng)
    barrel("o1_bar0", (-7.6, -1.4, 0), m=A)
    barrel("o1_bar1", (-8.3, -1.1, 0), m=A)
    barrel("o1_bar2", (-7.9, -2.1, 0), m=H)
    col("barrels", (-8.7, -2.5, 0), (-7.2, -0.7, 1.0))
    # railing along the deck back edge
    for k in range(12):
        x = -9.3 + k * 1.6
        rod(f"o1_post{k}", (x, 9.45, FT), (x, 9.45, FT + 1.05), 0.03, METAL, segs=5)
    pipe("o1_rail", [(-9.3, 9.45, FT + 1.05), (8.3, 9.45, FT + 1.05)], 0.03, METAL)
    pipe("o1_rail2", [(-9.3, 9.45, FT + 0.55), (8.3, 9.45, FT + 0.55)], 0.022, METAL)
    debris("o1_deb", rng, (0.0, -6.0), 2.5, 5)
    mark("Light_2", (SC.x - 1.9, SC.y - 2.8, Z0 + 2.4), color="#ffb070", intensity=25.0, distance=14.0)


# =====================================================================================  alien stone
class Acc:
    """Accumulates many small solids (glyph strokes, slabs, rubble) in one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()

    def quad_solid(self, a, b, mi=0):
        """Closed solid between two 4-point rings."""
        M = XF[-1]  # strokes added inside at(...) follow the placement
        A_ = [self.bm.verts.new(M @ Vector(p)) for p in a]
        B_ = [self.bm.verts.new(M @ Vector(p)) for p in b]
        fs = [self.bm.faces.new((A_[3], A_[2], A_[1], A_[0])), self.bm.faces.new((B_[0], B_[1], B_[2], B_[3]))]
        fs += [self.bm.faces.new((A_[i], A_[(i + 1) % 4], B_[(i + 1) % 4], B_[i])) for i in range(4)]
        for f in fs:
            f.material_index = mi
        return fs

    def bar(self, p0, p1, w, t, up, mi=0, ext=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0).normalized()
        p0, p1 = p0 - d * ext, p1 + d * ext
        u = Vector(up).normalized()
        s = d.cross(u).normalized()
        u = s.cross(d).normalized()
        ring = lambda p: [p + s * (sx * w / 2) + u * (uz * t / 2) for (sx, uz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return self.quad_solid(ring(p0), ring(p1), mi)

    def done(self, name, mats, angle=30):
        return finish(self.bm, name, mats, angle)


def make_glyph(rng, cols=3, rows=4):
    """A rune: a short random walk on a node grid (orthogonal moves preferred), often mirrored."""
    segs = set()
    c, r = rng.randrange(cols), rng.randrange(rows)
    for _ in range(rng.randint(3, 5)):
        moves = [(dc, dr) for dc in (-1, 0, 1) for dr in (-1, 0, 1) if (dc or dr)]
        moves = [m for m in moves if 0 <= c + m[0] < cols and 0 <= r + m[1] < rows]
        w = [3 if (m[0] == 0 or m[1] == 0) else 1 for m in moves]
        dc, dr = rng.choices(moves, weights=w)[0]
        segs.add(tuple(sorted(((c, r), (c + dc, r + dr)))))
        c, r = c + dc, r + dr
    if rng.random() < 0.55:
        for (a, b) in list(segs):
            segs.add(tuple(sorted(((cols - 1 - a[0], a[1]), (cols - 1 - b[0], b[1])))))
    if rng.random() < 0.35:
        cc, rr = rng.randrange(cols), rng.choice((0, rows - 1))
        segs.add(((cc, rr), (cc, rr)))  # dot
    return list(segs)


def glyph_into(acc, rng, O, U, V, N, gw, gh, w=0.045, t=0.04, mi=0, cols=3, rows=4):
    """Place one rune centred at O on the plane (U right, V up, N out); size gw x gh."""
    def P(c, r):
        return O + U * ((c / (cols - 1) - 0.5) * gw) + V * ((0.5 - r / (rows - 1)) * gh)
    for (a, b) in make_glyph(rng, cols, rows):
        if a == b:
            p = P(*a)
            acc.bar(p - V * w * 0.8, p + V * w * 0.8, w * 1.3, t, N, mi)
        else:
            acc.bar(P(*a), P(*b), w, t, N, mi, ext=w / 2)


def glyph_ring(acc, O, U, V, N, r, w=0.05, t=0.04, n=20, mi=0, gaps=()):
    for k in range(n):
        if k in gaps:
            continue
        a0, a1 = 2 * pi * k / n, 2 * pi * (k + 0.82) / n
        acc.bar(O + (U * cos(a0) + V * sin(a0)) * r, O + (U * cos(a1) + V * sin(a1)) * r, w, t, N, mi)


def stone_disp(bm, verts, amp=0.03, chip=0.06, seed=0.0, big=0.06, scale=1.0):
    """Erode: low / mid / fine noise along the vertex normals, extra chipping on edge vertices."""
    bm.normal_update()
    moves = []
    for v in verts:
        p = v.co.copy()
        n = v.normal.copy()
        d = big * fbm(p * 0.33 * scale, 2, seed) + amp * fbm(p * 1.25 * scale, 3, seed + 1.3) \
            + amp * 0.45 * fbm(p * 3.7 * scale, 2, seed + 2.1)
        if chip and max(abs(n.x), abs(n.y), abs(n.z)) < 0.94:
            d -= chip * max(0.0, fbm(p * 2.0 * scale, 3, seed + 4.4) * 2.2 + 0.25)
        moves.append((v, p + n * d))
    for v, q in moves:
        v.co = q


def stone_column(name, sec, z0, z1, rng, dz=0.45, top="round", amp=0.03, chip=0.06, big=0.06, seed=None,
                 M=None, break_amp=0.4, top_h=0.3, keep=None, extra_z=(), mats=None, angle=42, bottom=True):
    """Eroded stone solid from horizontal sections sec(z) -> [(x, y)] (same count, counter-clockwise).
    top: 'round' (weathered dome), 'point', 'flat' or 'broken' (jagged fracture). keep(ring, idx) -> no erosion."""
    seed = rng.uniform(0, 100) if seed is None else seed
    zs = sorted(set([round(z0, 4), round(z1, 4)] + [round(z, 4) for z in frange(z0, z1, dz)] +
                    [round(z, 4) for z in extra_z if z0 < z < z1]))
    rings = [[Vector((x, y, z)) for (x, y) in sec(z)] for z in zs]
    n = len(rings[0])
    cen = lambda ring: sum(ring, Vector()) / len(ring)
    if top == "round":
        c = cen(rings[-1])
        base = rings[-1]
        rings.append([c + (p - c) * 0.82 + Vector((0, 0, top_h * 0.55)) for p in base])
        rings.append([c + (p - c) * 0.45 + Vector((0, 0, top_h * 0.92)) for p in base])
        apex = c + Vector((0, 0, top_h))
    elif top == "point":
        apex = cen(rings[-1]) + Vector((0, 0, top_h))
    elif top == "broken":
        last = rings[-1]
        tilt = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * break_amp * 0.9
        for p in last:
            p.z += tilt.x * (p.x - cen(last).x) + tilt.y * (p.y - cen(last).y) + \
                break_amp * fbm(p * 2.3, 2, seed + 7) * 1.6
        mid = [cen(last) + (p - cen(last)) * 0.55 for p in last]
        for p in mid:
            p.z += break_amp * (fbm(p * 3.1, 2, seed + 11) * 2.0 + 0.25)
        rings.append(mid)
        apex = cen(last) + Vector((0, 0, break_amp * rng.uniform(-0.2, 0.6)))
    else:
        apex = cen(rings[-1])
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    va = bm.verts.new(apex)
    for i in range(n):
        bm.faces.new((vr[-1][i], vr[-1][(i + 1) % n], va))
    if bottom:
        bm.faces.new(vr[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    verts = [v for k, ring in enumerate(vr) for i, v in enumerate(ring) if not (keep and keep(k, i, zs[k] if k < len(zs) else None))]
    stone_disp(bm, verts + [va], amp, chip, seed, big)
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return finish(bm, name, mats or [STONE], angle, recalc=False)


def chamfer_rect(wx, wy, c, nx=1, ny=1):
    """Chamfered rectangle (half sizes) with extra points along the sides, counter-clockwise."""
    pts = []
    for k in range(nx + 1):
        pts.append((-wx + c + (2 * wx - 2 * c) * k / nx, -wy))
    for k in range(ny + 1):
        pts.append((wx, -wy + c + (2 * wy - 2 * c) * k / ny))
    for k in range(nx + 1):
        pts.append((wx - c - (2 * wx - 2 * c) * k / nx, wy))
    for k in range(ny + 1):
        pts.append((-wx, wy - c - (2 * wy - 2 * c) * k / ny))
    return pts


def channel_section(wx, wy, c, cw, d, e=0.025):
    """Chamfered rectangle with a carved channel (half width cw, depth d) in the -Y and +Y faces."""
    F = [(-wx + c, -wy), ((-wx + c - cw) / 2, -wy), (-cw, -wy), (-cw + e, -wy + d), (cw - e, -wy + d), (cw, -wy),
         ((wx - c + cw) / 2, -wy), (wx - c, -wy)]
    R_ = [(wx, -wy + c), (wx, -wy / 3), (wx, wy / 3), (wx, wy - c)]
    B_ = [(x, -y) for (x, y) in reversed(F)]
    L_ = [(-wx, wy - c), (-wx, wy / 3), (-wx, -wy / 3), (-wx, -wy + c)]
    return F + R_ + B_ + L_


CH_FLOOR = {3, 4, 15, 16}


def ring_sector(r0, r1, a0, a1, n=3):
    outer = [(r1 * cos(a0 + (a1 - a0) * k / n), r1 * sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]
    inner = [(r0 * cos(a1 - (a1 - a0) * k / n), r0 * sin(a1 - (a1 - a0) * k / n)) for k in range(n + 1)] if r0 > 0.01 \
        else [(0.0, 0.0)]
    return outer + inner


def stone_block(acc_or_name, poly, z0, z1, rng, chamfer=0.06, jitter=0.03, tilt=0.0, mi=0, amp=0.02):
    """Hand-cut block: polygon prism with a chamfered top (inset), jittered corners. Added to an Acc (site
    coordinates, used outside at(...)) or built as its own object."""
    bm = bmesh.new() if isinstance(acc_or_name, str) else acc_or_name.bm
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    tx, ty = rng.uniform(-tilt, tilt), rng.uniform(-tilt, tilt)
    lo = [bm.verts.new((x + rng.uniform(-jitter, jitter), y + rng.uniform(-jitter, jitter), z0)) for (x, y) in poly]
    hi = [bm.verts.new((v.co.x, v.co.y, z1 + tx * (v.co.x - cx) + ty * (v.co.y - cy) + rng.uniform(-amp, amp)))
          for v in lo]
    n = len(poly)
    top = bm.faces.new(hi)
    fs = [top]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in fs:
        f.material_index = mi
        f.normal_update()
    if top.normal.z < 0:
        for f in fs:
            f.normal_flip()
    rim = inset(bm, [top], chamfer, chamfer * 0.75)
    for f in rim:
        f.material_index = mi
    if isinstance(acc_or_name, str):
        return finish(bm, acc_or_name, [STONE], 35, recalc=False)
    return None


def paving(acc, rng, rings, exclude=None, z_top=0.1, gap=0.05, miss=None, crack=0.18, z_bot=-0.6):
    """Concentric rings of worn, cracked flagstones (some missing / sunken)."""
    for (r0, r1) in rings:
        rm = (r0 + r1) / 2
        n = max(6, round(2 * pi * rm / rng.uniform(1.15, 1.45)))
        a0 = rng.uniform(0, 2 * pi)
        bounds = [a0 + 2 * pi * (k + rng.uniform(-0.22, 0.22)) / n for k in range(n)]
        bounds.append(bounds[0] + 2 * pi)
        for k in range(n):
            ta, tb = bounds[k], bounds[k + 1]
            tm = (ta + tb) / 2
            cx, cy = rm * cos(tm), rm * sin(tm)
            if exclude and exclude(cx, cy):
                continue
            if miss and rng.random() < miss(rm, tm):
                continue
            poly = ring_sector(r0, r1, ta, tb, n=2)
            poly = offset_loop(poly, -gap)
            pieces = [poly]
            if rng.random() < crack:
                c = Vector((cx, cy))
                nrm = Vector((cos(tm + rng.uniform(-0.6, 0.6)), sin(tm + rng.uniform(-0.6, 0.6))))
                pieces = [offset_loop(p, -0.02) for p in (clip_half(poly, c, nrm, True), clip_half(poly, c, nrm, False))
                          if len(p) >= 3]
            sink = -0.07 if rng.random() < 0.12 else 0.0
            for pc in pieces:
                stone_block(acc, pc, z_bot, z_top + sink + rng.uniform(-0.025, 0.025), rng, chamfer=0.045,
                            jitter=0.0, tilt=0.03)


def clip_half(poly, c, nrm, keep_pos):
    out = []
    n = len(poly)
    side = lambda p: (Vector(p) - c).dot(nrm) * (1 if keep_pos else -1)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        sp, sq = side(p), side(q)
        if sp >= 0:
            out.append(tuple(p))
        if (sp >= 0) != (sq >= 0):
            t = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def rubble(acc, rng, center, radius, n, size=(0.15, 0.45), seed=0.0, avoid=None):
    for k in range(n):
        for _ in range(8):
            a = rng.uniform(0, 2 * pi)
            d = radius * math.sqrt(rng.random())
            p = Vector((center[0] + d * cos(a), center[1] + d * sin(a), 0))
            if not (avoid and avoid(p.x, p.y)):
                break
        s = rng.uniform(*size)
        res = bmesh.ops.create_icosphere(acc.bm, subdivisions=1, radius=s)
        vs = res["verts"]
        sc = Vector((rng.uniform(0.8, 1.4), rng.uniform(0.7, 1.2), rng.uniform(0.45, 0.8)))
        sd = seed + k * 3.7
        for v in vs:
            q = Vector((v.co.x * sc.x, v.co.y * sc.y, v.co.z * sc.z))
            q += q.normalized() * s * 0.35 * fbm(q * 4.0 / max(s, 0.1), 2, sd)
            v.co = q
        R = Matrix.Translation(p + Vector((0, 0, s * sc.z * 0.35))) @ Euler((rng.uniform(-0.4, 0.4),
                                                                            rng.uniform(-0.4, 0.4),
                                                                            rng.uniform(0, pi))).to_matrix().to_4x4()
        bmesh.ops.transform(acc.bm, matrix=R, verts=vs)


def crystal(name, loc, r, h, m, sides=6, seed=0.0):
    """Elongated faceted crystal (bipyramid with a waist), centred at loc."""
    bm = bmesh.new()
    top = bm.verts.new(Vector(loc) + Vector((0, 0, h * 0.5)))
    bot = bm.verts.new(Vector(loc) + Vector((0, 0, -h * 0.5)))
    rings = []
    for z, s in ((-0.12, 0.92), (0.14, 1.0)):
        rings.append([bm.verts.new(Vector(loc) + Vector((r * s * cos(2 * pi * k / sides + z), r * s * sin(2 * pi * k / sides + z),
                                                         h * z))) for k in range(sides)])
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((bot, rings[0][j], rings[0][k]))
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
        bm.faces.new((rings[1][k], rings[1][j], top))
    return finish(bm, name, [m], 10)


def crystal_cluster(name, rng, pos, n=4, scale=1.0):
    """A few glowing crystals breaking through the ground / paving cracks."""
    for k in range(n):
        h = rng.uniform(0.45, 1.25) * scale * (1.3 if k == 0 else 1.0)
        r = h * rng.uniform(0.13, 0.19)
        off = Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0)) * scale if k else Vector()
        tilt = rng.uniform(0.15, 0.6) if k else rng.uniform(0.0, 0.15)
        M = Matrix.Translation(Vector(pos) + off) @ Matrix.Rotation(rng.uniform(0, 2 * pi), 4, "Z") @ \
            Matrix.Rotation(tilt, 4, "X")
        with at(M=M):
            crystal(f"{name}{k}", (0, 0, h * 0.32), r, h, GLYPH, sides=5)


def stone_ring_cols(prefix, r, top, z0=-3.0, frac=0.72):
    col(prefix, (-r * frac, -r * frac, z0), (r * frac, r * frac, top))
    col(prefix + "_x", (-r * 0.96, -r * 0.38, z0), (r * 0.96, r * 0.38, top))
    col(prefix + "_y", (-r * 0.38, -r * 0.96, z0), (r * 0.38, r * 0.96, top))


def standing_stone(name, rng, pos, yaw, h, w, d, lean=0.0, top="round", glyph=None, sink=0.3):
    """Weathered standing stone at pos (x, y) facing the site centre; optional rune on the inner face."""
    seed = rng.uniform(0, 100)
    taper = rng.uniform(0.72, 0.9)
    def sec(z):
        t = max(0.0, min(1.0, (z + sink) / (h + sink)))
        s = 1.0 + (taper - 1.0) * t
        bulge = 1.0 + 0.06 * sin(t * pi)
        return chamfer_rect(w / 2 * s * bulge, d / 2 * s * bulge, 0.12, nx=3, ny=2)
    M = Matrix.Translation((pos[0], pos[1], 0)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(lean, 4, "X")
    stone_column(name, sec, -sink, h, rng, dz=0.4, top=top, amp=0.04, chip=0.08, big=0.08, seed=seed, M=M,
                 break_amp=0.3, top_h=min(0.5, w * 0.35))
    if glyph is not None:
        zc = h * rng.uniform(0.55, 0.68)
        t = (zc + sink) / (h + sink)
        s = (1.0 + (taper - 1.0) * t) * (1.0 + 0.06 * sin(t * pi))
        O = M @ Vector((0, -d / 2 * s - 0.005, zc))
        R3 = M.to_3x3()
        glyph_into(glyph, rng, O, R3 @ Vector((1, 0, 0)), R3 @ Vector((0, 0, 1)), R3 @ Vector((0, -1, 0)),
                   w * 0.38, 0.5, w=0.05, t=0.06)
    # collider: AABB of the footprint (leaning stones are covered generously)
    hw = max(w, d) / 2 + abs(lean) * h * 0.5
    col(name, (pos[0] - hw, pos[1] - hw, 0), (pos[0] + hw, pos[1] + hw, h))


def fallen_stone(name, rng, pos, yaw, L, w, d, pieces=2):
    seed = rng.uniform(0, 100)
    x = -L / 2
    for k in range(pieces):
        ln = L / pieces * rng.uniform(0.85, 1.1)
        sec = lambda z, ln=ln: chamfer_rect(w / 2, d / 2, 0.12, nx=2, ny=1)
        M = Matrix.Translation((pos[0], pos[1], d * 0.32)) @ Matrix.Rotation(yaw + rng.uniform(-0.15, 0.15) * k, 4, "Z") \
            @ Matrix.Translation((x + k * 0.25, 0, 0)) @ Matrix.Rotation(pi / 2, 4, "Y") @ Matrix.Rotation(rng.uniform(-0.1, 0.1), 4, "X")
        stone_column(f"{name}{k}", sec, -0.0, ln, rng, dz=0.55, top="broken", amp=0.035, chip=0.08, seed=seed + k,
                     M=M, break_amp=0.25)
        x += ln
    c = Vector((cos(yaw), sin(yaw)))
    lo = Vector(pos) - c * (L / 2 + 0.3)
    hi = Vector(pos) + c * (L / 2 + 0.3)
    col(name, (min(lo.x, hi.x) - w / 2, min(lo.y, hi.y) - w / 2, 0), (max(lo.x, hi.x) + w / 2, max(lo.y, hi.y) + w / 2, d * 0.75))


def altar(name, rng, glyphs, kind=0):
    """Carved altar facing -Y at the local origin (feet on the paving). Returns the interact point."""
    seed = rng.uniform(0, 100)
    stone_block(f"{name}_base", chamfer_rect(0.85, 0.65, 0.12), -0.4, 0.32, rng, chamfer=0.07, jitter=0.02)
    if kind == 0:
        sec = lambda z: chamfer_rect(0.5 + 0.12 * (z - 0.3) / 0.75, 0.36 + 0.08 * (z - 0.3) / 0.75, 0.08, nx=2, ny=1)
        stone_column(f"{name}_body", sec, 0.3, 1.02, rng, dz=0.25, top="flat", amp=0.015, chip=0.04, big=0.015,
                     seed=seed)
        # slanted top slab tilted towards the player
        M = Matrix.Translation((0, -0.02, 1.12)) @ Matrix.Rotation(0.2, 4, "X")
        stone_column(f"{name}_top", lambda z: chamfer_rect(0.72, 0.52, 0.1, nx=2, ny=2), -0.1, 0.1, rng, dz=0.2,
                     top="flat", amp=0.01, chip=0.03, big=0.01, seed=seed + 1, M=M)
        R3 = M.to_3x3()
        O = M @ Vector((0, 0, 0.115))
        U, V, N = R3 @ Vector((1, 0, 0)), R3 @ Vector((0, 1, 0)), R3 @ Vector((0, 0, 1))
        glyph_ring(glyphs, O, U, V, N, 0.36, w=0.045, t=0.03, n=18)
        glyph_ring(glyphs, O, U, V, N, 0.2, w=0.035, t=0.03, n=10, gaps=(0, 5))
        glyph_into(glyphs, rng, O, U, V, N, 0.16, 0.2, w=0.035, t=0.03)
        glyph_into(glyphs, rng, Vector((0, -0.4, 0.68)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)),
                   0.36, 0.42, w=0.045, t=0.06)
    else:
        # basin on an octagonal pedestal, glowing pool
        prof = [(0, 0.3), (0.42, 0.3), (0.36, 0.45), (0.26, 0.62), (0.26, 0.82), (0.5, 0.92), (0.68, 1.02),
                (0.72, 1.12), (0.64, 1.16), (0.5, 1.08), (0, 1.06)]

        def post(bm, F):
            stone_disp(bm, [v for v in bm.verts if v.co.z < 1.0 or math.hypot(v.co.x, v.co.y) > 0.55], 0.015, 0.03, seed,
                       0.015)

        lathe_z(f"{name}_basin", prof, [STONE], segs=8, angle=40, post=post, a0=pi / 8)
        lathe_z(f"{name}_pool", [(0, 1.085), (0.52, 1.085), (0.52, 1.075), (0, 1.075)], [GLYPH], segs=8, a0=pi / 8)
        glyph_into(glyphs, rng, Vector((0, -0.272, 0.72)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)),
                   0.2, 0.28, w=0.035, t=0.04)
    col(name, (-0.8, -0.65, 0), (0.8, 0.65, 1.25))
    return Vector((0, -1.2, 0.55))


def build_monolith_0():
    begin("monolith_0")
    rng = random.Random(3003)
    glyphs = Acc()
    paved = Acc()
    # --- stepped dais of cut blocks
    for k in range(12):
        a0, a1 = 2 * pi * k / 12 + 0.01, 2 * pi * (k + 1) / 12 - 0.01
        stone_block(paved, ring_sector(2.45, 3.75, a0, a1, n=2), -3.0, 0.42, rng, chamfer=0.06, jitter=0.03, tilt=0.015)
    for k in range(8):
        a0, a1 = 2 * pi * k / 8 + pi / 8 + 0.008, 2 * pi * (k + 1) / 8 + pi / 8 - 0.008
        stone_block(paved, ring_sector(0.0, 2.5, a0, a1, n=2), -1.0, 0.82, rng, chamfer=0.07, jitter=0.0, tilt=0.008)
    stone_ring_cols("dais1", 3.75, 0.42)
    stone_ring_cols("dais2", 2.5, 0.82, z0=0.0)
    O = Vector((0, 0, 0.855))
    glyph_ring(glyphs, O, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), 2.2, w=0.06, t=0.07, n=40)
    for k in range(10):
        a = 2 * pi * (k + 0.5) / 10
        er, et = Vector((cos(a), sin(a), 0)), Vector((-sin(a), cos(a), 0))
        glyph_into(glyphs, rng, O + er * 1.82, et, er, Vector((0, 0, 1)), 0.32, 0.42, w=0.045, t=0.07)
    # plinth under the obelisk
    stone_column("m0_plinth", lambda z: chamfer_rect(1.25, 1.0, 0.16, nx=3, ny=2), 0.75, 1.32, rng, dz=0.3,
                 top="flat", amp=0.02, chip=0.06, big=0.02)
    # --- the obelisk: tapered shaft with carved channels front/back, groove bands, cornice and pyramidion
    z0, z1, apex = 1.3, 12.55, 14.0
    w0, w1 = (0.82, 0.58), (0.56, 0.39)
    ch0, ch1, dch, cw0 = 1.95, 11.7, 0.075, 0.34
    bands = (1.62, 12.05)

    def dims(z):
        t = (min(max(z, z0), z1) - z0) / (z1 - z0)
        return w0[0] + (w1[0] - w0[0]) * t, w0[1] + (w1[1] - w0[1]) * t

    spec = []  # (z, extra width, channel depth)
    special = []
    for zb in bands:
        special += [(zb - 0.09, 0.0), (zb - 0.06, -0.045), (zb + 0.06, -0.045), (zb + 0.09, 0.0)]
    for zc in (ch0, ch1):
        special += [(zc, 0.0)]
    special += [(ch0 + 0.04, 0.0), (ch1 - 0.04, 0.0)]
    zs = [(z, 0.0) for z in [z0] + frange(z0, z1, 0.27) + [z1]]
    zs = [p for p in zs if all(abs(p[0] - s[0]) > 0.05 for s in special)] + special
    zs.sort()
    for (z, g) in zs:
        d = dch if ch0 + 0.03 < z < ch1 - 0.03 else 0.0
        spec.append((z, g, d, 1.0))
    spec += [(z1 + 0.03, 0.08, 0.0, 1.0), (z1 + 0.24, 0.08, 0.0, 1.0), (z1 + 0.27, -0.01, 0.0, 1.0),
             (z1 + 0.27 + (apex - z1 - 0.27) * 0.4, -0.01, 0.0, 0.6), (z1 + 0.27 + (apex - z1 - 0.27) * 0.75, -0.01, 0.0, 0.25)]
    bm = bmesh.new()
    vr = []
    keep = []
    for (z, g, d, sc) in spec:
        wx, wy = dims(z)
        s = wx / w0[0]
        pts = channel_section(wx + g, wy + g, 0.11 * s, cw0 * s, d)
        ring = [bm.verts.new((x * sc, y * sc, z)) for (x, y) in pts]
        vr.append(ring)
        if d > 0:
            keep += [ring[i] for i in CH_FLOOR]
    n = len(vr[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    va = bm.verts.new((0, 0, apex))
    for i in range(n):
        bm.faces.new((vr[-1][i], vr[-1][(i + 1) % n], va))
    bm.faces.new(vr[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ks = set(keep)
    stone_disp(bm, [v for v in bm.verts if v not in ks], amp=0.028, chip=0.075, seed=12.0, big=0.045)
    finish(bm, "m0_obelisk", [STONE], 40, recalc=False)
    # runes down both channels, glowing band in the lower groove
    for side in (-1, 1):
        z = ch0 + 0.38
        while z < ch1 - 0.4:
            wx, wy = dims(z)
            s = wx / w0[0]
            cw = cw0 * s - 0.025
            O = Vector((0, side * (wy - dch) + side * 0.005, z))
            glyph_into(glyphs, rng, O, Vector((-side, 0, 0)), Vector((0, 0, 1)), Vector((0, side, 0)),
                       2 * cw - 0.24, 0.5, w=0.05, t=0.04)
            z += 0.66
        # glowing lines along both channel edges, following the taper
        zz = [ch0 + 0.12 + (ch1 - ch0 - 0.24) * k / 4 for k in range(5)]
        for sx in (-1, 1):
            pts = []
            for z in zz:
                wx, wy = dims(z)
                cw = cw0 * wx / w0[0] - 0.025
                pts.append(Vector((sx * (cw - 0.05), side * (wy - dch + 0.004), z)))
            for a, b in zip(pts[:-1], pts[1:]):
                glyphs.bar(a, b, 0.035, 0.03, Vector((0, side, 0)), ext=0.015)
    zb = bands[0]
    wx, wy = dims(zb)
    sec = channel_section(wx - 0.045 + 0.012, wy - 0.045 + 0.012, 0.11, cw0, 0.0)
    for i in range(len(sec)):
        p, q = Vector((*sec[i], zb)), Vector((*sec[(i + 1) % len(sec)], zb))
        if (q - p).length > 0.02:
            nrm = Vector((q.y - p.y, -(q.x - p.x), 0)).normalized()
            glyphs.bar(p, q, 0.05, 0.03, nrm, ext=0.012)
    col("obelisk", (-1.25, -1.0, 0), (1.25, 1.0, apex))
    # --- paving, standing stones, fallen stone, rubble
    paving(paved, rng, [(3.85, 4.95), (5.0, 6.1), (6.15, 7.25), (7.3, 8.4)],
           miss=lambda r, a: 0.04 + max(0.0, (r - 6.5)) * 0.22, z_top=0.1)
    stone_ring_cols("paving", 8.2, 0.06, z0=-1.0, frac=0.7)
    ring_r = 10.2
    angles = [-58, -28, 2, 30, 56, 79, 101, 126, 152, 181, 209, 238]
    tops = ["broken", "round", "broken", "point", "broken", "flat", "flat", "broken", "round", "fallen", "broken", "round"]
    pos_tri = []
    for k, (ad, tp) in enumerate(zip(angles, tops)):
        a = rad(ad)
        p = (ring_r * cos(a), ring_r * sin(a))
        yaw = a + pi / 2 + rng.uniform(-0.12, 0.12)
        if tp == "fallen":
            fallen_stone(f"m0_fallen{k}", rng, (p[0] * 0.95, p[1] * 0.95), a + pi / 2 + 0.4, 4.6, 1.3, 0.85)
            continue
        if tp == "flat":  # trilithon pair
            h = 5.0
            standing_stone(f"m0_stone{k}", rng, p, a + pi / 2, h, 1.35, 0.9, lean=0.0, top="flat", glyph=glyphs)
            pos_tri.append((p, h))
            continue
        h = {"broken": rng.uniform(2.4, 4.0), "round": rng.uniform(4.0, 5.3), "point": 5.6}[tp]
        standing_stone(f"m0_stone{k}", rng, p, yaw, h, rng.uniform(1.1, 1.5), rng.uniform(0.75, 0.95),
                       lean=rng.uniform(-0.1, 0.1), top=tp, glyph=glyphs if rng.random() < 0.7 else None)
    if len(pos_tri) == 2:
        (p0, h0), (p1, h1) = pos_tri
        mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 1.6
        yaw = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        M = Matrix.Translation((mid[0], mid[1], max(h0, h1) + 0.02)) @ Matrix.Rotation(yaw, 4, "Z") @ \
            Matrix.Rotation(0.04, 4, "X") @ Matrix.Translation((-L / 2, 0, 0.42)) @ Matrix.Rotation(pi / 2, 4, "Y")
        stone_column("m0_lintel", lambda z: chamfer_rect(0.42, 0.55, 0.12, nx=1, ny=2), 0.0, L, rng, dz=0.55,
                     top="flat", amp=0.03, chip=0.07, M=M)
    rubble(paved, rng, (0, 0), 11.5, 26, avoid=lambda x, y: math.hypot(x, y) < 4.0 or (abs(x) < 1.5 and y < -3))
    for k, pos in enumerate(((3.1, -3.4, 0.05), (-4.7, 2.3, 0.05), (5.6, 4.1, 0.0), (-8.6, -4.6, 0.0))):
        crystal_cluster(f"m0_cc{k}", rng, pos, n=4 if k < 2 else 3, scale=1.0 if k < 3 else 0.8)
    # --- altar with a hovering crystal (Spin)
    with at((0, -5.6, 0.08)):
        ip = altar("m0_altar", rng, glyphs, kind=0)
        mark("Interact", ip)
        mark("Spin", (0, -0.05, 1.95))
        with separate("Spin"):
            crystal("m0_crystal", (0, -0.05, 1.95), 0.17, 0.62, GLYPH, sides=5)
        mark("Light_1", (0, -0.3, 2.3), color="#b07bff", intensity=30.0, distance=12.0)
    mark("Light_0", (0, -2.2, 5.0), color="#b07bff", intensity=80.0, distance=30.0)
    paved.done("m0_paving", [STONE], 30)
    glyphs.done("m0_glyphs", [GLYPH], 30)


def build_monolith_1():
    begin("monolith_1")
    rng = random.Random(4004)
    glyphs = Acc()
    paved = Acc()
    # --- platform under the arch: two rows of cut blocks, front steps
    xs_ = [-4.9, -2.9, -0.95, 0.95, 2.9, 4.9]
    for r, (y0, y1) in enumerate(((-1.7, 0.0), (0.0, 1.7))):
        for k in range(5):
            stone_block(paved, [(xs_[k] + 0.03, y0 + 0.03), (xs_[k + 1] - 0.03, y0 + 0.03), (xs_[k + 1] - 0.03, y1 - 0.03),
                                (xs_[k] + 0.03, y1 - 0.03)], -3.0, 0.45, rng, chamfer=0.06, jitter=0.02, tilt=0.01)
    for k in range(4):
        x0, x1 = -3.6 + k * 1.8, -3.6 + (k + 1) * 1.8
        stone_block(paved, [(x0 + 0.03, -2.5), (x1 - 0.03, -2.5), (x1 - 0.03, -1.74), (x0 + 0.03, -1.74)], -3.0, 0.22, rng,
                    chamfer=0.05, jitter=0.02, tilt=0.01)
    col("platform", (-4.9, -1.7, -3), (4.9, 1.7, 0.45))
    col("step", (-3.6, -2.5, -3), (3.6, -1.7, 0.22))
    # --- pointed arch: two swept legs with carved, rune-filled channels, keystone on top
    xs, zb, zs_, Rr = 3.3, 0.45, 6.4, 8.0
    th_end = math.acos((Rr - xs) / Rr)
    apex_z = zs_ + Rr * sin(th_end)
    ch_s0, dch = 1.0, 0.07
    leg_len = (zs_ - zb) + Rr * th_end

    def path(s):
        """Right leg: point, tangent at arc length s from the foot."""
        if s <= zs_ - zb:
            return Vector((xs, 0, zb + s)), Vector((0, 0, 1))
        th = (s - (zs_ - zb)) / Rr
        cx = xs - Rr
        return Vector((cx + Rr * cos(th), 0, zs_ + Rr * sin(th))), Vector((-sin(th), 0, cos(th)))

    def dims(s):
        t = s / leg_len
        return 0.82 + (0.52 - 0.82) * t, 0.78 + (0.56 - 0.78) * t

    ch_s1 = leg_len - 0.9
    for side in (1, -1):
        bm = bmesh.new()
        ss = [0.0] + frange(0.0, leg_len, 0.36) + [leg_len]
        special = [ch_s0, ch_s0 + 0.04, ch_s1 - 0.04, ch_s1]
        ss = sorted([s for s in ss if all(abs(s - q) > 0.06 for q in special)] + special)
        vr, keep = [], set()
        for s in ss:
            P, T = path(s)
            B = Vector((0, 1, 0))
            N = B.cross(T).normalized()
            wn, wb = dims(s)
            d = dch if ch_s0 + 0.03 < s < ch_s1 - 0.03 else 0.0
            pts = channel_section(wn, wb, 0.11, 0.24 * wn / 0.82, d)
            ring = []
            for (x, y) in pts:
                q = P + N * x + B * y
                ring.append(bm.verts.new((q.x * side, q.y, q.z)))
            vr.append(ring)
            if d > 0:
                keep |= {ring[i] for i in CH_FLOOR}
        n = len(vr[0])
        for a, b in zip(vr[:-1], vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((a[i], a[j], b[j], b[i]))
        bm.faces.new(vr[0])
        bm.faces.new(vr[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        stone_disp(bm, [v for v in bm.verts if v not in keep], amp=0.028, chip=0.075, seed=20.0 + side, big=0.045)
        finish(bm, f"m1_leg{side}", [STONE], 40, recalc=False)
        # runes along the channel, both faces
        for face in (-1, 1):
            s = ch_s0 + 0.4
            while s < ch_s1 - 0.4:
                P, T = path(s)
                B = Vector((0, 1, 0))
                N = B.cross(T).normalized()
                wn, wb = dims(s)
                cw = 0.24 * wn / 0.82 - 0.025
                O = P + B * (face * (wb - dch + 0.005))
                O = Vector((O.x * side, O.y, O.z))
                Uv = Vector((N.x * side, 0, N.z)) * (-face)
                Tv = Vector((T.x * side, 0, T.z))
                glyph_into(glyphs, rng, O, Uv, Tv, Vector((0, face, 0)), 2 * cw - 0.1, 0.46, w=0.045, t=0.04)
                s += 0.7
    # plinths under the feet
    for side in (1, -1):
        stone_column(f"m1_foot{side}", lambda z: chamfer_rect(1.15, 1.1, 0.16, nx=2, ny=2), 0.3, 1.05, rng, dz=0.4,
                     top="flat", amp=0.02, chip=0.06, big=0.02, M=Matrix.Translation((side * xs, 0, 0)))
        col(f"leg{side}", (side * xs - 1.15, -1.1, 0), (side * xs + 1.15, 1.1, zs_))
        col(f"arch{side}", (side * xs - 0.9, -0.8, zs_), (side * xs + 0.9, 0.8, zs_ + 2.4))
    # keystone with a glowing eye
    Mk = Matrix.Translation((0, 0, apex_z - 0.55))
    stone_column("m1_key", lambda z: chamfer_rect(0.72 - 0.12 * max(0, z - 0.6), 0.68, 0.12, nx=2, ny=2), 0.0, 1.55, rng,
                 dz=0.3, top="point", top_h=0.75, amp=0.02, chip=0.05, big=0.02, M=Mk)
    for face in (-1, 1):
        O = Vector((0, face * 0.69, apex_z + 0.25))
        glyph_ring(glyphs, O, Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, face, 0)), 0.3, w=0.05, t=0.05, n=14)
        glyph_ring(glyphs, O, Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, face, 0)), 0.12, w=0.05, t=0.05, n=8)
    col("key", (-0.8, -0.75, apex_z - 0.6), (0.8, 0.75, apex_z + 1.75))
    # hovering crystal inside the arch, with three orbiting shards (Spin)
    cz = 5.6
    mark("Spin", (0, 0, cz))
    with separate("Spin"):
        crystal("m1_crystal", (0, 0, cz), 0.5, 2.5, GLYPH, sides=6)
        for k in range(3):
            a = 2 * pi * k / 3
            crystal(f"m1_shard{k}", (1.35 * cos(a), 1.35 * sin(a), cz + 0.3 * (k - 1)), 0.13, 0.6, GLYPH, sides=4)
    mark("Light_0", (0, -0.6, cz), color="#b07bff", intensity=90.0, distance=28.0)
    # --- paving, ring of broken octagonal pillars, fallen drums
    paving(paved, rng, [(2.8, 3.9), (3.95, 5.05), (5.1, 6.2), (6.25, 7.35), (7.4, 8.5)],
           exclude=lambda x, y: abs(x) < 5.1 and abs(y) < 2.7,
           miss=lambda r, a: 0.03 + max(0.0, (r - 6.0)) * 0.2 + (0.3 if sin(a) > 0.6 and r > 6 else 0.0), z_top=0.1)
    stone_ring_cols("paving", 8.4, 0.06, z0=-1.0, frac=0.7)
    ring_r = 10.0
    for k, ad in enumerate([-55, -20, 15, 50, 90, 130, 165, 200, 235]):
        a = rad(ad)
        p = Vector((ring_r * cos(a), ring_r * sin(a), 0))
        if k == 5:
            # toppled column: drums lying in a row
            yaw = a + pi / 2 + 0.5
            dvec = Vector((cos(yaw), sin(yaw), 0))
            for j in range(3):
                q = p + dvec * (j * 1.25 - 1.25) + Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0.5))
                M = Matrix.Translation(q) @ Matrix.Rotation(yaw + rng.uniform(-0.2, 0.2), 4, "Z") @ \
                    Matrix.Rotation(pi / 2, 4, "Y") @ Matrix.Translation((0, 0, -0.55))
                stone_column(f"m1_drum{j}", lambda z: ngon(0.52, 8, rot=pi / 8), 0.0, 1.1, rng, dz=0.55, top="flat",
                             amp=0.025, chip=0.07, big=0.03, M=M)
            ex, ey = abs(dvec.x) * 1.9 + 0.6, abs(dvec.y) * 1.9 + 0.6
            col("drums", (p.x - ex, p.y - ey, 0), (p.x + ex, p.y + ey, 1.05))
            continue
        h = rng.uniform(2.2, 5.2) if k % 3 else rng.uniform(5.0, 6.2)
        Mb = Matrix.Translation(p) @ Matrix.Rotation(a, 4, "Z")
        stone_block(paved, [tuple((Mb @ Vector((x, y, 0))).to_2d()) for (x, y) in
                            [(-0.85, -0.85), (0.85, -0.85), (0.85, 0.85), (-0.85, 0.85)]],
                    -1.0, 0.5, rng, chamfer=0.07, jitter=0.03, tilt=0.02)
        broken = h < 5.0
        M = Matrix.Translation(p) @ Matrix.Rotation(a + pi / 8, 4, "Z") @ Matrix.Rotation(rng.uniform(-0.05, 0.05), 4, "X")
        stone_column(f"m1_pillar{k}", lambda z: ngon(0.55 - 0.05 * z / 6.0, 8), 0.4, h, rng, dz=0.45,
                     top="broken" if broken else "flat", break_amp=0.35, amp=0.03, chip=0.08, big=0.04, M=M)
        if not broken:
            # capital: necking ring + square abacus
            stone_column(f"m1_neck{k}", lambda z: ngon(0.6, 8), h - 0.45, h - 0.2, rng, dz=0.25, top="flat", amp=0.012,
                         chip=0.04, big=0.01, M=M)
            stone_column(f"m1_cap{k}", lambda z: chamfer_rect(0.78, 0.78, 0.14, nx=2, ny=2), h - 0.02, h + 0.4, rng,
                         dz=0.42, top="flat", amp=0.02, chip=0.07, big=0.02,
                         M=Matrix.Translation(p) @ Matrix.Rotation(a + rng.uniform(-0.1, 0.1), 4, "Z"))
        R3 = Matrix.Rotation(a, 3, "Z")
        if rng.random() < 0.75:
            zc = min(h - 1.0, rng.uniform(1.6, 2.6))
            O = p + R3 @ Vector((-0.53, 0, zc))
            glyph_into(glyphs, rng, O, R3 @ Vector((0, -1, 0)), Vector((0, 0, 1)), R3 @ Vector((-1, 0, 0)), 0.36, 0.5,
                       w=0.045, t=0.06)
        col(f"pillar{k}", (p.x - 0.85, p.y - 0.85, 0), (p.x + 0.85, p.y + 0.85, h))
    rubble(paved, rng, (0, 0), 11.5, 28, avoid=lambda x, y: (abs(x) < 5.2 and abs(y) < 2.8) or (abs(x) < 1.5 and y < -3))
    for k, pos in enumerate(((-3.7, 3.7, 0.05), (4.9, -3.2, 0.05), (-6.3, -2.4, 0.0), (7.6, 4.4, 0.0))):
        crystal_cluster(f"m1_cc{k}", rng, pos, n=4 if k < 2 else 3, scale=1.0 if k < 3 else 0.8)
    # --- basin altar in front
    with at((0, -5.4, 0.08)):
        ip = altar("m1_altar", rng, glyphs, kind=1)
        mark("Interact", ip)
        mark("Light_1", (0, 0, 1.7), color="#b07bff", intensity=30.0, distance=12.0)
    paved.done("m1_paving", [STONE], 30)
    glyphs.done("m1_glyphs", [GLYPH], 30)


# =====================================================================================  beacons
def console(name, rng=None):
    """Beacon control console facing -Y, feet at z = 0. Returns the interact point (local)."""
    ibox(f"{name}_body", (1.7, 0.75, 0.82), (0, 0.05, 0.41), [H, D], face=(0, -1, 0), thick=0.1, depth=-0.03, inner=1,
         bevel=0.025, panels=(0.05, 0.015, 1))
    for k in range(4):
        box(f"{name}_vent{k}", (1.2, 0.03, 0.035), (0, -0.345, 0.25 + k * 0.09), METAL, bevel=0.0)
    hazard(f"{name}_kick", (-0.85, -0.34, 0.02), (1.7, 0, 0), (0, 0, 0.12), n=10, slant=0.8)
    # slanted desk with two screens and a key strip
    Md = Matrix.Translation((0, -0.1, 0.92)) @ Matrix.Rotation(0.42, 4, "X")
    with at(M=Md):
        ibox(f"{name}_desk", (1.85, 0.72, 0.1), (0, 0, 0), [D, H], face=(0, 0, 1), thick=0.05, depth=-0.012, inner=0,
             rim=1, bevel=0.015)
        for sx in (-1, 1):
            ibox(f"{name}_scr{sx}", (0.62, 0.42, 0.04), (sx * 0.42, 0.06, 0.06), [D, GLOW], face=(0, 0, 1), thick=0.04,
                 depth=-0.01, inner=1, bevel=0.0)
        for k in range(6):
            box(f"{name}_key{k}", (0.1, 0.07, 0.025), (-0.3 + k * 0.12, -0.27, 0.06), A if k in (0, 5) else GLOW, bevel=0.0)
    # upright status display behind the desk
    rod(f"{name}_post", (0, 0.32, 0.8), (0, 0.32, 1.45), 0.05, D, segs=8)
    ibox(f"{name}_disp", (1.1, 0.08, 0.5), (0, 0.3, 1.62), [D, GLOW], rot=(-0.12, 0, 0), thick=0.05, depth=-0.015,
         inner=1, bevel=0.012)
    box(f"{name}_hood", (1.2, 0.3, 0.04), (0, 0.38, 1.9), H, rot=(-0.2, 0, 0), bevel=0.01)
    for sx in (-1, 1):
        box(f"{name}_side{sx}", (0.12, 0.85, 1.05), (sx * 0.92, 0.05, 0.525), H, bevel=0.03)
        box(f"{name}_sacc{sx}", (0.13, 0.86, 0.08), (sx * 0.92, 0.05, 0.92), A, bevel=0.0)
        rod(f"{name}_hdl{sx}", (sx * 0.99, -0.25, 0.75), (sx * 0.99, 0.3, 0.75), 0.02, METAL, segs=5)
    rod(f"{name}_ant", (0.7, 0.35, 1.05), (0.7, 0.35, 2.2), 0.015, METAL, segs=4, r1=0.006)
    sphere(f"{name}_antb", (0.7, 0.35, 2.2), 0.035, GLOW, segs=6, rings=4)
    col(name, (-1.0, -0.45, 0), (1.0, 0.5, 1.9))
    return Vector((0, -1.2, 0.5))


def lamp_head(name, z, r=0.42, style=0):
    """Beacon lamp housing at height z (base). The lens goes to the Blink marker. Returns the top height."""
    if style == 0:
        lathe_z(f"{name}_base", [(0, z), (r + 0.18, z), (r + 0.18, z + 0.12), (r + 0.06, z + 0.2), (r + 0.06, z + 0.32),
                                 (0, z + 0.32)], [D], segs=16)
        zl0, zl1 = z + 0.32, z + 1.12
        with separate("Blink"):
            lathe_z(f"{name}_lens", [(0, zl0), (r, zl0), (r * 1.06, zl0 + 0.12), (r * 1.06, zl1 - 0.12), (r, zl1),
                                     (0, zl1)], [LAMP], segs=16, angle=50)
        for k in range(6):
            a = 2 * pi * k / 6
            rod(f"{name}_cage{k}", (cos(a) * (r + 0.1), sin(a) * (r + 0.1), zl0), (cos(a) * (r + 0.1), sin(a) * (r + 0.1), zl1),
                0.025, METAL, segs=4)
        lathe_z(f"{name}_cap", [(0, zl1), (r + 0.14, zl1), (r + 0.14, zl1 + 0.1), (r * 0.6, zl1 + 0.25), (0, zl1 + 0.28)],
                [D], segs=16)
        mark("Blink", (0, 0, (zl0 + zl1) / 2))
        return zl1 + 0.28
    else:
        lathe_z(f"{name}_base", [(0, z), (r + 0.25, z), (r + 0.25, z + 0.1), (r + 0.1, z + 0.22), (0, z + 0.22)], [H],
                segs=16)
        zl0 = z + 0.22
        with separate("Blink"):
            prof = [(0, zl0), (r, zl0)] + [(r * cos(rad(a)), zl0 + 0.2 + r * 1.2 * sin(rad(a))) for a in (0, 30, 55, 75)] \
                + [(0, zl0 + 0.2 + r * 1.2)]
            lathe_z(f"{name}_lens", prof, [LAMP], segs=16, angle=60)
        for k in range(4):
            a = 2 * pi * k / 4 + pi / 4
            pts = [(cos(a) * (r + 0.07) * cos(rad(t)), sin(a) * (r + 0.07) * cos(rad(t)),
                    zl0 + 0.2 + (r * 1.2 + 0.07) * sin(rad(t))) for t in (0, 30, 60, 85)]
            pipe(f"{name}_cage{k}", [(cos(a) * (r + 0.07), sin(a) * (r + 0.07), zl0)] + pts, 0.022, METAL, res=0)
        mark("Blink", (0, 0, zl0 + 0.2 + r * 0.4))
        return zl0 + 0.2 + r * 1.2


def lattice_tower(name, levels, hw0, hw1, legw=0.22):
    """Square lattice tower: legs, girders, X bracing, gusset plates. levels = heights of the girder rings."""
    z0, z1 = levels[0], levels[-1]
    hw = lambda z: hw0 + (hw1 - hw0) * (z - z0) / (z1 - z0)
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    P = lambda z, c: Vector((c[0] * hw(z), c[1] * hw(z), z))
    acc = Acc()
    acc_d = Acc()
    for c in corners:
        acc.bar(P(z0 - 0.05, c), P(z1 + 0.05, c), legw, legw, Vector((c[0], c[1], 0)))
    for k, z in enumerate(levels):
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            gw = 0.14 if k else 0.18
            acc.bar(P(z, a), P(z, b), gw, gw, (0, 0, 1))
            if k < len(levels) - 1:
                zn = levels[k + 1]
                acc_d.bar(P(z + 0.08, a), P(zn - 0.08, b), 0.08, 0.08, Vector((a[0] + b[0], a[1] + b[1], 0)))
                acc_d.bar(P(z + 0.08, b), P(zn - 0.08, a), 0.08, 0.08, Vector((a[0] + b[0], a[1] + b[1], 0)))
        for c in corners:
            p = P(z, c)
            acc_d.bar(p - Vector((0, 0, 0.18)), p + Vector((0, 0, 0.18)), legw + 0.08, legw + 0.08, Vector((c[0], c[1], 0)))
    acc.done(f"{name}_legs", [D], 30)
    acc_d.done(f"{name}_brace", [METAL], 30)
    return hw


def build_beacon_0():
    begin("beacon_0")
    rng = random.Random(5005)
    FT = 0.4
    # --- base platform with hazard edges, front steps, bollards
    slab("b0_base", [(-4.6, -4.6), (4.6, -4.6), (4.6, 4.6), (-4.6, 4.6)], FT, cell=1.15, chamfer=0.08)
    for (p0, u, v) in (((-4.52, -4.52, FT + 0.003), (9.04, 0, 0), (0, 0.32, 0)),
                       ((4.52, -4.52, FT + 0.003), (0, 9.04, 0), (-0.32, 0, 0)),
                       ((4.52, 4.52, FT + 0.003), (-9.04, 0, 0), (0, -0.32, 0)),
                       ((-4.52, 4.52, FT + 0.003), (0, -9.04, 0), (0.32, 0, 0))):
        hazard("b0_hz", p0, u, v, n=30, slant=1.0, lift=0.02)
    steps("b0_step", -1.6, 1.6, -4.6, FT, 2)
    col("base", (-4.6, -4.6, -3), (4.6, 4.6, FT))
    col("step", (-1.6, -5.02, -3), (1.6, -4.6, FT / 2))
    for sx in (-1, 1):
        for sy in (-1, 1):
            lathe_z("b0_bollard", [(0, FT), (0.16, FT), (0.16, FT + 0.55), (0.12, FT + 0.62), (0, FT + 0.62)], [D, A],
                    segs=10, segmat=[0, 0, 1, 0], loc=(sx * 4.2, sy * 4.2, 0))
    # --- tower
    levels = [FT + 0.6, 3.9, 6.9, 9.6, 12.0, 14.0, 15.6, 16.9]
    hw = lattice_tower("b0_tower", levels, 2.55, 0.7)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 2.55, sy * 2.55
            ibox("b0_footing", (0.95, 0.95, 0.55), (x, y, FT + 0.27), [H, D], face=(0, 0, 1), thick=0.08, depth=-0.02,
                 inner=1, bevel=0.03)
            hazard("b0_fhz", (x + 0.476 * sy, y + 0.477 * sy, FT + 0.08), (-0.95 * sy, 0, 0), (0, 0, 0.3), n=4)
            for bx in (-0.3, 0.3):
                for by in (-0.3, 0.3):
                    lathe_z("b0_bolt", [(0, FT + 0.55), (0.04, FT + 0.55), (0.04, FT + 0.62), (0, FT + 0.62)], [METAL],
                            segs=6, loc=(x + bx, y + by, 0))
            for k in range(3):
                za, zb_ = levels[k], levels[k + 1]
                xa, xb = sx * hw(za), sx * hw(zb_)
                ya, yb = sy * hw(za), sy * hw(zb_)
                col(f"leg{sx}{sy}_{k}", (min(xa, xb) - 0.2, min(ya, yb) - 0.2, 0 if k == 0 else za),
                    (max(xa, xb) + 0.2, max(ya, yb) + 0.2, zb_))
    # mid platform (grating) with railing at level 3
    zp = levels[3]
    hp = hw(zp) + 0.9
    frame_ring("b0_deck", [(x, y) for (x, y) in ((-hp, -hp), (hp, -hp), (hp, hp), (-hp, hp))],
               [(x, y) for (x, y) in ((-hw(zp) + 0.3, -hw(zp) + 0.3), (hw(zp) - 0.3, -hw(zp) + 0.3),
                                      (hw(zp) - 0.3, hw(zp) - 0.3), (-hw(zp) + 0.3, hw(zp) - 0.3))],
               -zp - 0.08, -zp + 0.06, D, M=Matrix.Rotation(-pi / 2, 4, "X"))
    for i in range(4):
        a = ((-hp, -hp), (hp, -hp), (hp, hp), (-hp, hp))[i]
        b = ((-hp, -hp), (hp, -hp), (hp, hp), (-hp, hp))[(i + 1) % 4]
        for t in (0.0, 0.33, 0.66):
            p = Vector(a).lerp(Vector(b), t)
            rod("b0_rpost", (p.x, p.y, zp + 0.06), (p.x, p.y, zp + 1.1), 0.03, METAL, segs=4)
        pipe("b0_rail", [(a[0], a[1], zp + 1.1), (b[0], b[1], zp + 1.1)], 0.03, A, res=0)
        pipe("b0_rail2", [(a[0], a[1], zp + 0.6), (b[0], b[1], zp + 0.6)], 0.022, METAL, res=0)
    # sector panel antennas on the platform, a dish below, a second dish on the side
    for k in range(3):
        a = rad(-90 + 120 * k + 60)
        p = Vector((cos(a) * (hp - 0.15), sin(a) * (hp - 0.15), zp + 1.5))
        box("b0_panel", (0.34, 0.14, 1.3), p, H, rot=(0, 0, a + pi / 2), bevel=0.03)
        rod("b0_parm", (cos(a) * (hp - 0.45), sin(a) * (hp - 0.45), zp + 1.5), p, 0.035, METAL, segs=4, caps=False)
        rod("b0_pmast", (cos(a) * (hp - 0.45), sin(a) * (hp - 0.45), zp), (cos(a) * (hp - 0.45), sin(a) * (hp - 0.45), zp + 2.3),
            0.05, D, segs=6)
    zd = 7.4
    with at(M=axis_M((0, -hw(zd) - 0.35, zd), direction=(0.15, -1, 0.12))[0]):
        dish("b0_dish", R=0.85, f=0.6)
    rod("b0_darm", (0, -hw(zd) + 0.05, zd), (0, -hw(zd) - 0.45, zd), 0.05, D, segs=6)
    zd2 = 13.0
    with at(M=axis_M((hw(zd2) + 0.3, 0, zd2), direction=(1, 0.3, 0.05))[0]):
        dish("b0_dish2", R=0.6, f=0.42)
    rod("b0_darm2", (hw(zd2) - 0.05, 0, zd2), (hw(zd2) + 0.35, 0, zd2), 0.04, D, segs=6)
    # top: cap plate, equipment box, lamp, dipole bar, whips, lightning rod
    zt = levels[-1]
    ibox("b0_topplate", (2.0, 2.0, 0.18), (0, 0, zt + 0.09), [D, H], face=(0, 0, 1), thick=0.12, depth=-0.03, inner=0,
         rim=1, bevel=0.02)
    ibox("b0_topbox", (0.8, 0.6, 0.5), (0, 0.55, zt - 0.35), [H, D], face=(0, -1, 0), thick=0.06, depth=-0.02, inner=1,
         bevel=0.02)
    top = lamp_head("b0_lamp", zt + 0.18, r=0.42, style=0)
    rod("b0_rod", (0, 0, top), (0, 0, 20.4), 0.03, METAL, segs=5, r1=0.01)
    bar("b0_dipbar", (-0.9, 0.85, zt + 0.5), (0.9, 0.85, zt + 0.5), 0.06, 0.06, METAL)
    for k in range(5):
        x = -0.8 + k * 0.4
        rod("b0_dip", (x, 0.85, zt + 0.2), (x, 0.85, zt + 0.8), 0.012, METAL, segs=4)
    rod("b0_dipm", (0, 0.85, zt + 0.18), (0, 0.85, zt + 0.5), 0.04, D, segs=6)
    for k, (x, y) in enumerate(((-0.8, -0.8), (0.8, -0.8))):
        rod("b0_whip", (x, y, zt + 0.18), (x, y, zt + 2.3 + k * 0.5), 0.016, METAL, segs=4, r1=0.006)
    # ladder up the back face with a cable tray beside it
    za, zb_ = FT + 0.1, levels[3]
    for sx in (-0.22, 0.22):
        bar("b0_lrail", (sx, hw(za) + 0.1, za), (sx, hw(zb_) + 0.1, zb_ + 1.0), 0.05, 0.05, METAL)
    n = int((zb_ - za) / 0.38)
    for k in range(1, n + 1):
        z = za + k * 0.38
        bar("b0_rung", (-0.22, hw(z) + 0.1, z), (0.22, hw(z) + 0.1, z), 0.03, 0.03, METAL)
    bar("b0_tray", (0.55, hw(za) + 0.06, za), (0.55, hw(zt) + 0.06, zt), 0.18, 0.06, D)
    pipe("b0_trcab", [(0.55, hw(za) + 0.12, za), (0.55, hw(zt) + 0.12, zt), (0.3, 0.5, zt + 0.1)], 0.03, A, res=0)
    # --- equipment at the base: cabinets, generator, cables to the console
    for k, (x, y) in enumerate(((-1.0, 1.2), (0.3, 1.25))):
        ibox(f"b0_cab{k}", (1.1, 0.6, 1.7), (x, y, FT + 0.85), [H, D], face=(0, -1, 0), thick=0.08, depth=-0.025, inner=1,
             bevel=0.025, panels=(0.05, 0.015, 1))
        for j in range(3):
            box(f"b0_cabl{k}{j}", (0.08, 0.03, 0.05), (x - 0.35 + j * 0.12, y - 0.32, FT + 1.45),
                GLOW if (j + k) % 2 else LAMP, bevel=0.0)
        box(f"b0_cabv{k}", (0.6, 0.03, 0.3), (x, y - 0.32, FT + 0.5), METAL, bevel=0.0)
    col("cabs", (-1.6, 0.9, 0), (0.9, 1.55, FT + 1.7))
    with at((-3.3, 3.3, FT), rz=rad(-45)):
        ibox("b0_gen", (1.8, 1.1, 1.1), (0, 0, 0.55), [A, D], face=(1, 0, 0), thick=0.1, depth=-0.04, inner=1, bevel=0.03,
             panels=(0.06, 0.02, 1))
        lathe_z("b0_genfan", [(0, 1.1), (0.4, 1.1), (0.4, 1.22), (0.34, 1.22), (0.34, 1.16), (0, 1.16)], [D], segs=12,
                loc=(-0.35, 0, 0))
        lathe_z("b0_genex", [(0, 1.1), (0.1, 1.1), (0.1, 1.7), (0.13, 1.72), (0.13, 1.8), (0, 1.8)], [D], segs=8,
                loc=(0.55, 0.3, 0))
        col("gen", (-0.9, -0.55, 0), (0.9, 0.55, 1.2))
    for k, (xo, m) in enumerate(((-0.25, D), (0.0, A), (0.25, D))):
        pipe(f"b0_cable{k}", [(xo, -2.9, FT + 0.35), (xo * 1.2, -2.6, FT + 0.04), (xo * 1.5 - 0.2, -1.2, FT + 0.04),
                              (-0.6 + xo, 0.4, FT + 0.04), (-0.8 + xo, 0.85, FT + 0.3)], 0.04, m, res=1, bend=0.35)
    pipe("b0_gcable", [(-2.7, 2.8, FT + 0.3), (-2.3, 2.3, FT + 0.04), (-1.6, 1.6, FT + 0.04), (-1.45, 1.0, FT + 0.6)], 0.05,
         D, bend=0.3)
    # --- console in front
    with at((0, -3.25, FT)):
        ip = console("b0_con", rng)
        mark("Interact", ip)
    mark("Light_0", (0, -3.6, FT + 2.6), color="#9fe8ff", intensity=35.0, distance=14.0)
    mark("Light_1", (0, 0, 18.2), color="#ff3020", intensity=80.0, distance=40.0)
    # battery rack (back right) and red obstruction lights on the platform corners
    with at((3.3, 3.3, FT), rz=rad(-45)):
        ibox("b0_batt", (1.9, 0.75, 1.15), (0, 0, 0.575), [A, D], face=(0, -1, 0), thick=0.1, depth=-0.05, inner=1,
             bevel=0.03)
        for k in range(5):
            box(f"b0_battc{k}", (0.28, 0.06, 0.8), (-0.68 + k * 0.34, -0.36, 0.55), D, bevel=0.01)
            box(f"b0_battl{k}", (0.12, 0.03, 0.05), (-0.68 + k * 0.34, -0.4, 0.88), GLOW if k != 3 else LAMP, bevel=0.0)
        box("b0_battlid", (2.0, 0.85, 0.08), (0, 0, 1.19), D, bevel=0.02)
        col("batt", (-0.95, -0.4, 0), (0.95, 0.4, 1.25))
    pipe("b0_bcable", [(2.75, 2.9, FT + 0.3), (2.3, 2.4, FT + 0.04), (1.0, 1.6, FT + 0.04), (0.55, 1.55, FT + 0.5)], 0.05,
         D, bend=0.3)
    for (x, y) in ((-hp, -hp), (hp, -hp), (hp, hp), (-hp, hp)):
        sphere("b0_obs", (x, y, zp + 1.2), 0.08, LAMP, segs=8, rings=5)
    for k, off in enumerate((0.12, -0.12)):
        pts = [Vector((hw(z) + 0.18, -hw(z) - 0.18 + off, z)) for z in (FT + 0.6, levels[1], levels[2], levels[3] - 0.1)]
        pipe(f"b0_legcab{k}", [Vector((1.0, -1.6 + off, FT + 0.04)), Vector((2.3, -2.5 + off, FT + 0.04))] + pts, 0.035,
             D if k else A, res=1, bend=0.3)
    crate("b0_crate0", (1.0, 0.8, 0.7), (3.4, -3.0, FT), rz=0.3, rng=rng)
    crate("b0_crate1", (0.8, 0.8, 0.6), (3.5, -2.0, FT), rz=-0.2, rng=rng)
    barrel("b0_bar0", (-3.6, -3.4, FT), m=A)
    barrel("b0_bar1", (-3.0, -3.7, FT), m=D)
    col("barrels", (-4.0, -4.1, FT), (-2.6, -3.0, FT + 1.0))


def build_beacon_1():
    begin("beacon_1")
    rng = random.Random(6006)
    FT = 0.4
    # --- hexagonal base platform with hazard edges
    hexp = ngon(4.9, 6, rot=pi / 6)
    slab("b1_base", hexp, FT, cell=1.2, chamfer=0.1)
    for i in range(6):
        a, b = Vector(hexp[i]), Vector(hexp[(i + 1) % 6])
        inward = (-(a + b) / 2).normalized() * 0.34
        hazard("b1_hz", (a.x, a.y, FT + 0.02), (b.x - a.x, b.y - a.y, 0), (inward.x, inward.y, 0), n=20, slant=1.0,
               lift=0.0)
    stone_ring_cols("base", 4.9 * 0.93, FT)
    steps("b1_step", -1.5, 1.5, -4.9 * cos(pi / 6) + 0.02, FT, 2)
    col("step", (-1.5, -4.9 * cos(pi / 6) - 0.4, -3), (1.5, -4.9 * cos(pi / 6), FT / 2))
    # --- core column (ground to collar) and spire
    zc = 9.2
    core = [(0, FT), (0.95, FT), (0.95, FT + 0.5), (0.78, FT + 0.6)]
    segmat = [1, 1, 1]
    for z in (2.5, 4.5, 6.5, 8.3):
        r = 0.72 - 0.15 * (z / zc)
        core += [(r, z - 0.12), (r + 0.06, z - 0.08), (r + 0.06, z + 0.08), (r, z + 0.12)]
        segmat += [0, 1, 1, 1]
    core += [(0.56, zc - 0.4), (0, zc - 0.4)]
    segmat += [0, 1]

    def core_post(bm, F):
        ps = [f for (i, j), f in F.items() if segmat[i] == 0 and f.calc_area() > 0.05]
        inset(bm, ps, 0.03, 0.02, rim=1)
        for (i, j), f in F.items():
            if i == 1:
                f.material_index = 2 if j % 2 else 1

    lathe_z("b1_core", core, [H, D, A], segs=12, segmat=segmat, angle=35, post=core_post)
    # collar + ring platform
    lathe_z("b1_collar", [(0, zc - 0.45), (1.25, zc - 0.45), (1.35, zc - 0.25), (1.35, zc + 0.25), (1.1, zc + 0.45),
                          (0, zc + 0.45)], [D], segs=16, angle=40)
    lathe_z("b1_deck", [(0, zc + 0.3), (2.3, zc + 0.3), (2.3, zc + 0.42), (0, zc + 0.42)], [D], segs=20)
    for k in range(12):
        a = 2 * pi * k / 12
        rod("b1_rp", (2.2 * cos(a), 2.2 * sin(a), zc + 0.42), (2.2 * cos(a), 2.2 * sin(a), zc + 1.4), 0.03, METAL, segs=4)
    ring = [(2.2 * cos(2 * pi * k / 24), 2.2 * sin(2 * pi * k / 24), zc + 1.4) for k in range(25)]
    pipe("b1_rail", ring, 0.03, A, res=0)
    pipe("b1_rail2", [(x, y, zc + 0.9) for (x, y, _) in ring], 0.022, METAL, res=0)
    # spire: segmented tapering column with accent bands and fins
    spire = [(0, zc + 0.42), (0.62, zc + 0.42)]
    sm = [1]
    zz = zc + 0.42
    r = 0.62
    for k in range(5):
        z1_ = zz + 1.45
        r1 = r * 0.88
        spire += [(r1, z1_ - 0.1), (r1 + 0.05, z1_ - 0.06), (r1 + 0.05, z1_), (r1 * 0.97, z1_ + 0.04)]
        sm += [0, 1, 2 if k % 2 == 0 else 1, 1]
        zz, r = z1_ + 0.04, r1 * 0.97
    zs_top = zz
    spire += [(r * 1.4, zz), (r * 1.4, zz + 0.12), (0, zz + 0.12)]
    sm += [1, 1, 1]

    def spire_post(bm, F):
        ps = [f for (i, j), f in F.items() if sm[i] == 0]
        inset(bm, ps, 0.025, 0.018, rim=1)

    lathe_z("b1_spire", spire, [H, D, A], segs=12, segmat=sm, angle=35, post=spire_post)
    for zr_, rr_ in ((zc + 0.42 + 1.45 * 2 + 0.06, 0.62 * 0.88 ** 2 * 0.97 + 0.07), (zc + 0.42 + 1.45 * 4 + 0.14, 0.62 * 0.88 ** 4 * 0.97 ** 3 + 0.07)):
        lathe_z("b1_gring", [(rr_ - 0.03, zr_ - 0.03), (rr_, zr_ - 0.03), (rr_, zr_ + 0.03), (rr_ - 0.03, zr_ + 0.03),
                             (rr_ - 0.03, zr_ - 0.03)], [GLOW], segs=12, angle=50)
    for k in range(3):
        a = rad(90 + 120 * k + 60)
        lathe_z("b1_dlamp", [(0, zc + 0.42), (0.12, zc + 0.42), (0.1, zc + 0.52), (0, zc + 0.54)], [GLOW], segs=8,
                loc=(1.9 * cos(a), 1.9 * sin(a), 0))
    for k in range(4):
        a = 2 * pi * k / 4 + pi / 4
        poly = [(0.3, 0.0), (0.62, 0.5), (0.6, 3.0), (0.3, 4.4)]
        Mf = Matrix.Translation((0, 0, zc + 3.6)) @ Matrix.Rotation(a, 4, "Z") @ RX90
        prism("b1_fin", poly, -0.035, 0.035, H, M=Mf, bevel=0.012)
        prism("b1_finedge", [(0.6, 0.5), (0.66, 0.55), (0.64, 2.95), (0.58, 3.0)], -0.045, 0.045, A, M=Mf, bevel=0.0)
    # three dishes on arms around the spire
    zd = zc + 2.2
    for k in range(3):
        a = rad(-90 + 120 * k + 60)
        p0 = Vector((0.5 * cos(a), 0.5 * sin(a), zd))
        p1 = Vector((1.25 * cos(a), 1.25 * sin(a), zd))
        rod("b1_darm", p0, p1, 0.06, D, segs=6)
        with at(M=axis_M(p1 + Vector((0.1 * cos(a), 0.1 * sin(a), 0)), direction=(cos(a), sin(a), 0.35))[0]):
            dish("b1_dish", R=0.7, f=0.5, segs=16)
    top = lamp_head("b1_lamp", zs_top + 0.12, r=0.4, style=1)
    rod("b1_mast", (0, 0, top - 0.02), (0, 0, 20.3), 0.035, METAL, segs=5, r1=0.012)
    for k in range(3):
        z = top + 0.5 + k * 0.45
        w = 0.55 - k * 0.12
        bar("b1_xbar", (-w, 0, z), (w, 0, z), 0.04, 0.04, METAL)
    # --- three curved legs from the footings to the collar
    for k in range(3):
        a = rad(90 + 120 * k)
        er = Vector((cos(a), sin(a), 0))
        et = Vector((-sin(a), cos(a), 0))
        p0 = er * 3.35 + Vector((0, 0, FT + 0.5))
        p2 = er * 1.25 + Vector((0, 0, zc - 0.1))
        p1 = er * 3.0 + Vector((0, 0, zc * 0.55))
        N_ = 18
        rings = []
        for i in range(N_ + 1):
            t = i / N_
            P_ = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
            T_ = ((p1 - p0) * 2 * (1 - t) + (p2 - p1) * 2 * t).normalized()
            Nn = et.cross(T_).normalized()
            w, d = 0.34 - 0.12 * t, 0.26 - 0.08 * t
            c_ = 0.07
            sec = [(-w + c_, -d), (w - c_, -d), (w, -d + c_), (w, d - c_), (w - c_, d), (-w + c_, d), (-w, d - c_), (-w, -d + c_)]
            rings.append([P_ + et * x + Nn * y for (x, y) in sec])

        ringloft(f"b1_leg{k}", rings, [H, D], angle=30)
        for t in (0.3, 0.62):
            i = int(t * N_)
            c0 = sum(rings[i], Vector()) / 8
            c1 = sum(rings[i + 1], Vector()) / 8
            grow = lambda ring, c: [c + (p - c) * 1.18 for p in ring]
            ringloft(f"b1_lcol{k}{i}", [grow(rings[i], c0), grow(rings[i + 1], c1)], D, angle=30)
        # footing with hazard collar and clamp
        with at(er * 3.35, rz=a):
            ibox("b1_foot", (1.1, 1.0, 0.5), (0, 0, FT + 0.25), [D, H], face=(0, 0, 1), thick=0.08, depth=-0.02, inner=0,
                 bevel=0.03)
            for sgn in (-1, 1):
                hazard("b1_fhz", (sgn * 0.551, -0.5 * sgn, FT + 0.08), (0, sgn * 1.0, 0), (0, 0, 0.3), n=4)
            col("foot", (-0.6, -0.55, 0), (0.6, 0.55, FT + 2.2))
        q = p0 + (p1 - p0) * 0.08
        lathe_z("b1_clamp", [(0, q.z - 0.2), (0.45, q.z - 0.2), (0.45, q.z + 0.2), (0, q.z + 0.2)], [A], segs=8,
                loc=(q.x, q.y, 0), a0=pi / 8)
        for t, (zlo, zhi) in ((0.25, (2.0, 4.6)), (0.55, (4.6, 7.0))):
            P_ = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
            col(f"leg{k}_{t}", (P_.x - 0.45, P_.y - 0.45, zlo), (P_.x + 0.45, P_.y + 0.45, zhi))
        # cable conduit down the leg
        pts = []
        for i in range(0, 11):
            t = i / 10
            P_ = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
            pts.append(P_ + et * 0.36)
        if k != 1:
            pipe(f"b1_lcab{k}", pts + [pts[-1] + Vector((0, 0, 0.6))], 0.04, D, res=1)
    col("core", (-1.0, -1.0, 0), (1.0, 1.0, zc + 0.5))
    col("spire", (-0.7, -0.7, zc), (0.7, 0.7, zs_top + 1.0))
    # --- equipment, cables, console
    for k, a in enumerate((rad(30), rad(150))):
        er = Vector((cos(a), sin(a), 0))
        with at(er * 2.1, rz=a + pi / 2):
            ibox(f"b1_cab{k}", (1.1, 0.55, 1.5), (0, 0, FT + 0.75), [H, D], face=(0, 1, 0), thick=0.08, depth=-0.025,
                 inner=1, bevel=0.025, panels=(0.05, 0.015, 1))
            box(f"b1_cabg{k}", (0.5, 0.03, 0.08), (0, 0.29, FT + 1.3), GLOW, bevel=0.0)
            col(f"cab{k}", (-0.55, -0.3, 0), (0.55, 0.3, FT + 1.5))
    for k, (xo, m) in enumerate(((-0.22, D), (0.05, A), (0.3, D))):
        pipe(f"b1_cable{k}", [(xo, -3.1, FT + 0.35), (xo, -2.8, FT + 0.04), (xo * 0.8, -1.6, FT + 0.04),
                              (xo * 0.6, -0.98, FT + 0.04), (xo * 0.6, -0.9, FT + 0.5)], 0.04, m, res=1, bend=0.3)
    with at((0, -3.45, FT)):
        ip = console("b1_con", rng)
        mark("Interact", ip)
    mark("Light_0", (0, -3.8, FT + 2.6), color="#9fe8ff", intensity=35.0, distance=14.0)
    mark("Light_1", (0, 0, zc + 1.6), color="#ffc890", intensity=30.0, distance=12.0)
    barrel("b1_bar0", (3.2, -1.6, FT), m=A)
    barrel("b1_bar1", (3.4, -0.9, FT), m=A)
    crate("b1_crate0", (0.9, 0.8, 0.7), (-3.3, -1.5, FT), rz=0.5, rng=rng)
    col("barrels", (2.8, -2.0, FT), (3.8, -0.5, FT + 1.0))


# =====================================================================================  build
BUILDERS = [("outpost_0", build_outpost_0), ("outpost_1", build_outpost_1), ("monolith_0", build_monolith_0),
            ("monolith_1", build_monolith_1), ("beacon_0", build_beacon_0), ("beacon_1", build_beacon_1)]
for nm, fn in BUILDERS:
    if ONLY and nm not in ONLY:
        continue
    fn()
CUR = None


# =====================================================================================  join / markers / export
def select_only(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def join_into(obs, name):
    names = [o.name for o in obs]
    select_only(obs)
    bpy.ops.object.convert(target="MESH")
    obs = [bpy.data.objects[n] for n in names]
    me = bpy.data.meshes.new(name)
    target = bpy.data.objects.new(name, me)
    COLL.objects.link(target)
    select_only(obs + [target], active=target)
    bpy.ops.object.join()
    return target


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def box_mesh(name, lo, hi):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((lo + hi) / 2) @ Matrix.Diagonal((*(hi - lo), 1.0)),
                        verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


ROOTS = {}
STATS = []
if os.environ.get("STRUCT_DEBUG"):
    dg = bpy.context.evaluated_depsgraph_get()
    for model in MODELS:
        per = {}
        for ob in model.obs:
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            key = re.sub(r"(\d+|[-.]\d+)+$", "", ob.name.split("_")[1] if "_" in ob.name else ob.name)
            per[key] = per.get(key, 0) + len(me.loop_triangles)
            ev.to_mesh_clear()
        print("TRIS BY PART", model.name, sorted(per.items(), key=lambda kv: -kv[1])[:25])
for model in MODELS:
    root = bpy.data.objects.new(model.name, None)
    root.empty_display_size = 2.0
    COLL.objects.link(root)
    ROOTS[model.name] = root
    body = join_into(model.obs, f"{model.name}_mesh")
    body.parent = root
    tris = tri_count(body)
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for v in body.data.vertices:
        lo = Vector(map(min, lo, v.co))
        hi = Vector(map(max, hi, v.co))
    for (nm, l, h) in model.cols:
        c = box_mesh("COL_" + re.sub(r"[^A-Za-z0-9_-]", "_", nm), l, h)
        c.parent = root
    for (nm, loc, props) in model.marks:
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "SPHERE" if nm == "Interact" else "PLAIN_AXES"
        e.empty_display_size = 0.3
        COLL.objects.link(e)
        e.location = loc
        e.parent = root
        for k, v in props.items():
            e[k] = v
        if nm in model.sep and model.sep[nm]:
            child = join_into(model.sep[nm], {"Blink": "BlinkLens", "Spin": "SpinCrystal"}.get(nm, nm + "Mesh"))
            child.data.transform(Matrix.Translation(-loc))
            child.matrix_world = Matrix.Identity(4)
            child.parent = e
            tris += tri_count(child)
    mats = sorted({m.name for m in body.data.materials if m})
    STATS.append((model.name, tris, lo, hi, mats, [c[0] for c in model.cols], [m[0] for m in model.marks]))
    print(f"MODEL {model.name}: tris {tris}  bounds {tuple(round(c, 2) for c in lo)} .. {tuple(round(c, 2) for c in hi)}")
    print(f"   materials {mats}")
    print(f"   markers {[m[0] for m in model.marks]}  colliders {len(model.cols)}")

# export (only the model trees)
export_obs = []
for root in ROOTS.values():
    export_obs.append(root)
    export_obs += list(root.children_recursive)
select_only(export_obs, active=export_obs[0])
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True, use_selection=True,
                          export_extras=True)


def clean_glb_names(path):
    """Strip Blender's '.001' uniqueness suffixes from node / mesh names."""
    data = open(path, "rb").read()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen])
    rest = data[20 + clen:]
    for key in ("nodes", "meshes"):
        for n in js.get(key, []):
            if "name" in n:
                n["name"] = re.sub(r"\.\d{3}$", "", n["name"])
    new = json.dumps(js, separators=(",", ":")).encode()
    new += b" " * ((4 - len(new) % 4) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(new) + len(rest)) + struct.pack("<II", len(new), ctype) + new + rest
    open(path, "wb").write(out)


clean_glb_names(OUT)
print("EXPORTED", OUT, os.path.getsize(OUT))


# =====================================================================================  previews
def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


EYE_DIR = {"outpost_1": (-0.2, -1.0), "monolith_1": (0.25, -1.0)}
if PREVIEW_DIR:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.36, 0.42, 0.52, 1)
    bg.inputs["Strength"].default_value = 0.6
    scene.world = world
    for nm, energy, rot in (("key", 4.0, (52, 6, -28)), ("fill", 0.8, (70, -10, 160))):
        L = bpy.data.lights.new(nm, "SUN")
        L.energy = energy
        L.angle = rad(2)
        lo_ = bpy.data.objects.new(nm, L)
        COLL.objects.link(lo_)
        lo_.rotation_euler = tuple(rad(v) for v in rot)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=160, segments=64)
    me = bpy.data.meshes.new("Floor")
    bm.to_mesh(me)
    bm.free()
    floor = bpy.data.objects.new("Floor", me)
    COLL.objects.link(floor)
    me.materials.append(mat("FloorMat", (0.2, 0.18, 0.15), 0.0, 0.85))
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 32
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = True
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 1100, 720
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    COLL.objects.link(cam)
    scene.camera = cam
    cam_data.clip_start = 0.1
    cam_data.clip_end = 600
    colmat = mat("ColDebug", (1, 0.1, 0.1), 0.0, 0.5, emission=(1, 0.1, 0.1), strength=2.0)
    for o in scene.objects:
        if o.name.startswith("COL_"):
            o.data.materials.append(colmat)
            w = o.modifiers.new("wire", "WIREFRAME")
            w.thickness = 0.06
    for name, root in ROOTS.items():
        tree = set([root] + list(root.children_recursive))
        for o in scene.objects:
            if o.type in ("MESH", "CURVE") and o is not floor:
                o.hide_render = (o not in tree) or o.name.startswith("COL_")
        st = next(s for s in STATS if s[0] == name)
        lo, hi = st[2].copy(), st[3].copy()
        lo.z = 0.0
        c = (lo + hi) / 2
        R = (hi - lo).length / 2
        Rxy = (hi - lo).to_2d().length / 2
        ip = next((o.matrix_world.translation for o in root.children if o.name.startswith("Interact")), c)

        def fit(lens, margin=1.0):
            fov_v = 2 * math.atan(18.0 / lens * 720 / 1100)
            return R / math.sin(fov_v / 2) * margin

        def dirv(x, y, z):
            return Vector((x, y, z)).normalized()

        views = {
            "eye": dict(loc=c + dirv(*EYE_DIR.get(name, (0.55, -0.83)), 0) * max(0.78 * Rxy / 0.75, 0.55 * hi.z / 0.49),
                        z=1.7,
                        tgt=Vector((c.x, c.y, min(hi.z * 0.4, 7.0))), lens=24),
            "high": dict(loc=c + dirv(-0.55, -0.7, 0.62) * fit(30, 0.85), tgt=c, lens=30),
            "back": dict(loc=c + dirv(0.62, 0.72, 0.35) * fit(30, 0.9), tgt=c, lens=30),
            "close": dict(loc=ip + Vector((-1.6, -4.2, 0)), z=ip.z + 1.25, tgt=ip + Vector((0.3, 1.6, 0.7)), lens=24),
        }
        if os.environ.get("STRUCT_COLS"):
            views = {"cols": dict(views["high"])}
        for vn, v in views.items():
            if VIEWS and vn not in VIEWS and vn != "cols":
                continue
            for o in tree:
                if o.name.startswith("COL_"):
                    o.hide_render = vn != "cols"
            loc = Vector(v["loc"])
            if "z" in v:
                loc.z = v["z"]
            cam.location = loc
            look_at(cam, v["tgt"])
            cam_data.lens = v["lens"]
            scene.render.filepath = os.path.join(PREVIEW_DIR, f"{name}_{vn}.png")
            bpy.ops.render.render(write_still=True)
            print("RENDERED", scene.render.filepath)
