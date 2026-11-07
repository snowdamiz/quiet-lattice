"""Classify exact original painted fields, not low-density baked padding, for physical finish-sheet reuse."""
import bpy,json,sys,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';sys.path.insert(0,str(Path(__file__).parent))
from density_fields import comparison,ROLES
FIELDS=np.load(OUT/'original-paint-controls.npz');bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'));report={};arrays={};TOL=1/255
for state in ['lark','lark_damaged','lark_husked']:
 rows=[]
 for o in bpy.data.collections[state+'_LOD0'].objects:
  key=state+'_LOD0/'+o.name
  if key+'/color' not in FIELDS:continue
  color=FIELDS[key+'/color'];orm=FIELDS[key+'/orm'];roles=FIELDS[key+'/roles'];values=comparison(color,orm,roles,state=='lark');arrays[key+'/comparison']=values.astype(np.float32)
  for p in o.data.polygons:
   role=o.data.materials[p.material_index].get('engine_name')
   if role not in ROLES:continue
   v=values[list(p.loop_indices)];rows.append({'object':o.name,'face':p.index,'role':role,'area':p.area,'mean':v.mean(0),'min':v.min(0),'max':v.max(0)})
 palettes={}
 for role in ROLES:
  rr=[r for r in rows if r['role']==role];v=np.array([r['mean'] for r in rr]);a=np.array([r['area'] for r in rr]);pal=[]
  while a.sum()>0 and len(pal)<24:
   bins=np.round(v[:,:3]*128).astype(int);ids,inv=np.unique(bins,axis=0,return_inverse=True);idx=np.bincount(inv,weights=a).argmax();sel=(inv==idx)&(a>0);ref=np.average(v[sel],axis=0,weights=a[sel]);matched=(np.abs(v-ref).max(1)<=TOL)&(a>0)
   if not matched.any():a[sel]=0;continue
   pal.append({'value':ref.tolist(),'area':float(a[matched].sum())});a[matched]=0
  palettes[role]=pal
 faces={}
 for r in rows:
  finish=None
  for i,p in enumerate(palettes[r['role']]):
   if max(np.max(r['max']-p['value']),np.max(np.array(p['value'])-r['min']))<=TOL:finish=i;break
  faces.setdefault(r['object'],{})[str(r['face'])]=finish
 report[state]={'palettes':palettes,'faces':faces}
 for role in ROLES:
  rr=[r for r in rows if r['role']==role];unique=sum(r['area'] for r in rr if faces[r['object']][str(r['face'])] is None);print(state,role,'unique',round(unique,3),'total',round(sum(r['area'] for r in rr),3),flush=True)
report['max_channel_difference_srgb_or_orm']=TOL
with (OUT/'authored-finish-regions.json').open('x') as f:json.dump(report,f)
np.savez_compressed(OUT/'authored-finish-comparison.npz',**arrays)
