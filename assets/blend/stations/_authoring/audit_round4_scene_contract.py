"""Verify source light markers, view exposure and units across preserved and revised saved files."""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from round4_common import digest, plain, save_report

output, *sources = sys.argv[sys.argv.index("--") + 1:]
records = []
for source in sources:
    bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()), load_ui=False)
    scene = bpy.context.scene
    state = {"exposure": scene.view_settings.exposure, "gamma": scene.view_settings.gamma,
             "view_transform": scene.view_settings.view_transform, "look": scene.view_settings.look,
             "unit_system": scene.unit_settings.system, "metres_per_unit": scene.unit_settings.scale_length,
             "light_markers": {o.name: {"matrix": [list(r) for r in o.matrix_world], "properties": plain(dict(o.items()))}
                               for o in bpy.data.objects if o.name.startswith("Light_")}}
    records.append({"source": source, "sha256": digest(source), "state": state})
for stem in ("waystation", "scrapyard"):
    matches = [r for r in records if Path(r["source"]).stem == stem]
    assert len(matches) == 2 and matches[0]["state"] == matches[1]["state"], stem
save_report(output, records)
print("SAVED SCENE CONTRACT PASS; authored light marker values, exposure, view transform and metre scale unchanged")
