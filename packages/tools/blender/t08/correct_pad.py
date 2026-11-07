"""Narrow saved pad-edge collision boxes; preserve the authored render geometry."""

import hashlib
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
from artlib import core


def render_digest():
    meshes = []
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if o.type != "MESH" or o.name.startswith("COL_"):
            continue
        meshes.append(
            {
                "name": o.name,
                "vertices": [list(v.co) for v in o.data.vertices],
                "faces": [list(p.vertices) for p in o.data.polygons],
                "uv": [[list(x.uv) for x in uv.data] for uv in o.data.uv_layers],
                "materials": [m.name for m in o.data.materials],
            }
        )
    return hashlib.sha256(json.dumps(meshes, sort_keys=True).encode()).hexdigest()


rows = []
for index in range(3):
    path = ROOT / f"assets/blend/sites/outpost_{index}.blend"
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    core.load(path)
    render_before = render_digest()
    count = 0
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(f"COL_outpost_{index}_PadEdge"):
            center = sum(
                (v.co for v in o.data.vertices), o.data.vertices[0].co * 0
            ) / len(o.data.vertices)
            for axis in [0, 1]:
                width = max(v.co[axis] for v in o.data.vertices) - min(
                    v.co[axis] for v in o.data.vertices
                )
                assert abs(width - 0.3) < 1e-5, (o.name, width)
                for vertex in o.data.vertices:
                    vertex.co[axis] = center[axis] + (
                        vertex.co[axis] - center[axis]
                    ) * (2 / 3)
            count += 1
    assert count == 15
    assert render_digest() == render_before
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    core.load(path)
    assert render_digest() == render_before
    rows.append(
        {
            "file": str(path.relative_to(ROOT)),
            "beforeSHA256": before,
            "afterSHA256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "unchangedRenderGeometrySHA256": render_before,
            "collidersCorrected": count,
        }
    )
with (HERE / "reports/pad-correction.json").open("x") as f:
    json.dump(rows, f, indent=2)
    f.write("\n")
