"""Convert saved tint nodes to the Blender 5.2 glTF-supported multiply route."""

import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).parent))
from audit import core, sha
from pipeline import META, ROOT, inventory

source = ROOT / "assets/blend/cities/ulgani_props.blend"
before = sha(source)
assert before == "30c0aa792db91c0b37528a2c74025c116af3c4617c2bce94154f4fd60b48fbc4"
data = json.loads((ROOT / inventory("props")).read_text())
core.load(source)
changed = []
for mat in bpy.data.materials:
    if not mat.name.startswith("UlganiMetric_"):
        continue
    nt = mat.node_tree
    for old in list(nt.nodes):
        if old.type != "MIX_RGB":
            continue
        assert old.blend_type == "MULTIPLY" and old.inputs[0].default_value == 1
        new = nt.nodes.new("ShaderNodeMix")
        new.data_type = "RGBA"
        new.blend_type = "MULTIPLY"
        new.inputs[0].default_value = 1
        for old_input, new_input in zip(
            old.inputs[1:3], (new.inputs[6], new.inputs[7]), strict=True
        ):
            new_input.default_value = old_input.default_value
            for link in old_input.links:
                nt.links.new(link.from_socket, new_input)
        for link in list(old.outputs[0].links):
            nt.links.new(new.outputs[2], link.to_socket)
        nt.nodes.remove(old)
        changed.append(mat.name)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
data["sha256"] = sha(source)
with (META / "inventory/props-density-d03.json").open("x") as f:
    json.dump(data, f, indent=2)
with (META / "density-revision/tint-props-d03.json").open("x") as f:
    json.dump(
        {
            "beforeSHA256": before,
            "afterSHA256": sha(source),
            "changedNodesInMaterials": changed,
            "scope": "material nodes only",
        },
        f,
        indent=2,
    )
