"""First CPU-preview revision: edit saved geometry/materials; do not rebuild assets."""

import math
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
for group in ("foliage", "stone", "resources"):
    path = ROOT / f"assets/blend/flora/non_tree_{group}.blend"
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    sc = bpy.context.scene
    if sc.get("t05_revision", 0) >= 1:
        raise RuntimeError("Revision already applied")
    bpy.context.preferences.filepaths.save_version = 0
    for im in bpy.data.images:
        if not im.name.endswith(("_Base", "_Emission")):
            continue
        pix = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
        rgb = pix[:, :3]
        pix[:, :3] = np.where(
            rgb <= 0.0031308,
            rgb * 12.92,
            1.055 * np.maximum(rgb, 0) ** (1 / 2.4) - 0.055,
        )
        im.pixels.foreach_set(pix.ravel())
        im.pack()
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "NORMAL_MAP":
                node.inputs["Strength"].default_value = 0.38
    for ob in list(sc.objects):
        if ob.type != "MESH" or "kind" not in ob:
            continue
        kind = ob["kind"]
        variant = ob["variant"]
        me = ob.data
        if kind in ("rock", "boulder", "copper", "cobalt", "gold", "dihydrogen"):
            mask = me.color_attributes.active_color
            for i, v in enumerate(me.vertices):
                w = mask.data[i].color
                if w[2] > 0.5:
                    # Lift ore into the host surface; avoid the initial buried gold/cobalt siblings.
                    if kind in ("copper", "cobalt", "gold"):
                        v.co.z += 0.19 if variant else 0.10
                        if kind == "copper":
                            v.co.z = 0.35 + (v.co.z - 0.35) * 1.4
                    continue
                p = v.co.copy()
                extent = (
                    1.2 if kind == "boulder" else (1 if kind not in ("rock",) else 0.55)
                )
                # Authored fracture directions and asymmetric slump, shared coherently by all LODs.
                for nx, ny, dist in (
                    (0.92, 0.39, 0.75),
                    (-0.48, 0.88, 0.78),
                    (-0.84, -0.54, 0.82),
                    (0.35, -0.94, 0.83),
                ):
                    d = nx * p.x + ny * p.y
                    excess = max(0, d - extent * dist)
                    p.x -= nx * excess * 0.78
                    p.y -= ny * excess * 0.78
                p.z *= 1 + 0.16 * p.x / extent - 0.10 * p.y / extent
                p.z += (
                    0.025
                    * math.sin(p.x / extent * 4.3 + p.y / extent * 2.1)
                    * min(1, max(0, p.z) * 5)
                )
                v.co = p
        if ob.name == "fern_0":
            bpy.context.view_layer.objects.active = ob
            dec = ob.modifiers.new("Reduce_hidden_rachis_loops", "DECIMATE")
            dec.ratio = 0.9
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)
        ob.data.update()
    sc["t05_revision"] = 1
    sc["t05_revision_notes"] = (
        "CPU preview: corrected image transfer, softened normal relief, asymmetric fracture planes, exposed ore, fern topology budget."
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
