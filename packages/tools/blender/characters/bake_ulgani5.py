"""Bake ONLY three edited materials on an existing validated Ulgani fifth source.

No authoring generator,mesh edit,LOD builder,export,turntable or browser call.
Requires a separately released GPU gate. Saves one checkpoint after each material
and a final distinct source; never replaces the input or canonical fourth assets.
"""
from pathlib import Path
from types import SimpleNamespace
import argparse, ast, datetime, hashlib, json, os, sys
import bpy
import numpy as np

def assert_neutral_morphs():
    """Reference-key values do not contribute to relative-key deformation."""
    references = []
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.data.shape_keys:
            continue
        keys = obj.data.shape_keys
        assert keys.use_relative, f'{obj.name}: absolute shape keys require a separate neutral-pose check'
        assert not obj.show_only_shape_key, f'{obj.name}: shape-key solo display is not a neutral bake pose'
        active = [(key.name, key.value) for key in keys.key_blocks
                  if key != keys.reference_key and abs(key.value) >= 1e-7]
        assert not active, f'{obj.name}: bake requires neutral non-reference morphs;found {active}'
        references.append({'object': obj.name, 'key': keys.reference_key.name,
                           'value': keys.reference_key.value, 'excluded_reference': True})
    return references

parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--expected-input-sha256', required=True)
parser.add_argument('--source-validation', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--textures', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--release-file', type=Path, required=True)
parser.add_argument('--groups', default='Skin,SuitA,SuitB')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
utc = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
source, output, textures, report_path, release = (getattr(args, key).resolve() for key in ('input', 'output', 'textures', 'report', 'release_file'))
assert args.expected_input_sha256 == sha(source)
assert source != output and not output.exists() and not textures.exists() and not report_path.exists()
assert release.exists(), 'GPU/bake gate is closed;obtain the separately scheduled parent GO first'
validation = json.loads(args.source_validation.read_text())
assert validation['status'] == 'PASS' and validation['summary']['fail'] == validation['summary']['warn'] == 0
assert Path(validation['file']).resolve() == source, 'Validation must bind this exact source file'
assert validation['summary']['checks'] == dict.fromkeys(('naming', 'triangles', 'lods', 'materials', 'scale'), 'PASS')
groups = args.groups.split(',')
assert groups and len(groups) == len(set(groups)) and all(g in ('Skin', 'SuitA', 'SuitB') for g in groups)
bpy.ops.wm.open_mainfile(filepath=str(source))
assert {o.name for o in bpy.data.objects if o.type == 'ARMATURE'} == {'RIG_ulgani'}
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
assert scene.get('review5_material_bake_pending')
for group in groups:
    assert bpy.data.materials[f'UL_{group}'].get('review5_bake_pending'), f'{group} already completed;do not rebake it'
neutral_morph_references = assert_neutral_morphs()
block = bpy.data.texts['authoring/lib/bake.py'].as_string()
namespace = {'__name__': 'ulgani5_saved_bake_library'}
exec(compile(block, 'saved-source/authoring/lib/bake.py', 'exec'), namespace)
bake = SimpleNamespace(**namespace)
utility = Path(__file__).with_name('cleanup_ulgani5_source.py')
tree = ast.parse(utility.read_text())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('array_digest', 'snapshot')]
assert len(functions) == 2
exec(compile(ast.Module(body=functions, type_ignores=[]), str(utility), 'exec'), globals())
original = snapshot()
protected_images = {k: v for k, v in original['packed_images'].items() if k.startswith(('UL_Eye_', 'UL_Frond_'))}
assert len(protected_images) == 7 and all(protected_images.values())
protected_active = {name: bpy.data.materials[name].node_tree.nodes.active.name if bpy.data.materials[name].node_tree.nodes.active else None for name in ('UL_Eye', 'UL_Frond')}
textures.mkdir(parents=True)
output.parent.mkdir(parents=True, exist_ok=True)
report_path.parent.mkdir(parents=True, exist_ok=True)
report = {'started_utc': utc(), 'pid': os.getpid(), 'pgid': os.getpgrp(), 'source': str(source), 'source_sha256': sha(source), 'source_validation_sha256': sha(args.source_validation), 'saved_bake_library_sha256': hashlib.sha256(block.encode()).hexdigest(), 'groups': groups, 'scope': 'Existing saved fifth geometry and authored material masks only;no authoring/LOD/export/render/browser stage.', 'threads': 2, 'resolution': {'base': 4096, 'roughness': 4096, 'normal': 4096, 'ao': 2048, 'packed_orm': 4096}, 'samples': {'base_emit': 1, 'roughness_emit': 1, 'normal': 4, 'ao': 32}, 'ao_floor_inherited_from_fourth': {'Skin': .6, 'SuitA': .4, 'SuitB': .4}, 'jpeg_quality': {'base_orm': 92, 'normal': 95}, 'reused_eye_frond_packed_image_sha256': protected_images, 'steps': [], 'status': 'baking'}
report['neutral_morph_references'] = neutral_morph_references
save_report = lambda: report_path.write_text(json.dumps(report, indent=2) + '\n')
save_report()
bake.cycles(scene, samples=16, gpu=True)
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for device in prefs.devices:
    device.use = device.type == 'METAL'
