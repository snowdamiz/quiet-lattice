"""Read saved source measurements for planning parent-owned round5 captures."""
import bpy,json
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve();R=P.parents[5]
bpy.ops.wm.open_mainfile(filepath=str(R/'assets/blend/hulls/lark.blend'))
objects=[]
for o in bpy.data.objects:
 if o.type=='EMPTY' or any(s in o.name.lower() for s in ['seat','cockpit','ladder','canopy','ref','col_']):
  objects.append(dict(name=o.name,type=o.type,position=list(o.matrix_world.translation),dimensions=list(o.dimensions),matrix=[list(row) for row in o.matrix_world],properties={k:str(o[k]) for k in o.keys()}))
(P.parent/'measurement-inventory.json').write_text(json.dumps(objects,indent=2))
