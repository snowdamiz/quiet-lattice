import bpy,json
from pathlib import Path
ROOT=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
out={}
for name in ['Body','Body_dmg','Body_husk','LandingMechanismMesh','CockpitMechanismMesh']:
 o=bpy.data.objects.get(name)
 if not o: out[name]='missing'; continue
 names=[a.name for a in o.data.attributes]
 out[name]={'attrs':names,'has':{k:(k in names) for k in ['plate','ds','dt','pid']},'n_v':len(o.data.vertices),'n_f':len(o.data.polygons)}
 print(json.dumps({name:out[name]}))
Path('/tmp/lr3-attr-check.json').write_text(json.dumps(out,indent=2))
