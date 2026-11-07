import bpy,json
from pathlib import Path
P=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
r={}
for m in bpy.data.materials:
 if m.use_nodes and m.name.startswith('Lark'):
  r[m.name]=[(n.name,n.type,n.image.name if n.type=='TEX_IMAGE' and n.image else '',[(i.name,list(i.default_value) if hasattr(i.default_value,'__len__') else i.default_value) for i in n.inputs if hasattr(i,'default_value') and i.name in ('Roughness','Metallic','Strength')]) for n in m.node_tree.nodes]
(P.parent/'finish-probe.json').write_text(json.dumps(r,indent=2))
for i in bpy.data.images: print('IMAGE',i.name,tuple(i.size))
