"""Builds assets/blend/characters/<people>.blend: the shared skeleton, the people's body, six heads and four suits,
weights, blendshapes, UVs, baked 4k texture sets, hand-made LODs, the validator's collection layout and REF.

  Blender -b --factory-startup -P build.py -- <people> <out.blend> [--res 4096] [--heads 1,2,..] [--suits 1,..]
"""
import importlib
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import anatomy, bake, cage, head, heads, mesh, pack, peoples, shaders, shapes, skel, uv, weights  # noqa: E402

ARGV = sys.argv[sys.argv.index('--') + 1:]
PEOPLE = ARGV[0]
OUT = os.path.abspath(ARGV[1])


def opt(flag, default):
    if flag in ARGV:
        return ARGV[ARGV.index(flag) + 1]
    return default


RES = int(opt('--res', 1024))
HEADS = [int(x) for x in opt('--heads', '1').split(',') if x]
SUITS = [int(x) for x in opt('--suits', '').split(',') if x]
TEX_DIR = os.path.abspath(opt('--tex', os.path.join(os.path.dirname(OUT), 'textures', PEOPLE)))
ABBR = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[PEOPLE]
T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


# ---------------------------------------------------------------------------------------------- geometry
def build_body(ctx, S, P):
    sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
    sd['torso_arm'] = S.subset(['torso', 'arm'])
    sd['leg_foot'] = S.subset(['leg', 'foot'])
    C, neck = cage.build_body(ctx, sd, P)
    me = C.to_mesh(bpy, f'{ABBR}_Body')
    ob = mesh.new_object(f'{ABBR}_Body', me)
    mesh.recalc_normals(ob)
    uv.body_seams(ob.data)
    uv.unwrap(ob, pack=False)
    mesh.subdivide(ob, 2)
    cage.resolve_parts(ob.data)
    mesh.fit(ob, S, iters=3, fixed=mesh.boundary_verts(ob.data))
    soften_junction(ob, 1, 0)
    soften_junction(ob, 7, 4, hops=3, iters=6)
    mesh.smooth_shade(ob.data)
    return ob, np.array(C.co)[neck]


def soften_junction(ob, pa, pb, hops=5, iters=10):
    """Where one part's root loop meets another (the arm the torso, the toes the forefoot) the fit leaves a crease or
    small folds (a dark notch across the top of the shoulder, flaps at the forks between the toes): Taubin smoothing
    over the band round that loop closes them."""
    from lib import suits as SU
    me = ob.data
    part = np.rint(mesh.attr(me, 'part')).astype(int)
    off, nb = mesh.neighbours(me)
    seeds = [i for i in np.nonzero(part == pa)[0] if (part[nb[off[i]:off[i + 1]]] == pb).any()]
    hd = SU.hop_distance(me, seeds, hops + 1)
    co = mesh.coords(me)
    fixed = np.nonzero(hd > hops)[0]
    for _ in range(iters):
        # (Taubin: a shrinking step then an inflating one, so the shoulder keeps its volume)
        co = mesh.relax(me, co, fixed=fixed, iters=1, lam=0.5)
        co = mesh.relax(me, co, fixed=fixed, iters=1, lam=-0.53)
    mesh.set_coords(me, co)


def hires_body(body, S, level=2, reach=0.004):
    """A denser copy of the body (two more subdivision levels) projected onto the sculpt, for the normal bake: the
    landmarks smaller than the LOD0 grid (tendons, knuckles, rib edges, the kneecap's rim) reach the normal map from
    here.  Points the LOD0 deliberately leaves off the sculpt (the smoothed shoulder and toe roots) keep their
    subdivided place: the projection fades out over `reach` of displacement."""
    hi = body.copy()
    hi.data = body.data.copy()
    hi.name = hi.data.name = body.name + '_hi'
    bpy.context.scene.collection.objects.link(hi)
    for g in list(hi.vertex_groups):
        hi.vertex_groups.remove(g)
    mesh.subdivide(hi, level)
    co = mesh.coords(hi.data)
    fixed = np.zeros(len(co), bool)
    fixed[mesh.boundary_verts(hi.data)] = True
    pr = S.project(co, iters=5, mask=~fixed)
    d = np.linalg.norm(pr - co, axis=1)
    w = np.clip(1.0 - (d - reach * 0.5) / reach, 0.0, 1.0)[:, None]
    mesh.set_coords(hi.data, co + (pr - co) * w)
    mesh.smooth_shade(hi.data)
    return hi


