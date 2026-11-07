"""Put saved variants under the kind roots the existing review scene understands."""

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[4]
for group in ("foliage", "stone", "resources"):
    path = ROOT / f"assets/blend/flora/non_tree_{group}.blend"
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    scene = bpy.context.scene
    assert not scene.get("t05_kind_roots"), "Layout already migrated"
    bpy.context.preferences.filepaths.save_version = 0
    counts = {}
    old = sorted(
        [c for c in scene.collection.children if c.name.startswith("Flora_")],
        key=lambda c: c.name,
    )
    for collection in old:
        mesh = next(
            o
            for o in collection.all_objects
            if o.type == "MESH" and "_lod" not in o.name
        )
        name = mesh.name
        prefix = "deposit" if name.startswith("deposit") else name.rsplit("_", 1)[0]
        root = bpy.data.collections.get(prefix)
        if root is None:
            root = bpy.data.collections.new(prefix)
            scene.collection.children.link(root)
        index = counts.get(prefix, 0)
        counts[prefix] = index + 1
        variant = f"{prefix}_variant_{index}"
        vc = bpy.data.collections.new(variant)
        root.children.link(vc)
        for lod in list(collection.children):
            level = lod.name.rsplit("_LOD", 1)[1]
            lod.name = f"{variant}_LOD{level}"
            vc.children.link(lod)
            collection.children.unlink(lod)
        bpy.data.collections.remove(collection)
        print("MAPPING", name, prefix, variant, flush=True)
    scene["t05_kind_roots"] = True
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
