"""Additional saved-source measurements: scale-invariant identity and actual UV density."""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import R, S, core, geometry, sha
from pipeline import GROUPS, META, ROOT

rows = []
sources = {}
for group in GROUPS:
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    sources[str(source.relative_to(ROOT))] = sha(source)
    core.load(source)
    rules = R.load()
    model = S.collect_source(rules)
    for asset in model.assets:
        for variant in asset.variants.values():
            objects = S.render_meshes(rules, variant.lods[0])
            geo = geometry(objects)
            p = geo[0][np.unique(np.array(geo[1]).ravel())]
            normalized = (p - (p.min(0) + p.max(0)) / 2) / np.ptp(p, axis=0).max()
            normalized = normalized[np.lexsort(normalized.T[::-1])]
            areas, densities, components = [], [], []
            for ob in objects:
                mesh = ob.data
                mesh.calc_loop_triangles()
                material = mesh.materials[0]
                image = next(
                    n.image
                    for n in material.node_tree.nodes
                    if n.type == "TEX_IMAGE" and n.image.name.endswith("_BaseColor")
                )
                uv = mesh.uv_layers.active
                for tri in mesh.loop_triangles:
                    xyz = np.array(
                        [ob.matrix_world @ mesh.vertices[i].co for i in tri.vertices]
                    )
                    tex = np.array([uv.data[i].uv[:] for i in tri.loops])
                    area = (
                        np.linalg.norm(np.cross(xyz[1] - xyz[0], xyz[2] - xyz[0])) / 2
                    )
                    delta1, delta2 = tex[1] - tex[0], tex[2] - tex[0]
                    uv_area = abs(delta1[0] * delta2[1] - delta1[1] * delta2[0]) / 2
                    if area > 1e-10:
                        areas.append(area)
                        densities.append(
                            float(
                                np.sqrt(uv_area * image.size[0] * image.size[1] / area)
                            )
                        )
                components.extend(g.name for g in ob.vertex_groups)
            order = np.argsort(densities)
            cumulative = np.cumsum(np.array(areas)[order]) / sum(areas)
            quantiles = np.interp(
                [0.1, 0.5, 0.9], cumulative, np.array(densities)[order]
            )
            rows.append(
                {
                    "id": variant.id,
                    "componentGroups": components,
                    "scaleInvariantPointHash": hashlib.sha256(
                        np.round(normalized, 5).tobytes()
                    ).hexdigest(),
                    "baseColorAreaWeightedTexelsPerMetreP10P50P90": quantiles.tolist(),
                    "surfaceAreaSquareMetres": float(sum(areas)),
                    "texelDensityMethod": "sqrt(UV triangle area * image width * height / world triangle area), weighted by visible mesh triangle area; shared trim regions may overlap",
                }
            )
assert len(rows) == len({r["scaleInvariantPointHash"] for r in rows}) == 39
assert all(sha(ROOT / path) == value for path, value in sources.items())
with (META / "source-contract-measurements-r04.json").open("x") as f:
    json.dump(
        {
            "sourceHashes": sources,
            "assets": rows,
            "densityBoundary": "Measured values, not a claim of uniform 256px/m buildings or 512px/m props; native material close-up review remains required.",
        },
        f,
        indent=2,
    )
    f.write("\n")
