"""Physical texels/metre on every rendered triangle, including the weaker surface direction."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import M, R, S, core, glb, sha
from pipeline import ROOT


def jacobians(points, uv, resolution):
    e1, e2 = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]
    length = np.linalg.norm(e1, axis=1)
    cross = np.linalg.norm(np.cross(e1, e2), axis=1)
    area = cross / 2
    valid = (area > 1e-14) & (length > 1e-14)
    x2 = np.sum(e1 * e2, axis=1) / np.maximum(length, 1e-30)
    y2 = cross / np.maximum(length, 1e-30)
    edge_uv = np.stack((uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]), axis=2)
    inverse = np.zeros((len(points), 2, 2))
    inverse[:, 0, 0] = 1 / np.maximum(length, 1e-30)
    inverse[:, 0, 1] = -x2 / np.maximum(length * y2, 1e-30)
    inverse[:, 1, 1] = 1 / np.maximum(y2, 1e-30)
    pixel_j = np.asarray(resolution)[None, :, None] * (edge_uv @ inverse)
    singular = np.zeros((len(points), 2))
    singular[valid] = np.linalg.svd(pixel_j[valid], compute_uv=False)
    return singular[:, 1], singular[:, 0], area, valid


def summarize(points, uv, resolution, target, labels):
    minor, major, area, valid = jacobians(points, uv, resolution)
    if not valid.any():
        return {
            "status": "FAIL",
            "reason": "no measurable visible surface",
            "targetTexelsPerMetre": target,
            "triangles": len(points),
            "nonzeroWorldAreaTriangles": 0,
            "zeroWorldAreaTriangles": len(points),
            "minorAxisMin": None,
            "undersampledTriangles": 0,
            "surfaceAreaSquareMetres": 0,
            "collapsedUVTriangles": 0,
        }
    bad = valid & (minor < target - 1e-5)
    order = np.argsort(minor[valid])
    weights = area[valid][order]
    cumulative = np.cumsum(weights) / weights.sum()
    ids = np.where(bad)[0]
    worst = ids[np.argsort(minor[ids])[:24]]
    return {
        "targetTexelsPerMetre": target,
        "triangles": len(points),
        "nonzeroWorldAreaTriangles": int(valid.sum()),
        "zeroWorldAreaTriangles": int((~valid).sum()),
        "surfaceAreaSquareMetres": float(area[valid].sum()),
        "minorAxisMin": float(minor[valid].min()),
        "minorAxisAreaWeightedP1P5P50P95P99": np.interp(
            [0.01, 0.05, 0.5, 0.95, 0.99], cumulative, minor[valid][order]
        ).tolist(),
        "majorAxisMax": float(major[valid].max()),
        "anisotropyP50P95P99Max": np.percentile(
            major[valid] / np.maximum(minor[valid], 1e-30), [50, 95, 99, 100]
        ).tolist(),
        "minorAxisHistogramThresholdMultiples": [
            0,
            0.5,
            1,
            1.25,
            2,
            4,
            16,
            100,
            "infinity",
        ],
        "minorAxisHistogramTriangles": np.histogram(
            minor[valid] / target, [0, 0.5, 1, 1.25, 2, 4, 16, 100, np.inf]
        )[0].tolist(),
        "undersampledTriangles": int(bad.sum()),
        "undersampledAreaSquareMetres": float(area[bad].sum()),
        "undersampledAreaFraction": float(area[bad].sum() / area[valid].sum()),
        "collapsedUVTriangles": int((valid & (minor < 1e-8)).sum()),
        "worstUndersampledFaces": [
            {
                "triangle": int(i),
                "material": labels[i],
                "minor": float(minor[i]),
                "major": float(major[i]),
                "area": float(area[i]),
                "positions": points[i].tolist(),
                "uv": uv[i].tolist(),
            }
            for i in worst
        ],
        "status": "FAIL" if bad.any() else "PASS",
    }


def source_rows(path, group):
    core.load(path)
    rules = R.load()
    model = S.collect_source(rules)
    S.assign_classes(rules, "cities", model)
    rows = []
    for asset in model.assets:
        for variant in asset.variants.values():
            for lod in range(4):
                xyz, uvs, sizes, labels = [], [], [], []
                for ob in S.render_meshes(rules, variant.lods[lod]):
                    if ob.modifiers or ob.data.shape_keys:
                        raise RuntimeError(
                            "apply modifiers/shape keys before density audit: "
                            + ob.name
                        )
                    me = ob.data
                    if len(me.uv_layers) != 1 or not me.uv_layers.active.active_render:
                        raise RuntimeError(
                            "requires one active render UV layer: " + ob.name
                        )
                    me.calc_loop_triangles()
                    coords = S.world_coords(ob)
                    active = np.array(
                        [x.uv[:] for x in me.uv_layers.active.data], dtype=np.float64
                    )
                    images = {}
                    for material in me.materials:
                        image = M.MaterialInfo(material).channels["baseColor"].image
                        if image is None:
                            raise RuntimeError(
                                "no actual base-color image: " + material.name
                            )
                        images[material.name] = list(image.size)
                    for tri in me.loop_triangles:
                        material = me.materials[tri.material_index]
                        xyz.append(coords[list(tri.vertices)])
                        uvs.append(active[list(tri.loops)])
                        sizes.append(images[material.name])
                        labels.append(material.name)
                # Each face's actual image resolution; normalize pixels to a unit image for the same Jacobian.
                pixel_uv = np.array(uvs) * np.array(sizes)[:, None, :]
                result = summarize(
                    np.array(xyz),
                    pixel_uv,
                    [1, 1],
                    512 if variant.cls == "prop" else 256,
                    labels,
                )
                result.update(
                    {
                        "asset": variant.id,
                        "class": variant.cls,
                        "lod": lod,
                        "group": group,
                        "uvCoordinatesInFailures": "pixels from actual image dimensions",
                        "normalizedUVBounds": [
                            np.array(uvs).min(axis=(0, 1)).tolist(),
                            np.array(uvs).max(axis=(0, 1)).tolist(),
                        ],
                    }
                )
                rows.append(result)
    return rows


def export_rows(path, group):
    js, binary = glb.read(path)
    materials = {}
    for mat in js["materials"]:
        info = mat["pbrMetallicRoughness"]["baseColorTexture"]
        texture = js["textures"][info["index"]]
        image = js["images"][texture["extensions"]["KHR_texture_basisu"]["source"]]
        view = js["bufferViews"][image["bufferView"]]
        offset = view.get("byteOffset", 0)
        import struct

        size = struct.unpack_from("<II", binary, offset + 20)
        materials[mat["name"]] = size
        if info.get("texCoord", 0) != 0 or info.get("extensions", {}).get(
            "KHR_texture_transform"
        ):
            raise RuntimeError(
                "density reader needs explicit non-default UV route support"
            )
    with tempfile.TemporaryDirectory(prefix="ulgani-density-") as tmp:
        out = Path(tmp) / "attributes.json"
        subprocess.run(
            [
                os.environ["ART_NODE"],
                str(HERE / "decode_meshopt.mjs"),
                str(path),
                str(out),
            ],
            check=True,
            timeout=120,
        )
        primitives = json.loads(out.read_text())
    grouped = {}
    for row in primitives:
        matrix = np.array(row["worldMatrix"]).reshape(4, 4).T
        p = np.array(row["positions"])
        p = (np.c_[p, np.ones(len(p))] @ matrix.T)[:, :3]
        indices = np.array(row["indices"]).reshape(-1, 3)
        uv = np.array(row["uv"]) * materials[row["material"]]
        bucket = grouped.setdefault(row["lod"], [[], [], [], [], set()])
        bucket[0].extend(p[indices])
        bucket[1].extend(uv[indices])
        bucket[2].extend([row["material"]] * len(indices))
        bucket[3].extend(np.array(row["uv"])[indices])
        bucket[4].add((row["uvComponentType"], row["uvNormalized"]))
    classes = {
        a["id"]: a["class"]
        for a in json.loads(
            (ROOT / "assets/blend/cities/ulgani/delivery-manifest-r02.json").read_text()
        )["assets"]
    }
    rows = []
    for name, (points, uvs, labels, normalized_uv, uv_types) in grouped.items():
        asset, lod = name.rsplit("_LOD", 1)
        cls = classes.get(asset, "prop" if group == "props" else "building")
        result = summarize(
            np.array(points),
            np.array(uvs),
            [1, 1],
            512 if cls == "prop" else 256,
            labels,
        )
        result.update(
            {
                "asset": asset,
                "class": cls,
                "lod": int(lod),
                "group": group,
                "uvCoordinatesInFailures": "pixels from actual KTX2 dimensions",
                "normalizedUVBounds": [
                    np.array(normalized_uv).min(axis=(0, 1)).tolist(),
                    np.array(normalized_uv).max(axis=(0, 1)).tolist(),
                ],
                "uvAccessorTypesAndNormalized": sorted(uv_types),
            }
        )
        rows.append(result)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--groups", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--source-only", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    result = {
        "method": "minimum and maximum singular values of pixel-UV Jacobian over an orthonormal world-triangle basis; all render triangles at every LOD, no unused vertices or UV-area padding",
        "failureThreshold": "256 px/m buildings/kits/landmarks; 512 px/m props; 0.00001 px/m floating arithmetic tolerance only",
        "files": [],
        "rows": [],
    }
    for group in args.groups.split(","):
        coverage = {}
        paths = [
            ("source", ROOT / f"assets/blend/cities/ulgani_{group}.blend", source_rows)
        ]
        if not args.source_only:
            paths.append(
                (
                    "export",
                    ROOT / f"packages/client/public/models/cities/ulgani_{group}.glb",
                    export_rows,
                )
            )
        for kind, path, reader in paths:
            before = sha(path)
            rows = reader(path, group)
            coverage[kind] = {(row["asset"], row["lod"]) for row in rows}
            result["files"].append(
                {"kind": kind, "path": str(path.relative_to(ROOT)), "sha256": before}
            )
            result["rows"].extend({"kind": kind, **row} for row in rows)
            assert sha(path) == before
        expected_ids = {
            row["asset"]
            for row in result["rows"]
            if row["group"] == group and row["kind"] == "source"
        }
        expected = {(asset, lod) for asset in expected_ids for lod in range(4)}
        if not expected or any(found != expected for found in coverage.values()):
            result.setdefault("coverageFailures", []).append(
                {
                    "group": group,
                    "expected": sorted(expected),
                    "actual": {k: sorted(v) for k, v in coverage.items()},
                }
            )
    result["status"] = (
        "PASS"
        if result["rows"]
        and not result.get("coverageFailures")
        and all(r["status"] == "PASS" for r in result["rows"])
        else "FAIL"
    )
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as f:
        json.dump(result, f, indent=2)
    print(
        result["status"],
        [
            (r["asset"], r["lod"], r["kind"], r["undersampledTriangles"])
            for r in result["rows"]
            if r["status"] != "PASS"
        ],
        flush=True,
    )
    return int(result["status"] != "PASS")


if __name__ == "__main__":
    sys.exit(main())
