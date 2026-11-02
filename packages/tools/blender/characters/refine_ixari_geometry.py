"""Apply the fifth-review geometry corrections directly to a saved Ixari source.

Blender -b ixari.blend -t 2 --python-exit-code 1 -P this.py -- <output.blend>
Existing topology, UVs, weights and rig are retained; all four LODs are edited.
The fourth-pass source remains recoverable in its commit.
"""
from pathlib import Path
import hashlib
import json
import sys
import tempfile

import bmesh
import bpy
import numpy as np

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
source = Path(bpy.data.filepath).resolve()
assert source != output and not bpy.context.scene.get('ixari_review5_geometry')
rig = bpy.data.objects['RIG_ixari']
evidence = {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'meshes': []}


def coords(points):
    values = np.empty(len(points) * 3, np.float32)
    points.foreach_get('co', values)
    return values.reshape(-1, 3)


def attr(mesh, name):
    values = np.zeros(len(mesh.vertices), np.float32)
    if name in mesh.attributes:
        mesh.attributes[name].data.foreach_get('value', values)
    return values


def normalize(value):
    return value / np.maximum(np.linalg.norm(value, axis=-1, keepdims=True), 1e-9)


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def edges(mesh):
    values = np.empty(len(mesh.edges) * 2, np.int32)
    mesh.edges.foreach_get('vertices', values)
    return values.reshape(-1, 2)


def relax(points, edge_pairs, weight, iterations=5):
    a, b = edge_pairs.T
    degree = np.bincount(np.concatenate([a, b]), minlength=len(points)).clip(1)
    points = points.copy()
    for _ in range(iterations):
        for strength in (0.48, -0.50):
            total = np.zeros_like(points)
            np.add.at(total, a, points[b])
            np.add.at(total, b, points[a])
            points += (total / degree[:, None] - points) * (weight * strength)[:, None]
    return points


def components(mesh, selected):
    parent = np.arange(len(mesh.vertices))
    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return int(index)
    for a, b in edges(mesh):
        if selected[a] and selected[b]:
            parent[find(a)] = find(b)
    groups = {}
    for index in np.flatnonzero(selected):
        groups.setdefault(find(index), []).append(index)
    return [np.array(indices) for indices in groups.values()]


def material_mask(mesh, name):
    mask = np.zeros(len(mesh.vertices), bool)
    for face in mesh.polygons:
        if mesh.materials[face.material_index].name == name:
            mask[list(face.vertices)] = True
    return mask


def chain_frame(points, chain, parameter):
    segment = np.minimum(parameter.astype(int), len(chain) - 2)
    fraction = np.clip(parameter - segment, 0, 1)
    center = chain[segment] * (1 - fraction[:, None]) + chain[segment + 1] * fraction[:, None]
    tangent = normalize(chain[segment + 1] - chain[segment])
    radial = points - center
    radial -= (radial * tangent).sum(1)[:, None] * tangent
    return center, tangent, radial


def nearest_chain(points, chains):
    distances = []
    for chain in chains:
        minimum = np.full(len(points), np.inf)
        for a, b in zip(chain[:-1], chain[1:]):
            direction = b - a
            t = np.clip((points - a) @ direction / (direction @ direction), 0, 1)
            minimum = np.minimum(minimum, np.sum((points - a - t[:, None] * direction) ** 2, axis=1))
        distances.append(minimum)
    return np.argmin(distances, axis=0)


