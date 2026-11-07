"""Replace excessive UV stretch with compact growth-aligned metric polygon charts."""

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import R, S, core, sha
from density import jacobians
from pipeline import META, ROOT, inventory
from restore_polygon_normals import metric_polygon

p = argparse.ArgumentParser()
p.add_argument("--group", required=True)
p.add_argument("--attempt", required=True)
a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
group = a.group
source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
before = sha(source)
data = json.loads((ROOT / inventory(group)).read_text())
core.load(source)
rules = R.load()
model = S.collect_source(rules)
S.assign_classes(rules, "cities", model)
res = 1024 if group == "props" else 4096 if group in ("anchor", "landmarks") else 2048
records = []
for asset in model.assets:
    for variant in asset.variants.values():
        target = 512 if variant.cls == "prop" else 256
        for lod in range(4):
            for ob in S.render_meshes(rules, variant.lods[lod]):
                me = ob.data
                me.calc_loop_triangles()
                points = S.world_coords(ob)
                uv = np.array([x.uv[:] for x in me.uv_layers.active.data])
                changed = []
                bypoly = {}
                for tri in me.loop_triangles:
                    bypoly.setdefault(tri.polygon_index, []).append(tri)
                for poly in me.polygons:
                    tris = bypoly[poly.index]
                    loop_ids = list(poly.loop_indices)
                    local = {v: i for i, v in enumerate(loop_ids)}
                    indices = np.array([[local[l] for l in t.loops] for t in tris])
                    xyz = points[list(poly.vertices)]
                    chart = uv[loop_ids]
                    minor, major, _, valid = jacobians(
                        xyz[indices], chart[indices], [res, res]
                    )
                    max_major = float(major[valid].max())
                    anisotropy = float(np.max(major[valid] / minor[valid]))
                    extent = float(np.ptp(chart, axis=0).max())
                    if max_major <= target * 8 and anisotropy <= 4 and extent <= 128:
                        continue
                    new = metric_polygon(xyz, indices, res, target, preferred_uv=chart)
                    new -= np.floor(new.min(0))
                    new[:, 0] += 2
                    uv[loop_ids] = new
                    changed.append(
                        {
                            "polygon": poly.index,
                            "beforeMajorDensityMax": max_major,
                            "beforeAnisotropyMax": anisotropy,
                            "beforeUVExtent": extent,
                        }
                    )
                if changed:
                    me.uv_layers.active.data.foreach_set(
                        "uv", uv.astype(np.float32).ravel()
                    )
                measured = np.array([x.uv[:] for x in me.uv_layers.active.data])
                corners = np.array([t.loops[:] for t in me.loop_triangles])
                vertices = np.array([t.vertices[:] for t in me.loop_triangles])
                minor, major, _, valid = jacobians(
                    points[vertices], measured[corners], [res, res]
                )
                assert minor[valid].min() >= target
                records.append(
                    {
                        "asset": variant.id,
                        "lod": lod,
                        "object": ob.name,
                        "changedPolygons": changed,
                        "minimumDensity": float(minor[valid].min()),
                        "maximumDensity": float(major[valid].max()),
                        "maxAbsUV": float(np.abs(measured).max()),
                        "maxAnisotropy": float(np.max(major[valid] / minor[valid])),
                    }
                )
assert any(r["changedPolygons"] for r in records)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
data["sha256"] = sha(source)
with (META / f"inventory/{group}-bounded-density-{a.attempt}.json").open("x") as f:
    json.dump(data, f, indent=2)
with (META / f"density-revision/bounded-{group}-{a.attempt}.json").open("x") as f:
    json.dump(
        {
            "group": group,
            "beforeSHA256": before,
            "afterSHA256": sha(source),
            "scope": "UV charts only; metric planar projection aligned with prior U/V growth directions",
            "records": records,
        },
        f,
        indent=2,
    )
