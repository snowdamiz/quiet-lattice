"""Light saved-source inspection only: no save, modifiers, validation or render."""
from pathlib import Path
import datetime, hashlib, json, os
import bpy
import numpy as np

root = Path.cwd()
source = root / 'assets/blend/characters/ulgani.blend'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'd0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7'
out = root / '.claude/pause/characters-resume/ulgani5-inspection'
out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
result = {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': os.getpid(), 'pgid': os.getpgrp(), 'threads': bpy.context.scene.render.threads, 'meshes': [], 'materials': [], 'embedded': []}
for block in bpy.data.texts:
    if block.name.startswith('authoring/'):
        path = out / block.name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(block.as_string())
        result['embedded'].append(block.name)
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    me = o.data
    info = {'name': o.name, 'data': me.name, 'data_users': me.users, 'vertices': len(me.vertices), 'polygons': len(me.polygons), 'materials': [m.name if m else None for m in me.materials], 'attributes': [(a.name, a.domain, a.data_type) for a in me.attributes], 'shape_keys': [(k.name, len(k.data)) for k in me.shape_keys.key_blocks] if me.shape_keys else [], 'modifiers': [(m.name, m.type) for m in o.modifiers]}
    if o.name in ('UL_Body_head1_L0', 'UL_Head3_head3_L0', 'UL_Head6_head6_L0') or ('Head' in o.name and o.name.endswith('_L2')):
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        edges = np.empty(len(me.edges) * 2, np.int32)
        me.edges.foreach_get('vertices', edges)
        parent = np.arange(len(me.vertices))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for a, b in edges.reshape(-1, 2):
            parent[find(a)] = find(b)
        comps = {}
        for i in range(len(parent)):
            comps.setdefault(int(find(i)), []).append(i)
        info['components'] = [{'count': len(ids), 'min': co[ids].min(0).tolist(), 'max': co[ids].max(0).tolist()} for ids in comps.values() if len(ids) >= 4]
        info['regions'] = {}
        for attr in me.attributes:
            if attr.domain == 'POINT' and attr.data_type == 'FLOAT' and (attr.name.startswith('p_') or attr.name in ('kind', 'part')):
                values = np.empty(len(me.vertices), np.float32)
                attr.data.foreach_get('value', values)
                selected = values > 0.5
                info['regions'][attr.name] = {'min_value': float(values.min()), 'max_value': float(values.max()), 'vertices_over_half': int(selected.sum()), 'min': co[selected].min(0).tolist() if selected.any() else None, 'max': co[selected].max(0).tolist() if selected.any() else None}
    result['meshes'].append(info)
for material in bpy.data.materials:
    result['materials'].append({'name': material.name, 'nodes': [{'name': n.name, 'type': n.type, 'image': n.image.name if n.type == 'TEX_IMAGE' and n.image else None, 'inputs': {socket.name: list(socket.default_value) if hasattr(socket.default_value, '__len__') else socket.default_value for socket in n.inputs if hasattr(socket, 'default_value') and socket.type in ('VALUE', 'RGBA')}} for n in material.node_tree.nodes] if material.use_nodes else [], 'links': [(l.from_node.name, l.from_socket.name, l.to_node.name, l.to_socket.name) for l in material.node_tree.links] if material.use_nodes else []})
rig = bpy.data.objects['RIG_ulgani']
result['bones'] = {b.name: {'head': list(b.head_local), 'tail': list(b.tail_local)} for b in rig.data.bones}
(out / 'source.json').write_text(json.dumps(result, indent=2) + '\n')
print('ULGANI5_LIGHT_INSPECT_DONE', len(result['meshes']), 'meshes', len(result['embedded']), 'embedded scripts;source unchanged', flush=True)
