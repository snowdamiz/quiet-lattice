"""Remove only the three empty Head2 bake/LOD scratch objects from saved fifth source.

All nonempty geometry,rig,morphs,UVs,weights and packed images must stay identical.
The fourth source is not reopened or reapplied. No sculpt,bake,export or render.
"""
from pathlib import Path
import datetime, hashlib, json, os, sys
import bpy
import numpy as np

source, output, report_path = map(lambda p: Path(p).resolve(), sys.argv[sys.argv.index('--') + 1:])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source) == 'f9493e205382a8668b3e543b01c01b71bb5af8797ffd73e63b9d6f7c7793ccf9'
assert source != output and not output.exists() and not report_path.exists()
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.scene.render.threads_mode = 'FIXED'
bpy.context.scene.render.threads = 2

def array_digest(collection, field, width, dtype):
    a = np.empty(len(collection) * width, dtype)
    collection.foreach_get(field, a)
    return hashlib.sha256(a.tobytes()).hexdigest()

def snapshot():
    meshes = {}
    for o in bpy.data.objects:
        if o.type != 'MESH' or not len(o.data.vertices):
            continue
        me = o.data
        meshes[o.name] = {
            'positions': array_digest(me.vertices, 'co', 3, np.float32),
            'edges': array_digest(me.edges, 'vertices', 2, np.int32),
            'loops': array_digest(me.loops, 'vertex_index', 1, np.int32),
            'faces': array_digest(me.polygons, 'loop_total', 1, np.int32),
            'uv': {layer.name: array_digest(layer.data, 'uv', 2, np.float32) for layer in me.uv_layers},
            'morphs': {k.name: array_digest(k.data, 'co', 3, np.float32) for k in me.shape_keys.key_blocks} if me.shape_keys else {},
            'weights': hashlib.sha256(json.dumps([[(o.vertex_groups[g.group].name, g.weight) for g in v.groups] for v in me.vertices]).encode()).hexdigest(),
            'materials': [m.name if m else None for m in me.materials],
        }
    rig = bpy.data.objects['RIG_ulgani']
    assert len(rig.data.bones) == 69
    bones = {b.name: {'parent': b.parent.name if b.parent else None, 'matrix': [list(row) for row in b.matrix_local]} for b in rig.data.bones}
    images = {im.name: hashlib.sha256(bytes(im.packed_file.data)).hexdigest() if im.packed_file else None for im in bpy.data.images}
    return {'meshes': meshes, 'rig': bones, 'packed_images': images}

before = snapshot()
removed = []
for name in ('UL_Head2_head2_L0.001', 'UL_Head2_head2_L0.002', 'UL_Head2_head2_L0.003'):
    o = bpy.data.objects.get(name)
    assert o is not None and o.type == 'MESH' and not len(o.data.vertices) and not len(o.data.polygons) and not o.children, name
    removed.append(name)
    bpy.data.objects.remove(o, do_unlink=True)
assert before == snapshot(), 'Cleanup altered nonempty geometry,rig,UVs,weights,morphs or packed images'
parts = {}
for level in range(4):
    me = bpy.data.objects[f'UL_Head2_head2_L{level}'].data
    attr = me.attributes['gpart']
    gp = np.empty(len(me.vertices), np.float32)
    attr.data.foreach_get('value', gp)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    parent = np.arange(len(me.vertices))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in me.edges:
        a, b = e.vertices
        parent[find(a)] = find(b)
    components = {}
    for i in range(len(parent)):
        components.setdefault(int(find(i)), []).append(i)
    nodules = []
    for ids in components.values():
        if np.mean((gp[ids] > 2.5) & (gp[ids] < 3.5)) > .9:
            nodules.append({'vertices': len(ids), 'extent_m': np.ptp(co[ids], axis=0).tolist()})
    parts[str(level)] = {'vertices': len(me.vertices), 'gpart4_vertices': int((gp >= 3.5).sum()), 'gpart3_vertices': int(((gp > 2.5) & (gp < 3.5)).sum()), 'terminal_nodule_components': len(nodules), 'nodules': nodules}
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
bpy.ops.wm.open_mainfile(filepath=str(output))
assert before == snapshot(), 'Saved-source roundtrip changed nonempty data'
report = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': os.getpid(), 'pgid': os.getpgrp(), 'threads': 2, 'before_sha256': sha(source), 'after_sha256': sha(output), 'removed_empty_objects': removed, 'nonempty_geometry_uv_weights_morph_material_bindings_rig_and_packed_images_unchanged': True, 'saved_roundtrip_pass': True, 'head2_parts': parts, 'head2_limitation': 'No gpart4 cap/fan geometry exists. The prior patch broadened existing components, but its gpart4 operation restored no Head2 terminals. Head2 uses filament stalks and gpart3 nodules;native100m fungal recognition remains unverified and may need a separate authored terminal-cluster revision before the fifth artifact cycle. No Head2 sculpt was added by this cleanup.', 'bake_pending': True, 'status': 'CLEAN_SOURCE_SAVED_PENDING_BAKE_AND_VISUAL_REVIEW'}
report_path.write_text(json.dumps(report, indent=2) + '\n')
print('ULGANI5_CLEAN_SOURCE_SAVED', report['utc'], report['after_sha256'], flush=True)
