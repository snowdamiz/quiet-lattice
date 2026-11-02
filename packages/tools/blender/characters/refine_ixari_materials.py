"""Paint fifth-review corrections into the saved Ixari source's packed 4K maps.

Blender -b <refined-geometry.blend> -t 2 --python-exit-code 1 -P this.py --
    <output.blend> <texture-work-directory>
The original UVs locate every painted texel. No shared authoring module changes.
"""
from pathlib import Path
import hashlib
import json
import sys

import bpy
import numpy as np

output, directory = (Path(value).resolve() for value in sys.argv[sys.argv.index('--') + 1:])
assert bpy.context.scene.get('ixari_review5_geometry') and not bpy.context.scene.get('ixari_review5_materials')
directory.mkdir(parents=True, exist_ok=True)
evidence = {'source_sha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(), 'materials': {}}
rig = bpy.data.objects['RIG_ixari']
size = 4096


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def pixels(image):
    assert tuple(image.size) == (size, size)
    data = np.empty(size * size * 4, np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(size, size, 4)


def save_map(name, data):
    old = bpy.data.images[name]
    color_space = old.colorspace_settings.name
    users = [node for material in bpy.data.materials if material.node_tree
             for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image == old]
    bpy.data.images.remove(old)
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = color_space
    image.pixels.foreach_set(np.ascontiguousarray(data).ravel())
    image.file_format = 'PNG'
    image.filepath_raw = str(directory / f'{name}.png')
    image.save()
    bpy.data.images.remove(image)
    image = bpy.data.images.load(str(directory / f'{name}.png'))
    image.name = name
    image.colorspace_settings.name = color_space
    image.pack()
    for node in users:
        node.image = image


def triangles(material_name, attributes):
    seen = set()
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.endswith('_L0') or obj.data.as_pointer() in seen:
            continue
        if material_name.startswith('IX_Suit'):
            eligible = obj.name.startswith('IX_Suit')
        else:
            eligible = obj.name == 'IX_Body_head1_L0' or (obj.name.startswith('IX_Head') and '_head' in obj.name)
        if not eligible or material_name not in {material.name for material in obj.data.materials}:
            continue
        mesh = obj.data
        seen.add(mesh.as_pointer())
        positions = np.empty(len(mesh.vertices) * 3, np.float32)
        mesh.vertices.foreach_get('co', positions)
        positions = positions.reshape(-1, 3)
        fields = {}
        for name in attributes:
            field = np.zeros(len(mesh.vertices), np.float32)
            if name in mesh.attributes:
                mesh.attributes[name].data.foreach_get('value', field)
            fields[name] = field
        uv = mesh.uv_layers.active.data
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            if mesh.materials[triangle.material_index].name != material_name:
                continue
            points = np.array([uv[index].uv[:] for index in triangle.loops]) * size
            low = np.maximum(np.floor(points.min(0)).astype(int), 0)
            high = np.minimum(np.ceil(points.max(0)).astype(int), size - 1)
            if np.any(high < low):
                continue
            x, y = np.meshgrid(np.arange(low[0], high[0] + 1) + 0.5, np.arange(low[1], high[1] + 1) + 0.5)
            a, b, c = points
            denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(denominator) < 1e-8:
                continue
            u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator
            v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator
            inside = (u >= 0) & (v >= 0) & (u + v <= 1)
            rows, columns = np.nonzero(inside)
            if not len(rows):
                continue
            barycentric = np.stack([u[inside], v[inside], 1 - u[inside] - v[inside]], axis=1)
            indices = list(triangle.vertices)
            world = barycentric @ positions[indices]
            values = {name: barycentric @ field[indices] for name, field in fields.items()}
            normal = np.cross(positions[indices[1]] - positions[indices[0]], positions[indices[2]] - positions[indices[0]])
            normal /= max(float(np.linalg.norm(normal)), 1e-8)
            yield rows + low[1], columns + low[0], world, values, normal


def flatten_normals(data, weight):
    normals = data[:, :3] * 2 - 1
    normals[:, :2] *= 1 - weight[:, None]
    normals[:, 2] = np.maximum(normals[:, 2], 0.05)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
    data[:, :3] = normals * 0.5 + 0.5
    return data


for material_name in ('IX_Skin', 'IX_Crystal', 'IX_SuitA', 'IX_SuitB'):
    maps = {suffix: pixels(bpy.data.images[f'{material_name}_{suffix}']) for suffix in ('base', 'orm', 'normal')}
    if material_name != 'IX_Skin':
        maps['emissive'] = pixels(bpy.data.images[f'{material_name}_emissive'])
    painted = np.zeros((size, size), bool)
    attributes = ('p_hand', 'p_finger', 'p_thumb', 'p_foot', 'p_toe', 'free', 'm_mouth', 'kind', 'gpart', 'glow', 'core', 'seam', 'edge')
    for y, x, world, fields, normal in triangles(material_name, attributes):
        if material_name == 'IX_Skin':
            patch = smoothstep((sum(fields[name] for name in ('p_hand', 'p_finger', 'p_thumb', 'p_foot', 'p_toe')) - 0.1) / 0.7)
            face = smoothstep((world[:, 2] - rig.data.bones['head'].head_local.z - 0.025) / 0.035)
            face *= smoothstep((fields['free'] - 0.1) / 0.6) * (1 - fields['m_mouth'])
            current = maps['base'][y, x]
            # Blender's image pixel buffer stores these sRGB image values encoded;
            # the 1x1 save/read probe verified that 0.1 is stored as byte26.
            color = np.array([65, 73, 87], np.float32) / 255
            current[:, :3] = current[:, :3] * (1 - patch[:, None]) + color * patch[:, None]
            maps['base'][y, x] = current
            current = maps['orm'][y, x]
            current[:, 0] = np.maximum(current[:, 0], 0.88 * patch)
            current[:, 1] = current[:, 1] * (1 - patch) + 0.65 * patch
            maps['orm'][y, x] = current
            weight = np.maximum(patch, face * 0.65)
            maps['normal'][y, x] = flatten_normals(maps['normal'][y, x], weight)
            painted[y[weight > 0.01], x[weight > 0.01]] = True
            continue
        crystal = np.ones(len(x)) if material_name == 'IX_Crystal' else (np.abs(fields['kind'] - 9) < 0.3).astype(float)
        collar = smoothstep((fields['gpart'] - 0.5) / 0.4) if material_name == 'IX_Crystal' else (fields['kind'] > 9.5).astype(float)
        crystal *= 1 - collar
        cloud = np.clip(0.5 + 0.3 * np.sin(world @ np.array([17, 23, 31])) + 0.2 * np.sin(world @ np.array([43, -29, 37])), 0, 1)
        palette = np.array([142, 117, 196]) / 255
        facet = palette[None] * (0.74 + 0.24 * cloud[:, None])
        facet *= 0.84 + 0.16 * abs(float(normal @ np.array([0.35, 0.61, 0.71])))
        edge = smoothstep((fields['edge'] - 0.90) / 0.10)
        facet = facet * (1 - edge[:, None] * 0.22) + np.array([205, 196, 233]) / 255 * edge[:, None] * 0.22
        current = maps['base'][y, x]
        current[:, :3] = current[:, :3] * (1 - crystal[:, None]) + facet * crystal[:, None]
        maps['base'][y, x] = current
        current = maps['orm'][y, x]
        current[:, 1] = current[:, 1] * (1 - crystal) + (0.31 + cloud * 0.10 + edge * 0.05) * crystal
        current[:, 1] = np.maximum(current[:, 1], collar * 0.68)
        current[:, 2] *= 1 - np.maximum(crystal, collar)
        maps['orm'][y, x] = current
        lines = np.maximum(smoothstep((fields['glow'] - 0.88) / 0.12), smoothstep((fields['seam'] - 0.92) / 0.08))
        lines = np.maximum(lines, smoothstep((fields['core'] - 0.94) / 0.06) * 0.65)
        tint = np.array([185, 166, 255]) / 255 * cloud[:, None] + np.array([100, 227, 255]) / 255 * (1 - cloud[:, None])
        emission = maps['emissive'][y, x]
        emission[:, :3] = tint * (lines * crystal)[:, None]
        maps['emissive'][y, x] = emission
        painted[y, x] = True
    # Extend new crystal colors three texels into the original UV gutters.
    if material_name != 'IX_Skin':
        for _ in range(3):
            neighbours = [np.roll(painted, shift, axis) for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1))]
            counts = sum(mask.astype(np.float32) for mask in neighbours)
            fill = ~painted & (counts > 0)
            for data in maps.values():
                summed = sum(np.roll(data * painted[..., None], shift, axis) for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)))
                data[fill] = summed[fill] / counts[fill, None]
            painted |= fill
        material = bpy.data.materials[material_name]
        principled = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        principled.inputs['Emission Strength'].default_value = 0.75 if material_name == 'IX_Crystal' else 0.45
    for suffix, data in maps.items():
        save_map(f'{material_name}_{suffix}', data)
    evidence['materials'][material_name] = {'painted_texels': int(painted.sum()), 'size': [size, size],
                                            'emission': 'Growth/core lines only; broad facets unlit' if material_name != 'IX_Skin' else None}
    print('IXARI_MAPS_REFINED', material_name, flush=True)

bpy.context.scene['ixari_review5_materials'] = True
block = bpy.data.texts.get('authoring/refine_ixari_materials.py') or bpy.data.texts.new('authoring/refine_ixari_materials.py')
block.clear()
block.write(Path(__file__).read_text())
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
evidence['output_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.materials.json').write_text(json.dumps(evidence, indent=2) + '\n')
print('IXARI_MATERIALS_REFINED', output, flush=True)
