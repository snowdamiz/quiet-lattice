# Turntable and material close-up sheets for the visual grader (IMPLEMENTATION_PLAN 0.4 and 0.10.3, P1.E14.T03).
#
#   Blender -b --factory-startup -P packages/tools/blender/turntable.py -- <asset.blend|asset.glb> [out_dir]
#           [--asset A] [--variant V] [--grid [N]] [--samples N] [--scale F] [--manifest out.json]
#
# One sheet pair per asset and variant (art bible 8: a file may hold several assets, and an asset several variants, all
# at the origin, so they are never overlaid): <stem>_turntable.png (eight views, 45 degrees apart, at 20 degrees
# elevation, LOD0 only, under a neutral studio light) and <stem>_materials.png (every material that asset and variant
# uses on a shader ball: a bevelled, grooved block and a sphere, so edge wear, cavities and roughness read; each cell
# labelled in the image, and listed in <stem>_materials.txt). A file holding several assets or variants names its sheets
# <stem>_<asset>[_<variant>]_*; --asset and --variant pick one. A library file with no geometry gets only the material
# sheet. Defaults to assets/renders/. Scale references (REF), colliders (COL_*) and markers never appear.
#
# LODs are read as the exporter writes and the validator reads them (artlib/scene.py): an object belongs to the
# outermost `<variant>_LOD<n>` node above it (a mesh, or an empty holding the meshes), or to a `<variant>_LOD<n>`
# collection in a source file; the demo's flat `<name>` beside `<name>_lod1` is LOD0 of <name>.
#
# --grid lays the file's assets and variants (LOD0) out side by side on one sheet, at most N of them (default 24,
# evenly sampled): a whole family at once. --scale multiplies the render sizes (tests). --manifest writes what each sheet
# shows as JSON.
import json
import math
import os
import re
import sys

import bmesh
import bpy
import mathutils
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
if not argv:
    print('usage: turntable.py -- <asset.blend|asset.glb> [out_dir] [--asset A] [--variant V] [--grid [N]] [--samples N] [--scale F] [--manifest out.json]')
    sys.exit(2)
src = os.path.abspath(argv[0])
rest = list(argv[1:])


def take(flag, default=None, cast=str):
    if flag not in rest:
        return default
    i = rest.index(flag)
    if i + 1 >= len(rest) or rest[i + 1].startswith('--'):
        print(f'turntable: {flag} needs a value')
        sys.exit(2)
    value = cast(rest[i + 1])
    del rest[i : i + 2]
    return value


samples = take('--samples', 48, int)
scale = take('--scale', 1.0, float)
pick_asset = take('--asset')
pick_variant = take('--variant')
manifest_path = take('--manifest')
grid = 0
if '--grid' in rest:
    i = rest.index('--grid')
    grid = 24
    if i + 1 < len(rest) and rest[i + 1].isdigit():
        grid = int(rest[i + 1])
        del rest[i + 1]
    del rest[i]
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

# ---------- what is in the file: assets, variants, LODs ----------
SUFFIX = re.compile(r'\.\d{3,}$')
LOD = re.compile(r'^(?P<base>.+)_(?:LOD|lod|Lod)(?P<n>\d+)$')
# colliders and point markers (families.json "markers", roles collider and point) and scale references
HELPER = re.compile(r'^(col_|ref_|interact($|_)|light_|hp_[sml]_|bay_|mount$|muzzle($|_))', re.I)
RENDERABLE = {'MESH', 'CURVE', 'FONT', 'SURFACE', 'META'}


def strip(name):
    return SUFFIX.sub('', name)


def lod_parts(name):
    m = LOD.match(strip(name))
    return (m.group('base'), int(m.group('n'))) if m else None


def chain(o):
    out = []
    while o is not None:
        out.append(o)
        o = o.parent
    return out


coll_parent = {}


def _walk(c, parent):
    for k in c.children:
        coll_parent[k.name] = parent
        _walk(k, k)


_walk(scene.collection, None)


def coll_chain(o):
    """The collections an object is in, each followed by the collections holding it, innermost first."""
    out = []
    for c in o.users_collection:
        while c is not None and c != scene.collection:
            out.append(c)
            c = coll_parent.get(c.name)
    return out


def excluded(o):
    if any(HELPER.match(strip(x.name)) for x in chain(o)):
        return True
    return any(c.name == 'REF' or c.name.startswith('REF') or c.name.startswith('_') for c in coll_chain(o))


def siblings(o):
    return [x for x in (o.parent.children if o.parent else scene.objects) if (x.parent is None) == (o.parent is None)]


def lod_of(o):
    """(variant base, level) of an object, or None: the outermost LOD-named node above it (as artlib/scene.py reads the
    export layout), a legacy unsuffixed LOD0 beside its `_lod1`, else a `<variant>_LOD<n>` collection."""
    found = None
    for x in chain(o):
        p = lod_parts(x.name)
        if p:
            found = p
        elif found is None and any((lod_parts(s.name) or ('',))[0] == strip(x.name) for s in siblings(x) if s is not x):
            found = (strip(x.name), 0)
    if found:
        return found
    for c in coll_chain(o):
        p = lod_parts(c.name)
        if p:
            return p
    return None


