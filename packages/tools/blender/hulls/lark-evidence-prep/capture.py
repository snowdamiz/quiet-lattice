"""CPU stills for the Lark scale, canopy, livery, and collider questions.

Open a blend by path, write PNGs and receipt.json under --out, and leave the
blend bytes unchanged. Run under Blender with --factory-startup. The script
does not claim review qualification, and it does not measure dynamic clearance.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

import capture_plan as plan

KNOWN_IMAGES = (
    "boarding-standing.png",
    "cockpit-closed-canopy.png",
    "colliders-axes.png",
    "livery-lineup.png",
)
AXIS_COLORS = {
    0: (0.85, 0.12, 0.1, 1.0),
    1: (0.15, 0.7, 0.2, 1.0),
    2: (0.15, 0.35, 0.9, 1.0),
}


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def retire_known(out):
    for name in KNOWN_IMAGES:
        path = out / name
        if path.is_file():
            path.unlink()
    cell_dir = out / ".cells"
    if cell_dir.is_dir():
        for child in cell_dir.iterdir():
            if child.is_file():
                child.unlink()
        try:
            cell_dir.rmdir()
        except OSError:
            pass


def hide_all(scene):
    for obj in scene.objects:
        if obj.type not in {"LIGHT", "CAMERA"}:
            obj.hide_render = True


def show(obj):
    obj.hide_render = False


def world_vertices(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        matrix = evaluated.matrix_world
        return [tuple(matrix @ vertex.co) for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def world_triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        if len(mesh.loop_triangles) > plan.TRIANGLE_CAP:
            return None
        matrix = evaluated.matrix_world
        triangles = []
        for tri in mesh.loop_triangles:
            triangles.append(tuple(tuple(matrix @ mesh.vertices[index].co) for index in tri.vertices))
        return triangles
    finally:
        evaluated.to_mesh_clear()


def grid_geometry(obj):
    mesh = obj.data
    matrix = obj.matrix_world
    vertices = [tuple(matrix @ vertex.co) for vertex in mesh.vertices]
    edges = [(int(edge.vertices[0]), int(edge.vertices[1])) for edge in mesh.edges]
    origin_z = float(matrix.translation.z)
    return vertices, edges, origin_z


def choose(objects, predicate):
    picked = plan.prefer_unsuffixed([obj.name for obj in objects if predicate(obj.name)])
    by_name = {obj.name: obj for obj in objects}
    return [by_name[name] for name in picked["kept"]], picked["dropped_duplicates"]


def matrix3(obj):
    matrix = obj.matrix_world
    return tuple(tuple(float(matrix[row][col]) for col in range(3)) for row in range(3))


def translation_of(obj):
    location = obj.matrix_world.translation
    return (float(location.x), float(location.y), float(location.z))


def surface_payload(objects, kind):
    chosen, dropped = choose(objects, lambda name: plan.is_canopy_surface(name, kind))
    if not chosen:
        return {"status": "missing", "triangles": []}, dropped
    triangles = []
    for obj in chosen:
        found = world_triangles(obj)
        if found is None:
            return {"status": "triangle_cap_exceeded", "triangles": []}, dropped
        triangles.extend(found)
        if len(triangles) > plan.TRIANGLE_CAP:
            return {"status": "triangle_cap_exceeded", "triangles": []}, dropped
    return {"status": "ok", "triangles": triangles}, dropped


def collider_payload(objects):
    chosen, dropped = choose([obj for obj in objects if obj.type == "MESH"], plan.is_collider_name)
    if not chosen:
        return {"names": [], "status": "missing", "triangles": []}, dropped
    triangles = []
    names = [obj.name for obj in chosen]
    for obj in chosen:
        found = world_triangles(obj)
        if found is None or len(triangles) + len(found) > plan.TRIANGLE_CAP:
            return {"names": names, "status": "triangle_cap_exceeded", "triangles": []}, dropped
        triangles.extend(found)
    return {"names": names, "status": "ok", "triangles": triangles}, dropped


def base_color_node(material):
    if material is None or not material.use_nodes or material.node_tree is None:
        return None
    for node in material.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        socket = node.inputs.get("Base Color")
        if socket is None or len(socket.links) != 1:
            return None
        source = socket.links[0].from_node
        if source.type != "TEX_IMAGE" or source.image is None:
            return None
        return source
    return None


def image_fact(image):
    if image is None:
        return None
    backed = bool(image.has_data or image.packed_file is not None or image.filepath)
    return {
        "key": str(image.as_pointer()),
        "name": image.name,
        "width": int(image.size[0]),
        "height": int(image.size[1]),
        "backed": backed,
    }


def extract(variant):
    dropped = []
    objects = list(bpy.data.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    empties = [obj for obj in objects if obj.type == "EMPTY"]
    collection_name = f"{variant}_LOD0"
    collection = bpy.data.collections.get(collection_name)
    lod0 = list(collection.all_objects) if collection is not None else []
    biped_objects, extra = choose(meshes, plan.is_biped)
    dropped.extend(extra)
    grid_objects, extra = choose(meshes, plan.is_grid)
    dropped.extend(extra)
    seat_objects, extra = choose(empties, plan.is_pilot_seat)
    dropped.extend(extra)
    boarding_objects, extra = choose(empties, plan.is_boarding_foot)
    dropped.extend(extra)
    glass, extra = surface_payload([obj for obj in lod0 if obj.type == "MESH"], "glass")
    dropped.extend(extra)
    frame, extra = surface_payload([obj for obj in lod0 if obj.type == "MESH"], "frame")
    dropped.extend(extra)
    colliders, extra = collider_payload(meshes)
    dropped.extend(extra)
    hardpoint_objects, extra = choose(empties, plan.is_hardpoint_name)
    dropped.extend(extra)
    pivot_objects, extra = choose(empties, plan.is_rest_pivot)
    dropped.extend(extra)
    biped = biped_objects[0] if biped_objects else None
    grid = grid_objects[0] if grid_objects else None
    grid_vertices, grid_edges, origin_z = grid_geometry(grid) if grid is not None else ([], [], None)
    materials = {}
    for name in plan.MATERIALS:
        node = base_color_node(bpy.data.materials.get(name))
        fact = image_fact(node.image) if node is not None else None
        if fact is not None:
            materials[name] = fact
    images = {}
    for image_name in plan.ALT_IMAGES.values():
        fact = image_fact(bpy.data.images.get(image_name))
        if fact is not None:
            images[image_name] = fact
    canopy_objects = [
        obj
        for obj in lod0
        if obj.type == "MESH" and (plan.is_canopy_surface(obj.name, "glass") or plan.is_canopy_surface(obj.name, "frame"))
    ]
    extracted = {
        "biped": None
        if biped is None
        else {"name": biped.name, "vertices": world_vertices(biped)},
        "grid": None if grid is None else {"name": grid.name, "origin_z": origin_z, "vertices": grid_vertices, "edges": grid_edges},
        "boarding_xyz": None if not boarding_objects else translation_of(boarding_objects[0]),
        "seat_xyz": None if not seat_objects else translation_of(seat_objects[0]),
        "canopy_glass": glass,
        "canopy_frame": frame,
        "colliders": colliders,
        "hardpoints": [
            {
                "name": obj.name,
                "matrix3": matrix3(obj),
                "translation": translation_of(obj),
                "child_meshes": [child.name for child in obj.children if child.type == "MESH"],
            }
            for obj in hardpoint_objects
        ],
        "pivots": [
            {"name": obj.name, "matrix3": matrix3(obj), "translation": translation_of(obj)} for obj in pivot_objects
        ],
        "materials": materials,
        "images": images,
        "dropped_duplicate_names": dropped,
    }
    handles = {
        "lod0": lod0,
        "biped": biped,
        "grid": grid,
        "colliders": [obj for obj in meshes if obj.name in set(colliders["names"])],
        "hardpoints": hardpoint_objects,
        "canopy": canopy_objects,
    }
    notes = {
        "lod0_collection": collection_name,
        "lod0_present": collection is not None,
        "lod0_object_count": len(lod0),
        "grid_polygon_count": None if grid is None else len(grid.data.polygons),
    }
    return extracted, handles, notes


def set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def flat_material(name, rgba, emit=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    set_input(principled, ("Base Color",), rgba)
    if emit:
        set_input(principled, ("Emission Color", "Emission"), rgba)
        set_input(principled, ("Emission Strength",), emit)
    return material


def link_object(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def duplicate_object(obj, name):
    dup = obj.copy()
    dup.data = obj.data
    world = dup.matrix_world.copy()
    dup.parent = None
    dup.name = name
    link_object(dup)
    dup.matrix_world = world
    return dup


def translate(obj, delta):
    obj.matrix_world.translation = obj.matrix_world.translation + Vector(delta)
    bpy.context.view_layer.update()


def display_copy(obj, material, name):
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = name
    for _ in range(len(dup.data.materials)):
        dup.data.materials.pop(index=0)
    dup.data.materials.append(material)
    world = obj.matrix_world.copy()
    link_object(dup)
    dup.parent = None
    dup.matrix_world = world
    show(dup)
    return dup


def _orthonormal(direction):
    axis = Vector(direction)
    if axis.length < 1e-8:
        axis = Vector((0.0, 0.0, 1.0))
    axis.normalize()
    helper = Vector((1.0, 0.0, 0.0)) if abs(axis.x) < 0.9 else Vector((0.0, 1.0, 0.0))
    side = axis.cross(helper).normalized()
    up = side.cross(axis).normalized()
    return axis, side, up


def rod(name, origin, direction, material, length=0.75, radius=0.03):
    axis, side, up = _orthonormal(direction)
    start = Vector(origin)
    end = start + axis * length
    verts = []
    for center in (start, end):
        for quad in range(4):
            angle = quad * math.pi / 2
            offset = side * (math.cos(angle) * radius) + up * (math.sin(angle) * radius)
            verts.append(tuple(center + offset))
    faces = []
    for quad in range(4):
        nxt = (quad + 1) % 4
        faces.append((quad, nxt, 4 + nxt, 4 + quad))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mesh.materials.append(material)
    return link_object(bpy.data.objects.new(name, mesh))


def show_lod0(objects, include_colliders=False):
    for obj in objects:
        if obj.type != "MESH":
            continue
        if plan.is_biped(obj.name) or plan.is_grid(obj.name):
            continue
        if plan.is_collider_name(obj.name) and not include_colliders:
            continue
        show(obj)


def object_corners(obj):
    return [tuple(obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]


def add_lights(scene):
    for location, power, size in (((1.0, 5.0, 12.0), 2300.0, 9.0), ((-9.0, 1.0, 6.0), 1700.0, 8.0), ((3.0, -8.0, 8.0), 2400.0, 7.0)):
        data = bpy.data.lights.new("EvidencePrep_area", "AREA")
        data.energy = power
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new("EvidencePrep_area", data)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0.0, 0.0, 0.0)) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_camera(scene):
    camera = bpy.data.objects.new("EvidencePrep_camera", bpy.data.cameras.new("EvidencePrep_camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def place_camera(camera, center, direction, ortho_scale):
    heading = Vector(direction)
    if heading.length == 0.0:
        heading = Vector((1.0, 1.0, 1.0))
    heading.normalize()
    camera.location = Vector(center) + heading * max(ortho_scale, 1.0) * 2.0
    camera.rotation_euler = (Vector(center) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = float(ortho_scale)


def disarm_gpu_denoiser(scene):
    cycles = scene.cycles
    if getattr(cycles, "denoiser", None) in plan.GPU_DENOISERS:
        cycles.use_denoising = False
        try:
            cycles.denoiser = "OPENIMAGEDENOISE"
        except (TypeError, AttributeError):
            cycles.use_denoising = False
        if getattr(cycles, "denoiser", None) in plan.GPU_DENOISERS:
            cycles.use_denoising = False


def observe(scene, images_already):
    percent = scene.render.resolution_percentage / 100.0
    return {
        "engine": scene.render.engine,
        "device": scene.cycles.device,
        "denoising_use_gpu": scene.cycles.denoising_use_gpu,
        "use_denoising": bool(scene.cycles.use_denoising),
        "denoiser": getattr(scene.cycles, "denoiser", None),
        "samples": int(scene.cycles.samples),
        "width": int(scene.render.resolution_x * percent),
        "height": int(scene.render.resolution_y * percent),
        "images_already": images_already,
        "threads": int(scene.render.threads),
    }


def require_cpu(scene, images_already):
    if not hasattr(scene.cycles, "denoising_use_gpu"):
        raise SystemExit("cpu gate refused: ['denoising_use_gpu']")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.denoising_use_gpu = False
    if hasattr(scene.cycles, "preview_denoising_use_gpu"):
        scene.cycles.preview_denoising_use_gpu = False
    disarm_gpu_denoiser(scene)
    scene.render.threads_mode = "FIXED"
    scene.render.threads = plan.THREADS
    scene.render.resolution_percentage = 100
    observed = observe(scene, images_already)
    errors = plan.gate_render(observed)
    if errors:
        raise SystemExit(f"cpu gate refused: {errors}")
    return observed


def render_pixels(scene, path, width, height, images_already, samples):
    scene.render.resolution_x = int(width)
    scene.render.resolution_y = int(height)
    scene.render.resolution_percentage = 100
    scene.cycles.samples = int(samples)
    scene.render.filepath = str(path)
    scene.render.image_settings.file_format = "PNG"
    observed = require_cpu(scene, images_already)
    bpy.ops.render.render(write_still=True)
    return observed


def frame_camera(scene, camera, shot, points):
    boxed = plan.bounds_of(points)
    if boxed is None:
        raise RuntimeError(f"{shot['id']} has no geometry to frame")
    mins, maxs = boxed
    place_camera(camera, plan.center_of(mins, maxs), shot["direction"], plan.ortho_scale(mins, maxs, shot["margin"]))


def stage_body(handles, shot, report):
    show_lod0(handles["lod0"])
    if handles["grid"] is not None and shot["id"] != "livery-lineup":
        show(handles["grid"])
    placement = report["placements"]["boarding" if shot["id"] == "boarding-standing" else "cockpit_standing"]
    if handles["biped"] is None or placement is None:
        raise RuntimeError(f"{shot['id']} is missing the reference placement")
    body = duplicate_object(handles["biped"], f"EvidenceBiped_{shot['id']}")
    translate(body, placement["translation_m"])
    show(body)
    frame_points = object_corners(body)
    if shot["frame"] == "biped_and_canopy":
        for obj in handles["canopy"]:
            show(obj)
            frame_points.extend(object_corners(obj))
    return frame_points


def stage_colliders(handles):
    show_lod0(handles["lod0"])
    material = flat_material("EvidencePrep_collider", (0.95, 0.15, 0.75, 1.0), emit=0.35)
    points = []
    for obj in handles["lod0"]:
        if obj.type == "MESH" and not plan.is_collider_name(obj.name) and not plan.is_biped(obj.name):
            points.extend(object_corners(obj))
    for index, obj in enumerate(handles["colliders"]):
        copy = display_copy(obj, material, f"EvidenceCollider_{index}")
        points.extend(object_corners(copy))
    axis_materials = {axis: flat_material(f"EvidencePrep_axis_{axis}", color, emit=2.0) for axis, color in AXIS_COLORS.items()}
    for obj in handles["hardpoints"]:
        origin = translation_of(obj)
        columns = matrix3(obj)
        for axis in range(3):
            direction = (columns[0][axis], columns[1][axis], columns[2][axis])
            rod_obj = rod(f"EvidenceAxis_{obj.name}_{axis}", origin, direction, axis_materials[axis])
            show(rod_obj)
            points.extend(object_corners(rod_obj))
    return points


def render_lineup(scene, camera, shot, report, out, images_already, samples):
    nodes = []
    for name in plan.MATERIALS:
        node = base_color_node(bpy.data.materials.get(name))
        if node is None:
            raise RuntimeError(f"{name} has no single base-color image to swap")
        nodes.append(node)
    originals = [(node, node.image) for node in nodes]
    cell_dir = out / ".cells"
    cell_dir.mkdir(parents=True, exist_ok=True)
    cells = []
    last = None
    try:
        for source in report["liveries"]["sources"]:
            image = bpy.data.images.get(source["image_name"])
            if image is None:
                raise RuntimeError(f"livery image missing at render: {source['image_name']}")
            for node, _image in originals:
                node.image = image
            cell = cell_dir / f"{source['id']}.png"
            last = render_pixels(scene, cell, shot["cell_width"], shot["cell_height"], images_already, samples)
            cells.append(cell)
        stitch(cells, out / "livery-lineup.png", shot["cell_width"], shot["cell_height"])
        return last
    finally:
        for node, image in originals:
            node.image = image
        for cell in cells:
            if cell.is_file():
                cell.unlink()
        try:
            cell_dir.rmdir()
        except OSError:
            pass


def stitch(cells, dest, cell_width, cell_height):
    import array

    sheet_w = cell_width * len(cells)
    sheet_h = cell_height
    if sheet_w > plan.MAX_WIDTH or sheet_h > plan.MAX_HEIGHT or sheet_w * sheet_h > plan.MAX_PIXELS:
        raise RuntimeError("livery sheet exceeds the pixel cap")
    sheet = array.array("f", [0.0]) * (sheet_w * sheet_h * 4)
    for index, path in enumerate(cells):
        image = bpy.data.images.load(str(path))
        try:
            if tuple(image.size) != (cell_width, cell_height):
                raise RuntimeError("livery cell size mismatch")
            buffer = array.array("f", [0.0]) * (cell_width * cell_height * 4)
            image.pixels.foreach_get(buffer)
            row_floats = cell_width * 4
            for y in range(cell_height):
                src = y * row_floats
                dst = (y * sheet_w + index * cell_width) * 4
                sheet[dst : dst + row_floats] = buffer[src : src + row_floats]
        finally:
            bpy.data.images.remove(image)
    sheet_image = bpy.data.images.new("EvidenceLineup", sheet_w, sheet_h, alpha=True)
    try:
        sheet_image.pixels.foreach_set(sheet)
        sheet_image.filepath_raw = str(dest)
        sheet_image.file_format = "PNG"
        sheet_image.save()
    finally:
        bpy.data.images.remove(sheet_image)


def image_file_fact(path):
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"missing render {path.name}")
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": file_sha256(path)}


def prepare_scene(scene, args):
    scene.render.resolution_x = int(args["width"])
    scene.render.resolution_y = int(args["height"])
    scene.render.resolution_percentage = 100
    scene.cycles.samples = int(args["samples"])
    if scene.world is not None:
        scene.world.color = (0.18, 0.18, 0.18)
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    require_cpu(scene, 0)


def capture(args, blend, out, before):
    retire_known(out)
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scene = bpy.context.scene
    prepare_scene(scene, args)
    extracted, handles, notes = extract(args["variant"])
    report = plan.assemble_report(extracted)
    shots = plan.plan_shots(
        plan.shot_facts(extracted, report["liveries"]["lineup"]),
        args["width"],
        args["height"],
    )
    add_lights(scene)
    camera = add_camera(scene)
    images = []
    cpu_gates = []
    for shot in shots["shots"]:
        hide_all(scene)
        if shot["id"] == "livery-lineup":
            show_lod0(handles["lod0"])
            frame_camera(scene, camera, shot, [corner for obj in handles["lod0"] if obj.type == "MESH" for corner in object_corners(obj)])
            observed = render_lineup(scene, camera, shot, report, out, len(images), args["samples"])
        elif shot["id"] == "colliders-axes":
            points = stage_colliders(handles)
            frame_camera(scene, camera, shot, points)
            observed = render_pixels(scene, out / f"{shot['id']}.png", shot["width"], shot["height"], len(images), args["samples"])
        else:
            points = stage_body(handles, shot, report)
            frame_camera(scene, camera, shot, points)
            observed = render_pixels(scene, out / f"{shot['id']}.png", shot["width"], shot["height"], len(images), args["samples"])
        cpu_gates.append({"shot": shot["id"], **observed})
        images.append(image_file_fact(out / f"{shot['id']}.png"))
    return {
        "schema": plan.SCHEMA,
        "status": "complete",
        "dynamic_clearance": plan.DYNAMIC_CLEARANCE,
        "review_qualification": "not_claimed",
        "runtime": {
            "blender_executed": True,
            "review_qualification": "not_claimed",
            "dynamic_clearance": plan.DYNAMIC_CLEARANCE,
        },
        "blend": {"path": str(blend), "sha256_before": before, "sha256_after": None, "bytes_unchanged": None},
        "measurements": report,
        "plan": shots,
        "scene_notes": notes,
        "cpu_gates": cpu_gates,
        "images": images,
    }


def main(argv):
    args = plan.parse_args(argv)
    blend = Path(args["blend"]).resolve()
    out = Path(args["out"]).resolve()
    if not blend.is_file():
        raise SystemExit(f"blend not found: {blend}")
    if not plan.output_allowed(out, blend):
        raise SystemExit("refusing to write into the blend path")
    out.mkdir(parents=True, exist_ok=True)
    before = file_sha256(blend)
    payload = None
    error = None
    try:
        payload = capture(args, blend, out, before)
    except Exception as exc:
        error = exc
    finally:
        after = file_sha256(blend)
        if after != before:
            raise SystemExit(3)
    receipt = out / "receipt.json"
    if error is not None:
        write_json(
            receipt,
            {
                "schema": plan.SCHEMA,
                "status": "failed",
                "error": str(error),
                "dynamic_clearance": plan.DYNAMIC_CLEARANCE,
                "review_qualification": "not_claimed",
                "blend": {
                    "path": str(blend),
                    "sha256_before": before,
                    "sha256_after": after,
                    "bytes_unchanged": True,
                },
                "images": [
                    {"file": path.name, "bytes": path.stat().st_size, "sha256": file_sha256(path)}
                    for name in KNOWN_IMAGES
                    if (path := out / name).is_file() and path.stat().st_size > 0
                ],
            },
        )
        raise error
    payload["blend"]["sha256_after"] = after
    payload["blend"]["bytes_unchanged"] = True
    write_json(receipt, payload)
    print("EVIDENCE_PREP_DONE", receipt, flush=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
