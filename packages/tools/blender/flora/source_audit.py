"""Fresh saved-source geometry/mask audit; never saves or authors geometry."""

import hashlib
import struct

import bpy
import numpy as np
from artlib import core, rules, scene


def mask_hash(rows):
    # Vertex splitting may duplicate records. Preserve the exact float32 bit patterns.
    unique = sorted({struct.pack("<4f", *row).hex() for row in rows})
    return hashlib.sha256("\n".join(unique).encode()).hexdigest()


def association_rows(ob):
    mask = ob.data.color_attributes.active_color
    unique = []
    for vert, item in zip(ob.data.vertices, mask.data):
        p = vert.co
        # Quantized only in this position key, never in the stored/compared mask.
        coords = ",".join(f"{float(v) + 0:.5f}" for v in (p.x, p.z, -p.y))
        unique.append(coords + ":" + struct.pack("<4f", *item.color).hex())
    return unique


def triangle_hash(ob):
    rows = association_rows(ob)
    triangles = [
        "|".join(sorted(rows[i] for i in triangle.vertices))
        for triangle in ob.data.loop_triangles
    ]
    return hashlib.sha256("\n".join(sorted(triangles)).encode()).hexdigest()


def audit_sources(paths, out):
    R = rules.load()
    result = {"task": "P1.E14.T05", "files": {}, "meshes": {}}
    for path in paths:
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        core.load(path)
        report = core.run_checks(R, path, "flora", "source")
        core.write_and_print(report, out / (path.name + ".json"), quiet=True)
        assert report.status == "PASS", report.failures()
        result["files"][path.name] = {"sha256": before, "bytes": path.stat().st_size}
        assert bpy.context.scene.unit_settings.system == "METRIC"
        assert bpy.context.scene.unit_settings.scale_length == 1
        model = scene.collect_source(R)
        layout = {
            o.name: (asset.name, variant.id)
            for asset in model.assets
            for variant in asset.variants.values()
            for objects in variant.lods.values()
            for o in objects
            if o.type == "MESH"
        }
        for ob in bpy.context.scene.objects:
            if ob.type != "MESH" or "kind" not in ob:
                continue
            me = ob.data
            assert not me.validate(), (ob.name, "invalid mesh topology")
            ca = me.color_attributes.active_color
            assert ca.data_type == "FLOAT_COLOR" and ca.domain == "POINT"
            values = np.array([item.color[:] for item in ca.data], dtype=np.float32)
            assert (
                np.isfinite(values).all()
                and (values >= 0).all()
                and (values <= 1).all()
            )
            assert np.allclose(values[:, :3].sum(1), 1, atol=2e-6)
            me.calc_loop_triangles()
            areas = np.array([t.area for t in me.loop_triangles])
            assert np.min(areas) > 1e-12, (
                ob.name,
                "degenerate triangles",
                float(np.min(areas)),
            )
            coords = np.array([v.co[:] for v in me.vertices])
            assert np.isfinite(coords).all()
            assert tuple(ob.scale) == (1, 1, 1) and tuple(ob.location) == (0, 0, 0)
            glow = np.array([v.value for v in me.attributes["_glow"].data])
            assert np.isfinite(glow).all() and (glow >= 0).all()
            row = {
                "file": path.name,
                "root": layout[ob.name][0],
                "variant_node": layout[ob.name][1],
                "kind": ob["kind"],
                "variant": ob["variant"],
                "triangles": len(me.loop_triangles),
                "vertices": len(me.vertices),
                "bounds_blender": [coords.min(0).tolist(), coords.max(0).tolist()],
                "mask_sha256": mask_hash(values),
                "mask_position_sha256": hashlib.sha256(
                    "\n".join(sorted(set(association_rows(ob)))).encode()
                ).hexdigest(),
                "triangle_association_sha256": triangle_hash(ob),
                "mask_min": values.min(0).tolist(),
                "mask_max": values.max(0).tolist(),
                "glow_max": float(glow.max()),
                "glow_accent": ob["glow_accent"],
            }
            result["meshes"][ob.name] = row
        assert hashlib.sha256(path.read_bytes()).hexdigest() == before

    return result