def asset_of(o):
    """A source's top-level collection, else the object's top-level node (a flat LOD node: its base name)."""
    cs = coll_chain(o)
    if cs:
        return strip(cs[-1].name)
    top = chain(o)[-1]
    p = lod_parts(top.name)
    if p:
        return p[0]
    return strip(top.name)


objs = [o for o in scene.objects if o.type in RENDERABLE and not excluded(o)]
info = {}
for o in objs:
    lp = lod_of(o)
    info[o] = {'asset': asset_of(o), 'variant': lp[0] if lp else None, 'level': lp[1] if lp else None}
variants = {}
for o in objs:
    i = info[o]
    variants.setdefault(i['asset'], [])
    if i['variant'] and i['variant'] not in variants[i['asset']]:
        variants[i['asset']].append(i['variant'])
# an object under a variant's own node but outside its LODs belongs to that variant; anything else to every variant
for o in objs:
    i = info[o]
    if i['variant'] is None:
        names = {strip(x.name) for x in chain(o)} | {strip(c.name) for c in coll_chain(o)}
        i['variant'] = next((v for v in variants[i['asset']] if v in names), None)

targets = []
for a, vs in variants.items():
    for v in vs or [a]:
        targets.append((a, v))
all_targets = list(targets)
if pick_asset:
    targets = [t for t in targets if t[0] == pick_asset]
if pick_variant:
    targets = [t for t in targets if t[1] == pick_variant]
if objs and not targets:
    print(f'turntable: nothing to render for {pick_asset or "*"}/{pick_variant or "*"}; the file holds {", ".join(f"{a}/{v}" for a, v in all_targets)}')
    sys.exit(1)


def lod0_of(target):
    """The meshes a target shows at LOD0 (its lowest level when it has no LOD0)."""
    a, v = target
    mine = [o for o in objs if info[o]['asset'] == a and info[o]['variant'] in (v, None)]
    levels = sorted({info[o]['level'] for o in mine if info[o]['variant'] == v and info[o]['level'] is not None})
    first = levels[0] if levels else None
    return [o for o in mine if info[o]['level'] is None or info[o]['level'] == first or info[o]['variant'] is None]


def show_only(shown):
    keep = set(shown)
    for o in scene.objects:
        if o.type in RENDERABLE:
            o.hide_render = o not in keep


def materials_of(shown):
    out = []
    for o in shown:
        for slot in o.material_slots:
            if slot.material and slot.material not in out:
                out.append(slot.material)
    return out


def sheet_name(target, kind):
    if target is None or len(all_targets) <= 1:
        return f'{stem}_{kind}'
    a, v = target
    return f'{stem}_{a}_{kind}' if v == a else f'{stem}_{a}_{v}_{kind}'


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
    for name, energy, az, el, size in (('key', 520, -35, 45, 1.6), ('fill', 150, 70, 15, 2.5), ('rim', 380, 160, 30, 1.2)):
        L = bpy.data.lights.new(f'tt_{name}', 'AREA')
        L.energy = energy * radius * radius
        L.size = size * radius
        o = bpy.data.objects.new(f'tt_{name}', L)
        a, e = math.radians(az), math.radians(el)
        o.location = center + mathutils.Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * radius * 4
        o.rotation_euler = (center - o.location).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(o)


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


