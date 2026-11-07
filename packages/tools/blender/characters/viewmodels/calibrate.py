"""Saved-source palette and emitter alignment correction from CPU inspection."""
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix,Vector

scene=bpy.context.scene;p=scene['viewmodel_people'];source=Path(bpy.data.filepath)
assert source.parent.name=='viewmodels'
assert not scene.get('viewmodel_palette_calibrated')
for suffix in ('base','emissive'):
    im=bpy.data.images[f'VM_{p}_{suffix}'];a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a);a=a.reshape(-1,4)
    # The palette is specified in sRGB; Blender's pixel API stores scene-linear RGB.
    rgb=a[:,:3].copy();a[:,:3]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    im.pixels.foreach_set(a.ravel());im.pack()
if p=='ixari':
    bpy.context.view_layer.update()
    bpy.data.objects['Muzzle'].matrix_world=Matrix.Translation(Vector((.192,.975,-.105)))
scene['viewmodel_palette_calibrated']=True
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
