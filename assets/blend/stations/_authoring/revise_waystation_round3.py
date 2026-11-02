"""Apply the second grader's emission correction to a verified saved-source copy."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
source, output, report = map(Path, args)
expected = "596f4e162641ed02678347b5eee01e0e743c1d81b989c1cef6ebc73aa4448001"
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
assert not output.exists(), "Use a new staged output; never patch an already revised source."
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
before_markers = {o.name: dict(o.items()) for o in bpy.data.objects if o.name.startswith("Light_")}
changes = []
for name, old, new in (("WS_Metal", 6.0, 0.35), ("NavWhite", 8.0, 0.35)):
    material = bpy.data.materials[name]
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    strength = bsdf.inputs["Emission Strength"]
    assert abs(strength.default_value - old) < 1e-6
    strength.default_value = new
    changes.append({"material": name, "old_emission_strength": old, "new_emission_strength": new})
assert before_markers == {o.name: dict(o.items()) for o in bpy.data.objects if o.name.startswith("Light_")}
bpy.context.scene["station_submission"] = 3
bpy.context.scene["round3_scope"] = "Reduce terminal/pad lens emission only; geometry and authored Light_* values unchanged."
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
Path(report).write_text(json.dumps({"input_sha256": expected, "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                                  "changes": changes, "light_markers_unchanged": True,
                                  "geometry_changed": False, "bake_required": False,
                                  "same_uncut_controls_browser_verification": "Pending scheduled GPU window."}, indent=2) + "\n")
print("SAVED", output)
