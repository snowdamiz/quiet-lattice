"""Read-only LOD0 UV density and material-wiring facts. Does not save."""
import hashlib
import json
import os
import traceback
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ATLAS = 4096
GATE = ("Hull", "Accent", "Trim", "Dark")
BLEND = Path(os.environ["LARK_BLEND"])
OUT = Path(os.environ["LARK_OUT"])


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def world_of(obj, co):
    hom = np.concatenate([co, np.ones((len(co), 1), np.float64)], axis=1)
    M = np.array(obj.matrix_world, np.float64)
    return (hom @ M.T)[:, :3]


def role_name(mat):
    if mat is None:
        return None
    engine = mat.get("engine_name")
    return str(engine) if engine else None


report = {
    "blend": str(BLEND),
    "blend_sha256": sha256(BLEND),
    "blend_bytes": BLEND.stat().st_size,
    "blender": bpy.app.version_string,
    "atlas_pixels_assumed": ATLAS,
    "uv_layer": "UVMap",
    "force_fit_scale_applied": 1.0,
    "force_fit_note": "No scale other than 4096 px per UV unit is applied. force_fit is not read from the file.",
}
bpy.ops.wm.open_mainfile(filepath=str(BLEND), load_ui=False)
report["opened_filepath"] = bpy.data.filepath
report["blend_file_version"] = list(bpy.data.version)
report["libraries"] = [{"name": lib.name, "filepath": lib.filepath} for lib in bpy.data.libraries]
report["linked_object_count"] = sum(1 for o in bpy.data.objects if o.library)
report["local_mesh_object_count"] = sum(1 for o in bpy.data.objects if o.type == "MESH" and not o.library)

needles = ("force_fit", "forcefit", "layout_pixel", "atlas_contract")
found = []
for block in ("scenes", "materials", "objects", "meshes", "images", "texts", "collections"):
    for idb in getattr(bpy.data, block):
        keys = list(idb.keys()) if hasattr(idb, "keys") else []
        for key in keys:
            low = key.lower()
            if any(n in low for n in needles):
                found.append({"block": block, "id": idb.name, "key": key, "value": str(idb[key])[:300]})
        if block == "texts":
            body = idb.as_string()
            if "force_fit" in body or "force_fit_scale" in body:
                found.append({"block": "texts", "id": idb.name, "key": "body", "value": "contains force_fit"})
report["force_fit_properties"] = found

layer_hist = Counter()
active_hist = Counter()
missing_uv = []
extra_uv_examples = []
lod_objects = 0
for coll in bpy.data.collections:
    if not coll.name.startswith("lark") or "_LOD" not in coll.name:
        continue
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        lod_objects += 1
        names = [uv.name for uv in obj.data.uv_layers]
        layer_hist[tuple(names)] += 1
        active = obj.data.uv_layers.active.name if obj.data.uv_layers.active else None
        active_hist[active] += 1
        if "UVMap" not in names:
            missing_uv.append(f"{coll.name}/{obj.name}")
        if names != ["UVMap"]:
            if len(extra_uv_examples) < 30:
                extra_uv_examples.append({"object": f"{coll.name}/{obj.name}", "layers": names, "active": active})
report["uv_inventory"] = {
    "lark_lod_mesh_objects": lod_objects,
    "layer_sets": [{"layers": list(k), "objects": n} for k, n in sorted(layer_hist.items(), key=lambda kv: -kv[1])],
    "active_uv": [{"name": k, "objects": n} for k, n in sorted(active_hist.items(), key=lambda kv: -kv[1])],
    "missing_UVMap": missing_uv,
    "not_exactly_UVMap": extra_uv_examples,
}

rows = []
outside = []
skipped_no_uv = []
uv_min = [1e9, 1e9]
uv_max = [-1e9, -1e9]
uv_samples = 0
uv_outside = 0
matrix_error = None
visited = 0

