"""Read-only diagnosis of Blender's glTF mesh warning on baseline and saved candidate."""
import json
from pathlib import Path

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/renders/stations/round5/syrock_20261102_a1'
records=[]
for label,path in [('baseline',OUT/'preserved_round4/scrapyard.blend'),('candidate',OUT/'staged02/stations/scrapyard.blend')]:
    bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
    bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
    meshes=[]
    for lod in range(4):
        mesh=bpy.data.objects[f'sy_rock_L{lod}'].data
        counts={name:0 for name in ('vertices','edges','polygons','loops')}
        for key in counts:counts[key]=len(getattr(mesh,key))
        mesh.calc_loop_triangles();tiny={}
        for tri in mesh.loop_triangles:
            if tri.area<1e-8:
                name=mesh.materials[mesh.polygons[tri.polygon_index].material_index].name
                tiny[name]=tiny.get(name,0)+1
        changed=mesh.validate(verbose=True,clean_customdata=True)
        after={key:len(getattr(mesh,key)) for key in counts}
        meshes.append({'lod':lod,'before':counts,'after_validation':after,'validation_changed_data':changed,'tiny_triangles_by_material_before':tiny})
    records.append({'label':label,'meshes':meshes,'source_saved':False})
(OUT/'mesh_validity_diagnosis.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records))
