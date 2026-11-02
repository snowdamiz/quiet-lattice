"""Sculpt and dress the saved Scrapyard geology named by the third visual verdict.

Patches the actual source once, preserves other modules/markers, and saves every authored LOD.
Export never invokes this authoring operation. Four 2k PBR regions are direct image maps, with no bake.
"""
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit as K
import paint as P
import sy_kit as S
from round4_common import compare, digest, save_report, snapshot

source, output, report, maps = map(Path, sys.argv[sys.argv.index("--") + 1:])
EXPECTED = "e9354909ea92b046da886af3b3aba1632b42b827e2ad5ffcc1fac253eb00be03"
assert digest(source) == EXPECTED
assert not output.exists(), "Retain earlier attempts; use a fresh staged output"
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
before = snapshot()
maps.mkdir(parents=True, exist_ok=False)


def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def sculpt(point):
    p = np.asarray(point, float).copy()
    r = np.linalg.norm(p)
    if r < 1e-6:
        return p
    d = p / r
    q = r / S.radius(d)
    outer = float(smooth(0.80, 0.97, q))
    original = p.copy()
    # A cleaved starboard shoulder and oblique broken stern replace the rounded primitive outline.
    for normal, limit in ((np.array([1, 0.18, 0.42]), 68),
                          (np.array([-1, 0.10, -0.32]), 69),
                          (np.array([0.32, 1, 0.29]), 113),
                          (np.array([0.18, -0.05, 1]), 69)):
        excess = float(np.dot(normal, p) - limit)
        if excess > 0:
            p -= normal * excess / float(np.dot(normal, normal)) * outer
    buttress = max(0, float(np.dot(d, np.array([-0.68, -0.24, 0.69])))) ** 7
    cleft = float(smooth(-7, 1, original[0] + original[1] * 0.28 - 14))
    cleft *= 1 - float(smooth(12, 31, abs(original[2] - 15)))
    p += d * outer * (10 * buttress - 6 * cleft)
    # The lip opens as a displaced broken brow, without narrowing the ship approach.
    rho = math.hypot(original[0], original[2])
    theta = math.acos(float(np.clip(-d[1], -1, 1)))
    phi = math.atan2(original[2], original[0])
    mouth = (1 - float(smooth(0.55, 0.85, theta))) * float(smooth(18, 25, rho))
    lift = mouth * (2.0 + 7.5 * max(0, math.sin(phi - 0.35)) ** 3 + 4.0 * max(0, -math.cos(phi)) ** 4)
    if rho > 0:
        p[0] += original[0] / rho * lift
        p[2] += original[2] / rho * lift
        p[1] += mouth * (3.8 * math.cos(phi + 0.7) - 2.0)
    return p


REGIONS = (("SY_Rock", "#535b60", 0.66, 0.13, 191),
           ("SY_Regolith", "#96846b", 0.94, 0.045, 193),
           ("SY_Fracture_R4", "#303438", 0.84, 0.18, 197),
           ("SY_Excavated_R4", "#777f7d", 0.73, 0.10, 199))
