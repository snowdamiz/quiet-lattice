import bpy, json, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
PRIVATE=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend'
OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
# find all objects using Dark materials
rows=[]
for m in bpy.data.materials:
    if m.get('engine_name')!='Dark': continue
    for o in bpy.data.objects:
        if o.type!='MESH': continue
        if any(s.material==m for s in o.material_slots):
            rows.append({
                'mat':m.name,
                'object':o.name,
                'uv':[u.name for u in o.data.uv_layers],
                'collections':[c.name for c in bpy.data.collections if o.name in c.objects],
                'polys':len(o.data.polygons),
            })
# also list mesh object names containing Cockpit or Gear or Interior or leg
names=sorted(o.name for o in bpy.data.objects if o.type=='MESH' and any(k in o.name.lower() for k in ('cockpit','gear','interior','leg','landing')))
path=OUT/(time.strftime('%Y%m%dT%H%M%S')+f'{int(time.time()*1e6)%1000000:06d}Z-dark-users.json')
path.write_text(json.dumps({'dark_users':rows,'related_names':names},indent=2))
print(path)
print('related', names)
print('dark user count', len(rows))
for r in rows:
    print(r)
