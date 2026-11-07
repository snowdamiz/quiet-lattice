"""Refresh measured fields from authoritative saved sources after edit sessions."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules as R, scene as S

rules=R.load()
for ip in sorted((ROOT/'assets/blend/cities/ixari/inventory').glob('*.json')):
    inventory=json.loads(ip.read_text());path=ROOT/inventory[0]['source']
    core.load(path);model=S.collect_source(rules);S.assign_classes(rules,'cities',model)
    variants={v.id:v for a in model.assets for v in a.variants.values()}
    assert set(variants)=={s['id'] for s in inventory}
    for spec in inventory:
        v=variants[spec['id']];meshes=S.render_meshes(rules,v.lods[0]);box=S.bounds(meshes)
        spec.update(bounds=[list(map(float,x)) for x in box],authoredHeight=float(box[1][2]-box[0][2]),
                    footprintRadius=max(math.hypot(co[0],co[1]) for ob in meshes for co in S.world_coords(ob)),
                    lodTriangles=[sum(S.tri_count(o) for o in S.render_meshes(rules,v.lods[n])) for n in range(4)],
                    sourceIslands=sum(len(o.vertex_groups) for o in meshes),assetClass=v.cls,
                    colliders=[o.name for o in v.all_objects() if S.is_collider(rules,o)],
                    markers=[dict(name=o.name,position=list(o.matrix_world.translation),properties=dict(o.items()))
                             for o in v.all_objects() if o.type=='EMPTY' and S.is_point_marker(rules,o)],
                    sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest())
    ip.write_text(json.dumps(inventory,indent=2)+'\n')
    print('MEASURED',ip.name,len(inventory))
