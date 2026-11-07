"""Validate every shipped T05 GLB, including transcoded KTX2 and material-node controls."""

import hashlib
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(HERE), str(HERE.parent)]
from artlib import core, materials, rules
from material_trace import install

install()
R = rules.load()
out = ROOT / "assets/renders/flora/t05"
manifest = json.loads((out / "source_manifest.json").read_text())
reports = []
for stem, info in manifest["files"].items():
    src = ROOT / "assets/blend/flora" / stem
    assert hashlib.sha256(src.read_bytes()).hexdigest() == info["sha256"], (
        "Source changed after audit"
    )
    path = ROOT / "packages/client/public/models/flora" / Path(stem).with_suffix(".glb")
    report = core.validate_path(R, path, family="flora", source=src)
    core.write_and_print(report, out / "validation" / ("final_" + path.name + ".json"))
    assert report.status == "PASS", report.failures()
    reports.append(
        {
            "file": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
            "status": report.status,
        }
    )
# The imported map-times-mask node is supported only at full-strength with the named mask.
controls = []
mat = bpy.data.materials["Flora_rock"]
bs = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
sock = bs.inputs["Base Color"]
mix = sock.links[0].from_node
assert materials.trace(sock).kind == "image"
for name in ("partial_multiply", "wrong_mask_name", "missing_map"):
    if name == "partial_multiply":
        fac = mix.inputs[0]
        saved = fac.default_value
        fac.default_value = 0.5
    if name == "wrong_mask_name":
        mask = next(n for n in mat.node_tree.nodes if n.type == "VERTEX_COLOR")
        saved = mask.layer_name
        mask.layer_name = "wrong"
    if name == "missing_map":
        tex = next(
            l.from_node
            for s in mix.inputs
            for l in s.links
            if l.from_node.type == "TEX_IMAGE"
        )
        saved = tex.image
        tex.image = None
    assert materials.trace(sock).kind != "image", f"{name} accepted"
    controls.append({"name": name, "status": "PASS"})
    if name == "partial_multiply":
        fac.default_value = saved
    if name == "wrong_mask_name":
        mask.layer_name = saved
    if name == "missing_map":
        tex.image = saved
(out / "export_manifest.json").write_text(
    json.dumps({"exports": reports, "material_trace_controls": controls}, indent=2)
    + "\n"
)
print(
    "EXPORT_VALIDATION_PASS",
    len(reports),
    "files;",
    len(controls),
    "malformed material-node controls",
)
