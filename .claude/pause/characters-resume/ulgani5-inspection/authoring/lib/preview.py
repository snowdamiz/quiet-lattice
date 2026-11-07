"""Quick preview renders (clay or shaded, optional wireframe) composed into one sheet, for iterating on forms."""
import math
import os

import bpy
import mathutils
import numpy as np


def clay(name='pv_clay', col=(0.55, 0.55, 0.53), rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough
    return m


def wire_clay(name='pv_wire'):
    """Clay with mesh edges drawn in dark lines (Cycles wireframe node)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (0.6, 0.6, 0.58, 1)
    p.inputs['Roughness'].default_value = 0.7
    w = nt.nodes.new('ShaderNodeWireframe')
    w.use_pixel_size = True
    w.inputs['Size'].default_value = 0.9
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.6, 0.6, 0.58, 1)
    mix.inputs['B'].default_value = (0.05, 0.06, 0.07, 1)
    nt.links.new(w.outputs['Fac'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    return m


def setup(scene, samples=24, engine='CYCLES'):
    scene.render.engine = engine
    if engine == 'CYCLES':
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = 'GPU'
        except Exception as e:
            print('preview: gpu', e)
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.get('pv_world') or bpy.data.worlds.new('pv_world')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.05, 0.055, 0.06, 1)
    bg.inputs['Strength'].default_value = 1.0
    scene.world = w


def lights(center, radius):
    out = []
    for name, energy, az, el, size in (('key', 520, -35, 40, 1.6), ('fill', 170, 70, 15, 2.5), ('rim', 420, 160, 30, 1.2)):
        L = bpy.data.lights.new(f'pv_{name}', 'AREA')
        L.energy = energy * radius * radius
        L.size = size * radius
        o = bpy.data.objects.new(f'pv_{name}', L)
        a, e = math.radians(az), math.radians(el)
        o.location = center + mathutils.Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * radius * 4
        o.rotation_euler = (center - o.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(o)
        out.append(o)
    return out


def _emit(name, rgb, strength):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def _label(cam, text, w, h, fov, d):
    """A caption on a black band along the bottom of the frame (unlit), parented to the camera `d` in front of it,
    nearer than the subject so the subject can't cover it."""
    # the camera's field of view spans the longer side of the frame (sensor fit auto)
    if w >= h:
        half_w = math.tan(math.radians(fov) / 2) * d
        half_h = half_w * h / w
    else:
        half_h = math.tan(math.radians(fov) / 2) * d
        half_w = half_h * w / h
    band_h = half_h * 0.13
    me = bpy.data.meshes.new('pv_band')
    me.from_pydata([(-half_w, -half_h, 0), (half_w, -half_h, 0), (half_w, -half_h + band_h, 0), (-half_w, -half_h + band_h, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(_emit('pv_band', (0, 0, 0), 0))
    band = bpy.data.objects.new('pv_band', me)
    band.parent = cam
    band.location = (0, 0, -d * 1.001)
    cu = bpy.data.curves.new('pv_label', 'FONT')
    cu.body = text
    cu.size = 1
    cu.materials.append(_emit('pv_label', (1, 1, 1), 2.5))
    o = bpy.data.objects.new('pv_label', cu)
    o.parent = cam
    o.scale = (band_h * 0.6,) * 3
    o.location = (-half_w * 0.94, -half_h + band_h * 0.28, -d)
    for x in (band, o):
        x.visible_shadow = False
        bpy.context.scene.collection.objects.link(x)
    return [band, o]


def render_views(objs, out_path, views=((0, 8), (90, 8), (180, 8), (35, 15)), size=(600, 900), samples=24, focus=None,
                 radius=None, fov=30, ortho=False, label=None):
    """Renders `objs` from azimuths (deg, 0 = front) and elevations; tiles into one PNG."""
    scene = bpy.context.scene
    setup(scene, samples)
    for o in scene.objects:
        if o.type in {'MESH', 'CURVE'}:
            o.hide_render = o not in objs
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in objs:
        for v in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(v)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    center = mathutils.Vector(focus) if focus is not None else (lo + hi) / 2
    rad = radius or max((hi - lo).length / 2, 0.2)
    ls = lights(center, rad)
    cam_data = bpy.data.cameras.new('pv_cam')
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = rad * 2.1
    else:
        cam_data.lens_unit = 'FOV'
        cam_data.angle = math.radians(fov)
    cam = bpy.data.objects.new('pv_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = size
    dist = rad / math.sin(math.radians(fov) / 2) * 1.05
    labs = _label(cam, label, size[0], size[1], fov, max(cam_data.clip_start * 1.5, (dist - rad) * 0.5)) if label else []
    tmp = []
    for i, (az, el) in enumerate(views):
        a, e = math.radians(az), math.radians(el)
        cam.location = center + mathutils.Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
        p = out_path + f'.v{i}.png'
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tmp.append(p)
    compose(tmp, len(tmp), out_path)
    for o in ls + labs + [cam]:
        bpy.data.objects.remove(o)


def compose(paths, cols, out):
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = math.ceil(len(imgs) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, im in enumerate(imgs):
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px.reshape(h, w, 4)
    img = bpy.data.images.new('pv_sheet', cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(img)
    for p in paths:
        os.remove(p)
    print('preview: wrote', out)


def sdf_mesh(S, lo, hi, voxel, name='sdf_preview', path='/tmp/sdf.vdb'):
    """Meshes an SDF over [lo, hi] at `voxel` through OpenVDB and Blender's Volume to Mesh."""
    import openvdb as vdb
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.ceil((hi - lo) / voxel).astype(int) + 1
    xs = lo[0] + np.arange(n[0]) * voxel
    ys = lo[1] + np.arange(n[1]) * voxel
    zs = lo[2] + np.arange(n[2]) * voxel
    dens = np.empty((n[0], n[1], n[2]), np.float32)
    Y, Z = np.meshgrid(ys, zs, indexing='ij')
    for i, x in enumerate(xs):
        P = np.stack([np.full(Y.size, x), Y.ravel(), Z.ravel()], 1)
        dens[i] = (-S(P)).reshape(Y.shape)
    g = vdb.FloatGrid(-1.0)
    g.copyFromArray(dens)
    g.name = 'density'
    m = [[voxel, 0, 0, 0], [0, voxel, 0, 0], [0, 0, voxel, 0], [lo[0], lo[1], lo[2], 1]]
    g.transform = vdb.createLinearTransform(m)
    vdb.write(path, grids=[g])
    vol = bpy.data.volumes.new(name)
    vol.filepath = path
    vo = bpy.data.objects.new(name + '_vol', vol)
    bpy.context.scene.collection.objects.link(vo)
    me = bpy.data.meshes.new(name)
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    # geometry nodes: object info (volume) -> volume to mesh
    md = mo.modifiers.new('v2m', 'NODES')
    ng = bpy.data.node_groups.new('pv_v2m', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    oi = ng.nodes.new('GeometryNodeObjectInfo')
    oi.inputs['Object'].default_value = vo
    v2m = ng.nodes.new('GeometryNodeVolumeToMesh')
    v2m.inputs['Threshold'].default_value = 0.0
    out = ng.nodes.new('NodeGroupOutput')
    ng.links.new(oi.outputs['Geometry'], v2m.inputs['Volume'])
    ng.links.new(v2m.outputs['Mesh'], out.inputs['Geometry'])
    md.node_group = ng
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mo.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev)
    mo.modifiers.clear()
    mo.data = me2
    bpy.data.objects.remove(vo)
    for p in me2.polygons:
        p.use_smooth = True
    return mo
