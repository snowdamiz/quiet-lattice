"""Measure saved sources and actually decoded KTX2/Meshopt exports; no authoring imports."""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, glb, ktx
from artlib import materials as M
from artlib import rules as R
from artlib import scene as S


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def geometry(objects):
    points = []
    faces = []
    uv = []
    normals = []
    corner_positions = []
    for ob in objects:
        me = ob.data
        me.calc_loop_triangles()
        start = len(points)
        pts = S.world_coords(ob)
        points.extend(pts.tolist())
        corner_positions.extend(pts[loop.vertex_index].tolist() for loop in me.loops)
        for t in me.loop_triangles:
            faces.append([start + i for i in t.vertices])
        if me.uv_layers:
            values = np.empty(len(me.loops) * 2, np.float32)
            me.uv_layers.active.data.foreach_get("uv", values)
            uv.extend(values.reshape(-1, 2).tolist())
        normal_matrix = ob.matrix_world.to_3x3().inverted().transposed()
        normals.extend(
            [list((normal_matrix @ n.vector).normalized()) for n in me.corner_normals]
        )
    return (
        np.array(points),
        faces,
        np.array(uv),
        np.array(normals),
        np.array(corner_positions),
    )


def tree(points, faces):
    return BVHTree.FromPolygons([Vector(p) for p in points], faces, all_triangles=True)


def inside_closed(bvh, point):
    direction = Vector((0.83, 0.37, 0.41)).normalized()
    origin = Vector(point)
    for hits in range(64):
        position, _, _, _ = bvh.ray_cast(origin, direction)
        if position is None:
            return hits % 2 == 1
        origin = position + direction * 0.0001
    raise RuntimeError("collider parity ray did not terminate")


def sample_route(bvh, route, ground, solid=False, solids=None):
    a, b = np.array(route["from"]), np.array(route["to"])
    d = b - a
    across = np.array([-d[1], d[0], 0.0])
    across /= max(np.linalg.norm(across), 1e-6)
    blocked = []
    unsupported = []
    seam_support = 0
    for t in np.linspace(0, 1, max(5, int(np.linalg.norm(d) / 0.8) + 1)):
        # Ten millimetres inside an adjoining module avoids a ray exactly on a shared triangle edge.
        t = float(
            np.clip(
                t,
                0.01 / max(np.linalg.norm(d), 1),
                1 - 0.01 / max(np.linalg.norm(d), 1),
            )
        )
        section = across
        if "fromAcross" in route:
            section = (
                np.array(route["fromAcross"]) * (1 - t)
                + np.array(route["toAcross"]) * t
            )
            section /= np.linalg.norm(section)
        for side in (-0.45, 0, 0.45):
            p = a * (1 - t) + b * t + section * route["width"] * side
            hit = bvh.ray_cast(
                Vector(p + np.array((0, 0, 0.20))),
                Vector((0, 0, 1)),
                route["height"] - 0.20,
            )
            inside = False
            if solid:
                for z in (0.22, 1.0, 1.8):
                    test = Vector(p + np.array((0, 0, z)))
                    if solids is None:
                        inside = inside or inside_closed(bvh, test)
                    else:
                        for cb, lo, hi in solids:
                            if np.all(np.array(test) > lo) and np.all(
                                np.array(test) < hi
                            ):
                                inside = inside or inside_closed(cb, test)
            if hit[0] is not None or inside:
                blocked.append(list(p))
            if ground:
                hit = bvh.ray_cast(
                    Vector(p + np.array((0, 0, 0.1))), Vector((0, 0, -1)), 0.45
                )
                if hit[0] is None:
                    # Independently quantized touching colliders can open sub-millimetre seams.
                    # Probe only a 5 mm footprint, far below the 0.4 m player radius.
                    offsets = (
                        (0.005, 0, 0.1),
                        (-0.005, 0, 0.1),
                        (0, 0.005, 0.1),
                        (0, -0.005, 0.1),
                        (0.0035, 0.0035, 0.1),
                        (-0.0035, 0.0035, 0.1),
                        (0.0035, -0.0035, 0.1),
                        (-0.0035, -0.0035, 0.1),
                    )
                    supported = any(
                        bvh.ray_cast(
                            Vector(p + np.array(offset)), Vector((0, 0, -1)), 0.45
                        )[0]
                        is not None
                        for offset in offsets
                    )
                    if supported:
                        seam_support += 1
                    else:
                        unsupported.append(list(p))
    return {
        "blocked": len(blocked),
        "unsupported": len(unsupported),
        "examples": (blocked + unsupported)[:5],
        "allowedStepMetres": 0.18,
        "connectorInsetMetres": 0.01,
        "supportProbeRadiusMetres": 0.005,
        "seamSupportedSamples": seam_support,
    }


