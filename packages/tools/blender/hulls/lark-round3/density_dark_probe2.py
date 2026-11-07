import bpy, json, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
PRIVATE=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend'
OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
rows=[]
for name in ['Body_dmg','CanopyFrame_dmg','CockpitInteriorMesh_dmg','GearFront_leg_dmg','Body','CockpitInteriorMesh','GearFront_leg','Body_husk','CockpitInteriorMesh_husk','GearFront_leg_husk']:
    o=bpy.data.objects.get(name)
    if not o: 
        rows.append({'object':name,'missing':True}); continue
    slots=[]
    for i,s in enumerate(o.material_slots):
        m=s.material
        slots.append(None if not m else {
            'slot':i,'mat':m.name,'eng':m.get('engine_name'),'id':m.as_pointer(),
            'uv_layers':[u.name for u in o.data.uv_layers],
            'active_uv':o.data.uv_layers.active.name if o.data.uv_layers.active else None,
            'private':bool(m.get('round3_density_private')),
            'users_mat':m.users,
        })
    rows.append({'object':name,'slots':slots})
# also list every material with eng Dark and pointer
darks=[{'name':m.name,'ptr':m.as_pointer(),'eng':m.get('engine_name'),'private':bool(m.get('round3_density_private'))} for m in bpy.data.materials if m.get('engine_name')=='Dark']
path=OUT/(time.strftime('%Y%m%dT%H%M%S')+f'{int(time.time()*1e6)%1000000:06d}Z-dark-slots.json')
path.write_text(json.dumps({'rows':rows,'darks':darks},indent=2))
print(path)
print(json.dumps({'darks':darks,'rows':rows},indent=2))
