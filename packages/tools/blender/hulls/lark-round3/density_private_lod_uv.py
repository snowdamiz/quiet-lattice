"""Transfer UVDensity from each LOD0 mesh to lower LODs on the private blend only."""
import bpy, hashlib, json, os
from pathlib import Path
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
PRIVATE = OUT / 'private-candidate/lark.blend'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
bpy.context.preferences.filepaths.save_version = 0
receipts = []


def transfer_uv(src, dst):
    """Nearest LOD0 loop corner (world) → destination UVDensity."""
    sm = src.data
    dm = dst.data
    src_uv = sm.uv_layers['UVDensity']
    if 'UVDensity' not in dm.uv_layers:
        dm.uv_layers.new(name='UVDensity')
    dens = dm.uv_layers['UVDensity']
    # Build KD over source loop positions.
    pts = []
    uvs = []
    for li, loop in enumerate(sm.loops):
        co = src.matrix_world @ sm.vertices[loop.vertex_index].co
        pts.append(co)
        uvs.append(src_uv.data[li].uv.copy())
    tree = KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    for li, loop in enumerate(dm.loops):
        co = dst.matrix_world @ dm.vertices[loop.vertex_index].co
        _co, idx, _dist = tree.find(co)
        dens.data[li].uv = uvs[idx]
    dens.active = True
    dens.active_render = True


for state in ('lark', 'lark_damaged', 'lark_husked'):
    src_coll = bpy.data.collections[state + '_LOD0']
    sources = {o.name: o for o in src_coll.objects if o.type == 'MESH' and 'UVDensity' in o.data.uv_layers}
    for lod in (1, 2, 3):
        coll = bpy.data.collections[f'{state}_LOD{lod}']
        for o in coll.objects:
            if o.type != 'MESH':
                continue
            # Lower LODs are named Body.001 / Body_dmg.001 etc.
            stem = o.name.split('.')[0]
            src = sources.get(stem)
            if src is None:
                receipts.append({'object': o.name, 'lod': lod, 'state': state, 'status': 'no-source'})
                continue
            transfer_uv(src, o)
            receipts.append({'object': o.name, 'source': src.name, 'lod': lod, 'state': state, 'status': 'transferred', 'loops': len(o.data.loops)})
            print('LOD_UV', state, lod, o.name, '<-', src.name, flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE), compress=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
out = {
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'canonical_sha256': EXPECTED,
    'private_sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'transfers': receipts,
    'canonical_paths_written': [],
    'method': 'world-space nearest LOD0 loop UVDensity',
}
path = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-lod-uv.json')
with path.open('x') as f:
    json.dump(out, f, indent=2)
print('PRIVATE_LOD_UV', path.name, 'count', len(receipts), flush=True)
