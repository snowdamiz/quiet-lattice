"""UVs: seams on the cage (part boundaries + one longitudinal cut per tube on a hidden side), Blender's angle-based
unwrap, island scale averaging and packing, then placement of a part's islands into an atlas rectangle."""
import math

import bmesh
import bpy
import numpy as np

from .cage import PARTS

CODE = {v: k for k, v in PARTS.items()}


def _vattr(bm, name):
    lay = bm.verts.layers.float.get(name)
    return (lambda v: v[lay]) if lay else (lambda v: 0.0)


def face_part(bm):
    part = _vattr(bm, 'part')
    out = {}
    for f in bm.faces:
        codes = [int(round(part(v))) for v in f.verts]
        cnt = {}
        for c in codes:
            cnt[c] = cnt.get(c, 0) + 1
        best = max(cnt.values())
        out[f] = min(c for c, n in cnt.items() if n == best)
    return out


BODY_CUTS = {'arm': (-math.pi / 2, False), 'leg': (-math.pi / 2, True), 'foot': (-math.pi / 2, True),
             'hand': (3 * math.pi / 4, False), 'finger': (-3 * math.pi / 4, False), 'thumb': (-3 * math.pi / 4, False),
             'toe': (math.pi, True)}


def body_seams(me, cuts=BODY_CUTS):
    """cuts: part name -> angle (radians) of the longitudinal cut column (left side; the right mirrors as -angle)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    fp = face_part(bm)
    side = _vattr(bm, 'side')
    th = _vattr(bm, 'th')
    s_ = _vattr(bm, 's')
    part = _vattr(bm, 'part')

    def fkey(f):
        p = fp[f]
        if p == PARTS['torso']:
            return (p, 0)
        sd = np.sign(np.mean([side(v) for v in f.verts]))
        return (p, sd)
    for e in bm.edges:
        e.seam = False
        lf = e.link_faces
        if len(lf) == 2 and fkey(lf[0]) != fkey(lf[1]):
            e.seam = True
    # longitudinal cuts: edges whose both verts have the cut angle and the same part (consecutive rings)
    for e in bm.edges:
        a, b = e.verts
        pa, pb = int(round(part(a))), int(round(part(b)))
        if pa != pb:
            continue
        name = CODE.get(pa)
        if name not in cuts:
            continue
        sd = side(a)
        base, mir = cuts[name]
        ang = base * (1 if (sd >= 0 or not mir) else -1)
        da = abs(math.remainder(th(a) - ang, 2 * math.pi))
        db = abs(math.remainder(th(b) - ang, 2 * math.pi))
        if da < 0.05 and db < 0.05 and abs(s_(a) - s_(b)) > 1e-6:
            e.seam = True
    # torso: back midline (x ~ 0, y > 0)
    for e in bm.edges:
        a, b = e.verts
        if int(round(part(a))) == 0 and int(round(part(b))) == 0:
            if abs(a.co.x) < 1e-5 and abs(b.co.x) < 1e-5 and a.co.y > 0 and b.co.y > 0:
                e.seam = True
    bm.to_mesh(me)
    bm.free()


def unwrap(obj, method='ANGLE_BASED', margin=0.004, pack=True):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    obj.select_set(True)
    vl.objects.active = obj
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method=method, margin=margin)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    if pack:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def uv_array(me, layer=None):
    uvl = me.uv_layers[layer] if layer else me.uv_layers.active
    a = np.empty(len(me.loops) * 2)
    uvl.data.foreach_get('uv', a)
    return a.reshape(-1, 2), uvl


def place_in(me, rect, keep_aspect=True):
    """Moves all of the mesh's UVs (assumed within [0,1]) into rect = (u0, v0, u1, v1)."""
    a, uvl = uv_array(me)
    lo, hi = a.min(0), a.max(0)
    span = np.maximum(hi - lo, 1e-9)
    u0, v0, u1, v1 = rect
    W, H = u1 - u0, v1 - v0
    if keep_aspect:
        k = min(W / span[0], H / span[1])
        a = (a - lo) * k + np.array([u0, v0])
    else:
        a = (a - lo) / span * np.array([W, H]) + np.array([u0, v0])
    uvl.data.foreach_set('uv', a.ravel())
    me.update()


def uv_area_ratio(me):
    """3D area / UV area (for texel density checks)."""
    a, _ = uv_array(me)
    tri = 0.0
    uva = 0.0
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        tri += t.area
        p = a[list(t.loops)]
        uva += abs(np.cross(p[1] - p[0], p[2] - p[0])) / 2
    return tri, uva


def smart(obj, angle=66.0, margin=0.004):
    """Smart UV project for grown parts (faceted crystals, fronds): one island per facet group."""
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    obj.select_set(True)
    vl.objects.active = obj
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def degenerate(me):
    if not me.uv_layers:
        return True
    a, _ = uv_array(me)
    return float(np.ptp(a[:, 0])) < 1e-6 and float(np.ptp(a[:, 1])) < 1e-6
