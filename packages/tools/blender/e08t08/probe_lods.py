"""Identify what Blender repairs in generated LODs without saving the source."""
import bpy
import json
import sys
sys.dont_write_bytecode=True
from pathlib import Path

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
from artlib import core,lods,rules
R=rules.load()
report=core.validate_path(R,ROOT/'assets/blend/creatures/quad_small.blend',family='creatures')
v=next(iter(report.model.assets[0].variants.values()))
scratch=bpy.data.collections.new('_probe'); bpy.context.scene.collection.children.link(scratch)
lods.generate(R,v,scratch)
records=[]
for level,objects in v.lods.items():
    for o in objects:
        if o.type!='MESH':continue
        me=o.data
        before=dict(vertices=len(me.vertices),edges=len(me.edges),faces=len(me.polygons),tris=sum(len(p.vertices)-2 for p in me.polygons))
        print('VALIDATING',level,o.name,flush=True)
        changed=me.validate(verbose=True)
        after=dict(vertices=len(me.vertices),edges=len(me.edges),faces=len(me.polygons),tris=sum(len(p.vertices)-2 for p in me.polygons))
        records.append(dict(level=level,changed=changed,before=before,after=after))
(HERE/'reports/lod-repair-probe.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records))
