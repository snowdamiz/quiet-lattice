"""Read current station sources, retaining geometry/material fingerprints and authoring facts."""
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from round4_common import digest, mesh_state, save_report, snapshot

out, *sources = sys.argv[sys.argv.index("--") + 1:]
records = []
for source in sources:
    bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()), load_ui=False)
    facts = {}
    for name in ("ws_fabricator_L0", "sy_rock_L0"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            facts[name] = {"material_faces": {m.name: sum(p.material_index == i for p in obj.data.polygons)
                                               for i, m in enumerate(obj.data.materials)},
                           "bounds": [[min(v.co[k] for v in obj.data.vertices), max(v.co[k] for v in obj.data.vertices)] for k in range(3)]}
    facts["rock_colliders"] = {o.name: {"matrix": [list(r) for r in o.matrix_world],
                                       "world_bounds": [[min((o.matrix_world @ v.co)[k] for v in o.data.vertices),
                                                         max((o.matrix_world @ v.co)[k] for v in o.data.vertices)] for k in range(3)]}
                                for o in bpy.data.objects if o.name.startswith("COL_Rock_")}
    facts["sockets"] = {o.name: list(o.matrix_world.translation) for o in bpy.data.objects if o.name.startswith("Socket_")}
    records.append({"source": source, "sha256": digest(source), "snapshot": snapshot(), "facts": facts})
save_report(out, records)
print("READ-ONLY SNAPSHOTS", out)
