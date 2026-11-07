"""Mesh operations on numpy arrays and bpy meshes: subdivision, projection onto a sculpt, tangential relaxation,
normals, attribute access."""
import bmesh
import bpy
import numpy as np


def coords(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_coords(me, co):
    me.vertices.foreach_set('co', np.asarray(co, float).ravel())
    me.update()


def attr(me, name):
    a = me.attributes[name]
    out = np.empty(len(a.data))
    a.data.foreach_get('value', out)
    return out


def set_attr(me, name, vals, domain='POINT', kind='FLOAT'):
    a = me.attributes.get(name) or me.attributes.new(name, kind, domain)
    a.data.foreach_set('value', np.asarray(vals, np.float32))


def edges(me):
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def neighbours(me):
    """CSR adjacency: (offsets, indices)."""
    e = edges(me)
    n = len(me.vertices)
    a = np.concatenate([e[:, 0], e[:, 1]])
    b = np.concatenate([e[:, 1], e[:, 0]])
    order = np.argsort(a, kind='stable')
    a, b = a[order], b[order]
    off = np.zeros(n + 1, np.int64)
    np.add.at(off, a + 1, 1)
    off = np.cumsum(off)
    return off, b


def boundary_verts(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    out = np.array([v.index for v in bm.verts if v.is_boundary], np.int64)
    bm.free()
    return out


def vertex_normals(me):
    me.update()
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def subdivide(obj, levels=1):
    """Catmull-Clark (subsurf modifier applied); attributes are interpolated."""
    md = obj.modifiers.new('cc', 'SUBSURF')
    md.levels = levels
    md.render_levels = levels
    md.boundary_smooth = 'ALL'
    md.use_creases = True
    md.use_limit_surface = False
    md.uv_smooth = 'PRESERVE_BOUNDARIES'
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=md.name)


def relax(me, co, fixed=None, iters=4, lam=0.5, normals=None):
    """Tangential Laplacian smoothing (keeps the surface, evens the quads)."""
    off, nb = neighbours(me)
    co = np.array(co, float)
    deg = np.diff(off)
    fixed_mask = np.zeros(len(co), bool)
    if fixed is not None and len(fixed):
        fixed_mask[fixed] = True
    for _ in range(iters):
        s = np.zeros_like(co)
        np.add.at(s, np.repeat(np.arange(len(co)), deg), co[nb])
        avg = s / np.maximum(deg, 1)[:, None]
        d = avg - co
        if normals is not None:
            d = d - np.einsum('ij,ij->i', d, normals)[:, None] * normals
        d[fixed_mask] = 0
        co = co + lam * d
    return co


def fit(obj, S, iters=3, relax_iters=3, fixed=None, project_iters=8, lam=0.45):
    """Projects the mesh onto the sculpt S, then alternates tangential relaxation and projection."""
    me = obj.data
    co = coords(me)
    co = S.project(co, iters=project_iters)
    set_coords(me, co)
    for _ in range(iters):
        nrm_ = vertex_normals(me)
        co = relax(me, co, fixed=fixed, iters=relax_iters, lam=lam, normals=nrm_)
        co = S.project(co, iters=4)
        set_coords(me, co)
    return co


def recalc_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def smooth_shade(me):
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    me.update()


def new_object(name, me, coll=None):
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o