for coll in bpy.data.collections:
    if not (coll.name.startswith("lark") and coll.name.endswith("_LOD0")):
        continue
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        if "UVMap" not in mesh.uv_layers:
            skipped_no_uv.append(f"{coll.name}/{obj.name}")
            continue
        mesh.calc_loop_triangles()
        nloops = len(mesh.uv_layers["UVMap"].data)
        uv_raw = np.empty(nloops * 2, np.float32)
        mesh.uv_layers["UVMap"].data.foreach_get("uv", uv_raw)
        uv = uv_raw.astype(np.float64).reshape(-1, 2)
        co_raw = np.empty(len(mesh.vertices) * 3, np.float32)
        mesh.vertices.foreach_get("co", co_raw)
        co = co_raw.astype(np.float64).reshape(-1, 3)
        world = world_of(obj, co)
        if matrix_error is None and len(mesh.vertices):
            w1 = obj.matrix_world @ mesh.vertices[0].co
            delta = (Vector(world[0]) - w1).length
            if delta > 1e-4:
                matrix_error = {"object": obj.name, "delta": delta}
        ntri = len(mesh.loop_triangles)
        if ntri == 0:
            continue
        vert_i = np.empty(ntri * 3, np.int32)
        loop_i = np.empty(ntri * 3, np.int32)
        mat_i = np.empty(ntri, np.int32)
        mesh.loop_triangles.foreach_get("vertices", vert_i)
        mesh.loop_triangles.foreach_get("loops", loop_i)
        mesh.loop_triangles.foreach_get("material_index", mat_i)
        vert_i = vert_i.reshape(-1, 3)
        loop_i = loop_i.reshape(-1, 3)
        pw = world[vert_i]
        uvt = uv[loop_i]
        if len(uv):
            uv_min[0] = min(uv_min[0], float(uv[:, 0].min()))
            uv_min[1] = min(uv_min[1], float(uv[:, 1].min()))
            uv_max[0] = max(uv_max[0], float(uv[:, 0].max()))
            uv_max[1] = max(uv_max[1], float(uv[:, 1].max()))
            uv_samples += int(uv.shape[0])
            uv_outside += int(np.count_nonzero((uv < -1e-4) | (uv > 1.0 + 1e-4)))
        roles = []
        for mat in mesh.materials:
            roles.append(role_name(mat))
        role_of = np.array([roles[i] if 0 <= i < len(roles) else None for i in mat_i], dtype=object)
        areas = {}
        edge_vals = {}
        ab = pw[:, 1] - pw[:, 0]
        ac = pw[:, 2] - pw[:, 0]
        cross = np.cross(ab, ac)
        world_area = 0.5 * np.linalg.norm(cross, axis=1)
        uab = uvt[:, 1] - uvt[:, 0]
        uac = uvt[:, 2] - uvt[:, 0]
        uv_area = 0.5 * np.abs(uab[:, 0] * uac[:, 1] - uac[:, 0] * uab[:, 1])
        edge_pack = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            world_len = np.linalg.norm(pw[:, a] - pw[:, b], axis=1)
            span = np.linalg.norm(uvt[:, a] - uvt[:, b], axis=1)
            ok = (world_len > 1e-4) & (span > 1e-8)
            dens = np.zeros(ntri, np.float64)
            dens[ok] = (span[ok] * ATLAS) / world_len[ok]
            edge_pack.append((dens, ok))
        for role in set(role_of.tolist()):
            if role is None:
                continue
            mask = role_of == role
            if not np.any(mask):
                continue
            parts = [dens[mask & ok] for dens, ok in edge_pack]
            vals = np.concatenate(parts) if parts else np.empty(0)
            bucket = {
                "key": f"{coll.name}/{obj.name}/{role}",
                "area_m2": float(world_area[mask].sum()),
                "uv_area": float(uv_area[mask].sum()),
                "edges": int(vals.size),
                "triangles": int(np.count_nonzero(mask)),
            }
            if vals.size:
                bucket["median_px_per_m"] = float(np.median(vals))
                bucket["area_px_per_m"] = float(ATLAS * np.sqrt(bucket["uv_area"] / bucket["area_m2"])) if bucket["area_m2"] else None
            else:
                bucket["median_px_per_m"] = None
                bucket["area_px_per_m"] = None
            if role in GATE and bucket["median_px_per_m"] is not None:
                rows.append(bucket)
            elif bucket["median_px_per_m"] is not None:
                outside.append(bucket)
        visited += 1

