import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from artlib import core, rules

root = Path(__file__).resolve().parents[4]
path = (
    root
    / "assets/renders/flora/t05/validation/export/flora__non_tree_foliage.glb.rejected.glb"
)
core.load(path)
m = bpy.data.materials["Flora_bush"]
for n in m.node_tree.nodes:
    print(
        n.name,
        n.type,
        getattr(n, "blend_type", ""),
        [
            (
                s.name,
                s.default_value
                if hasattr(s, "default_value") and s.type == "VALUE"
                else "",
                [(l.from_node.type, l.from_socket.name) for l in s.links],
            )
            for s in n.inputs
            if s.enabled
        ],
    )
for node in m.node_tree.nodes:
    if node.type == "VERTEX_COLOR":
        print("MASK_LAYER", repr(node.layer_name))
    if node.type == "MIX":
        print(
            "MIX_TYPE",
            node.data_type,
            "INPUTS",
            [(s.name, s.type, s.enabled) for s in node.inputs],
        )
core.write_and_print(
    core.run_checks(
        rules.load(),
        path,
        "flora",
        "export",
        source=root / "assets/blend/flora/non_tree_foliage.blend",
    )
)
