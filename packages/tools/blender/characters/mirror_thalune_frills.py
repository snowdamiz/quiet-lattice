"""Repair paired neck membranes in the saved source without rebuilding any body.

The old membrane constructor gave one side a different curl axis. Duplicate each
left neck membrane with mirrored geometry, morphs and bone weights at every LOD.
Head/crest asymmetry above the collar and all skin topology remain authored as saved.
Blender -b <source.blend> --python-exit-code 1 -P this.py -- <output.blend>
"""
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np

assert not bpy.context.scene.get('thalune_frills_mirrored'), 'Frill repair already applied'
output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
seen = set()
for obj in bpy.data.objects:
    if obj.type != 'MESH' or not obj.name.startswith('TH_Head') or obj.data.as_pointer() in seen:
        continue
    mesh = obj.data
    seen.add(mesh.as_pointer())
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    remaining = set(bm.verts)
    left, right = [], []
    while remaining:
        seed = remaining.pop()
        component, todo = {seed}, [seed]
        while todo:
            vertex = todo.pop()
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in remaining:
                    remaining.remove(other)
                    component.add(other)
                    todo.append(other)
        positions = np.array([v.co[:] for v in component])
        center = positions.mean(0)
        if len(component) < 20 or abs(center[0]) < 0.06 or center[2] >= 1.74:
            continue
        faces = {face for vertex in component for face in vertex.link_faces}
        if not faces or any(mesh.materials[face.material_index].name != 'TH_Fin' for face in faces):
            continue
        if center[0] > 0:
            left.append((component, faces))
        else:
            right.extend(component)
    if not left or not right:
        bm.free()
        continue
    old_count = len(mesh.vertices)
    bmesh.ops.delete(bm, geom=right, context='VERTS')
    deform = bm.verts.layers.deform.active
    group_swap = {}
    for group in obj.vertex_groups:
        suffix = '_R' if group.name.endswith('_L') else '_L' if group.name.endswith('_R') else ''
        paired = obj.vertex_groups.get(group.name[:-2] + suffix) if suffix else None
        if paired:
            group_swap[group.index] = paired.index
    shapes = list(bm.verts.layers.shape.values())
    flare = bm.verts.layers.float_vector.get('flare')
    for vertices, faces in left:
        geometry = set(vertices) | set(faces) | {edge for face in faces for edge in face.edges}
        duplicate = bmesh.ops.duplicate(bm, geom=list(geometry))['geom']
        new_vertices = [item for item in duplicate if isinstance(item, bmesh.types.BMVert)]
        new_faces = [item for item in duplicate if isinstance(item, bmesh.types.BMFace)]
        for vertex in new_vertices:
            vertex.co.x *= -1
            for layer in shapes:
                value = vertex[layer].copy()
                value.x *= -1
                vertex[layer] = value
            if flare:
                value = vertex[flare].copy()
                value.x *= -1
                vertex[flare] = value
            if deform:
                weights = dict(vertex[deform])
                vertex[deform].clear()
                for index, weight in weights.items():
                    vertex[deform][group_swap.get(index, index)] = weight
        bmesh.ops.reverse_faces(bm, faces=new_faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    if mesh.has_custom_normals:
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    mesh.update()
    if mesh.shape_keys:
        assert all(len(key.data) == len(mesh.vertices) for key in mesh.shape_keys.key_blocks)
    print('MIRRORED_FRILLS', obj.name, len(left), old_count, '->', len(mesh.vertices), flush=True)
# The head and body are separate skinned meshes. Restore their common neck normals
# after editing, so clearing obsolete split normals cannot introduce a collar seam.
for level in range(4):
    meshes = {}
    groups = {}
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.startswith(('TH_Head', 'TH_Body_')) or not obj.name.endswith(f'_L{level}') or obj.data.as_pointer() in meshes:
            continue
        mesh = obj.data
        normals = np.array([v.normal[:] for v in mesh.vertices])
        meshes[mesh.as_pointer()] = (mesh, normals)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        for vertex in bm.verts:
            if vertex.is_boundary and 1.49 < vertex.co.z < 1.57:
                key = tuple(round(value, 4) for value in vertex.co)
                groups.setdefault(key, []).append((mesh.as_pointer(), vertex.index))
        bm.free()
    shared = 0
    for members in groups.values():
        if len({pointer for pointer, _ in members}) < 2:
            continue
        mean = sum((meshes[pointer][1][index] for pointer, index in members), np.zeros(3))
        mean /= max(float(np.linalg.norm(mean)), 1e-9)
        for pointer, index in members:
            meshes[pointer][1][index] = mean
        shared += 1
    for mesh, normals in meshes.values():
        mesh.normals_split_custom_set_from_vertices(normals)
    print('NECK_NORMALS', level, shared, 'shared boundary positions', flush=True)
bpy.context.scene['thalune_frills_mirrored'] = True
block = bpy.data.texts.get('authoring/mirror_thalune_frills.py') or bpy.data.texts.new('authoring/mirror_thalune_frills.py')
block.clear()
block.write(Path(__file__).read_text())
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
print('FRILLS_SAVED', output, flush=True)
