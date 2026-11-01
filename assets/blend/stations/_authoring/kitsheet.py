"""Kit sheet: the Waystation assembled socket to socket from waystation.blend's LOD0 collections, with 1.85 m bipeds and
the Lark for scale. -- <waystation.blend> <lark.glb> <out_prefix> [scrapyard.blend]
Mating rule: a module's socket joins another's when they coincide with +Y opposed (Z kept up); `place` sockets keep
their orientation. Prints every join and the gap between mated faces."""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "packages", "tools", "blender")))
import common  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :]
ws_blend, lark_glb, out = argv[0], argv[1], argv[2]
sy_blend = argv[3] if len(argv) > 3 else None

bpy.ops.wm.open_mainfile(filepath=ws_blend, load_ui=False)
sc = bpy.context.scene
for c in list(sc.collection.children):
    sc.collection.children.unlink(c)
kit = bpy.data.collections.new("KitSheet")
sc.collection.children.link(kit)
ROT = Matrix.Rotation(math.pi, 4, "Z")


def sock(asset, name):
    coll = bpy.data.collections[asset]
    o = next(o for o in coll.objects if o.name.split(".")[0] == name)
    return o.matrix_world.copy()


def put(asset, mw, label=None):
    e = bpy.data.objects.new(label or asset, None)
    e.instance_type = "COLLECTION"
    e.instance_collection = bpy.data.collections[f"{asset}_LOD0"]
    e.matrix_world = mw
    kit.objects.link(e)
    return mw


def mate(a_mw, a_asset, a_sock, b_asset, b_sock, label=None):
    sa = sock(a_asset, a_sock)
    sb = sock(b_asset, b_sock)
    mw = a_mw @ sa @ ROT @ sb.inverted()
    # gap: distance between the two sockets' world positions after the join (0 when they meet face to face)
    gap = ((a_mw @ sa).translation - (mw @ sb).translation).length
    print(f"JOIN {a_asset}.{a_sock} <- {b_asset}.{b_sock}  gap {gap:.4f} m")
    return put(b_asset, mw, label)


def place(a_mw, a_asset, a_sock, b_asset, b_sock, label=None):
    sa = sock(a_asset, a_sock)
    sb = sock(b_asset, b_sock)
    mw = a_mw @ sa @ sb.inverted()
    print(f"PLACE {a_asset}.{a_sock} <- {b_asset}.{b_sock}")
    return put(b_asset, mw, label)


I = Matrix.Identity(4)
hangar = put("ws_hangar", I)
sa, sb = sock("ws_hangar", "Socket_BayDoor"), sock("ws_baydoor", "Socket_DoorMount")
door = hangar @ sa @ ROT @ sb.inverted()
print(f"JOIN ws_hangar.Socket_BayDoor <- ws_baydoor.Socket_DoorMount  gap {((hangar @ sa).translation - (door @ sb).translation).length:.4f} m (leaves shown 55% open)")
for o in bpy.data.collections["ws_baydoor_LOD0"].objects:
    c = o.copy()
    kit.objects.link(c)
    c.matrix_world = door @ Matrix.Translation((o.get("open_x", 0.0) * 0.55, 0.0, 0.0)) @ o.matrix_world
deck = mate(hangar, "ws_hangar", "Socket_TradeDeck", "ws_tradedeck", "Socket_DeckMount")
fab = place(deck, "ws_tradedeck", "Socket_Fabricator", "ws_fabricator", "Socket_Floor")
spine1 = mate(hangar, "ws_hangar", "Socket_Spine", "ws_spine", "Socket_Aft", "spine1")
hab1 = mate(spine1, "ws_spine", "Socket_Port", "ws_habitat", "Socket_Base", "hab1")
hab2 = mate(spine1, "ws_spine", "Socket_Starboard", "ws_habitat", "Socket_Base", "hab2")
ring = mate(spine1, "ws_spine", "Socket_Fore", "ws_ring", "Socket_HubAft", "ring")
spine2 = mate(ring, "ws_ring", "Socket_HubFore", "ws_spine", "Socket_Aft", "spine2")
hab3 = mate(spine2, "ws_spine", "Socket_Fore", "ws_habitat", "Socket_Base", "hab3")
hab4 = mate(spine2, "ws_spine", "Socket_Port", "ws_habitat", "Socket_Base", "hab4")
# the bay door half open: its leaves slide by open_x (shown at 60%)
for o in bpy.data.collections["ws_baydoor_LOD0"].objects:
    pass

