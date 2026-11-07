import bpy,hashlib,json
from pathlib import Path
D=Path(__file__).resolve().parent
src=D.parents[4]/'assets/blend/hulls/lark.blend'
def snapshot(path):
 bpy.ops.wm.open_mainfile(filepath=str(path))
 return {'images':{i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file},'transforms':{o.name:[list(r) for r in o.matrix_world] for o in bpy.data.objects},'uv_layers':{o.name:[u.name for u in o.data.uv_layers] for o in bpy.data.objects if o.type=='MESH'}}
a=snapshot(D/'scratch/cockpit-before.blend');b=snapshot(src);assert a==b
(D/'cockpit-integrity.json').write_text(json.dumps({'packed_images_transforms_uv_layer_names_unchanged':True,'packed_images':len(b['images']),'objects':len(b['transforms'])},indent=2))
