"""Refine the first saved round-four geology after its full-quality studio inspection.

The first attempt and its images remain intact. Surface-based region ownership removes stepped
face-index bands; the oblique stern and dorsal shear strengthen the specific geological mass.
"""
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sy_kit as S
from round4_common import compare, digest, save_report, snapshot

source, output, report = map(Path, sys.argv[sys.argv.index("--") + 1:])
EXPECTED = "0b5cd2f5cbfdf0af42d70b2c327f97fb9ce9bf83da87088e3e665caea2ae48de"
assert digest(source) == EXPECTED
assert not output.exists()
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
before = snapshot()
natural = {"SY_Rock", "SY_Regolith", "SY_Fracture_R4", "SY_Excavated_R4"}


def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def shear(point):
    p = np.asarray(point, float).copy()
    r = np.linalg.norm(p)
    if r < 1:
        return p
    d = p / r
    weight = smooth(0.78, 0.94, r / S.radius(d)) * smooth(-48, -22, p[1])
    for n, limit in ((np.array([0.15, 0, 1]), 57),
                     (np.array([0.55, 1, -0.23]), 103),
                     (np.array([-1, 0.12, 0.28]), 62)):
        excess = float(np.dot(n, p) - limit)
        if excess > 0:
            p -= n * excess / float(np.dot(n, n)) * weight
    return p


rock = bpy.data.objects["sy_rock_L0"]
changed = []
displacements = []
for obj in bpy.data.objects:
    if obj.name.startswith("COL_Rock_") or obj.name.startswith("COL_R4Geo_") or obj.name.startswith("sy_rock_L"):
        inverse = obj.matrix_world.inverted()
        maximum = 0
        for v in obj.data.vertices:
            point = obj.matrix_world @ v.co
            new = Vector(shear(point))
            maximum = max(maximum, (new - point).length)
            v.co = inverse @ new
        obj.data.update()
        changed.append(obj.name)
        displacements.append({"object": obj.name, "maximum_displacement_m": maximum})

# The existing shell is first in the joined saved mesh. All subsequent faces are the new fault solids/ties.
initial_natural_faces = 7518
slots = {m.name: i for i, m in enumerate(rock.data.materials)}
counts = {}
for polygon in rock.data.polygons:
    name = rock.data.materials[polygon.material_index].name
    if name not in natural:
        continue
    c = np.asarray(polygon.center)
    r = np.linalg.norm(c)
    inner = r < S.radius(c / max(0.001, r)) * 0.80
    if polygon.index < initial_natural_faces:
        # Exposed skin and worked cavity are coherent geological surfaces, not stripe masks on a coarse grid.
        name = "SY_Excavated_R4" if inner else "SY_Rock"
        if inner and c[2] < -18 and polygon.normal.z > 0.55:
            name = "SY_Regolith"
        polygon.use_smooth = not inner
    elif name == "SY_Regolith":
        # Dust collects on upward ledges and lip rubble; the steep broken sides remain dark fresh fractures.
        name = "SY_Regolith" if polygon.normal.z > 0.60 and c[2] < 20 else "SY_Fracture_R4"
    polygon.material_index = slots[name]
    counts[name] = counts.get(name, 0) + 1
rock.data.update()

# The lower LODs are revised from the actual refined source, preserving the new rock's main silhouette.
for lod, ratio in ((1, 0.65), (2, 0.36), (3, 0.035)):
    old = bpy.data.objects[f"sy_rock_L{lod}"]
    bpy.data.objects.remove(old, do_unlink=True)
    obj = bpy.data.objects.new(f"sy_rock_L{lod}", rock.data.copy())
    bpy.data.collections[f"sy_rock_LOD{lod}"].objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    decimate = obj.modifiers.new("R4_RefinedGeologicalSilhouette", "DECIMATE")
    decimate.ratio = ratio
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
counts_lod = [sum(len(p.vertices) - 2 for p in bpy.data.objects[f"sy_rock_L{k}"].data.polygons) for k in range(4)]
assert all(a > b for a, b in zip(counts_lod, counts_lod[1:])) and counts_lod[-1] < counts_lod[0] * 0.05
invariants = compare(before, snapshot(), changed)
bpy.context.scene["round4_studio_iteration"] = 2
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
save_report(report, {"input_sha256": EXPECTED, "output_sha256": digest(output), "saved_source": str(output),
                     "surface_region_face_counts": counts, "lod_triangles": counts_lod, "shear_displacements": displacements,
                     "invariants": invariants, "bake_performed": False, "GPU_GATE": "CLOSED"})
print("SAVED REFINED GEOLOGY", output, counts_lod, counts)
