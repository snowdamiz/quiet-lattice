import bpy,json,numpy as np
from pathlib import Path
D=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(D.parents[4]/'assets/blend/hulls/lark.blend'))
r={}
for m in bpy.data.materials:
 if m.name.startswith('Lark') and m.use_nodes:
  r[m.name]=[(n.name,n.type,[(i.name,[(l.from_node.name,l.from_socket.name) for l in i.links]) for i in n.inputs if i.is_linked],n.image.name if n.type=='TEX_IMAGE' and n.image else '') for n in m.node_tree.nodes]
(D/'wear2-nodes.json').write_text(json.dumps(r,indent=2))
for im in bpy.data.images:
 if im.name=='lark_4k_density_baseColor':
  a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a);a=a.reshape(4096,4096,4)
  print('COLORS',np.unique((a[::32,::32,:3]*255).astype(int).reshape(-1,3),axis=0)[:50])
for o in bpy.data.collections['lark_LOD0'].all_objects:
 if o.type=='MESH':
  print('UV',o.name,[(u.name,u.active_render) for u in o.data.uv_layers],[(m.name,m.get('engine_name')) for m in o.data.materials])
