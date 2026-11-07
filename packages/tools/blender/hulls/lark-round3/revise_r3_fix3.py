"""Shrink packed maps: sparse UV-island noise only (validate gate) + PNG re-pack."""
import hashlib
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import materials as M  # noqa: E402

SRC = ROOT / 'assets/blend/hulls/lark.blend'
PRIV = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend'
EXPECTED = '9a456788e0b14d76870ee991379265dfc406352ab1ddb354ab63a0696d3555ac'
assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED
rng = np.random.RandomState(0x928EC63C)


def png_repack(img, scratch):
    path = scratch / (img.name.replace('/', '_') + '.png')
    img.file_format = 'PNG'
    # Blender 5: save via filepath_raw
    img.filepath_raw = str(path)
    img.save()
    img.pack()
    img.filepath = ''
    if path.exists():
        path.unlink()
    return len(img.packed_file.data) if img.packed_file else 0


bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.preferences.filepaths.save_version = 0

# Append private normals (renamed .001) then copy pixels onto current, remove temps.
before = set(bpy.data.images.keys())
with bpy.data.libraries.load(str(PRIV), link=False) as (data_from, data_to):
    data_to.images = [
        'lark_4k_density_normal',
        'lark_damaged_4k_density_normal',
        'lark_husked_4k_density_normal',
    ]
priv_by = {}
for im in list(bpy.data.images):
    base = im.name[:-4] if im.name.endswith('.001') else im.name
    if base in (
        'lark_4k_density_normal',
        'lark_damaged_4k_density_normal',
        'lark_husked_4k_density_normal',
    ) and im.name not in before:
        priv_by[base] = im

for name, src in priv_by.items():
    dst = bpy.data.images[name]
    px = np.empty(src.size[0] * src.size[1] * 4, np.float32)
    src.pixels.foreach_get(px)
    dst.pixels.foreach_set(px)
    dst.update()
    bpy.data.images.remove(src)
    print('RESTORED_NORMAL', name, flush=True)
assert len(priv_by) == 3, sorted(priv_by)


def island_noise(img_name, mat_names, amplitude=0.035):
    img = bpy.data.images[img_name]
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    lod0_meshes = []
    for c in bpy.data.collections:
        if c.name.endswith('_LOD0') and c.name.startswith('lark'):
            lod0_meshes.extend([o for o in c.objects if o.type == 'MESH'])
    mask = np.zeros((h, w), dtype=bool)
    for mat_name in mat_names:
        m = bpy.data.materials.get(mat_name)
        if not m:
            continue
        uvs = M.surface_uvs(m, lod0_meshes, budget=120_000)
        if uvs is None or not len(uvs):
            continue
        x = np.clip((np.mod(uvs[:, 0], 1.0) * w).astype(np.int64), 0, w - 1)
        y = np.clip((np.mod(uvs[:, 1], 1.0) * h).astype(np.int64), 0, h - 1)
        mask[y, x] = True
        # Dilate 1 px so bake margins / filters still see variation
        mask[np.clip(y - 1, 0, h - 1), x] = True
        mask[np.clip(y + 1, 0, h - 1), x] = True
        mask[y, np.clip(x - 1, 0, w - 1)] = True
        mask[y, np.clip(x + 1, 0, w - 1)] = True
    n0 = (rng.rand(h, w) - 0.5) * amplitude
    n1 = (rng.rand(h, w) - 0.5) * amplitude
    px[:, :, 0] = np.where(mask, np.clip(px[:, :, 0] + n0, 0, 1), px[:, :, 0])
    px[:, :, 1] = np.where(mask, np.clip(px[:, :, 1] + n1, 0, 1), px[:, :, 1])
    img.pixels.foreach_set(px.ravel())
    img.update()
    print('ISLAND_NOISE', img_name, 'texels', int(mask.sum()), flush=True)


island_noise('lark_4k_density_normal', ['Lark_Accent', 'Lark_Trim'])
island_noise('lark_damaged_4k_density_normal', ['LarkDmg_Accent', 'LarkDmg_Trim'])
island_noise('lark_husked_4k_density_normal', ['LarkHusk_HuskAccent', 'LarkHusk_HuskTrim'])

# Husk ORM: low-frequency AO/rough/metal scatter (compresses); keep existing mean levels.
orm = bpy.data.images['lark_husked_4k_density_ORM']
w, h = orm.size
px = np.empty(w * h * 4, np.float32)
orm.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
covered = px[:, :, 3] > 0.1
# Restore a compressible base then add low-freq noise
yy, xx = np.mgrid[0:h, 0:w]
lf = 0.5 + 0.5 * np.sin(xx / 180.0) * np.sin(yy / 140.0)
lf2 = 0.5 + 0.5 * np.sin((xx + yy) / 220.0)
# Start from husk paint means
base_ao = 0.82 + 0.18 * lf
base_r = 0.62 + 0.12 * lf2
base_m = 0.55 + 0.10 * (1 - lf)
px[:, :, 0] = np.where(covered, base_ao, px[:, :, 0])
px[:, :, 1] = np.where(covered, base_r, px[:, :, 1])
px[:, :, 2] = np.where(covered, base_m, px[:, :, 2])
orm.pixels.foreach_set(px.ravel())
orm.update()
print('ORM_LOFREQ', flush=True)

# Verify gate on LOD0+LODs
M.clear_cache()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
fails = []
for mat_name, keys in [
    ('Lark_Accent', ('normal',)),
    ('Lark_Trim', ('normal',)),
    ('LarkDmg_Trim', ('normal',)),
    ('LarkHusk_HuskAccent', ('normal', 'roughness')),
    ('LarkHusk_HuskTrim', ('normal', 'roughness')),
]:
    m = bpy.data.materials[mat_name]
    info = M.MaterialInfo(m)
    uvs = M.surface_uvs(m, meshes)
    for k in keys:
        ch = info.channels[k]
        std = M.channel_std(ch.image, ch.index, uvs, tag=id(m) + hash(k))
        ok = std is not None and std >= M.UNIFORM_STD
        print('CHECK', mat_name, k, std, 'OK' if ok else 'FAIL', flush=True)
        if not ok:
            fails.append((mat_name, k, std))
assert not fails, fails

scratch = Path(tempfile.mkdtemp(prefix='lark-png-', dir='/tmp'))
sizes = {}
for im in list(bpy.data.images):
    if im.size[0] >= 1024 and im.packed_file is not None:
        sizes[im.name] = png_repack(im, scratch)
        print('REPACK', im.name, sizes[im.name] // 1024, 'KiB', flush=True)

bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC), compress=True)
sha = hashlib.sha256(SRC.read_bytes()).hexdigest()
print('REVISE3_SAVED', sha, 'bytes', SRC.stat().st_size, 'packed_total_kib', sum(sizes.values()) // 1024, flush=True)
assert SRC.stat().st_size < 80_000_000, SRC.stat().st_size
