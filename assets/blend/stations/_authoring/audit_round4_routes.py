"""Compare saved-source Scrapyard reachability and exact mating, without a runtime traversal claim."""
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from round4_common import digest, save_report

output, *sources = sys.argv[sys.argv.index("--") + 1:]
ROT = Matrix.Rotation(math.pi, 4, "Z")
records = []


def sock(asset, name):
    return next(o for o in bpy.data.collections[asset].objects if o.name.split(".")[0] == name).matrix_world.copy()


def linspace(a, b, n=41):
    return [Vector(a).lerp(Vector(b), k / (n - 1)) for k in range(n)]


for source in sources:
    bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()), load_ui=False)
    rock = bpy.data.objects["sy_rock_L0"]
    tree = BVHTree.FromObject(rock, bpy.context.evaluated_depsgraph_get())
    colliders = []
    for obj in bpy.data.collections["sy_rock"].objects:
        if obj.name.startswith("COL_"):
            vertices = [obj.matrix_world @ v.co for v in obj.data.vertices]
            mesh_tree = BVHTree.FromPolygons(vertices, [list(p.vertices) for p in obj.data.polygons])
            colliders.append((obj.name, np.min(vertices, axis=0), np.max(vertices, axis=0), mesh_tree))
    tests = []
    routes = [("Axial_Lark_Approach", linspace((0, -160, 0), (0, 0, 0)), 7.5)]
    mates = []
    for dock_name, deck_name, asset in (("Socket_Dock_1", "Socket_Deck_1", "sy_dock"),
                                       ("Socket_DockL_1", "Socket_Deck_2", "sy_dock_l")):
        dock = sock("sy_rock", dock_name) @ ROT @ sock(asset, "Socket_DockAnchor").inverted()
        deck = sock("sy_rock", deck_name) @ ROT @ sock("sy_deck", "Socket_DeckAnchor").inverted()
        bridge = dock @ sock(asset, "Socket_Gangway") @ ROT @ sock("sy_gangway", "Socket_DockEnd").inverted()
        a = bridge @ sock("sy_gangway", "Socket_DeckEnd")
        b = deck @ sock("sy_deck", "Socket_Gangway")
        gap = (a.translation - b.translation).length
        facing = a.to_3x3().col[1].dot(b.to_3x3().col[1])
        assert gap < 0.001 and facing < -0.999
        mates.append({"dock": dock_name, "deck": deck_name, "gap_m": gap, "facing_dot": facing})
        # Sample the human torso/head corridor above the authored 2.4 m gangway and both adjoining platforms.
        for z in (0.4, 1.0, 1.7):
            points = [bridge @ p for p in linspace((0, -11.5, z), (0, -0.5, z))]
            routes.append((f"{dock_name}_Gangway_Height{z}", points, 0.35))
        for x in (-1.0, 0, 1.0):
            points = [dock @ p for p in linspace((x, -3.5, 1.0), (x, -12, 1.0))]
            routes.append((f"{dock_name}_PadWalk{x}", points, 0.35))
        landing = dock @ sock(asset, "BAY_Dock") @ Vector((0, 0, 8))
        routes.append((f"{dock_name}_FlightToPad", linspace((0, -5, 8), landing), 5.0))
    for name, points, radius in routes:
        minimum = min(tree.find_nearest(p)[3] for p in points)
        hits = []
        for a, b in zip(points, points[1:]):
            delta = b - a
            if delta.length > 1e-6:
                hit, normal, index, distance = tree.ray_cast(a, delta.normalized(), delta.length)
                if hit is not None:
                    hits.append({"point": list(hit), "face": index})
        overlaps = []
        volume_overlaps = []
        for index, p in enumerate(points):
            p = np.array(p)
            for collider, lo, hi, mesh_tree in colliders:
                # A sphere-to-box distance check avoids the larger cube's artificial corner intersections.
                delta = np.maximum(np.maximum(lo - p, p - hi), 0)
                if np.linalg.norm(delta) < radius:
                    overlaps.append({"sample": index, "collider": collider})
                    nearest = mesh_tree.find_nearest(Vector(p))[3]
                    direction = Vector((1, 0.317, 0.113)).normalized()
                    origin = Vector(p)
                    intersections = 0
                    for _ in range(20):
                        hit, _, _, distance = mesh_tree.ray_cast(origin, direction, 1500)
                        if hit is None:
                            break
                        intersections += 1
                        origin = hit + direction * 0.001
                    if nearest < radius or intersections % 2:
                        volume_overlaps.append({"sample": index, "collider": collider, "surface_distance_m": nearest,
                                                "inside_closed_volume": bool(intersections % 2)})
        tests.append({"name": name, "samples": len(points), "radius_m": radius, "minimum_visible_rock_clearance_m": minimum,
                      "visible_geometry_segment_hits": hits, "coarse_collider_sphere_overlaps": overlaps,
                      "closed_collider_volume_overlaps": volume_overlaps,
                      "visible_clear": minimum >= radius and not hits, "collider_clear": not overlaps,
                      "closed_volume_clear": not volume_overlaps})
    records.append({"source": source, "sha256": digest(source), "mating": mates, "routes": tests,
                    "collider_count": len(colliders), "limit": "Saved-source geometric and sphere/AABB audit; runtime traversal and continuous collision remain unverified"})
save_report(output, records)
for record in records:
    print(record["source"], [(t["name"], round(t["minimum_visible_rock_clearance_m"], 2), t["visible_clear"], t["collider_clear"], t["closed_volume_clear"]) for t in record["routes"]])
revised = records[-1]
assert all(t["visible_clear"] for t in revised["routes"]), "Revised visible rock obstructs a sampled route"
assert all(t["closed_volume_clear"] for t in revised["routes"]), "Saved closed collider volume obstructs a sampled route"
baseline = {t["name"]: t for t in records[0]["routes"]}
regressions = [t["name"] for t in revised["routes"] if baseline[t["name"]]["collider_clear"] and not t["collider_clear"]]
assert not regressions, f"New collider obstruction: {regressions}"
print("SOURCE ROUTE AUDIT PASS; baseline collider limitations retained in report")
