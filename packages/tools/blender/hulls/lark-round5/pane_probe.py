import bpy,json
from pathlib import Path
p=Path(__file__).resolve();bpy.ops.wm.open_mainfile(filepath=str(p.parents[5]/'assets/blend/hulls/lark.blend'))
o=bpy.data.objects['CanopyGlass'];m=o.data
r=dict(vertices=[list(v.co) for v in m.vertices],polygons=[list(f.vertices) for f in m.polygons],custom=m.has_custom_normals,modifiers=[(x.name,x.type) for x in o.modifiers],matrix=[list(x) for x in o.matrix_world])
(p.parent/'pane-probe.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r))
