"""Measure uniform painted finish regions and keep every spatially varying mark unique."""
import bpy,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
report={}
for state in ['lark','lark_damaged','lark_husked']:
 names=[state+'_4k_baseColor',state+'_4k_ORM']+(['lark_livery_compact','lark_livery_working'] if state=='lark' else [])
 images=[]
 for name in names:
  im=bpy.data.images[name];a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a);images.append(a.reshape(4096,4096,4))
 rows=[]
 for o in bpy.data.collections[state+'_LOD0'].objects:
  if o.type!='MESH':continue
  m=o.data;uv=m.uv_layers.active.data
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ['Hull','Accent','Trim','Dark']:continue
   u=np.array([uv[i].uv for i in p.loop_indices]);u=np.vstack([u.mean(0),(u+u.mean(0))/2]);xy=np.clip(u*4096,0,4095).astype(int)
   values=np.concatenate([im[xy[:,1],xy[:,0],1:3] if i==1 else im[xy[:,1],xy[:,0],:3] for i,im in enumerate(images)],axis=1)
   rows.append({'object':o.name,'face':p.index,'role':role,'area':p.area,'mean':values.mean(0),'min':values.min(0),'max':values.max(0)})
 palettes={}
 for role in ['Hull','Accent','Trim','Dark']:
  rr=[r for r in rows if r['role']==role];v=np.array([r['mean'] for r in rr]);a=np.array([r['area'] for r in rr]);pal=[]
  # Candidate uniform finishes from actual saved painted values. No UV or image is changed here.
  while a.sum()>0:
   bins=np.round(v[:,:3]*32).astype(int);ids,inv=np.unique(bins,axis=0,return_inverse=True);weights=np.bincount(inv,weights=a);idx=weights.argmax();sel=(inv==idx)&(a>0);ref=np.average(v[sel],axis=0,weights=a[sel]);matched=(np.abs(v-ref).max(1)<.015)&(a>0)
   if not matched.any():a[sel]=0;continue
   pal.append({'value':ref.tolist(),'area':float(a[matched].sum())});a[matched]=0
   if len(pal)>=24:break
  palettes[role]=pal
 for r in rows:
  r['finish']=None
  for i,p in enumerate(palettes[r['role']]):
   if max(np.max(r['max']-p['value']),np.max(np.array(p['value'])-r['min']))<.015:r['finish']=i;break
  for k in ['mean','min','max']:r[k]=r[k].tolist()
 report[state]={'images':names,'palettes':palettes,'faces':rows}
 for role in ['Hull','Accent','Trim','Dark']:
  rr=[r for r in rows if r['role']==role];print(state,role,'area',sum(r['area'] for r in rr),'uniform',sum(r['area'] for r in rr if r['finish'] is not None),'unique',sum(r['area'] for r in rr if r['finish'] is None),'finishes',[(round(p['area'],2),[round(v,3) for v in p['value'][:5]]) for p in palettes[role][:6]],flush=True)
 del images
with (OUT/'painted-finish-regions.json').open('x') as f:json.dump(report,f)
