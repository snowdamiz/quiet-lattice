"""Read-only station source audit before and after the third submission edits."""
import json
from pathlib import Path
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
output, *sources = args
reports = []
for source in sources:
    bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()), load_ui=False)
    objects = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not any("_LOD" in c.name for c in obj.users_collection):
            continue
        objects.append({"name": obj.name, "collections": [c.name for c in obj.users_collection],
                        "vertices": len(obj.data.vertices), "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons),
                        "dimensions": list(obj.dimensions), "materials": [m.name for m in obj.data.materials]})
    materials = []
    for mat in bpy.data.materials:
        nodes = list(mat.node_tree.nodes) if mat.use_nodes else []
        materials.append({"name": mat.name,
                          "emission": [{"strength": n.inputs["Emission Strength"].default_value,
                                        "color": list(n.inputs["Emission Color"].default_value),
                                        "linked_color": n.inputs["Emission Color"].is_linked}
                                       for n in nodes if n.type == "BSDF_PRINCIPLED"],
                          "images": [{"name": n.image.name, "size": list(n.image.size),
                                      "packed": bool(n.image.packed_file), "color_space": n.image.colorspace_settings.name}
                                     for n in nodes if n.type == "TEX_IMAGE" and n.image]})
    reports.append({"source": source, "objects": objects, "materials": materials})
Path(output).write_text(json.dumps(reports, indent=2) + "\n")
print("AUDITED", output)
