"""Compare saved geometry, normals, groups, colliders and markers to hash-verified base LFS sources."""

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
from pipeline import GROUPS, META, ROOT
from revise_trims import canonical

BASE = "a8a4e142828de25fff9235e49d25e17b50d1f047"


def snapshot(path):
    core.load(path)
    rows = {}
    for ob in bpy.data.objects:
        properties = {k: ob[k] for k in ob.keys()}  # noqa: SIM118 - Blender ID properties
        row = {
            "type": ob.type,
            "matrix": list(map(list, ob.matrix_world)),
            "properties": json.loads(json.dumps(properties, default=list)),
            "collections": sorted(c.name for c in ob.users_collection),
        }
        if ob.type == "MESH":
            me = ob.data
            me.calc_loop_triangles()
            verts = np.array([v.co[:] for v in me.vertices], np.float32)
            faces = [list(t.vertices) for t in me.loop_triangles]
            row["geometrySHA256"] = canonical(verts, faces)
            row["triangles"] = len(faces)
            # Canonical face-index order pairs every old rendered corner to the new explicit triangle.
            norms = np.array([n.vector[:] for n in me.corner_normals], np.float64)
            table = []
            for tri in me.loop_triangles:
                indices = list(tri.vertices)
                start = indices.index(min(indices))
                table.append(
                    (
                        tuple(indices[start:] + indices[:start]),
                        np.roll(norms[list(tri.loops)], -start, axis=0),
                    )
                )
            table.sort(key=lambda item: item[0])
            row["normals"] = (
                np.stack([r[1] for r in table]) if table else np.empty((0, 3, 3))
            )
            weights = [
                [(g.group, float(g.weight)) for g in v.groups] for v in me.vertices
            ]
            row["vertexGroupsSHA256"] = hashlib.sha256(
                json.dumps(
                    {"names": [g.name for g in ob.vertex_groups], "weights": weights},
                    sort_keys=True,
                ).encode()
            ).hexdigest()
        rows[ob.name] = row
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--groups", default=",".join(GROUPS))
    parser.add_argument("--attempt", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    common = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"], cwd=ROOT, text=True
        ).strip()
    )
    results = []
    failures = []
    with tempfile.TemporaryDirectory(prefix="ulgani-old-source-") as temp:
        for group in args.groups.split(","):
            relative = f"assets/blend/cities/ulgani_{group}.blend"
            source = ROOT / relative
            pointer = subprocess.check_output(
                ["git", "show", BASE + ":" + relative], cwd=ROOT, text=True
            )
            digest = next(
                s.split(":")[1] for s in pointer.splitlines() if s.startswith("oid ")
            )
            size = int(
                next(
                    s.split()[1] for s in pointer.splitlines() if s.startswith("size ")
                )
            )
            obj = common / "lfs/objects" / digest[:2] / digest[2:4] / digest
            assert obj.stat().st_size == size and sha(obj) == digest
            oldpath = Path(temp) / f"ulgani_{group}.blend"
            oldpath.write_bytes(obj.read_bytes())
            before = snapshot(oldpath)
            after = snapshot(source)
            assert set(before) == set(after)
            rows = []
            for name, old in before.items():
                new = after[name]
                normal = 0
                if "normals" in old:
                    normal = float(
                        np.abs(old.pop("normals") - new.pop("normals")).max(initial=0)
                    )
                changed = [k for k in old if old[k] != new[k]]
                if changed or normal > 2e-6:
                    failures.append(
                        {
                            "group": group,
                            "object": name,
                            "changed": changed,
                            "maxNormalComponentError": normal,
                        }
                    )
                rows.append(
                    {
                        "object": name,
                        "geometrySHA256": old.get("geometrySHA256"),
                        "triangleCount": old.get("triangles"),
                        "maxNormalComponentError": normal,
                        "vertexGroupsSHA256": old.get("vertexGroupsSHA256"),
                        "contractsUnchanged": not changed,
                    }
                )
            results.append(
                {
                    "group": group,
                    "baseLFSVerifiedSHA256": digest,
                    "baseBytes": size,
                    "currentSHA256": sha(source),
                    "objects": rows,
                }
            )
            oldpath.unlink()
    with (META / f"density-revision/preservation-{args.attempt}.json").open("x") as f:
        json.dump(
            {
                "base": BASE,
                "status": "FAIL" if failures else "PASS",
                "failures": failures,
                "groups": results,
            },
            f,
            indent=2,
            default=list,
        )
    print("preservation failures", failures)
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
