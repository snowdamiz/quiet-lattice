# Turntable and material close-up sheets for the visual grader (IMPLEMENTATION_PLAN 0.4 and 0.10.3, P1.E14.T03).
#
#   Blender -b --factory-startup -P packages/tools/blender/turntable.py -- <asset.blend|asset.glb> [out_dir] [--samples N]
#
# Writes <out_dir>/<stem>_turntable.png (eight views, 45 degrees apart, at 20 degrees elevation, LOD0 only, under a
# neutral studio light) and <stem>_materials.png (every material the asset uses on a shader ball: a bevelled, grooved
# block and a sphere, so edge wear, cavities and roughness read). A library file with no geometry gets only the
# material sheet. Defaults to assets/renders/. Scale references (the REF collection) and colliders never appear.
import math
import os
import sys

import bmesh
import bpy
import mathutils
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
if not argv:
    print('usage: turntable.py -- <asset.blend|asset.glb> [out_dir] [--samples N]')
    sys.exit(2)
src = os.path.abspath(argv[0])
rest = [a for a in argv[1:]]
samples = 48
if '--samples' in rest:
    i = rest.index('--samples')
    samples = int(rest[i + 1])
    del rest[i : i + 2]
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
out_dir = os.path.abspath(rest[0]) if rest else os.path.join(repo, 'assets', 'renders')
os.makedirs(out_dir, exist_ok=True)
stem = os.path.splitext(os.path.basename(src))[0]

# ---------- load ----------
if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene


def excluded(o):
    if o.name.startswith(('REF_', 'COL_')):
        return True
    return any(c.name == 'REF' or c.name.startswith('REF') for c in o.users_collection)


def lod_of(o):
    names = [o.name] + [c.name for c in o.users_collection]
    for n in names:
        if '_LOD' in n:
            tail = n.rsplit('_LOD', 1)[1][:1]
            if tail.isdigit():
                return int(tail)
    return 0


meshes = [o for o in scene.objects if o.type == 'MESH' and not excluded(o)]
shown = [o for o in meshes if lod_of(o) == 0]
for o in scene.objects:
    if o.type in {'MESH', 'CURVE', 'FONT'}:
        o.hide_render = o not in shown
materials = []
for o in shown:
    for slot in o.material_slots:
        if slot.material and slot.material not in materials:
            materials.append(slot.material)
if not shown:
    materials = sorted([m for m in bpy.data.materials if m.users or m.use_fake_user], key=lambda m: m.name)

# ---------- render settings ----------
try:
    scene.render.engine = 'CYCLES'
except TypeError as e:
    print('turntable: engine', e)
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL' if sys.platform == 'darwin' else 'CUDA'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:  # CPU is fine
    print('turntable: gpu', e)
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False


def studio(center, radius):
    """A soft key, a fill and a rim on a dark neutral world; nothing coloured, so materials read true."""
    for o in [o for o in scene.objects if o.type == 'LIGHT']:
        o.hide_render = True
    world = bpy.data.worlds.new('turntable_world')
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.035, 0.037, 0.042, 1)
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    rigs = []
    for name, energy, az, el, size in (('key', 520, -35, 45, 1.6), ('fill', 150, 70, 15, 2.5), ('rim', 380, 160, 30, 1.2)):
        L = bpy.data.lights.new(f'tt_{name}', 'AREA')
        L.energy = energy * radius * radius
        L.size = size * radius
        o = bpy.data.objects.new(f'tt_{name}', L)
        a, e = math.radians(az), math.radians(el)
        o.location = center + mathutils.Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * radius * 4
        o.rotation_euler = (center - o.location).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(o)
        rigs.append(o)
    return rigs


def floor(z, radius):
    me = bpy.data.meshes.new('tt_floor')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=radius * 30)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('tt_floor', me)
    o.location.z = z
    m = bpy.data.materials.new('tt_floor')
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (0.06, 0.06, 0.065, 1)
    p.inputs['Roughness'].default_value = 0.85
    me.materials.append(m)
    scene.collection.objects.link(o)
    return o


def camera(fov=35):
    cam = bpy.data.cameras.new('tt_cam')
    cam.lens_unit = 'FOV'
    cam.angle = math.radians(fov)
    o = bpy.data.objects.new('tt_cam', cam)
    scene.collection.objects.link(o)
    scene.camera = o
    return o


def render_to(path, w, h):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def compose(paths, cols, out, labels=None):
    """Tiles equally sized renders into one sheet (numpy on Blender's image pixels; labels are in the file names)."""
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = math.ceil(len(imgs) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, im in enumerate(imgs):
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * h  # Blender images are bottom-up
        sheet[y0 : y0 + h, c * w : (c + 1) * w] = px.reshape(h, w, 4)
    img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for p in paths:
        os.remove(p)
    print(f'turntable: wrote {out}')


tmp = os.path.join(out_dir, f'.{stem}_tmp')
os.makedirs(tmp, exist_ok=True)

# ---------- eight-view turntable ----------
if shown:
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in shown:
        for v in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(v)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.25)
    studio(center, radius)
    floor(lo.z - 0.001, radius)
    cam = camera(35)
    dist = radius / math.sin(math.radians(35) / 2) * 1.08
    paths = []
    for k in range(8):
        az = math.radians(k * 45 + 22.5)
        el = math.radians(20)
        cam.location = center + mathutils.Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(tmp, f'view_{k}.png')
        render_to(p, 800, 600)
        paths.append(p)
    compose(paths, 4, os.path.join(out_dir, f'{stem}_turntable.png'))
    for o in shown:
        o.hide_render = True
    for o in [o for o in scene.objects if o.name.startswith('tt_')]:
        bpy.data.objects.remove(o)

# ---------- material close-ups ----------
if materials:
    ball = bpy.data.meshes.new('tt_ball_block')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.inset_region(bm, faces=top, thickness=0.12, depth=0)
    bmesh.ops.inset_region(bm, faces=top, thickness=0.02, depth=-0.03)
    bm.to_mesh(ball)
    bm.free()
    sph = bpy.data.meshes.new('tt_ball_sphere')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.42)
    bm.to_mesh(sph)
    bm.free()
    for p in sph.polygons:
        p.use_smooth = True
    block = bpy.data.objects.new('tt_block', ball)
    block.location = (-0.45, 0, 0.5)
    block.rotation_euler = (0, 0, math.radians(30))
    block.modifiers.new('bevel', 'BEVEL').width = 0.035
    block.modifiers['bevel'].segments = 3
    sphere = bpy.data.objects.new('tt_sphere', sph)
    sphere.location = (0.75, 0.2, 0.42)
    for o in (block, sphere):
        scene.collection.objects.link(o)
    center = mathutils.Vector((0.15, 0.1, 0.45))
    studio(center, 1.2)
    floor(0, 1.2)
    cam = camera(30)
    cam.location = center + mathutils.Vector((0, -3.6, 2.2))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    paths = []
    for i, m in enumerate(materials):
        for o in (block, sphere):
            o.data.materials.clear()
            o.data.materials.append(m)
        p = os.path.join(tmp, f'mat_{i:02d}_{m.name}.png')
        render_to(p, 480, 360)
        paths.append(p)
    compose(paths, min(6, len(paths)), os.path.join(out_dir, f'{stem}_materials.png'))
    with open(os.path.join(out_dir, f'{stem}_materials.txt'), 'w') as f:
        cols = min(6, len(materials))
        f.write('\n'.join(f'row {i // cols + 1}, column {i % cols + 1}: {m.name}' for i, m in enumerate(materials)) + '\n')

os.rmdir(tmp)
