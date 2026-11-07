"""Future CPU captures of the pinned Lark candidate; no fit/clearance qualification.

Run only after capture authorization. Geometry is frozen from evaluated world
transforms into a separate scene. This script never saves a blend or reuses an
output directory. Seated/closed-canopy proof is deliberately unsupported.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

# Blender does not consistently add a -P script's directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture_plan as plan

import bpy
from mathutils import Vector

AXIS_COLORS = {0: (.85, .12, .1, 1), 1: (.15, .7, .2, 1), 2: (.15, .35, .9, 1)}
SNAPSHOT_VERTEX_TOL_M = 1e-5


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, payload):
    # The run owns a newly created directory. Never replace even an unexpected file.
    with path.open("x") as handle:
        json.dump(payload, handle, indent=2, allow_nan=False)
        handle.write("\n")


def hide_all(scene):
    for obj in scene.objects:
        if obj.type not in {"LIGHT", "CAMERA"}:
            obj.hide_render = True


def show(obj):
    obj.hide_render = False


def matrix_list(matrix):
    return [[float(value) for value in row] for row in matrix]


def object_fact(obj, depsgraph):
    chain = []
    parent = obj.parent
    while parent is not None:
        chain.append({"name": parent.name, "matrix_world": matrix_list(parent.evaluated_get(depsgraph).matrix_world)})
        parent = parent.parent
    return {"name": obj.name, "matrix_world": matrix_list(obj.evaluated_get(depsgraph).matrix_world),
            "parent_chain": chain, "collections": sorted(c.name for c in obj.users_collection),
            "child_meshes": [child.name for child in obj.children if child.type == "MESH"]}


def world_vertices(obj):
    # Display objects are already baked evaluated meshes, with no parents/modifiers.
    return plan.world_points([tuple(v.co) for v in obj.data.vertices], matrix_list(obj.matrix_world))


def image_fact(image):
    if image is None:
        return None
    packed = image.packed_file
    valid = bool(packed and image.source == "FILE" and not image.is_dirty
                 and image.size[0] > 0 and image.size[1] > 0)
    return {"name": image.name, "width": int(image.size[0]), "height": int(image.size[1]),
            "colorspace": image.colorspace_settings.name, "alpha_mode": image.alpha_mode,
            "packed_clean": valid, "sha256": hashlib.sha256(bytes(packed.data)).hexdigest() if valid else None,
            "identity": "packed file bytes; decoded/perceptual equality not measured"}


def active_nodes(material):
    if material is None or not material.use_nodes or material.node_tree is None:
        return []
    outputs = [n for n in material.node_tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output]
    if len(outputs) != 1:
        raise ValueError(f"{material.name}: ambiguous active material output")
    seen = set()
    pending = [outputs[0]]
    while pending:
        node = pending.pop()
        if node in seen:
            continue
        seen.add(node)
        if node.type == "GROUP":
            raise ValueError(f"{material.name}: inspect nested material graph before capture")
        for socket in node.inputs:
            pending.extend(link.from_node for link in socket.links)
    return list(seen)


def base_color_node(material):
    nodes = active_nodes(material)
    shaders = [n for n in nodes if n.type == "BSDF_PRINCIPLED"]
    if len(shaders) != 1:
        return None
    socket = shaders[0].inputs.get("Base Color")
    if socket is None or len(socket.links) != 1:
        return None
    source = socket.links[0].from_node
    return source if source.type == "TEX_IMAGE" and source.image is not None else None


def snapshot_mesh(obj, scene, depsgraph, materials):
    evaluated = obj.evaluated_get(depsgraph)
    plan.require_snapshot_trs(matrix_list(evaluated.matrix_world), obj.name)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    face_materials = [polygon.material_index for polygon in mesh.polygons]
    mesh.materials.clear()
    for slot in evaluated.material_slots:
        original = slot.material
        if original is None:
            raise ValueError(f"{obj.name}: empty material slot requires inspection")
        if original.name not in materials:
            materials[original.name] = original.copy()
            materials[original.name].animation_data_clear()
            if materials[original.name].node_tree:
                materials[original.name].node_tree.animation_data_clear()
        mesh.materials.append(materials[original.name])
    for polygon, index in zip(mesh.polygons, face_materials):
        polygon.material_index = index
    copy = bpy.data.objects.new("EvidenceSnapshot_" + obj.name, mesh)
    scene.collection.objects.link(copy)
    copy.matrix_world = evaluated.matrix_world.copy()
    copy.hide_render = True
    return copy


def verify_snapshot_world(handles):
    """Compare evaluated vertices after the capture scene becomes active and updates."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    checks = []
    for name, snapshot, expected in handles["snapshot_sources"]:
        evaluated = snapshot.evaluated_get(depsgraph)
        actual = world_vertices(evaluated)
        if len(actual) != len(expected):
            raise ValueError(f"{name}: snapshot world vertex count changed after update")
        error = max((math.dist(a, b) for a, b in zip(actual, expected)), default=0.0)
        if error > SNAPSHOT_VERTEX_TOL_M:
            raise ValueError(f"{name}: snapshot world vertices diverged after update: "
                             f"{error:.9g} m > {SNAPSHOT_VERTEX_TOL_M:g} m")
        checks.append({"name": name, "vertices": len(actual), "max_world_error_m": error})
    return {"status": "matched_after_update", "tolerance_m": SNAPSHOT_VERTEX_TOL_M,
            "method": "indexed evaluated source/snapshot world vertices",
            "normals": "not_verified; local normal layers are copied, no affine baking",
            "objects": checks}