# props on the hangar floor and the deck
pads = [o for o in bpy.data.collections["ws_hangar"].objects if o.name.startswith("BAY_Pad_")]
padpos = {o.name: o.matrix_world.translation.copy() for o in pads}
for i, (pn, dx, dy) in enumerate((("BAY_Pad_17", 13.5, -3.0), ("BAY_Pad_18", -13.5, 2.0), ("BAY_Pad_12", 13.2, 4.0))):
    p = padpos[pn]
    put("ws_refuelpost", Matrix.Translation((p.x + dx, p.y + dy, 0.0)), f"refuel{i}")
for i, (x, y, a) in enumerate(((58.0, 70.0, 0.2), (58.0, 66.4, 0.0), (54.6, 70.4, 1.4), (-58.0, 64.0, 0.1), (20.0, 74.5, 1.57))):
    z = 7.0 if y > 68 else 0.0
    put("ws_cargopod", Matrix.Translation((x, y, z)) @ Matrix.Rotation(a, 4, "Z"), f"pod{i}")

# bipeds: at the fabricator's use point, on the deck, on the stairs' foot, beside pads
bip_mat = common.flat_material("REF_BipedPaint", (0.9, 0.35, 0.05), 0.6)
bip_src = common.biped(kit, "biped_src")
bip_src.data.materials.append(bip_mat)
bip_src.hide_render = True
fab_use = (deck @ Matrix.Translation((-30.0, -11.2, 7.0))).translation
spots = [(fab_use, math.pi), (Vector((30.0, 78.8, 7.0)), math.pi), (Vector((2.5, 66.0, 0.0)), 0.0), (Vector((-25.0, 18.0, 0.45)), 0.4), (Vector((-0.8, 79.0, 7.0)), 0.0), (Vector((14.0, -36.0, 0.0)), 0.0), (Vector((-61.8, 30.0, 7.0)), 1.57)]
for i, (p, a) in enumerate(spots):
    b = bip_src.copy()
    b.hide_render = False
    b.matrix_world = Matrix.Translation(p) @ Matrix.Rotation(a, 4, "Z")
    kit.objects.link(b)

# the Lark: on pad 13 (the middle), and one more on approach outside the mouth
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "packages", "tools", "blender")))
from artlib import ktx  # noqa: E402
import tempfile  # noqa: E402

# (the kit's minimal glTF settings group would shadow the importer's own, which carries more sockets)
for g in bpy.data.node_groups:
    if g.name.startswith("glTF Material Output"):
        g.name = "kit glTF settings"
tmp = tempfile.mkdtemp(prefix="kitsheet-")
dec = os.path.join(tmp, "lark.glb")
ktx.decoded_copy(lark_glb, dec)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=dec)
lark_objs = [o for o in bpy.data.objects if o not in before]
keep_lod = [o for o in lark_objs if "LOD0" in o.name or any(p and "LOD0" in p.name for p in [o.parent, o.parent.parent if o.parent else None])]
lark_root = [o for o in lark_objs if o.parent is None]
for o in lark_objs:
    nm = o.name
    hide = any(t in nm for t in ("LOD1", "LOD2", "LOD3", "COL_", "damaged", "husked"))
    par = o.parent
    while par is not None:
        if any(t in par.name for t in ("LOD1", "LOD2", "LOD3", "damaged", "husked")):
            hide = True
        par = par.parent
    o.hide_render = hide
lark_coll = bpy.data.collections.new("LarkRef")
for o in lark_objs:
    for c in list(o.users_collection):
        c.objects.unlink(o)
    lark_coll.objects.link(o)