def patch_mask(body, hops=4):
    """1 on the hands, fingers, feet and toes, on a band round the neck edge and round the arm and leg roots (the
    armpits and the crotch, where two surfaces lie within the cage's reach), fading over a couple of rings: the texels
    bake.patch_normal takes from the plain normal bake."""
    from lib import suits as SU
    me = body.data
    part = np.rint(mesh.attr(me, 'part')).astype(int)
    m = np.isin(part, [cage.PARTS[k] for k in ('hand', 'finger', 'thumb', 'foot', 'toe')]).astype(float)
    hd = SU.hop_distance(me, np.nonzero(m > 0.5)[0], 3)
    m = np.maximum(m, np.clip(1.0 - hd / 3.0, 0.0, 1.0))
    hn = SU.hop_distance(me, mesh.boundary_verts(me), hops + 3)
    m = np.maximum(m, np.clip((hops + 2 - hn) / 3.0, 0.0, 1.0))
    off, nb = mesh.neighbours(me)
    roots = [i for i in np.nonzero(np.isin(part, (cage.PARTS['arm'], cage.PARTS['leg'])))[0]
             if (part[nb[off[i]:off[i + 1]]] == cage.PARTS['torso']).any()]
    hr = SU.hop_distance(me, roots, hops + 3)
    return np.maximum(m, np.clip((hops + 2 - hr) / 3.0, 0.0, 1.0))


def head_seams(bm):
    th = bm.verts.layers.float.get('th')
    s = bm.verts.layers.float.get('s')
    reg = bm.verts.layers.float.get('reg')
    last_s = max(v[s] for v in bm.verts if v[s] < 0.99)
    for e in bm.edges:
        a, b = e.verts
        e.seam = False
        # back midline of the 32-around rings
        if abs(math.remainder(a[th] - math.pi, 2 * math.pi)) < 0.02 and abs(math.remainder(b[th] - math.pi, 2 * math.pi)) < 0.02 \
                and abs(a[s] - b[s]) > 1e-6 and a[s] < 0.99 and b[s] < 0.99 and abs(a.co.y) > 0 and a.co.y > 0:
            e.seam = True
        # crown cap boundary
        if abs(a[s] - last_s) < 1e-6 and abs(b[s] - last_s) < 1e-6:
            e.seam = True
    # mouth bag
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2:
            m0 = any(round(v[reg]) == head.REG['mouth'] for v in fs[0].verts)
            m1 = any(round(v[reg]) == head.REG['mouth'] for v in fs[1].verts)
            if m0 != m1:
                e.seam = True


def build_head(ctx, S, P, neck_pts, k):
    H = HEADDEFS[k]
    HS = head.head_sdf(ctx, P, H, S)
    HC, info = head.build_head_cage(ctx, HS, neck_pts, H)
    bm = head.to_bmesh(HC)
    eyes = []
    for e in H.get('eyes', []):
        for side in (1, -1):
            eyes.append(head.add_eye(bm, info, ctx, H, e, side, HS))
    mo = head.add_mouth(bm, info, ctx, H, H['mouth'], HS)
    head._layers(bm)
    head.region_masks(bm)
    head_seams(bm)
    me = bpy.data.meshes.new(f'{ABBR}_Head{k}')
    bm.to_mesh(me)
    bm.free()
    ob = mesh.new_object(f'{ABBR}_Head{k}', me)
    uv.unwrap(ob, pack=False)
    mesh.subdivide(ob, 2)
    head.fit_head(ob, HS, eyes, iters=3)
    mesh.smooth_shade(ob.data)
    eyeobs = []
    for i, e in enumerate(eyes):
        em = head.eyeball(bpy, f'{ABBR}_Eye{k}_{i}', e['E'], e['n'], e['u'], e['v'], e['r'])
        eo = mesh.new_object(f'{ABBR}_Eye{k}_{i}', em)
        eyeobs.append((eo, e))
    accs = heads.accessories(ctx, H, HS, f'{ABBR}_Acc{k}')
    mo['w'] = H['mouth']['w'] * ctx.s
    if PEOPLE == 'thalune':
        for i, e in enumerate(eyes):
            nm = head.nictitating(bpy, f'{ABBR}_Nict{k}_{i}', e['E'], e['n'], e['u'], e['v'], e['r'], e['spec'])
            no = mesh.new_object(f'{ABBR}_Nict{k}_{i}', nm)
            no['nict'] = 'lid_nict_L' if e['E'][0] > 0 else 'lid_nict_R'
            accs.append(no)
    return ob, eyeobs, eyes, mo, H, accs


# ---------------------------------------------------------------------------------------------- the neck seam
def weld_seam(body, h, hops=6):
    """Welds a head to the body: the head's neck boundary takes the body boundary's exact positions, and the offset
    fades into the head over a few rings (the two sculpts differ slightly at the neck, which opened a crack)."""
    from lib import suits as SU
    bco = mesh.coords(body.data)
    bb = mesh.boundary_verts(body.data)
    hco = mesh.coords(h.data)
    hb = mesh.boundary_verts(h.data)
    d = np.linalg.norm(hco[hb, None] - bco[bb][None], axis=2)
    k = np.argmin(d, axis=1)
    sel = d[np.arange(len(hb)), k] < 0.02
    seam, tgt = hb[sel], bco[bb[k[sel]]]
    delta = tgt - hco[seam]
    hd = SU.hop_distance(h.data, seam, hops + 1)
    near = np.nonzero(hd <= hops)[0]
    j = np.argmin(np.linalg.norm(hco[near, None] - hco[seam][None], axis=2), axis=1)
    f = (1 - hd[near] / (hops + 1)) ** 2
    hco[near] += delta[j] * f[:, None]
    hco[seam] = tgt
    mesh.set_coords(h.data, hco)
    log('weld', h.name, int(sel.sum()), 'seam verts, max gap', round(float(np.abs(delta).max()) if len(delta) else 0.0, 4))