def extract(source_scene, capture_scene):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    asset = source_scene.collection.children.get("lark")
    paths, objects = {}, {}

    def collect(collection, ancestry):
        path = ancestry + [collection.name]
        for obj in collection.objects:
            paths.setdefault(obj.name, []).append(path)
            objects[obj.name] = obj
        for child in collection.children:
            collect(child, path)

    if asset:
        collect(asset, [])
    scopes = {name: plan.base_scope(owners) for name, owners in paths.items()}
    lod0 = [obj for name, obj in objects.items() if scopes[name] == "base_lod0"]
    scoped = [obj for name, obj in objects.items() if scopes[name] != "excluded"]
    for obj in scoped:
        if "_dmg" in obj.name or "_husk" in obj.name:
            raise ValueError(f"variant name conflicts with base/shared collection ownership: {obj.name}")
    meshes = [o for o in lod0 if o.type == "MESH" and not o.name.startswith(("COL_", "REF_"))]
    colliders = [o for o in scoped if o.type == "MESH" and o.name.startswith("COL_")]
    hardpoints = [o for o in scoped if o.type == "EMPTY" and o.name.startswith(("HP_S_", "HP_M_", "HP_L_"))]
    pivots = [o for o in scoped if o.type == "EMPTY" and (o.name == "Canopy" or o.name.startswith("Gear"))]
    boarding = next((o for o in scoped if o.name == "BoardingFoot" and o.type == "EMPTY"), None)
    reference = source_scene.collection.children.get("REF")
    refs = {name: reference.all_objects.get(name) if reference else None for name in ("REF_Biped", "REF_Grid")}
    refs = {name: obj if obj and obj.type == "MESH" else None for name, obj in refs.items()}
    originals = list(dict.fromkeys(meshes + colliders + [o for o in refs.values() if o is not None]))
    source_vertices = {o.name: world_vertices(o.evaluated_get(depsgraph)) for o in originals}
    material_copies = {}
    snapshots = {o.name: snapshot_mesh(o, capture_scene, depsgraph, material_copies) for o in originals}
    original_names = {copy.name: name for name, copy in material_copies.items()}
    used_materials = {}
    for obj in meshes:
        frozen = snapshots[obj.name]
        for index in {p.material_index for p in frozen.data.polygons}:
            if index >= len(frozen.material_slots):
                raise ValueError(f"{obj.name}: unresolved face material {index}")
            material = frozen.material_slots[index].material
            used_materials[original_names[material.name]] = material
    facts, graph_gaps, swap_nodes, dependencies = {}, [], [], {}
    for name, material in used_materials.items():
        nodes = active_nodes(material)
        color = base_color_node(material)
        if name in plan.MATERIALS and color is None:
            graph_gaps.append(name + " active base-color graph unresolved")
        tagged = [n for n in nodes if n.type == "TEX_IMAGE" and n.image and
                  ("baseColor" in n.image.name or n.image.name.startswith("lark_livery_"))]
        for node in nodes:
            if node.type == "TEX_IMAGE":
                fact = image_fact(node.image)
                if not fact or not fact["packed_clean"]:
                    raise ValueError(f"{name}: active image lacks clean packed bytes; inspect dependency")
                dependencies[node.image.name] = fact
        for node in tagged:
            if node not in swap_nodes:
                swap_nodes.append(node)
            facts[name + "/" + node.name] = image_fact(node.image)
        if color is not None and name in plan.MATERIALS:
            facts[name] = image_fact(color.image)
            if color not in swap_nodes:
                swap_nodes.append(color)
    biped = snapshots.get("REF_Biped")
    grid = snapshots.get("REF_Grid")
    observations = {
        "lod0_collection": "lark_LOD0", "lod0_present": bool(lod0),
        "frame": source_scene.frame_current, "subframe": source_scene.frame_subframe,
        "units": {"system": source_scene.unit_settings.system, "scale_length": source_scene.unit_settings.scale_length,
                  "convention": "one Blender world unit = one metre, pinned author asset"},
        "objects": [object_fact(o, depsgraph) for o in dict.fromkeys(originals + hardpoints + pivots + ([boarding] if boarding else []))],
        "active_materials": sorted(used_materials), "image_dependencies": dependencies,
        "selection": "base LOD0 meshes plus shared asset colliders/markers; exact names in REF; no duplicate fallback",
        "collection_paths": paths, "object_scopes": scopes,
    }
    if abs(source_scene.unit_settings.scale_length - 1.0) > 1e-9:
        raise ValueError("metre conversion requires inspection for this source unit scale")
    extracted = {
        "lod0_meshes": [o.name for o in meshes], "collider_names": [o.name for o in colliders],
        "biped": {"vertices": source_vertices["REF_Biped"]} if biped else None,
        "grid": {"vertices": source_vertices["REF_Grid"], "edges": [tuple(e.vertices) for e in grid.data.edges]} if grid else None,
        "boarding_xyz": tuple(boarding.evaluated_get(depsgraph).matrix_world.translation) if boarding else None,
        "hardpoints": [object_fact(o, depsgraph) for o in hardpoints],
        "pivots": [object_fact(o, depsgraph) for o in pivots],
        "materials": facts, "images": {name: image_fact(bpy.data.images.get(name)) for name in plan.ALT_IMAGES.values()},
        "livery_graph_gaps": graph_gaps, "observations": observations,
    }
    handles = {"lod0": [snapshots[o.name] for o in meshes], "biped": biped, "grid": grid,
               "colliders": [snapshots[o.name] for o in colliders], "swap_nodes": swap_nodes,
               "snapshot_sources": [(o.name, snapshots[o.name], source_vertices[o.name]) for o in originals]}
    return extracted, handles


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
    for polygon in dup.data.polygons:
        polygon.material_index = 0
    world = obj.matrix_world.copy()
    link_object(dup)
    dup.parent = None
    dup.matrix_world = world
    show(dup)
    return dup


