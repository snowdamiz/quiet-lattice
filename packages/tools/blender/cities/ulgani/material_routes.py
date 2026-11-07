"""Compare saved shader factors to the actual exported PBR routes, not just image bytes."""

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from audit import M, R, S, core, glb, sha
from pipeline import ROOT


def factor(socket):
    if not socket.is_linked:
        return np.array(socket.default_value[:3])
    node = socket.links[0].from_node
    if node.type == "TEX_IMAGE":
        return np.ones(3)
    if node.type in ("MIX_RGB", "MIX") and node.blend_type == "MULTIPLY":
        if node.inputs[0].is_linked or node.inputs[0].default_value != 1:
            raise RuntimeError("multiply route requires a constant factor of one")
        colors = [i for i in node.inputs if i.type == "RGBA" and i.enabled]
        return np.prod([factor(s) for s in colors], axis=0)
    raise RuntimeError("unsupported factor route: " + node.type)


def check_export_routes(material):
    failures = []
    pbr = material["pbrMetallicRoughness"]
    for key in ("roughnessFactor", "metallicFactor"):
        if pbr.get(key, 1) != 1:
            failures.append(key + ": changed direct ORM channel factor")
    if material.get("occlusionTexture", {}).get("strength", 1) != 1:
        failures.append("changed direct AO strength")
    routes = [
        pbr.get("baseColorTexture"),
        pbr.get("metallicRoughnessTexture"),
        material.get("normalTexture"),
        material.get("occlusionTexture"),
    ]
    if material.get("emissiveTexture"):
        routes.append(material["emissiveTexture"])
    for route in routes:
        if route is None or route.get("texCoord", 0) != 0 or route.get("extensions"):
            failures.append("missing texture or changed UV route/transform")
    if material.get("occlusionTexture", {}).get("index") != pbr.get(
        "metallicRoughnessTexture", {}
    ).get("index"):
        failures.append("ORM image routes differ")
    return failures


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--groups", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    records = []
    failures = []
    for group in a.groups.split(","):
        source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
        export = ROOT / f"packages/client/public/models/cities/ulgani_{group}.glb"
        core.load(source)
        rules = R.load()
        model = S.collect_source(rules)
        used = {
            o.data.materials[t.material_index].name
            for asset in model.assets
            for v in asset.variants.values()
            for objs in v.lods.values()
            for o in S.render_meshes(rules, objs)
            for t in o.data.polygons
        }
        js, _ = glb.read(export)
        exported = {m["name"]: m for m in js["materials"]}
        rows = []
        for name in sorted(used):
            info = M.MaterialInfo(bpy.data.materials[name])
            bs = info.bsdf
            for channel, index, socket in [
                ("roughness", 1, bs.inputs["Roughness"]),
                ("metallic", 2, bs.inputs["Metallic"]),
            ]:
                ch = info.channels[channel]
                if (
                    ch.index != index
                    or not socket.is_linked
                    or socket.links[0].from_node.type != "SEPARATE_COLOR"
                ):
                    failures.append(name + ": expected direct ORM channel " + channel)
            ao = next(
                n
                for n in info.mat.node_tree.nodes
                if n.type == "GROUP" and n.inputs.get("Occlusion")
            )
            if (
                info.channels["occlusion"].index != 0
                or ao.inputs["Occlusion"].links[0].from_node.type != "SEPARATE_COLOR"
            ):
                failures.append(name + ": expected direct ORM red AO")
            for node in info.mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and (
                    node.extension != "REPEAT" or node.inputs["Vector"].is_linked
                ):
                    failures.append(name + ": unsupported source UV/sampler route")
            m = exported.get(R.material_name(info.mat))
            if m is None:
                failures.append(name + ": missing exported material")
                continue
            failures.extend(name + ": " + failure for failure in check_export_routes(m))
            expected = factor(bs.inputs["Base Color"])
            actual = np.array(
                m["pbrMetallicRoughness"].get("baseColorFactor", [1, 1, 1, 1])[:3]
            )
            emission = factor(bs.inputs["Emission Color"]) * float(
                bs.inputs["Emission Strength"].default_value
            )
            exported_emission = np.array(m.get("emissiveFactor", [0, 0, 0])) * m.get(
                "extensions", {}
            ).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1)
            normal = (
                bs.inputs["Normal"].links[0].from_node.inputs["Strength"].default_value
            )
            item = {
                "material": name,
                "sourceBaseFactor": expected.tolist(),
                "exportBaseFactor": actual.tolist(),
                "sourceEmission": emission.tolist(),
                "exportEmission": exported_emission.tolist(),
                "sourceNormalScale": normal,
                "exportNormalScale": m.get("normalTexture", {}).get("scale", 1),
                "exportMaterial": m,
            }
            if not np.allclose(expected, actual, atol=1e-6, rtol=0):
                failures.append(name + ": base tint lost")
            if not np.allclose(emission, exported_emission, atol=1e-6, rtol=0):
                failures.append(name + ": emission tint/strength lost")
            if abs(normal - item["exportNormalScale"]) > 1e-6:
                failures.append(name + ": normal scale lost")
            rows.append(item)
        texture_routes = []
        for texture in js["textures"]:
            sampler = js.get("samplers", [{}])[texture.get("sampler", 0)]
            if (
                sampler.get("wrapS", 10497) != 10497
                or sampler.get("wrapT", 10497) != 10497
            ):
                failures.append(group + ": exported sampler is not REPEAT")
            texture_routes.append(
                {
                    "image": texture["extensions"]["KHR_texture_basisu"]["source"],
                    "sampler": sampler,
                }
            )
        if len(js["images"]) != 4:
            failures.append(group + ": expected exactly four shared images")
        records.append(
            {
                "group": group,
                "sourceSHA256": sha(source),
                "exportSHA256": sha(export),
                "materials": rows,
                "textureRoutes": texture_routes,
                "imageCount": len(js["images"]),
                "textureCount": len(js["textures"]),
            }
        )
    result = {
        "status": "FAIL" if failures else "PASS",
        "failures": failures,
        "groups": records,
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x") as f:
        json.dump(result, f, indent=2)
    print(result["status"], failures, flush=True)
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
