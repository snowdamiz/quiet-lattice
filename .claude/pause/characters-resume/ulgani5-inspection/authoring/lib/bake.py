"""Baking authored (procedural + hand-mask) materials into the shared texture sets in the source, and building the
final image-based PBR materials the export carries unchanged (base colour, packed occlusion/roughness/metallic,
normal, emissive where it glows)."""
import os

import bpy
import numpy as np


def cycles(scene, samples=16, gpu=True):
    scene.render.engine = 'CYCLES'
    if gpu:
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = 'GPU'
        except Exception as e:
            print('bake: gpu', e)
    scene.cycles.samples = samples
    scene.render.bake.margin = 24
    scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_selected_to_active = False


def _select(objs):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.hide_render = False
        o.select_set(True)
    vl.objects.active = objs[0]


def new_image(name, res, colour, fill=(0.5, 0.5, 0.5, 1.0)):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    img.generated_color = fill
    return img


def bake_pass(mat, objs, img, kind, socket=None, samples=None, occluders=(), clear=True):
    """Bakes one channel of `mat` (on `objs`) into `img`.  kind: 'EMIT' (socket value routed to emission), 'NORMAL',
    'AO'.  Other materials on the objects get a throwaway target."""
    scene = bpy.context.scene
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    surf_link = out.inputs['Surface'].links[0]
    surface = surf_link.from_socket
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    others = {s.material for o in objs for s in o.material_slots if s.material and s.material != mat}
    scratch = bpy.data.images.new('_scratch', 8, 8)
    guards = []
    for m in others:
        g = m.node_tree.nodes.new('ShaderNodeTexImage')
        g.image = scratch
        guards.append((m, g))
        m.node_tree.nodes.active = g
    hidden = []
    keep = set(o.name for o in list(objs) + list(occluders))
    for o in scene.objects:
        want = o.name not in keep
        if o.hide_render != want:
            hidden.append((o, o.hide_render))
            o.hide_render = want
    em = None
    try:
        _select(list(objs))
        if samples:
            scene.cycles.samples = samples
        if kind == 'EMIT':
            em = nt.nodes.new('ShaderNodeEmission')
            nt.links.new(socket, em.inputs['Color'])
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT', use_clear=clear)
        elif kind == 'NORMAL':
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=clear)
        elif kind == 'AO':
            bpy.ops.object.bake(type='AO', use_clear=clear)
        else:
            raise ValueError(kind)
    finally:
        if em is not None:
            nt.nodes.remove(em)
            nt.links.new(surface, out.inputs['Surface'])
        nt.nodes.remove(tex)
        for m, g in guards:
            m.node_tree.nodes.remove(g)
        bpy.data.images.remove(scratch)
        for o, was in hidden:
            o.hide_render = was
    return img


def bake_normal_from(lo, hi, img, samples=4, extrusion=0.006, max_ray=0.015, clear=True):
    """Tangent-space normals of `hi` (its surface and its material's bump) baked onto `lo`'s UVs (selected to
    active).  Both carry the same authoring material."""
    scene = bpy.context.scene
    mats = {sl.material for sl in lo.material_slots if sl.material}
    added = []
    for m in mats:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = img
        m.node_tree.nodes.active = t
        added.append((m, t))
    hidden = []
    for o in scene.objects:
        want = o not in (lo, hi)
        if o.hide_render != want:
            hidden.append((o, o.hide_render))
            o.hide_render = want
    bk = scene.render.bake
    try:
        _select([lo, hi])
        bpy.context.view_layer.objects.active = lo
        scene.cycles.samples = samples
        bk.use_selected_to_active = True
        bk.cage_extrusion = extrusion
        bk.max_ray_distance = max_ray
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=clear)
    finally:
        bk.use_selected_to_active = False
        for m, t in added:
            m.node_tree.nodes.remove(t)
        for o, was in hidden:
            o.hide_render = was
    return img


def patch_normal(img, obj, auth, res, samples=4):
    """The selected-to-active bake misreads the hands, the feet and the band round the open neck edge (rays from the cage
    land on a neighbouring finger, web or toe, or miss past the edge): those texels take the low mesh's own normal bake
    (its material bump alone), blended in through a mask baked from the vertex attribute 'patch'."""
    plain = new_image('_plain_normal', res, False, (0.5, 0.5, 1, 1))
    bake_pass(auth, [obj], plain, 'NORMAL', samples=samples)
    mask = new_image('_patch_mask', res, False, (0, 0, 0, 1))
    at = auth.node_tree.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'patch'
    at.attribute_type = 'GEOMETRY'
    try:
        bake_pass(auth, [obj], mask, 'EMIT', at.outputs['Fac'], samples=1)
    finally:
        auth.node_tree.nodes.remove(at)
    P, Q, M = pixels(img), pixels(plain), pixels(mask)[..., :1]
    img.pixels.foreach_set((P * (1.0 - M) + Q * M).ravel())
    print(f'bake: normal patched over {float((M > 0.5).mean()) * 100:.1f}% of texels', flush=True)
    bpy.data.images.remove(plain)
    bpy.data.images.remove(mask)
    return img


def save_jpeg(img, path, quality=92):
    """Writes the image's own pixels (no view transform) as JPEG and returns a packed image datablock read back
    from the file, so the .blend carries the exact bytes the .glb will."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cs = img.colorspace_settings.name
    img.file_format = 'JPEG'
    img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    name = img.name
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path)
    out.name = name
    out.colorspace_settings.name = cs
    out.pack()
    return out


def pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def pack_orm(name, ao, rough, metal, res):
    """R occlusion, G roughness, B metallic (glTF's packing)."""
    img = new_image(name, res, False)
    if tuple(ao.size) != (res, res):
        ao.scale(res, res)
    A = pixels(ao)[..., 0]
    R = pixels(rough)[..., 0]
    M = np.zeros_like(A) if metal is None else (pixels(metal)[..., 0] if not isinstance(metal, float) else np.full_like(A, metal))
    out = np.stack([A, R, M, np.ones_like(A)], -1)
    img.pixels.foreach_set(out.ravel())
    img.update()
    return img


GLTF_GROUP = 'glTF Material Output'


def gltf_group():
    ng = bpy.data.node_groups.get(GLTF_GROUP)
    if ng is None:
        ng = bpy.data.node_groups.new(GLTF_GROUP, 'ShaderNodeTree')
        ng.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return ng


def final_material(name, base, orm, normal, emissive=None, emissive_strength=1.0, engine_name=None, metallic_from_orm=True,
                   extra=None):
    """Image-based PBR material in the layout the glTF exporter packs as-is."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    tb = nt.nodes.new('ShaderNodeTexImage')
    tb.image = base
    nt.links.new(tb.outputs['Color'], p.inputs['Base Color'])
    to = nt.nodes.new('ShaderNodeTexImage')
    to.image = orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], p.inputs['Roughness'])
    if metallic_from_orm:
        nt.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
    else:
        p.inputs['Metallic'].default_value = 0.0
    g = nt.nodes.new('ShaderNodeGroup')
    g.node_tree = gltf_group()
    nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if emissive is not None:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = emissive
        nt.links.new(te.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = emissive_strength
    if engine_name:
        m['engine_name'] = engine_name
    for k, v in (extra or {}).items():
        m[k] = v
    return m
