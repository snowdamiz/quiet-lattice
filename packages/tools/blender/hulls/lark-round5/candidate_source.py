import bpy,sys,runpy,json
from pathlib import Path
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
rows=[]
for c in bpy.data.collections:
 if c.name.startswith('lark') and '_LOD' in c.name:
  for o in c.all_objects:
   if o.type=='MESH' and len(o.data.polygons):
    layers=[u.name for u in o.data.uv_layers]
    assert layers==['UVMap'],(o.name,layers)
    rows.append({'object':o.name,'layers':layers})
(D/'candidate-source-audit.json').write_text(json.dumps({'uv':rows,'scene_properties':dict(bpy.context.scene.items()),'images':[{'name':i.name,'size':list(i.size)} for i in bpy.data.images if i.packed_file]},default=str,indent=2))
runpy.run_path(str(D/'density.py'),run_name='__main__')
sys.path.insert(0,str(D.parents[1]))
sys.argv=['validate.py','--',str(src),'--family','hulls','--report',str(D/'candidate-source-validation.json')]
runpy.run_path(str(D.parents[1]/'validate.py'),run_name='__main__')
