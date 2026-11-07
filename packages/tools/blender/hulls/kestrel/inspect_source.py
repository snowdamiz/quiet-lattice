"""Read source inventory without saving; CPU only."""
import bpy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules, scene

src = ROOT / "assets/blend/hulls/kestrel.blend"
core.load(src)
bpy.context.scene.render.threads_mode = "FIXED"
bpy.context.scene.render.threads = 2
bpy.context.scene.cycles.device = "CPU"
r = rules.load()
m = scene.collect_source(r)
record = {"collections": [{"name": c.name,"props": dict(c.items()),"objects":len(c.objects)} for c in bpy.data.collections], "objects":[], "materials":[], "images":[]}
for a in m.assets:
    for v in a.variants.values():
        for lod, objs in v.lods.items():
            for o in objs:
                record["objects"].append({"variant":v.id,"lod":lod,"name":o.name,"type":o.type,"parent":o.parent.name if o.parent else None,"location":list(o.matrix_world.translation),"dimensions":list(o.dimensions),"tris":scene.tri_count(o),"materials":[s.material.name if s.material else None for s in o.material_slots],"props":dict(o.items())})
for m in bpy.data.materials:
    record["materials"].append({"name":m.name,"props":dict(m.items()),"nodes":[{"name":n.name,"type":n.type,"image":n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.node_tree else []})
for i in bpy.data.images:
    record["images"].append({"name":i.name,"size":list(i.size),"packed":i.packed_file is not None})
(ROOT/'assets/renders/hulls/kestrel-round3-current/source-before.json').write_text(json.dumps(record,indent=2,default=str)+'\n')
print('wrote source inventory', len(record['objects']), 'objects')
