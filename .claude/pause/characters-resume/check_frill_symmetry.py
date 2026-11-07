import bpy, numpy as np
from pathlib import Path
source=Path('packages/tools/blender/characters/refine_thalune.py').read_text()
start=source.index('def components(');end=source.index('\n\ndef coordinates(',start)
exec(source[start:end])
for obj in bpy.data.objects:
 if not(obj.type=='MESH' and obj.name.startswith('TH_Head') and '_head' in obj.name and obj.name.endswith('_L0')):continue
 me=obj.data;coords=np.array([v.co[:] for v in me.vertices]);comps=[]
 for ii in components(me):
  co=coords[ii];c=co.mean(0)
  if len(ii)>400 and abs(c[0])>.06 and c[2]<1.74:comps.append((ii,co,c))
 for ii,co,c in comps:
  if c[0]<0:continue
  candidates=[q for q in comps if q[2][0]<0 and len(q[0])==len(ii)]
  if not candidates:continue
  jj,r,rc=min(candidates,key=lambda q:np.linalg.norm(q[2]-c*np.array([-1,1,1])))
  target=co*np.array([-1,1,1]);mat=np.linalg.lstsq(np.c_[r,np.ones(len(r))],target,rcond=None)[0]
  error=np.linalg.norm(np.c_[r,np.ones(len(r))]@mat-target,axis=1)
  print(obj.name,len(ii),'center',c.round(3).tolist(),'max/rms mm',round(float(error.max())*1000,3),round(float(np.sqrt(np.mean(error**2)))*1000,3),'det',round(float(np.linalg.det(mat[:3])),3),flush=True)
