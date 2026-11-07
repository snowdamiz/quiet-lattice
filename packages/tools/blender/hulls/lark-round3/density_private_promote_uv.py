"""Collapse UVDensity onto UVMap so stock glTF keeps one TEXCOORD (avoids Dark engine_name split on skinned meshes). Private only."""
import bpy, hashlib, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
PRIVATE = OUT / 'private-candidate/lark.blend'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'

assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
bpy.context.preferences.filepaths.save_version = 0

mesh_receipts = []
for o in bpy.data.objects:
    if o.type != 'MESH' or 'UVDensity' not in o.data.uv_layers:
        continue
    m = o.data
    dens = m.uv_layers['UVDensity']
    uvmap = m.uv_layers.get('UVMap')
    if uvmap is None:
        dens.name = 'UVMap'
        uvmap = dens
    else:
        for src, dst in zip(dens.data, uvmap.data):
            dst.uv = src.uv[:]
        m.uv_layers.remove(dens)
    uvmap.active = True
    uvmap.active_render = True
    while len(m.uv_layers) > 1:
        extra = next(u for u in m.uv_layers if u.name != 'UVMap')
        m.uv_layers.remove(extra)
    mesh_receipts.append({'object': o.name, 'uv_layers': [u.name for u in m.uv_layers]})

mat_receipts = []
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    changed = False
    for node in mat.node_tree.nodes:
        if node.type == 'UVMAP' and node.uv_map == 'UVDensity':
            node.uv_map = 'UVMap'
            changed = True
    if changed:
        mat_receipts.append(mat.name)

bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE), compress=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
receipt = {
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'canonical_sha256': EXPECTED,
    'private_sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'meshes_promoted': len(mesh_receipts),
    'materials_retargeted': mat_receipts,
    'mesh_samples': mesh_receipts[:20],
    'canonical_paths_written': [],
}
out = OUT / (os.environ['LARK_ATTEMPT_ID'] + '-private-promote-uv.json')
with out.open('x') as f:
    json.dump(receipt, f, indent=2)
print('PRIVATE_PROMOTE_UV', out.name, receipt['meshes_promoted'], 'mats', len(mat_receipts), flush=True)
