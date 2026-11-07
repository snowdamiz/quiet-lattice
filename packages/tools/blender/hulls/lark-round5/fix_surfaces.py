"""Edit the pinned saved source; preserve UV coordinates and panel boundaries."""
import bpy,json,hashlib
from pathlib import Path
P=Path(__file__).resolve(); R=P.parents[5]; src=R/'assets/blend/hulls/lark.blend'
assert hashlib.sha256(src.read_bytes()).hexdigest()=='4d0eec86894b3eefa3985cbd6686e1f27d0d7512140e7d09e39a65adc19d07c1'
bpy.ops.wm.open_mainfile(filepath=str(src))
bpy.context.preferences.filepaths.save_version=0
receipt=[]
for variant in ['lark','lark_damaged','lark_husked']:
 source=bpy.data.collections[variant+'_LOD0']
 glass=next(o for o in source.objects if o.name.startswith('CanopyGlass'))
 for f in glass.data.polygons: f.use_smooth=True
 glass.data.update()
 for level in [1,2,3]:
  col=bpy.data.collections[f'{variant}_LOD{level}']
  target=next(o for o in col.objects if o.name.startswith('CanopyGlass'))
  old=len(target.data.polygons); target.data=glass.data.copy()
  receipt.append(dict(object=target.name,old_faces=old,new_faces=len(target.data.polygons)))
 # Keep the original borders/UVs; transfer corner normals from the detailed shell.
 body=next(o for o in source.objects if o.name.startswith('Body'))
 for level in [1,2]:
  col=bpy.data.collections[f'{variant}_LOD{level}']
  target=next(o for o in col.objects if o.name.startswith('Body'))
  bpy.ops.object.select_all(action='DESELECT'); target.select_set(True); bpy.context.view_layer.objects.active=target
  for old_modifier in list(target.modifiers):
   if old_modifier.type=='DATA_TRANSFER': target.modifiers.remove(old_modifier)
  mod=target.modifiers.new('Lark_R5_surface_normals','DATA_TRANSFER');mod.object=body
  mod.use_loop_data=True;mod.data_types_loops={'CUSTOM_NORMAL'};mod.loop_mapping='POLYINTERP_NEAREST'
  bpy.ops.object.modifier_apply(modifier=mod.name)
  assert target.data.has_custom_normals
  receipt.append(dict(object=target.name,custom_normals=True))
bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(P.parent/'surface-changes.json').write_text(json.dumps(receipt,indent=2))