def rigid_components(ob, A):
    """Each connected piece (a crystal with its socket collar) takes the weights at its root, so it rides the bone
    rigidly instead of sinking into the bending skin."""
    me = ob.data
    nv = len(me.vertices)
    parent = np.arange(nv)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    ev = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', ev)
    for a, b in ev.reshape(-1, 2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    comp = np.array([find(i) for i in range(nv)])
    gv = mesh.attr(me, 'gv') if 'gv' in me.attributes else np.zeros(nv)
    out = A.copy()
    for c in np.unique(comp):
        idx = np.nonzero(comp == c)[0]
        root = idx[gv[idx] <= gv[idx].min() + 0.02]
        w = A[root].mean(0)
        out[idx] = w / max(w.sum(), 1e-9)
    return out


def mark_acc(ob, n0):
    """Vertex group 'acc' on the vertices from index n0 on (joined accessories): the LOD builder decimates those by
    collapse and the skin by un-subdividing."""
    g = ob.vertex_groups.get('acc') or ob.vertex_groups.new(name='acc')
    idx = list(range(n0, len(ob.data.vertices)))
    if idx:
        g.add(idx, 1.0, 'REPLACE')


# ---------------------------------------------------------------------------------------------- UV atlas
def atlas(body, heads, head_boost=1.35, margin=0.005):
    """Body and every head share the Skin atlas; faces get 1.35x the body's texel density."""
    pack.pack([body] + list(heads), boosts=[1.0] + [head_boost] * len(heads), margin=margin)


# ---------------------------------------------------------------------------------------------- normals across the seam
def seam_normals(body, heads):
    """Body and every head share the neck boundary: give both sides the same averaged normals there."""
    bco = mesh.coords(body.data)
    bn = mesh.vertex_normals(body.data)
    bb = mesh.boundary_verts(body.data)
    for h in heads:
        hco = mesh.coords(h.data)
        hn = mesh.vertex_normals(h.data)
        hb = mesh.boundary_verts(h.data)
        d = np.linalg.norm(hco[hb, None] - bco[bb][None], axis=2)
        k = np.argmin(d, axis=1)
        ok = d[np.arange(len(hb)), k] < 1e-4
        avg = hn[hb] + bn[bb[k]]
        avg /= np.linalg.norm(avg, axis=1, keepdims=True)
        hn2 = hn.copy()
        hn2[hb[ok]] = avg[ok]
        h.data.normals_split_custom_set_from_vertices(hn2)
        bn2 = bn.copy()
        bn2[bb[k[ok]]] = avg[ok]
        body.data.normals_split_custom_set_from_vertices(bn2)


# ---------------------------------------------------------------------------------------------- materials
def bake_skin(body, heads, auth, res, hi=None):
    mats = []
    for o in [body] + heads + ([hi] if hi else []):
        o.data.materials.clear()
        o.data.materials.append(auth)
    p = next(n for n in auth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    base = bake.new_image(f'{ABBR}_Skin_base', res, True)
    bake.bake_pass(auth, [body] + heads, base, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
    rough = bake.new_image(f'{ABBR}_Skin_rough', res, False)
    bake.bake_pass(auth, [body] + heads, rough, 'EMIT', p.inputs['Roughness'].links[0].from_socket, samples=1)
    nrm = bake.new_image(f'{ABBR}_Skin_normal', res, False, (0.5, 0.5, 1, 1))
    if hi is not None:
        bake.bake_normal_from(body, hi, nrm, samples=4)
        mesh.set_attr(body.data, 'patch', patch_mask(body))
        bake.patch_normal(nrm, body, auth, res)
        bake.bake_pass(auth, heads, nrm, 'NORMAL', samples=4, clear=False)
    else:
        bake.bake_pass(auth, [body] + heads, nrm, 'NORMAL', samples=4)
    # (occlusion is soft: baked at half resolution and scaled up, a quarter of the bake time)
    ao = bake.new_image(f'{ABBR}_Skin_ao', res // 2, False, (1, 1, 1, 1))
    bake.bake_pass(auth, [body], ao, 'AO', samples=32, occluders=[heads[0]])
    for h in heads:
        bake.bake_pass(auth, [h], ao, 'AO', samples=32, occluders=[body], clear=False)
    orm = bake.pack_orm(f'{ABBR}_Skin_orm', ao, rough, None, res)
    base = bake.save_jpeg(base, os.path.join(TEX_DIR, f'{ABBR}_Skin_base.jpg'))
    orm = bake.save_jpeg(orm, os.path.join(TEX_DIR, f'{ABBR}_Skin_orm.jpg'))
    nrm = bake.save_jpeg(nrm, os.path.join(TEX_DIR, f'{ABBR}_Skin_normal.jpg'), 95)
    for img in (ao, rough):
        bpy.data.images.remove(img)
    m = bake.final_material(f'{ABBR}_Skin', base, orm, nrm, engine_name='Skin', metallic_from_orm=False)
    for o in [body] + heads:
        o.data.materials.clear()
        o.data.materials.append(m)
    return m


def bake_eyes(eyeobs, auth, res):
    objs = [eo for eo, _ in eyeobs]
    # one shared polar layout: bake from the first eye only (all eyes share UVs)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(auth)
    p = next(n for n in auth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    base = bake.new_image(f'{ABBR}_Eye_base', res, True)
    bake.bake_pass(auth, objs[:1], base, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
    rough = bake.new_image(f'{ABBR}_Eye_rough', res, False)
    bake.bake_pass(auth, objs[:1], rough, 'EMIT', p.inputs['Roughness'].links[0].from_socket, samples=1)
    nrm = bake.new_image(f'{ABBR}_Eye_normal', res, False, (0.5, 0.5, 1, 1))
    bake.bake_pass(auth, objs[:1], nrm, 'NORMAL', samples=4)
    ao = bake.new_image(f'{ABBR}_Eye_ao', res, False, (1, 1, 1, 1))
    bake.bake_pass(auth, objs[:1], ao, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
    A = bake.pixels(ao)
    A[..., :3] = 0.82 + 0.18 * (A[..., :3] / max(A[..., :3].max(), 1e-6))
    ao.pixels.foreach_set(A.ravel())
    orm = bake.pack_orm(f'{ABBR}_Eye_orm', ao, rough, None, res)
    base = bake.save_jpeg(base, os.path.join(TEX_DIR, f'{ABBR}_Eye_base.jpg'))
    orm = bake.save_jpeg(orm, os.path.join(TEX_DIR, f'{ABBR}_Eye_orm.jpg'))
    nrm = bake.save_jpeg(nrm, os.path.join(TEX_DIR, f'{ABBR}_Eye_normal.jpg'), 95)
    for img in (ao, rough):
        bpy.data.images.remove(img)
    m = bake.final_material(f'{ABBR}_Eye', base, orm, nrm, engine_name='Eye', metallic_from_orm=False)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)
    return m


BIO = {'thalune': 'thalune_fin', 'ixari': 'ixari_crystal', 'ulgani': 'ulgani_frond'}
BIONAME = {'thalune': 'Fin', 'ixari': 'Crystal', 'ulgani': 'Frond'}


def pack_alone(objs, margin=0.0012):
    # (a suit set has hundreds of small islands: a wider margin per island left most of the 4k map empty)
    pack.pack(list(objs), margin=margin)


def bake_bio(objs, groups, auth, res):
    """groups: (accessories, occluders) per head and for the body: the six heads' crests share one place, so each
    group's occlusion is baked with only its own head and the body round it."""
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(auth)
    p = next(n for n in auth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    name = f'{ABBR}_{BIONAME[PEOPLE]}'
    base = bake.new_image(f'{name}_base', res, True)
    bake.bake_pass(auth, objs, base, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
    rough = bake.new_image(f'{name}_rough', res, False)
    bake.bake_pass(auth, objs, rough, 'EMIT', p.inputs['Roughness'].links[0].from_socket, samples=1)
    nrm = bake.new_image(f'{name}_normal', res, False, (0.5, 0.5, 1, 1))
    bake.bake_pass(auth, objs, nrm, 'NORMAL', samples=4)
    ao = bake.new_image(f'{name}_ao', res // 2, False, (1, 1, 1, 1))
    for i, (grp, occ) in enumerate(groups):
        bake.bake_pass(auth, grp, ao, 'AO', samples=24, occluders=occ, clear=(i == 0))
    emis = None
    if p.inputs['Emission Strength'].default_value > 0 and p.inputs['Emission Color'].is_linked:
        emis = bake.new_image(f'{name}_emissive', res, True, (0, 0, 0, 1))
        bake.bake_pass(auth, objs, emis, 'EMIT', p.inputs['Emission Color'].links[0].from_socket, samples=1)
        emis = bake.save_jpeg(emis, os.path.join(TEX_DIR, f'{name}_emissive.jpg'))
    orm = bake.pack_orm(f'{name}_orm', ao, rough, None, res)
    base = bake.save_jpeg(base, os.path.join(TEX_DIR, f'{name}_base.jpg'))
    orm = bake.save_jpeg(orm, os.path.join(TEX_DIR, f'{name}_orm.jpg'))
    nrm = bake.save_jpeg(nrm, os.path.join(TEX_DIR, f'{name}_normal.jpg'), 95)
    for img in (ao, rough):
        bpy.data.images.remove(img)
    m = bake.final_material(name, base, orm, nrm, emissive=emis, emissive_strength=p.inputs['Emission Strength'].default_value,
                            engine_name='Bio', metallic_from_orm=False)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)
    return m


def group_weights(ob, name):
    g = ob.vertex_groups.get(name)
    w = np.zeros(len(ob.data.vertices))
    if g is None:
        return w
    for v in ob.data.vertices:
        for gg in v.groups:
            if gg.group == g.index:
                w[v.index] = gg.weight
    return w


def make_shapes(ob, ctx, eyes, mo, s):
    me = ob.data
    fl = me.attributes.get('flare')
    flare = None
    if fl is not None:
        flare = np.empty(len(me.vertices) * 3)
        fl.data.foreach_get('vector', flare)
        flare = flare.reshape(-1, 3)
    rigid = np.max([group_weights(ob, b + sfx) for b in ('eye', 'eye_upper', 'lid_nict') for sfx in ('_L', '_R')], axis=0)
    info = dict(jaw_w=group_weights(ob, 'jaw'), lid_up={sfx: group_weights(ob, 'lid_upper' + sfx) for sfx in ('_L', '_R')},
                lid_lo={sfx: group_weights(ob, 'lid_lower' + sfx) for sfx in ('_L', '_R')}, eyes=eyes, zc=mo['zc'],
                w=mo['w'], M=mo['M'], flare=flare, s=s, nict={sfx: group_weights(ob, 'lid_nict' + sfx) for sfx in ('_L', '_R')},
                rigid=rigid)
    shapes.build(ob, ctx, info)


# ---------------------------------------------------------------------------------------------- LODs
def decimate_copy(src, name, ratio, coll_, level=0, grid=True):
    """LOD n of a part.  Subdivided skin (body, heads) is un-subdivided `level` times (clean quads, no slivers: the cage
    topology the surface was grown from); joined accessories (group 'acc') and anything else are collapsed so the part
    lands near `ratio` of its LOD0 triangles.  Suits are collapsed (they are not subdivision surfaces)."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = name
    o.data.name = name
    coll_.objects.link(o)
    if o.data.shape_keys is not None:
        o.shape_key_clear()
    t0 = tris(src)

    def apply(md):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
            bpy.ops.object.modifier_apply(modifier=md.name)
    if ratio < 1.0:
        if grid and level > 0:
            # cut along the UV island borders first, so no merged face spans two islands (which drew black bands
            # across the atlas gap), un-subdivide, then weld the cut back together
            bm = bmesh.new()
            bm.from_mesh(o.data)
            uvl = bm.loops.layers.uv.active
            cut = []
            for e in bm.edges:
                if len(e.link_faces) != 2:
                    continue
                f0, f1 = e.link_faces
                a = {l.vert.index: l[uvl].uv.copy() for l in f0.loops}
                b = {l.vert.index: l[uvl].uv.copy() for l in f1.loops}
                if any((a[v.index] - b[v.index]).length > 1e-6 for v in e.verts):
                    cut.append(e)
            bmesh.ops.split_edges(bm, edges=cut)
            bm.to_mesh(o.data)
            bm.free()
            md = o.modifiers.new('unsub', 'DECIMATE')
            md.decimate_type = 'UNSUBDIV'
            md.iterations = level * 2   # one Catmull-Clark level back is two un-subdivide passes
            apply(md)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bm.to_mesh(o.data)
            bm.free()
            acc = o.vertex_groups.get('acc')
            t1 = tris(o)
            if acc is not None and t1 > ratio * t0 * 1.05:
                # collapse the accessories only, to bring the part near the target
                nacc = sum(1 for v in o.data.vertices for g_ in v.groups if g_.group == acc.index and g_.weight > 0.5)
                frac = nacc / max(len(o.data.vertices), 1)
                want = max(0.06, 1.0 - (t1 - ratio * t0) / max(t1 * frac, 1))
                md = o.modifiers.new('dec', 'DECIMATE')
                md.decimate_type = 'COLLAPSE'
                md.ratio = want
                md.vertex_group = 'acc'
                md.use_collapse_triangulate = True
                apply(md)
        else:
            md = o.modifiers.new('dec', 'DECIMATE')
            md.decimate_type = 'COLLAPSE'
            md.ratio = ratio
            md.use_collapse_triangulate = True
            apply(md)
        if o.data.has_custom_normals:
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
    return o


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


# ---------------------------------------------------------------------------------------------- REF
def refs(c):
    me = bpy.data.meshes.new('REF_Grid')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=20, y_segments=20, size=10)
    bm.to_mesh(me)
    bm.free()
    c.objects.link(bpy.data.objects.new('REF_Grid', me))
    # the 1.85 m biped: the canonical skeleton's neutral body, a low-resolution mannequin
    bs = skel.bones('canon')
    ctx = anatomy.Ctx(bs, 1.0)
    S, P = peoples.body_sdf(ctx, 'canon')
    from lib import preview
    S.add(__import__('lib.sdf', fromlist=['Ellipsoid']).Ellipsoid(bs['head']['head'] + np.array([0, -0.01, 0.12]), (0.078, 0.095, 0.115)), 0.03, 'torso')
    mo = preview.sdf_mesh(S, (-0.75, -0.3, -0.01), (0.75, 0.3, 1.9), 0.012, name='REF_Biped', path=os.path.join(TEX_DIR, '_ref.vdb'))
    co = mesh.coords(mo.data)
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    co[:, 2] = (co[:, 2] - zmin) / (zmax - zmin) * 1.85
    mesh.set_coords(mo.data, co)
    bpy.context.scene.collection.objects.unlink(mo)
    c.objects.link(mo)
    md = mo.modifiers.new('dec', 'DECIMATE')
    md.ratio = 0.15
    with bpy.context.temp_override(object=mo, active_object=mo):
        bpy.ops.object.modifier_apply(modifier='dec')


# ---------------------------------------------------------------------------------------------- main
HEADDEFS = {}


def skin_kwargs(ctx):
    if PEOPLE == 'ulgani':
        M = np.array([-1.0, 1.0, 1.0])
        return dict(slits=[ab for a, b in peoples.SLITS for ab in ((a, b), (a * M, b * M))])
    if PEOPLE != 'thalune':
        return {}
    s = ctx.s
    base = ctx.bs['head']['head']
    marks = []
    for sd in (1, -1):
        M = np.array([sd, 1, 1.0])
        E = ctx.bs['eye_L']['head'] * M
        snout = (base + np.array([0.012, -0.09, 0.052]) * s) * M
        frill = (base + np.array([0.058, 0.022, 0.014]) * s) * M
        marks += [(snout, E, 0.005 * s, 0.017 * s), (E, frill, 0.017 * s, 0.009 * s)]
    return dict(marks=marks)


def join(into, others):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    into.select_set(True)
    vl.objects.active = into
    bpy.ops.object.join()
    return into


def weights_from_bidx(body, fab, rig):
    names = [g.name for g in body.vertex_groups]
    W = np.zeros((len(body.data.vertices), len(names)))
    for v in body.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    ia = np.empty(len(fab.data.vertices), np.int32)
    fab.data.attributes['bidx'].data.foreach_get('value', ia)
    A = W[ia]
    keep = A.max(0) > 0
    weights.apply(fab, [n for n, k in zip(names, keep) if k], A[:, keep], rig)


def rigid_weights(body, o, rig):
    an, aA = weights.copy_nearest(body, o)
    c = mesh.coords(o.data).mean(0)
    k = weights.nearest(mesh.coords(o.data), c[None])[0]
    weights.apply(o, an, np.repeat(aA[k:k + 1], len(aA), 0), rig)


def build_suit(k, bmap, body, coords, S, rig):
    from lib import suitdefs
    pieces = suitdefs.SUITS[PEOPLE][k](bmap, body, coords, S)
    objs = []
    fab = None
    for name, me, rigid in pieces:
        o = mesh.new_object(f'{ABBR}_Suit{k}_{name}', me)
        if name == 'fabric':
            weights_from_bidx(body, o, rig)
            fab = o
        elif rigid:
            rigid_weights(body, o, rig)
        else:
            an, aA = weights.copy_nearest(body, o)
            weights.apply(o, an, aA, rig)
        objs.append(o)
    covered = np.zeros(len(body.data.vertices), bool)
    ia = np.empty(len(fab.data.vertices), np.int32)
    fab.data.attributes['bidx'].data.foreach_get('value', ia)
    covered[ia] = True
    suit = join(objs[0], objs[1:])
    suit.name = f'{ABBR}_Suit{k}'
    suit.data.name = suit.name
    return suit, covered


def body_subset(body, covered, name, margin=3):
    """The body faces a suit leaves visible, plus a margin tucked under the suit's edges."""
    from lib import suits as SU
    nbody = len(covered)
    me = body.data
    unc = np.nonzero(~covered)[0]
    unc = unc[unc < len(me.vertices)]
    hd = SU.hop_distance(me, unc, margin + 2)
    keep_v = np.zeros(len(me.vertices), bool)
    keep_v[:] = hd <= margin
    # vertices beyond the body (joined accessories) are always kept, except a dorsal fin under the suit
    keep_v[nbody:] = True
    if 'dorsal' in me.attributes:
        keep_v &= mesh.attr(me, 'dorsal') < 0.5
    o = body.copy()
    o.data = body.data.copy()
    o.name = name
    o.data.name = name
    bpy.context.scene.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    drop = [f for f in bm.faces if not any(keep_v[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    os.makedirs(TEX_DIR, exist_ok=True)
    bs = skel.bones(PEOPLE)
    s = skel.PEOPLE[PEOPLE]['scale']
    ctx = anatomy.Ctx(bs, s)
    S, P = peoples.body_sdf(ctx, PEOPLE)
    sd = {t: S.subset([t]) for t in ('torso', 'arm', 'hand', 'leg', 'foot')}
    from lib import suits as SU
    bmap = SU.BodyMap(ctx, S, sd)
    for k in HEADS:
        HEADDEFS[k] = heads.head_def(PEOPLE, k)
    log('body')
    body, neck_pts = build_body(ctx, S, P)
    body_hi = hires_body(body, S)
    log('body hi', len(body_hi.data.vertices))
    coords = SU.body_coords(body.data, ctx, bmap)
    mesh.set_attr(body.data, 'bs', coords[2])
    mesh.set_attr(body.data, 'bth', coords[3])
    body_acc = heads.body_accessories(ctx, bmap, PEOPLE, f'{ABBR}_BodyAcc')
    heads_ = {}
    for k in HEADS:
        log('head', k)
        heads_[k] = build_head(ctx, S, P, neck_pts, k)
    for k in HEADS:
        weld_seam(body, heads_[k][0])
    work = bpy.context.scene.collection
    rig = skel.build_armature(bpy, f'RIG_{PEOPLE}', PEOPLE, work)
    log('weights')
    names, A = weights.body(body.data, bs, s, PEOPLE)
    weights.apply(body, names, A, rig)
    bb = mesh.boundary_verts(body.data)
    seam = (mesh.coords(body.data)[bb], names, A[bb])
    for ao in body_acc:
        an, aA = weights.copy_nearest(body, ao)
        if PEOPLE == 'ixari':
            aA = rigid_components(ao, aA)
        weights.apply(ao, an, aA, rig)
    for k, (ob, eyeobs, eyes, mo, H, accs) in heads_.items():
        hn, hA = weights.head(ob.data, bs, s, eyes, mo['zc'], seam=seam)
        weights.apply(ob, hn, hA, rig)
        for eo, e in eyeobs:
            side = '_L' if e['E'][0] > 0 else '_R'
            bone = ('eye_upper' if e.get('upper') else 'eye') + side
            weights.apply(eo, [bone], np.ones((len(eo.data.vertices), 1)), rig)
        for ao in accs:
            if ao.get('nict'):
                weights.apply(ao, [ao['nict']], np.ones((len(ao.data.vertices), 1)), rig)
                continue
            an, aA = weights.copy_nearest(ob, ao)
            if PEOPLE == 'ulgani' and 'gv' in ao.data.attributes:
                an, aA = weights.crest(ao.data, bs, s, an, aA, mesh.attr(ao.data, 'gv'))
            weights.apply(ao, an, aA, rig)
    suits_ = {}
    for k in SUITS:
        log('suit', k)
        suits_[k] = build_suit(k, bmap, body, coords, S, rig)
    log('uv atlas')
    headobs = [h[0] for h in heads_.values()]
    atlas(body, headobs)
    seam_normals(body, headobs)
    allacc = [a for h in heads_.values() for a in h[5]] + body_acc
    for a in allacc:
        if uv.degenerate(a.data):
            uv.smart(a)
    if allacc:
        pack_alone(allacc)
    sets = {'SuitA': [k for k in SUITS if k in (1, 2)], 'SuitB': [k for k in SUITS if k in (3, 4)]}
    for nm, ks in sets.items():
        if ks:
            pack_alone([suits_[k][0] for k in ks])
    log('bake', RES)
    bake.cycles(sc, 16)
    skin_auth = getattr(shaders, PEOPLE + '_skin')(**skin_kwargs(ctx))
    bake_skin(body, headobs, skin_auth, RES, hi=body_hi)
    eye_auth = getattr(shaders, 'eye_' + PEOPLE)()
    alleyes = [x for h in heads_.values() for x in h[1]]
    bake_eyes(alleyes, eye_auth, RES)
    if allacc:
        bio_auth = getattr(shaders, BIO[PEOPLE])()
        groups = [(h[5], [body, h[0]]) for h in heads_.values() if h[5]] + ([(body_acc, [body])] if body_acc else [])
        bake_bio(allacc, groups, bio_auth, RES)
    for nm, ks in sets.items():
        if ks:
            log('bake', nm)
            bake_suit(nm, [suits_[k][0] for k in ks], body, RES)
    # joins: eyes and accessories into their heads (then the blendshapes), fins into the body
    for k, (ob, eyeobs, eyes, mo, H, accs) in heads_.items():
        n0 = len(ob.data.vertices)
        join(ob, [eo for eo, _ in eyeobs] + accs)
        if PEOPLE != 'ixari':          # Ixari crystals are already lean prisms: never collapsed
            mark_acc(ob, n0)
        make_shapes(ob, ctx, eyes, mo, s)
    nbody = len(body.data.vertices)
    for ao in body_acc:
        # the dorsal fin folds flat under a suit: the suited body subsets drop it
        mesh.set_attr(ao.data, 'dorsal', np.full(len(ao.data.vertices), 1.0 if ao.name.endswith('_dorsal') else 0.0))
    if body_acc:
        join(body, body_acc)
        if PEOPLE != 'ixari':
            mark_acc(body, nbody)
    subsets = {}
    for k, (suit, covered) in suits_.items():
        cov = np.zeros(len(body.data.vertices), bool)
        cov[:nbody] = covered
        subsets[k] = body_subset(body, cov[:nbody], f'_body_s{k}')
    # (the hi-res copy is only the normal bake's source: removed here, once nothing iterates the view layer mid-pass)
    bpy.data.objects.remove(body_hi)
    bpy.context.view_layer.update()
    log('assemble')
    assemble(rig, body, heads_, suits_, subsets)
    for m in list(bpy.data.materials):
        if m.get('auth'):
            m.use_fake_user = False
            bpy.data.materials.remove(m)
    txt = bpy.data.texts.new('SKELETON_README')
    txt.write(skel.doc_text(PEOPLE))
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    log('saved', OUT)


def bake_suit(nm, objs, body, res):
    auth = {'ulgani': lambda n: shaders.suit_ulgani(n), 'ixari': lambda n: shaders.suit_ixari(n),
            'thalune': lambda n: shaders.suit(PEOPLE, n)}[PEOPLE](f'AUTH_{ABBR}_{nm}')
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(auth)
    p = next(n for n in auth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    name = f'{ABBR}_{nm}'
    base = bake.new_image(f'{name}_base', res, True)
    bake.bake_pass(auth, objs, base, 'EMIT', p.inputs['Base Color'].links[0].from_socket, samples=1)
    rough = bake.new_image(f'{name}_rough', res, False)
    bake.bake_pass(auth, objs, rough, 'EMIT', p.inputs['Roughness'].links[0].from_socket, samples=1)
    metal = bake.new_image(f'{name}_metal', res, False, (0, 0, 0, 1))
    bake.bake_pass(auth, objs, metal, 'EMIT', p.inputs['Metallic'].links[0].from_socket, samples=1)
    nrm = bake.new_image(f'{name}_normal', res, False, (0.5, 0.5, 1, 1))
    bake.bake_pass(auth, objs, nrm, 'NORMAL', samples=4)
    ao = bake.new_image(f'{name}_ao', res // 2, False, (1, 1, 1, 1))
    for i, o in enumerate(objs):
        bake.bake_pass(auth, [o], ao, 'AO', samples=32, occluders=[body], clear=(i == 0))
    emis = None
    if p.inputs['Emission Strength'].default_value > 0 and p.inputs['Emission Color'].is_linked:
        emis = bake.new_image(f'{name}_emissive', res, True, (0, 0, 0, 1))
        bake.bake_pass(auth, objs, emis, 'EMIT', p.inputs['Emission Color'].links[0].from_socket, samples=1)
        emis = bake.save_jpeg(emis, os.path.join(TEX_DIR, f'{name}_emissive.jpg'))
    orm = bake.pack_orm(f'{name}_orm', ao, rough, metal, res)
    base = bake.save_jpeg(base, os.path.join(TEX_DIR, f'{name}_base.jpg'))
    orm = bake.save_jpeg(orm, os.path.join(TEX_DIR, f'{name}_orm.jpg'))
    nrm = bake.save_jpeg(nrm, os.path.join(TEX_DIR, f'{name}_normal.jpg'), 95)
    for img in (ao, rough, metal):
        bpy.data.images.remove(img)
    m = bake.final_material(name, base, orm, nrm, engine_name=nm, emissive=emis,
                            emissive_strength=p.inputs['Emission Strength'].default_value)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)
    return m


def assemble(rig, body, heads, suits_, subsets):
    sc = bpy.context.scene
    ref = coll('REF')
    refs(ref)
    asset = coll(PEOPLE)
    sc.collection.objects.unlink(rig)
    asset.objects.link(rig)
    lod_ratio = [1.0, 0.3, 0.1, 0.034]
    parts = {'Body': body}
    for k, h in heads.items():
        parts[f'Head{k}'] = h[0]
    for k, (suit, _) in suits_.items():
        parts[f'Suit{k}'] = suit
        parts[f'BodyS{k}'] = subsets[k]
    lods = {}
    scratch = coll('_lods')
    for pname, src in parts.items():
        lods[pname] = [src]
        skin = pname == 'Body' or pname.startswith(('Head', 'BodyS'))
        for n in (1, 2, 3):
            if skin and n < 3:
                lods[pname].append(decimate_copy(src, f'_{pname}_L{n}', lod_ratio[n], scratch, level=n, grid=True))
            elif skin:
                lods[pname].append(decimate_copy(lods[pname][2], f'_{pname}_L{n}', lod_ratio[3] / max(tris(lods[pname][2]) / max(tris(src), 1), 1e-3),
                                                 scratch, grid=False))
            else:
                lods[pname].append(decimate_copy(src, f'_{pname}_L{n}', lod_ratio[n], scratch, grid=False))
    for ls in lods.values():
        for o in ls:
            g = o.vertex_groups.get('acc')
            if g is not None:
                o.vertex_groups.remove(g)
    first = min(heads)
    variants = [(f'head{k}', ['Body', f'Head{k}']) for k in heads]
    variants += [(f'suit{k}', [f'BodyS{k}', f'Head{first}', f'Suit{k}']) for k in suits_]
    for vname, use in variants:
        vid = f'{PEOPLE}_{vname}'
        vc = coll(vid, asset)
        for n in range(4):
            lc = coll(f'{vid}_LOD{n}', vc)
            for pname in use:
                src = lods[pname][n]
                o = src.copy()
                label = 'Body' if pname.startswith('BodyS') else pname
                o.name = f'{ABBR}_{label}_{vname}_L{n}'
                lc.objects.link(o)
                o.parent = rig
                for md in o.modifiers:
                    if md.type == 'ARMATURE':
                        md.object = rig
    for pname, ls in lods.items():
        for o in ls:
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o)
    bpy.data.collections.remove(scratch)


if __name__ == '__main__':
    main()
