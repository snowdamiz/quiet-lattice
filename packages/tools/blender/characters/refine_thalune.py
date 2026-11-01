"""Apply the fifth-review material and silhouette corrections to the saved Thalune source.

This edits existing meshes and packed maps. It never rebuilds the body or changes the rig.
Blender -b <source.blend> --python-exit-code 1 -P this.py -- <output.blend> <texture-work-dir>
"""
from pathlib import Path
import json
import sys

import bpy
import numpy as np

output, texture_dir = map(lambda p: Path(p).resolve(), sys.argv[sys.argv.index('--') + 1:])
assert 'RIG_thalune' in bpy.data.objects
assert not bpy.context.scene.get('thalune_review5'), 'Refinement already applied'
texture_dir.mkdir(parents=True, exist_ok=True)
output.parent.mkdir(parents=True, exist_ok=True)
notes = {'source': bpy.data.filepath, 'changes': []}


def pixels(image):
    width, height = image.size
    data = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(height, width, 4)


def replace_image(name, data, color_space):
    old = bpy.data.images.get(name)
    users = [node for mat in bpy.data.materials if mat.node_tree for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image == old] if old else []
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, data.shape[1], data.shape[0], alpha=False)
    image.colorspace_settings.name = color_space
    image.pixels.foreach_set(np.ascontiguousarray(data).ravel())
    image.file_format = 'PNG'
    image.filepath_raw = str(texture_dir / (name + '.png'))
    image.save()
    bpy.data.images.remove(image)
    image = bpy.data.images.load(str(texture_dir / (name + '.png')))
    image.name = name
    image.colorspace_settings.name = color_space
    image.pack()
    for node in users:
        node.image = image
    return image


image = bpy.data.images['TH_Skin_orm']
data = pixels(image)
before = np.quantile(data[..., 1], (0.05, 0.5, 0.95)).tolist()
data[..., 1] = np.maximum(data[..., 1], 0.55)
replace_image(image.name, data, 'Non-Color')
notes['changes'].append({'skin_roughness_floor': 0.55, 'previous_whole_atlas_quantiles': before})
image = bpy.data.images['TH_Eye_base']
data = pixels(image)
data[..., :3] *= np.array([0.16, 0.24, 0.28], np.float32)
replace_image(image.name, data, 'sRGB')
notes['changes'].append({'eyes': 'Dark shelf-blue iris; original pupil pattern retained'})


