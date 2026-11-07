"""Read saved painted maps at actual triangle samples to measure admissible reuse."""
import bpy,numpy as np,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
report={}
for state in ['lark','lark_damaged','lark_husked']:
 c=bpy.data.collections[state+'_LOD0'];ims=[]
 for name in [state+'_4k_baseColor',state+'_4k_ORM',state+'_final_4k_normal']:
  im=bpy.data.images[name];a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a);ims.append(a.reshape(4096,4096,4))
 stats={}
 for o in c.objects:
  if o.type!='MESH':continue
  m=o.data;m.calc_loop_triangles();uv=m.uv_layers.active.data
  for t in m.loop_triangles:
   role=m.materials[t.material_index].get('engine_name')
   if role not in ('Hull','Accent','Trim','Dark'):continue
   u=np.array([uv[i].uv for i in t.loops]);samples=np.vstack((u.mean(0),(u+u.mean(0)*2)/3));xy=np.clip(samples*4096,0,4095).astype(int);cs=[im[xy[:,1],xy[:,0],:3] for im in ims];area=t.area
   b=stats.setdefault(role,{'area':0,'color_flat_03':0,'color_flat_01':0,'color_orm_flat_03':0,'full_flat_05':0});b['area']+=area
   if np.ptp(cs[0],axis=0).max()<.03:b['color_flat_03']+=area
   if np.ptp(cs[0],axis=0).max()<.01:b['color_flat_01']+=area
   if max(np.ptp(cs[0],axis=0).max(),np.ptp(cs[1],axis=0).max())<.03:b['color_orm_flat_03']+=area
   if max(np.ptp(q,axis=0).max() for q in cs)<.05:b['full_flat_05']+=area
 report[state]=stats;print(state,stats,flush=True);del ims
with (OUT/'reuse-map-probe.json').open('x') as f:json.dump(report,f,indent=2)
