"""Real source/GLB validation plus kit-specific geometry, planner and ownership checks.

Uses the repository validator with an explicit source path for the nested kit. No
family rule overrides, geometry rebuilding, network or rendering.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[5]
HOME = ROOT / "assets/blend/cities/thalune"
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules as R, scene as S

STEMS = ["thalune_" + k for k in ("low", "mid", "tall", "civic", "waterfront", "props", "anchor")]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def collider_tree(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return BVHTree.FromPolygons(pts, [tuple(p.vertices) for p in o.data.polygons], all_triangles=False)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--exports", action="store_true")
    p.add_argument("--report", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    rules = R.load()
    entries = [e for stem in STEMS for e in json.loads((HOME / "receipts" / (stem + "-authored.json")).read_text())]
    errors, checks = [], []
    def check(ok, label):
        checks.append({"label": label, "pass": bool(ok)})
        if not ok:
            errors.append(label)
    check(len(entries) == 38 and len({e["id"] for e in entries}) == 38, "complete unique 38-piece inventory")
    for role in ("low", "mid", "tall"):
        check({e.get("planner", {}).get("variant") for e in entries if e["role"] == role} == {0, 1, 2, 3}, role + " four planner variants")
    check({e["role"] for e in entries} >= {"plaza", "market_hall", "skill_house", "compact_office", "listening_house", "shipyard", "salvage_yard", "tide_hall", "wall", "gate", "bridge", "landing_pad", "lamp", "prop", "anchor"}, "full civic, waterfront, prop and anchor roles")
    check({e["padDiameter"] for e in entries if e["padDiameter"]} == {24, 36}, "24 and 36 metre pad inventory")
    check(sha(ROOT / "assets/blend/_library.blend") == "33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c",
          "shared library unchanged from verified local LFS object")
    reports = []
    for stem in STEMS:
        source = HOME.parent / (stem + ".blend")
        expected = {e["sourceSha256"] for e in entries if Path(e["source"]).stem == stem}
        check(expected == {sha(source)}, stem + " authored source unchanged by export/validation")
        path = ROOT / f"packages/client/public/models/cities/{stem}.glb" if a.exports else source
        report = core.validate_path(rules, path, family="cities", source=source)
        core.write_and_print(report, HOME / "receipts/validation" / (stem + ("-export.json" if a.exports else "-source.json")), quiet=True)
        reports.append({"path": str(path.relative_to(ROOT)), "status": report.status, "sha256": sha(path) if path.exists() else None})
        check(report.status == "PASS", stem + " actual repository validator")
        if report.status != "PASS":
            continue
        for asset in report.model.assets:
            for v in asset.variants.values():
                e = next((e for e in entries if e["id"] == v.id), None)
                check(e is not None, v.id + " declared in manifest")
                if e is None:
                    continue
                meshes = S.render_meshes(rules, v.lods[0])
                points = np.concatenate([S.world_coords(o) for o in meshes])
                lo, hi = points.min(0), points.max(0)
                radius = float(np.linalg.norm(points[:, :2], axis=1).max())
                tolerance = max(.025, float(hi[2]) / 8000) if a.exports else .012
                check(abs(radius - e["footprintRadius"]) < tolerance, v.id + " measured circular footprint")
                check(float(np.max(np.abs(np.array(e["boundsBlender"]) - np.array([lo, hi])))) < tolerance, v.id + " measured source/GLB bounds")
                check(abs(lo[2]) < .08, v.id + " ground origin")
                if e["role"] in ("low", "mid", "tall", "anchor"):
                    bands = {"low": (6, 14), "mid": (20, 60), "tall": (170, 340), "anchor": (40, 60)}
                    lower, upper = bands[e["role"]]
                    check(lower <= hi[2] - lo[2] <= upper, v.id + " nominal art height band")
                actual_objects = {R.strip(o.name): o for o in v.all_objects()}
                for marker in e["markers"]:
                    o = actual_objects.get(marker["name"])
                    check(o is not None and o.type == "EMPTY", marker["name"] + " reachable exported node")
                    if o:
                        check((o.matrix_world.translation - Vector(marker["positionBlender"])).length < .002, marker["name"] + " source/GLB transform")
                        for key, value in marker["properties"].items():
                            check(o.get(key) == value, marker["name"] + " preserves " + key)
                colliders = [o for o in v.all_objects() if S.is_collider(rules, o)]
                check({R.strip(o.name) for o in colliders} == set(e["colliders"]), v.id + " collider ownership")
                for collider in colliders:
                    co = S.world_coords(collider)
                    check(float(np.linalg.norm(co[:, :2], axis=1).max()) <= radius + .25,
                          R.strip(collider.name) + " stays inside placement footprint")
                # Sweep the actor's volume along the authored public route using the
                # actual collision meshes. Bridges follow the floor, not a straight
                # line through the rise. Check the declared full corridor dimensions.
                trees = [collider_tree(o) for o in colliders]
                if e["role"] == "bridge":
                    length = 28 if v.id.endswith("arch") else 20
                    check(all(any(tree.ray_cast(Vector((0, float(y), 2)), Vector((0, 0, -1)), 2)[0]
                                  is not None for tree in trees) for y in np.linspace(-length * .49, length * .49, 65)),
                          v.id + " continuous deck supports 65 centre-line probes after compression")
                    floor_hits = [tree.ray_cast(Vector((x, y, 2)), Vector((0, 0, -1)), 2)[0]
                                  for x, y in ((.07, .11), (-.07, -.11), (0, 0)) for tree in trees]
                    floor_hits = [hit for hit in floor_hits if hit is not None]
                    check(bool(floor_hits), v.id + " bridge deck supports the biped footprint")
                    floor = max((hit.z for hit in floor_hits), default=.36)
                    check(all(any(tree.ray_cast(Vector((0, 0, floor + .55)), Vector((side, 0, 0)), 5)[0]
                                  is not None for tree in trees) for side in (-1, 1)),
                          v.id + " both physical guardrails stop an outward walk")
                if v.id == "prop_thalune_bench":
                    seats = [o for o in meshes if "_Seat_" in o.name]
                    seat_bounds = S.bounds(seats)
                    check(seat_bounds is not None and abs(seat_bounds[1][2] - .45) < .01,
                          v.id + " seating surface 0.45m high")
                    piers = [o for o in meshes if "_TidePier_" in o.name]
                    check(S.bounds(piers)[1][2] <= .35, v.id + " supports terminate beneath seating surface")
                for route in e["walkRoutes"]:
                    start, end = Vector(route["from"]), Vector(route["to"])
                    direction = (end - start).normalized()
                    right = Vector((direction.y, -direction.x, 0))
                    blocked = False
                    for t in np.linspace(0, 1, 25):
                        point = start.lerp(end, float(t))
                        floor = point.z
                        hits = [tree.ray_cast(Vector((point.x, point.y, 2.0)), Vector((0, 0, -1)), 2.1)[0] for tree in trees]
                        floors = [hit.z for hit in hits if hit is not None and hit.z < 1.6]
                        if floors:
                            floor = max(floors)
                        for h in (.2, 1.0, 2.0, route["height"] - .02):
                            origin = Vector((point.x, point.y, floor + h)) - right * (route["width"] / 2 - .02)
                            if any(tree.ray_cast(origin, right, route["width"] - .04)[0] is not None for tree in trees):
                                blocked = True
                        for offset in (-.49, 0, .49):
                            origin = Vector((point.x, point.y, floor + .20)) + right * (offset * route["width"])
                            if any(tree.ray_cast(origin, Vector((0, 0, 1)), route["height"] - .22)[0] is not None for tree in trees):
                                blocked = True
                    check(not blocked, v.id + " unobstructed declared-width and height public walk sweep")
                if e["padDiameter"]:
                    # All pad light/trim geometry must leave the specified circle clear above .32 m.
                    high_points = points[points[:, 2] > .32]
                    check(not len(high_points) or float(np.linalg.norm(high_points[:, :2], axis=1).min()) >= e["padDiameter"] / 2,
                          v.id + " full landing circle clear")
                if not a.exports:
                    e["sourceSha256"] = sha(source)
                else:
                    e["glbSha256"] = sha(path)
    data = {"task": "P1.E10.T05", "mode": "export" if a.exports else "source", "pass": not errors,
            "checkCount": len(checks), "failures": errors, "checks": checks, "validatorReports": reports}
    Path(a.report).write_text(json.dumps(data, indent=2) + "\n")
    manifest = {"schema": 1, "task": "P1.E10.T05", "people": "thalune", "capital": "Sarelun",
                "units": "metres", "sourceUp": "+Z", "glbUp": "+Y", "sourceFront": "-Y", "glbFront": "+Z",
                "base": "634c51d2378748c6a514af2a792ee4500b912643", "assets": entries,
                "placementContract": {"footIsRadius": True, "preserveAuthoredScale": True,
                   "selection": "class and variant map directly; reject slots smaller than footprintRadius. Keep the authored base at scale 1."
                   ,"plannerHeightConflict": "Planner classes use 34/95m thresholds, unlike the art bands. E10.T01 must select nominal-height art without scaling service doors or pads.",
                   "anchor": "Place independently in low-tide shoals per DESIGN 5.2. Current planner has dry city plains, not tidal canals.",
                   "plaza": "48m central council/Recall module inside the planner's 95-140m plaza radius; surrounding paving/canals belong to E10.T01.",
                   "renderer": "Select all four variants; import named COL meshes and point markers. Existing modulo-three models and cylinder collision are not this kit's integration."},
                "reviewGates": {"codeReview": "PENDING_PARENT", "blindVisualGrade": "PENDING_PARENT", "engineReview": "PENDING_GPU_SLOT", "performance": "NOT_MEASURED"}}
    (HOME / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"pass": not errors, "checks": len(checks), "failures": errors}))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
