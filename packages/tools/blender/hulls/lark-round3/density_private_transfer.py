"""Remap LOD0 atlas paint onto private UVDensity at 4096; flat shared normals. Private only."""
import bpy, hashlib, json, os, sys, time
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import bake, materials as M

OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
PRIVATE = OUT / 'private-candidate/lark.blend'
CANON = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
LAYOUT_ID = '20261107T141425710088Z-layout-shrink512-v12j'
MANIFEST = json.loads((OUT / f'{LAYOUT_ID}-layout.json').read_text())
ATLAS = 4096
vid = sys.argv[sys.argv.index('--') + 1]
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED

bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
bake.ensure_cycles(scene, samples=1)
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.bake.margin = 8

coll = bpy.data.collections[vid + '_LOD0']
allmeshes = [o for o in coll.objects if o.type == 'MESH']
meshes = [o for o in allmeshes if any(s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark') for s in o.material_slots)]
assert all('UVDensity' in o.data.uv_layers and 'UVMap' in o.data.uv_layers for o in meshes)
for o in meshes:
    o.data.uv_layers['UVDensity'].active = True
    o.data.uv_layers['UVDensity'].active_render = True
pbr = {s.material for o in meshes for s in o.material_slots if s.material and s.material.get('engine_name') in ('Hull', 'Accent', 'Trim', 'Dark')}
for o in list(scene.objects):
    o.hide_render = o not in allmeshes
bake._select(meshes)

old_images = {}
for m in pbr:
    info = M.MaterialInfo(m)
    for ch, key in (('baseColor', 'baseColor'), ('occlusion', 'ORM'), ('normal', 'normal')):
        slot = info.channels.get(ch)
        if slot and getattr(slot, 'image', None):
            old_images.setdefault(key, slot.image)
    rough = info.channels.get('roughness')
    if rough and getattr(rough, 'image', None):
        old_images.setdefault('ORM', rough.image)
for ch, name in [('baseColor', vid + '_4k_baseColor'), ('ORM', vid + '_4k_ORM'), ('normal', vid + '_final_4k_normal')]:
    if ch not in old_images and name in bpy.data.images:
        old_images[ch] = bpy.data.images[name]
if 'normal' not in old_images and vid + '_4k_normal' in bpy.data.images:
    old_images['normal'] = bpy.data.images[vid + '_4k_normal']
assert set(old_images) >= {'baseColor', 'ORM', 'normal'}, sorted(old_images)

keep = {m: next(n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL') for m in pbr}
surfaces = {m: out.inputs['Surface'].links[0].from_socket for m, out in keep.items()}
new_images = {}
receipts = []
for channel, image in old_images.items():
    start = time.monotonic()
    target = bake._new_target(vid + '_4k_density_' + channel, ATLAS, channel == 'baseColor')
    nodes = []
    emissions = []
    for m in pbr:
        nt = m.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = target
        nt.nodes.active = tex
        nodes.append((m, tex))
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        src = nt.nodes.new('ShaderNodeTexImage')
        src.image = image
        nt.links.new(uv.outputs['UV'], src.inputs['Vector'])
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(src.outputs['Color'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], keep[m].inputs['Surface'])
        emissions.extend([(m, em), (m, src), (m, uv)])
    bpy.ops.object.bake(type='EMIT', use_clear=True)
    for m, n in nodes:
        m.node_tree.nodes.remove(n)
    for m, n in emissions:
        m.node_tree.nodes.remove(n)
    for m in pbr:
        m.node_tree.links.new(surfaces[m], keep[m].inputs['Surface'])
    raw = np.empty(ATLAS * ATLAS * 4, np.float32)
    target.pixels.foreach_get(raw)
    if channel == 'normal':
        arr = raw.reshape(ATLAS, ATLAS, 4)
        filled = 0
        for r in MANIFEST['states'][vid]['regions']:
            if r.get('shared_finish_bake') != 'flat_normal_constant_ao' or 'packing' not in r:
                continue
            pack = r['packing']
            x0, y0 = int(pack['x']), int(pack['y'])
            y1, x1 = min(ATLAS, y0 + int(pack['h'])), min(ATLAS, x0 + int(pack['w']))
            if y1 <= y0 or x1 <= x0:
                continue
            arr[y0:y1, x0:x1, 0] = 0.5
            arr[y0:y1, x0:x1, 1] = 0.5
            arr[y0:y1, x0:x1, 2] = 1.0
            arr[y0:y1, x0:x1, 3] = 1.0
            filled += 1
        target.pixels.foreach_set(arr.ravel())
        target.update()
    else:
        filled = 0
    target.pack()
    new_images[channel] = target
    receipts.append({'channel': channel, 'seconds': round(time.monotonic() - start, 3), 'shared_normal_rects_filled': filled})
    print('TRANSFER', vid, channel, receipts[-1]['seconds'], flush=True)

for m in pbr:
    nt = m.node_tree
    nt.nodes.clear()
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVDensity'
    textures = {}
    for ch in ('baseColor', 'ORM', 'normal'):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = new_images[ch]
        nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
        textures[ch] = n
    nt.links.new(textures['baseColor'].outputs['Color'], bs.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(textures['ORM'].outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bs.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
    grp = nt.nodes.new('ShaderNodeGroup')
    grp.node_tree = bake._gltf_group()
    nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    norm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(textures['normal'].outputs['Color'], norm.inputs['Color'])
    nt.links.new(norm.outputs['Normal'], bs.inputs['Normal'])
    m['round3_density_private'] = True
    m['bake_resolution'] = ATLAS

bpy.ops.wm.save_as_mainfile(filepath=str(PRIVATE), compress=True)
assert hashlib.sha256(CANON.read_bytes()).hexdigest() == EXPECTED
receipt = {
    'variant': vid,
    'private_blend': str(PRIVATE.relative_to(ROOT)),
    'canonical_sha256': EXPECTED,
    'private_sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(),
    'atlas_pixels': ATLAS,
    'maps': receipts,
    'canonical_paths_written': [],
}
out = OUT / (os.environ['LARK_ATTEMPT_ID'] + f'-private-transfer-{vid}.json')
with out.open('x') as f:
    json.dump(receipt, f, indent=2)
print('PRIVATE_TRANSFER', out.name, flush=True)