def loaded_asset(rules, variant, inventory):
    result = {"id": variant.id, "class": variant.cls, "lods": [], "markers": []}
    geometries = []
    for lod in range(4):
        objs = S.render_meshes(rules, variant.lods[lod])
        pts, faces, uv, normals, corners = geometry(objs)
        geometries.append((pts, faces, uv, normals, corners))
        bounds = [pts.min(0).tolist(), pts.max(0).tolist()]
        result["lods"].append(
            {
                "triangles": len(faces),
                "vertices": len(pts),
                "surfaceVertices": len(np.unique(np.array(faces).ravel())),
                "unusedVertices": len(pts) - len(np.unique(np.array(faces).ravel())),
                "corners": len(uv),
                "bounds": bounds,
                "uvMin": uv.min(0).tolist(),
                "uvMax": uv.max(0).tolist(),
                "normalLengthMin": float(np.linalg.norm(normals, axis=1).min()),
                "geometryHash": hashlib.sha256(
                    np.round(pts, 5).tobytes() + np.array(faces).tobytes()
                ).hexdigest(),
            }
        )
    pts, faces, _, _, _ = geometries[0]
    bvh = tree(pts, faces)
    cols = [o for o in variant.all_objects() if S.is_collider(rules, o)]
    cp, cf, _, _, _ = geometry(cols)
    cbvh = tree(cp, cf)
    solids = []
    for ob in cols:
        points, faces, *_ = geometry([ob])
        solids.append((tree(points, faces), points.min(0), points.max(0)))
    distances = [bvh.find_nearest(Vector(p))[3] for p in cp]
    collider_stats = {
        "objects": len(cols),
        "triangles": len(cf),
        "maxObjectTriangles": max(S.tri_count(o) for o in cols),
        "nearestSurfaceMax": max(distances),
        "nearestSurfaceP95": float(np.quantile(distances, 0.95)),
    }
    result["collision"] = collider_stats
    result["walkRoutes"] = []
    for route in inventory.get("walkRoutes", []):
        need_floor = route["from"][2] > 0.1
        result["walkRoutes"].append(
            {
                "route": route,
                "visual": sample_route(bvh, route, need_floor),
                "collision": sample_route(
                    cbvh, route, need_floor, solid=True, solids=solids
                ),
            }
        )
    for o in variant.all_objects():
        if o.type == "EMPTY" and (
            o.name.startswith("Interact") or o.name.startswith("Light_")
        ):
            result["markers"].append(
                {
                    "name": R.strip(o.name),
                    "position": list(o.matrix_world.translation),
                    "nearestVisualSurface": bvh.find_nearest(
                        o.matrix_world.translation
                    )[3],
                    "properties": {k: o[k] for k in o.keys() if k != "_RNA_UI"},  # noqa: SIM118 - Blender ID properties require keys()
                }
            )
    return result, geometries


def nearest_distance(a, b):
    kd = KDTree(len(b))
    for i, p in enumerate(b):
        kd.insert(Vector(p), i)
    kd.balance()
    distances = np.array([kd.find(Vector(p))[2] for p in a])
    return {
        "max": float(distances.max()),
        "p99": float(np.quantile(distances, 0.99)),
        "mean": float(distances.mean()),
    }


