"""Full-validator regressions on existing, read-only flora sources and exports.

Blender -b -t 2 --factory-startup --python-exit-code 1 -P this_file --
  --asset-root <checkout or pinned snapshot> --report-dir <new directory>
No source is saved, baked or exported. Graph/mesh mutations exist only in memory.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from artlib import core, glb, ktx, materials, rules  # noqa: E402


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--report-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    args.report_dir.mkdir(parents=True, exist_ok=False)
    config = rules.load()
    results = []
    sources = args.asset_root / "assets/blend/flora"
    exports = args.asset_root / "packages/client/public/models/flora"
    pairs = [(sources / f"non_tree_{kind}.blend", exports / f"non_tree_{kind}.glb") for kind in ("foliage", "resources", "stone")]
    before = {str(p): digest(p) for pair in pairs for p in pair}

    def record(name, report, expected="PASS", failure=None):
        report.write(args.report_dir / f"{name}.json", str)
        ok = report.status == expected and all(
            any(f["check"] == check and message in f["message"] for f in report.failures())
            for check, message in (failure or ())
        )
        results.append({"case": name, "ok": ok, "status": report.status, "expected": expected, "failures": report.failures()})
        print(f"{'PASS' if ok else 'FAIL'} {name}: {report.status} expected {expected}", flush=True)

    for source, export in pairs:
        record(source.stem + "_source", core.validate_path(config, source, family="flora"))
        record(export.stem + "_export", core.validate_path(config, export, family="flora", source=source))

    source, export = pairs[-1]
    # Decode the immutable input once. Every control imports a fresh copy, while
    # full texture/geometry checks still inspect the original compressed GLB.
    decoded = args.report_dir / "decoded.glb"
    ktx.decoded_copy(export, decoded)

    def control(name, mutate, expected="FAIL", failure=("materials", "base colour"), also=()):
        core.load(decoded)
        mat = bpy.data.materials["Flora_rock"]
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        base = bsdf.inputs["Base Color"]
        mix = base.links[0].from_node
        mask = next(l.from_node for i in mix.inputs for l in i.links if l.from_node.type == "VERTEX_COLOR")
        tex = next(l.from_node for i in mix.inputs for l in i.links if l.from_node.type == "TEX_IMAGE")
        users = sorted((o for o in bpy.context.scene.objects if o.type == "MESH" and any(s.material == mat for s in o.material_slots)), key=lambda o: o.name)
        assert len(users) > 1
        mutate(nt, bsdf, base, mix, mask, tex, users)
        materials.clear_cache()
        report = core.run_checks(config, export, "flora", "export", source=source)
        record(name, report, expected, [failure, *also] if expected == "FAIL" else None)

    def named(nt, bsdf, base, mix, mask, tex, users):
        mask.layer_name = users[0].data.color_attributes.active_color.name

    def renamed(nt, bsdf, base, mix, mask, tex, users):
        for user in users:
            user.data.color_attributes.active_color.name = "VerifiedMask"
        mask.layer_name = "VerifiedMask"

    control("active_mask", lambda *a: None, "PASS")
    control("named_mask", named, "PASS")
    control("renamed_mask", renamed, "PASS")
    control("partial_factor", lambda nt, b, s, m, *a: setattr(m.inputs[0], "default_value", 0.5))
    control("near_full_factor", lambda nt, b, s, m, *a: setattr(m.inputs[0], "default_value", 0.9999999))

    def linked(nt, bsdf, base, mix, *args):
        value = nt.nodes.new("ShaderNodeValue")
        value.outputs[0].default_value = 1.0
        nt.links.new(value.outputs[0], mix.inputs[0])

    control("linked_factor", linked)
    control("disabled_value_output", lambda nt, b, s, m, *a: nt.links.new(m.outputs[0], s))
    control("disabled_vector_output", lambda nt, b, s, m, *a: nt.links.new(m.outputs[1], s))
    control("muted_mix", lambda nt, b, s, m, *a: setattr(m, "mute", True))
    control("clamped_mix", lambda nt, b, s, m, *a: setattr(m, "clamp_result", True))
    control("wrong_blend", lambda nt, b, s, m, *a: setattr(m, "blend_type", "ADD"))
    control("absent_named_mask", lambda nt, b, s, m, mask, *a: setattr(mask, "layer_name", "AbsentMask"))

    def inactive(nt, bsdf, base, mix, mask, tex, users, valid=False):
        mask.layer_name = "Color"
        for user in users:
            attrs = user.data.color_attributes
            active = attrs.active_color
            active.name = "VerifiedMask"
            other = attrs.new("Color", "FLOAT_COLOR", "CORNER")
            rgba = np.tile([1.0, 0.0, 0.0, 1.0] if valid else [0.0, 0.0, 0.0, 0.0], len(other.data)).astype(np.float32)
            other.data.foreach_set("color", rgba)
            attrs.active_color = active

    control("inactive_black_named_mask", inactive)
    control("inactive_valid_named_mask", lambda *args: inactive(*args, valid=True))

    def last_name(nt, bsdf, base, mix, mask, tex, users):
        named(nt, bsdf, base, mix, mask, tex, users)
        users[-1].data.color_attributes.active_color.name = "OtherMask"

    control("last_user_wrong_name", last_name)

    def invalid(nt, bsdf, base, mix, mask, tex, users):
        ca = users[-1].data.color_attributes.active_color
        ca.data.foreach_set("color", np.zeros(len(ca.data) * 4, np.float32))

    control("last_user_invalid_mask", invalid, also=(("naming", "weights sum to 1"),))

    def absent(nt, bsdf, base, mix, mask, tex, users):
        attrs = users[-1].data.color_attributes
        attrs.remove(attrs.active_color)

    control("last_user_absent_mask", absent, also=(("naming", "no colour-region mask"),))

    def wrong_active(nt, bsdf, base, mix, mask, tex, users):
        attrs = users[-1].data.color_attributes
        other = attrs.new("OtherMask", "FLOAT_COLOR", "CORNER")
        other.data.foreach_set("color", np.tile([1, 0, 0, 1], len(other.data)).astype(np.float32))
        attrs.active_color = other

    control("last_user_other_active_mask", wrong_active)

    def wrong_render(nt, bsdf, base, mix, mask, tex, users):
        attrs = users[-1].data.color_attributes
        attrs.new("OtherMask", "FLOAT_COLOR", "CORNER")
        attrs.render_color_index = 1

    control("last_user_other_render_mask", wrong_render)
    control("absent_image", lambda nt, b, s, m, mask, tex, users: setattr(tex, "image", None))

    def constant_image(nt, bsdf, base, mix, mask, tex, users):
        image = bpy.data.images.new("UniformControl", 1024, 1024)
        image.generated_color = (0.5, 0.5, 0.5, 1.0)
        tex.image = image

    control("constant_image", constant_image, failure=("materials", "is uniform"))

    def literal(nt, bsdf, base, mix, mask, tex, users):
        link = next(l for i in mix.inputs for l in i.links if l.from_node == tex)
        socket = link.to_socket
        nt.links.remove(link)
        socket.default_value = (0.5, 0.5, 0.5, 1.0)

    control("constant_instead_of_image", literal)

    def wrong_mask_output(nt, bsdf, base, mix, mask, tex, users):
        link = next(l for i in mix.inputs for l in i.links if l.from_node == mask)
        nt.links.new(mask.outputs["Alpha"], link.to_socket)

    control("mask_alpha_output", wrong_mask_output)

    def procedural_uv(nt, bsdf, base, mix, mask, tex, users):
        nt.links.new(nt.nodes.new("ShaderNodeTexNoise").outputs["Color"], tex.inputs["Vector"])

    control("procedural_image_coordinates", procedural_uv)

    def no_uv(nt, bsdf, base, mix, mask, tex, users):
        layers = users[-1].data.uv_layers
        layers.remove(layers.active)

    control("last_user_missing_uv", no_uv, failure=("materials", "mesh has no UV map"))

    def no_roughness(nt, bsdf, *args):
        socket = bsdf.inputs["Roughness"]
        nt.links.remove(socket.links[0])

    control("missing_roughness", no_roughness, failure=("materials", "roughness"))

    # Keep the ordinary texture and geometry consumers in the gate. Mutant
    # containers are scratch-only; the loaded geometry/maps remain the real input.
    core.load(decoded)
    for name in ("short_mips", "optional_compression"):
        doc, data = glb.read(export)
        data = bytearray(data)
        if name == "short_mips":
            view = doc["bufferViews"][doc["images"][0]["bufferView"]]
            struct.pack_into("<I", data, view.get("byteOffset", 0) + 40, 1)
            required = [("materials", "mip level(s)")]
        else:
            doc.pop("extensionsRequired", None)
            required = [("materials", "not in extensionsRequired"), ("triangles", "must be in extensionsRequired")]
        mutant = args.report_dir / f"{name}.glb"
        glb.write(mutant, doc, data)
        record(name, core.run_checks(config, export, "flora", "export", source=source, glb=mutant), "FAIL", required)
        mutant.unlink()
    decoded.unlink()
    after = {str(p): digest(p) for pair in pairs for p in pair}
    assert before == after, "input bytes changed"
    summary = {"blender": bpy.app.version_string, "input_sha256": before, "unchanged": before == after, "results": results}
    (args.report_dir / "results.json").write_text(json.dumps(summary, indent=2))
    failures = [r["case"] for r in results if not r["ok"]]
    print(f"{len(results) - len(failures)}/{len(results)} controls passed; failures: {failures}", flush=True)
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
