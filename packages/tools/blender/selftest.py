"""Self-test for validate.py and the export core: builds small synthetic sources in a temp directory, then asserts the
validator's verdicts and runs the export end to end (bake, generated LODs, node layout, re-validation).

Run: pnpm art:test
 or: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/selftest.py -- [--keep]
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from artlib import bake, core  # noqa: E402
from artlib import export as E  # noqa: E402
from artlib import glb  # noqa: E402
from artlib import materials as M  # noqa: E402
from artlib import rules as R  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
TMP = Path(tempfile.mkdtemp(prefix="art-selftest-"))
SRC = TMP / "src"
OUT = TMP / "out"
REPORTS = TMP / "reports"
RULES = R.load()
RESULTS = []


def expect(cond, msg):
    RESULTS.append((bool(cond), msg))
    print(("  ok    " if cond else "  FAIL  ") + msg)


def messages(report, check):
    return [f["subject"] + ": " + f["message"] for f in report[check].findings if f["level"] == "fail"]


def has(report, check, text):
    return any(text in m for m in messages(report, check))


# ---------------------------------------------------------------------------------------------- builders
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def put(obj, c):
    c.objects.link(obj)
    return obj


def mesh_from(name, verts, faces=(), edges=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [tuple(f) for f in faces])
    if faces:
        me.uv_layers.new(name="UVMap")
    me.update()
    return bpy.data.objects.new(name, me)


def box(name, size, center=(0, 0, 0)):
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = center
    v = [(cx + x * sx, cy + y * sy, cz + z * sz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_from(name, v, f)


def sphere(name, segments, rings, radius, z=None):
    """UV sphere with UVs: 2 * segments * (rings - 1) triangles."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius, calc_uvs=True)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, radius if z is None else z))
    bm.to_mesh(me)
    bm.free()
    return bpy.data.objects.new(name, me)


def references(cells=20, size=20.0, biped=1.85):
    """REF like the library's: a size x size m grid of cells x cells faces drawn with a Wireframe modifier (so the
    evaluated mesh has other vertices than the grid), and a box biped standing on the grid plane."""
    ref = coll("REF")
    n = cells + 1
    step = size / cells
    verts = [(x * step - size / 2, y * step - size / 2, 0) for y in range(n) for x in range(n)]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i) for j in range(cells) for i in range(cells)]
    grid = put(mesh_from("REF_Grid", verts, faces), ref)
    grid.modifiers.new("lines", "WIREFRAME").thickness = 0.02
    put(box("REF_Biped", (0.5, 0.3, biped), (2.0, 0, biped / 2)), ref)
    return ref


def image(name, size, colorspace, mean, amp, seed=0):
    rng = np.random.default_rng(seed)
    px = np.empty((size * size, 4), np.float32)
    px[:, :3] = np.clip(np.asarray(mean, np.float32) + (rng.random((size * size, 3), np.float32) - 0.5) * amp, 0, 1)
    px[:, 3] = 1.0
    im = bpy.data.images.new(name, size, size, alpha=False)
    im.colorspace_settings.name = colorspace
    im.pixels.foreach_set(px.ravel())
    path = TMP / "img" / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    im.pack()
    return im


def gltf_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def tex(nt, img):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    return t


def pbr_material(name, base_res=1024, res=256, uniform_roughness=False, ao=True, rough=None):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(tex(nt, image(f"{name}_base", base_res, "sRGB", (0.5, 0.4, 0.3), 0.4, 1)).outputs["Color"], bsdf.inputs["Base Color"])
    rough = rough or image(f"{name}_rough", res, "Non-Color", (0.5, 0.5, 0.5), 0.0 if uniform_roughness else 0.5, 2)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex(nt, rough).outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    met = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex(nt, image(f"{name}_metal", res, "Non-Color", (0.5, 0.5, 0.5), 0.9, 3)).outputs["Color"], met.inputs["Color"])
    nt.links.new(met.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(nt, image(f"{name}_normal", res, "Non-Color", (0.5, 0.5, 1.0), 0.2, 4)).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if not ao:
        return m
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = gltf_group()
    ao = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex(nt, image(f"{name}_ao", res, "Non-Color", (0.8, 0.8, 0.8), 0.3, 5)).outputs["Color"], ao.inputs["Color"])
    nt.links.new(ao.outputs["Red"], g.inputs["Occlusion"])
    return m


