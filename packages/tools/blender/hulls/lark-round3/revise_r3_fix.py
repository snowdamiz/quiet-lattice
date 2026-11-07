"""REVISE fix for blind grade mean 3.60: husked Hollow treatment, glass, LOD2, canopy hinge, BAY_1.

Does not touch base pearl/sea-green maps, force-fit, multi-atlas, shared exporter/meshopt/validate/families,
or other hulls. Keeps single UVMap / one 4096 atlas / force_fit_scale=1.0.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import bake, lods  # noqa: E402
from artlib import scene as S  # noqa: E402

SRC = ROOT / 'assets/blend/hulls/lark.blend'
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
EXPECTED = '68a327711238d437666fb5f76f04f8f4d519c67e44e820c0d7b3199097e825e1'
assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
bake.ensure_cycles(scene, 8)
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'

HUSK = np.array((0x12 / 255, 0x14 / 255, 0x16 / 255), np.float32)
HUSK = np.where(HUSK <= 0.04045, HUSK / 12.92, ((HUSK + 0.055) / 1.055) ** 2.4)
RUST = np.array((0x5A / 255, 0x3B / 255, 0x2E / 255), np.float32)
RUST = np.where(RUST <= 0.04045, RUST / 12.92, ((RUST + 0.055) / 1.055) ** 2.4)
SEAM = np.array((0x9F / 255, 0xE8 / 255, 0xDA / 255), np.float32)  # sRGB emit bake target
BONE = np.array((0xCF / 255, 0xC6 / 255, 0xB3 / 255), np.float32)
BONE_L = np.where(BONE <= 0.04045, BONE / 12.92, ((BONE + 0.055) / 1.055) ** 2.4)
notes = {'design': [], 'materials': [], 'topology': [], 'fitness': []}


def linear_hex(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def world_bbox(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs, ys, zs = zip(*[(p.x, p.y, p.z) for p in pts])
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


# ---------------------------------------------------------------------------
# fitness: aft-hinge canopy so X-open clears; BAY_1 for the single cargo pod
# ---------------------------------------------------------------------------
def fix_canopy(empty_name, glass_name, frame_name):
    if empty_name not in bpy.data.objects or glass_name not in bpy.data.objects:
        return
    canopy = bpy.data.objects[empty_name]
    glass = bpy.data.objects[glass_name]
    frame = bpy.data.objects.get(frame_name)
    (xmin, xmax), (ymin, ymax), (zmin, zmax) = world_bbox(glass)
    # Aft hinge on the shell's own rear rail, centreline — whole pane stays forward of the pivot.
    hinge = Vector((0.0, ymin + 0.04, (zmin + zmax) * 0.55))
    worlds = {c: c.matrix_world.copy() for c in list(canopy.children)}
    canopy.location = hinge
    bpy.context.view_layer.update()
    for c, mw in worlds.items():
        c.matrix_world = mw
    bpy.context.view_layer.update()
    # Verify open pose no longer folds the aft bubble through the forward pane.
    rest = canopy.rotation_euler.copy()
    canopy.rotation_euler.x = math.radians(55)
    bpy.context.view_layer.update()
    L, R = [], []
    for v in glass.data.vertices:
        p = glass.matrix_world @ v.co
        if v.co.x < -0.05:
            L.append(p)
        elif v.co.x > 0.05:
            R.append(p)
    overlap = (max(p.x for p in L) > min(p.x for p in R) - 0.02) if L and R else False
    canopy.rotation_euler = rest
    bpy.context.view_layer.update()
    notes['fitness'].append({
        'canopy': empty_name,
        'hinge': list(hinge),
        'glass_y': [ymin, ymax],
        'open55_overlap': overlap,
        'frame': frame.name if frame else None,
    })


for names in (
    ('Canopy', 'CanopyGlass', 'CanopyFrame'),
    ('Canopy_dmg', 'CanopyGlass_dmg', 'CanopyFrame_dmg'),
    ('Canopy_husk', 'CanopyGlass_husk', 'CanopyFrame_husk'),
):
    fix_canopy(*names)
print('CANOPY_HINGE', notes['fitness'], flush=True)

root = bpy.data.collections['lark']
if 'BAY_1' not in bpy.data.objects:
    body = bpy.data.objects['Body']
    (xmin, xmax), (ymin, ymax), (zmin, zmax) = world_bbox(body)
    bay = bpy.data.objects.new('BAY_1', None)
    bay.empty_display_type = 'PLAIN_AXES'
    bay.empty_display_size = 0.45
    root.objects.link(bay)
    # Single cargo pod under the belly amidships (DESIGN 19.4 / art bible §8).
    bay.location = (0.0, (ymin + ymax) * 0.35, zmin + 0.15)
    notes['fitness'].append({'BAY_1': list(bay.location)})
print('BAY_1', list(bpy.data.objects['BAY_1'].location), flush=True)


# ---------------------------------------------------------------------------
# design: remove 15–30% of outer husked plates along pid seams so the frame shows
# ---------------------------------------------------------------------------
def remove_husk_plates(obj, fraction=0.22):
    mesh = obj.data
    pid = mesh.attributes.get('pid')
    plate = mesh.attributes.get('plate')
    if pid is None:
        raise RuntimeError(f'{obj.name} missing pid attribute for seam-aligned plate loss')
    # Collect removable plate ids (Hull/Accent outer plates with a real pid).
    faces_by_pid = {}
    for poly in mesh.polygons:
        mat = mesh.materials[poly.material_index]
        role = mat.get('engine_name') if mat else None
        if role not in ('Hull', 'Accent'):
            continue
        if plate is not None and plate.domain == 'POINT':
            # Require majority plate-flagged corners.
            flagged = 0
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                if plate.data[vi].value > 0.5:
                    flagged += 1
            if flagged < len(poly.loop_indices) * 0.5:
                continue
        p = int(pid.data[poly.index].value)
        if p <= 0:
            continue
        faces_by_pid.setdefault(p, []).append(poly.index)
    ids = sorted(faces_by_pid, key=lambda i: (-len(faces_by_pid[i]), i))
    n_drop = max(1, int(round(len(ids) * fraction)))
    # Prefer mid-body / dorsal plates (not leading rim) so the silhouette still reads Lark.
    scored = []
    for pid_v in ids:
        centroids = []
        for fi in faces_by_pid[pid_v]:
            poly = mesh.polygons[fi]
            centroids.append(obj.matrix_world @ poly.center)
        c = sum(centroids, Vector()) / len(centroids)
        # Lower score = remove first: avoid nose (high +Y) and wing tips (high |X|).
        score = abs(c.y - 0.2) + 0.15 * abs(c.x) - 0.35 * max(0.0, c.z)
        scored.append((score, pid_v))
    scored.sort()
    drop = {pid_v for _, pid_v in scored[:n_drop]}
    drop_faces = set()
    for pid_v in drop:
        drop_faces.update(faces_by_pid[pid_v])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    doomed = [f for f in bm.faces if f.index in drop_faces]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    removed = sum(len(faces_by_pid[p]) for p in drop)
    remaining_outer = sum(1 for p in mesh.polygons if mesh.materials[p.material_index] and mesh.materials[p.material_index].get('engine_name') in ('Hull', 'Accent'))
    notes['design'].append({
        'object': obj.name,
        'plate_ids_total': len(ids),
        'plate_ids_removed': len(drop),
        'faces_removed': removed,
        'fraction_ids': len(drop) / max(1, len(ids)),
        'remaining_hull_accent_faces': remaining_outer,
        'removed_pids': sorted(drop)[:40],
    })
    print('HUSK_PLATES', notes['design'][-1], flush=True)


remove_husk_plates(bpy.data.objects['Body_husk'], fraction=0.24)


# ---------------------------------------------------------------------------
# materials: rebake husked Hull/Accent/Trim off purple atlas; seam glow; glass
# ---------------------------------------------------------------------------
def paint_husk_vertex_colors(objects):
    for o in objects:
        colors, orm, emit = [], [], []
        for loop in o.data.loops:
            p = o.matrix_world @ o.data.vertices[loop.vertex_index].co
            x, y, z = p
            # Fastener rust at rivet-ish lattice + service lips.
            fasten = (
                math.exp(-((abs(x) % 0.55 - 0.27) / 0.04) ** 2)
                * math.exp(-((abs(y + 0.2) % 0.62 - 0.31) / 0.04) ** 2)
                * max(0.0, min(1.0, 0.4 + z))
            )
            service = max(
                (math.exp(-((abs(x) - 2.65) / 0.28) ** 4 - ((y - q) / 0.44) ** 4) for q in (-2.5, -1.4)),
                default=0.0,
            )
            rust_w = min(0.85, 0.55 * fasten + 0.45 * service)
            color = HUSK * (1 - rust_w) + RUST * rust_w
            # Glyph fragments: bone scrawls near mid-body plates.
            glyph = (
                z > 0.2
                and abs(abs(x) - 1.8) < 0.35
                and abs(y + 1.4) < 0.45
                and (abs(y + 1.4) < 0.03 or abs(abs(x) - 1.8) < 0.03 or abs(abs(x) - 1.55) < 0.02)
            )
            if glyph:
                color = color * 0.55 + BONE_L * 0.45
            rough = 0.65 + 0.12 * rust_w
            metal = 0.55 + 0.15 * rust_w
            colors.extend((*color, 1.0))
            orm.extend((1.0, min(0.95, rough), metal, 1.0))
            radius = math.hypot(x, y + 4.9)
            theta = math.atan2(x, y + 4.9)
            seam = min(abs(math.sin(theta - a)) * radius for a in (-0.64, -0.39, 0.39, 0.64))
            lit = z > 0.25 and -4.5 < y < -0.1 and radius > 1.0 and seam < 0.028
            glyph_e = (
                z > 0.25
                and abs(abs(x) - 1.8) < 0.30
                and abs(y + 1.4) < 0.40
                and (abs(y + 1.4) < 0.025 or abs(abs(x) - 1.8) < 0.025)
            )
            emit.extend((*(SEAM if (lit or glyph_e) else (0.0, 0.0, 0.0)), 1.0))
        for name, values in (('HuskPaint', colors), ('HuskORM', orm), ('HollowTrace', emit)):
            old = o.data.color_attributes.get(name)
            if old:
                o.data.color_attributes.remove(old)
            attr = o.data.color_attributes.new(name=name, type='FLOAT_COLOR', domain='CORNER')
            attr.data.foreach_set('color', values)


def bake_attr_to_image(objects, mats, attr_name, image, colour):
    for o in list(scene.objects):
        o.hide_render = o not in objects
    bake._select(objects)
    changes = []
    for m in mats:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        surface = out.inputs['Surface'].links[0].from_socket
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.nodes.active = tex
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = attr_name
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(vc.outputs['Color'], em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        changes.append((m, out, surface, tex, vc, em))
    bpy.ops.object.bake(type='EMIT', use_clear=False)
    for m, out, surface, tex, vc, em in changes:
        nt = m.node_tree
        for node in (tex, vc, em):
            nt.nodes.remove(node)
        nt.links.new(surface, out.inputs['Surface'])
    image.pack()
    image.update()


husk_lod0 = bpy.data.collections['lark_husked_LOD0']
husk_meshes = [
    o for o in husk_lod0.objects
    if o.type == 'MESH' and any(s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark') for s in o.material_slots)
]
husk_mats = {s.material for o in husk_meshes for s in o.material_slots if s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark')}
paint_husk_vertex_colors(husk_meshes)
print('HUSK_VERTEX_PAINT', len(husk_meshes), flush=True)

base_img = bpy.data.images.get('lark_husked_4k_density_baseColor')
orm_img = bpy.data.images.get('lark_husked_4k_density_ORM')
assert base_img and orm_img
# Clear then bake husk paint into the existing atlas (UVs unchanged).
base_img.pixels.foreach_set(np.zeros(4096 * 4096 * 4, np.float32))
orm_img.pixels.foreach_set(np.tile(np.array([1, 0.65, 0.55, 1], np.float32), 4096 * 4096))
bake_attr_to_image(husk_meshes, husk_mats, 'HuskPaint', base_img, True)
print('HUSK_BASE_BAKED', flush=True)
bake_attr_to_image(husk_meshes, husk_mats, 'HuskORM', orm_img, False)
print('HUSK_ORM_BAKED', flush=True)

em_img = bpy.data.images.get('lark_husked_4k_emissive')
if em_img is None:
    em_img = bake._new_target('lark_husked_4k_emissive', 4096, True)
else:
    em_img.pixels.foreach_set(np.zeros(4096 * 4096 * 4, np.float32))
bake_attr_to_image(husk_meshes, husk_mats, 'HollowTrace', em_img, True)
bake._finish(em_img, 'lark_husked', 'emissive')
print('HUSK_EMISSIVE_BAKED', flush=True)

# Wire seam glow onto Hull/Accent; kill live nav/engine on husk.
for m in husk_mats:
    role = m.get('engine_name')
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    # Drop prior emission image links if any.
    for link in list(bs.inputs['Emission Color'].links):
        nt.links.remove(link)
    if role in ('Hull', 'Accent'):
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = em_img
        # Prefer UVMap.
        uv = next((n for n in nt.nodes if n.type == 'UVMAP'), None)
        if uv is None:
            uv = nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = 'UVMap'
        nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Color'], bs.inputs['Emission Color'])
        bs.inputs['Emission Strength'].default_value = 0.5
    elif role and (role.startswith('Nav') or role == 'EngineGlow'):
        bs.inputs['Emission Strength'].default_value = 0.000001
        bs.inputs['Emission Color'].default_value = (0, 0, 0, 1)

for o in husk_meshes:
    for attr in list(o.data.color_attributes):
        if attr.name in ('HuskPaint', 'HuskORM', 'HollowTrace'):
            o.data.color_attributes.remove(attr)

# Sample atlas to prove purple is gone.
pix = np.empty(4096 * 4096 * 4, np.float32)
base_img.pixels.foreach_get(pix)
pix = pix.reshape(-1, 4)
alive = pix[:, 3] > 0.1
mean = pix[alive, :3].mean(axis=0).tolist() if alive.any() else None
notes['materials'].append({'husk_base_mean_after': mean, 'emissive': em_img.name})
print('HUSK_BASE_MEAN', mean, flush=True)

# Damaged Glass: replace white-scribble baseColor with dark crazed canopy glass.
glass_img = bpy.data.images.get('lark_damaged_Glass_baseColor')
if glass_img is not None:
    n = 4096
    yy, xx = np.mgrid[0:n, 0:n]
    u = xx / n
    v = yy / n
    base = np.zeros((n, n, 4), np.float32)
    base[..., 0] = 0.04
    base[..., 1] = 0.05
    base[..., 2] = 0.07
    base[..., 3] = 1.0
    # Crack lattice (darker lines) — not white scribbles.
    cracks = (
        (np.abs(np.sin(40 * u + 11 * v)) < 0.04)
        | (np.abs(np.sin(27 * v - 9 * u)) < 0.035)
        | (np.abs(np.sin(18 * (u + v))) < 0.03)
    )
    base[cracks, :3] = (0.01, 0.012, 0.018)
    # Sparse impact stars
    stars = ((xx * 17 + yy * 29) % 997 < 3) & ((xx + yy) % 5 == 0)
    base[stars, :3] = (0.12, 0.13, 0.15)
    glass_img.pixels.foreach_set(base.ravel())
    glass_img.pack()
    glass_img.update()
    notes['materials'].append({'damaged_glass': glass_img.name, 'replaced': 'dark_crazed'})
    print('DMG_GLASS_REPLACED', flush=True)

# Ensure husked glass reads dark/crazed (add baseColor if only procedural).
for mat_name in ('LarkHusk_HuskGlass',):
    m = bpy.data.materials.get(mat_name)
    if not m:
        continue
    bs = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bs is None:
        continue
    bs.inputs['Base Color'].default_value = (0.03, 0.035, 0.045, 1)
    bs.inputs['Roughness'].default_value = 0.55
    bs.inputs['Transmission Weight'].default_value = 0.0  # husked canopy is dark, not clear


# ---------------------------------------------------------------------------
# topology: regenerate LOD1–3; LOD2 at gentler ratio; keep UVs; transfer normals
# ---------------------------------------------------------------------------
LOD_RATIOS = {1: 0.30, 2: 0.20, 3: 0.035}


def clear_collection_objects(coll):
    for o in list(coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def transfer_normals(src, dst):
    if src is None or dst is None or dst.type != 'MESH' or src.type != 'MESH':
        return
    mod = dst.modifiers.new('LOD_normal_xfer', 'DATA_TRANSFER')
    mod.object = src
    mod.use_loop_data = True
    mod.data_types_loops = {'CUSTOM_NORMAL'}
    mod.loop_mapping = 'NEAREST_POLYNOR'
    bpy.context.view_layer.objects.active = dst
    dst.select_set(True)
    with bpy.context.temp_override(object=dst, active_object=dst):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    dst.select_set(False)


def regenerate_lods(vid):
    lod0 = bpy.data.collections[f'{vid}_LOD0']
    lod0_objs = list(lod0.objects)
    meshes0 = [o for o in lod0_objs if o.type == 'MESH']
    t0 = sum(S.tri_count(o) for o in meshes0)
    made = []
    for k, ratio in LOD_RATIOS.items():
        name = f'{vid}_LOD{k}'
        coll = bpy.data.collections.get(name)
        if coll is None:
            coll = bpy.data.collections.new(name)
            bpy.data.collections['lark'].children.link(coll)
        clear_collection_objects(coll)
        copies = lods._copy_subtree(lod0_objs, coll)
        src_of = {c: s for s, c in zip(lod0_objs, copies)}
        meshes = [o for o in copies if o.type == 'MESH']
        target = max(int(t0 * ratio), 4)
        got = lods._decimate(meshes, target)
        made.append({'lod': k, 'tris': got, 'target': target, 'ratio': ratio})
        if k == 2:
            for o in meshes:
                src = src_of.get(o)
                if src is not None and any(
                    s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark')
                    for s in o.material_slots
                ):
                    try:
                        transfer_normals(src, o)
                    except Exception as e:  # noqa: BLE001
                        print('NORMAL_XFER_FAIL', o.name, e, flush=True)
    notes['topology'].append({'variant': vid, 'lod0_tris': t0, 'generated': made})
    print('LODS', vid, made, flush=True)


for vid in ('lark', 'lark_damaged', 'lark_husked'):
    regenerate_lods(vid)

# ---------------------------------------------------------------------------
# Save source + receipt
# ---------------------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=str(SRC), compress=True)
blend_sha = hashlib.sha256(SRC.read_bytes()).hexdigest()
receipt = {
    'input_blend_sha256': EXPECTED,
    'output_blend_sha256': blend_sha,
    'notes': notes,
    'constraints': {
        'force_fit_scale': 1.0,
        'atlas': 4096,
        'uv_layer': 'UVMap',
        'no_multi_atlas': True,
    },
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'REVISE-FIX-RECEIPT.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('REVISE_SAVED', blend_sha, flush=True)
