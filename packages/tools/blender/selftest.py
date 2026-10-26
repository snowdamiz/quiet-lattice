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

from artlib import core  # noqa: E402
from artlib import export as E  # noqa: E402
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


def references():
    ref = coll("REF")
    verts = [(x, y, 0) for y in range(11) for x in range(11)]
    edges = [(j * 11 + i, j * 11 + i + 1) for j in range(11) for i in range(10)]
    edges += [(j * 11 + i, (j + 1) * 11 + i) for j in range(10) for i in range(11)]
    put(mesh_from("REF_Grid", [(x - 5, y - 5, z) for x, y, z in verts], edges=edges), ref)
    put(box("REF_Biped", (0.5, 0.3, 1.85), (2.0, 0, 0.925)), ref)
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


def pbr_material(name, base_res=1024, res=256, uniform_roughness=False):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(tex(nt, image(f"{name}_base", base_res, "sRGB", (0.5, 0.4, 0.3), 0.4, 1)).outputs["Color"], bsdf.inputs["Base Color"])
    rough = image(f"{name}_rough", res, "Non-Color", (0.5, 0.5, 0.5), 0.0 if uniform_roughness else 0.5, 2)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex(nt, rough).outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    met = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex(nt, image(f"{name}_metal", res, "Non-Color", (0.5, 0.5, 0.5), 0.9, 3)).outputs["Color"], met.inputs["Color"])
    nt.links.new(met.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(nt, image(f"{name}_normal", res, "Non-Color", (0.5, 0.5, 1.0), 0.2, 4)).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
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


def procedural_material(name):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 8.0
    nt.links.new(noise.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bsdf.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0
    m["bake_ao"] = True
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
    reset()
    references()
    put(with_material(sphere("swatch_hull", 32, 16, 0.5), pbr_material("LibHullPaint", base_res=2048, res=256)), coll("previews"))
    return save(SRC / "_library.blend")


def build_hull():
    reset()
    references()
    a = coll("dart")
    put(with_material(sphere("dart_hull", 200, 160, 4.0), pbr_material("Accent", base_res=1024, res=256)), a)
    g = put(bpy.data.objects.new("GearFront", None), a)
    g.location = (0, 2, 0)
    return save(SRC / "hulls" / "dart.blend")


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
    expect(has(rep, "materials", "uniform (no variation)"), "materials: a uniform roughness map")
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
    if rep.status != "PASS":
        core.write_and_print(rep, verbose=True)
    expect(rep.family == "library" and rep.status == "PASS", "_library.blend is read as the material library and passes")

    rep = core.validate_path(RULES, hull, family="hulls")
    fails = messages(rep, "naming")
    expect(any("Hardpoint_*" in m for m in fails), "hulls: no Hardpoint_ empty fails")
    expect(any("material 'Hull' missing" in m for m in fails), "hulls: no Hull material fails")
    expect(not any("Gear*" in m for m in fails), "hulls: the GearFront empty satisfies Gear*")


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

    empty = TMP / "empty"
    empty.mkdir()
    code = E.main("hulls", ["--src-root", str(empty), "--out-dir", str(OUT)])
    expect(code == 0, "export_hulls on an empty family reports nothing to export and succeeds")


def main():
    print(f"art self-test in {TMP}")
    try:
        crate, broken, rock, creatures, hull, library = build_crate(), build_broken(), build_rock(), build_creatures(), build_hull(), build_library()
        del rock
        test_validator(crate, broken, creatures, hull, library)
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
