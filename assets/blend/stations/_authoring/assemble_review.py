"""Assembled-kit review export: a kit .blend's modules joined socket to socket at each of LOD0..LOD3, optionally cut by a
plane, with 1.85 m bipeds and the Lark, written as one review-only .glb laid out `assembled/assembled_LOD<n>` for the
review scene (#review:stations/<file>), and optionally rendered in Blender at LOD0.

  Blender -b --factory-startup -P assemble_review.py -- <kit.blend> <out.glb> [--kit waystation|scrapyard]
      [--cut px,py,pz,nx,ny,nz] [--cut-only sy_rock,sy_mouth] [--cap sy_rock] [--figures] [--lark <lark.glb>]
      [--door 0..1] [--render <png> --cam ex,ey,ez,tx,ty,tz[,lens]] [--size WxH]

Mating rule (kitsheet.py's): a module's socket joins another's when they coincide with +Y opposed, Z kept up; `place`
sockets keep their orientation. --cut deletes everything on the +n side of the plane through p (Blender axes). Every join
is printed with its gap, and so is every pair of sockets of different placed modules left within 2 m of each other."""
import math
import os
import sys
import tempfile

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "packages", "tools", "blender")))
import common  # noqa: E402
from artlib import glb  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :]
src, out = argv[0], argv[1]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def floats(s):
    return [float(x) for x in s.split(",")] if s else None


kit_name = opt("--kit") or os.path.splitext(os.path.basename(src))[0]
cut = floats(opt("--cut"))
cut_only = set(opt("--cut-only").split(",")) if opt("--cut-only") else None
cap = set(opt("--cap").split(",")) if opt("--cap") else set()
door_open = float(opt("--door", "0"))
lark_glb = opt("--lark")
render_png = opt("--render")
cam = floats(opt("--cam"))
size = [int(v) for v in opt("--size", "1920x1080").split("x")]

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(src), load_ui=False)
sc = bpy.context.scene
for c in list(sc.collection.children):
    sc.collection.children.unlink(c)
ROT = Matrix.Rotation(math.pi, 4, "Z")
I = Matrix.Identity(4)


def base(name):
    return name.split(".")[0]


def sock(asset, name):
    o = next((o for o in bpy.data.collections[asset].objects if base(o.name) == name), None)
    return o.matrix_world.copy() if o else None


def sockets(asset):
    return [o for o in bpy.data.collections[asset].objects if o.type == "EMPTY" and base(o.name).startswith("Socket_")]


placed = []  # (asset, matrix, label)


def put(asset, mw, label=None):
    placed.append((asset, mw, label or asset))
    return mw


def mate(a_mw, a_asset, a_sock, b_asset, b_sock, label=None):
    sa, sb = sock(a_asset, a_sock), sock(b_asset, b_sock)
    if sa is None or sb is None or b_asset not in bpy.data.collections:
        print(f"SKIP {a_asset}.{a_sock} <- {b_asset}.{b_sock} (missing)")
        return None
    mw = a_mw @ sa @ ROT @ sb.inverted()
    gap = ((a_mw @ sa).translation - (mw @ sb).translation).length
    print(f"JOIN {a_asset}.{a_sock} <- {b_asset}.{b_sock}  gap {gap:.4f} m")
    return put(b_asset, mw, label)


def place(a_mw, a_asset, a_sock, b_asset, b_sock, label=None):
    sa, sb = sock(a_asset, a_sock), sock(b_asset, b_sock)
    if sa is None or sb is None:
        print(f"SKIP {a_asset}.{a_sock} <- {b_asset}.{b_sock} (missing)")
        return None
    print(f"PLACE {a_asset}.{a_sock} <- {b_asset}.{b_sock}")
    return put(b_asset, a_mw @ sa @ sb.inverted(), label)


figures = []  # world matrices of bipeds
larks = []  # world matrices of the Lark's origin


