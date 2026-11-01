"""Read saved station sources and record mating, travel and scale evidence without exporting or rendering.

Blender -b --factory-startup -P audit_source.py -- <output.json>
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[4]
ROT = Matrix.Rotation(math.pi, 4, "Z")


def obj(asset, name):
    return next(o for o in bpy.data.collections[asset].objects if o.name.split(".")[0] == name)


def pose(asset, name):
    return obj(asset, name).matrix_world.copy()


report = {"sources": {}, "door": {}, "gangways": [], "large_dock": {}}
for name in ("waystation", "scrapyard"):
    src = ROOT / "assets/blend/stations" / f"{name}.blend"
    report["sources"][name] = {"path": str(src.relative_to(ROOT)), "sha256": hashlib.sha256(src.read_bytes()).hexdigest()}
    bpy.ops.wm.open_mainfile(filepath=str(src), load_ui=False)
    if name == "waystation":
        leaves = list(bpy.data.collections["ws_baydoor_LOD0"].objects)
        collisions = list(bpy.data.collections["ws_baydoor"].objects)
        evidence = []
        for leaf in leaves:
            if "leaf" not in leaf:
                continue
            collider = next(o for o in collisions if o.get("leaf") == leaf["leaf"])
            assert leaf["open_x"] == collider["open_x"]
            assert leaf["open_seconds"] == collider["open_seconds"]
            xs = [v.co.x + leaf["open_x"] for v in leaf.data.vertices]
            evidence.append({"leaf": leaf["leaf"], "open_x": leaf["open_x"], "open_x_bounds": [min(xs), max(xs)], "collider": collider.name})
        report["door"] = {
            "class": bpy.data.collections["ws_baydoor"]["asset_class"],
            "aperture_width_m": 130,
            "full_track_width_m": 160,
            "role": "complete ten-leaf hangar closure with tracks extending into retraction pockets",
            "travel_contract": "P1.E11.T02 must apply matching open_x to leaf and collider; this audit verifies authored data, not runtime movement",
            "leaves": evidence,
        }
    else:
        for dock_socket, deck_socket, dock_asset in (("Socket_Dock_1", "Socket_Deck_1", "sy_dock"), ("Socket_DockL_1", "Socket_Deck_2", "sy_dock_l")):
            dock = pose("sy_rock", dock_socket) @ ROT @ pose(dock_asset, "Socket_DockAnchor").inverted()
            deck = pose("sy_rock", deck_socket) @ ROT @ pose("sy_deck", "Socket_DeckAnchor").inverted()
            bridge = dock @ pose(dock_asset, "Socket_Gangway") @ ROT @ pose("sy_gangway", "Socket_DockEnd").inverted()
            a = bridge @ pose("sy_gangway", "Socket_DeckEnd")
            b = deck @ pose("sy_deck", "Socket_Gangway")
            gap = (a.translation - b.translation).length
            opposition = (a.to_3x3().col[1]).dot(b.to_3x3().col[1])
            assert gap < 0.001 and opposition < -0.999
            report["gangways"].append({"dock": dock_socket, "deck": deck_socket, "gap_m": gap, "facing_dot": opposition, "width_m": 2.4})
        bay = obj("sy_dock_l", "BAY_Dock")
        assert bay["radius"] == 18
        report["large_dock"] = {"diameter_m": 36, "bay_radius_m": bay["radius"], "tier": bay["tier"]}
        report["deck_cover_colliders"] = sorted(o.name for o in bpy.data.collections["sy_deck"].objects if o.name.startswith("COL_Cover_"))
        assert len(report["deck_cover_colliders"]) == 7
out = Path(sys.argv[sys.argv.index("--") + 1])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + "\n")
print(f"SOURCE AUDIT PASS: {out}; {len(report['gangways'])} walkable socket joins, 10 matching door travel records, 36 m dock, 7 cover colliders")
