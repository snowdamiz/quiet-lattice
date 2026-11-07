"""Join the existing bench back rail to its seat; preserve saved topology, UVs and maps."""

import hashlib
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import geometry, sha
from pipeline import META, ROOT

source = ROOT / "assets/blend/cities/ulgani_props.blend"
inventory = json.loads((META / "inventory/props-b01.json").read_text())
assert sha(source) == inventory["sha256"]
before = sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
maps = {
    i.name: hashlib.sha256(i.packed_file.data).hexdigest()
    for i in bpy.data.images
    if i.packed_file
}
unchanged = {
    o.name: hashlib.sha256(geometry([o])[0].tobytes()).hexdigest()
    for o in bpy.data.objects
    if o.type == "MESH" and not o.name.startswith("ulgani_bench_Surface")
}
changes = []
for lod in range(4):
    ob = bpy.data.objects[f"ulgani_bench_Surface{lod}"]
    group = ob.vertex_groups["Back"].index
    count = 0
    for vertex in ob.data.vertices:
        if any(g.group == group and g.weight > 0.5 for g in vertex.groups):
            vertex.co.z -= 0.4 * min(abs(vertex.co.x) / 1.1, 1) ** 6
            count += 1
    ob.data.update()
    changes.append({"object": ob.name, "editedVertices": count})
assert all(
    hashlib.sha256(geometry([bpy.data.objects[name]])[0].tobytes()).hexdigest() == value
    for name, value in unchanged.items()
)
assert maps == {
    i.name: hashlib.sha256(i.packed_file.data).hexdigest()
    for i in bpy.data.images
    if i.packed_file
}
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
inventory["sha256"] = sha(source)
with (META / "inventory/props-r03.json").open("x") as f:
    json.dump(inventory, f, indent=2)
with (META / "revisions/bench-join-r03.json").open("x") as f:
    json.dump(
        {
            "source": str(source.relative_to(ROOT)),
            "beforeSHA256": before,
            "afterSHA256": sha(source),
            "changes": changes,
            "packedImagesUnchanged": True,
            "otherMeshesUnchanged": True,
            "packedImages": maps,
            "method": "Bent the existing Back component ends 0.4 m downward into the rear seat lamina in all four saved LODs; no topology or UV edits.",
        },
        f,
        indent=2,
    )
