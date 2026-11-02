"""Refine clod relief on the actual saved source; preserve the earlier map and geometry."""
from pathlib import Path
import sys

import bpy
import numpy as np

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4]
OUT=ROOT/'assets/renders/stations/round5/syrock_20261102_a1'
sys.path[:0]=[str(HERE),str(HERE.parent)]
from paint_rock_regions import write_png
from round4_common import compare,digest,save_report,snapshot

SOURCE=OUT/'staged/stations/scrapyard.blend';DEST=OUT/'staged02/stations/scrapyard.blend'
assert digest(SOURCE)=='14654fd99b63b76c769728c02c067a033aa12a0bc256300a1ef40af85d2cab73' and not DEST.exists()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False)
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
before=snapshot();material=bpy.data.materials['SY_Regolith']
node=next(n for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and '_normal' in n.image.name)
pixels=np.empty(2048*2048*4,np.float32);node.image.pixels.foreach_get(pixels)
normal=pixels.reshape(2048,2048,4)[:,:,:3]*2-1
normal[:,:,:2]*=2.4
normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
directory=HERE/'textures_regolith02';directory.mkdir(exist_ok=False)
path=directory/'SY_Regolith_R5_Clods_normal.png'
# Blender image buffers have their first row at the bottom; PNG scanlines start at the top.
write_png(path,np.flipud(normal*.5+.5))
image=bpy.data.images.load(str(path),check_existing=False);image.name='SY_Regolith_R5_Clods_normal'
image.colorspace_settings.name='Non-Color';image.pack();node.image=image
invariants=compare(before,snapshot(),(),('SY_Regolith',))
DEST.parent.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.save_as_mainfile(filepath=str(DEST),compress=True)
save_report(OUT/'regolith_refinement.json',{'input_sha256':digest(SOURCE),'output_sha256':digest(DEST),
    'saved_source':str(DEST),'normal_map':{'path':str(path),'sha256':digest(path),'size':[2048,2048]},
    'scope':'Existing regolith clod normal relief only; no geometric, UV, collider, other material or module edits',
    'invariants':invariants,'render_performed':False,'bakes_performed':False,'threads':2})
print('SAVED REGOLITH RELIEF REFINEMENT',digest(DEST),invariants)
