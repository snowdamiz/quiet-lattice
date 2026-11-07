import bpy,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
o=bpy.data.objects['Body'];m=o.data;r={}
for a in m.attributes:
 if a.name not in ['plate','ds','dt','pid']:continue
 vals=[getattr(v,'value',None) for v in a.data];r[a.name]={'domain':a.domain,'type':a.data_type,'count':len(vals),'min':min(vals),'max':max(vals),'unique':len(set(vals)),'samples':vals[:25]}
for ix in [0,10490,17652,21844,3175,25933,12372]:
 fs=[p for p in m.polygons if ix in p.vertices]
 r[str(ix)]={'vertex':list(m.vertices[ix].co),'faces':[{'id':p.index,'verts':list(p.vertices),'material':m.materials[p.material_index].get('engine_name'),'attrs':{a.name:[getattr(a.data[j],'value',None) for j in (p.loop_indices if a.domain=='CORNER' else p.vertices if a.domain=='POINT' else [p.index])] for a in m.attributes if a.name in ['plate','ds','dt','pid']}} for p in fs[:3]]}
with (OUT/'source-attributes.json').open('x') as f:json.dump(r,f,indent=2)
print(json.dumps(r,indent=2))
