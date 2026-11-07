"""Keep walk-wear on polygons entirely within the actual central walking strip."""

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import R, S, core, sha
from pipeline import META, ROOT, inventory

p = argparse.ArgumentParser()
p.add_argument("--group", required=True)
p.add_argument("--attempt", required=True)
a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
source = ROOT / f"assets/blend/cities/ulgani_{a.group}.blend"
before = sha(source)
data = json.loads((ROOT / inventory(a.group)).read_text())
core.load(source)
rules = R.load()
model = S.collect_source(rules)
S.assign_classes(rules, "cities", model)
records = []
for asset in model.assets:
    for variant in asset.variants.values():
        if variant.cls == "prop":
            continue
        for lod in range(4):
            for ob in S.render_meshes(rules, variant.lods[lod]):
                me = ob.data
                walk = next(
                    i for i, m in enumerate(me.materials) if m.name.endswith("_Walk")
                )
                worn = next(
                    i
                    for i, m in enumerate(me.materials)
                    if m.name.endswith("_WalkWorn")
                )
                xyz = S.world_coords(ob)
                changed = []
                for poly in me.polygons:
                    if (
                        poly.material_index == worn
                        and np.max(np.abs(xyz[list(poly.vertices), 0])) > 1.4
                    ):
                        poly.material_index = walk
                        changed.append(poly.index)
                records.append(
                    {
                        "asset": variant.id,
                        "lod": lod,
                        "object": ob.name,
                        "correctedPolygons": changed,
                    }
                )
changed = any(r["correctedPolygons"] for r in records)
if changed:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
data["sha256"] = sha(source)
with (META / f"inventory/{a.group}-walk-{a.attempt}.json").open("x") as f:
    json.dump(data, f, indent=2)
with (META / f"density-revision/walk-{a.group}-{a.attempt}.json").open("x") as f:
    json.dump(
        {
            "beforeSHA256": before,
            "afterSHA256": sha(source),
            "changed": changed,
            "scope": "WalkWorn to Walk material index only where polygon extends outside +/-1.4m walking band",
            "records": records,
        },
        f,
        indent=2,
    )