map_records = []
for name, color, roughness, relief, seed in REGIONS:
    sheet = P.Sheet(name, seed)
    st = P.Strip(sheet, 0, P.N)
    u, v = st.u / 8, st.v / 8
    broad = st.noise(5, 3, 0.52)
    chips = st.noise(38, 3, 0.54)
    grain = st.noise(280, 2) - 0.5
    diagonal = v + u * 0.32 + (broad - 0.5) * 0.08
    mineral = np.exp(-(np.sin(diagonal * math.pi * 5 + 0.7) / 0.075) ** 2)
    seams = np.exp(-(np.sin((u * 0.75 - v * 0.41 + broad * 0.05) * math.pi * 4) / 0.026) ** 2)
    base = P.col(P.srgb(color), u.shape) * (0.78 + broad * 0.40 + (chips - 0.5) * 0.16)[..., None]
    base = P.mix(base, P.col(P.srgb("#a79f89"), u.shape), mineral * (0.24 if name == "SY_Rock" else 0.09))
    base = P.mix(base, P.col(P.srgb("#20282c"), u.shape), seams * 0.46)
    height = (chips - 0.5) * relief + grain * relief * 0.65 - seams * 0.22 + mineral * 0.035
    if name == "SY_Regolith":
        height = (chips - 0.5) * 0.018 + grain * 0.035
        base *= (0.96 + grain * 0.10)[..., None]
    elif name == "SY_Excavated_R4":
        cuts = np.sin((v * 145 + u * 21) * math.pi * 2)
        interrupted = (0.4 + chips * 0.6)
        height += cuts * 0.035 * interrupted
        base *= (0.95 + cuts * 0.045 * interrupted)[..., None]
    st.set(base=base, rough=np.clip(roughness + (chips - 0.5) * 0.12, 0, 1), metal=0, height=height)
    sheet.finish(normal_strength=12, cavity=0.45)
    if name not in bpy.data.materials:
        material = bpy.data.materials["SY_Rock"].copy()
        material.name = name
    material = bpy.data.materials[name]
    # Reuse the existing PBR graph and its AO routing; remove old factor nodes only in new region copies.
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    images = [n for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    for channel, pixels in (("base", P.to_srgb(sheet.base)),
                            ("orm", np.stack([sheet.ao, sheet.rough, sheet.metal], -1)),
                            ("normal", sheet.normal)):
        path = maps / f"{name}_{channel}.png"
        P.save_png(str(path.resolve()), pixels)
        image = bpy.data.images.load(str(path.resolve()), check_existing=False)
        image.name = f"{name}_{channel}_round4"
        image.colorspace_settings.name = "sRGB" if channel == "base" else "Non-Color"
        image.pack()
        target = next(n for n in images if f"_{channel}" in n.image.name)
        target.image = image
        map_records.append({"path": str(path), "sha256": digest(path), "size": list(image.size), "region": name})
    del sheet, st, base, height

natural_names = {"SY_Rock", "SY_Regolith", *(f"SY_GeoDust{k}" for k in range(1, 6))}
rock0 = bpy.data.objects["sy_rock_L0"]
changed_names = [f"sy_rock_L{k}" for k in range(4)]
old_counts = [sum(len(p.vertices) - 2 for p in bpy.data.objects[n].data.polygons) for n in changed_names]


def assign_regions(obj):
    mesh = obj.data
    names = [m.name for m in mesh.materials]
    natural = {i for i, n in enumerate(names) if n in natural_names or n.endswith("_R4")}
    slots = {}
    for name, *_ in REGIONS:
        if name not in names:
            mesh.materials.append(bpy.data.materials[name])
            names.append(name)
        slots[name] = names.index(name)
    counts = {}
    for p in mesh.polygons:
        if p.material_index not in natural:
            continue
        c = np.asarray(p.center)
        r = np.linalg.norm(c)
        inner = r < S.radius(c / max(r, 0.001)) * 0.81
        plane = abs(c[2] + c[0] * 0.29 + c[1] * 0.15 - 14)
        sheltered = c[2] < -19 and p.normal.z > 0.12
        worked = inner and (c[1] < -26 or (c[0] > 28 and c[1] > 5))
        name = "SY_Excavated_R4" if worked else "SY_Rock"
        if sheltered:
            name = "SY_Regolith"
        if plane < 1.35 or (inner and c[1] > 25 and c[2] > 4):
            name = "SY_Fracture_R4"
        p.material_index = slots[name]
        p.use_smooth = not (plane < 5 or c[1] < -67 or worked)
        counts[name] = counts.get(name, 0) + 1
    mesh.update()
    return counts


def warp_mesh(obj, natural_only=False):
    if natural_only:
        indices = {i for p in obj.data.polygons if obj.data.materials[p.material_index].name in natural_names for i in p.vertices}
    else:
        indices = range(len(obj.data.vertices))
    inverse = obj.matrix_world.inverted()
    displacement = []
    for index in indices:
        v = obj.data.vertices[index]
        old = obj.matrix_world @ v.co
        new = Vector(sculpt(old))
        displacement.append((new - old).length)
        v.co = inverse @ new
    obj.data.update()
    return {"vertices": len(displacement), "maximum_displacement_m": max(displacement, default=0)}


# Surface-mounted recovered panels/towers move with their geological foundation, keeping their materials intact.
sculpt_record = warp_mesh(rock0)
region_counts = assign_regions(rock0)
collider_records = []
for obj in bpy.data.objects:
    if obj.name.startswith("COL_Rock_"):
        collider_records.append({"name": obj.name, **warp_mesh(obj)})
        changed_names.append(obj.name)

geo = K.Mesh()
collision_additions = []
slab_records = []


def slab(center, normal, tangent, width, height, depth, label, surface="SY_Rock", collision=True):
    center, normal, tangent = (np.asarray(x, float) for x in (center, normal, tangent))
    normal /= np.linalg.norm(normal)
    tangent -= normal * np.dot(normal, tangent)
    tangent /= np.linalg.norm(tangent)
    up = np.cross(normal, tangent)
    shape = [(-0.56, -0.27), (-0.33, -0.51), (0.19, -0.43), (0.54, -0.12),
             (0.38, 0.42), (-0.09, 0.51), (-0.48, 0.22)]
    front = [center + tangent * x * width + up * y * height + normal * depth * (0.43 + (i % 3) * 0.11)
             for i, (x, y) in enumerate(shape)]
    back = [center + tangent * x * width + up * y * height - normal * depth * 0.75 for x, y in shape]
    piece = K.Mesh()
    top = center + normal * depth * 0.68 + tangent * width * 0.11
    for i in range(7):
        j = (i + 1) % 7
        pts = [front[i], front[j], top]
        axes = [k for k in range(3) if k != int(np.argmax(abs(normal)))]
        uv = lambda points: [(p[axes[0]] / 18, p[axes[1]] / 18) for p in points]
        piece.add(pts, uv(pts), surface, False, toward=center + normal * depth * 3)
        pts = [front[i], back[i], back[j], front[j]]
        piece.add(pts, uv(pts), "SY_Fracture_R4" if i % 3 else "SY_Regolith", False, away=center)
    piece.add(back[::-1], uv(back[::-1]), "SY_Fracture_R4", False, toward=center - normal * depth * 3)
    geo.extend(piece, Matrix.Identity(4))
    if collision:
        collision_additions.append((label, piece))
    slab_records.append({"label": label, "center": center.tolist(), "size_m": [width, height, depth], "triangles": piece.tris()})


def surface_station(theta, phi):
    d = S._dir(theta, phi)
    return sculpt(d * S.radius(d)), d, np.array([-math.sin(phi), 0, math.cos(phi)])


# Six structural fault stations, each with a broken primary slab and smaller shelves from that fracture.
zones = [(0.58, 2.28, 29, 18, 6), (0.94, 1.93, 24, 20, 5), (1.65, 1.18, 31, 16, 6),
         (2.36, 0.62, 25, 18, 5), (1.53, 3.35, 30, 19, 6), (0.59, 5.52, 19, 12, 4)]
for k, (theta, phi, w, h, depth) in enumerate(zones):
    c, n, t = surface_station(theta, phi)
    slab(c, n, t, w, h, depth, f"Fault{k + 1}_Primary")
    for j, sign in enumerate((-1, 1)):
        cc, nn, tt = surface_station(theta + sign * 0.095, phi + 0.13)
        slab(cc, nn, tt, w * 0.42, h * 0.34, depth * 0.48, f"Fault{k + 1}_Shelf{j + 1}")

# Cavity ledges are placed beyond the central flight tube, above the lower walkable approaches.
for k, (theta, phi) in enumerate(((0.8, 1.85), (1.15, 2.1), (1.72, 1.3), (2.20, 1.8), (1.1, 0.5))):
    d = S._dir(theta, phi)
    c = d * S.radius(d, True)
    slab(c, -d, np.array([-math.sin(phi), 0, math.cos(phi)]), 10 + k % 3 * 2, 5.5, 1.8,
         f"CavityLedge{k + 1}", "SY_Excavated_R4")

# Crushed fragments sit on the lower entrance lip, leaving the axial approach and platform approaches clear.
for k in range(13):
    phi = -2.13 + k * 0.095
    theta = S.mouth_theta(phi, True) + 0.04 + (k % 3) * 0.04
    d = S._dir(theta, phi)
    c = sculpt(d * S.radius(d, True))
    slab(c, -d, np.array([1, 0, 0.2]), 1.4 + k % 4 * 0.45, 1.1 + k % 3 * 0.3, 0.8 + k % 2 * 0.3,
         f"LipFragment{k + 1}", "SY_Regolith")

# Follow the actual saved lip with splayed ties from the existing collar strut ends into fractured rock seats.
tree = BVHTree.FromObject(rock0, bpy.context.evaluated_depsgraph_get())
mouth_y = bpy.data.objects["Socket_Mouth"].location.y
angles = [k * math.pi / 4 + math.pi / 8 for k in range(9)]
ring = [np.array([math.cos(a) * 25 * (1 + 0.07 * math.sin(k * 2.1)), mouth_y,
                  math.sin(a) * 25 * (1 + 0.07 * math.sin(k * 2.1))]) for k, a in enumerate(angles)]
ring[-1] = ring[0].copy()
anchor_records = []
for k in (0, 2, 3, 5, 7):
    a, b = ring[k], ring[k + 1]
    p0 = a + (b - a) * 0.7
    radial = np.array([p0[0], 0, p0[2]])
    radial /= np.linalg.norm(radial)
    endpoint = p0 + radial * 7 + np.array([0, -1.5, 0])
    hit, normal, _, distance = tree.find_nearest(Vector(endpoint))
    assert hit is not None and distance < 20, (k, distance)
    hit, normal = np.asarray(hit), np.asarray(normal)
    tangent = np.cross(normal, np.array([0, 0, 1.0]))
    if np.linalg.norm(tangent) < 0.01:
        tangent = np.array([1, 0, 0])
    slab(hit - normal * 0.4, normal, tangent, 8 + k % 3, 6, 2.2, f"CollarFootSeat{k}", "SY_Excavated_R4")
    K.beam(geo, endpoint, hit - normal * 0.7, 0.65, 0.55, "SY_Scrap", "girder", up=(0, 0, 1))
    K.beam(geo, hit + tangent * 1.5, hit - tangent * 1.5, 0.8, 0.25, "SY_Scrap", "patch", up=tuple(normal))
    anchor_records.append({"collar_edge": k, "existing_strut_end": endpoint.tolist(), "rock_contact": hit.tolist(), "tie_length_m": float(distance)})

addition = geo.build("sy_rock_FaultStructure_R4", bpy.data.collections["sy_rock_LOD0"])
bpy.ops.object.select_all(action="DESELECT")
rock0.select_set(True)
addition.select_set(True)
bpy.context.view_layer.objects.active = rock0
bpy.ops.object.join()

for label, piece in collision_additions:
    name = f"COL_R4Geo_{label}"
    K.collider_mesh(bpy.data.collections["sy_rock"], name, piece.verts, piece.faces)
    changed_names.append(name)

# Save relief-preserving authored lower LODs from this revised mesh; exporters see a complete source.
for lod, ratio in ((1, 0.65), (2, 0.36), (3, 0.035)):
    old = bpy.data.objects[f"sy_rock_L{lod}"]
    bpy.data.objects.remove(old, do_unlink=True)
    obj = bpy.data.objects.new(f"sy_rock_L{lod}", rock0.data.copy())
    bpy.data.collections[f"sy_rock_LOD{lod}"].objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    decimate = obj.modifiers.new("R4_KeepCleavedMassAndLedges", "DECIMATE")
    decimate.ratio = ratio
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)

