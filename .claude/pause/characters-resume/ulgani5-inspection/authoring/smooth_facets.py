"""Ixari suit fittings were authored flat-shaded, which reads as low-poly on curved plates.  This re-shades them smooth
and keeps a hard edge only where the faceting is deliberate: facet ridges and valleys, plate rims and side walls
(dihedral angle above `deg`).  Geometry, UVs and the baked maps are unchanged (the tangent-space normal maps hold only
the authored bump, so they ride on the new shading normals).
   Blender -b <src.blend> -P smooth_facets.py -- <out.blend> [deg=14]"""
import sys, math
import bpy, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
deg = float(argv[1]) if len(argv) > 1 else 14.0
cosmax = math.cos(math.radians(deg))
done = set()
for o in bpy.data.objects:
    if o.type != 'MESH' or o.data.name in done:
        continue
    me = o.data
    nf = len(me.polygons)
    if nf == 0:
        continue
    smooth = np.empty(nf, bool)
    me.polygons.foreach_get('use_smooth', smooth)
    if smooth.all():
        continue
    done.add(me.name)
    fn = np.empty(nf * 3, np.float32)
    me.polygons.foreach_get('normal', fn)
    fn = fn.reshape(-1, 3)
    # edge -> faces through the loops
    nl = len(me.loops)
    le = np.empty(nl, np.int64)
    me.loops.foreach_get('edge_index', le)
    lf = np.repeat(np.arange(nf), [len(p.loop_indices) for p in me.polygons])
    ne = len(me.edges)
    first = np.full(ne, -1, np.int64)
    second = np.full(ne, -1, np.int64)
    order = np.argsort(le, kind='stable')
    se, sf = le[order], lf[order]
    starts = np.r_[0, np.flatnonzero(np.diff(se)) + 1]
    counts = np.diff(np.r_[starts, len(se)])
    first[se[starts]] = sf[starts]
    two = counts >= 2
    second[se[starts[two]]] = sf[starts[two] + 1]
    sharp_attr = me.attributes.get('sharp_edge')
    sharp = np.zeros(ne, bool)
    if sharp_attr is not None:
        sharp_attr.data.foreach_get('value', sharp)
    has2 = second >= 0
    f1, f2 = first[has2], second[has2]
    flat_side = (~smooth[f1]) | (~smooth[f2])
    cosang = np.einsum('ij,ij->i', fn[f1], fn[f2])
    hard = flat_side & (cosang < cosmax)
    idx = np.flatnonzero(has2)
    sharp[idx[hard]] = True
    # an edge between a flat face and a face of another (smooth) layer keeps its hard break
    sharp[idx[flat_side & (smooth[f1] != smooth[f2])]] = True
    if sharp_attr is None:
        sharp_attr = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
    sharp_attr.data.foreach_set('value', sharp)
    me.polygons.foreach_set('use_smooth', np.ones(nf, bool))
    me.update()
    print('smoothed', me.name, 'custom' if me.attributes.get('custom_normal') else '-', int((~smooth).sum()), 'flat faces,', int(hard.sum()), 'hard edges')
print('meshes', len(done))
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('saved', out)
