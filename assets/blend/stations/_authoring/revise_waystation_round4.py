"""Open and detail the saved fabricator chamber named by the third visual verdict.

This one-time source revision does not rebuild any kit module and is never called by export.
"""
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit as K
from round4_common import compare, digest, save_report, snapshot

source, output, report = map(Path, sys.argv[sys.argv.index("--") + 1:])
EXPECTED = "83532327ba2ce3c72a597ceb41ef2b0d3add7f5352c139bc771a38bb34c4747f"
assert digest(source) == EXPECTED
assert not output.exists(), "Use a fresh staged source; preserve every attempt"
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False)
before = snapshot()
changes = []
xf = Matrix.Translation((0, -0.62, 1.0)) @ Matrix.Rotation(math.radians(-32), 4, "X")


def turned(mesh, *args, xf, **kwargs):
    local = K.Mesh()
    K.revolve(local, *args, **kwargs)
    mesh.extend(local, xf)


def discard(obj, predicate):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    selected = [face for face in bm.faces if predicate(face, [v.co for v in face.verts])]
    count = len(selected)
    bmesh.ops.delete(bm, geom=selected, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return count


def chamber(mesh, lod):
    # A bed at standing work height, open to the operator; the rear service shield closes the back.
    seg = (24, 16, 8, 6)[lod]
    if lod == 3:
        K.box(mesh, (-1.3, -0.9, 0), (1.3, 0.9, 0.22), "WS_Prop", "accent")
        for x in (-0.55, 0.55):
            K.box(mesh, (x - 0.07, 0.55, 0.22), (x + 0.07, 0.7, 2.2), "WS_Prop", "trim")
        K.box(mesh, (-0.65, -0.45, 0.95), (0.65, 0.65, 1.1), "WS_Prop", "machine")
        return
    K.box(mesh, (-0.57, 0.56, 0.72), (0.57, 0.67, 2.05), "WS_Prop", "machine")
    for x in (-0.49, 0.49):
        K.box(mesh, (x - 0.045, 0.48, 0.42), (x + 0.045, 0.57, 2.08), "WS_Prop", "trim")
        if lod < 2:
            K.tube(mesh, [(x, 0.46, 0.62), (x, 0.46, 2.05)], 0.025, 8 if lod == 0 else 6, "WS_Prop", "rail", caps=True)
            for z in (1.0, 1.74):
                K.box(mesh, (x - 0.075, 0.38, z - 0.07), (x + 0.075, 0.6, z + 0.07), "WS_Prop", "accent")
    K.revolve(mesh, [(0, 0.98), (0.55, 0.98), (0.58, 1.05), (0.58, 1.12), (0.52, 1.16), (0, 1.16)], seg,
              "WS_Prop", "trim", center=(0.12, 0.08, 0), axis="z")
    K.revolve(mesh, [(0, 1.164), (0.44, 1.164), (0.44, 1.18), (0, 1.18)], seg,
              "WS_Prop", "machine", center=(0.12, 0.08, 0), axis="z")
    K.box(mesh, (-0.50, 0.25, 1.80), (0.55, 0.43, 1.94), "WS_Prop", "accent")
    K.box(mesh, (-0.44, 0.225, 1.84), (0.49, 0.25, 1.88), "WS_Prop", "rail")
    K.box(mesh, (0.02, -0.06, 1.70), (0.25, 0.43, 1.94), "WS_Prop", "machine")
    K.revolve(mesh, [(0.085, 1.71), (0.085, 1.57), (0.035, 1.50), (0, 1.50)], 10 if lod < 2 else 6,
              "WS_Prop", "trim", center=(0.135, 0.075, 0), axis="z")
    # A half-built faceted coupling and three independent bed clamps establish the machine's purpose.
    K.revolve(mesh, [(0.14, 1.18), (0.22, 1.18), (0.22, 1.24), (0.17, 1.28), (0.17, 1.38), (0.105, 1.38), (0.105, 1.18)], 6,
              "WS_Prop", "plate", center=(0.135, 0.075, 0), axis="z")
    for a in (0.3, 2.4, 4.5):
        clamp_xf = Matrix.Translation((0.12 + math.cos(a) * 0.40, 0.08 + math.sin(a) * 0.40, 1.18)) @ Matrix.Rotation(a, 4, "Z")
        K.box(mesh, (-0.13, -0.065, 0), (0.15, 0.065, 0.07), "WS_Prop", "trim", xf=clamp_xf)
        K.box(mesh, (-0.13, -0.065, 0.07), (-0.05, 0.065, 0.15), "WS_Prop", "signal", xf=clamp_xf)
        if lod == 0:
            turned(mesh, [(0.025, 0.07), (0.025, 0.1), (0, 0.1)], 8, "WS_Prop", "rail", center=(0.08, 0, 0), xf=clamp_xf)
    if lod < 2:
        for z in (0.90, 1.08, 1.26, 1.44, 1.62):
            K.box(mesh, (-0.38, 0.52, z), (-0.24, 0.55, z + 0.055), "WS_Prop", "trim")
        K.tube(mesh, [(0.23, 0.39, 1.86), (0.38, 0.50, 2.0), (0.48, 0.61, 2.07)], 0.035,
               8 if lod == 0 else 5, "WS_Prop", "hose")
        for x in (-0.55, 0.55):
            K.box(mesh, (x - 0.025, -0.15, 0.68), (x + 0.025, 0.45, 1.0), "WS_Prop", "accent")


def controls(mesh, lod):
    if lod == 3:
        return
    # A dark process display, separate feed selector and positive guarded start/stop controls.
    K.box(mesh, (-0.56, 0.04, 0.076), (-0.05, 0.36, 0.092), "WS_Prop", "trim", xf=xf)
    K.box(mesh, (-0.53, 0.07, 0.092), (-0.08, 0.33, 0.098), "WS_Prop", "hose", xf=xf)
    for row, length in enumerate((0.30, 0.22, 0.12)):
        K.box(mesh, (-0.48, 0.12 + row * 0.065, 0.099), (-0.48 + length, 0.137 + row * 0.065, 0.101), "WS_Prop", "light", xf=xf)
    for x, key in ((0.04, "signal"), (0.32, "light")):
        turned(mesh, [(0, 0.08), (0.09, 0.08), (0.09, 0.11), (0.07, 0.135), (0, 0.135)],
                  12 if lod == 0 else 6, "WS_Prop", key, center=(x, 0.17, 0), xf=xf)
        K.box(mesh, (x - 0.08, 0.29, 0.08), (x + 0.08, 0.31, 0.09), "WS_Prop", "trim", xf=xf)
    if lod < 2:
        for x in (0.03, 0.10, 0.17):
            K.box(mesh, (x, 0.055, 0.09), (x + 0.03, 0.075, 0.095), "WS_Prop", "light", xf=xf)
        for x in (0.21, 0.45):
            K.box(mesh, (x, 0.105, 0.08), (x + 0.025, 0.235, 0.16), "WS_Prop", "signal", xf=xf)


names = []
for lod in range(4):
    obj = bpy.data.objects[f"ws_fabricator_L{lod}"]
    names.append(obj.name)
    glass_slots = {i for i, m in enumerate(obj.data.materials) if m.name == "WS_Glass"}
    inverse = xf.inverted()
    def removed(face, pts):
        if face.material_index in glass_slots:
            return True
        if lod == 3:
            return all(p.z <= 2.201 for p in pts)
        local = [inverse @ p for p in pts]
        old_strip = all(-0.501 <= p.x <= 0.501 and 0.059 <= p.y <= 0.341 and 0.059 <= p.z <= 0.076 for p in local)
        old_micro_tool = all(-0.31 <= p.x <= 0.61 and -0.01 <= p.y <= 0.31 and 0.61 <= p.z <= 1.311 for p in pts)
        return old_strip or old_micro_tool
    count = discard(obj, removed)
    additions = K.Mesh()
    chamber(additions, lod)
    controls(additions, lod)
    new = additions.build(f"FabricationChamber_R4_L{lod}", bpy.data.collections[f"ws_fabricator_LOD{lod}"])
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    new.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    changes.append({"lod": lod, "removed_faces": count, "authored_triangles": additions.tris(),
                    "total_triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons)})

invariants = compare(before, snapshot(), names)
bpy.context.scene["station_submission"] = 4
bpy.context.scene["round4_scope"] = "Fabricator open chamber, standing print bed, tooling and purposeful controls only"
bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)
save_report(report, {"input_sha256": EXPECTED, "saved_source": str(output), "output_sha256": digest(output),
                     "changes": changes, "invariants": invariants, "GPU_GATE": "CLOSED", "bakes_performed": False})
print("SAVED FABRICATOR REVISION", output, changes)