for lod in range(4):
    obj = bpy.data.objects[f"sy_rock_L{lod}"]
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.material_slot_remove_unused()

new_counts = [sum(len(p.vertices) - 2 for p in bpy.data.objects[f"sy_rock_L{k}"].data.polygons) for k in range(4)]
assert all(a > b for a, b in zip(new_counts, new_counts[1:]))
assert new_counts[-1] < new_counts[0] * 0.05
invariants = compare(before, snapshot(), changed_names, [r[0] for r in REGIONS])
bpy.context.scene["station_submission"] = 4
bpy.context.scene["round4_scope"] = "Cleaved asymmetric rock, four local PBR regions, nested fracture ledges, lip debris and seated collar ties"
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
save_report(report, {"input_sha256": EXPECTED, "saved_source": str(output), "output_sha256": digest(output),
                     "sculpt": sculpt_record, "region_face_counts_before_new_slabs": region_counts,
                     "old_lod_triangles": old_counts, "new_lod_triangles": new_counts,
                     "geological_maps": map_records, "fault_slabs": slab_records, "collar_ties": anchor_records,
                     "updated_existing_shell_colliders": collider_records, "added_rock_collision_pieces": len(collision_additions),
                     "invariants": invariants, "GPU_GATE": "CLOSED", "bakes_performed": False,
                     "collision_followup": "Validate clear axial flight and inhabited platform routes against saved mesh and coarse collider AABBs before promotion"})
print("SAVED SCRAPYARD REVISION", output, "LODs", new_counts)
