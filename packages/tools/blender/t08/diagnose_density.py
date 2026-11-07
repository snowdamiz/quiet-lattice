"""Identify actual decoded components with undersampled or collapsed triangles."""

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit import ROOT, HERE, core, R, S, density

rules = R.load()
rows = []
for family, stem in [
    ("props", "catalyst_vial"),
    ("props", "crash_debris"),
    ("sites", "beacon_0"),
]:
    core.load(ROOT / "packages/client/public/models" / family / (stem + ".glb"))
    model = S.collect_export(rules)
    for a in model.assets:
        for v in a.variants.values():
            for o in S.render_meshes(rules, v.lods[0]):
                try:
                    d = density([o], 512 if family == "props" else 256)
                except AssertionError:
                    continue
                if not d["pass"]:
                    row = {
                        k: d[k]
                        for k in [
                            "weightedMeanPxM",
                            "areaBelow97PercentTarget",
                            "zeroUVTriangles",
                            "zeroWorldTriangles",
                        ]
                    }
                    row["object"] = o.name
                    rows.append(row)
                    print(row, flush=True)
(HERE / "reports/density-components-r4.json").write_text(
    json.dumps(rows, indent=2) + "\n"
)