def flat_material(name, colour=(0.8, 0.2, 0.1)):
    m = bpy.data.materials.new(name)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    return m


def procedural_material(name, bump_distance=0.05):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 8.0
    nt.links.new(noise.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bsdf.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = bump_distance
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


def with_material(o, m):
    o.data.materials.append(m)
    return o


def save(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)
    return path


def collider(name, size, center):
    return box(name, size, center)


# ---------------------------------------------------------------------------------------------- sources
def build_crate():
    """A prop that passes: 4 hand-made LODs, full PBR at 1k, collider, REF references."""
    reset()
    references()
    a = coll("crate")
    mat = pbr_material("CrateBody")
    for n, (s, r) in enumerate([(64, 32), (40, 20), (24, 12), (10, 6)]):
        lod = coll(f"crate_LOD{n}", a)
        put(with_material(sphere(f"crate_body_{n}", s, r, 0.45), mat), lod)
    put(collider("COL_crate", (0.9, 0.9, 0.9), (0, 0, 0.45)), a)
    e = put(bpy.data.objects.new("Interact", None), a)
    e.location = (0, -0.6, 0.5)
    put(with_material(sphere("wip blob", 200, 200, 30.0), flat_material("Wip Paint")), coll("_wip", a))  # ignored
    return save(SRC / "props" / "crate.blend")


def build_broken():
    """A prop that fails every check."""
    reset()
    a = coll("broken")
    lod0 = coll("broken_LOD0", a)
    lod1 = coll("broken_lod1", a)
    put(with_material(sphere("broken_body", 160, 160, 10.0), flat_material("Flat Paint")), lod0)
    put(with_material(sphere("broken_low", 24, 12, 10.0), pbr_material("Uniform", uniform_roughness=True)), lod1)
    put(bpy.data.objects.new("Light_0", None), a)
    bpy.context.scene.collection.objects.link(box("loose_box", (1, 1, 1)))
    return save(SRC / "props" / "broken.blend")


def build_rock():
    """A prop with no hand-made LODs and a procedural material: the export bakes and decimates."""
    reset()
    references()
    a = coll("rock")
    put(with_material(sphere("rock_body", 64, 32, 0.5), procedural_material("RockSurface")), a)
    put(collider("COL_rock", (1, 1, 1), (0, 0, 0.5)), a)
    return save(SRC / "props" / "rock.blend")


def creature_mesh(name, attrs, mask):
    o = sphere(name, 96, 96, 0.7)
    me = o.data
    n = len(me.vertices)
    if attrs:
        me.attributes.new("_limb", "FLOAT", "POINT").data.foreach_set("value", np.zeros(n, np.float32))
        me.attributes.new("_pivot", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", np.zeros(n * 3, np.float32))
        me.attributes.new("_glow", "FLOAT", "POINT").data.foreach_set("value", np.zeros(n, np.float32))
    if mask:
        ca = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
        w = np.tile(np.array([0.6, 0.3, 0.1, 1.0], np.float32), len(me.loops))
        ca.data.foreach_set("color", w)
    return o


def build_creatures():
    reset()
    references()
    mat = pbr_material("Hide", base_res=2048, res=512)
    for name, ok in (("beast", True), ("brute", False)):
        a = coll(name)
        put(with_material(creature_mesh(f"{name}_body", ok, ok), mat), a)
    o = creature_mesh("gnash_body", True, True)
    o.data.color_attributes["Color"].data.foreach_set("color", np.tile(np.array([0.9, 0.5, 0.1, 1.0], np.float32), len(o.data.loops)))
    put(with_material(o, mat), coll("gnash"))
    drake = coll("drake")
    drake["asset_class"] = "hero"
    put(with_material(creature_mesh("drake_body", True, True), mat), drake)
    return save(SRC / "creatures" / "beasts.blend")


def build_library():
    """A library with one material that drives nothing from nodes (fails) beside textured, signal and glass ones."""
    reset()
    references()
    put(with_material(sphere("swatch_hull", 32, 16, 0.5), pbr_material("LibHullPaint", base_res=2048, res=256)), coll("previews"))
    for m in (flat_material("LIB_Flat"), flat_material("LIB_Glass", (0.04, 0.06, 0.08)), flat_material("LIB_NavRed", (1, 0, 0))):
        m.use_fake_user = True
    return save(SRC / "_library.blend")


def build_hull():
    reset()
    references()
    a = coll("dart")
    put(with_material(sphere("dart_hull", 200, 160, 4.0), pbr_material("Accent", base_res=1024, res=256)), a)
    g = put(bpy.data.objects.new("GearFront", None), a)
    g.location = (0, 2, 0)
    return save(SRC / "hulls" / "dart.blend")


def build_shared_library():
    """A separate library .blend like assets/blend/_library.blend: procedural and signal materials with engine names."""
    reset()
    references()
    plate = procedural_material("LIB_TestPlate")
    plate["engine_name"] = "Hull"
    glow = flat_material("LIB_EngineGlow", (0.0, 0.0, 0.0))
    bsdf = next(n for n in glow.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Emission Color"].default_value = (0.3, 0.7, 1.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 10.0
    glow["engine_name"] = "EngineGlow"
    glass = flat_material("LIB_Glass", (0.04, 0.06, 0.08))
    glass["engine_name"] = "Glass"
    for m in (plate, glow, glass):
        m.use_fake_user = True
    return save(TMP / "lib" / "library.blend")


def build_pod(library):
    """A prop whose two variants use a material linked (read-only) from the library; no hand-made LODs."""
    reset()
    references()
    with bpy.data.libraries.load(str(library), link=True) as (src, dst):
        dst.materials = ["LIB_TestPlate", "LIB_EngineGlow"]
    plate = bpy.data.materials["LIB_TestPlate"]
    glow = bpy.data.materials["LIB_EngineGlow"]
    a = coll("pod")
    for vid in ("pod", "pod_husk"):
        lod0 = coll(f"{vid}_LOD0", a)
        body = put(with_material(sphere(f"{vid}_body", 64, 32, 0.5), plate), lod0)
        body.data.materials.append(glow)
        body.data.polygons[0].material_index = 1
    put(collider("COL_pod", (1, 1, 1), (0, 0, 0.5)), a)
    return save(SRC / "props" / "pod.blend")


def build_faulty():
    """A prop with one of each remaining failure: references off scale, a top-level LOD collection, a LOD that is not
    lighter, LOD3 above 5%, a texture over the class size, a door too small for the biped."""
    reset()
    references(cells=21, size=20.0, biped=1.70)
    stray = coll("stray_LOD0")
    put(with_material(sphere("stray_body", 16, 8, 0.2), flat_material("StrayPaint")), stray)
    a = coll("steps")
    mat = pbr_material("Oversize", base_res=2048, res=256)
    for n, (sg, rg) in enumerate([(64, 32), (40, 20), (40, 20), (20, 12)]):
        put(with_material(sphere(f"steps_body_{n}", sg, rg, 0.45), mat), coll(f"steps_LOD{n}", a))
    put(with_material(box("Door_hatch", (1.0, 0.1, 2.0), (0, -0.6, 1.0)), mat), bpy.data.collections["steps_LOD0"])
    put(with_material(box("door_side", (0.8, 0.1, 2.0), (0.6, 0, 1.0)), mat), bpy.data.collections["steps_LOD0"])
    return save(SRC / "props" / "faulty.blend")


def plane(name, size, cuts):
    """A size x size m grid on z = 0 with planar UVs over [0, 1]."""
    n = cuts + 1
    verts = [(x * size / cuts - size / 2, y * size / cuts - size / 2, 0) for y in range(n) for x in range(n)]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i) for j in range(cuts) for i in range(cuts)]
    o = mesh_from(name, verts, faces)
    me = o.data
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    co = np.asarray(verts, np.float64)[vi, :2]
    me.uv_layers.active.data.foreach_set("uv", ((co + size / 2) / size).ravel())
    return o


def build_contact():
    """A block resting on a ground plate, separate meshes with separate materials and no AO maps: the export bakes AO
    and the block must shadow the plate around the contact."""
    reset()
    references()
    a = coll("contact")
    put(with_material(plane("contact_ground", 4.0, 48), pbr_material("Ground", ao=False)), a)
    put(with_material(box("contact_block", (1.0, 1.0, 1.0), (0, 0, 0.5)), pbr_material("Block", ao=False)), a)
    return save(SRC / "props" / "contact.blend")


def build_twin():
    """A hull with a husked variant; its gear, hardpoint, canopy and cockpit markers sit at asset level (shared), one
    hardpoint sits in the husk's own variant collection (the husk's only)."""
    reset()
    references()
    a = coll("twin")
    for vid in ("twin", "twin_husk"):
        put(with_material(sphere(f"{vid}_body", 32, 16, 4.0), flat_material(f"{vid}_paint")), coll(f"{vid}_LOD0", a))
    for name in ("GearFront", "hp_s_nose", "Canopy", "CockpitInterior"):
        put(bpy.data.objects.new(name, None), a)
    put(bpy.data.objects.new("HP_M_husk_only", None), coll("twin_husk", a))
    return save(SRC / "hulls" / "twin.blend")


def masked_image(name, size, box):
    """Flat 0.5 grey with noise only inside `box` (u0, v0, u1, v1)."""
    rng = np.random.default_rng(7)
    px = np.full((size, size, 4), 0.5, np.float32)
    px[..., 3] = 1.0
    u0, v0, u1, v1 = (int(x * size) for x in box)
    px[v0:v1, u0:u1, :3] += (rng.random((v1 - v0, u1 - u0, 3), np.float32) - 0.5) * 0.1
    im = bpy.data.images.new(name, size, size, alpha=False)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(px.ravel())
    path = TMP / "img" / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    im.pack()
    return im


def build_specks():
    """Two props whose UVs cover a 10% corner of a 1k roughness map that varies only in [0, 0.1]^2: speck_a sits on
    the varied texels (detail), speck_b on the flat ones (uniform). Over the whole map both read as flat."""
    reset()
    references()
    for name, (u, v) in (("speck_a", (0.0, 0.0)), ("speck_b", (0.5, 0.5))):
        rough = masked_image(f"{name}_rough", 1024, (0.0, 0.0, 0.1, 0.1))
        o = sphere(f"{name}_body", 64, 32, 0.45)
        uv = np.empty(len(o.data.loops) * 2, np.float64)
        o.data.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * 0.1 + (u, v)
        o.data.uv_layers.active.data.foreach_set("uv", uv.ravel())
        put(with_material(o, pbr_material(f"{name}_mat", rough=rough)), coll(name))
    return save(SRC / "props" / "specks.blend")


def build_flat():
    """Passes as a source (procedural channels are baked at export) but its bump is too faint to bake into a normal
    map, so the export fails re-validation."""
    reset()
    references()
    a = coll("flat")
    put(with_material(sphere("flat_body", 64, 32, 0.5), procedural_material("FaintBump", bump_distance=0.0001)), a)
    return save(SRC / "props" / "flat.blend")


# ---------------------------------------------------------------------------------------------- tests
def test_validator(crate, broken, creatures, hull, library):
    print("\nvalidator verdicts")
    rep = core.validate_path(RULES, crate, family="props")
    if rep.status != "PASS":
        core.write_and_print(rep, verbose=True)
    expect(rep.status == "PASS", "crate.blend (4 LODs, PBR 1k, collider, references) passes")
    for c in ("naming", "triangles", "lods", "materials", "scale"):
        expect(rep[c].status == "PASS", f"crate.blend: {c} passes")

    rep = core.validate_path(RULES, broken, family="props")
    expect(rep.status == "FAIL", "broken.blend fails")
    for c in ("naming", "triangles", "lods", "materials", "scale"):
        expect(rep[c].status == "FAIL", f"broken.blend: {c} fails")
    expect(has(rep, "naming", "not an identifier"), "naming: 'Flat Paint' is not an identifier")
    expect(has(rep, "naming", "Scene Collection"), "naming: a loose object in the Scene Collection")
    expect(has(rep, "naming", "missing custom properties color, intensity, distance"), "naming: Light_0 without its extras")
    expect(has(rep, "naming", "legacy LOD suffix"), "naming: legacy '_lod1' suffix")
    expect(has(rep, "triangles", "over the prop budget"), "triangles: LOD0 over the prop budget")
    expect(has(rep, "lods", "missing LOD2, LOD3"), "lods: a partial hand-made set")
    expect(has(rep, "materials", "untextured"), "materials: an untextured material")
    expect(has(rep, "materials", "roughness map Uniform_rough is uniform under the surface"), "materials: a uniform roughness map")
    expect(has(rep, "scale", "no 'REF' collection"), "scale: no reference collection")
    expect(has(rep, "scale", "longest side"), "scale: a 20 m prop")

    rep = core.validate_path(RULES, creatures, family="creatures")
    fails = messages(rep, "naming")
    expect(any("brute_body" in m and "_limb" in m for m in fails), "creatures: a mesh without _limb/_pivot/_glow fails")
    expect(any("brute_body" in m and "colour-region mask" in m for m in fails), "creatures: a mesh without a colour mask fails")
    expect(not any("beast_body" in m for m in fails), "creatures: a mesh with the attributes and a mask passes naming")
    expect(any("gnash_body" in m and "sum to 1" in m for m in fails), "creatures: mask weights that do not sum to 1 fail")
    drake = next((v for a in rep.assets for v in a["variants"] if v["id"] == "drake"), {})
    expect(drake.get("class") == "hero" and drake.get("classFrom") == "asset_class property", "an asset_class property overrides the family class")
    expect(has(rep, "triangles", "drake: LOD0 has 18,240 triangles, under the hero budget"), "the overridden class sets the budget")

    rep = core.validate_path(RULES, library)
    fails = messages(rep, "materials")
    expect(rep.family == "library", "_library.blend is read as the material library")
    expect(any(m.startswith("LIB_Flat: untextured") and "base colour, roughness, normal" in m for m in fails), "library: a material with constant colour, roughness and normal fails")
    expect(len(fails) == 1, f"library: textured, glass (constant) and nav (signal) materials pass, and no AO is asked for ({fails})")
    expect(all(rep[c].status == "PASS" for c in ("naming", "triangles", "lods", "scale")), "library: the other checks pass (grid drawn with a Wireframe modifier)")

    rep = core.validate_path(RULES, hull, family="hulls")
    fails = messages(rep, "naming")
    expect(any("HP_S_* / HP_M_* / HP_L_*" in m for m in fails), "hulls: no HP_S_/HP_M_/HP_L_ empty fails")
    expect(any("material 'Hull' missing" in m for m in fails), "hulls: no Hull material fails")
    expect(any("material 'Dark' missing" in m for m in fails), "hulls: no Dark material fails")
    expect(not any("Gear*" in m for m in fails), "hulls: the GearFront empty satisfies Gear*")


def test_review_cases(shared_library, faulty):
    print("\nreview cases")
    rep = core.validate_path(RULES, shared_library, family="library")
    if rep.status != "PASS":
        core.write_and_print(rep, verbose=True)
    expect(rep.status == "PASS", "a library of procedural, signal and glass materials passes as the library family")

    rep = core.validate_path(RULES, faulty, family="props")
    expect(has(rep, "scale", "grid spacing is 0.952 m"), "scale: a 20 m grid of 21 cells (0.952 m) fails, measured on the mesh under its Wireframe modifier")
    expect(has(rep, "scale", "biped is 1.700 m tall"), "scale: a 1.70 m biped fails")
    expect(has(rep, "scale", "Door_hatch: 1.00 x 2.00 m"), "scale: a 1.0 x 2.0 m door fails the 1.4 x 2.4 m minimum")
    expect(has(rep, "scale", "door_side: 0.80 x 2.00 m"), "scale: door names match without regard to case")
    expect(has(rep, "naming", "stray_LOD0: LOD collection at the top level"), "naming: a top-level <asset>_LOD<n> collection fails")
    expect(not any(a["asset"] == "stray_LOD0" for a in rep.assets), "a top-level LOD collection is not read as an asset")
    expect(has(rep, "lods", "LOD2 (1,520) is not lighter than LOD1 (1,520)"), "lods: a LOD no lighter than the one before fails")
    expect(has(rep, "lods", "LOD3 is 11.0% of LOD0"), "lods: LOD3 at 11% of LOD0 fails the 5% rule")
    expect(has(rep, "materials", "is 2048x2048; class prop textures are at most 1024 px"), "materials: a 2k map on a prop fails")


def test_round2(crate, twin, specks):
    print("\nvariants, ignored collections, map variation")
    rep = core.validate_path(RULES, crate, family="props")
    expect(rep.status == "PASS" and any("_wip" in f["message"] for f in rep["naming"].findings), "a '_' collection inside an asset is ignored (its 50k blob and bad names count for nothing)")

    rep = core.validate_path(RULES, twin, family="hulls")
    fails = messages(rep, "naming")
    marker_fails = [m for m in fails if any(p in m for p in ("Gear*", "HP_S_*", "Canopy*", "CockpitInterior*"))]
    expect(not marker_fails, f"source: markers at asset level count for the base and the husk variant ({marker_fails})")
    vs = rep.model.assets[0].variants
    own = {vid: {o.name for o in v.all_objects()} for vid, v in vs.items()}
    expect("HP_M_husk_only" in own["twin_husk"] and "HP_M_husk_only" not in own["twin"], "source: a marker in the husk's variant collection belongs to the husk only")
    # the same layout through the export's node builder and the .glb reader
    path = TMP / "twin.glb"
    E._write(E._build_nodes(RULES, rep.model), path)
    glb.finalize(path, {})
    rep2 = core.validate_path(RULES, path, family="hulls", source=twin)
    fails2 = [m for m in messages(rep2, "naming") if any(p in m for p in ("Gear*", "HP_S_*", "Canopy*", "CockpitInterior*"))]
    vs2 = rep2.model.assets[0].variants if rep2.model.assets else {}
    own2 = {vid: {R.strip(o.name) for o in v.all_objects()} for vid, v in vs2.items()}
    expect(not fails2 and sorted(own2) == ["twin", "twin_husk"], f"export: the .glb reader credits the shared markers to both variants ({fails2})")
    expect("HP_M_husk_only" in own2.get("twin_husk", set()) and "HP_M_husk_only" not in own2.get("twin", set()), "export: the husk-only marker stays the husk's")

    rep = core.validate_path(RULES, specks, family="props")
    fails = messages(rep, "materials")
    expect(not any("speck_a_mat" in m and "uniform" in m for m in fails), f"a map that varies only under its 10% UV island is not uniform ({fails})")
    expect(any("speck_b_mat" in m and "roughness map" in m and "uniform" in m for m in fails), "a map that is flat under the UV island is uniform, whatever the rest of the image holds")

    im = bpy.data.images.new("unsaved", 512, 512, alpha=False)
    px = np.random.default_rng(3).random(512 * 512 * 4, np.float32)
    im.pixels.foreach_set(px)
    std = M.channel_std(im, None)
    expect(std is not None and std > 0.2, f"an unsaved in-memory 512 px image reads its real variation ({std})")


def test_bake_guards(shared_library):
    print("\nbake guards")
    reset()
    with bpy.data.libraries.load(str(shared_library), link=True) as (src, dst):
        dst.materials = ["LIB_TestPlate"]
    linked = bpy.data.materials["LIB_TestPlate"]
    o = sphere("probe", 16, 8, 0.5)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(linked)
    bake.ensure_cycles(bpy.context.scene)

    def attempt(mat):
        try:
            bake.bake_material(mat, [o], 32, ao=True, log=lambda *_: None)
        except bake.BakeError as e:
            return str(e)
        return None

    err = attempt(linked)
    expect(err is not None and "is linked" in err, f"baking a linked (read-only) material is refused, not skipped ({err})")
    local = linked.copy()
    slot = o.material_slots[0]
    slot.link = "OBJECT"
    slot.material = local
    for d in o.data.uv_layers.active.data:
        d.uv = (d.uv[0] + 5.0, d.uv[1] + 5.0)
    err = attempt(local)
    expect(err is not None and "wrote nothing" in err, f"a bake that writes no texel fails loudly ({err})")


def test_export():
    print("\nexport")
    base = ["--src-root", str(SRC), "--out-dir", str(OUT), "--report-dir", str(REPORTS), "--quiet"]
    code = E.main("props", base + ["--only", "crate"])
    out = OUT / "props" / "crate.glb"
    expect(code == 0 and out.exists(), "export_props writes crate.glb from hand-made LODs")
    rep = core.validate_path(RULES, out, family="props", source=SRC / "props" / "crate.blend")
    if rep.status != "PASS":
        core.write_and_print(rep, verbose=True)
    expect(rep.status == "PASS", "crate.glb passes validation")
    core.load(out)
    names = {R.strip(o.name): o for o in bpy.data.objects}
    expect("crate" in names and names["crate"].parent is None, "crate.glb: root node 'crate'")
    expect(all(f"crate_LOD{n}" in names and names[f"crate_LOD{n}"].parent == names["crate"] for n in range(4)), "crate.glb: crate_LOD0..3 under the root")
    expect("COL_crate" in names and names["COL_crate"].parent == names["crate"], "crate.glb: the collider sits beside the LODs")
    expect("REF_Grid" not in names and "REF_Biped" not in names, "crate.glb: references are not exported")

    code = E.main("props", base + ["--only", "rock", "--bake-res", "128"])
    out = OUT / "props" / "rock.glb"
    expect(code == 0 and out.exists(), "export_props bakes the procedural material and generates LODs for rock.glb")
    if out.exists():
        rep = core.validate_path(RULES, out, family="props", source=SRC / "props" / "rock.blend")
        if rep.status != "PASS":
            core.write_and_print(rep, verbose=True)
        expect(rep.status == "PASS", "rock.glb passes validation")
        tris = rep.assets[0]["variants"][0]["lodTris"] if rep.assets else {}
        expect(len(tris) == 4 and tris["3"] < 0.05 * tris["0"], f"rock.glb: 4 generated LODs, LOD3 under 5% ({tris})")
        expect(rep["materials"].status == "PASS", "rock.glb: baked maps satisfy the PBR set")

    code = E.main("props", base + ["--only", "broken"])
    expect(code == 1 and not (OUT / "props" / "broken.glb").exists(), "export_props refuses broken.blend and writes nothing")

    code = E.main("props", base + ["--only", "pod", "--bake-res", "64"])
    out = OUT / "props" / "pod.glb"
    expect(code == 0 and out.exists(), "export_props bakes a material linked from a library .blend")
    if out.exists():
        rep = core.validate_path(RULES, out, family="props", source=SRC / "props" / "pod.blend")
        if rep.status != "PASS":
            core.write_and_print(rep, verbose=True)
        expect(rep.status == "PASS", "pod.glb passes validation (baked maps, AO from the geometry, generated LODs)")
        names = glb.material_names(out)
        expect(names.count("Hull") == 2, f"pod.glb: each variant carries its own baked copy, exported under engine_name 'Hull' ({names})")
        expect("EngineGlow" in names and not any(n.startswith("LIB_") for n in names), "pod.glb: library names are replaced by engine names")
        expect([sorted(v["id"] for v in a["variants"]) for a in rep.assets] == [["pod", "pod_husk"]], "pod.glb: both variants exported")

    code = E.main("props", base + ["--only", "contact", "--bake-res", "128"])
    out = OUT / "props" / "contact.glb"
    expect(code == 0 and out.exists(), "export_props bakes AO for contact.blend")
    if out.exists():
        core.load(out)
        ground = next(m for m in bpy.data.materials if m.name.startswith("Ground"))
        occ = M.MaterialInfo(ground).channels["occlusion"]
        if occ.image is not None:
            w, h = occ.image.size
            px = np.empty(w * h * 4, np.float32)
            occ.image.pixels.foreach_get(px)
            ao = px.reshape(h, w, 4)[..., occ.index or 0]

            def at(u, v):
                return float(ao[int(v * (h - 1)), int(u * (w - 1))])

            under, ring, corner = at(0.5, 0.5), at(0.66, 0.5), at(0.04, 0.04)
            expect(under < 0.3 and ring < corner - 0.1 and corner > 0.8, f"AO on the plate darkens under and around the block (under {under:.2f}, beside {ring:.2f}, corner {corner:.2f})")
        else:
            expect(False, "contact.glb: the plate has an AO map")

    stale = OUT / "props" / "flat.glb"
    stale.write_bytes(b"stale")
    code = E.main("props", base + ["--only", "flat", "--bake-res", "64"])
    rejected = REPORTS / "props__flat.glb.rejected.glb"
    rep = core.validate_path(RULES, rejected, family="props", source=SRC / "props" / "flat.blend") if rejected.exists() else None
    expect(code == 1 and rejected.exists(), "flat.blend passes as a source but its export fails re-validation: exit 1, the rejected file kept for inspection")
    expect(rep is not None and has(rep, "materials", "FaintBump: normal map flat_FaintBump_normal is uniform"), "flat.glb: the re-validation names the uniform baked normal map")
    expect(not stale.exists(), "the stale flat.glb is removed from the models when its re-export fails")

    empty = TMP / "empty"
    empty.mkdir()
    code = E.main("hulls", ["--src-root", str(empty), "--out-dir", str(OUT)])
    expect(code == 0, "export_hulls on an empty family reports nothing to export and succeeds")


def main():
    print(f"art self-test in {TMP}")
    try:
        crate, broken, rock, creatures, hull, library = build_crate(), build_broken(), build_rock(), build_creatures(), build_hull(), build_library()
        shared = build_shared_library()
        build_pod(shared)
        faulty, _ = build_faulty(), build_flat()
        del rock
        test_validator(crate, broken, creatures, hull, library)
        test_review_cases(shared, faulty)
        build_contact()
        twin, specks = build_twin(), build_specks()
        test_round2(crate, twin, specks)
        test_bake_guards(shared)
        test_export()
    finally:
        if "--keep" not in ARGV:
            shutil.rmtree(TMP, ignore_errors=True)
    failed = [m for ok, m in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)} of {len(RESULTS)} assertions passed")
    for m in failed:
        print(f"  FAILED: {m}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
