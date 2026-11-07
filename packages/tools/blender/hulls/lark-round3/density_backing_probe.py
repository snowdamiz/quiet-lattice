import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';V=json.loads((OUT/'visibility-inventory.json').read_text());bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'));r={}
for state,suffix in [('lark',''),('lark_damaged','_dmg'),('lark_husked','_husk')]:
 o=bpy.data.objects['Body'+suffix];m=o.data;vis=set(V[state+'_LOD0']['objects'][o.name]['visible_polygons']);pid=m.attributes['pid'];plate=m.attributes['plate'];d={}
 for p in m.polygons:
  if m.materials[p.material_index].get('engine_name')!='Dark':continue
  key='panel_back' if pid.data[p.index].value>0 else 'plate_flag' if sum(plate.data[i].value for i in p.vertices)/len(p.vertices)>.5 else 'mechanical'
  b=d.setdefault(key,{'area':0,'visible_area':0,'polygons':0});b['area']+=p.area;b['visible_area']+=p.area if p.index in vis else 0;b['polygons']+=1
 r[state]=d;print(state,d,flush=True)
with (OUT/'backing-families.json').open('x') as f:json.dump(r,f,indent=2)
