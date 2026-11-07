"""Read saved/decoded geometry, never the authoring recipe. Full metric UV and contract census."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
from artlib import core, scene as S, rules as R, materials as M


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def weighted_percentile(values, weights, q):
    order = np.argsort(values)
    v = values[order]
    w = weights[order]
    return float(v[np.searchsorted(np.cumsum(w), q * w.sum(), side="left")])


def density(objects, target):
    samples = []
    weights = []
    degenerate = 0
    uvzero = 0
    excluded = {}
    materials = {}
    for o in objects:
        me = o.data
        me.calc_loop_triangles()
        coords = S.world_coords(o)
        uv = me.uv_layers.active
        for tri in me.loop_triangles:
            mat = o.material_slots[tri.material_index].material
            info = M.MaterialInfo(mat)
            img = info.channels["baseColor"].image
            if img is None:
                excluded[mat.name] = excluded.get(mat.name, 0) + 1
                continue
            assert uv is not None, (o.name, "missing UV")
            xyz = coords[list(tri.vertices)]
            area = np.linalg.norm(np.cross(xyz[1] - xyz[0], xyz[2] - xyz[0])) * 0.5
            if area < 1e-14:
                degenerate += 1
                continue
            tuv = np.array(
                [uv.data[j].uv[:] for j in tri.loops], dtype=float
            ) * np.array(img.size)
            delta = tuv[1:] - tuv[0]
            texarea = abs(delta[0, 0] * delta[1, 1] - delta[0, 1] * delta[1, 0]) * 0.5
            if texarea < 1e-14:
                uvzero += 1
            samples.append((texarea / area) ** 0.5)
            weights.append(area)
            materials[mat.name] = {
                "image": img.name,
                "resolution": list(img.size),
                "uv": uv.name,
            }
    values = np.array(samples)
    areas = np.array(weights)
    assert len(values) > 0, "no textured surface measured"
    below = float(areas[values < target * 0.97].sum() / areas.sum())
    result = {
        "targetPxM": target,
        "texturedTriangles": len(samples),
        "worldAreaM2": float(areas.sum()),
        "weightedMeanPxM": float(np.average(values, weights=areas)),
        "minPxM": float(values.min()),
        "p01PxM": weighted_percentile(values, areas, 0.01),
        "p05PxM": weighted_percentile(values, areas, 0.05),
        "medianPxM": weighted_percentile(values, areas, 0.5),
        "p95PxM": weighted_percentile(values, areas, 0.95),
        "maxPxM": float(values.max()),
        "areaBelow97PercentTarget": below,
        "zeroUVTriangles": uvzero,
        "zeroWorldTriangles": degenerate,
        "exemptConstantMaterialTriangles": excluded,
        "materials": materials,
    }
    # Quantized tiny fasteners can move a fraction of a texel; retain their actual extrema.
    result["pass"] = (
        below < 0.005
        and result["weightedMeanPxM"] >= target * 0.995
        and degenerate == 0
    )
    return result


def inspect(item, mode):
    family, stem = item["family"], item["stem"]
    source = ROOT / "assets/blend" / family / (stem + ".blend")
    path = (
        source
        if mode == "source"
        else ROOT / "packages/client/public/models" / family / (stem + ".glb")
    )
    core.load(path)
    rules = R.load()
    model = S.collect_source(rules) if mode == "source" else S.collect_export(rules)
    S.assign_classes(rules, family, model)
    assert [a.name for a in model.assets] == [stem]
    asset = model.assets[0]
    assert not asset.class_override
    assert sorted(asset.variants) == sorted(item["variants"])
    rows = []
    for vid, v in asset.variants.items():
        assert v.cls == item["class"]
        assert sorted(v.lods) == [0, 1, 2, 3]
        all_objects = v.all_objects()
        cols = [o for o in all_objects if S.is_collider(rules, o)]
        interact = [o for o in all_objects if R.strip(o.name).startswith("Interact")]
        assert cols and interact, (vid, "missing collider/use marker")
        assert all(S.tri_count(o) <= 512 for o in cols)
        lods = {}
        for level, objects in sorted(v.lods.items()):
            meshes = S.render_meshes(rules, objects)
            lods[level] = {
                "triangles": sum(S.tri_count(o) for o in meshes),
                "density": density(meshes, item["density"]),
                "objects": [o.name for o in meshes],
            }
        counts = [lods[k]["triangles"] for k in range(4)]
        assert (
            all(counts[i] > counts[i + 1] for i in range(3))
            and counts[3] < 0.05 * counts[0]
        )
        lo, hi = S.bounds(S.render_meshes(rules, v.lods[0]))
        row = {
            "variant": vid,
            "class": v.cls,
            "dimensionsM": list(hi - lo),
            "lods": lods,
            "colliders": [],
            "markers": [
                {"name": o.name, "position": list(o.matrix_world.translation)}
                for o in interact
            ],
            "pass": all(x["density"]["pass"] for x in lods.values()),
        }
        for o in cols:
            b = S.bounds([o])
            row["colliders"].append(
                {
                    "name": o.name,
                    "triangles": S.tri_count(o),
                    "min": list(b[0]),
                    "max": list(b[1]),
                }
            )
        for o in all_objects:
            if R.strip(o.name).startswith("Light_"):
                assert all(k in o for k in ["color", "intensity", "distance"])
            if R.strip(o.name).startswith("Blink"):
                assert o.type == "EMPTY" and any(ch.type == "MESH" for ch in o.children)
        if stem.startswith("outpost"):
            doors = [
                o
                for o in S.render_meshes(rules, v.lods[0])
                if o.name.startswith("Door")
            ]
            assert len(doors) == 1, (stem, "exact service-door mesh")
            b = S.bounds(doors)
            dims = b[1] - b[0]
            assert dims[2] >= 2.4 and max(dims[0], dims[1]) >= 1.4
            row["doorDimensionsM"] = list(dims)
            row["padInscribedDiametersM"] = {}
            for level, lod_objects in sorted(v.lods.items()):
                pad = next(
                    o
                    for o in S.render_meshes(rules, lod_objects)
                    if "Clear24mLandingSurface" in o.name
                )
                # The pad is a closed circular prism. Infer the inner radius from its actual outer vertices.
                points = S.world_coords(pad)
                adjacency = {i: set() for i in range(len(points))}
                for edge in pad.data.edges:
                    i, j = edge.vertices
                    adjacency[i].add(j)
                    adjacency[j].add(i)
                unseen = set(adjacency)
                components = []
                while unseen:
                    todo = [unseen.pop()]
                    component = []
                    while todo:
                        i = todo.pop()
                        component.append(i)
                        new = adjacency[i] & unseen
                        unseen -= new
                        todo.extend(new)
                    components.append(component)
                ring = points[max(components, key=len), :2]
                unique = np.unique(np.round(ring, 7), axis=0)
                theta = np.arctan2(unique[:, 1], unique[:, 0])
                ring = unique[np.argsort(theta)]
                inner = []
                for p0, p1 in zip(ring, np.roll(ring, -1, axis=0)):
                    d = p1 - p0
                    inner.append(abs(p0[0] * p1[1] - p0[1] * p1[0]) / np.linalg.norm(d))
                diameter = float(min(inner) * 2)
                row["padInscribedDiametersM"][level] = diameter
                assert diameter >= 24, (vid, level, diameter)
            row["padInscribedDiameterM"] = row["padInscribedDiametersM"][0]
            distances = []
            for c in row["colliders"]:
                # Minimum distance to the complete AABB footprint, including corners.
                nearest = np.maximum(
                    np.maximum(c["min"][:2], -np.array(c["max"][:2])), 0
                )
                distance = float(np.linalg.norm(nearest))
                distances.append(distance)
                assert distance >= 12, (vid, c["name"], distance)
            row["minimumColliderDistanceFromPadCenterM"] = min(distances)
            for point in interact:
                q = np.array(point.matrix_world.translation)
                assert not any(
                    np.all(q >= np.array(c["min"])) and np.all(q <= np.array(c["max"]))
                    for c in row["colliders"]
                )
        rows.append(row)
    return {
        "file": str(path.relative_to(ROOT)),
        "sha256": sha(path),
        "sourceSHA256": sha(source),
        "mode": mode,
        "variants": rows,
        "pass": all(r["pass"] for r in rows),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["source", "export"], required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--only")
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    entries = json.loads((HERE / "inventory.json").read_text())
    results = []
    for item in entries:
        if args.only and item["stem"] not in args.only.split(","):
            continue
        r = inspect(item, args.mode)
        results.append(r)
        print(item["stem"], "PASS" if r["pass"] else "FAIL", flush=True)
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x") as f:
        json.dump(
            {"files": results, "pass": all(r["pass"] for r in results)}, f, indent=2
        )
        f.write("\n")
    return 0 if all(r["pass"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
