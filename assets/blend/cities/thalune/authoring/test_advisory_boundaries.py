"""Real named Hinge Court source/GLB boundary mutations; in-memory only, no saves."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True
HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parents[3]
sys.path.insert(0, str(HOME / "authoring"))
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules as R, scene as S
from audit import collider_tree
from clearance import probe_route

out = Path(sys.argv[sys.argv.index("--") + 1])
if out.exists():
    raise FileExistsError(out)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = HOME / "manifest.json"
entry = next(a for a in json.loads(manifest.read_text())["assets"] if a["id"] == "thalune_low_0")
rules = R.load()
report = {"manifestSha256": sha(manifest), "asset": entry["id"], "files": []}
for mode in ("source", "glb"):
    path = ROOT / entry[mode]
    before = sha(path)
    core.load(path)
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    model = S.collect_source(rules) if mode == "source" else S.collect_export(rules)
    variant = next(v for a in model.assets for v in a.variants.values() if v.id == entry["id"])
    colliders = [o for o in variant.all_objects() if S.is_collider(rules, o)]
    trees = [(R.strip(o.name), collider_tree(o)) for o in colliders]
    route = entry["walkRoutes"][0]
    measured = probe_route(trees, route)
    ceiling = measured["minimumSampledCeiling"]
    tests = {"certifiedFullExtentAccepted": measured["pass"],
        "historical3_2Rejected": not probe_route(trees, {**route, "height": 3.2})["pass"],
        "halfMillimetreBelowMeasuredAccepted": probe_route(trees, {**route, "height": ceiling - .0005})["pass"],
        "halfMillimetreAboveMeasuredRejected": not probe_route(trees, {**route, "height": ceiling + .0005})["pass"],
        "certifiedPlusOneMillimetreRejected": not probe_route(trees, {**route, "height": route["height"] + .001})["pass"],
        "minimum2_4By1_4Accepted": probe_route(trees, {**route, "height": 2.4, "width": 1.4})["pass"]}
    limiting = measured["limitingWitness"]["collider"]
    roof = next(o for o in colliders if R.strip(o.name) == limiting)
    old_matrix = roof.matrix_world.copy()
    roof.matrix_world.translation.z -= .01
    bpy.context.view_layer.update()
    lowered = [(R.strip(o.name), collider_tree(o)) for o in colliders]
    tests["actualRoofLoweredOneCentimetreRejected"] = not probe_route(lowered, route)["pass"]
    roof.matrix_world = old_matrix
    bpy.context.view_layer.update()
    tests["restoredGeometryAccepted"] = probe_route([(R.strip(o.name), collider_tree(o)) for o in colliders], route)["pass"]
    tests["savedBytesUnchanged"] = before == sha(path)
    report["files"].append({"path": entry[mode], "sha256": before, "mode": mode, "measured": measured, "mutatedCollider": limiting, "tests": tests})
report["pass"] = all(all(f["tests"].values()) for f in report["files"])
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"pass": report["pass"], "tests": sum(len(f["tests"]) for f in report["files"]), "failures": [(f["mode"], k) for f in report["files"] for k, v in f["tests"].items() if not v]}))
raise SystemExit(0 if report["pass"] else 1)
