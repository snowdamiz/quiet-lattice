"""Orient the single-sided optical inset polygons toward the pilot, consistently across LOD0-2."""
import bpy,bmesh,json,os,math
from pathlib import Path
from mathutils import Vector
p=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(p));bpy.context.preferences.filepaths.save_version=0
normal=Vector((0,-math.sin(math.radians(68)),math.cos(math.radians(68))));rows=[]
for variant in ['swift','swift_damaged','swift_husked']:
 for lod in range(3):
  o=next(o for o in bpy.data.collections[variant+f'_LOD{lod}'].objects if o.name.startswith('CockpitInteriorMesh'));bm=bmesh.new();bm.from_mesh(o.data)
  faces=[f for f in bm.faces if o.material_slots[f.material_index].material.get('engine_name')=='Glass' and f.normal.dot(normal)<0]
  bmesh.ops.reverse_faces(bm,faces=faces);rows.append({'variant':variant,'lod':lod,'flipped':len(faces)});bm.to_mesh(o.data);bm.free()
bpy.context.scene['SwiftR4InsetNormalsFixed']=True;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
Path(os.environ['SWIFT_JOB'],'inset-normals.json').write_text(json.dumps(rows,indent=2));print(rows)
