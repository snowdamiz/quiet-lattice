import bpy,json,os
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/swift.blend').resolve()))
out={'collections':[], 'materials':[], 'images':[]}
for c in bpy.data.collections:
 out['collections'].append({'name':c.name,'children':[x.name for x in c.children], 'objects':[{'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'location':list(o.location),'bounds':[list(o.matrix_world@__import__('mathutils').Vector(v)) for v in o.bound_box] if o.type=='MESH' else [],'verts':len(o.data.vertices) if o.type=='MESH' else 0,'triangles':sum(len(p.vertices)-2 for p in o.data.polygons) if o.type=='MESH' else 0,'materials':[s.material.name if s.material else None for s in o.material_slots], 'props':{k:str(v) for k,v in o.items()}} for o in c.objects]})
for m in bpy.data.materials:
 out['materials'].append({'name':m.name,'props':{k:str(v) for k,v in m.items()},'nodes':[{'name':n.name,'type':n.type,'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.use_nodes else []})
for i in bpy.data.images:out['images'].append({'name':i.name,'size':list(i.size),'packed':bool(i.packed_file)})
Path(os.environ['SWIFT_JOB'],'inventory.json').write_text(json.dumps(out,indent=2))
print('INSPECTED',len(bpy.data.objects),'objects',len(bpy.data.materials),'materials')