def _orthonormal(direction):
    axis = Vector(direction)
    if axis.length < 1e-8:
        raise ValueError("degenerate marker axis")
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


def show_lod0(objects):
    for obj in objects:
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
    # A bounding sphere fits any view direction; account for portrait frames too.
    diameter = math.sqrt(sum((maxs[i] - mins[i]) ** 2 for i in range(3)))
    aspect = shot.get("cell_width", shot["width"]) / shot.get("cell_height", shot["height"])
    scale = max(.5, diameter * shot["margin"] * max(1, aspect, 1 / aspect))
    place_camera(camera, plan.center_of(mins, maxs), shot["direction"], scale)


def stage_body(handles, report):
    show_lod0(handles["lod0"])
    if handles["grid"] is not None:
        grid = handles["grid"]
        if len(grid.data.edges) > 512:
            raise ValueError("reference grid edge display exceeds cap; inspect before capture")
        vertices = world_vertices(grid)
        material = flat_material("EvidenceGrid_edges", (.45, .45, .45, 1), emit=.2)
        for index, edge in enumerate(grid.data.edges):
            start, end = (Vector(vertices[i]) for i in edge.vertices)
            direction = end - start
            if direction.length > 1e-8:
                rod(f"EvidenceGrid_{index}", start, direction, material, length=direction.length, radius=.006)
    placement = report["standing_reference_placement"]
    material = flat_material("EvidenceReference_display", (.95, .65, .12, 1))
    body = display_copy(handles["biped"], material, "EvidenceStandingReference")
    translate(body, placement["translation_m"])
    show(body)
    return object_corners(body)


def stage_colliders(handles, report):
    show_lod0(handles["lod0"])
    points = [p for obj in handles["lod0"] for p in object_corners(obj)]
    material = flat_material("EvidencePrep_collider", (.95, .15, .75, 1), emit=.35)
    for index, obj in enumerate(handles["colliders"]):
        copy = display_copy(obj, material, f"EvidenceCollider_{index}")
        # Edge cages keep the hull visible. This is display geometry, not collision evidence.
        wire = copy.modifiers.new("Display edges only", "WIREFRAME")
        wire.thickness = .015
        points.extend(object_corners(copy))
    axis_materials = {axis: flat_material(f"EvidencePrep_axis_{axis}", color, emit=2) for axis, color in AXIS_COLORS.items()}
    for marker in report["hardpoints"]:
        for axis, direction in enumerate(marker["axis_columns_xyz"]):
            if sum(x*x for x in direction) < 1e-16:
                continue
            obj = rod(f"EvidenceAxis_{marker['name']}_{axis}", marker["translation_m"], direction, axis_materials[axis])
            show(obj)
            points.extend(object_corners(obj))
    return points