p13 = padpos["BAY_Pad_13"]
for i, mw in enumerate((Matrix.Translation((p13.x, p13.y, 0.45 + 1.95)) @ Matrix.Rotation(math.pi, 4, "Z"), Matrix.Translation((18.0, -150.0, 26.0)) @ Matrix.Rotation(math.pi + 0.15, 4, "Z") @ Matrix.Rotation(-0.06, 4, "X"))):
    e = bpy.data.objects.new(f"lark{i}", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = lark_coll
    e.matrix_world = mw
    kit.objects.link(e)

# the Scrapyard, assembled 2 km off: gate in the mouth, three docks and two decks on the cavity wall
SY = None
if sy_blend:
    with bpy.data.libraries.load(sy_blend, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c.startswith("sy_")]
    sy_off = Matrix.Translation((2200.0, 0.0, 0.0))
    rock = put("sy_rock", sy_off, "sy_rock")
    mate(rock, "sy_rock", "Socket_Mouth", "sy_mouth", "Socket_GateMount", "sy_gate")
    docks = {}
    for k in (1, 2, 3):
        docks[k] = mate(rock, "sy_rock", f"Socket_Dock_{k}", "sy_dock", "Socket_DockAnchor", f"sy_dock{k}")
    decks = {}
    for k in (1, 2):
        decks[k] = mate(rock, "sy_rock", f"Socket_Deck_{k}", "sy_deck", "Socket_DeckAnchor", f"sy_deck{k}")
    SY = (rock, docks, decks)
    pad = docks[1] @ Matrix.Translation((0.0, -17.0, 0.0))
    e = bpy.data.objects.new("lark_sy", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = lark_coll
    e.matrix_world = pad @ Matrix.Translation((0, 0, 1.95)) @ Matrix.Rotation(0.6, 4, "Z")
    kit.objects.link(e)
    for i, (dk, p) in enumerate(((decks[1], (-6.0, -9.0, 0.0)), (decks[1], (1.0, -11.5, 0.0)), (decks[2], (-3.0, -7.4, 0.0)), (docks[1], (1.6, -3.0, 0.0)))):
        b = bip_src.copy()
        b.hide_render = False
        b.matrix_world = dk @ Matrix.Translation(p) @ Matrix.Rotation(0.4 * i, 4, "Z")
        kit.objects.link(b)

# render: EEVEE, a dark sky with a key sun and a cool fill
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.02, 0.025, 0.035, 1)
bg.inputs[1].default_value = 1.0
for nm, e, rot in (("key", 4.5, (50, 0, 35)), ("fill", 0.9, (115, 0, 210)), ("rim", 1.2, (80, 0, 140))):
    L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, "SUN"))
    L.data.energy = e
    L.rotation_euler = tuple(math.radians(v) for v in rot)
    sc.collection.objects.link(L)
inner = bpy.data.objects.new("hall", bpy.data.lights.new("hall", "AREA"))
inner.data.energy = 4.0e5
inner.data.size = 100
inner.location = (0, 15, 40)
sc.collection.objects.link(inner)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.clip_end = 6000
views = {
    "exterior": ((-420.0, -40.0, 230.0), (0.0, 105.0, 0.0), 30),
    "approach": ((90.0, -230.0, 30.0), (-5.0, 0.0, 22.0), 28),
    "hangar": ((-58.0, -52.0, 14.0), (10.0, 70.0, 4.0), 22),
    "fabricator": ((-24.5, 64.5, 9.8), (-30.0, 80.0, 8.0), 28),
    "spine": ((150.0, 95.0, 70.0), (0.0, 150.0, 12.0), 30),
}
if SY:
    rock = SY[0]
    for i, (pos, e) in enumerate((((2200.0, 0.0, 10.0), 5.0e5), ((2200.0, -60.0, 0.0), 1.2e5))):
        L = bpy.data.objects.new(f"cavity{i}", bpy.data.lights.new(f"cavity{i}", "POINT"))
        L.data.energy = e
        L.data.color = (1.0, 0.62, 0.42)
        L.location = pos
        sc.collection.objects.link(L)
    views["scrapyard_mouth"] = ((2200.0 + 120.0, -380.0, 60.0), (2200.0, -60.0, 0.0), 30)
    d1 = SY[1][1] @ Matrix.Translation((0.0, -17.0, 0.0))
    p1 = d1.translation
    views["scrapyard_cavity"] = ((2200.0 + 6.0, -62.0, 18.0), (p1.x, p1.y, p1.z), 18)
paths = []
for k, (pos, tgt, lens) in views.items():
    cam.location = pos
    cam.data.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    p = f"{out}_{k}.png"
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    paths.append(p)
print("KITSHEET", paths)
