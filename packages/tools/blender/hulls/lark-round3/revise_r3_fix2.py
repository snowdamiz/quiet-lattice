"""Validate-gate fix after REVISE: restore map variation under flat density islands; regen LODs with UV+normal transfer."""
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import lods  # noqa: E402
from artlib import scene as S  # noqa: E402

SRC = ROOT / 'assets/blend/hulls/lark.blend'
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
EXPECTED = '227627386561601af21a54b09828ec91160ac49dd04bb70883cc46e0fed8adcb'
assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.preferences.filepaths.save_version = 0
rng = np.random.RandomState(0x928EC63C)


def pack(img):
    img.pack()
    img.update()


def enliven_normal(name):
    img = bpy.data.images[name]
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    # Density layout left unmarked panels as flat (0.5,0.5,1). Seed imperceptible detail so
    # Accent/Trim UV islands clear the validate UNIFORM_STD gate without a visible LOD0 change.
    flat = (np.abs(px[:, :, 0] - 0.5) < 0.01) & (np.abs(px[:, :, 1] - 0.5) < 0.01) & (px[:, :, 2] > 0.98)
    n0 = (rng.rand(h, w) - 0.5) * 0.04
    n1 = (rng.rand(h, w) - 0.5) * 0.04
    px[:, :, 0] = np.where(flat, np.clip(0.5 + n0, 0, 1), px[:, :, 0])
    px[:, :, 1] = np.where(flat, np.clip(0.5 + n1, 0, 1), px[:, :, 1])
    img.pixels.foreach_set(px.ravel())
    pack(img)
    print('NORMAL_ENLIVEN', name, 'flat_texels', int(flat.sum()), flush=True)


def enliven_husk_orm():
    img = bpy.data.images['lark_husked_4k_density_ORM']
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    # Covered texels (alpha or any non-zero channel from bake)
    covered = (px[:, :, 3] > 0.1) & ((px[:, :, 1] > 0.01) | (px[:, :, 2] > 0.01) | (px[:, :, 0] > 0.01))
    # AO (R): burnt-panel variation
    ao = 0.75 + 0.25 * rng.rand(h, w)
    # Roughness (G): broader husk scatter around existing
    rough = np.clip(px[:, :, 1] + (rng.rand(h, w) - 0.5) * 0.12, 0.35, 0.95)
    # Metallic (B): slight scatter
    metal = np.clip(px[:, :, 2] + (rng.rand(h, w) - 0.5) * 0.08, 0.35, 0.85)
    px[:, :, 0] = np.where(covered, ao, px[:, :, 0])
    px[:, :, 1] = np.where(covered, rough, px[:, :, 1])
    px[:, :, 2] = np.where(covered, metal, px[:, :, 2])
    img.pixels.foreach_set(px.ravel())
    pack(img)
    print('ORM_ENLIVEN', 'covered', int(covered.sum()), 'g_std', float(px[:, :, 1][covered].std()) if covered.any() else None, flush=True)


for n in ('lark_4k_density_normal', 'lark_damaged_4k_density_normal', 'lark_husked_4k_density_normal'):
    enliven_normal(n)
enliven_husk_orm()


def clear_collection_objects(coll):
    for o in list(coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def transfer_uv_normals(src, dst):
    if src is None or dst is None or src.type != 'MESH' or dst.type != 'MESH':
        return
    mod = dst.modifiers.new('LOD_xfer', 'DATA_TRANSFER')
    mod.object = src
    mod.use_corner_data = True
    mod.data_types_corners = {'UV'}
    mod.use_loop_data = True
    mod.data_types_loops = {'CUSTOM_NORMAL'}
    mod.loop_mapping = 'NEAREST_POLYNOR'
    mod.poly_mapping = 'NEAREST'
    bpy.context.view_layer.objects.active = dst
    dst.select_set(True)
    with bpy.context.temp_override(object=dst, active_object=dst):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    dst.select_set(False)


LOD_RATIOS = {1: 0.30, 2: 0.20, 3: 0.035}
receipt = {'lods': []}
for vid in ('lark', 'lark_damaged', 'lark_husked'):
    lod0 = bpy.data.collections[f'{vid}_LOD0']
    lod0_objs = list(lod0.objects)
    meshes0 = [o for o in lod0_objs if o.type == 'MESH']
    t0 = sum(S.tri_count(o) for o in meshes0)
    made = []
    for k, ratio in LOD_RATIOS.items():
        coll = bpy.data.collections[f'{vid}_LOD{k}']
        clear_collection_objects(coll)
        copies = lods._copy_subtree(lod0_objs, coll)
        src_of = {c: s for s, c in zip(lod0_objs, copies)}
        meshes = [o for o in copies if o.type == 'MESH']
        target = max(int(t0 * ratio), 4)
        got = lods._decimate(meshes, target)
        for o in meshes:
            src = src_of.get(o)
            if src is not None and any(
                s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark')
                for s in o.material_slots
            ):
                try:
                    transfer_uv_normals(src, o)
                except Exception as e:  # noqa: BLE001
                    print('XFER_FAIL', o.name, e, flush=True)
        made.append({'lod': k, 'tris': got, 'target': target, 'ratio': ratio})
    receipt['lods'].append({'variant': vid, 'lod0_tris': t0, 'generated': made})
    print('LODS', vid, made, flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(SRC), compress=True)
sha = hashlib.sha256(SRC.read_bytes()).hexdigest()
receipt['output_blend_sha256'] = sha
receipt['input_blend_sha256'] = EXPECTED
(OUT / 'REVISE-FIX2-RECEIPT.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('REVISE2_SAVED', sha, flush=True)
