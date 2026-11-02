"""Read saved character sources and write objective rig, morph and material evidence.

Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/characters/audit.py -- <root> <report.json>
No scene is changed or saved. A matching bone hierarchy proves animation naming compatibility,
not identical rest matrices or visual quality. Material samples use occupied LOD0 UVs only.
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np


def coords(points):
    value = np.empty(len(points) * 3, np.float32)
    points.foreach_get('co', value)
    return value.reshape(-1, 3)


def material_samples(objects):
    samples = {}
    for obj in objects:
        uv = obj.data.uv_layers.active
        if uv is None:
            continue
        for polygon in obj.data.polygons:
            material = obj.material_slots[polygon.material_index].material
            if material is None:
                continue
            bucket = samples.setdefault(material.name, [])
            if len(bucket) >= 8192:
                continue
            center = np.mean([uv.data[i].uv[:] for i in polygon.loop_indices], axis=0)
            bucket.append(center)
    result = {}
    for name, uvs in samples.items():
        material = bpy.data.materials[name]
        entry = {'occupied_uv_samples': len(uvs), 'images': {}}
        for node in material.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or node.image is None:
                continue
            image = node.image
            entry['images'][image.name] = {'size': list(image.size), 'colorspace': image.colorspace_settings.name, 'packed': bool(image.packed_file)}
            if image.name.endswith('_orm'):
                width, height = image.size
                pixels = np.empty(width * height * 4, np.float32)
                image.pixels.foreach_get(pixels)
                pixels = pixels.reshape(height, width, 4)
                uv_array = np.array(uvs)
                x = np.clip((uv_array[:, 0] * width).astype(int), 0, width - 1)
                y = np.clip((uv_array[:, 1] * height).astype(int), 0, height - 1)
                for channel, label in enumerate(('occlusion', 'roughness', 'metallic')):
                    entry[label] = dict(zip(('p05', 'median', 'p95'), map(float, np.quantile(pixels[y, x, channel], (0.05, 0.5, 0.95)))))
        result[name] = entry
    return result


args = sys.argv[sys.argv.index('--') + 1:]
root, output = Path(args[0]).resolve(), Path(args[1]).resolve()
result = {'note': 'Objective source audit; not a visual grade.', 'species': {}}
hierarchies = []
for people in ('thalune', 'ixari', 'ulgani'):
    source = root / 'assets/blend/characters' / f'{people}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    assert len(rigs) == 1, (people, 'one armature required', len(rigs))
    hierarchy = {b.name: b.parent.name if b.parent else None for b in rigs[0].data.bones}
    hierarchies.append(hierarchy)
    entry = {'source': str(source.relative_to(root)), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'bone_count': len(hierarchy), 'hierarchy': hierarchy, 'variants': {}, 'morph_displacement_m': {}}
    for kind, count in (('head', 6), ('suit', 4)):
        for number in range(1, count + 1):
            variant = f'{people}_{kind}{number}'
            levels = []
            for level in range(4):
                collection = bpy.data.collections[f'{variant}_LOD{level}']
                triangles = 0
                for obj in collection.objects:
                    if obj.type == 'MESH':
                        obj.data.calc_loop_triangles()
                        triangles += len(obj.data.loop_triangles)
                levels.append(triangles)
            entry['variants'][variant] = levels
    collection = bpy.data.collections[f'{people}_head1_LOD0']
    meshes = [o for o in collection.objects if o.type == 'MESH']
    for obj in meshes:
        if obj.data.shape_keys:
            blocks = obj.data.shape_keys.key_blocks
            base = coords(blocks[0].data)
            entry['morph_displacement_m'][obj.name] = {key.name: float(np.linalg.norm(coords(key.data) - base, axis=1).max()) for key in list(blocks)[1:]}
    entry['materials'] = material_samples(meshes + [o for o in bpy.data.collections[f'{people}_suit3_LOD0'].objects if o.type == 'MESH'])
    result['species'][people] = entry
    print('AUDIT', people, entry['bone_count'], 'bones', len(entry['variants']), 'variants', flush=True)
result['shared_bone_hierarchy'] = all(h == hierarchies[0] for h in hierarchies)
assert result['shared_bone_hierarchy'], 'Character bone hierarchy differs'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + '\n')
print('AUDIT wrote', output)
