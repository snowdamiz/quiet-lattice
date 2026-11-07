import bpy,json
from pathlib import Path
P=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(P.parents[5]/'assets/blend/hulls/lark.blend'))
r={}
for o in bpy.data.objects:
 if o.type=='MESH' and ('Canopy' in o.name):
  r[o.name]=dict(n=len(o.data.vertices),matrix=[list(x) for x in o.matrix_world],materials=[m.name for m in o.data.materials],vertices=[list(v.co) for v in o.data.vertices] if 'Frame' in o.name and not '.' in o.name else [])
(P.parent/'fit-probe.json').write_text(json.dumps(r))
print([(k,v['n'],v['materials']) for k,v in r.items()])