with tempfile.TemporaryDirectory(prefix='ixari-source-definitions-') as temporary:
    directory = Path(temporary)
    for text in bpy.data.texts:
        if text.name.startswith('authoring/lib/') and text.name.endswith('.py'):
            path = directory / text.name.removeprefix('authoring/')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text.as_string())
    sys.path.insert(0, str(directory))
    from lib import anatomy, peoples, skel
    context = anatomy.Ctx(skel.bones('ixari'), skel.PEOPLE['ixari']['scale'])
    settings = peoples.IXARI

    seen = set()
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or not obj.name.startswith(('IX_Body_', 'IX_Head', 'IX_Suit')) or obj.data.as_pointer() in seen:
            continue
        mesh = obj.data
        seen.add(mesh.as_pointer())
        level = int(obj.name.rsplit('_L', 1)[1])
        original = coords(mesh.vertices)
        points = original.copy()
        skin = material_mask(mesh, 'IX_Skin')
        crystal = material_mask(mesh, 'IX_Crystal')
        edge_pairs = edges(mesh)
        if obj.name.startswith('IX_Body_'):
            for side, suffix in ((1, '_L'), (-1, '_R')):
                for group, names in (('finger', ('index', 'middle', 'ring')), ('thumb', ('thumb',))):
                    mask = skin & (attr(mesh, 'p_' + group) > 0.05) & (original[:, 0] * side > 0)
                    indices = np.flatnonzero(mask)
                    if not len(indices):
                        continue
                    chains = [np.array([rig.data.bones[f'{name}_0{k}{suffix}'].head_local[:] for k in (1, 2, 3)]
                                       + [rig.data.bones[f'{name}_03{suffix}'].tail_local[:]]) for name in names]
                    assigned = nearest_chain(original[indices], chains)
                    for number, (name, chain) in enumerate(zip(names, chains)):
                        selected = indices[assigned == number]
                        if not len(selected):
                            continue
                        parameter = np.clip((attr(mesh, 's')[selected] - 2) * 3, 0, 3)
                        center, tangent, radial = chain_frame(original[selected], chain, parameter)
                        radii = np.array(settings['finger_r'][name]) * context.s
                        radius = np.interp(parameter, np.arange(4), radii)
                        radius += 0.0011 * (np.exp(-((parameter - 1) / 0.20) ** 2) + np.exp(-((parameter - 2) / 0.20) ** 2))
                        direction = normalize(radial)
                        target = center + direction * radius[:, None]
                        cap = parameter > parameter.max() - 0.003
                        fraction = np.clip(np.linalg.norm(radial[cap], axis=1) / np.maximum(radius[cap], 1e-6), 0, 1)
                        target[cap] = center[cap] + direction[cap] * (radius[cap] * fraction)[:, None]
                        target[cap] += tangent[cap] * (radius[cap] * 0.75 * np.sqrt(1 - fraction ** 2))[:, None]
                        blend = smoothstep((attr(mesh, 'p_' + group)[selected] - 0.15) / 0.65)
                        points[selected] += (target - original[selected]) * blend[:, None]
                palm = rig.data.bones['hand' + suffix]
                origin = np.array(palm.head_local)
                axis = normalize(np.array(palm.tail_local) - origin)
                dorsal = normalize(np.array(palm.matrix_local.col[2][:3]))
                across = normalize(np.cross(axis, dorsal))
                relative = original - origin
                along = relative @ axis / palm.length
                x, z = relative @ across, relative @ dorsal
                hand_weight = attr(mesh, 'p_hand') * skin * (original[:, 0] * side > 0)
                hand_weight *= smoothstep(along / 0.25) * smoothstep((1.15 - along) / 0.20)
                width = 0.90 + 0.09 * np.exp(-((along - 0.82) / 0.20) ** 2)
                thickness = 0.010 * (1 - 0.22 * np.clip((x / 0.032) ** 2, 0, 1))
                thickness += 0.0017 * np.exp(-((along - 0.58) / 0.35) ** 2)
                thickness += 0.0015 * sum(np.exp(-((x - center) / 0.006) ** 2) for center in (-0.021, 0, 0.021)) * np.exp(-((along - 0.76) / 0.22) ** 2)
                points += (across[None] * (x * (width - 1))[:, None] + dorsal[None] * (np.sign(z) * thickness - z)[:, None]) * hand_weight[:, None]
                toe_mask = skin & (attr(mesh, 'p_toe') > 0.05) & (original[:, 0] * side > 0)
                indices = np.flatnonzero(toe_mask)
                axes = anatomy.toe_axes(context, settings, side)
                if len(indices):
                    assigned = nearest_chain(original[indices], [np.array([a, b]) for a, b, _ in axes])
                    for number, (a, b, base_radius) in enumerate(axes):
                        selected = indices[assigned == number]
                        if not len(selected):
                            continue
                        direction = b - a
                        t = np.clip((original[selected] - a) @ direction / (direction @ direction), 0, 1)
                        center = a + t[:, None] * direction
                        radial = original[selected] - center
                        taper = 1 - 0.30 * smoothstep(t)
                        target = original[selected] + radial * (taper - 1)[:, None]
                        blend = smoothstep((attr(mesh, 'p_toe')[selected] - 0.20) / 0.65)
                        points[selected] += (target - original[selected]) * blend[:, None]
            # Smooth the junction bands, keeping the new digit shafts and the wrist fixed.
            digit = attr(mesh, 'p_toe') + attr(mesh, 'p_finger') + attr(mesh, 'p_thumb')
            junction = skin * (4 * digit * (1 - digit)).clip(0, 1)
            for _ in range(3):
                spread = junction.copy()
                np.maximum.at(spread, edge_pairs[:, 0], junction[edge_pairs[:, 1]] * 0.72)
                np.maximum.at(spread, edge_pairs[:, 1], junction[edge_pairs[:, 0]] * 0.72)
                junction = spread * skin
            points = relax(points, edge_pairs, junction, iterations=(8, 4, 2, 1)[level])
            hand_foot = np.clip(sum(attr(mesh, 'p_' + part) for part in ('hand', 'finger', 'thumb', 'foot', 'toe')), 0, 1) * skin
            points = relax(points, edge_pairs, hand_foot, iterations=(48, 12, 3, 1)[level])
            # Fair the topological fork at the toe roots without moving the tips or ankle.
            root_weight = np.zeros(len(points))
            for suffix in ('_L', '_R'):
                center = np.array(rig.data.bones['ball' + suffix].head_local)
                distance = np.sum(((points - center) / np.array([0.045, 0.045, 0.030])) ** 2, axis=1)
                root_weight = np.maximum(root_weight, np.exp(-distance ** 2))
            root_weight *= skin
            a, b = edge_pairs.T
            degree = np.bincount(np.concatenate([a, b]), minlength=len(points)).clip(1)
            for _ in range((24, 8, 3, 1)[level]):
                total = np.zeros_like(points)
                np.add.at(total, a, points[b])
                np.add.at(total, b, points[a])
                points += (total / degree[:, None] - points) * (root_weight * 0.5)[:, None]
            foot = skin & ((attr(mesh, 'p_foot') + attr(mesh, 'p_toe')) > 0.5)
            points[foot, 2] = np.maximum(points[foot, 2], original[skin, 2].min())

        if crystal.any():
            growth = attr(mesh, 'gv')
            for selected in components(mesh, crystal):
                if len(selected) < 3:
                    continue
                co = original[selected]
                gv = growth[selected]
                base = co[gv <= gv.min() + 0.025].mean(0)
                head = obj.name.startswith('IX_Head')
                axis = co[gv >= gv.max() - 0.025].mean(0) - base
                if np.linalg.norm(axis) < 0.001:
                    points[selected] = base + (co - base) * (1.65 if head else 1.5)
                    continue
                axis = normalize(axis)
                axial = (co - base) @ axis
                radial = co - base - axial[:, None] * axis
                length, width = (1.75, 1.85) if head else (1.75, 1.75)
                points[selected] = base + axial[:, None] * axis * length + radial * width
                if head:
                    points[selected, 0] += np.sign(base[0]) * 0.065 * gv
                elif abs(base[0]) > 0.2:
                    points[selected, 0] += np.sign(base[0]) * 0.035 * gv

        if obj.name.startswith('IX_Suit'):
            kind = attr(mesh, 'kind')
            fabric = kind < 0.5
            normals = np.array([vertex.normal[:] for vertex in mesh.vertices])
            displacement = np.zeros(len(points))
            for suffix in ('_L', '_R'):
                for joint, front, along_radius, width, height in (
                    ('calf', (0, -1, 0), 0.065, 0.037, 0.014),
                    ('lowerarm', (0, 1, 0), 0.045, 0.026, 0.011),
                ):
                    bone = rig.data.bones[joint + suffix]
                    center = np.array(bone.head_local)
                    axis = normalize(np.array(bone.tail_local) - center)
                    front = np.array(front, float)
                    front = normalize(front - axis * (front @ axis))
                    across = normalize(np.cross(axis, front))
                    relative = points - center
                    along, lateral = relative @ axis, relative @ across
                    radial = relative - along[:, None] * axis
                    face = smoothstep(((normalize(radial) @ front) - 0.25) / 0.45)
                    rho = (along / along_radius) ** 4 + (lateral / width) ** 4
                    pad = np.exp(-rho) * face
                    relief = height * pad
                    relief -= height * 0.42 * pad * np.exp(-((along - 0.013) / 0.005) ** 2)
                    relief -= height * 0.32 * pad * np.exp(-((along + 0.017) / 0.005) ** 2)
                    relief -= 0.002 * np.exp(-((rho - 0.95) / 0.22) ** 2) * face
                    displacement += relief * fabric
            displacement += 0.0028 * attr(mesh, 'edge') ** 3 * fabric
            displacement += 0.0035 * (np.abs(kind - 2) < 0.1)
            points += normals * displacement[:, None]

        delta = points - original
        facial_weight = np.zeros(len(points))
        if obj.name.startswith('IX_Head'):
            facial_weight = skin * smoothstep((attr(mesh, 'free') - 0.1) / 0.6)
            facial_weight *= 1 - attr(mesh, 'm_mouth')
            facial_weight *= (attr(mesh, 'eyer') < 0.00001)
            facial_weight *= smoothstep((original[:, 2] - rig.data.bones['head'].head_local.z - 0.025) / 0.035)
        if mesh.shape_keys:
            for key in mesh.shape_keys.key_blocks:
                shaped = coords(key.data) + delta
                if facial_weight.any():
                    shaped = relax(shaped, edge_pairs, facial_weight * 0.65, iterations=(6, 3, 2, 1)[level])
                key.data.foreach_set('co', np.ascontiguousarray(shaped).ravel())
            points = coords(mesh.shape_keys.key_blocks['Basis'].data)
        elif facial_weight.any():
            points = relax(points, edge_pairs, facial_weight * 0.65, iterations=(6, 3, 2, 1)[level])
        mesh.vertices.foreach_set('co', np.ascontiguousarray(points).ravel())
        if mesh.has_custom_normals:
            with bpy.context.temp_override(object=obj, active_object=obj):
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
        mesh.update()
        evidence['meshes'].append({'name': mesh.name, 'vertices': len(points),
                                   'maximum_displacement_m': float(np.linalg.norm(points - original, axis=1).max())})

