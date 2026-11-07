"""Saved-source corrosion relief and glazing response; no geometry or UV edits."""
import bpy,numpy as np,hashlib,json
from pathlib import Path
P=Path(__file__).resolve();src=P.parents[5]/'assets/blend/hulls/lark.blend'
assert src.is_file()
bpy.ops.wm.open_mainfile(filepath=str(src))
im=bpy.data.images['lark_husked_4k_density_normal'];w,h=im.size
a=np.empty(w*h*4,np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
# Corrosion relief follows the existing authored rust colour, with fine etched pits.
col=bpy.data.images['lark_husked_4k_density_baseColor'];c=np.empty(w*h*4,np.float32);col.pixels.foreach_get(c);c=c.reshape(h,w,4)
y,x=np.mgrid[:h,:w].astype(np.float32)
rust=np.clip((c[:,:,0]-c[:,:,2])*8,0,1)
relief=(.008+.018*rust)*(np.sin(x*.61+np.sin(y*.19))*np.sin(y*.47)+.45*np.sin(x*.13+y*.23))
ny,nx=np.gradient(relief)
a[:,:,0]=np.clip(a[:,:,0]+nx,0,1);a[:,:,1]=np.clip(a[:,:,1]+ny,0,1)
a[:,:,2]=.5+.5*np.sqrt(np.maximum(0,1-(2*a[:,:,0]-1)**2-(2*a[:,:,1]-1)**2))
im.pixels.foreach_set(a.ravel());im.pack()
# Base glass has no maps: white patches are sharp area-light reflections.
m=bpy.data.materials['Lark_Glass'];bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.18
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(P.parent/'finish-material-receipt.json').write_text(json.dumps({'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'geometry_uv_changes':False,'normal_detail':'fine etched relief with increased amplitude on existing rust pigmentation','glass':'base roughness .06 to .18; no base maps exist','remaining':'wear layout, measured panel loss, cockpit finish need further authoring'},indent=2))
