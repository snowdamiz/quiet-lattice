"""Targeted corrections to saved components found by geometric clearance auditing."""

import hashlib
import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, lods
from artlib import scene as S

META = ROOT / "assets/blend/cities/ulgani"


def indices(ob, label):
    group = ob.vertex_groups[label].index
    return [
        v.index
        for v in ob.data.vertices
        if any(g.group == group and g.weight > 0.5 for g in v.groups)
    ]


def shift_component(ob, label, delta):
    for i in indices(ob, label):
        ob.data.vertices[i].co += Vector(delta)


def replace_mesh(ob, verts, faces):
    mesh = bpy.data.meshes.new(ob.name + "Corrected")
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    ob.data = mesh


def prism(ob, base, thickness):
    base = [Vector(p) for p in base]
    normal = (base[1] - base[0]).cross(base[2] - base[0]).normalized() * thickness / 2
    n = len(base)
    verts = [p - normal for p in base] + [p + normal for p in base]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    replace_mesh(ob, verts, faces)


def correct(group):
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    inventory = json.loads((META / f"inventory/{group}-b01.json").read_text())
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    assert before == inventory["sha256"]
    core.load(source)
    images = {
        i.name: hashlib.sha256(i.packed_file.data).hexdigest()
        for i in bpy.data.images
        if i.packed_file
    }
    changes = []
    if group == "civic":
        for lod in range(4):
            ob = bpy.data.objects[f"ulgani_plaza_Surface{lod}"]
            for label in ("RootBorder4", "RootBorder12"):
                shift_component(ob, label, (0, 0, -1.2))
        changes.append(
            "Lowered two decorative plaza border roots below the north/south walking entrances in all four saved LODs."
        )
        surface = bpy.data.objects["ulgani_salvage_Surface0"]
        for k in range(5):
            selected = indices(surface, f"GrownCradle{k}")
            mapping = {v: i for i, v in enumerate(selected)}
            faces = [
                tuple(mapping[i] for i in p.vertices)
                for p in surface.data.polygons
                if all(i in mapping for i in p.vertices)
            ]
            ob = bpy.data.objects[f"COL_ulgani_salvage_Cradle{k}"]
            replace_mesh(ob, [surface.data.vertices[i].co for i in selected], faces)
            lods._decimate([ob], 100)
        changes.append(
            "Replaced five solid cradle boxes with 100-triangle collider meshes reduced from the saved curved cradle surfaces."
        )
    elif group == "kit":
        wall = bpy.data.objects["ulgani_wall_corner_Surface0"]
        for k in range(1, 9):
            selected = indices(wall, f"Mesh{k}")
            points = [wall.data.vertices[i].co for i in selected]
            prism(
                bpy.data.objects[f"COL_ulgani_wall_corner_Panel{k}"],
                [points[0], points[12], points[-1]],
                0.22,
            )
        changes.append(
            "Aligned corner-wall panel colliders to their saved triangular membranes."
        )
        bridge = bpy.data.objects["ulgani_bridge_turn_Surface0"]
        for side in (-1, 1):
            posts = []
            for k in range(9):
                selected = indices(bridge, f"RailSprout{side}_{k}")
                posts.append(
                    sum((bridge.data.vertices[i].co for i in selected[:8]), Vector())
                    / 8
                )
            for k in range(8):
                p, q = posts[k], posts[k + 1]
                base = [p, q, q + Vector((0, 0, 1.07)), p + Vector((0, 0, 1.07))]
                prism(
                    bpy.data.objects[f"COL_ulgani_bridge_turn_Rail{side}_{k}"],
                    base,
                    0.16,
                )
        changes.append(
            "Aligned turning bridge railing colliders to the saved rail-post endpoints; removed intrusive axis-aligned volumes."
        )
        for asset in ("ulgani_cap_shelter", "ulgani_cap_half"):
            for k in (1, 2, 4, 5):
                col = bpy.data.objects[f"COL_{asset}_Column{k}"]
                delta = (3 if sum(v.co.x for v in col.data.vertices) > 0 else -3, 0, 0)
                for v in col.data.vertices:
                    v.co += Vector(delta)
                marker = bpy.data.objects[f"Light_Spore{k}_{asset}"]
                marker.location += Vector(delta)
                for lod in range(4):
                    ob = bpy.data.objects[f"{asset}_Surface{lod}"]
                    for label in (
                        f"RootColumn{k}",
                        f"SporeLantern{k}",
                        f"SporeLantern{k}Frond",
                    ):
                        shift_component(ob, label, delta)
        changes.append(
            "Moved four side columns and their matching collision/spore lights outward 3 m on each street cap, preserving the declared 16 m corridor."
        )
    bpy.context.view_layer.update()
    S.clear_cache()
    for asset in inventory["assets"]:
        meshes = [bpy.data.objects[f"{asset['id']}_Surface{n}"] for n in range(4)]
        lo, hi = S.bounds([meshes[0]])
        asset["bounds"] = [lo.tolist(), hi.tolist()]
        asset["height"] = float(hi[2] - lo[2])
        asset["footprintRadius"] = max(
            (v.co.x**2 + v.co.y**2) ** 0.5 for v in meshes[0].data.vertices
        )
        asset["lodTriangles"] = [S.tri_count(o) for o in meshes]
        for marker in asset["markers"]:
            marker["position"] = list(bpy.data.objects[marker["name"]].location)
        if group == "kit":
            for route in asset["walkRoutes"]:
                if asset["role"].startswith("bridge") or asset["role"] == "shore_walk":
                    route["fromAcross"] = route["toAcross"] = [1, 0, 0]
                elif asset["role"].startswith("ring"):
                    for end in ("from", "to"):
                        p = Vector(route[end])
                        p.y += asset["ringRadius"]
                        p.z = 0
                        p.normalize()
                        route[end + "Across"] = list(p)
    assert images == {
        i.name: hashlib.sha256(i.packed_file.data).hexdigest()
        for i in bpy.data.images
        if i.packed_file
    }
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    inventory["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    out = META / f"inventory/{group}-r02.json"
    with out.open("x") as f:
        json.dump(inventory, f, indent=2)
        f.write("\n")
    receipt = META / f"revisions/{group}-clearance-r02.json"
    with receipt.open("x") as f:
        json.dump(
            {
                "beforeSHA256": before,
                "afterSHA256": inventory["sha256"],
                "changes": changes,
                "packedImagesUnchanged": True,
            },
            f,
            indent=2,
        )
        f.write("\n")
    print(group, changes, flush=True)


for group in ("civic", "kit"):
    correct(group)