def render_lineup(scene, shot, report, handles, out, images_already, samples):
    originals = [(node, node.image) for node in handles["swap_nodes"]]
    cell_dir = out / ".cells"
    cell_dir.mkdir(exist_ok=False)
    cells = []
    gates = []
    try:
        for source in report["liveries"]["sources"]:
            image = bpy.data.images.get(source["name"])
            if image_fact(image) != {k: v for k, v in source.items() if k != "id"}:
                raise RuntimeError("livery image changed after extraction")
            for node, _ in originals:
                node.image = image
            cell = cell_dir / f"{source['id']}.png"
            gates.append(render_pixels(scene, cell, shot["cell_width"], shot["cell_height"], images_already, samples))
            cells.append(cell)
        stitch(cells, out / "livery-lineup.png", shot["cell_width"], shot["cell_height"])
        return gates
    finally:
        for node, image in originals:
            node.image = image
        # Retain owned intermediate files on success/failure; never remove user files.


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


def prepare_scene(scene, args):
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = args["width"]
    scene.render.resolution_y = args["height"]
    scene.cycles.samples = args["samples"]
    scene.world = bpy.data.worlds.new("EvidencePrep_world")
    scene.world.use_nodes = True
    background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (.18, .18, .18, 1)
    background.inputs["Strength"].default_value = .8
    scene.view_settings.view_transform = "AgX"
    require_cpu(scene, 0)


def capture(args, blend, out):
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
    if bpy.data.libraries:
        raise ValueError("linked libraries are not sealed by the blend hash; inspect dependencies first")
    source_scene = bpy.context.scene
    scene = bpy.data.scenes.new("EvidencePrep")
    extracted, handles = extract(source_scene, scene)
    bpy.context.window.scene = scene
    prepare_scene(scene, args)
    extracted["observations"]["snapshot_world_check"] = verify_snapshot_world(handles)
    report = plan.assemble_report(extracted)
    shots = plan.plan_shots(extracted, report, args["width"], args["height"])
    add_lights(scene)
    camera = add_camera(scene)
    images, cpu_gates = [], []
    for shot in shots["shots"]:
        hide_all(scene)
        if shot["id"] == "livery-lineup":
            show_lod0(handles["lod0"])
            frame_camera(scene, camera, shot, [p for obj in handles["lod0"] for p in object_corners(obj)])
            observed = render_lineup(scene, shot, report, handles, out, len(images), args["samples"])
        else:
            points = stage_colliders(handles, report) if shot["id"] == "colliders-marker-axes" else stage_body(handles, report)
            frame_camera(scene, camera, shot, points)
            observed = [render_pixels(scene, out / f"{shot['id']}.png", shot["width"], shot["height"], len(images), args["samples"])]
        cpu_gates.append({"shot": shot["id"], "render_calls": observed})
        path = out / f"{shot['id']}.png"
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"missing render {path.name}")
        images.append({"file": path.name, "bytes": path.stat().st_size, "sha256": file_sha256(path), "label": shot["label"]})
    return {"status": "complete_with_gaps", "measurements": report, "plan": shots,
            "cpu_gates": cpu_gates, "images": images}


def main(argv):
    args = plan.parse_args(argv)
    blend = Path(args["blend"]).resolve()
    before = file_sha256(blend)
    if before != plan.SOURCE_SHA256:
        raise SystemExit("source hash mismatch; capture only the pinned 6445c7ec blend")
    out = plan.claim_output(args["out"], blend)
    payload = {"schema": plan.SCHEMA, "status": "failed", "review_qualification": "not_claimed",
               "dynamic_clearance": "not_measured", "images": [],
               "source_pin": {"reference_commit": plan.SOURCE_REVISION, "expected_sha256": plan.SOURCE_SHA256},
               "tool_sha256": {name: file_sha256(Path(__file__).with_name(name)) for name in ("capture.py", "capture_plan.py")},
               "ownership": {"directory": str(out), "policy": "fresh directory, no reuse or deletion"}}
    error = None
    try:
        payload.update(capture(args, blend, out))
    except (Exception, SystemExit, KeyboardInterrupt) as exc:
        error = exc
        payload["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            after = file_sha256(blend)
        except OSError:
            after = None
        payload["blend"] = {"path": str(blend), "sha256_before": before, "sha256_after": after,
                            "bytes_unchanged": before == after}
        if after != before:
            payload["status"] = "invalid_source_changed"
        write_json(out / "receipt.json", payload)
    if after != before:
        raise SystemExit(3)
    if error is not None:
        raise error
    print("EVIDENCE_PREP_DONE_WITH_GAPS", out / "receipt.json", flush=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