def emissive(name, rgb, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def label(cam, w, h):
    """A text line on a black band along the bottom of the camera's frame, both unlit, so the name reads over any
    material and the studio light never changes it."""
    # at 1 m in front of the camera the frame spans 2 tan(fov/2) across
    half_w = math.tan(cam.data.angle / 2)
    half_h = half_w * h / w
    band_h = half_h * 0.2
    me = bpy.data.meshes.new('tt_label_band')
    me.from_pydata([(-half_w, -half_h, 0), (half_w, -half_h, 0), (half_w, -half_h + band_h, 0), (-half_w, -half_h + band_h, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(emissive('tt_label_band', (0, 0, 0), 0))
    band = bpy.data.objects.new('tt_label_band', me)
    band.parent = cam
    band.location = (0, 0, -1.001)
    cu = bpy.data.curves.new('tt_label', 'FONT')
    cu.size = 1
    cu.materials.append(emissive('tt_label', (1, 1, 1), 2.5))
    o = bpy.data.objects.new('tt_label', cu)
    o.parent = cam
    o.scale = (half_h * 0.12,) * 3
    o.location = (-half_w * 0.95, -half_h + band_h * 0.3, -1.0)
    for x in (band, o):
        x.visible_shadow = False
        scene.collection.objects.link(x)
    return o


def render_to(path, w, h):
    scene.render.resolution_x = max(16, int(w * scale))
    scene.render.resolution_y = max(16, int(h * scale))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def compose(paths, cols, out):
    """Tiles equally sized renders into one sheet (numpy on Blender's image pixels)."""
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
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(img)
    for p in paths:
        os.remove(p)
    print(f'turntable: wrote {out}')


def clear_rig():
    for o in [o for o in scene.objects if o.name.startswith('tt_')]:
        bpy.data.objects.remove(o)


def bounds(shown):
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in shown:
        for v in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(v)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


tmp = os.path.join(out_dir, f'.{stem}_tmp')
os.makedirs(tmp, exist_ok=True)


def turntable(shown, out):
    show_only(shown)
    lo, hi = bounds(shown)
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
    compose(paths, 4, out)
    clear_rig()


def material_sheet(materials, out_png, out_txt):
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
    show_only([block, sphere])
    center = mathutils.Vector((0.02, 0.1, 0.45))
    studio(center, 1.2)
    floor(0, 1.2)
    cam = camera(30)
    # (aimed a little low: the label band takes the bottom of the frame)
    cam.location = center + mathutils.Vector((0, -4.3, 2.4))
    cam.rotation_euler = (center + mathutils.Vector((0, 0, -0.12)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    text = label(cam, 480, 360)
    paths = []
    for i, m in enumerate(materials):
        for o in (block, sphere):
            o.data.materials.clear()
            o.data.materials.append(m)
        engine = m.get('engine_name')
        text.data.body = m.name + (f'  ({engine})' if engine else '')
        p = os.path.join(tmp, f'mat_{i:02d}.png')
        render_to(p, 480, 360)
        paths.append(p)
    cols = min(6, len(paths))
    compose(paths, cols, out_png)
    with open(out_txt, 'w') as f:
        f.write('\n'.join(f'row {i // cols + 1}, column {i % cols + 1}: {m.name}' for i, m in enumerate(materials)) + '\n')
    clear_rig()


def lay_out(targets_shown):
    """--grid: each target's LOD0 moved to its own cell of a square grid, by the targets' own sizes."""

    def extent(shown):
        lo, hi = bounds(shown)
        return max(hi - lo), lo, hi

    sizes = [extent(s) for _, s in targets_shown]
    cell = max(s[0] for s in sizes) * 1.25
    cols = math.ceil(math.sqrt(len(targets_shown)))
    moved = set()
    for i, ((_, shown), (_, lo, hi)) in enumerate(zip(targets_shown, sizes)):
        c = (lo + hi) / 2
        off = mathutils.Vector(((i % cols) * cell, -(i // cols) * cell, 0)) - mathutils.Vector((c.x, c.y, lo.z))
        keep = set(shown)
        for o in shown:
            # move the target's top objects only (their children follow); an object shared by several targets once
            if o in moved or (o.parent in keep):
                continue
            o.matrix_world = mathutils.Matrix.Translation(off) @ o.matrix_world
            moved.add(o)
        bpy.context.view_layer.update()


manifest = {'source': src, 'targets': [list(t) for t in all_targets], 'sheets': []}
if objs and grid:
    picked = targets
    if len(picked) > grid:
        step = len(picked) / grid
        picked = [picked[int(i * step)] for i in range(grid)]
    targets_shown = [(t, lod0_of(t)) for t in picked]
    lay_out(targets_shown)
    shown = [o for _, s in targets_shown for o in s]
    turntable(shown, os.path.join(out_dir, f'{stem}_turntable.png'))
    mats = materials_of(shown)
    material_sheet(mats, os.path.join(out_dir, f'{stem}_materials.png'), os.path.join(out_dir, f'{stem}_materials.txt'))
    manifest['sheets'].append({'target': None, 'objects': sorted(o.name for o in shown), 'materials': [m.name for m in mats]})
elif objs:
    for t in targets:
        shown = lod0_of(t)
        tt = os.path.join(out_dir, sheet_name(t, 'turntable') + '.png')
        turntable(shown, tt)
        mats = materials_of(shown)
        sheet = {'target': list(t), 'turntable': tt, 'objects': sorted(o.name for o in shown), 'materials': [m.name for m in mats]}
        if mats:
            mp = os.path.join(out_dir, sheet_name(t, 'materials') + '.png')
            material_sheet(mats, mp, os.path.join(out_dir, sheet_name(t, 'materials') + '.txt'))
            sheet['materials_sheet'] = mp
        manifest['sheets'].append(sheet)
else:
    # a library: every material it holds
    mats = sorted([m for m in bpy.data.materials if m.users or m.use_fake_user], key=lambda m: m.name)
    if mats:
        mp = os.path.join(out_dir, f'{stem}_materials.png')
        material_sheet(mats, mp, os.path.join(out_dir, f'{stem}_materials.txt'))
        manifest['sheets'].append({'target': None, 'objects': [], 'materials': [m.name for m in mats], 'materials_sheet': mp})

os.rmdir(tmp)
if manifest_path:
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
