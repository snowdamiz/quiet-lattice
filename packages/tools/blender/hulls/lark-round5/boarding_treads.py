"""Identify repeated transverse ladder bars in complete connected geometry census."""
import json,math,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent
rows=json.loads((D/'panel-inventory.json').read_text());r=[]
for x in rows:
 lo,hi=x['bounds'];d=[b-a for a,b in zip(lo,hi)]
 if x['object']=='LandingMechanismMesh' and abs(d[1]-.68)<1e-5 and d[0]<.13 and d[2]<.12:
  r.append(dict(x,center=[(a+b)/2 for a,b in zip(lo,hi)],classification='transverse ladder bar candidate; repeated width and shallow cross section'))
r.sort(key=lambda x:x['center'][2])
out={'source_sha256':hashlib.sha256((D.parents[4]/'assets/blend/hulls/lark.blend').read_bytes()).hexdigest(),'coordinate_system':'Saved world metres, Z up; ground datum not yet certified','treads':r,'adjacent_center_distances_m':[math.dist(a['center'],b['center']) for a,b in zip(r,r[1:])],'vertical_rise_m':[b['center'][2]-a['center'][2] for a,b in zip(r,r[1:])],'limitations':['Geometry candidate classification requires rail/contact confirmation','Saved pose only; no authored motion range certification']}
(D/'boarding-tread-measurements.json').write_text(json.dumps(out,indent=2))
print(len(r),out['adjacent_center_distances_m'])
