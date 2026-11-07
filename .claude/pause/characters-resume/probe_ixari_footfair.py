from pathlib import Path
import bpy,numpy as np,runpy
body=bpy.data.objects['IX_Body_head1_L0'];mesh=body.data;rig=bpy.data.objects['RIG_ixari']
co=np.empty(len(mesh.vertices)*3,np.float32);mesh.vertices.foreach_get('co',co);co=co.reshape(-1,3)
edge=np.empty(len(mesh.edges)*2,np.int32);mesh.edges.foreach_get('vertices',edge);edge=edge.reshape(-1,2);a,b=edge.T
degree=np.bincount(np.r_[a,b],minlength=len(co)).clip(1)
weight=np.zeros(len(co))
for side in ('_L','_R'):
 center=np.array(rig.data.bones['ball'+side].head_local)
 weight=np.maximum(weight,np.exp(-np.sum(((co-center)/np.array([.045,.045,.030]))**2,axis=1)**2))
for _ in range(24):
 total=np.zeros_like(co);np.add.at(total,a,co[b]);np.add.at(total,b,co[a]);co+=(total/degree[:,None]-co)*(weight*.5)[:,None]
mesh.vertices.foreach_set('co',co.ravel());mesh.update()
script=Path('.claude/pause/characters-resume/probe_ixari5_final.py').read_text().split("for variant in ['head1','suit3']:")[0].replace('ixari5-final-preview','ixari5-footfair-preview')
exec(compile(script,'foot-fair-preview','exec'))
