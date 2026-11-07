"""Measure loose vertices and quantized floor seams on actual low source/export."""

import json
import sys
from pathlib import Path

import numpy as np
from mathutils import Vector

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import ROOT, R, S, core, geometry, nearest_distance, tree

rules = R.load()
rows = []
source_geometry = {}
for kind, path in [
    ("source", ROOT / "assets/blend/cities/ulgani_low.blend"),
    ("export", ROOT / "packages/client/public/models/cities/ulgani_low.glb"),
]:
    report = core.validate_path(rules, path, family="cities")
    for asset in report.model.assets:
        for variant in asset.variants.values():
            for lod in range(4):
                geo = geometry(S.render_meshes(rules, variant.lods[lod]))
                used = np.unique(np.array(geo[1]).ravel())
                row = {
                    "kind": kind,
                    "asset": variant.id,
                    "lod": lod,
                    "vertices": len(geo[0]),
                    "surfaceVertices": len(used),
                    "unusedVertices": len(geo[0]) - len(used),
                }
                if kind == "source":
                    source_geometry[variant.id, lod] = geo[0][used]
                else:
                    row["surfaceSourceToExport"] = nearest_distance(
                        source_geometry[variant.id, lod], geo[0][used]
                    )
                rows.append(row)
            cols = [o for o in variant.all_objects() if S.is_collider(rules, o)]
            pts, faces, *_ = geometry(cols)
            bvh = tree(pts, faces)
            probes = []
            for x in (-1.35, 0, 1.35):
                for y in (0, -0.001, 0.001, -0.005, 0.005):
                    hit = bvh.ray_cast(Vector((x, y, 0.28)), Vector((0, 0, -1)), 0.45)
                    probes.append(
                        {
                            "x": x,
                            "y": y,
                            "hit": list(hit[0]) if hit[0] is not None else None,
                        }
                    )
            rows.append({"kind": kind, "asset": variant.id, "floorSeamProbes": probes})
out = ROOT / "assets/blend/cities/ulgani/audits/codec-diagnosis-r01.json"
with out.open("x") as f:
    json.dump(rows, f, indent=2)