evidence['neck_normals'] = {}
for level in range(4):
    meshes, groups = {}, {}
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.startswith(('IX_Body_', 'IX_Head')) or not obj.name.endswith(f'_L{level}') or obj.data.as_pointer() in meshes:
            continue
        mesh = obj.data
        pointer = mesh.as_pointer()
        role = 'body' if obj.name.startswith('IX_Body_') else 'head'
        meshes[pointer] = (mesh, np.array([vertex.normal[:] for vertex in mesh.vertices]), np.zeros(len(mesh.vertices), bool))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        for vertex in bm.verts:
            if vertex.is_boundary:
                groups.setdefault(tuple(round(value, 5) for value in vertex.co), []).append((pointer, vertex.index, role))
        bm.free()
    shared = 0
    for members in groups.values():
        if {role for _, _, role in members} != {'body', 'head'}:
            continue
        normal = normalize(sum((meshes[pointer][1][index] for pointer, index, _ in members), np.zeros(3)))
        for pointer, index, _ in members:
            meshes[pointer][1][index] = normal
            meshes[pointer][2][index] = True
        shared += 1
    for mesh, normals, changed in meshes.values():
        if not changed.any():
            continue
        corners = np.array([normal.vector[:] for normal in mesh.corner_normals])
        indices = np.empty(len(mesh.loops), np.int32)
        mesh.loops.foreach_get('vertex_index', indices)
        mask = changed[indices]
        corners[mask] = normals[indices[mask]]
        mesh.normals_split_custom_set(corners)
    evidence['neck_normals'][str(level)] = shared
    print('IXARI_NECK_NORMALS', level, shared, flush=True)

bpy.context.scene['ixari_review5_geometry'] = True
block = bpy.data.texts.get('authoring/refine_ixari_geometry.py') or bpy.data.texts.new('authoring/refine_ixari_geometry.py')
block.clear()
block.write(Path(__file__).read_text())
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
evidence['output_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.geometry.json').write_text(json.dumps(evidence, indent=2) + '\n')
print('IXARI_GEOMETRY_REFINED', output, flush=True)
