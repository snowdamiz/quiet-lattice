"""Requested-people contract on the saved GLB, before its art report can PASS.

Generic character gates validate decoding, geometry, materials and budgets. These
checks additionally bind the active scene to the requested viewmodel and the
Skin/Bio/tool, hand/digit skin and marker contract used by Multitool/sharedRig.
"""
import json
from pathlib import Path

from artlib import glb, ktx


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_export(path, people, assets):
    require(people in ('thalune', 'ixari', 'ulgani'), f'unknown people {people}')
    expected = f'fp_{people}'
    require(len(assets) == 1 and assets[0]['asset'] == expected, f'expected asset {expected}')
    variants = assets[0]['variants']
    require(len(variants) == 1 and variants[0]['id'] == expected and
            variants[0]['class'] == 'viewmodel' and variants[0]['lods'] == [0],
            f'expected one {expected} viewmodel variant at LOD0')
    document, _ = glb.read(path)
    scene = document['scenes'][document.get('scene', 0)]
    require(scene.get('extras', {}).get('viewmodel_people') == people, f'expected scene people {people}')
    axes = json.loads(Path(__file__).with_name('bind_axes.json').read_text())
    require(scene['extras'].get('viewmodel_axes_profile') == axes['id'], 'wrong viewmodel axes profile')
    nodes = document['nodes']
    roots = scene.get('nodes', [])
    require(len(roots) == 1 and nodes[roots[0]].get('name') == expected and
            nodes[roots[0]].get('extras', {}).get('asset_class') == 'viewmodel', f'expected root {expected}')
    parents, active = {}, set()

    def visit(index):
        require(index not in active, 'active scene has repeated or cyclic nodes')
        active.add(index)
        for child in nodes[index].get('children', []):
            parents[child] = index
            visit(child)

    visit(roots[0])
    names = {nodes[index].get('name'): index for index in active}
    require(len(names) == len(active), 'active scene has duplicate node names')
    require(f'{expected}_LOD0' in names and parents.get(names[f'{expected}_LOD0']) == roots[0],
            f'expected variant node {expected}_LOD0')
    joint_names = set(axes['axes'])
    require(joint_names <= names.keys(), 'active scene is missing viewmodel joints')
    required_parents = {'vm_root': f'RIG_{expected}'}
    for side in ('L', 'R'):
        required_parents.update({f'vm_upperarm_{side}': 'vm_root',
                                 f'vm_upperarm_twist_{side}': f'vm_upperarm_{side}',
                                 f'vm_lowerarm_{side}': f'vm_upperarm_{side}',
                                 f'vm_lowerarm_twist_{side}': f'vm_lowerarm_{side}',
                                 f'vm_hand_{side}': f'vm_lowerarm_{side}'})
        for digit in ('index', 'middle', 'ring', 'thumb'):
            for joint in (1, 2, 3):
                required_parents[f'vm_{digit}_{joint:02}_{side}'] = (
                    f'vm_hand_{side}' if joint == 1 else f'vm_{digit}_{joint-1:02}_{side}')
    required_parents.update({marker: 'vm_hand_R' for marker in ('Muzzle', 'Grip_R', 'Grip_L')})
    for name, parent in required_parents.items():
        require(name in names and parent in names and parents.get(names[name]) == names[parent],
                f'expected {name} attached to {parent}')
    required_materials = {'Skin', f'VM_{people}_Tool'} | (set() if people == 'ulgani' else {'Bio'})
    used_materials, mesh_count = set(), 0
    for index in active:
        node = nodes[index]
        if 'mesh' not in node:
            continue
        mesh_count += 1
        require(node.get('extras', {}).get('art_variant') == expected and node['extras'].get('art_lod') == 0,
                f'{node["name"]}: wrong mesh variant')
        require('skin' in node, f'{node["name"]}: missing skin')
        skin = document['skins'][node['skin']]
        joints = skin['joints']
        require(skin.get('name') == f'RIG_{expected}' and len(joints) == len(joint_names) and
                set(joints) == {names[name] for name in joint_names}, f'{node["name"]}: wrong viewmodel skin')
        for primitive in document['meshes'][node['mesh']]['primitives']:
            require({'JOINTS_0', 'WEIGHTS_0'} <= primitive['attributes'].keys(), f'{node["name"]}: missing skin attributes')
            require('material' in primitive, f'{node["name"]}: missing material')
            used_materials.add(primitive['material'])
    require(mesh_count > 0, 'no active skinned viewmodel meshes')
    materials = [document['materials'][index] for index in used_materials]
    require({m.get('name') for m in materials} == required_materials, f'expected materials {sorted(required_materials)}')
    for material in materials:
        name = material['name']
        require('KHR_materials_unlit' not in material.get('extensions', {}), f'{name}: unlit material')
        pbr = material.get('pbrMetallicRoughness', {})
        slots = {slot: pbr.get(slot) for slot in ('baseColorTexture', 'metallicRoughnessTexture')}
        slots.update({slot: material.get(slot) for slot in ('normalTexture', 'occlusionTexture')})
        if name != 'Skin':
            slots['emissiveTexture'] = material.get('emissiveTexture')
        for slot, info in slots.items():
            require(info is not None, f'{name}: missing {slot}')
            texture = document['textures'][info['index']]
            require('KHR_texture_basisu' in texture.get('extensions', {}), f'{name}: {slot} is not Basis KTX2')
    images, _ = ktx.inspect(path)
    require(bool(images), 'missing material images')
    for image in images:
        header = image['ktx']
        require(image['basisu'] and header and header['width'] == header['height'] == 2048 and
                header['levels'] == 12 and header['fullChain'], f'{image["name"]}: expected complete 2k KTX2')
