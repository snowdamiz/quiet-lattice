"""Retain original saved polygon/normal data while transferring corrected metric trims."""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import core, sha
from density import jacobians
from pipeline import META, ROOT, inventory
from revise_trims import canonical


def metric_polygon(points, triangles, res, target, preferred_uv=None):
    # A single planar chart per polygon; choose a direction that retains every rendered triangle.
    directions = [
        np.array(v, dtype=float)
        for v in [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 2, 3), (-2, 3, 1)]
    ]
    for tri in triangles:
        directions.append(
            np.cross(points[tri[1]] - points[tri[0]], points[tri[2]] - points[tri[0]])
        )
    best = None
    for normal in directions:
        length = np.linalg.norm(normal)
        if length < 1e-20:
            continue
        normal = normal / length
        axis = np.eye(3)[np.argmin(np.abs(normal))]
        x = np.cross(axis, normal)
        x /= np.linalg.norm(x)
        if preferred_uv is not None:
            gradient = np.linalg.lstsq(
                points - points.mean(0), preferred_uv - preferred_uv.mean(0), rcond=None
            )[0]
            direction = gradient[:, 0] - normal * np.dot(normal, gradient[:, 0])
            if np.linalg.norm(direction) > 1e-12:
                x = direction / np.linalg.norm(direction)
        y = np.cross(normal, x)
        if preferred_uv is not None and np.dot(y, gradient[:, 1]) < 0:
            y = -y
        uv = (points - points[0]) @ np.stack([x, y], axis=1)
        minor, _, _, valid = jacobians(points[triangles], uv[triangles], [1, 1])
        minimum = float(minor[valid].min())
        if best is None or minimum > best[0]:
            best = (minimum, uv)
    if best is None or best[0] < 1e-12:
        raise RuntimeError("no noncollapsed polygon chart")
    return best[1] * (target * 1.20 / (res * best[0]))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--group", required=True)
    p.add_argument("--attempt", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    group = a.group
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    before = sha(source)
    data = json.loads((ROOT / inventory(group)).read_text())
    pointer = subprocess.check_output(
        [
            "git",
            "show",
            "a8a4e142828de25fff9235e49d25e17b50d1f047:" + str(source.relative_to(ROOT)),
        ],
        cwd=ROOT,
        text=True,
    )
    digest = next(s.split(":")[1] for s in pointer.splitlines() if s.startswith("oid "))
    size = int(
        next(s.split()[1] for s in pointer.splitlines() if s.startswith("size "))
    )
    common = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"], cwd=ROOT, text=True
        ).strip()
    )
    old = common / "lfs/objects" / digest[:2] / digest[2:4] / digest
    assert sha(old) == digest and old.stat().st_size == size
    res = (
        1024 if group == "props" else 4096 if group in ("anchor", "landmarks") else 2048
    )
    target = 512 if group == "props" else 256
    records = []
    with tempfile.TemporaryDirectory(prefix="ulgani-polygons-") as temp:
        oldpath = Path(temp) / "base.blend"
        oldpath.write_bytes(old.read_bytes())
        core.load(oldpath)
        names = {
            o.name: o.data.name
            for o in bpy.data.objects
            if o.type == "MESH" and "_Surface" in o.name
        }
        core.load(source)
        with bpy.data.libraries.load(str(oldpath), link=False) as (_, loaded):
            loaded.meshes = list(names.values())
        meshes = dict(zip(names, loaded.meshes, strict=True))
        for name, original in meshes.items():
            ob = bpy.data.objects[name]
            current = ob.data
            original.calc_loop_triangles()
            current.calc_loop_triangles()
            original_faces = np.array(
                [t.vertices[:] for t in original.loop_triangles], dtype=int
            )
            current_faces = np.array(
                [t.vertices[:] for t in current.loop_triangles], dtype=int
            )
            assert np.array_equal(original_faces, current_faces)
            vertices = np.array([v.co[:] for v in original.vertices])
            assert canonical(vertices, original_faces.tolist()) == canonical(
                [v.co[:] for v in current.vertices], current_faces.tolist()
            )
            old_normals = np.array([n.vector[:] for n in original.corner_normals])
            current_uv = np.array(
                [u.uv[:] for u in current.uv_layers.active.data]
            ).reshape(-1, 3, 2)
            current_mats = np.array([t.material_index for t in current.loop_triangles])
            materials = list(current.materials)
            uv = np.zeros((len(original.loops), 2))
            assignments = np.zeros(len(original.polygons), int)
            bypoly = {}
            for i, t in enumerate(original.loop_triangles):
                bypoly.setdefault(t.polygon_index, []).append(i)
            projected = 0
            for poly in original.polygons:
                ids = bypoly[poly.index]
                loop_ids = list(poly.loop_indices)
                local = {value: i for i, value in enumerate(loop_ids)}
                local_tris = np.array(
                    [[local[l] for l in original.loop_triangles[i].loops] for i in ids]
                )
                pxyz = vertices[list(poly.vertices)]
                joined = np.full((len(loop_ids), 2), np.nan)
                consistent = True
                for i, tri in zip(ids, local_tris, strict=True):
                    values = current_uv[i].copy()
                    known = np.isfinite(joined[tri, 0])
                    if known.any():
                        k = int(np.where(known)[0][0])
                        values += np.round(joined[tri[k]] - values[k])
                    if (
                        known.any()
                        and np.max(np.abs(joined[tri[known]] - values[known])) > 2e-5
                    ):
                        consistent = False
                    joined[tri[~known]] = values[~known]
                minor, _, _, valid = jacobians(
                    pxyz[local_tris], joined[local_tris], [res, res]
                )
                if (
                    not consistent
                    or not np.isfinite(joined).all()
                    or np.min(minor[valid]) < target * 1.19
                ):
                    joined = metric_polygon(pxyz, local_tris, res, target)
                    projected += 1
                joined -= np.floor(joined.min(axis=0))
                joined[:, 0] += 2
                uv[loop_ids] = joined
                assignments[poly.index] = np.bincount(
                    current_mats[ids], minlength=len(materials)
                ).argmax()
            original.materials.clear()
            for mat in materials:
                original.materials.append(mat)
            for poly, mid in zip(original.polygons, assignments, strict=True):
                poly.material_index = int(mid)
            layer = original.uv_layers.active
            layer.name = "UlganiMetricTrimUV"
            layer.data.foreach_set("uv", uv.astype(np.float32).ravel())
            measured = np.array([u.uv[:] for u in layer.data])
            tri_uv = np.array(
                [measured[list(t.loops)] for t in original.loop_triangles]
            )
            minor, _, _, valid = jacobians(vertices[original_faces], tri_uv, [res, res])
            assert minor[valid].min() >= target
            groups = [g.name for g in ob.vertex_groups]
            ob.data = original
            assert [g.name for g in ob.vertex_groups] == groups
            normals = np.array([n.vector[:] for n in original.corner_normals])
            assert np.array_equal(normals, old_normals)
            records.append(
                {
                    "object": name,
                    "originalPolygonCount": len(original.polygons),
                    "renderTriangles": len(original_faces),
                    "projectedPolygons": projected,
                    "minimumDensity": float(minor[valid].min()),
                    "geometrySHA256": canonical(vertices, original_faces.tolist()),
                    "originalNormalsSHA256": hashlib.sha256(
                        normals.tobytes()
                    ).hexdigest(),
                    "normalsExact": True,
                }
            )
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    data["sha256"] = sha(source)
    with (META / f"inventory/{group}-polygons-{a.attempt}.json").open("x") as f:
        json.dump(data, f, indent=2)
    with (META / f"density-revision/polygons-{group}-{a.attempt}.json").open("x") as f:
        json.dump(
            {
                "group": group,
                "beforeSHA256": before,
                "afterSHA256": sha(source),
                "baseLFSVerifiedSHA256": digest,
                "meshes": records,
            },
            f,
            indent=2,
        )


if __name__ == "__main__":
    main()
