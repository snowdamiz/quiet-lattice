"""Read actual saved geometry and original corner paint; no source or export write."""
import hashlib
import json
import os
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
SRC = ROOT / 'assets/blend/hulls/lark.blend'
EXPECTED = 'bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75'
ROLES = ['Hull', 'Accent', 'Trim', 'Dark']
assert hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED
fields = np.load(OUT / 'original-paint-controls.npz')
paint_oid = 'f73327b3755418a816f18738b94345b68766d92416582e794af90fee5ba5d690'
original = Path('/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects') / paint_oid[:2] / paint_oid[2:4] / paint_oid
assert hashlib.sha256(original.read_bytes()).hexdigest() == paint_oid
bpy.ops.wm.open_mainfile(filepath=str(original))
original_fields = {}
for coll in bpy.data.collections:
    if not coll.name.endswith('_LOD0'):
        continue
    for o in coll.objects:
        if o.type == 'MESH' and o.data.color_attributes.get('PaintColor'):
            original_fields[coll.name+'/'+o.name] = (
                np.array([a.color for a in o.data.color_attributes['PaintColor'].data]),
                np.array([a.color for a in o.data.color_attributes['PaintORM'].data]),
                np.array([l.vertex_index for l in o.data.loops]),
                np.array([u.uv for u in o.data.uv_layers.active.data]),
            )
bpy.ops.wm.open_mainfile(filepath=str(SRC))
arrays = {}
manifest = {'canonical_sha256': EXPECTED, 'paint_source_sha256': paint_oid, 'objects': [], 'materials': []}
for material in bpy.data.materials:
    bs = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if material.node_tree else None
    manifest['materials'].append({'name': material.name, 'engine_name': material.get('engine_name'),
        'emission_color': list(bs.inputs['Emission Color'].default_value) if bs else None,
        'emission_strength': bs.inputs['Emission Strength'].default_value if bs else None})
for coll in bpy.data.collections:
    if '_LOD' not in coll.name:
        continue
    for o in coll.objects:
        if o.type != 'MESH' or not o.data.uv_layers.active:
            continue
        m = o.data
        m.calc_loop_triangles()
        key = coll.name+'/'+o.name
        vertex = np.array([o.matrix_world@v.co for v in m.vertices], np.float64)
        loop_vertex = np.array([l.vertex_index for l in m.loops], np.int32)
        triangles = np.array([t.loops for t in m.loop_triangles], np.int32)
        roles = np.full(len(m.loops), -1, np.int32)
        for p in m.polygons:
            semantic = m.materials[p.material_index].get('engine_name')
            if semantic in ROLES:
                roles[list(p.loop_indices)] = ROLES.index(semantic)
        if not (roles >= 0).any():
            continue
        arrays[key+'/world'] = vertex
        arrays[key+'/loop_vertex'] = loop_vertex
        arrays[key+'/triangles'] = triangles
        arrays[key+'/polygon'] = np.array([t.polygon_index for t in m.loop_triangles], np.int32)
        arrays[key+'/uv'] = np.array([u.uv for u in m.uv_layers.active.data], np.float64)
        arrays[key+'/roles'] = roles
        arrays[key+'/normal'] = np.array([o.matrix_world.to_3x3().inverted().transposed()@n.vector for n in m.corner_normals], np.float64)
        row = {'key': key, 'vertices': len(vertex), 'loops': len(loop_vertex), 'triangles': len(triangles),
               'geometry_sha256': hashlib.sha256(vertex.tobytes()+loop_vertex.tobytes()+triangles.tobytes()).hexdigest()}
        if key in original_fields:
            color, orm, old_loops, old_uv = original_fields[key]
            if np.array_equal(old_loops, loop_vertex):
                selected = roles >= 0
                error = max(float(np.abs(color[selected]-fields[key+'/color'][selected]).max()), float(np.abs(orm[selected]-fields[key+'/orm'][selected]).max()))
                row['prior_uv_lookup_corner_field_max_error'] = error
                uv_error = float(np.abs(old_uv-arrays[key+'/uv']).max())
                assert uv_error < 1e-7, (key, uv_error)
                row['exact_original_loop_and_uv_correspondence'] = True
                arrays[key+'/color'] = color.astype(np.float32)
                arrays[key+'/orm'] = orm.astype(np.float32)
            else:
                assert o.name.startswith('LandingMechanism')
                row['correspondence'] = 'Prior hash-bound new-rail barycentric correspondence; topology differs'
                arrays[key+'/color'] = fields[key+'/color']
                arrays[key+'/orm'] = fields[key+'/orm']
        manifest['objects'].append(row)
        print(row, flush=True)
name = os.environ['LARK_ATTEMPT_ID']
npz = OUT/(name+'-surfaces.npz')
assert not npz.exists()
np.savez_compressed(npz, **arrays)
manifest['arrays'] = npz.name
manifest['arrays_sha256'] = hashlib.sha256(npz.read_bytes()).hexdigest()
manifest['canonical_unchanged'] = hashlib.sha256(SRC.read_bytes()).hexdigest() == EXPECTED
assert manifest['canonical_unchanged']
with (OUT/(name+'-surfaces.json')).open('x') as f:
    json.dump(manifest, f, indent=2)
