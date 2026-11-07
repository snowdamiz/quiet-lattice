"""Read actual saved sources and imported exports; never save or author geometry."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True
HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parents[3]
sys.path.insert(0, str(HOME / "authoring"))
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules as R, scene as S, checks as C
from audit import collider_tree
from clearance import probe_route

output = Path(sys.argv[sys.argv.index("--") + 1])
if output.exists():
    raise FileExistsError(output)
manifest_path = HOME / "manifest.json"
manifest = json.loads(manifest_path.read_text())
rules = R.load()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
results = {"manifestSha256": sha(manifest_path), "files": []}
for mode in ("source", "glb"):
    for rel in dict.fromkeys(e[mode] for e in manifest["assets"]):
        core.load(ROOT / rel)
        bpy.context.scene.render.engine = "CYCLES"
        bpy.context.scene.cycles.device = "CPU"
        bpy.context.scene.render.threads_mode = "FIXED"
        bpy.context.scene.render.threads = 2
        model = S.collect_source(rules) if mode == "source" else S.collect_export(rules)
        row = {"path": rel, "mode": mode, "sha256": sha(ROOT / rel), "assets": {}, "sourceORM": []}
        for asset in model.assets:
            for variant in asset.variants.values():
                e = next(e for e in manifest["assets"] if e["id"] == variant.id)
                trees = [(R.strip(o.name), collider_tree(o)) for o in variant.all_objects() if S.is_collider(rules, o)]
                row["assets"][variant.id] = {"lodTriangles": [C.lod_tris(rules, variant)[n] for n in range(4)],
                                             "routes": [probe_route(trees, route) for route in e["walkRoutes"]]}
        if mode == "source":
            for im in bpy.data.images:
                if not im.name.endswith("_ORM"):
                    continue
                w, h = im.size
                arr = np.empty(w * h * 4, dtype=np.float32)
                im.pixels.foreach_get(arr)
                arr = arr.reshape(h, w, 4)
                bronze = arr[4*h//8:5*h//8, :, :]
                row["sourceORM"].append({"image": im.name, "dimensions": [w, h], "colorspace": im.colorspace_settings.name,
                    "pixelSha256Float32": hashlib.sha256(arr.tobytes()).hexdigest(),
                    "bronzeMinimum": float(bronze[:, :, 1].min()), "bronzeMetallicRange": [float(bronze[:, :, 2].min()), float(bronze[:, :, 2].max())]})
        results["files"].append(row)
output.write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps({"files": len(results["files"]), "routeFailures": [(r["path"], a) for r in results["files"] for a, v in r["assets"].items() if any(not t["pass"] for t in v["routes"])]}))