def raw_geometry(path):
    with tempfile.TemporaryDirectory(prefix="ulgani-attributes-") as directory:
        output = Path(directory) / "attributes.json"
        subprocess.run(
            [
                "node",
                str(Path(__file__).with_name("decode_meshopt.mjs")),
                str(path),
                str(output),
            ],
            check=True,
            timeout=120,
        )
        rows = json.loads(output.read_text())
    grouped = {}
    for row in rows:
        matrix = np.array(row["worldMatrix"]).reshape(4, 4).T
        points = np.array(row["positions"])
        points = np.c_[points, np.ones(len(points))] @ matrix.T
        points = points[:, [0, 2, 1]] * (1, -1, 1)
        normals = np.array(row["normals"]) @ np.linalg.inv(matrix[:3, :3])
        normals = normals[:, [0, 2, 1]] * (1, -1, 1)
        normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        uv = np.array(row["uv"])
        uv[:, 1] = 1 - uv[:, 1]
        indices = np.array(row["indices"])
        grouped.setdefault(row["lod"], []).append(
            (
                points,
                indices.reshape(-1, 3),
                uv[indices],
                normals[indices],
                points[indices],
            )
        )
    result = {}
    for name, pieces in grouped.items():
        points, faces, uvs, normals, corners = [], [], [], [], []
        for p, f, u, n, c in pieces:
            faces.extend((f + len(points)).tolist())
            points.extend(p.tolist())
            uvs.extend(u.tolist())
            normals.extend(n.tolist())
            corners.extend(c.tolist())
        result[name] = (
            np.array(points),
            faces,
            np.array(uvs),
            np.array(normals),
            np.array(corners),
        )
    return result


def paired_attributes(source, exported, tolerance):
    kd = KDTree(len(source[4]))
    for i, p in enumerate(source[4]):
        kd.insert(Vector(p), i)
    kd.balance()
    uv_errors = []
    normal_errors = []
    missing = 0
    for p, uv, normal in zip(exported[4], exported[2], exported[3]):
        choices = [i for _, i, _ in kd.find_range(Vector(p), tolerance * 1.1)]
        if not choices:
            missing += 1
            choices = [kd.find(Vector(p))[1]]
        du = np.linalg.norm(source[2][choices] - uv, axis=1)
        dn = np.linalg.norm(source[3][choices] - normal, axis=1)
        best = int(np.argmin(np.maximum(du / 0.002, dn / 0.045)))
        uv_errors.append(float(du[best]))
        normal_errors.append(float(dn[best]))

    def summary(values):
        return {
            "max": max(values),
            "p99": float(np.quantile(values, 0.99)),
            "mean": float(np.mean(values)),
        }

    return {
        "spatiallyUnmatchedCorners": missing,
        "uv": summary(uv_errors),
        "normalVector": summary(normal_errors),
        "method": "each exported corner matched to one source corner at the same quantized position; UV and normal checked together",
    }


