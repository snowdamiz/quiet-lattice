import bpy
import json
import os
from pathlib import Path
from collections import Counter

bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/mule.blend').resolve()))
out = Path(os.environ['MULE_ATTEMPT'])
result = {'meshes': {}, 'images': [], 'materials': {}}
for o in bpy.data.objects:
    if o.type != 'MESH' or not (o.name.startswith('Body') or o.name.startswith('CockpitInteriorMesh')):
        continue
    me = o.data
    parent = list(range(len(me.vertices)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in me.edges:
        parent[root(e.vertices[0])] = root(e.vertices[1])
    groups = {}
    for v in me.vertices:
        groups.setdefault(root(v.index), {'vertices': [], 'faces': []})['vertices'].append(v.index)
    for f in me.polygons:
        groups[root(f.vertices[0])]['faces'].append(f.index)
    parts = []
    for g in groups.values():
        coords = [o.matrix_world @ me.vertices[i].co for i in g['vertices']]
        mn = [min(v[i] for v in coords) for i in range(3)]
        mx = [max(v[i] for v in coords) for i in range(3)]
        parts.append({'vertices': len(coords), 'faces':len(g['faces']), 'tris':sum(len(me.polygons[i].vertices)-2 for i in g['faces']),
                      'min': mn, 'max': mx, 'materials': dict(Counter(me.materials[me.polygons[i].material_index].name for i in g['faces'])), 'first_face':g['faces'][0] if g['faces'] else None})
    result['meshes'][o.name] = {'parts': parts, 'attributes':[(a.name,a.domain,a.data_type) for a in me.attributes], 'custom_normals':me.has_custom_normals}
for im in bpy.data.images:
    result['images'].append({'name':im.name,'size':list(im.size),'packed':bool(im.packed_file),'path':im.filepath,'colorspace':im.colorspace_settings.name})
for m in bpy.data.materials:
    if m.node_tree:
        result['materials'][m.name]={'nodes':[{'name':n.name,'type':n.type,'inputs':{s.name:str(s.default_value) for s in n.inputs if hasattr(s,'default_value')},'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes], 'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links]}
(out/'analysis.json').write_text(json.dumps(result,indent=2))
print('ANALYZED', {k:len(v['parts']) for k,v in result['meshes'].items()})
