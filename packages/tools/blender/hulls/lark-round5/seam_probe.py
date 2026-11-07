import bpy,numpy as np
from pathlib import Path
D=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(D.parents[4]/'assets/blend/hulls/lark.blend'))
m=bpy.data.materials['LIB_HollowSeam_Lark']
for n in m.node_tree.nodes:
 print('NODE',n.name,n.type,n.image.name if n.type=='TEX_IMAGE' and n.image else '')
for l in m.node_tree.links:print('LINK',l.from_node.name,l.to_socket.name)
for i in bpy.data.images:
 if 'husked' in i.name and ('emissive' in i.name or 'baseColor' in i.name):
  a=np.array(i.pixels[:]).reshape(i.size[1],i.size[0],4); ys,xs=np.where(a[:,:,:3].max(2)>.1)
  print('IMAGE',i.name,'range',a[:,:,:3].min(),a[:,:,:3].max(),'bright',len(xs),'sample',[(int(xs[k]),int(ys[k]),a[ys[k],xs[k]].tolist()) for k in np.linspace(0,len(xs)-1,8,dtype=int)])
