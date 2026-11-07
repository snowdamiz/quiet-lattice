"""Fit bridge guardrail COL meshes in the saved source; prove rendered geometry unchanged."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from author_kit import bridge_rail_collision, bridge_deck_collision
from studio import Studio, HOME, ROOT


def rendered_digest():
    digest = hashlib.sha256()
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if o.type != "MESH" or o.name.startswith(("COL_", "REF_")):
            continue
        digest.update(o.name.encode())
        digest.update(np.array(o.matrix_world, dtype=np.float64).tobytes())
        for attr, count, dtype in [("vertices", 3, np.float32), ("loops", 1, np.int32)]:
            values = np.empty(len(getattr(o.data, attr)) * count, dtype=dtype)
            getattr(o.data, attr).foreach_get("co" if attr == "vertices" else "vertex_index", values)
            digest.update(values.tobytes())
        for uv in o.data.uv_layers:
            values = np.empty(len(uv.data) * 2, np.float32)
            uv.data.foreach_get("uv", values)
            digest.update(values.tobytes())
        digest.update(json.dumps([slot.material.name for slot in o.material_slots]).encode())
    for im in sorted(bpy.data.images, key=lambda im: im.name):
        values = np.empty(len(im.pixels), np.float32)
        im.pixels.foreach_get(values)
        digest.update(im.name.encode())
        digest.update(values.tobytes())
    return digest.hexdigest()


source = HOME.parent / "thalune_waterfront.blend"
old_sha = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
before = rendered_digest()
for kind, length, width in [("flat", 20, 4.5), ("arch", 28, 6)]:
    s = Studio.__new__(Studio)
    s.name = "bridge_thalune_" + kind
    s.root = bpy.data.collections[s.name]
    s.lod = bpy.data.collections[s.name + "_LOD0"]
    s.serial = 10000
    if not any("BridgeGuardrail" in o.name for o in s.root.objects):
        bridge_rail_collision(s, length, width)
    if not any("ContinuousDeck" in o.name for o in s.root.objects):
        for o in list(s.root.objects):
            if "_Ramp_" in o.name:
                bpy.data.objects.remove(o, do_unlink=True)
        s.serial = 20000
        bridge_deck_collision(s, length, width)
after = rendered_digest()
assert before == after, "collision amendment changed visible geometry or packed textures"
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
new_sha = hashlib.sha256(source.read_bytes()).hexdigest()
path = HOME / "receipts/thalune_waterfront-authored.json"
entries = json.loads(path.read_text())
for e in entries:
    e["sourceSha256"] = new_sha
    e["colliders"] = [o.name for o in bpy.data.collections[e["id"]].objects if o.type == "MESH"]
path.write_text(json.dumps(entries, indent=2) + "\n")
proof = {"beforeSourceSha256": old_sha, "afterSourceSha256": new_sha,
         "beforeRenderedDigest": before, "afterRenderedDigest": after, "onlyChange": "fitted bridge guardrails and continuous deck collision meshes"}
proof_path = HOME / "receipts/bridge-rail-amendment.json"
if proof_path.exists():
    proof["previousAmendment"] = json.loads(proof_path.read_text())
proof_path.write_text(json.dumps(proof, indent=2) + "\n")
preview = ROOT / "assets/renders/cities/thalune/P1-E10-T05-cpu-r1/waterfront.json"
data = json.loads(preview.read_text())
assert data["sourceSha256"] == old_sha
data["sourceSha256"] = new_sha
data["collisionOnlyAmendment"] = str((HOME / "receipts/bridge-rail-amendment.json").relative_to(ROOT))
preview.write_text(json.dumps(data, indent=2) + "\n")
