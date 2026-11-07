import bpy
import json
import os
from pathlib import Path

bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/mule.blend').resolve()))
out = Path(os.environ['MULE_ATTEMPT'])
data = {'collections': {c.name: [o.name for o in c.objects] for c in bpy.data.collections},
        'texts': {t.name: len(t.as_string()) for t in bpy.data.texts},
        'materials': {}, 'objects': []}
for m in bpy.data.materials:
    data['materials'][m.name] = {'props': dict(m.items()), 'nodes': [{'name': n.name, 'type': n.type, 'image': n.image.name if n.type == 'TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.node_tree else []}
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
    data['objects'].append({'name': o.name, 'type': o.type, 'parent': o.parent.name if o.parent else None,
                           'location': list(o.location), 'dims': list(o.dimensions), 'matrix': [list(r) for r in o.matrix_world],
                           'tris': len(o.data.loop_triangles) if o.type=='MESH' else 0,
                           'materials': [m.name if m else None for m in o.data.materials] if o.type=='MESH' else [],
                           'modifiers': [(m.name, m.type) for m in o.modifiers], 'props': {k:str(v) for k,v in o.items()}})
(out/'source.json').write_text(json.dumps(data, indent=2, default=str))
for t in bpy.data.texts:
    if any(x in t.name.lower() for x in ['mule', 'lod', 'material', 'bake']):
        safe=t.name.replace('/', '__')
        (out/(safe+'.txt')).write_text(t.as_string())
print('INSPECT', len(data['objects']), 'objects', len(data['materials']), 'materials')
