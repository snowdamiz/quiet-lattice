import bpy, numpy as np
rig=bpy.data.objects['RIG_thalune']
for n in ['hand_L','index_01_L','index_02_L','middle_01_L','middle_02_L','ring_01_L','ring_02_L','neck_01','neck_02','head']:
 b=rig.data.bones[n];print('BONE',n,tuple(b.head_local),tuple(b.tail_local))
for name in ['TH_Body_head1_L0','TH_Head1_head1_L0']:
 o=bpy.data.objects[name]; me=o.data
 print('MESH',name,len(me.vertices),[(a.name,a.data_type,a.domain) for a in me.attributes])
 print('MATS', [(i,m.name) for i,m in enumerate(me.materials)])
 parent=list(range(len(me.vertices)))
 def find(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for e in me.edges:
  a,b=map(find,e.vertices);parent[a]=b
 comps={}
 for v in me.vertices:comps.setdefault(find(v.index),[]).append(v.index)
 for idx in comps.values():
  co=np.array([me.vertices[i].co[:] for i in idx]);lo=co.min(0);hi=co.max(0)
  if len(idx)>50:print('COMP',len(idx),'lo',lo.round(4).tolist(),'hi',hi.round(4).tolist(),'mean',co.mean(0).round(4).tolist())
