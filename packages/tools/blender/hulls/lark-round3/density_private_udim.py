"""Split private 8192 atlases into four packed 4096 UDIM tiles via PNG; remap UVDensity. Private only."""
import bpy, hashlib, json, os
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
PRIVATE = OUT / 'private-candidate/lark.blend'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
PAGE = 4096
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
bpy.context.preferences.filepaths.save_version = 0

uv_count = 0
for o in bpy.data.objects:
    if o.type != 'MESH' or 'UVDensity' not in o.data.uv_layers:
        continue
    layer = o.data.uv_layers['UVDensity']
    for loop in layer.data:
        u, v = loop.uv
        # Only remap once: values already in UDIM space if max>1.5.
        if u <= 1.5 and v <= 1.5:
            loop.uv = (u * 2.0, v * 2.0)
    layer.active = True
    layer.active_render = True
    uv_count += 1

tmp = Path(os.environ['TMPDIR']) / 'udim-png'
tmp.mkdir(exist_ok=True)
created = []

for vid in ('lark', 'lark_damaged', 'lark_husked'):
    for channel in ('baseColor', 'ORM', 'normal'):
        src_name = f'{vid}_8k_{channel}'
        if src_name not in bpy.data.images:
            continue
        src = bpy.data.images[src_name]
        assert tuple(src.size) == (8192, 8192), (src_name, tuple(src.size))
        pix = np.empty(len(src.pixels), np.float32)
        src.pixels.foreach_get(pix)
        atlas = pix.reshape(8192, 8192, 4)
        tiles = {
            1001: atlas[0:PAGE, 0:PAGE],
            1002: atlas[0:PAGE, PAGE:PAGE * 2],
            1011: atlas[PAGE:PAGE * 2, 0:PAGE],
            1012: atlas[PAGE:PAGE * 2, PAGE:PAGE * 2],
        }
        stem = f'{vid}_4k_{channel}'
        for udim, block in tiles.items():
            path = tmp / f'{stem}.{udim}.png'
            n = f'_write_{stem}_{udim}'
            if n in bpy.data.images:
                bpy.data.images.remove(bpy.data.images[n])
            im = bpy.data.images.new(n, PAGE, PAGE, alpha=True)
            im.colorspace_settings.name = 'sRGB' if channel == 'baseColor' else 'Non-Color'
            im.pixels.foreach_set(np.ascontiguousarray(block, np.float32).ravel())
            im.filepath_raw = str(path)
            im.file_format = 'PNG'
            im.save()
            bpy.data.images.remove(im)
        if stem in bpy.data.images:
            bpy.data.images.remove(bpy.data.images[stem])
        img = bpy.data.images.load(str(tmp / f'{stem}.1001.png'))
        img.name = stem
        img.source = 'TILED'
        for udim in (1002, 1011, 1012):
            if udim not in {t.number for t in img.tiles}:
                img.tiles.new(udim)
        img.reload()
        img.colorspace_settings.name = 'sRGB' if channel == 'baseColor' else 'Non-Color'
        img.pack()
        created.append(stem)
        for m in bpy.data.materials:
            if not m.node_tree:
                continue
            for node in m.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image and node.image.name == src_name:
                    node.image = img
        bpy.data.images.remove(src)
        del atlas, pix, tiles
        print('UDIM', stem, flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE), compress=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
receipt = {
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'canonical_sha256': EXPECTED,
    'private_sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'uv_layers_remapped_to_udim': uv_count,
    'created': created,
    'canonical_paths_written': [],
}
path = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-udim.json')
with path.open('x') as f:
    json.dump(receipt, f, indent=2)
print('PRIVATE_UDIM', path.name, flush=True)
