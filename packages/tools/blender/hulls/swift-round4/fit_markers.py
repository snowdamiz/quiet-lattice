"""Fit the existing live-display attachment markers to the new optical insets; no runtime change."""
import bpy,json,math,os
from pathlib import Path
from mathutils import Vector
source=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0
assert not bpy.context.scene.get('SwiftR4DisplayMarkersFitted');records=[]
angle=math.radians(68);normal=Vector((0,-math.sin(angle),math.cos(angle)))
for variant in ['swift','swift_damaged','swift_husked']:
 for lod in range(3):
  coll=bpy.data.collections[variant+f'_LOD{lod}']
  for name,x,w,h in [('ScreenLeft',-.235,.3,.19),('ScreenCenter',0,.27,.27),('ScreenRight',.235,.3,.19)]:
   m=next(o for o in coll.objects if o.name.startswith(name));old=[list(row) for row in m.matrix_local]
   m.location=Vector((x,2.06,.535))+normal*.014;m.rotation_mode='XYZ';m.rotation_euler=(angle,0,0);m.scale=(.215*.82/w,.225*.82/h,1)
   records.append({'name':m.name,'variant':variant,'lod':lod,'oldMatrix':old,'livePlaneMeters':[.215*.82,.225*.82]})
bpy.context.scene['SwiftR4DisplayMarkersFitted']=True;bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
Path(os.environ['SWIFT_JOB'],'marker-fit.json').write_text(json.dumps(records,indent=2));print('FITTED',len(records))
