"""Verify topology, UVs, skin weights and rig survive an authored revision.

Blender -b --factory-startup -P this.py -- <before.blend> <after.blend> <report.json>
Geometry, shading normals and texture pixels may change. Neither input is saved.
"""
from pathlib import Path
import hashlib
import json
import sys

import bpy
import numpy as np


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def values(collection, field, width, dtype):
    array = np.empty(len(collection) * width, dtype)
    collection.foreach_get(field, array)
    return hashlib.sha256(array.tobytes()).hexdigest()


def inspect(path):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    rigs = {}
    meshes = {}
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type == 'ARMATURE':
            rigs[obj.name] = {bone.name: {'parent': bone.parent.name if bone.parent else None,
                                         'matrix': [list(row) for row in bone.matrix_local],
                                         'length': bone.length} for bone in obj.data.bones}
        if obj.type != 'MESH' or obj.name.startswith('REF_'):
            continue
        mesh = obj.data
        meshes[obj.name] = {
            'vertices': len(mesh.vertices),
            'face_vertices_sha256': values(mesh.loops, 'vertex_index', 1, np.int32),
            'face_starts_sha256': values(mesh.polygons, 'loop_start', 1, np.int32),
            'face_sizes_sha256': values(mesh.polygons, 'loop_total', 1, np.int32),
            'uv_sha256': {layer.name: values(layer.data, 'uv', 2, np.float32) for layer in mesh.uv_layers},
            'weights_sha256': digest([[(obj.vertex_groups[group.group].name, group.weight)
                                      for group in vertex.groups] for vertex in mesh.vertices]),
            'shape_keys': [key.name for key in mesh.shape_keys.key_blocks] if mesh.shape_keys else [],
        }
    return {'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'rig_sha256': digest(rigs), 'meshes': meshes}


before, after, output = [Path(argument).resolve() for argument in sys.argv[sys.argv.index('--') + 1:]]
original, revised = inspect(before), inspect(after)
assert original['rig_sha256'] == revised['rig_sha256'], 'Rig rest matrices/hierarchy changed'
assert original['meshes'] == revised['meshes'], 'Topology, UV, weights or morph inventory changed'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'note': 'Authored-revision invariants; not a visual or deformation grade.',
                              'before_sha256': original['source_sha256'], 'after_sha256': revised['source_sha256'],
                              'rig_sha256': revised['rig_sha256'], 'mesh_object_count': len(revised['meshes']),
                              'meshes': revised['meshes'], 'status': 'PASS'}, indent=2) + '\n')
print('REVISION_INVARIANTS_PASS', len(revised['meshes']), output, flush=True)
