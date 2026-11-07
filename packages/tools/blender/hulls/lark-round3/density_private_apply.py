"""Apply the single-4096 force-fit layout to a private blend copy only; never touch canonical."""
import bpy, hashlib, json, os, shutil
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
SRC = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
LAYOUT_ID = '20261107T133652436368Z-layout-preflight-v11-single4096'
MANIFEST = OUT / f'{LAYOUT_ID}-layout.json'
ARCHIVE = OUT / f'{LAYOUT_ID}-layout.npz'
PRIVATE_DIR = OUT / 'private-candidate'
PRIVATE = PRIVATE_DIR / 'lark.blend'

assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED
manifest = json.loads(MANIFEST.read_text())
assert manifest['layout_fits'] is True
archive = np.load(ARCHIVE)

PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
if PRIVATE.exists():
    PRIVATE.unlink()
shutil.copy2(SRC, PRIVATE)
assert hashlib.sha256(PRIVATE.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
bpy.context.preferences.filepaths.save_version = 0

applied = []
for state, stats in manifest['states'].items():
    by_object = {}
    for r in stats['regions']:
        by_object.setdefault(r['object'], []).append(r)
    for o in bpy.data.collections[state + '_LOD0'].objects:
        if o.type != 'MESH' or o.name not in by_object:
            continue
        m = o.data
        if not m.uv_layers.active:
            m.uv_layers.new(name='UVMap')
        old = m.uv_layers.active
        if old.name != 'UVMap':
            old.name = 'UVMap'
        dens = m.uv_layers.get('UVDensity') or m.uv_layers.new(name='UVDensity')
        uv = np.array([l.uv for l in old.data], np.float64)
        for r in by_object[o.name]:
            key = r['key']
            if key + '/uv' not in archive.files:
                continue
            local = archive[key + '/uv'].astype(np.float64)
            loops = archive[key + '/loops'].astype(np.int32)
            uv[loops] = local
        for i, loop in enumerate(dens.data):
            loop.uv = uv[i]
        dens.active = True
        dens.active_render = True
        applied.append({'state': state, 'object': o.name, 'regions': len(by_object[o.name]), 'scale': stats['force_fit_scale']})
        print('UV', state, o.name, 'scale', round(stats['force_fit_scale'], 4), flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE), compress=True)
receipt = {
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'canonical_untouched_sha256': EXPECTED,
    'private_sha256_after_apply': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'layout_manifest': MANIFEST.name,
    'atlas_pixels': 4096,
    'achieved_px_per_m': {s: manifest['states'][s]['achieved_target_px_per_m'] for s in manifest['states']},
    'applied': applied,
    'canonical_paths_written': [],
}
out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-apply.json')
with out.open('x') as f:
    json.dump(receipt, f, indent=2)
print('PRIVATE_APPLY', out.name, flush=True)
