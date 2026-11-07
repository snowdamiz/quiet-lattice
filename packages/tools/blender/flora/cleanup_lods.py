"""Persist Blender's topology repair in source, never silently at export."""

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[4]
for group in ("foliage", "stone", "resources"):
    path = ROOT / f"assets/blend/flora/non_tree_{group}.blend"
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    bpy.context.preferences.filepaths.save_version = 0
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or "kind" not in ob:
            continue
        before = len(ob.data.polygons)
        if ob.data.validate(verbose=True):
            print("REPAIRED", ob.name, before, "->", len(ob.data.polygons), flush=True)
        assert not ob.data.validate(), ob.name
    bpy.context.scene["t05_topology_repaired"] = True
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