def components(mesh):
    parents = list(range(len(mesh.vertices)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for edge in mesh.edges:
        a, b = map(find, edge.vertices)
        parents[a] = b
    result = {}
    for vertex in mesh.vertices:
        result.setdefault(find(vertex.index), []).append(vertex.index)
    return list(result.values())


def coordinates(points):
    data = np.empty(len(points) * 3, np.float32)
    points.foreach_get('co', data)
    return data.reshape(-1, 3)


seen = set()
for obj in list(bpy.data.objects):
    if obj.type != 'MESH' or not obj.name.startswith(('TH_Body_', 'TH_Head')) or obj.data.as_pointer() in seen:
        continue
    mesh = obj.data
    seen.add(mesh.as_pointer())
    base = coordinates(mesh.vertices)
    delta = np.zeros_like(base)
    skin = np.zeros(len(base), bool)
    bio = np.zeros(len(base), bool)
    for face in mesh.polygons:
        name = mesh.materials[face.material_index].name
        if name == 'TH_Skin':
            skin[list(face.vertices)] = True
        elif name == 'TH_Fin':
            bio[list(face.vertices)] = True
    if obj.name.startswith('TH_Body_'):
        # Increase the palm's transverse spread continuously from the wrist. The same
        # field moves the existing connected web membranes, preserving their topology.
        hand = np.clip((np.abs(base[:, 0]) - 0.58) / 0.045, 0, 1)
        delta[:, 1] += base[:, 1] * 0.45 * hand
        web_faces = set()
        for indices in components(mesh):
            co = base[indices]
            if 40 <= len(indices) <= 400 and np.min(np.abs(co[:, 0])) > 0.60 and co[:, 2].min() > 0.90 and co[:, 2].max() < 1.04:
                web_faces.update(indices)
                edge = np.empty(len(base), np.float32)
                mesh.attributes['edge'].data.foreach_get('value', edge)
                middle = (co[:, 1].min() + co[:, 1].max()) * 0.5
                span = max(float(np.ptp(co[:, 1])) * 0.5, 1e-6)
                across = np.clip(1 - ((co[:, 1] - middle) / span) ** 2, 0, 1)
                direction = np.array([np.sign(co[:, 0].mean()) * 0.55, -0.08, -0.83])
                delta[indices] += across[:, None] * edge[indices, None] * 0.023 * direction
        if web_faces:
            slot = next(i for i, material in enumerate(mesh.materials) if material.name == 'TH_Skin')
            # Reuse a real patch of this body's skin atlas rather than the coral fin atlas.
            skin_face = next(face for face in mesh.polygons if face.material_index == slot and all(abs(base[v, 0]) > 0.54 and 1.02 < base[v, 2] < 1.12 for v in face.vertices))
            uv = mesh.uv_layers.active.data
            patch = np.mean([uv[i].uv[:] for i in skin_face.loop_indices], axis=0)
            for face in mesh.polygons:
                if all(v in web_faces for v in face.vertices):
                    face.material_index = slot
                    for loop_index in face.loop_indices:
                        vertex = mesh.loops[loop_index].vertex_index
                        uv[loop_index].uv = patch + np.array([base[vertex, 1] * 0.1, (base[vertex, 2] - 0.98) * 0.1])
        # Heel pads taper into the ankle instead of continuing the old spherical bulb.
        heel = skin & (base[:, 1] > 0.045) & (base[:, 2] < 0.11)
        fade = np.clip((base[:, 1] - 0.045) / 0.055, 0, 1) * heel
        center = np.sign(base[:, 0]) * 0.10
        delta[:, 0] -= (base[:, 0] - center) * 0.22 * fade
    else:
        # A broad lower jaw and a 38–40 cm frill collar remain visible at LOD2.
        jaw = np.exp(-((base[:, 2] - 1.655) / 0.031) ** 2) * skin
        delta[:, 0] += np.sign(base[:, 0]) * 0.012 * jaw * np.clip(np.abs(base[:, 0]) / 0.055, 0, 1)
        edge = np.zeros(len(base), np.float32)
        if 'edge' in mesh.attributes:
            mesh.attributes['edge'].data.foreach_get('value', edge)
        frill = bio & (np.abs(base[:, 0]) > 0.06) & (base[:, 2] < 1.74)
        delta[:, 0] += np.sign(base[:, 0]) * 0.065 * np.clip(edge, 0, 1) * frill
    mesh.vertices.foreach_set('co', np.ascontiguousarray(base + delta).ravel())
    if mesh.shape_keys:
        for key in mesh.shape_keys.key_blocks:
            key.data.foreach_set('co', np.ascontiguousarray(coordinates(key.data) + delta).ravel())
    if mesh.has_custom_normals:
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    mesh.update()
notes['changes'].append({'meshes_refined': len(seen), 'scope': 'all four LODs; shared mesh instances edited once; existing morph deltas preserved'})

# Paint emissive only where the authored suit geometry marks shell plates (kind=1).
# Occupancy comes from the actual UV triangles, so cloth and fastening maps stay dark.
for material_name in ('TH_SuitA', 'TH_SuitB'):
    mask = np.zeros((4096, 4096), np.float32)
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.startswith('TH_Suit') or not obj.name.endswith('_L0'):
            continue
        mesh = obj.data
        if not any(m.name == material_name for m in mesh.materials) or 'kind' not in mesh.attributes:
            continue
        kind = np.empty(len(mesh.vertices), np.float32)
        mesh.attributes['kind'].data.foreach_get('value', kind)
        uv = mesh.uv_layers.active.data
        mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            if abs(float(kind[list(tri.vertices)].mean()) - 1) > 0.15:
                continue
            points = np.array([uv[i].uv[:] for i in tri.loops]) * 4096
            lo = np.maximum(np.floor(points.min(0)).astype(int), 0)
            hi = np.minimum(np.ceil(points.max(0)).astype(int), 4095)
            if np.any(hi < lo):
                continue
            x, y = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
            a, b, c = points
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-8:
                continue
            u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den
            v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den
            target = mask[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1]
            np.maximum(target, ((u >= 0) & (v >= 0) & (u + v <= 1)).astype(np.float32), out=target)
    for _ in range(4):
        mask = np.maximum.reduce([mask, np.roll(mask, 1, 0), np.roll(mask, -1, 0), np.roll(mask, 1, 1), np.roll(mask, -1, 1)])
    data = np.ones((4096, 4096, 4), np.float32)
    data[..., :3] = mask[..., None] * np.array([1.0, 0.7991, 0.5395])
    image = replace_image(material_name + '_emissive', data, 'sRGB')
    mat = bpy.data.materials[material_name]
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    principled = next(node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    mat.node_tree.links.new(node.outputs['Color'], principled.inputs['Emission Color'])
    principled.inputs['Emission Strength'].default_value = 0.075
    notes['changes'].append({'nacre_glow': material_name, 'emission_strength': 0.075, 'plate_texels': int((mask > 0).sum())})

bpy.context.scene['thalune_review5'] = True
block = bpy.data.texts.get('authoring/refine_thalune.py') or bpy.data.texts.new('authoring/refine_thalune.py')
block.clear()
block.write(Path(__file__).read_text())
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
(output.parent / 'thalune-refinement.json').write_text(json.dumps(notes, indent=2) + '\n')
print('THALUNE_REFINED', output, flush=True)
