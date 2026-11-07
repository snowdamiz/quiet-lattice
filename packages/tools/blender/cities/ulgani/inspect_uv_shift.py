"""Read actual corner discrepancies before choosing a preservation correction."""

import json
import sys
from pathlib import Path

import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).parent))
from audit import R, S, core, geometry, raw_geometry, sha
from pipeline import META, ROOT

source = ROOT / "assets/blend/cities/ulgani_tall.blend"
export = ROOT / "packages/client/public/models/cities/ulgani_tall.glb"
raw = raw_geometry(export)
core.load(source)
rules = R.load()
model = S.collect_source(rules)
rows = []
for asset in model.assets:
    for v in asset.variants.values():
        s = geometry(S.render_meshes(rules, v.lods[1]))
        e = raw[v.id + "_LOD1"]
        tol = float(np.linalg.norm(s[0].max(0) - s[0].min(0))) / 16383 * 2.5
        kd = KDTree(len(s[4]))
        for i, p in enumerate(s[4]):
            kd.insert(Vector(p), i)
        kd.balance()
        count = 0
        for i, (p, uv, n) in enumerate(zip(e[4], e[2], e[3], strict=True)):
            choices = [j for _, j, _ in kd.find_range(Vector(p), tol * 1.1)]
            du = np.linalg.norm(s[2][choices] - uv, axis=1)
            if du.min() > 0.002:
                j = choices[int(du.argmin())]
                rows.append(
                    {
                        "asset": v.id,
                        "exportCorner": i,
                        "position": p.tolist(),
                        "sourcePosition": s[4][j].tolist(),
                        "uv": uv.tolist(),
                        "sourceUV": s[2][j].tolist(),
                        "normal": n.tolist(),
                        "sourceNormal": s[3][j].tolist(),
                        "minimumUVError": float(du.min()),
                        "nearbySourceUVs": s[2][choices].tolist(),
                    }
                )
                count += 1
                if count == 6:
                    break
with (META / "density-revision/uv-discrepancy-d01.json").open("x") as f:
    json.dump(
        {"sourceSHA256": sha(source), "exportSHA256": sha(export), "rows": rows},
        f,
        indent=2,
    )
print(json.dumps(rows[:2]))
