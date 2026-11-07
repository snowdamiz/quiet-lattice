"""Repair only polygons whose actually compressed visible triangles miss metric density."""

import argparse
import itertools
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).parent))
from audit import R, S, core, raw_geometry, sha
from density import jacobians
from pipeline import META, ROOT, inventory


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--group", required=True)
    p.add_argument("--attempt", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    group = a.group
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    export = ROOT / f"packages/client/public/models/cities/ulgani_{group}.glb"
    before = sha(source)
    export_hash = sha(export)
    data = json.loads((ROOT / inventory(group)).read_text())
    raw = raw_geometry(export)
    core.load(source)
    rules = R.load()
    model = S.collect_source(rules)
    S.assign_classes(rules, "cities", model)
    res = (
        1024 if group == "props" else 4096 if group in ("anchor", "landmarks") else 2048
    )
    records = []
    for asset in model.assets:
        for variant in asset.variants.values():
            target = 512 if variant.cls == "prop" else 256
            for lod in range(4):
                decoded = raw[f"{variant.id}_LOD{lod}"]
                ep = decoded[4].reshape(-1, 3, 3)
                eu = decoded[2].reshape(-1, 3, 2)
                minor, _, area, valid = jacobians(ep, eu, [res, res])
                bad = np.where(valid & (minor < target * 1.05))[0]
                if not len(bad):
                    continue
                objects = S.render_meshes(rules, variant.lods[lod])
                triangles = []
                for ob in objects:
                    me = ob.data
                    me.calc_loop_triangles()
                    xyz = S.world_coords(ob)
                    uv = np.array([x.uv[:] for x in me.uv_layers.active.data])
                    for tri in me.loop_triangles:
                        triangles.append(
                            (
                                ob,
                                tri.polygon_index,
                                xyz[list(tri.vertices)],
                                uv[list(tri.loops)],
                            )
                        )
                centers = np.array([r[2].mean(axis=0) for r in triangles])
                tree = KDTree(len(centers))
                for i, point in enumerate(centers):
                    tree.insert(Vector(point), i)
                tree.balance()
                tolerance = max(
                    0.0005,
                    float(np.linalg.norm(centers.max(0) - centers.min(0)))
                    / 16383
                    * 2.5,
                )
                scales = {}
                matches = []
                for i in bad:
                    choices = [
                        j
                        for _, j, _ in tree.find_range(
                            Vector(ep[i].mean(axis=0)), tolerance
                        )
                    ]
                    found = []
                    for j in choices:
                        ob, poly, sp, su = triangles[j]
                        for order in itertools.permutations(range(3)):
                            uv_error = float(np.max(np.abs(su[list(order)] - eu[i])))
                            pos_error = float(
                                np.linalg.norm(sp[list(order)] - ep[i], axis=1).max()
                            )
                            if uv_error < 0.0001 and pos_error < tolerance:
                                found.append((uv_error, ob, poly))
                                break
                    if not found:
                        raise RuntimeError(
                            f"unpaired decoded triangle {variant.id} LOD{lod} {i}"
                        )
                    best = min(r[0] for r in found)
                    found = [r for r in found if r[0] <= best + 1e-7]
                    scale = target * 1.25 / float(minor[i])
                    for _, ob, poly in found:
                        key = (ob.name, poly)
                        scales[key] = max(scales.get(key, 1), scale)
                    matches.append(
                        {
                            "decodedTriangle": int(i),
                            "beforeMinorDensity": float(minor[i]),
                            "decodedAreaSquareMetres": float(area[i]),
                            "matchedSourcePolygons": [
                                [ob.name, poly] for _, ob, poly in found
                            ],
                            "uvScale": scale,
                        }
                    )
                for (name, poly_index), scale in scales.items():
                    me = bpy.data.objects[name].data
                    ids = list(me.polygons[poly_index].loop_indices)
                    layer = me.uv_layers.active.data
                    uv = np.array([layer[i].uv[:] for i in ids])
                    uv = (uv - uv[0]) * scale + uv[0]
                    uv -= np.floor(uv.min(axis=0))
                    uv[:, 0] += 2
                    for i, value in zip(ids, uv, strict=True):
                        layer[i].uv = value
                records.append(
                    {
                        "asset": variant.id,
                        "lod": lod,
                        "polygonsChanged": len(scales),
                        "matchedDecodedTriangles": matches,
                        "maximumScale": max(scales.values()),
                    }
                )
    assert records
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    assert sha(export) == export_hash
    data["sha256"] = sha(source)
    with (META / f"inventory/{group}-codec-density-{a.attempt}.json").open("x") as f:
        json.dump(data, f, indent=2)
    with (META / f"density-revision/codec-margin-{group}-{a.attempt}.json").open(
        "x"
    ) as f:
        json.dump(
            {
                "group": group,
                "beforeSourceSHA256": before,
                "afterSourceSHA256": sha(source),
                "measuredExportSHA256": export_hash,
                "scope": "UVs of matched actual visible undersampled polygons only",
                "records": records,
            },
            f,
            indent=2,
        )


if __name__ == "__main__":
    main()
