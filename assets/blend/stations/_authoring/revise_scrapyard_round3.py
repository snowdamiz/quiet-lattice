"""Third-submission art edits, applied once to a verified copy of the saved Scrapyard source.

This is an authoring operation, never an export hook. It preserves the source's placed sockets,
light markers and existing collision volumes. The revised result is saved and reviewed as a .blend.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit as K
import paint as P
import sy_kit as S

args = sys.argv[sys.argv.index("--") + 1:]
source, output, report, texture_dir = map(Path, args)
EXPECTED = "6d036d0d1b497fbaf14aefe7bed3fd07d31e4f0e5ad454ffc71ca6fdf93c8a63"
assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED
assert not output.exists(), "Patch only an original verified source copy into a new output."
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
texture_dir.mkdir(parents=True, exist_ok=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def marker_state():
    return {o.name: {"matrix": [list(row) for row in o.matrix_world],
                     "properties": {k: v.to_list() if hasattr(v, "to_list") else v for k, v in o.items()},
                     "mesh": [list(v.co) for v in o.data.vertices] if o.type == "MESH" else None}
            for o in bpy.data.objects if o.name.startswith(("COL_", "Socket_", "Light_", "Interact", "BAY_"))}


original_markers = marker_state()
edits = []


def geological_sheet(name, dust):
    """Low-contrast mineral beds and a few directed fractures, without stepped contour noise."""
    sheet = P.Sheet(name, 731 if not dust else 737)
    st = P.Strip(sheet, 0, P.N)
    u, v = st.u / 8.0, st.v / 8.0
    broad = st.noise(3, 3, 0.45)
    grain = st.noise(180, 2) - 0.5
    beds = np.sin((v * 0.8 + u * 0.23) * math.pi * 3 + broad * 0.4)
    tone = 0.94 + (broad - 0.5) * 0.22 + beds * 0.035 + grain * 0.025
    rock = P.col(P.srgb("#615c55"), u.shape) * tone[..., None]
    mineral = np.exp(-((v - 0.22 - 0.17 * u - broad * 0.04) / 0.025) ** 2)
    mineral += np.exp(-((v - 0.71 + 0.09 * u + broad * 0.025) / 0.018) ** 2) * 0.6
    rock = P.mix(rock, P.col(P.srgb("#797366"), u.shape), np.clip(mineral * 0.22, 0, 0.3))
    fissures = np.zeros_like(u)
    # Local fracture strokes have endpoints and branches. They do not form an all-over contour network.
    strokes = [((0.08, 0.12), (0.30, 0.43), 0.003), ((0.30, 0.43), (0.23, 0.68), 0.002),
               ((0.30, 0.43), (0.54, 0.49), 0.0018), ((0.70, 0.11), (0.61, 0.37), 0.0025),
               ((0.61, 0.37), (0.83, 0.64), 0.003), ((0.83, 0.64), (0.76, 0.88), 0.0015),
               ((0.10, 0.82), (0.39, 0.77), 0.0018)]
    for a, b, width in strokes:
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = np.clip(((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
        distance = np.sqrt((u - a[0] - t * dx) ** 2 + (v - a[1] - t * dy) ** 2)
        fissures = np.maximum(fissures, np.exp(-(distance / width) ** 2))
    height = (broad - 0.5) * 0.075 + grain * 0.045 - fissures * 0.12
    rock = P.mix(rock, P.col(P.srgb("#37332f"), u.shape), fissures * (0.23 if dust else 0.5))
    if dust:
        # The same mineral family remains visible through deposited grit, avoiding a flat painted patch.
        grit = st.noise(340, 2)
        rock = rock * 0.5 + P.col(P.srgb("#565047"), u.shape) * (0.93 + grit[..., None] * 0.12) * 0.5
        height = height * 0.25 + (grit - 0.5) * 0.060
    st.set(base=rock, rough=(0.91 if dust else 0.78) + (broad - 0.5) * 0.035,
           metal=0.0, height=height)
    sheet.finish(normal_strength=6.0 if not dust else 4.5, cavity=0.25)
    return sheet


painted_maps = []
for name, dust in (("SY_Rock", False), ("SY_Regolith", True)):
    sheet = geological_sheet(name, dust)
    values = {"base": P.to_srgb(sheet.base),
              "orm": np.stack([sheet.ao, sheet.rough, sheet.metal], axis=-1), "normal": sheet.normal}
    for channel, pixels in values.items():
        path = texture_dir / f"{name}_{channel}.png"
        P.save_png(str(path.resolve()), pixels)
        mat = bpy.data.materials[name]
        target = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and
                      n.image.name.split(".")[0] == f"{name}_{channel}")
        image = bpy.data.images.load(str(path.resolve()), check_existing=False)
        image.name = f"{name}_{channel}_round3"
        image.colorspace_settings.name = "sRGB" if channel == "base" else "Non-Color"
        image.pack()
        target.image = image
        painted_maps.append({"path": str(path), "sha256": digest(path), "size": list(image.size)})

# Close-valued intermediate materials share the exact full-resolution rock maps. No atlas resolution is reduced.
# Constant multipliers are represented directly in glTF; they do not require a procedural GPU bake.
dust_materials = [bpy.data.materials["SY_Rock"]]
for step in range(1, 6):
    material = bpy.data.materials["SY_Rock"].copy()
    material.name = f"SY_GeoDust{step}"
    nt = material.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    old = bsdf.inputs["Base Color"].links[0].from_socket
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    mix.inputs[2].default_value = (1 - step * 0.026, 1 - step * 0.03, 1 - step * 0.035, 1)
    nt.links.new(old, mix.inputs[1])
    nt.links.new(mix.outputs[0], bsdf.inputs["Base Color"])
    old_rough = bsdf.inputs["Roughness"].links[0].from_socket
    multiply = nt.nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    multiply.inputs[1].default_value = 1 + step * 0.025
    nt.links.new(old_rough, multiply.inputs[0])
    nt.links.new(multiply.outputs[0], bsdf.inputs["Roughness"])
    dust_materials.append(material)
dust_materials.append(bpy.data.materials["SY_Regolith"])


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def soften_geology(obj):
    mesh = obj.data
    natural = {i for i, m in enumerate(mesh.materials) if m.name in {"SY_Rock", "SY_Regolith"}}
    slots = []
    for material in dust_materials:
        if material.name not in [m.name for m in mesh.materials]:
            mesh.materials.append(material)
        slots.append(next(i for i, m in enumerate(mesh.materials) if m == material))
    changed = 0
    for polygon in mesh.polygons:
        if polygon.material_index not in natural:
            continue
        centre = polygon.center
        radius = centre.length
        direction = np.array(centre) / max(radius, 0.001)
        interior = radius < S.radius(direction) * 0.83
        # Deposits follow the lower cavity and sheltered lower exterior, with a gradual 12–20 m transition.
        mask = smooth(0, 1, (-centre.z - (7 if interior else 19)) / (18 if interior else 16))
        mask *= 0.80 + 0.20 * math.sin(centre.x * 0.043 + centre.y * 0.025)
        if not interior:
            mask *= smooth(-55, -25, centre.y)
        polygon.material_index = slots[min(6, int(mask * 7))]
        if interior or centre.y < -62:
            polygon.use_smooth = False
        changed += 1
    mesh.update()
    return changed


def append_mesh(asset, lod, name, mesh):
    if not mesh.faces:
        return None
    obj = mesh.build(f"{asset}_{name}_R3_L{lod}", bpy.data.collections[f"{asset}_LOD{lod}"])
    obj["round3_authored_part"] = name
    return obj


def delete_faces(obj, predicate):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    remove = [f for f in bm.faces if predicate([Vector(v.co) for v in f.verts])]
    bmesh.ops.delete(bm, geom=remove, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(remove)


def salvage_crate(mesh, lod, xf, variant):
    # Chamfered cargo casing, shoulder lid, corner boots and bound carrying straps, within the old collider.
    outline = [(-0.68, -0.46), (-0.46, -0.68), (0.46, -0.68), (0.68, -0.46),
               (0.68, 0.46), (0.46, 0.68), (-0.46, 0.68), (-0.68, 0.46)]
    local = K.Mesh()
    for i, a in enumerate(outline):
        b = outline[(i + 1) % len(outline)]
        K.patch(local, [[(*a, 0.10), (*a, 0.84)], [(*b, 0.10), (*b, 0.84)]],
                "SY_Scrap", "hull" if (i + variant) % 3 else "oxide", away=(0, 0, 0.45))
        K.patch(local, [[(*a, 0.84), (a[0] * 0.79, a[1] * 0.79, 1.06)],
                        [(*b, 0.84), (b[0] * 0.79, b[1] * 0.79, 1.06)]], "SY_Scrap", "patch")
    K.planar(local, [(x * 0.79, y * 0.79, 1.06) for x, y in outline], "SY_Scrap")
    if lod < 3:
        for x in (-0.43, 0.43):
            K.box(local, (x - 0.055, -0.69, 0.12), (x + 0.055, -0.66, 0.87), "SY_Scrap", "girder")
            K.box(local, (x - 0.055, -0.54, 1.055), (x + 0.055, 0.54, 1.09), "SY_Scrap", "girder")
        for x in (-0.53, 0.53):
            for y in (-0.53, 0.53):
                K.box(local, (x - 0.12, y - 0.12, 0), (x + 0.12, y + 0.12, 0.19), "SY_Scrap", "girder")
        K.box(local, (-0.21, -0.695, 0.39), (0.21, -0.66, 0.59), "SY_Scrap", "burn")
        if lod == 0:
            K.tube(local, [(-0.27, -0.68, 0.67), (-0.27, -0.69, 0.77), (0.27, -0.69, 0.77), (0.27, -0.68, 0.67)],
                   0.025, 6, "SY_Scrap", "girder")
    mesh.extend(local, xf)


def salvage_barrier(mesh, lod, xf, variant):
    # A recovered shell shield around a curved fused lattice, not a rectangular block.
    local = K.Mesh()
    xs = np.linspace(-1.37, 1.37, 9 if lod < 2 else 7)
    for i in range(len(xs) - 1):
        a, b = xs[i:i + 2]
        top = lambda x: 0.9 + 0.32 * (1 - (x / 1.4) ** 2)
        K.patch(local, [[(a, -0.10, 0.16), (a, -0.10, top(a))],
                        [(b, -0.10, 0.16), (b, -0.10, top(b))]], "SY_Scrap", "hull" if i % 3 else "patch")
    if lod < 3:
        for z in (0.18, 0.62, 0.94):
            pts = [(x, -0.113, min(z, 0.84 + 0.30 * (1 - (x / 1.4) ** 2))) for x in xs]
            K.tube(local, pts, 0.026, 5 if lod == 0 else 4, "SY_Scrap", "girder")
        for x in (-1.26, 0, 1.26):
            K.member(local, (x, 0.025, 0.02), (x * 0.82, 0.025, 1.18 - abs(x) * 0.15), 0.055,
                     "SY_Scrap", "hull", lod, bow=0.045, bow_dir=(1, 0, 0), fillet=1.6)
        for a, b in ((-1.2, 0), (0, 1.2)):
            K.member(local, (a, 0.035, 0.15), (b, 0.035, 1.02), 0.045,
                     "SY_Scrap", "girder", lod, bow=0.03, bow_dir=(0, 0, 1))
    mesh.extend(local, xf)


def restored_ring(asset, lod):
    obj = next(o for o in bpy.data.collections[f"{asset}_LOD{lod}"].objects if o.type == "MESH")
    radius = 18.0 if asset == "sy_dock_l" else 12.5
    cy = -radius - 4.5
    def on_circle(v):
        return abs(math.hypot(v.x, v.y - cy) - radius) < 0.02
    def surface(points):
        z = [v.z for v in points]
        top = min(z) >= -0.002 and max(z) <= 0.081 and all(math.hypot(v.x, v.y - cy) <= radius + 0.02 for v in points)
        rim = all(on_circle(v) for v in points) and min(z) >= -1.201 and max(z) <= 0.081
        bottom = max(z) - min(z) < 0.002 and abs(z[0] + 1.2) < 0.002 and all(on_circle(v) for v in points)
        return top or rim or bottom
    removed = delete_faces(obj, surface)
    mesh = K.Mesh()
    # All three useful LODs use the same 48-point circle and phase, retaining the major outline.
    angles = np.linspace(0, 2 * math.pi, 49)[:-1] + math.pi / 48
    top = [(math.cos(a) * radius, cy + math.sin(a) * radius, 0) for a in angles]
    bottom = [(x, y, -1.2) for x, y, _ in top]
    K.planar(mesh, top, "SY_Grate")
    K.planar(mesh, bottom[::-1], "SY_Scrap", toward=(0, cy, -3))
    for k, a in enumerate(angles):
        j = (k + 1) % 48
        b = angles[j]
        K.patch(mesh, [[bottom[k], top[k]], [bottom[j], top[j]]], "SY_Scrap",
                "hazard" if math.sin(a) < -0.55 else "oxide", away=(0, cy, -0.6))
        for r0, r1, key in ((radius - 2, radius - 0.5, "patch"), (radius * 0.25, radius * 0.82, "burn")):
            K.patch(mesh, [[(math.cos(a) * r0, cy + math.sin(a) * r0, 0.07), (math.cos(a) * r1, cy + math.sin(a) * r1, 0.07)],
                           [(math.cos(b) * r0, cy + math.sin(b) * r0, 0.07), (math.cos(b) * r1, cy + math.sin(b) * r1, 0.07)]],
                    "SY_Scrap", key, toward=lambda c: c + np.array([0, 0, 1]))
    append_mesh(asset, lod, "CircularRim", mesh)
    return removed


def recovered_bulkhead(mesh, lod, large=False):
    # Large recognizable source parts remain under the Reaches repair plates on both sides of the anchor wall.
    for side in (-1, 1):
        for x in (-4.1, 4.1):
            shell = K.Mesh()
            S.hull_panel(shell, 3.3, -5.1, 5.1, 0, lod)
            scale = Matrix.Diagonal((1.0, 1.0, 0.18, 1.0))
            xf = Matrix.Translation((x, -0.78 if side < 0 else 0.04, -6.0)) @ Matrix.Rotation(side * -math.pi / 2, 4, "X") @ scale
            mesh.extend(shell, xf)
        for x in (-7.1, 0, 7.1):
            K.chord(mesh, [(x, side * 0.3 - 0.3, -13), (x * 0.75, side * 0.5 - 0.3, -6.0), (x * 0.9, side * 0.3 - 0.3, 1.5)],
                    0.23, "SY_Scrap", "hull", lod, nodes=(0, 1, 2), node_scale=1.7)
        if lod < 2:
            for x in (-4.2, 4.2):
                K.crystal_insert(mesh, (x, -1.05 if side < 0 else 0.32, -1.7), (0, side, 0), (1, 0, 0),
                                 2.4, 1.35, lod, seed=31, mats=("SY_Scrap", "girder", "SY_Glass", "SY_Glass"))
        else:
            K.crystal_insert(mesh, (4.2, -1.05 if side < 0 else 0.32, -1.7), (0, side, 0), (1, 0, 0),
                             2.4, 1.35, lod, seed=31, mats=("SY_Scrap", "girder", "SY_Glass", "SY_Glass"))


for lod in range(4):
    obj = next(o for o in bpy.data.collections[f"sy_deck_LOD{lod}"].objects if o.type == "MESH")
    removed = 0
    for k, xf in S.cover_layout():
        inverse = xf.inverted()
        def old_cover(points, inverse=inverse):
            pts = [inverse @ p for p in points]
            return all(-1.5 < p.x < 1.5 and -0.82 < p.y < 0.82 and -0.001 <= p.z <= 1.4 for p in pts)
        removed += delete_faces(obj, old_cover)
    additions = K.Mesh()
    for k, xf in S.cover_layout():
        (salvage_barrier if k % 2 else salvage_crate)(additions, lod, xf, k)
    if lod < 3:
        # A salvaged lapped shell breastplate and fused chitin frame interrupt the container's industrial box.
        panel = K.Mesh()
        S.hull_panel(panel, 1.4, -1.15, 1.15, 0, lod)
        additions.extend(panel, Matrix.Translation((4.6, -6.45, 1.45)) @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Diagonal((1, 1, 0.16, 1)))
        for x in (3.15, 5.95, 9.15, 11.85):
            K.chord(additions, [(x, -6.40, 0.15), (x + (0.25 if x < 7 else -0.25), -6.5, 1.4), (x, -6.38, 2.75)],
                    0.13, "SY_Scrap", "hull", lod, nodes=(0, 1, 2), node_scale=1.8)
        K.crystal_insert(additions, (11.5, -3.15, 1.55), (0, 1, 0), (1, 0, 0), 1.6, 1.3,
                         lod, seed=41, mats=("SY_Scrap", "girder", "SY_Glass", "SY_Glass"))
    append_mesh("sy_deck", lod, "SalvageBarriersAndHold", additions)
    edits.append({"asset": "sy_deck", "lod": lod, "old_cover_faces_removed": removed})

for asset in ("sy_dock", "sy_dock_l"):
    for lod in range(3):
        removed = restored_ring(asset, lod)
        mesh = K.Mesh()
        recovered_bulkhead(mesh, lod, asset.endswith("_l"))
        append_mesh(asset, lod, "RecoveredBulkhead", mesh)
        edits.append({"asset": asset, "lod": lod, "ring_faces_removed": removed, "ring_segments": 48})


def rock_wedge(mesh, centre, tangent, vertical, width, height, depth, variant):
    """A fractured solid with deliberately unequal cut faces, seated partly into the existing rock."""
    centre, tangent, vertical = map(lambda x: np.array(x, float), (centre, tangent, vertical))
    normal = np.cross(tangent, vertical)
    normal /= np.linalg.norm(normal)
    outline = [(-0.52, -0.43), (0.12, -0.53), (0.51, -0.19), (0.38, 0.38), (-0.21, 0.51), (-0.48, 0.17)]
    front = [centre + tangent * x * width + vertical * y * height + normal * depth * (0.2 if i % 2 else 0.65)
             for i, (x, y) in enumerate(outline)]
    back = [p - normal * depth for p in front]
    point = centre + normal * depth * 0.9 + tangent * width * 0.10
    for i in range(6):
        j = (i + 1) % 6
        pts = [front[i], front[j], point]
        mesh.add(pts, [(p[0] / 18, p[2] / 18) for p in pts], "SY_Rock", False, toward=centre + normal * 10)
        pts = [front[i], back[i], back[j], front[j]]
        mesh.add(pts, [(p[0] / 18, p[2] / 18) for p in pts], "SY_Regolith" if (i + variant) % 5 == 0 else "SY_Rock", False)


rock0 = next(o for o in bpy.data.collections["sy_rock_LOD0"].objects if o.type == "MESH")
natural_faces = soften_geology(rock0)
fractures = K.Mesh()
# Authored fracture stations around the entrance; the frames and sockets are left exactly where they were.
for k, phi in enumerate((-2.9, -2.42, -1.96, -1.48, -0.98, -0.43, 0.14, 0.66, 1.19, 1.76, 2.28, 2.76)):
    direction = S._dir(S.mouth_theta(phi) + 0.025, phi)
    centre = direction * S.radius(direction)
    tangent = np.array([-math.sin(phi), 0, math.cos(phi)])
    vertical = np.cross(direction, tangent)
    vertical /= np.linalg.norm(vertical)
    rock_wedge(fractures, centre, tangent, vertical, 8 + k % 4 * 1.6, 6 + k % 3 * 1.8, 2.5, k)
    inner = S._dir(S.mouth_theta(phi, True) + 0.16, phi)
    ic = inner * S.radius(inner, True)
    rock_wedge(fractures, ic, -tangent, vertical, 7 + k % 3 * 1.7, 5.5, 1.5, k + 1)
# Fracture debris is attached to the lower entrance, outside all existing dock and deck socket routes.
for k, phi in enumerate((-2.15, -1.85, -1.57, -1.30, -1.02)):
    direction = S._dir(S.mouth_theta(phi, True) + 0.035, phi)
    centre = direction * S.radius(direction, True)
    rock_wedge(fractures, centre, (1, 0, 0), (0, 0, 1), 3.0 + k * 0.35, 2.0 + k % 2, 2.2, k)
fracture_obj = append_mesh("sy_rock", 0, "FractureFacesAndDebris", fractures)
soften_geology(fracture_obj)

# Bake neither geometry nor textures here. Simplification is a saved-source authoring step from the actual revised
# high-resolution rock, retaining the same crater field instead of resampling it on a very sparse angular grid.
bpy.ops.object.select_all(action="DESELECT")
rock0.select_set(True)
fracture_obj.select_set(True)
bpy.context.view_layer.objects.active = rock0
bpy.ops.object.join()
rock0 = bpy.context.view_layer.objects.active
lod_counts = []
for lod, ratio in ((1, 0.67), (2, 0.40)):
    collection = bpy.data.collections[f"sy_rock_LOD{lod}"]
    for old in list(collection.objects):
        if old.type == "MESH":
            bpy.data.objects.remove(old, do_unlink=True)
    copy = bpy.data.objects.new(f"sy_rock_L{lod}", rock0.data.copy())
    collection.objects.link(copy)
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.select_all(action="DESELECT")
    copy.select_set(True)
    modifier = copy.modifiers.new("R3_RetainMajorRelief", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    lod_counts.append({"lod": lod, "triangles": sum(len(p.vertices) - 2 for p in copy.data.polygons)})
rock3 = next(o for o in bpy.data.collections["sy_rock_LOD3"].objects if o.type == "MESH")
soften_geology(rock3)

assert original_markers == marker_state(), "Existing collision meshes, sockets, interact/bay/light markers must not move."
bpy.context.scene["station_submission"] = 3
bpy.context.scene["round3_scope"] = "Saved-source salvage language, shaped cover, geological maps/transitions, fractured entrance/cavity and relief-preserving LOD2."
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
summary = {"input_sha256": EXPECTED, "output_sha256": digest(output), "edits": edits,
           "geological_faces_reassigned": natural_faces, "geological_maps": painted_maps,
           "rock_lods": lod_counts, "existing_markers_and_colliders_unchanged": True,
           "existing_cover_collider_count": 7, "new_geometry": "Saved in output .blend; never regenerated at export.",
           "GPU_GATE": "CLOSED", "bake_note": "Direct 2k PBR images plus constant material factors. Verify pending-bake lists before export."}
report.write_text(json.dumps(summary, indent=2) + "\n")
print("SAVED", output)
