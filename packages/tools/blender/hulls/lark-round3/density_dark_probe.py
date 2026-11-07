import bpy,json,hashlib
from pathlib import Path
ROOT=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470')
PRIVATE=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend'
OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
bpy.ops.wm.open_mainfile(filepath=str(PRIVATE))
rows=[]
for m in bpy.data.materials:
    en=m.get('engine_name')
    if en in ('Dark','Hull','Accent','Trim') or 'Dark' in m.name:
        imgs=[]
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type=='TEX_IMAGE' and n.image:
                    imgs.append((n.image.name, tuple(n.image.size)))
                if n.type=='UVMAP':
                    imgs.append(('uv', n.uv_map))
        users=[o.name for o in bpy.data.objects if o.type=='MESH' and any(s.material==m for s in o.material_slots)]
        rows.append({'name':m.name,'engine_name':en,'users':users[:12],'user_count':len(users),'imgs':imgs,'private':bool(m.get('round3_density_private'))})
# also per-collection material engine_name sets
per={}
for c in bpy.data.collections:
    if not c.name.endswith('_LOD0'): continue
    mats={}
    for o in c.objects:
        if o.type!='MESH': continue
        for s in o.material_slots:
            if not s.material: continue
            en=s.material.get('engine_name')
            mats.setdefault(en,set()).add(s.material.name)
    per[c.name]={k:sorted(v) for k,v in mats.items() if k}
path=OUT/'probe-dark-materials.json'
# may exist; use attempt id free name with open x via unique
import os,time
path=OUT/(time.strftime('%Y%m%dT%H%M%S')+f'{int(time.time()*1e6)%1000000:06d}Z-probe-dark-materials.json')
path.write_text(json.dumps({'materials':rows,'per_lod0':per},indent=2))
print(path)
print(json.dumps(per,indent=2))
print('dark-like', json.dumps([r for r in rows if r['engine_name']=='Dark' or 'Dark' in r['name']],indent=2))
