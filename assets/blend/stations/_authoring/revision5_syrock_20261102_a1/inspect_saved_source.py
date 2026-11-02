"""Read-only CPU inspection of the saved round-four source before scoped authoring."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'assets/renders/stations/round5/syrock_20261102_a1'
sys.path.insert(0, str(HERE.parent))
from round4_common import snapshot

source = OUT / 'preserved_round4/scrapyard.blend'
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
bpy.context.scene.render.threads_mode = 'FIXED'
bpy.context.scene.render.threads = 2
rock = bpy.data.objects['sy_rock_L0']
mesh = rock.data
neighbors = [set() for _ in mesh.vertices]
for edge in mesh.edges:
    a, b = edge.vertices
    neighbors[a].add(b); neighbors[b].add(a)
pending = set(range(len(mesh.vertices))); groups = []
while pending:
    group = {pending.pop()}; stack = list(group)
    while stack:
        vertex = stack.pop()
        found = neighbors[vertex] & pending
        pending.difference_update(found); group.update(found); stack.extend(found)
    if len(group) > 4:
        points = np.array([mesh.vertices[i].co for i in group])
        groups.append({'vertices': len(group), 'center': points.mean(0).tolist(), 'min': points.min(0).tolist(), 'max': points.max(0).tolist()})
images = []
for img in bpy.data.images:
    if img.source != 'FILE': continue
    path = Path(bpy.path.abspath(img.filepath))
    images.append({'name': img.name, 'path': str(path), 'external_exists': path.is_file(),
        'external_sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None,
        'packed_sha256': hashlib.sha256(img.packed_file.data).hexdigest() if img.packed_file else None,
        'size': list(img.size)})
record = {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'snapshot': snapshot(),
    'rock_lods': [{'name': f'sy_rock_L{k}', 'triangles': sum(len(p.vertices)-2 for p in bpy.data.objects[f'sy_rock_L{k}'].data.polygons)} for k in range(4)],
    'material_users': {m.name: [o.name for o in bpy.data.objects if o.type == 'MESH' and m.name in [s.material.name for s in o.material_slots if s.material]] for m in mesh.materials},
    'components': sorted(groups, key=lambda x: -x['vertices']), 'images': images, 'render_performed': False}
(OUT / 'initial_saved_source.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps({'lods': record['rock_lods'], 'materials': list(record['material_users']), 'components': len(groups), 'largest_components': record['components'][:4], 'images': len(images), 'render_performed': False}))