assert any(d.use and d.type == 'METAL' for d in prefs.devices), 'No Metal GPU;no CPU fallback is allowed'
scene.cycles.device = 'GPU'
scene.cycles.denoising_use_gpu = False
report['devices'] = [{'name': d.name, 'type': d.type, 'use': d.use} for d in prefs.devices]
save_report()
print('ULGANI5_BAKE_BEGIN', utc(), json.dumps(report['devices']), flush=True)
body = bpy.data.objects['UL_Body_head1_L0']
heads = [bpy.data.objects[f'UL_Head{i}_head{i}_L0'] for i in range(1, 7)]
for group in groups:
    assert release.exists(), 'GPU release withdrawn at material boundary;completed checkpoints retained'
    material = bpy.data.materials[f'UL_{group}']
    principled = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    objects = [body] + heads if group == 'Skin' else [bpy.data.objects[f'UL_Suit{i}_suit{i}_L0'] for i in ((1, 2) if group == 'SuitA' else (3, 4))]
    assert all(material in [s.material for s in o.material_slots] for o in objects)
    prefix = f'UL5_{group}'  # Distinct IDs: existing input textures must remain readable while baking.
    assert all(bpy.data.images.get(prefix + '_' + suffix) is None for suffix in ('base', 'rough', 'normal', 'ao', 'orm'))
    event = {'material': group, 'started_utc': utc(), 'objects': [o.name for o in objects]}
    report['steps'].append(event)
    save_report()
    base = bake.new_image(prefix + '_base', 4096, True)
    bake.bake_pass(material, objects, base, 'EMIT', principled.inputs['Base Color'].links[0].from_socket, samples=1)
    rough = bake.new_image(prefix + '_rough', 4096, False)
    bake.bake_pass(material, objects, rough, 'EMIT', principled.inputs['Roughness'].links[0].from_socket, samples=1)
    normal = bake.new_image(prefix + '_normal', 4096, False, (.5, .5, 1, 1))
    bake.bake_pass(material, objects, normal, 'NORMAL', samples=4)
    ao = bake.new_image(prefix + '_ao', 2048, False, (1, 1, 1, 1))
    if group == 'Skin':
        bake.bake_pass(material, [body], ao, 'AO', samples=32, occluders=[heads[0]])
        for head in heads:
            bake.bake_pass(material, [head], ao, 'AO', samples=32, occluders=[body], clear=False)
    else:
        for i, obj in enumerate(objects):
            bake.bake_pass(material, [obj], ao, 'AO', samples=32, occluders=[body], clear=(i == 0))
    pixels = bake.pixels(ao)
    pixels[..., :3] = np.maximum(pixels[..., :3], .6 if group == 'Skin' else .4)
    ao.pixels.foreach_set(pixels.ravel())
    ao.update()
    orm = bake.pack_orm(prefix + '_orm', ao, rough, None, 4096)
    paths = {suffix: textures / f'{prefix}_{suffix}.jpg' for suffix in ('base', 'orm', 'normal')}
    base = bake.save_jpeg(base, str(paths['base']), 92)
    orm = bake.save_jpeg(orm, str(paths['orm']), 92)
    normal = bake.save_jpeg(normal, str(paths['normal']), 95)
    event['maps'] = []
    for suffix, image in (('base', base), ('orm', orm), ('normal', normal)):
        assert tuple(image.size) == (4096, 4096) and image.packed_file
        decoded = bake.pixels(image)
        assert np.isfinite(decoded).all()
        event['maps'].append({'path': str(paths[suffix]), 'sha256': sha(paths[suffix]), 'bytes': paths[suffix].stat().st_size, 'size': list(image.size), 'colorspace': image.colorspace_settings.name, 'decoded_finite': True})
    for image in (ao, rough):
        bpy.data.images.remove(image)
    bake.final_material(f'UL_{group}', base, orm, normal, engine_name=material.get('engine_name', group), metallic_from_orm=group != 'Skin')
    material['review5_bake_pending'] = False
    for name, active in protected_active.items():
        bpy.data.materials[name].node_tree.nodes.active = bpy.data.materials[name].node_tree.nodes.get(active) if active else None
    current = snapshot()
    assert original['meshes'] == current['meshes'] and original['rig'] == current['rig'], 'Bake changed saved geometry,UVs,weights,morphs or rig'
    assert protected_images == {k: v for k, v in current['packed_images'].items() if k.startswith(('UL_Eye_', 'UL_Frond_'))}
    scene['review5_material_bake_pending'] = any(bpy.data.materials[f'UL_{g}'].get('review5_bake_pending') for g in ('Skin', 'SuitA', 'SuitB'))
    checkpoint = output.with_name(output.stem + '.' + group + '.blend')
    assert not checkpoint.exists()
    bpy.ops.wm.save_as_mainfile(filepath=str(checkpoint), compress=True)
    event.update(completed_utc=utc(), checkpoint=str(checkpoint), checkpoint_sha256=sha(checkpoint), geometry_rig_invariants_pass=True, eye_frond_packed_images_unchanged=True)
    save_report()
    print('ULGANI5_MATERIAL_BAKED', group, event['completed_utc'], event['checkpoint_sha256'], flush=True)
report['bake_end_utc'] = utc()
print('ULGANI5_BAKE_END', report['bake_end_utc'], flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
report.update(authoring_saved_utc=utc(), output=str(output), output_sha256=sha(output), status='MATERIAL_BAKE_SAVED;export/render/browser/visual-grade still pending')
save_report()
assert sha(source) == args.expected_input_sha256
print('AUTHORING_SAVED', report['authoring_saved_utc'], report['output_sha256'], flush=True)