def layout_waystation():
    hangar = put("ws_hangar", I)
    deck = mate(hangar, "ws_hangar", "Socket_TradeDeck", "ws_tradedeck", "Socket_DeckMount")
    if deck is not None:
        place(deck, "ws_tradedeck", "Socket_Fabricator", "ws_fabricator", "Socket_Floor")
    mate(hangar, "ws_hangar", "Socket_BayDoor", "ws_baydoor", "Socket_DoorMount", "door")
    spine1 = mate(hangar, "ws_hangar", "Socket_Spine", "ws_spine", "Socket_Aft", "spine1")
    if spine1 is not None:
        mate(spine1, "ws_spine", "Socket_Port", "ws_habitat", "Socket_Base", "hab1")
        mate(spine1, "ws_spine", "Socket_Starboard", "ws_habitat", "Socket_Base", "hab2")
        ring = mate(spine1, "ws_spine", "Socket_Fore", "ws_ring", "Socket_HubAft", "ring")
        if ring is not None:
            spine2 = mate(ring, "ws_ring", "Socket_HubFore", "ws_spine", "Socket_Aft", "spine2")
            if spine2 is not None:
                mate(spine2, "ws_spine", "Socket_Fore", "ws_habitat", "Socket_Base", "hab3")
                mate(spine2, "ws_spine", "Socket_Port", "ws_habitat", "Socket_Base", "hab4")
    pads = {base(o.name): o.matrix_world.translation.copy() for o in bpy.data.collections["ws_hangar"].objects if base(o.name).startswith("BAY_Pad_")}
    for i, (pn, dx, dy) in enumerate((("BAY_Pad_17", 13.5, -3.0), ("BAY_Pad_18", -13.5, 2.0), ("BAY_Pad_12", 13.2, 4.0))):
        if pn in pads and "ws_refuelpost" in bpy.data.collections:
            p = pads[pn]
            put("ws_refuelpost", Matrix.Translation((p.x + dx, p.y + dy, 0.0)), f"refuel{i}")
    if "ws_cargopod" in bpy.data.collections:
        for i, (x, y, a) in enumerate(((58.0, 70.0, 0.2), (58.0, 66.4, 0.0), (54.6, 70.4, 1.4), (-58.0, 64.0, 0.1), (20.0, 74.5, 1.57))):
            put("ws_cargopod", Matrix.Translation((x, y, 7.0 if y > 68 else 0.0)) @ Matrix.Rotation(a, 4, "Z"), f"pod{i}")
    for p, a in ((Vector((30.0, 78.8, 7.0)), math.pi), (Vector((2.5, 66.0, 0.0)), 0.0), (Vector((-25.0, 18.0, 0.45)), 0.4), (Vector((-0.8, 79.0, 7.0)), 0.0), (Vector((14.0, -36.0, 0.0)), 0.0)):
        figures.append(Matrix.Translation(p) @ Matrix.Rotation(a, 4, "Z"))
    if "BAY_Pad_13" in pads:
        p13 = pads["BAY_Pad_13"]
        larks.append(Matrix.Translation((p13.x, p13.y, 0.45 + 1.95)) @ Matrix.Rotation(math.pi, 4, "Z"))


SY_KINDS = (("Socket_DockL_", "sy_dock_l"), ("Socket_Dock_", "sy_dock"), ("Socket_Deck_", "sy_deck"))


def anchor_of(asset):
    return next((base(o.name) for o in sockets(asset) if o.get("interface") == "anchor"), None)


def layout_scrapyard():
    rock = put("sy_rock", I)
    mate(rock, "sy_rock", "Socket_Mouth", "sy_mouth", "Socket_GateMount", "sy_gate")
    by_name = {}
    for s in sorted(sockets("sy_rock"), key=lambda o: o.name):
        n = base(s.name)
        for prefix, asset in SY_KINDS:
            if n.startswith(prefix) and asset in bpy.data.collections:
                mw = mate(rock, "sy_rock", n, asset, anchor_of(asset), n[len("Socket_") :].lower())
                by_name[n[len("Socket_") :]] = (asset, mw)
                break
    # gangways: a dock socket naming its deck (custom property `gangway`) gets an sy_gangway from the dock's hatch
    for s in sockets("sy_rock"):
        target = s.get("gangway")
        n = base(s.name)[len("Socket_") :]
        if target and n in by_name and "sy_gangway" in bpy.data.collections:
            asset, mw = by_name[n]
            mate(mw, asset, "Socket_Gangway", "sy_gangway", "Socket_DockEnd", f"gangway_{n.lower()}")
    docks = [(a, mw) for a, mw in by_name.values() if a.startswith("sy_dock") and mw is not None]
    decks = [mw for a, mw in by_name.values() if a == "sy_deck" and mw is not None]
    for a, mw in docks[:1]:
        bay = sock(a, "BAY_Dock")
        larks.append(mw @ bay @ Matrix.Translation((0, 0, 1.95)) @ Matrix.Rotation(0.6, 4, "Z"))
    for k, mw in enumerate(decks):
        for i, (x, y, r) in enumerate(((-6.0, -9.0, 0.3), (1.0, -11.5, 2.2), (-11.5, -5.0, 4.0))):
            figures.append(mw @ Matrix.Translation((x + k * 2.0, y, 0.0)) @ Matrix.Rotation(r + k, 4, "Z"))
    for a, mw in docks:
        figures.append(mw @ Matrix.Translation((1.6, -3.0, 0.0)) @ Matrix.Rotation(0.4, 4, "Z"))


