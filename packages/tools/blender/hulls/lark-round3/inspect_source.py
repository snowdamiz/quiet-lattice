import bpy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[5]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets/blend/hulls/lark.blend'))
data = {'collections': [], 'materials': [], 'images': [], 'objects': []}
for c in bpy.data.collections:
    data['collections'].append({'name':c.name,'objects':len(c.objects),'children':[x.name for x in c.children]})
for o in bpy.data.objects:
    data['objects'].append({'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'location':list(o.location),'dimensions':list(o.dimensions),'collections':[c.name for c in o.users_collection],'materials':[s.material.name if s.material else None for s in o.material_slots],'verts':len(o.data.vertices) if o.type=='MESH' else None,'props':{k:str(v) for k,v in o.items()}})
for m in bpy.data.materials:
    data['materials'].append({'name':m.name,'engine_name':m.get('engine_name'),'nodes':[{'type':n.type,'name':n.name,'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.use_nodes else []})
for i in bpy.data.images:
    data['images'].append({'name':i.name,'size':list(i.size),'packed':bool(i.packed_file)})
(root/'assets/renders/hulls/lark-round3-current/canonical-inventory.json').write_text(json.dumps(data,indent=2)+'\n')
print('CANONICAL',len(data['objects']),'objects',len(data['materials']),'materials',len(data['images']),'images')
