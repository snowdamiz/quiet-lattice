"""Read-only UV packing experiment on the saved authoring source."""
import bpy, sys, json
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from atlas import core, SRC, OUT, raster
from author_round3 import select

results=[]
for margin in (.0005,.0001,0):
    core.load(SRC)
    objects=[o for o in bpy.data.collections['kestrel_LOD0'].objects if o.type=='MESH' and not o.name.startswith('SporeNavigation')]
    select(objects);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=.65,island_margin=margin,area_weight=0,scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    try:
        a,m,r=raster(objects,strict=False);results.append({'margin':margin,**r});del a,m
    except AssertionError as e:results.append({'margin':margin,'error':str(e)})
    print('RESULT',results[-1],flush=True)
(OUT/'uv-packing-probe.json').write_text(json.dumps(results,indent=2)+'\n')
