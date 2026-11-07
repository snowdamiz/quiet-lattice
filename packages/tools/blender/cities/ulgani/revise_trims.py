"""Revise saved surfaces to metric reusable growth trims; never import author.py."""

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import M, R, S, core, geometry, sha
from density import jacobians
from pipeline import META, ROOT, inventory

COLORS = [
    "D9962B",
    "F2EAD3",
    "D9962B",
    "C7AB73",
    "5B4636",
    "CFC4A8",
    "2A2C30",
    "C7F06A",
    "A3987A",
    "A5732F",
    "FAF3DE",
    "A99B79",
]
NAMES = [
    "Chitin",
    "Membrane",
    "CapFlesh",
    "Gill",
    "Root",
    "Walk",
    "Basalt",
    "Spore",
    "ChitinAged",
    "ChitinJoint",
    "MembraneRepair",
    "WalkWorn",
]


def linear(hex_color):
    c = np.array([int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).tolist()


def make_images(res):
    u = np.arange(res, dtype=np.float32)[None, :] / res
    v = np.arange(res, dtype=np.float32)[:, None] / res
    tau = math.tau
    phase = tau * (
        101 * u + 0.21 * np.sin(tau * 3 * v) + 0.08 * np.sin(tau * (2 * u + 5 * v))
    )
    fibers = np.sin(phase)
    fine = np.sin(tau * (239 * u + 0.17 * np.sin(tau * 7 * v)))
    cross = np.sin(tau * (137 * v + 0.12 * np.sin(tau * 5 * u)))
    envelope = 0.75 + 0.25 * np.cos(tau * (u + 2 * v)) ** 2
    crease = (0.5 + 0.5 * fibers) ** 10
    images = {}
    for channel in ("BaseColor", "ORM", "Normal", "Emissive"):
        pixels = np.ones((res, res, 4), np.float32)
        if channel == "BaseColor":
            intensity = (
                0.91
                + 0.028 * fibers * envelope
                + 0.012 * fine
                + 0.008 * cross
                - 0.025 * crease
            )
            pixels[:, :, :3] = intensity[:, :, None]
        elif channel == "ORM":
            pixels[:, :, 0] = 0.96 - 0.11 * crease
            pixels[:, :, 1] = 0.63 + 0.10 * fibers + 0.025 * cross
            pixels[:, :, 2] = 0
        elif channel == "Normal":
            nx = 0.11 * np.cos(phase) * envelope + 0.045 * np.cos(
                tau * (239 * u + 0.17 * np.sin(tau * 7 * v))
            )
            ny = 0.04 * np.cos(tau * (137 * v + 0.12 * np.sin(tau * 5 * u)))
            normal = np.stack(
                (
                    np.broadcast_to(nx, (res, res)),
                    np.broadcast_to(ny, (res, res)),
                    np.ones((res, res), np.float32),
                ),
                axis=2,
            )
            normal /= np.linalg.norm(normal, axis=2, keepdims=True)
            pixels[:, :, :3] = normal * 0.5 + 0.5
        else:
            pixels[:, :, :3] = (0.75 + 0.10 * fibers + 0.05 * cross)[:, :, None]
        image = bpy.data.images.new(
            f"UlganiMetric_{res}_{channel}", width=res, height=res, alpha=True
        )
        image.colorspace_settings.name = (
            "sRGB" if channel in ("BaseColor", "Emissive") else "Non-Color"
        )
        image.pixels.foreach_set(pixels.ravel())
        image.pack()
        images[channel] = image
        del pixels
    return images


def make_materials(images, res):
    materials = []
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(
            name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat"
        )
    for i, (name, color) in enumerate(zip(NAMES, COLORS)):
        mat = bpy.data.materials.new(f"UlganiMetric_{res}_{name}")
        mat.use_nodes = True
        mat["library_sources"] = "LIB_Chitin,LIB_Membrane,LIB_CapFlesh,LIB_Basalt"
        mat["trim_strategy"] = (
            "shared periodic growth microtexture; semantic macro wear in saved face material assignments"
        )
        nt = mat.node_tree
        nt.nodes.clear()
        bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
        bs.inputs["Specular IOR Level"].default_value = 0.28
        nodes = {}
        for channel, image in images.items():
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = image
            node.extension = "REPEAT"
            node.label = channel
            nodes[channel] = node
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1
        tint.inputs[7].default_value = (*linear(color), 1)
        nt.links.new(nodes["BaseColor"].outputs["Color"], tint.inputs[6])
        nt.links.new(tint.outputs[2], bs.inputs["Base Color"])
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(nodes["ORM"].outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
        normal = nt.nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = 0.65 if i in (0, 4, 6, 8, 9) else 0.32
        nt.links.new(nodes["Normal"].outputs["Color"], normal.inputs["Color"])
        nt.links.new(normal.outputs["Normal"], bs.inputs["Normal"])
        ao = nt.nodes.new("ShaderNodeGroup")
        ao.node_tree = group
        nt.links.new(sep.outputs["Red"], ao.inputs["Occlusion"])
        if i == 7:
            glow = nt.nodes.new("ShaderNodeMix")
            glow.data_type = "RGBA"
            glow.blend_type = "MULTIPLY"
            glow.inputs[0].default_value = 1
            glow.inputs[7].default_value = (*linear(color), 1)
            nt.links.new(nodes["Emissive"].outputs["Color"], glow.inputs[6])
            nt.links.new(glow.outputs[2], bs.inputs["Emission Color"])
            bs.inputs["Emission Strength"].default_value = 0.65
        else:
            bs.inputs["Emission Strength"].default_value = 0
        materials.append(mat)
    return materials


def canonical(verts, faces):
    # Ignore face listing order, preserving winding, vertices and actual tessellation.
    rotated = [
        min(tuple(f), tuple(f[1:]) + tuple(f[:1]), tuple(f[2:]) + tuple(f[:2]))
        for f in faces
    ]
    return hashlib.sha256(
        np.asarray(verts, dtype=np.float32).tobytes()
        + np.asarray(sorted(rotated), dtype=np.int64).tobytes()
    ).hexdigest()


def revise_mesh(ob, materials, res, target):
    linear_world = np.array(ob.matrix_world.to_3x3(), dtype=np.float64)
    if (
        ob.modifiers
        or ob.data.shape_keys
        or not np.allclose(linear_world.T @ linear_world, np.eye(3), atol=1e-7, rtol=0)
    ):
        raise RuntimeError(
            "metric trim conversion requires applied unit scale and no modifiers: "
            + ob.name
        )
    group_names = [group.name for group in ob.vertex_groups]
    mesh = ob.data
    mesh.calc_loop_triangles()
    verts = np.array([v.co[:] for v in mesh.vertices], dtype=np.float64)
    faces = np.array([t.vertices[:] for t in mesh.loop_triangles], dtype=np.int32)
    loops = np.array([t.loops[:] for t in mesh.loop_triangles], dtype=np.int32)
    old_uv = np.array([x.uv[:] for x in mesh.uv_layers.active.data], dtype=np.float64)[
        loops
    ]
    old_normals = np.array(
        [n.vector[:] for n in mesh.corner_normals], dtype=np.float64
    )[loops]
    weights = defaultdict(lambda: defaultdict(list))
    membership = []
    for vertex in mesh.vertices:
        memberships = {g.group: g.weight for g in vertex.groups}
        membership.append(memberships)
        for group, weight in memberships.items():
            weights[group][weight].append(vertex.index)
    groups = []
    for face in faces:
        score = defaultdict(float)
        for vertex in face:
            for group, weight in membership[vertex].items():
                score[group] += weight
        groups.append(max(score, key=score.get) if score else -1)
    groups = np.array(groups)
    points = verts[faces]
    uv = np.zeros_like(old_uv)
    mat_ids = np.zeros(len(faces), np.int32)
    records = []
    for group in np.unique(groups):
        ids = np.where(groups == group)[0]
        label = ob.vertex_groups[int(group)].name if group >= 0 else "ungrouped"
        tiles = np.clip(
            (old_uv[ids].mean(1)[:, 0] * 4).astype(int), 0, 3
        ) + 4 * np.clip((old_uv[ids].mean(1)[:, 1] * 2).astype(int), 0, 1)
        tile = int(np.bincount(tiles, minlength=8).argmax())
        chart = (old_uv[ids] * [4, 2] - [tile % 4 + 0.03, tile // 4 + 0.03]) / 0.94
        edge = points[ids, 1:] - points[ids, :1]
        delta = chart[:, 1:] - chart[:, :1]
        det = delta[:, 0, 0] * delta[:, 1, 1] - delta[:, 0, 1] * delta[:, 1, 0]
        good = np.abs(det) > 1e-10
        k = np.zeros((len(ids), 3, 2))
        if good.any():
            k[good] = np.transpose(edge[good], (0, 2, 1)) @ np.linalg.inv(
                np.transpose(delta[good], (0, 2, 1))
            )
            spans = np.linalg.norm(k, axis=1)
            ceiling = np.quantile(spans[good], 0.99, axis=0) * 1.5
            good &= np.all(spans <= ceiling, axis=1)
        if good.any():
            scale = (
                np.max(np.linalg.norm(k[good], axis=1), axis=0)
                * target
                * math.sqrt(2)
                * 1.20
                / res
            )
            mapped = chart * scale
        else:
            scale = np.zeros(2)
            mapped = np.zeros_like(chart)
        low, _, _, visible = jacobians(points[ids], mapped, [res, res])
        repair = (~good) | (visible & (low < target * 1.20 - 1e-5))
        for j in np.where(repair)[0]:
            p = points[ids[j]]
            e = p[1] - p[0]
            n = np.cross(e, p[2] - p[0])
            length = np.linalg.norm(e)
            area = np.linalg.norm(n)
            if length > 1e-14 and area > 1e-14:
                tangent = e / length
                bitangent = np.cross(n / area, tangent)
                mapped[j] = np.stack((p @ tangent, p @ bitangent), axis=1) * (
                    target * 1.20 / res
                )
        # Integer translation preserves exact REPEAT sampling and derivatives. U outside
        # [0,1] keeps the stock codec's UV accessor floating point instead of quantized.
        mapped -= np.floor(mapped.min(1))[:, None, :]
        mapped[:, :, 0] += 2
        uv[ids] = mapped
        mat_ids[ids] = tile
        center = chart.mean(1)
        if tile == 0:
            mat_ids[ids[(center[:, 1] < 0.075) | (center[:, 1] > 0.94)]] = 9
            mat_ids[ids[(center[:, 1] > 0.68) & (center[:, 1] < 0.87)]] = 8
        if tile == 1:
            patch = ((center[:, 0] - 0.63) / 0.22) ** 2 + (
                (center[:, 1] - 0.6) / 0.19
            ) ** 2 < 1
            mat_ids[ids[patch]] = 10
            if "Repair" in label or "Patch" in label:
                mat_ids[ids] = 10
        if tile == 5:
            worn = np.abs(points[ids].mean(1)[:, 0]) < 1.4
            mat_ids[ids[worn]] = 11
        records.append(
            {
                "component": label,
                "triangles": len(ids),
                "paletteRegion": tile,
                "chartScale": scale.tolist(),
                "projectedTriangles": int(repair.sum()),
            }
        )
    before = canonical(verts, faces)
    new = bpy.data.meshes.new(mesh.name + "MetricTrim")
    new.from_pydata(verts.tolist(), [], faces.tolist())
    new.update()
    for mat in materials:
        new.materials.append(mat)
    for poly, mid in zip(new.polygons, mat_ids):
        poly.material_index = int(mid)
        poly.use_smooth = True
    layer = new.uv_layers.new(name="UlganiMetricTrimUV")
    layer.data.foreach_set("uv", uv.astype(np.float32).ravel())
    saved_uv = np.array([x.uv[:] for x in layer.data]).reshape(-1, 3, 2)
    measured, _, _, valid = jacobians(points, saved_uv, [res, res])
    if np.any(measured[valid] < target):
        raise RuntimeError("float32 saved UV density is below target: " + ob.name)
    new.normals_split_custom_set(old_normals.reshape(-1, 3).tolist())
    ob.data = new
    for name in group_names:
        ob.vertex_groups.new(name=name)
    for group, by_weight in weights.items():
        for weight, indices in by_weight.items():
            ob.vertex_groups[group].add(indices, weight, "REPLACE")
    new.calc_loop_triangles()
    after = canonical(
        [v.co[:] for v in new.vertices], [tuple(t.vertices) for t in new.loop_triangles]
    )
    if before != after:
        raise RuntimeError("rendered geometry changed: " + ob.name)
    return {
        "object": ob.name,
        "beforeGeometryHash": before,
        "afterGeometryHash": after,
        "vertices": len(verts),
        "triangles": len(faces),
        "components": records,
        "materialFaces": {
            NAMES[i]: int((mat_ids == i).sum()) for i in np.unique(mat_ids)
        },
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--group", required=True)
    p.add_argument("--attempt", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    source = ROOT / f"assets/blend/cities/ulgani_{a.group}.blend"
    historical = json.loads((META / "delivery-manifest-r02.json").read_text())
    expected = next(
        x["sha256"]
        for x in historical["files"]
        if x["path"] == str(source.relative_to(ROOT))
    )
    if sha(source) != expected:
        raise RuntimeError(
            "source has already changed; revise saved data explicitly instead of rerunning initial UV conversion"
        )
    data = json.loads((ROOT / inventory(a.group)).read_text())
    receipt = META / f"density-revision/trim-{a.group}-{a.attempt}.json"
    if receipt.exists():
        raise RuntimeError("receipt exists")
    core.load(source)
    rules = R.load()
    model = S.collect_source(rules)
    S.assign_classes(rules, "cities", model)
    protected = {
        o.name: hashlib.sha256(geometry([o])[0].tobytes()).hexdigest()
        for o in bpy.data.objects
        if o.type == "MESH" and not "_Surface" in o.name
    }
    markers = {
        o.name: {
            "matrix": list(map(list, o.matrix_world)),
            "props": {k: o[k] for k in o.keys()},  # noqa: SIM118 - Blender ID properties require keys()
        }
        for o in bpy.data.objects
        if o.type == "EMPTY"
    }
    res = (
        4096
        if a.group in ("anchor", "landmarks")
        else 1024
        if a.group == "props"
        else 2048
    )
    images = make_images(res)
    materials = make_materials(images, res)
    rows = []
    for asset in model.assets:
        for variant in asset.variants.values():
            for lod in range(4):
                for ob in S.render_meshes(rules, variant.lods[lod]):
                    rows.append(
                        revise_mesh(
                            ob, materials, res, 512 if variant.cls == "prop" else 256
                        )
                    )
    S.clear_cache()
    bpy.context.view_layer.update()
    assert protected == {
        o.name: hashlib.sha256(geometry([o])[0].tobytes()).hexdigest()
        for o in bpy.data.objects
        if o.type == "MESH" and not "_Surface" in o.name
    }
    assert markers == {
        o.name: {
            "matrix": list(map(list, o.matrix_world)),
            "props": {k: o[k] for k in o.keys()},  # noqa: SIM118 - Blender ID properties require keys()
        }
        for o in bpy.data.objects
        if o.type == "EMPTY"
    }
    for mat in materials:
        assert not M.MaterialInfo(mat).procedural(), mat.name
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    data["sha256"] = sha(source)
    with (META / f"inventory/{a.group}-density-{a.attempt}.json").open("x") as f:
        json.dump(data, f, indent=2)
    with receipt.open("x") as f:
        json.dump(
            {
                "source": str(source.relative_to(ROOT)),
                "beforeSHA256": expected,
                "afterSHA256": sha(source),
                "renderMeshes": rows,
                "protectedGeometryUnchanged": True,
                "markersUnchanged": True,
                "images": [
                    {
                        "name": im.name,
                        "size": list(im.size),
                        "packedSHA256": hashlib.sha256(im.packed_file.data).hexdigest(),
                    }
                    for im in images.values()
                ],
                "materials": [m.name for m in materials],
            },
            f,
            indent=2,
            default=lambda x: list(x),
        )


if __name__ == "__main__":
    main()
