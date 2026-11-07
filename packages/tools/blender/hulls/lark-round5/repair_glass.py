import bpy,bmesh,json
from pathlib import Path
P=Path(__file__).resolve();R=P.parents[5];src=R/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src));bpy.context.preferences.filepaths.save_version=0
report=[]
for o in bpy.data.objects:
 if o.type!='MESH' or not o.name.startswith('CanopyGlass'):continue
 bm=bmesh.new();bm.from_mesh(o.data);before=len(bm.verts)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 for f in bm.faces:f.smooth=True
 report.append(dict(name=o.name,vertices_before=before,vertices_after=len(bm.verts)))
 bm.to_mesh(o.data);bm.free();o.data.update()
bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(P.parent/'glass-weld.json').write_text(json.dumps(report,indent=2))