(layout_waystation if kit_name == "waystation" else layout_scrapyard)()
if "--figures" not in argv:
    figures.clear()
if not lark_glb:
    larks.clear()

# every pair of sockets on different placed modules that ended up within 2 m: the joins the layout made, and any it
# implies (a gangway's far end meeting a deck)
world_socks = []
for idx, (asset, mw, label) in enumerate(placed):
    for s in sockets(asset):
        m = mw @ s.matrix_world
        world_socks.append((idx, f"{label}.{base(s.name)}", m.translation.copy(), (m.to_3x3() @ Vector((0, 1, 0))).normalized()))
seen = set()
for i, (ia, na, pa, ya) in enumerate(world_socks):
    for ib, nb, pb, yb in world_socks[i + 1 :]:
        if ia == ib or (pa - pb).length > 2.0:
            continue
        key = tuple(sorted((na, nb)))
        if key in seen:
            continue
        seen.add(key)
        ang = math.degrees(math.acos(max(-1.0, min(1.0, ya.dot(yb)))))
        print(f"MEET {na} ~ {nb}  gap {(pa - pb).length:.3f} m  +Y apart {ang:.1f} deg")

root = bpy.data.objects.new("assembled", None)
sc.collection.objects.link(root)
plane_co = Vector(cut[:3]) if cut else None
plane_no = Vector(cut[3:]).normalized() if cut else None


def cut_mesh(o, M, do_cap):
    me = o.data.copy()
    me.transform(M @ o.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(me)
    r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=plane_co, plane_no=plane_no, clear_outer=True)
    if do_cap:
        edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            try:
                f = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=plane_no)
                for face in f["geom"]:
                    if isinstance(face, bmesh.types.BMFace):
                        face.material_index = 0
            except Exception as e:  # a section that does not close is left open
                print("cap skipped", o.name, e)
    bm.to_mesh(me)
    bm.free()
    return me


lod_nodes = []
for lod in range(4):
    node = bpy.data.objects.new(f"assembled_LOD{lod}", None)
    sc.collection.objects.link(node)
    node.parent = root
    lod_nodes.append(node)
    for asset, mw, label in placed:
        coll = bpy.data.collections.get(f"{asset}_LOD{lod}")
        if coll is None:
            continue
        for o in coll.all_objects:
            if o.type != "MESH":
                continue
            M = mw
            if "open_x" in o:
                M = mw @ Matrix.Translation((o["open_x"] * door_open, 0.0, 0.0))
            if cut and (cut_only is None or asset in cut_only):
                me = cut_mesh(o, M, asset in cap)
                c = bpy.data.objects.new(f"{label}_{base(o.name)}", me)
                c.matrix_world = I
            else:
                c = bpy.data.objects.new(f"{label}_{base(o.name)}", o.data)
                c.matrix_world = M @ o.matrix_world
            sc.collection.objects.link(c)
            c.parent = node
            c.matrix_parent_inverse = I

# Keep each module's lights, gameplay markers and collider volumes in the review assembly.
# The review scene reads these names and extras for lighting, overlays and paired performance.
for asset, mw, label in placed:
    for o in bpy.data.collections[asset].objects:
        name = base(o.name)
        if not name.startswith(("COL_", "Light_", "Interact", "Socket_", "BAY_")):
            continue
        prefix, _, suffix = name.partition("_")
        c = o.copy()
        c.name = f"{prefix}_{label}_{suffix}"
        sc.collection.objects.link(c)
        c.parent = root
        M = mw @ Matrix.Translation((o.get("open_x", 0.0) * door_open, 0, 0))
        c.matrix_world = M @ o.matrix_world

if figures:
    bip_mat = common.flat_material("REF_BipedPaint", (0.9, 0.35, 0.05), 0.6)
    tmpc = bpy.data.collections.new("tmp_fig")
    bip = common.biped(tmpc, "biped_src")
    bip.data.materials.append(bip_mat)
    for node in lod_nodes:
        for i, mw in enumerate(figures):
            b = bpy.data.objects.new(f"biped_{i}", bip.data)
            sc.collection.objects.link(b)
            b.parent = node
            b.matrix_world = mw