rows.sort(key=lambda r: r["median_px_per_m"])
outside.sort(key=lambda r: r["median_px_per_m"])
medians = [r["median_px_per_m"] for r in rows]
report["matrix_convention_error"] = matrix_error
report["lod0_objects_measured"] = visited
report["lod0_missing_UVMap"] = skipped_no_uv
report["uv_bounds_lod0_UVMap"] = {"min": uv_min, "max": uv_max, "samples": uv_samples, "samples_outside_0_1": uv_outside}
report["density"] = rows
report["outside_gate"] = outside
report["summary"] = {
    "roles": len(medians),
    "median_of_medians": float(np.median(medians)) if medians else None,
    "min_median": float(min(medians)) if medians else None,
    "min_key": rows[0]["key"] if rows else None,
    "max_median": float(max(medians)) if medians else None,
    "max_key": rows[-1]["key"] if rows else None,
    "target_px_per_m": 512,
    "pass": bool(medians) and min(medians) >= 512 and matrix_error is None,
    "gate_roles": list(GATE),
    "outside_roles": len(outside),
    "outside_min_median": outside[0]["median_px_per_m"] if outside else None,
    "outside_min_key": outside[0]["key"] if outside else None,
}

def image_fact(image):
    return {
        "name": image.name,
        "size": [int(image.size[0]), int(image.size[1])],
        "channels": int(image.channels),
        "colorspace": image.colorspace_settings.name,
        "packed": image.packed_file is not None,
        "filepath": image.filepath,
        "users": int(image.users),
    }

report["images"] = [image_fact(image) for image in bpy.data.images]
size_hist = Counter((im["size"][0], im["size"][1]) for im in report["images"])
report["image_size_counts"] = [{"width": w, "height": h, "images": n} for (w, h), n in sorted(size_hist.items())]

wiring = []
gate_image_sizes = Counter()
interesting = []
for mat in bpy.data.materials:
    engine = mat.get("engine_name")
    links = []
    uv_maps = []
    if mat.use_nodes and mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == "UVMAP":
                uv_maps.append(node.uv_map)
        for link in mat.node_tree.links:
            src = link.from_node
            if src.type not in {"TEX_IMAGE", "UVMAP"}:
                continue
            image = src.image if src.type == "TEX_IMAGE" and src.image else None
            rec = {
                "from_type": src.type,
                "from_socket": link.from_socket.name,
                "to_type": link.to_node.type,
                "to_socket": link.to_socket.name,
                "image": image.name if image else None,
                "image_size": [int(image.size[0]), int(image.size[1])] if image else None,
                "uv_map": src.uv_map if src.type == "UVMAP" else None,
            }
            links.append(rec)
            if image and str(engine) in GATE:
                gate_image_sizes[(int(image.size[0]), int(image.size[1]))] += 1
    entry = {
        "name": mat.name,
        "engine_name": None if engine is None else str(engine),
        "use_nodes": bool(mat.use_nodes),
        "uv_map_nodes": uv_maps,
        "blend_method": getattr(mat, "blend_method", None),
        "links": links,
    }
    wiring.append(entry)
    blob = " ".join([mat.name, str(engine or ""), " ".join(link["image"] or "" for link in links)])
    if any(token in blob.lower() for token in ("seam", "glyph", "hollow", "wear", "husk")):
        interesting.append(entry)

report["materials"] = wiring
report["gate_linked_image_size_counts"] = [
    {"width": w, "height": h, "links": n} for (w, h), n in sorted(gate_image_sizes.items())
]
report["name_matches_seam_glyph_hollow_wear_husk"] = [
    {"name": e["name"], "engine_name": e["engine_name"], "images": sorted({link["image"] for link in e["links"] if link["image"]})}
    for e in interesting
]
husk_slots = []
for coll in bpy.data.collections:
    if "husk" not in coll.name.lower():
        continue
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        slots = []
        for mat in obj.data.materials:
            if mat is None:
                slots.append(None)
                continue
            slots.append({"material": mat.name, "engine_name": None if mat.get("engine_name") is None else str(mat.get("engine_name"))})
        if len(husk_slots) < 80:
            husk_slots.append({"collection": coll.name, "object": obj.name, "slots": slots})
report["husk_material_slots_sample"] = husk_slots
report["husk_slot_engine_names"] = sorted({slot["engine_name"] for row in husk_slots for slot in row["slots"] if slot and slot["engine_name"]})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(report, indent=2) + "\n")
print("BLEND_MEASURE", report["summary"], "images", len(report["images"]), "force_fit_props", len(found), flush=True)
