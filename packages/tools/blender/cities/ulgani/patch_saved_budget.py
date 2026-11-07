"""Correct only the over-budget saved tower; never imports or re-runs authoring."""

import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, lods
from artlib import scene as S


def mesh_hash(ob):
    me = ob.data
    points = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", points)
    loops = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", loops)
    return hashlib.sha256(points.tobytes() + loops.tobytes()).hexdigest()


source = ROOT / "assets/blend/cities/ulgani_tall.blend"
meta = ROOT / "assets/blend/cities/ulgani"
receipt = meta / "revisions/tall-budget-r01.json"
if receipt.exists():
    raise RuntimeError("revision receipt already exists")
before = hashlib.sha256(source.read_bytes()).hexdigest()
expected = json.loads((meta / "interrupted-checkpoint-01.json").read_text())
assert (
    next(
        x["sha256"]
        for x in expected["sourceFiles"]
        if x["path"].endswith("ulgani_tall.blend")
    )
    == before
)
core.load(source)
meshes_before = {o.name: mesh_hash(o) for o in bpy.data.objects if o.type == "MESH"}
images_before = {
    i.name: hashlib.sha256(i.packed_file.data).hexdigest()
    for i in bpy.data.images
    if i.packed_file
}
changed = []
targets = [59800, 17940, 5980, 2093]
for n, target in enumerate(targets):
    ob = bpy.data.objects[f"ulgani_tall_3_Surface{n}"]
    count_before = S.tri_count(ob)
    lods._decimate([ob], target)
    changed.append(
        {
            "object": ob.name,
            "before": count_before,
            "after": S.tri_count(ob),
            "target": target,
        }
    )
changed_names = {x["object"] for x in changed}
assert all(
    mesh_hash(bpy.data.objects[name]) == value
    for name, value in meshes_before.items()
    if name not in changed_names
)
assert images_before == {
    i.name: hashlib.sha256(i.packed_file.data).hexdigest()
    for i in bpy.data.images
    if i.packed_file
}
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
after = hashlib.sha256(source.read_bytes()).hexdigest()
inventory = json.loads((meta / "inventory/tall-b01.json").read_text())
inventory["sha256"] = after
for asset in inventory["assets"]:
    if asset["id"] == "ulgani_tall_3":
        asset["lodTriangles"] = [x["after"] for x in changed]
        lo, hi = S.bounds([bpy.data.objects["ulgani_tall_3_Surface0"]])
        asset["bounds"] = [lo.tolist(), hi.tolist()]
        asset["height"] = float(hi[2] - lo[2])
(meta / "inventory/tall-r01.json").write_text(json.dumps(inventory, indent=2) + "\n")
receipt.parent.mkdir(parents=True, exist_ok=True)
receipt.write_text(
    json.dumps(
        {
            "source": str(source.relative_to(ROOT)),
            "beforeSHA256": before,
            "afterSHA256": after,
            "changed": changed,
            "otherMeshesUnchanged": True,
            "packedImagesUnchanged": True,
        },
        indent=2,
    )
    + "\n"
)
print(changed, flush=True)