if lark_glb and larks:
    from artlib import ktx  # noqa: E402

    # (a kit's minimal glTF settings group would shadow the importer's own, which carries more sockets)
    for g in bpy.data.node_groups:
        if g.name.startswith("glTF Material Output"):
            g.name = "kit glTF settings"
    dec = os.path.join(tempfile.mkdtemp(prefix="assemble-review-"), "lark.glb")
    ktx.decoded_copy(lark_glb, dec)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=dec)
    imported = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    for lod, node in enumerate(lod_nodes):
        lod_root = next((o for o in imported if base(o.name) == f"lark_LOD{lod}"), None)
        parts = [o for o in lod_root.children_recursive if o.type == "MESH" and not o.hide_render] if lod_root else []
        for i, mw in enumerate(larks):
            for o in parts:
                c = bpy.data.objects.new(f"lark{i}_{base(o.name)}", o.data)
                sc.collection.objects.link(c)
                c.parent = node
                c.matrix_world = mw @ o.matrix_world
    for o in imported:
        bpy.data.objects.remove(o)

bpy.context.view_layer.update()
keep = [root] + list(root.children_recursive)
for o in bpy.context.view_layer.objects:
    o.select_set(o in keep)
bpy.context.view_layer.objects.active = root
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(out),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_extras=True,
    export_normals=True,
    export_vertex_color="ACTIVE",
    export_materials="EXPORT",
    export_animations=False,
)
manifest, binary = glb.read(out)
if not manifest.get("meshes"):
    raise RuntimeError("assembled review export contains no meshes")
# Generic review hides Light_* markers. Add actual review-only punctual emitters beside them,
# using the same authored values that the station builder reads, so paired perf includes lighting.
light_specs = []
for marker_index, marker in enumerate(list(manifest["nodes"])):
    if not marker.get("name", "").startswith("Light_"):
        continue
    values = marker["extras"]
    color = values["color"]
    linear = common.lin(color) if isinstance(color, str) else color
    emitter = {key: marker[key] for key in ("translation", "rotation", "scale", "matrix") if key in marker}
    emitter["name"] = "ReviewLamp_" + marker["name"][len("Light_"):]
    emitter["extensions"] = {"KHR_lights_punctual": {"light": len(light_specs)}}
    light_specs.append({"type": "point", "color": list(linear), "intensity": float(values["intensity"]), "range": float(values["distance"])})
    for parent in manifest["nodes"]:
        if marker_index in parent.get("children", []):
            parent["children"].append(len(manifest["nodes"]))
            break
    manifest["nodes"].append(emitter)
if light_specs:
    manifest.setdefault("extensions", {})["KHR_lights_punctual"] = {"lights": light_specs}
    used = manifest.setdefault("extensionsUsed", [])
    if "KHR_lights_punctual" not in used:
        used.append("KHR_lights_punctual")
    glb.write(out, manifest, binary)
print(f"REVIEW LIGHTS: {len(light_specs)} live point lights from authored markers")
tris = [sum(len(p.vertices) - 2 for c in n.children if c.type == "MESH" for p in c.data.polygons) for n in lod_nodes]
print(f"ASSEMBLED {kit_name}: {len(placed)} modules, {len(figures)} bipeds, {len(larks)} Larks; tris per LOD {tris}; wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)")

if render_png:
    for n in lod_nodes[1:]:
        for c in n.children:
            c.hide_render = True
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.eevee.taa_render_samples = 24
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.02, 0.025, 0.035, 1)
    for nm, e, rot in (("key", 4.5, (50, 0, 35)), ("fill", 0.9, (115, 0, 210)), ("rim", 1.2, (80, 0, 140))):
        L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, "SUN"))
        L.data.energy = e
        L.rotation_euler = tuple(math.radians(v) for v in rot)
        sc.collection.objects.link(L)
    # the modules' own Light_* markers as point lights
    for asset, mw, label in placed:
        for o in bpy.data.collections[asset].objects:
            if base(o.name).startswith("Light_"):
                L = bpy.data.objects.new(f"{label}_{base(o.name)}", bpy.data.lights.new(o.name, "POINT"))
                h = str(o.get("color", "#ffffff")).lstrip("#")
                L.data.color = tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
                d = float(o.get("distance", 20.0))
                L.data.energy = float(o.get("intensity", 1.0)) * d * d * 40.0
                L.data.use_shadow = False
                L.location = (mw @ o.matrix_world).translation
                sc.collection.objects.link(L)
    camo = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(camo)
    sc.camera = camo
    camo.data.clip_end = 8000
    camo.data.lens = cam[6] if len(cam) > 6 else 24
    camo.location = cam[:3]
    camo.rotation_euler = (Vector(cam[3:6]) - Vector(cam[:3])).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.abspath(render_png)
    bpy.ops.render.render(write_still=True)
    print("RENDERED", render_png)
