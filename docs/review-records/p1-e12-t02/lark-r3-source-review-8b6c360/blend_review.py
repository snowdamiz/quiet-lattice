"""Read-only SOURCE review of a Lark blend. Does not save."""
import hashlib
import json
import sys
from collections import Counter

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
BLEND, OUT, MODE = argv[0], argv[1], argv[2]
ATLAS = 4096
ROLES = ("Hull", "Accent", "Trim", "Dark")
SKIP_DENSITY = MODE == "prior"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def srgb_from_linear(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)


def linear_from_srgb(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def tri_count(me):
    return len(me.loops) - 2 * len(me.polygons)


def boundary_stats(me):
    counts = Counter()
    for poly in me.polygons:
        vs = poly.vertices
        n = len(vs)
        for i in range(n):
            a = int(vs[i])
            b = int(vs[(i + 1) % n])
            if a > b:
                a, b = b, a
            counts[(a, b)] += 1
    edges = len(counts)
    boundary = sum(1 for v in counts.values() if v == 1)
    nonmanifold = sum(1 for v in counts.values() if v > 2)
    return {
        "edges": edges,
        "boundary": boundary,
        "nonmanifold": nonmanifold,
        "boundary_ratio": (boundary / edges) if edges else None,
    }


def image_color_stats(im):
    w, h = int(im.size[0]), int(im.size[1])
    buf = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(buf)
    px = buf.reshape(-1, 4)
    rgb = px[:, :3]
    alive = px[:, 3] > 0.1
    use = rgb[alive] if alive.any() else rgb
    srgb = srgb_from_linear(use)
    lum = 0.2126 * srgb[:, 0] + 0.7152 * srgb[:, 1] + 0.0722 * srgb[:, 2]
    purple = (srgb[:, 2] > 0.25) & (srgb[:, 0] > 0.15) & (srgb[:, 1] < srgb[:, 2] * 0.75) & (srgb[:, 1] < srgb[:, 0] * 0.9)
    white = np.min(srgb, axis=1) > 0.75
    seam = np.array([0x9F, 0xE8, 0xDA], np.float32) / 255.0
    seam_lin = linear_from_srgb(seam)
    near_seam = (np.max(np.abs(use - seam), axis=1) < 0.08) | (np.max(np.abs(use - seam_lin), axis=1) < 0.08)
    # mint seam even if the bake stored a nearby cyan
    mint = (srgb[:, 1] > 0.70) & (srgb[:, 2] > 0.65) & (srgb[:, 0] > 0.35) & (srgb[:, 0] < srgb[:, 1])
    stats = {
        "size": [w, h],
        "colorspace": im.colorspace_settings.name,
        "texels": int(px.shape[0]),
        "alive": int(alive.sum()),
        "mean_linear": use.mean(axis=0).tolist(),
        "mean_srgb": srgb.mean(axis=0).tolist(),
        "p50_luma_srgb": float(np.median(lum)),
        "p95_luma_srgb": float(np.percentile(lum, 95)),
        "purple_fraction": float(purple.mean()),
        "white_fraction": float(white.mean()),
        "near_seam_9FE8DA": int(near_seam.sum()),
        "mint_fraction": float(mint.mean()),
        "dark_fraction_luma_lt_0_15": float((lum < 0.15).mean()),
    }
    del buf, px, rgb, srgb
    return stats


def packed_hash(im):
    if im.packed_file is None:
        return None
    data = bytes(im.packed_file.data)
    digest = hashlib.sha256(data).hexdigest()
    return {"sha256": digest, "packed_bytes": len(data)}


def uv_fingerprint(me):
    layer = me.uv_layers.get("UVMap")
    if layer is None:
        return None
    count = len(layer.data)
    if count == 0:
        return {"loops": 0, "sha256": None, "min": None, "max": None}
    uvs = np.empty(count * 2, np.float64)
    layer.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    rounded = np.round(uvs, 5).astype(np.float32)
    return {
        "loops": int(count),
        "sha256": hashlib.sha256(rounded.tobytes()).hexdigest(),
        "min": uvs.min(axis=0).tolist(),
        "max": uvs.max(axis=0).tolist(),
    }


def density_rows(obj):
    me = obj.data
    if "UVMap" not in me.uv_layers:
        return []
    me.calc_loop_triangles()
    tris = me.loop_triangles
    n = len(tris)
    if n == 0:
        return []
    loops = np.empty(n * 3, np.int32)
    verts_i = np.empty(n * 3, np.int32)
    mats = np.empty(n, np.int32)
    tris.foreach_get("loops", loops)
    tris.foreach_get("vertices", verts_i)
    tris.foreach_get("material_index", mats)
    loops = loops.reshape(-1, 3)
    verts_i = verts_i.reshape(-1, 3)
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mw = np.array(obj.matrix_world, dtype=np.float64)
    world = co @ mw[:3, :3].T + mw[:3, 3]
    uv_count = len(me.uv_layers["UVMap"].data)
    uvs = np.empty(uv_count * 2, np.float64)
    me.uv_layers["UVMap"].data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    role_of = {}
    for i, slot in enumerate(me.materials):
        role = slot.get("engine_name") if slot else None
        if role in ROLES:
            role_of[i] = role
    rows = []
    pw = world[verts_i]
    uvt = uvs[loops]
    for role in ROLES:
        ids = [i for i, r in role_of.items() if r == role]
        if not ids:
            continue
        mask = np.isin(mats, ids)
        if not mask.any():
            continue
        p = pw[mask]
        t = uvt[mask]
        ab = p[:, 1] - p[:, 0]
        ac = p[:, 2] - p[:, 0]
        area = np.linalg.norm(np.cross(ab, ac), axis=1) * 0.5
        uab = t[:, 1] - t[:, 0]
        uac = t[:, 2] - t[:, 0]
        uv_area = np.abs(uab[:, 0] * uac[:, 1] - uac[:, 0] * uab[:, 1]) * 0.5
        edges = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            world_len = np.linalg.norm(p[:, b] - p[:, a], axis=1)
            span = np.linalg.norm(t[:, b] - t[:, a], axis=1)
            keep = (world_len > 1e-4) & (span > 1e-8)
            if keep.any():
                edges.append((ATLAS * span[keep]) / world_len[keep])
        if not edges:
            continue
        vals = np.concatenate(edges)
        rows.append({
            "role": role,
            "triangles": int(mask.sum()),
            "edges": int(vals.size),
            "area_m2": float(area.sum()),
            "uv_area": float(uv_area.sum()),
            "area_px_per_m": float(ATLAS * np.sqrt(uv_area.sum() / area.sum())) if area.sum() else None,
            "median_px_per_m": float(np.median(vals)),
            "p10_px_per_m": float(np.percentile(vals, 10)),
            "p90_px_per_m": float(np.percentile(vals, 90)),
        })
    return rows


try:
    bpy.context.preferences.edit.use_global_undo = False
    bpy.context.preferences.edit.undo_steps = 0
    bpy.context.preferences.filepaths.save_version = 0
except Exception:
    pass

blend_sha = sha256_file(BLEND)
bpy.ops.wm.open_mainfile(filepath=BLEND)
try:
    bpy.context.preferences.filepaths.save_version = 0
except Exception:
    pass

report = {
    "mode": MODE,
    "blend": BLEND,
    "blend_sha256": blend_sha,
    "blender": bpy.app.version_string,
    "skip_density": SKIP_DENSITY,
}

# UV / atlas
uv_violations = []
uv_global_min = [1e9, 1e9]
uv_global_max = [-1e9, -1e9]
lod0_uv = []
atlas_images = {}
modifiers = []
for coll in bpy.data.collections:
    if not coll.name.startswith("lark"):
        continue
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        names = [layer.name for layer in obj.data.uv_layers]
        if names != ["UVMap"]:
            uv_violations.append({"collection": coll.name, "object": obj.name, "uvs": names})
        if obj.modifiers:
            modifiers.append({"collection": coll.name, "object": obj.name, "modifiers": [m.type for m in obj.modifiers]})
        if coll.name.endswith("_LOD0"):
            fp = uv_fingerprint(obj.data)
            if fp and fp["min"]:
                for axis in (0, 1):
                    uv_global_min[axis] = min(uv_global_min[axis], fp["min"][axis])
                    uv_global_max[axis] = max(uv_global_max[axis], fp["max"][axis])
            lod0_uv.append({"collection": coll.name, "object": obj.name, "uv": fp, "materials": [
                {"name": slot.material.name, "engine": slot.material.get("engine_name"), "images": [
                    n.image.name for n in slot.material.node_tree.nodes
                    if slot.material.use_nodes and n.type == "TEX_IMAGE" and n.image
                ]} if slot.material else None
                for slot in obj.material_slots
            ]})
            for slot in obj.material_slots:
                mat = slot.material
                if not mat or not mat.use_nodes:
                    continue
                for node in mat.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image:
                        im = node.image
                        atlas_images[im.name] = {"size": [int(im.size[0]), int(im.size[1])], "colorspace": im.colorspace_settings.name}

report["uv"] = {
    "single_uvmap_violations": uv_violations,
    "lod0_global_min": None if uv_global_min[0] > 1e8 else uv_global_min,
    "lod0_global_max": None if uv_global_max[0] < -1e8 else uv_global_max,
    "atlas_images": atlas_images,
    "modifiers": modifiers,
    "lod0_meshes": lod0_uv,
}

fit_props = []
for block in list(bpy.data.scenes) + list(bpy.data.objects):
    for key in block.keys():
        if "fit" in str(key).lower() or "force_fit" in str(key).lower():
            fit_props.append({"id": block.name, "key": str(key)})
report["force_fit_custom_props"] = fit_props

# density
if not SKIP_DENSITY:
    density = []
    for coll in bpy.data.collections:
        if not (coll.name.startswith("lark") and coll.name.endswith("_LOD0")):
            continue
        for obj in coll.objects:
            if obj.type != "MESH":
                continue
            for row in density_rows(obj):
                row["key"] = f"{coll.name}/{obj.name}/{row['role']}"
                density.append({k: row[k] for k in (
                    "key", "triangles", "edges", "area_m2", "uv_area", "area_px_per_m",
                    "median_px_per_m", "p10_px_per_m", "p90_px_per_m",
                )})
                print("DENSITY", row["key"], round(row["median_px_per_m"], 3), flush=True)
    medians = [r["median_px_per_m"] for r in density]
    report["density"] = {
        "atlas_pixels": ATLAS,
        "uv_layer": "UVMap",
        "roles": len(medians),
        "min_median": float(min(medians)) if medians else None,
        "min_key": min(density, key=lambda r: r["median_px_per_m"])["key"] if density else None,
        "max_median": float(max(medians)) if medians else None,
        "rows": density,
    }

# LOD topology
lods = {}
bodies = []
for state in ("lark", "lark_damaged", "lark_husked"):
    for lod in range(4):
        name = f"{state}_LOD{lod}"
        coll = bpy.data.collections.get(name)
        if coll is None:
            continue
        meshes = [o for o in coll.objects if o.type == "MESH"]
        tris = sum(tri_count(o.data) for o in meshes)
        lods[name] = {"meshes": len(meshes), "tris": tris, "objects": [o.name for o in meshes]}
        for obj in meshes:
            if obj.name.startswith("Body"):
                stats = boundary_stats(obj.data)
                stats.update({"collection": name, "object": obj.name, "tris": tri_count(obj.data), "verts": len(obj.data.vertices)})
                bodies.append(stats)
                print("BODY", name, obj.name, stats["tris"], "boundary_ratio", stats["boundary_ratio"], flush=True)
report["lods"] = lods
report["bodies"] = bodies

# markers / canopy
markers = []
for obj in bpy.data.objects:
    if obj.type != "EMPTY":
        continue
    if obj.name.startswith(("BAY_", "Canopy")):
        mw = obj.matrix_world
        markers.append({
            "name": obj.name,
            "parent": obj.parent.name if obj.parent else None,
            "location": [float(v) for v in obj.location],
            "world_translation": [float(mw.translation.x), float(mw.translation.y), float(mw.translation.z)],
            "world_matrix": [float(v) for row in mw for v in row],
        })
report["markers"] = markers

glasses = []
for name in ("CanopyGlass", "CanopyGlass_dmg", "CanopyGlass_husk"):
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != "MESH":
        continue
    pts = np.array([obj.matrix_world @ v.co for v in obj.data.vertices], np.float64)
    glasses.append({
        "name": name,
        "world_min": pts.min(axis=0).tolist(),
        "world_max": pts.max(axis=0).tolist(),
    })
report["canopy_glass_bounds"] = glasses

# images
wanted = (
    "lark_husked_4k_density_baseColor",
    "lark_husked_4k_emissive",
    "lark_damaged_Glass_baseColor",
    "lark_4k_density_baseColor",
    "lark_4k_density_ORM",
    "lark_4k_density_normal",
    "lark_damaged_4k_density_baseColor",
    "lark_husked_4k_density_ORM",
    "lark_husked_4k_density_normal",
)
colors = {}
for name in wanted:
    im = bpy.data.images.get(name)
    if im is None:
        colors[name] = None
        continue
    print("COLOR", name, tuple(im.size), flush=True)
    colors[name] = image_color_stats(im)
report["colors"] = colors

hashes = {}
for im in bpy.data.images:
    if max(int(im.size[0]), int(im.size[1])) < 1024 or im.packed_file is None:
        continue
    hashes[im.name] = {"size": [int(im.size[0]), int(im.size[1])], **packed_hash(im)}
    print("HASH", im.name, hashes[im.name]["packed_bytes"], flush=True)
report["packed_images"] = hashes

with open(OUT, "w") as f:
    json.dump(report, f)
print("WROTE", OUT, flush=True)
