import bpy,json,hashlib,numpy as np,sys
out={}
for tag,path in [('prior','/private/tmp/lark-r3-revise-source-review-945b2a/prior-928ec63c.blend'),('current','/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470/assets/blend/hulls/lark.blend')]:
 bpy.ops.wm.open_mainfile(filepath=path);d={'pixels':{},'materials':{}}
 for name in ['lark_4k_density_baseColor','lark_4k_density_ORM']:
  im=bpy.data.images[name];p=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(p);d['pixels'][name]=hashlib.sha256(p.tobytes()).hexdigest();del p
 for m in bpy.data.materials:
  if not m.use_nodes:continue
  if 'Lark' not in m.name:continue
  d['materials'][m.name]=[{'from':l.from_node.name,'image':getattr(getattr(l.from_node,'image',None),'name',None),'to':l.to_node.name,'socket':l.to_socket.name} for l in m.node_tree.links]
 out[tag]=d
json.dump(out,open(sys.argv[-1],'w'),indent=2)