def map_samples(info, uvs):
    samples = {}
    for name, ch in info.channels.items():
        if ch.image is None:
            samples[name] = np.tile(
                np.array(ch.value if ch.value is not None else 0).ravel(), (len(uvs), 1)
            )
            continue
        pixels = M._pixels(ch.image)
        h, w, _ = pixels.shape
        x = np.clip((np.mod(uvs[:, 0], 1) * w).astype(int), 0, w - 1)
        y = np.clip((np.mod(uvs[:, 1], 1) * h).astype(int), 0, h - 1)
        values = pixels[y, x, :3]
        if ch.index is not None:
            values = pixels[y, x, ch.index : ch.index + 1]
        samples[name] = values.copy()
    return samples


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--group", required=True)
    p.add_argument("--inventory", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--source-only", action="store_true")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=False)
    inventory = json.loads(Path(a.inventory).read_text())
    specs = {i["id"]: i for i in inventory["assets"]}
    rules = R.load()
    stem = "ulgani_" + a.group
    source = ROOT / "assets/blend/cities" / f"{stem}.blend"
    export = ROOT / "packages/client/public/models/cities" / f"{stem}.glb"
    report = {
        "source": str(source.relative_to(ROOT)),
        "sourceSHA256": sha(source),
        "assets": [],
        "failures": [],
    }
    if inventory["sha256"] != report["sourceSHA256"]:
        raise RuntimeError("inventory identity differs from the saved source")
    before = sha(source)
    sr = core.validate_path(rules, source, family="cities")
    core.write_and_print(sr, out / "stock-source.json", quiet=True)
    if sr.status != "PASS":
        report["failures"].append("stock source validation")
    source_data = {}
    for asset in sr.model.assets:
        for v in asset.variants.values():
            record, geo = loaded_asset(rules, v, specs[v.id])
            source_data[v.id] = (record, geo)
    report["packedImages"] = [
        {
            "name": i.name,
            "size": list(i.size),
            "packed": i.packed_file is not None,
            "packedSHA256": hashlib.sha256(i.packed_file.data).hexdigest()
            if i.packed_file
            else None,
            "colorspace": i.colorspace_settings.name,
        }
        for i in bpy.data.images
        if i.users
    ]
    if not all(i["packed"] for i in report["packedImages"]):
        report["failures"].append("unpacked image")
    report["sourceMaterials"] = []
    painted_samples = {}
    for mat in bpy.data.materials:
        if not mat.users:
            continue
        info = M.MaterialInfo(mat)
        if not any(
            o.type == "MESH" and any(s.material == mat for s in o.material_slots)
            for o in bpy.data.objects
        ):
            continue
        report["sourceMaterials"].append(
            {
                "name": mat.name,
                "channels": {
                    k: {
                        "kind": c.kind,
                        "image": c.image.name if c.image else None,
                        "component": c.index,
                    }
                    for k, c in info.channels.items()
                },
            }
        )
        users = [
            o
            for asset in sr.model.assets
            for v in asset.variants.values()
            for o in S.render_meshes(rules, v.lods[0])
            if any(slot.material == mat for slot in o.material_slots)
        ]
        uvs = M.surface_uvs(mat, users, budget=12000)
        if uvs is not None:
            painted_samples[R.material_name(mat)] = (uvs, map_samples(info, uvs))
    exports = {}
    raw = {}
    if not a.source_only:
        raw = raw_geometry(export)
        report.update(
            {
                "export": str(export.relative_to(ROOT)),
                "exportSHA256": sha(export),
                "exportBytes": export.stat().st_size,
            }
        )
        er = core.validate_path(rules, export, family="cities", source=source)
        core.write_and_print(er, out / "stock-export.json", quiet=True)
        if er.status != "PASS":
            report["failures"].append("stock export validation")
        for asset in er.model.assets:
            for v in asset.variants.values():
                exports[v.id] = loaded_asset(rules, v, specs[v.id])
        js, _ = glb.read(export)
        report["extensionsRequired"] = js.get("extensionsRequired", [])
        report["materialRoutes"] = js.get("materials", [])
        report["textures"] = ktx.inspect(export)
        report["paintedMapPreservation"] = []
        for name, (uvs, expected_maps) in painted_samples.items():
            material = next(
                (m for m in bpy.data.materials if R.material_name(m) == name), None
            )
            if material is None:
                report["failures"].append(name + ": missing decoded material")
                continue
            actual_maps = map_samples(M.MaterialInfo(material), uvs)
            for channel, expected in expected_maps.items():
                actual = actual_maps[channel]
                if expected.shape != actual.shape and actual.shape[1] == 1:
                    actual = np.repeat(actual, expected.shape[1], axis=1)
                if expected.shape != actual.shape:
                    report["failures"].append(name + ": changed map shape " + channel)
                    continue
                error = np.abs(expected - actual)
                row = {
                    "material": name,
                    "channel": channel,
                    "surfaceSamples": len(uvs),
                    "meanAbsoluteError": float(error.mean()),
                    "p99AbsoluteError": float(np.quantile(error, 0.99)),
                    "maxAbsoluteError": float(error.max()),
                    "sourceMin": float(expected.min()),
                    "sourceMax": float(expected.max()),
                    "decodedMin": float(actual.min()),
                    "decodedMax": float(actual.max()),
                }
                report["paintedMapPreservation"].append(row)
                if row["meanAbsoluteError"] > 0.04 or row["p99AbsoluteError"] > 0.20:
                    report["failures"].append(
                        name + ": excessive codec map error " + channel
                    )
    for name, (record, geo) in source_data.items():
        item = {"source": record}
        if exports:
            decoded, dgeo = exports[name]
            item["decoded"] = decoded
            item["preservation"] = []
            for n, (s, imported) in enumerate(zip(geo, dgeo)):
                e = raw[f"{name}_LOD{n}"]
                diagonal = float(np.linalg.norm(s[0].max(0) - s[0].min(0)))
                tolerance = max(0.0005, diagonal / 16383 * 2.5)
                surface_s = s[0][np.unique(np.array(s[1]).ravel())]
                surface_e = e[0][np.unique(np.array(e[1]).ravel())]
                dist = nearest_distance(surface_e, surface_s)
                back = nearest_distance(surface_s, surface_e)
                attributes = paired_attributes(s, e, tolerance)
                uv_distance = attributes["uv"]
                normal_distance = attributes["normalVector"]
                item["preservation"].append(
                    {
                        "lod": n,
                        "position": dist,
                        "sourceToExportPosition": back,
                        "positionTolerance": tolerance,
                        "uv": uv_distance,
                        "normalVector": normal_distance,
                        "pairedAttributes": attributes,
                        "sourceTriangles": len(s[1]),
                        "exportTriangles": len(e[1]),
                        "sourceVertices": len(s[0]),
                        "exportVertices": len(e[0]),
                        "blenderImportedVertices": len(imported[0]),
                        "blenderImportedTriangles": len(imported[1]),
                        "exportReader": "glTF-Transform NodeIO + MeshoptDecoder, normalized accessors and world transform; glTF Y-up converted to Blender Z-up",
                        "sourceSurfaceVertices": len(surface_s),
                        "exportSurfaceVertices": len(surface_e),
                        "unusedSourceVertices": len(s[0]) - len(surface_s),
                    }
                )
                if max(dist["max"], back["max"]) > tolerance:
                    report["failures"].append(f"{name} LOD{n}: position preservation")
                if attributes["spatiallyUnmatchedCorners"]:
                    report["failures"].append(
                        f"{name} LOD{n}: unmatched attribute corners"
                    )
                if uv_distance["p99"] > 0.002:
                    report["failures"].append(f"{name} LOD{n}: UV preservation")
                if normal_distance["p99"] > 0.045:
                    report["failures"].append(f"{name} LOD{n}: normal preservation")
            sm = {m["name"]: m for m in record["markers"]}
            em = {m["name"]: m for m in decoded["markers"]}
            if sm.keys() != em.keys():
                report["failures"].append(name + ": marker inventory")
            for key in sm.keys() & em.keys():
                if (
                    np.linalg.norm(
                        np.array(sm[key]["position"]) - np.array(em[key]["position"])
                    )
                    > 0.001
                ):
                    report["failures"].append(key + ": marker position")
        for label, rec in [("source", record)] + (
            [("export", item["decoded"])] if exports else []
        ):
            if rec["collision"]["maxObjectTriangles"] > 512:
                report["failures"].append(name + ": collider complexity")
            dim = np.ptp(geo[0][0], axis=0).max()
            if rec["collision"]["nearestSurfaceP95"] > max(0.55, dim * 0.012):
                report["failures"].append(name + f": {label} collider fit")
            for route in rec["walkRoutes"]:
                for kind in ("visual", "collision"):
                    if route[kind]["blocked"] or route[kind]["unsupported"]:
                        report["failures"].append(
                            name + f": {label} {kind} clearance/support"
                        )
        role = specs[name]["role"]
        if role in ("low", "mid", "tall"):
            bands = {"low": (6, 14), "mid": (20, 60), "tall": (170, 340)}
            height = np.ptp(geo[0][0], axis=0)[2]
            if not bands[role][0] <= height <= bands[role][1]:
                report["failures"].append(name + ": height band")
        report["assets"].append(item)
    hashes = [r["source"]["lods"][0]["geometryHash"] for r in report["assets"]]
    if len(hashes) != len(set(hashes)):
        report["failures"].append("duplicate LOD0 geometry")
    if sha(source) != before:
        report["failures"].append("source mutated by audit/export")
    report["failures"] = sorted(set(report["failures"]))
    report["status"] = "FAIL" if report["failures"] else "PASS"
    (out / "audit.json").write_text(
        json.dumps(report, indent=2, default=lambda v: list(v)) + "\n"
    )
    print(report["status"], report["failures"], flush=True)
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
