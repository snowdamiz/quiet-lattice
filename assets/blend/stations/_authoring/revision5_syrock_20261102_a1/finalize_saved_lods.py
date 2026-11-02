"""Remove duplicate faces only from the saved derived rock LODs; no sculpt or map replay."""
from pathlib import Path
import sys

import bpy

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4]
OUT=ROOT/'assets/renders/stations/round5/syrock_20261102_a1'
sys.path.insert(0,str(HERE.parent))
from round4_common import compare,digest,save_report,snapshot

source=OUT/'staged02/stations/scrapyard.blend';dest=OUT/'staged03/stations/scrapyard.blend'
assert digest(source)=='c4b3adf0dc1f4870116c958e50a22b8fe6b566aab9f4c17a075a92e7798b85af' and not dest.exists()
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
before=snapshot();records=[]
for lod in range(4):
    mesh=bpy.data.objects[f'sy_rock_L{lod}'].data
    count=len(mesh.polygons);changed=mesh.validate(verbose=True,clean_customdata=True)
    assert lod!=0 or not changed
    assert not mesh.validate(verbose=True,clean_customdata=True),'Saved mesh still needs repair'
    records.append({'lod':lod,'changed':changed,'faces_before':count,'faces_after':len(mesh.polygons),
                    'triangles':sum(len(p.vertices)-2 for p in mesh.polygons)})
invariants=compare(before,snapshot(),[f'sy_rock_L{k}' for k in (1,2,3)])
dest.parent.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
save_report(OUT/'saved_lod_cleanup.json',{'input_sha256':digest(source),'output_sha256':digest(dest),
    'saved_source':str(dest),'records':records,'invariants':invariants,
    'lod0_material_uv_collider_and_marker_state_exact':True,'render_or_bake_performed':False,'threads':2})
print('SAVED CLEAN DERIVED LODS',digest(dest),records)
