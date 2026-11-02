"""Finish saved round-four geology: true surface ownership and two localized hierarchical faults."""
from pathlib import Path
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sy_kit as S
from round4_common import compare, digest, save_report, snapshot

source, output, report = map(Path, sys.argv[sys.argv.index("--") + 1:])
EXPECTED = "e121b0a2f71b1dc130140753e01d57ada7061238741db093d68cfbc0d97564f9"
assert digest(source) == EXPECTED and not output.exists()
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
before = snapshot()
rock = bpy.data.objects["sy_rock_L0"]
natural = {"SY_Rock", "SY_Regolith", "SY_Fracture_R4", "SY_Excavated_R4"}
interior = {p.index for p in rock.data.polygons if p.index < 7518 and p.normal.dot(p.center) < -1}


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def faults(p):
    x, y, z = p
    end = smooth(-76, -52, y) * (1 - smooth(67, 96, y))
    f = z * 0.85 + y * 0.23 - 14 + 2.3 * math.sin(y * 0.063)
    g = z - y * 0.35 + 8 + 1.6 * math.sin(y * 0.08)
    right = end * smooth(9, 27, x)
    left = end * smooth(6, 25, -x)
    primary = max(0, 1 - abs(f) / 8) ** 1.3 * right
    secondary = max(0, 1 - abs(g) / 5.5) ** 1.2 * left
    ledge = math.exp(-((f - 8) / 3.2) ** 2) * right
    return -11 * primary - 6 * secondary + 3.8 * ledge, max(primary, secondary)


def fracture(point):
    p = np.asarray(point, float)
    r = np.linalg.norm(p)
    if r < 1:
        return p.copy()
    d = p / r
    outer = smooth(0.69, 0.77, r / S.radius(d))
    displacement, _ = faults(p)
    return p + d * displacement * outer


changed = []
for obj in bpy.data.objects:
    if obj.name.startswith(("sy_rock_L", "COL_Rock_", "COL_R4Geo_")):
        inverse = obj.matrix_world.inverted()
        for v in obj.data.vertices:
            v.co = inverse @ Vector(fracture(obj.matrix_world @ v.co))
        obj.data.update()
        changed.append(obj.name)
slots = {m.name: i for i, m in enumerate(rock.data.materials)}
counts = {}
for p in rock.data.polygons:
    if rock.data.materials[p.material_index].name not in natural:
        continue
    if p.index < 7518:
        if p.index in interior:
            name = "SY_Regolith" if p.center.z < -18 and p.normal.z > 0.55 else "SY_Excavated_R4"
            p.use_smooth = False
        else:
            _, depth = faults(p.center)
            name = "SY_Fracture_R4" if depth > 0.40 else "SY_Rock"
            p.use_smooth = depth < 0.15
        p.material_index = slots[name]
    name = rock.data.materials[p.material_index].name
    counts[name] = counts.get(name, 0) + 1
rock.data.update()
for lod, ratio in ((1, 0.65), (2, 0.36), (3, 0.035)):
    bpy.data.objects.remove(bpy.data.objects[f"sy_rock_L{lod}"], do_unlink=True)
    obj = bpy.data.objects.new(f"sy_rock_L{lod}", rock.data.copy())
    bpy.data.collections[f"sy_rock_LOD{lod}"].objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("R4_LocalFaultHierarchy", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
lod_counts = [sum(len(p.vertices) - 2 for p in bpy.data.objects[f"sy_rock_L{k}"].data.polygons) for k in range(4)]
assert all(a > b for a, b in zip(lod_counts, lod_counts[1:])) and lod_counts[3] < lod_counts[0] * 0.05
invariants = compare(before, snapshot(), changed)
bpy.context.scene["round4_studio_iteration"] = 3
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
save_report(report, {"input_sha256": EXPECTED, "output_sha256": digest(output), "saved_source": str(output),
                     "region_face_counts": counts, "interior_faces_classified_by_orientation": len(interior),
                     "lod_triangles": lod_counts, "invariants": invariants, "GPU_GATE": "CLOSED", "bake_performed": False})
print("SAVED LOCALIZED GEOLOGICAL FAULTS", output, lod_counts, counts)
