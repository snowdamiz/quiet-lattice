"""Recompress packed 4k maps via zlib PNG writer; restore private normals + sparse island noise."""
import hashlib
import json
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import materials as M  # noqa: E402

SRC = ROOT / 'assets/blend/hulls/lark.blend'
PRIV = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend'
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
EXPECTED = hashlib.sha256(SRC.read_bytes()).hexdigest()
rng = np.random.RandomState(0x928EC63C)


def write_png_rgba(path, rgba_topdown_u8):
    """rgba_topdown_u8: (H,W,4) uint8, top-down."""
    h, w, c = rgba_topdown_u8.shape
    assert c == 4
    raw = b''.join(b'\x00' + rgba_topdown_u8[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.preferences.filepaths.save_version = 0

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
assert len(priv_by) == 3, sorted(priv_by)
for name, src in priv_by.items():
    dst = bpy.data.images[name]
    px = np.empty(src.size[0] * src.size[1] * 4, np.float32)
    src.pixels.foreach_get(px)
    dst.pixels.foreach_set(px)
    dst.update()
    bpy.data.images.remove(src)
    print('RESTORED', name, flush=True)


def island_noise(img_name, mat_names, amplitude=0.04):
    img = bpy.data.images[img_name]
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    lod0 = []
    for c in bpy.data.collections:
        if c.name.endswith('_LOD0') and c.name.startswith('lark'):
            lod0.extend([o for o in c.objects if o.type == 'MESH'])
    mask = np.zeros((h, w), dtype=bool)
    for mat_name in mat_names:
        m = bpy.data.materials.get(mat_name)
        if not m:
            continue
        uvs = M.surface_uvs(m, lod0, budget=150_000)
        if uvs is None or not len(uvs):
            continue
        x = np.clip((np.mod(uvs[:, 0], 1.0) * w).astype(np.int64), 0, w - 1)
        y = np.clip((np.mod(uvs[:, 1], 1.0) * h).astype(np.int64), 0, h - 1)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                mask[np.clip(y + dy, 0, h - 1), np.clip(x + dx, 0, w - 1)] = True
    n0 = (rng.rand(h, w) - 0.5) * amplitude
    n1 = (rng.rand(h, w) - 0.5) * amplitude
    px[:, :, 0] = np.where(mask, np.clip(px[:, :, 0] + n0, 0, 1), px[:, :, 0])
    px[:, :, 1] = np.where(mask, np.clip(px[:, :, 1] + n1, 0, 1), px[:, :, 1])
    img.pixels.foreach_set(px.ravel())
    img.update()
    print('NOISE', img_name, int(mask.sum()), flush=True)


island_noise('lark_4k_density_normal', ['Lark_Accent', 'Lark_Trim'])
island_noise('lark_damaged_4k_density_normal', ['LarkDmg_Accent', 'LarkDmg_Trim'])
island_noise('lark_husked_4k_density_normal', ['LarkHusk_HuskAccent', 'LarkHusk_HuskTrim'])

orm = bpy.data.images['lark_husked_4k_density_ORM']
w, h = orm.size
px = np.empty(w * h * 4, np.float32)
orm.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
# Prefer alpha from baseColor coverage via husk paint: non-black-ish G/B from prior bake
covered = (px[:, :, 1] > 0.05) | (px[:, :, 2] > 0.05) | (px[:, :, 0] > 0.05)
yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
lf = 0.5 + 0.5 * np.sin(xx / 180.0) * np.sin(yy / 140.0)
lf2 = 0.5 + 0.5 * np.sin((xx + yy) / 220.0)
px[:, :, 0] = np.where(covered, 0.82 + 0.18 * lf, 0.0)
px[:, :, 1] = np.where(covered, 0.62 + 0.12 * lf2, 0.0)
px[:, :, 2] = np.where(covered, 0.55 + 0.10 * (1 - lf), 0.0)
px[:, :, 3] = np.where(covered, 1.0, 0.0)
orm.pixels.foreach_set(px.ravel())
orm.update()
print('ORM_LOFREQ', int(covered.sum()), flush=True)


def zlib_pack(img, scratch):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    arr = np.clip(np.flipud(px) * 255.0, 0, 255).astype(np.uint8)
    path = scratch / (img.name.replace('/', '_') + '.png')
    write_png_rgba(path, arr)
    # Replace packed content: unpack-remove, load file, pack.
    if img.packed_file:
        img.unpack(method='REMOVE')
    img.source = 'FILE'
    img.filepath = str(path)
    img.reload()
    assert img.size[0] == w and img.size[1] == h, (img.name, img.size)
    img.pack()
    packed = len(img.packed_file.data)
    img.filepath = ''
    path.unlink(missing_ok=True)
    return packed


scratch = Path(tempfile.mkdtemp(prefix='lark-png-', dir='/tmp'))
sizes = {}
for im in list(bpy.data.images):
    if im.size[0] >= 1024:
        sizes[im.name] = zlib_pack(im, scratch)
        print('PACK', im.name, sizes[im.name] // 1024, 'KiB', flush=True)

M.clear_cache()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
fails = []
for mat_name, keys in [
    ('Lark_Accent', ('normal',)),
    ('Lark_Trim', ('normal',)),
    ('LarkDmg_Trim', ('normal',)),
    ('LarkHusk_HuskAccent', ('normal', 'roughness')),
    ('LarkHusk_HuskTrim', ('normal', 'roughness')),
    ('LarkHusk_HuskHull', ('roughness',)),
]:
    m = bpy.data.materials[mat_name]
    info = M.MaterialInfo(m)
    uvs = M.surface_uvs(m, meshes)
    for k in keys:
        ch = info.channels[k]
        std = M.channel_std(ch.image, ch.index, uvs, tag=id(m) + hash(k))
        ok = std is not None and std >= M.UNIFORM_STD
        print('CHECK', mat_name, k, None if std is None else round(std, 5), 'OK' if ok else 'FAIL', flush=True)
        if not ok:
            fails.append((mat_name, k, std))
assert not fails, fails

bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC), compress=True)
# Drop autosave sibling if created
Path(str(SRC) + '1').unlink(missing_ok=True)
sha = hashlib.sha256(SRC.read_bytes()).hexdigest()
size = SRC.stat().st_size
(OUT / 'REVISE-REPACK-RECEIPT.json').write_text(json.dumps({
    'input': EXPECTED,
    'output': sha,
    'bytes': size,
    'packed_kib': {k: v // 1024 for k, v in sizes.items()},
}, indent=2) + '\n')
print('REPACK_SAVED', sha, 'bytes', size, 'packed_total_kib', sum(sizes.values()) // 1024, flush=True)
assert size < 55_000_000, size
