"""Malformed real-source and compressed-export controls at the stock boundaries."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from artlib import core, scene as S, rules as R, glb, export, ktx
from audit import density


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=False)
    rules = R.load()
    results = []

    def source(case, family, stem, mutation, check):
        original = ROOT / "assets/blend" / family / (stem + ".blend")
        core.load(original)
        mutation()
        for lib in bpy.data.libraries:
            if lib.filepath.endswith("_library.blend"):
                lib.filepath = str(ROOT / "assets/blend/_library.blend")
        fixture = out / case / "sources" / family / (stem + ".blend")
        fixture.parent.mkdir(parents=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(fixture), compress=True)
        report = core.validate_path(rules, fixture, family=family)
        core.write_and_print(report, out / case / "stock-source.json")
        assert report.status == "FAIL" and report[check].status == "FAIL", (
            case,
            "malformed source accepted",
        )
        results.append(
            {
                "case": case,
                "expected": "FAIL",
                "observed": report.status,
                "check": check,
                "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
            }
        )
        return fixture

    def no_colliders():
        for o in list(bpy.data.objects):
            if o.name.startswith("COL_"):
                bpy.data.objects.remove(o, do_unlink=True)

    missing = source("missing-colliders", "sites", "outpost_0", no_colliders, "naming")
    # Seed a real previously valid output. Stock failure must remove it, not leave it loadable.
    runtime = out / "missing-colliders" / "models" / "sites" / "outpost_0.glb"
    runtime.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / "packages/client/public/models/sites/outpost_0.glb", runtime)
    code = export.main(
        "sites",
        [
            "--src-root",
            str(missing.parents[1]),
            "--out-dir",
            str(runtime.parents[1]),
            "--only",
            "outpost_0",
            "--report-dir",
            str(out / "missing-colliders" / "export-stock"),
        ],
    )
    assert code == 1 and not runtime.exists()
    results.append(
        {
            "case": "failed-stock-export-retires-real-runtime-bytes",
            "exit": code,
            "outputExists": runtime.exists(),
            "pass": True,
        }
    )

    def no_normals():
        for m in bpy.data.materials:
            if not m.library and m.node_tree:
                for n in m.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED":
                        for link in list(n.inputs["Normal"].links):
                            m.node_tree.links.remove(link)

    source("missing-normal-map", "props", "cargo_pod", no_normals, "materials")

    def too_large():
        model = S.collect_source(rules)
        for a in model.assets:
            for v in a.variants.values():
                for o in S.render_meshes(rules, v.lods[0]):
                    for vertex in o.data.vertices:
                        vertex.co *= 5

    source("oversized-debris", "props", "crash_debris", too_large, "scale")

    def no_lod3():
        for c in list(bpy.data.collections):
            if c.name.endswith("_LOD3"):
                for o in list(c.objects):
                    bpy.data.objects.remove(o, do_unlink=True)
                bpy.data.collections.remove(c)

    source("missing-lod3", "props", "catalyst_vial", no_lod3, "lods")

    def light_missing_property():
        del bpy.data.objects["Light_1"]["intensity"]

    source(
        "light-without-intensity", "sites", "beacon_0", light_missing_property, "naming"
    )
    core.load(ROOT / "assets/blend/props/cargo_pod.blend")
    model = S.collect_source(rules)
    meshes = S.render_meshes(rules, model.assets[0].variants["cargo_pod"].lods[0])
    for o in meshes:
        for loop in o.data.uv_layers.active.data:
            loop.uv *= 0.25
    d = density(meshes, 512)
    assert not d["pass"] and 127 < d["weightedMeanPxM"] < 129
    (out / "density-quarter-scale.json").write_text(json.dumps(d, indent=2) + "\n")
    results.append(
        {
            "case": "quarter-scale-real-UV-density",
            "observedPxM": d["weightedMeanPxM"],
            "accepted": d["pass"],
        }
    )
    src = ROOT / "packages/client/public/models/props/cargo_pod.glb"
    doc, binary = glb.read(src)
    path = out / "wrong-mips" / "cargo_pod.glb"
    path.parent.mkdir()
    # Re-encode one real map as a valid single-level KTX2 container. Corrupting
    # levelCount alone fails container decoding before the intended mip gate.
    index, slots = next(iter(ktx.image_slots(doc).items()))
    image = doc["images"][index]
    original = path.parent / "original.ktx2"
    original.write_bytes(ktx._image_bytes(doc, binary, index))
    png = path.parent / "decoded.png"
    short = path.parent / "one-level.ktx2"
    ktx._run([ktx.binary(), "extract", "--transcode", "rgba8", str(original), str(png)])
    settings = ktx.settings(rules, "props")
    command = ktx.encode_args(
        ktx.binary(),
        png,
        short,
        ktx.codec_for(slots, settings),
        bool(slots & ktx.COLOUR),
        "normal" in slots,
        4,
        settings,
        1,
    )
    command.remove("--generate-mipmap")
    ktx._run(command)
    assert ktx.header(short.read_bytes())["levels"] == 1
    binary = ktx._append(doc, binary, {image["bufferView"]: short.read_bytes()})
    glb.write(path, doc, binary)
    report = core.validate_path(
        rules, path, family="props", source=ROOT / "assets/blend/props/cargo_pod.blend"
    )
    core.write_and_print(report, out / "wrong-mips" / "stock-export.json")
    assert report.status == "FAIL"
    messages = [
        f["message"]
        for check in report.checks.values()
        for f in check.findings
        if f["level"] == "fail"
    ]
    assert any("mip" in m for m in messages), messages
    results.append(
        {
            "case": "real-KTX2-short-mip-chain",
            "expected": "FAIL",
            "observed": report.status,
            "failures": messages,
        }
    )
    (out / "results.json").write_text(
        json.dumps({"pass": True, "controls": results}, indent=2) + "\n"
    )
    print("CONTROL_BOUNDARIES_PASS", len(results), flush=True)


if __name__ == "__main__":
    main()
