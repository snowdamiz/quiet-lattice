"""Position the hardpoint service wear on the measured top of the saved collar."""
import sys,os,json
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
import revise as r
source=Path(sys.argv[sys.argv.index('--')+1]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0
for variant,prefix in [('mule','Mule_'),('mule_damaged','MuleDmg_'),('mule_husked','MuleHusk_Husk')]:
    m=bpy.data.materials[prefix+'Trim'];objects=[o for o in bpy.data.collections[variant+'_LOD0'].objects if o.type=='MESH']
    im=m.node_tree.nodes['R4 painted contact wear'].image
    pixels=r.raster(objects,m,r.trim_field)
    im.pixels.foreach_set(pixels.ravel());im.update();im.pack()
out=Path(os.environ['MULE_ATTEMPT'])
(out/'contact-update.json').write_text(json.dumps({'reason':'CPU close-up showed the selected wear dab below the top of the mount. Measured collar z=3.198..3.368 m; two service-edge contact patches now centered at z=3.36 m.','variants':['mule','mule_damaged','mule_husked'],'geometry_changed':False},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scratch/candidate.blend'),compress=True)
