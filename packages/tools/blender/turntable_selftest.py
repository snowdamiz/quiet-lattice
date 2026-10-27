"""Self-test for turntable.py: builds a small .glb in the export layout (art bible 8), renders its sheets headless and
checks that each asset and variant gets its own sheet, that only LOD0 renders (by the manifest and by colour: LOD0 is
red, LOD1 green, LOD2 blue, colliders magenta, each placed where it would show if drawn), that --asset/--variant pick,
that --family lays every asset and variant out in a row of its own (LOD0 only, four views, a header, a list), and that
an image-textured material shows its texture on the shader balls, from the part of the atlas the asset's faces use.

Run: pnpm turntable:test
 or: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/turntable_selftest.py -- [--keep]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
TMP = Path(tempfile.mkdtemp(prefix="turntable-selftest-"))
RESULTS = []


def expect(cond, msg):
    RESULTS.append((bool(cond), msg))
    print(("  ok    " if cond else "  FAIL  ") + msg)


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1)
    em.inputs["Strength"].default_value = 3.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def box(name, mat, loc, size=1.0, parent=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.parent = parent
    bpy.context.scene.collection.objects.link(o)
    return o


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    o.parent = parent
    bpy.context.scene.collection.objects.link(o)
    return o


def build(path):
    """Crate: a lone variant (Crate/Crate_LOD0..2, LOD2 an empty holding its mesh), a collider and a marker beside the
    LODs. Rock: two variants at the origin (Rock/Rock_a/Rock_a_LOD0..1, Rock/Rock_b/Rock_b_LOD0..1). LOD0 sits at the
    origin; every other level, and the collider, sits beside it where the turntable would show it."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    red, green, blue, magenta = (material(n, c) for n, c in (("Red", (1, 0, 0)), ("Green", (0, 1, 0)), ("Blue", (0, 0, 1)), ("Magenta", (1, 0, 1))))
    crate = empty("Crate")
    box("Crate_LOD0", red, (0, 0, 0.5), parent=crate)
    box("Crate_LOD1", green, (1.6, 0, 0.5), parent=crate)
    low = empty("Crate_LOD2", parent=crate)
    box("crate_low", blue, (-1.6, 0, 0.5), parent=low)
    box("COL_crate", magenta, (0, 1.6, 0.5), parent=crate)
    empty("Interact", parent=crate, loc=(0, -1, 0))
    rock = empty("Rock")
    for v, dx in (("Rock_a", 0.0), ("Rock_b", 0.3)):
        vn = empty(v, parent=rock)
        box(f"{v}_LOD0", red, (dx, 0, 0.4), size=0.8, parent=vn)
        box(f"{v}_LOD1", green, (dx + 1.4, 0, 0.4), size=0.8, parent=vn)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True)


def build_textured(path):
    """Panel: one box whose faces all map into the right half of a 64 x 64 atlas, a red and blue checker; the left half,
    where UV (0, 0) lands, is green and no face uses it. The material emits the atlas over a black base, so the sheet
    shows the texels themselves."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    img = bpy.data.images.new("Atlas", 64, 64)
    px = np.zeros((64, 64, 4), dtype=np.float32)
    px[..., 3] = 1
    px[:, :32, 1] = 1
    for y in range(64):
        for x in range(32, 64):
            px[y, x, 0 if ((x - 32) // 8 + y // 8) % 2 else 2] = 1
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = str(TMP / "atlas.png")
    img.file_format = "PNG"
    img.save()
    m = bpy.data.materials.new("Atlas")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    me = bpy.data.meshes.new("Panel_LOD0")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_cube(bm, size=1.0)
    bm.normal_update()
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        a, b = ((1, 2), (0, 2), (0, 1))[ax]
        for loop in f.loops:
            loop[uv].uv = (0.5 + 0.5 * (loop.vert.co[a] + 0.5), loop.vert.co[b] + 0.5)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    o = bpy.data.objects.new("Panel_LOD0", me)
    o.location = (0, 0, 0.5)
    bpy.context.scene.collection.objects.link(o)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True)


def colours(png):
    """Pixel counts of the four test colours in a rendered sheet."""
    im = bpy.data.images.load(str(png))
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    p = px.reshape(-1, 4)
    r, g, b = p[:, 0], p[:, 1], p[:, 2]
    return {
        "red": int(np.sum((r > g + 0.25) & (r > b + 0.25))),
        "green": int(np.sum((g > r + 0.15) & (g > b + 0.15))),
        "blue": int(np.sum((b > r + 0.15) & (b > g + 0.1))),
        "magenta": int(np.sum((r > g + 0.2) & (b > g + 0.2))),
    }


def turntable(glb, out, *extra):
    manifest = out / "manifest.json"
    cmd = [bpy.app.binary_path, "-b", "--factory-startup", "--python-exit-code", "1", "-P", str(HERE / "turntable.py"), "--", str(glb), str(out), "--samples", "4", "--scale", "0.3", "--manifest", str(manifest), *extra]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
    return r.returncode, (json.loads(manifest.read_text()) if manifest.exists() else None)


def main():
    glb = TMP / "kit.glb"
    build(glb)
    expect(glb.exists(), "built an export-layout .glb")

    print("\nevery asset and variant")
    out = TMP / "all"
    code, man = turntable(glb, out)
    expect(code == 0, "turntable.py exits 0")
    expect(man and man["targets"] == [["Crate", "Crate"], ["Rock", "Rock_a"], ["Rock", "Rock_b"]], f"finds Crate, Rock/Rock_a and Rock/Rock_b ({man and man['targets']})")
    sheets = {tuple(s["target"]): s for s in (man or {}).get("sheets", [])}
    want = {("Crate", "Crate"): ("kit_Crate", ["Crate_LOD0"]), ("Rock", "Rock_a"): ("kit_Rock_Rock_a", ["Rock_a_LOD0"]), ("Rock", "Rock_b"): ("kit_Rock_Rock_b", ["Rock_b_LOD0"])}
    for t, (name, objects) in want.items():
        s = sheets.get(t)
        expect(s is not None and s["objects"] == objects, f"{'/'.join(t)} renders only {objects} ({s and s['objects']})")
        expect(s is not None and s["materials"] == ["Red"], f"{'/'.join(t)} material sheet holds only the LOD0 material ({s and s['materials']})")
        tt = out / f"{name}_turntable.png"
        mat = out / f"{name}_materials.png"
        expect(tt.exists() and mat.exists() and (out / f"{name}_materials.txt").exists(), f"{'/'.join(t)} has its own turntable and material sheets ({tt.name})")
        if tt.exists():
            c = colours(tt)
            expect(c["red"] > 500, f"{tt.name}: LOD0 (red) is drawn ({c['red']} px)")
            expect(c["green"] < 30 and c["blue"] < 30, f"{tt.name}: no LOD1 (green) or LOD2 (blue) ({c['green']}, {c['blue']} px)")
            expect(c["magenta"] < 30, f"{tt.name}: no collider (magenta) ({c['magenta']} px)")
    expect(not (out / "kit_turntable.png").exists(), "no sheet overlays the assets")

    print("\n--asset Rock --variant Rock_b")
    out = TMP / "one"
    code, man = turntable(glb, out, "--asset", "Rock", "--variant", "Rock_b")
    expect(code == 0, "turntable.py exits 0")
    made = sorted(p.name for p in out.glob("*.png"))
    expect(made == ["kit_Rock_Rock_b_materials.png", "kit_Rock_Rock_b_turntable.png"], f"only Rock/Rock_b's sheets ({made})")

    print("\n--family")
    out = TMP / "family"
    code, man = turntable(glb, out, "--family")
    expect(code == 0, "turntable.py --family exits 0")
    rows = ((man or {}).get("family") or {}).get("rows", [])
    expect([r["target"] for r in rows] == [["Crate", "Crate"], ["Rock", "Rock_a"], ["Rock", "Rock_b"]], f"one row per asset and variant ({[r['target'] for r in rows]})")
    expect([r["objects"] for r in rows] == [["Crate_LOD0"], ["Rock_a_LOD0"], ["Rock_b_LOD0"]], f"each row shows its LOD0 only ({[r['objects'] for r in rows]})")
    sheet = out / "kit_family.png"
    made = sorted(p.name for p in out.glob("*.png"))
    expect(made == ["kit_family.png"] and (out / "kit_family.txt").exists(), f"one family sheet and its list, nothing else ({made})")
    if sheet.exists():
        im = bpy.data.images.load(str(sheet))
        w, h = im.size
        bpy.data.images.remove(im)
        # (at --scale 0.3: four 144 x 108 cells under a 576 x 16 header per row (48 x 0.3, at least 16))
        expect((w, h) == (576, 3 * (108 + 16)), f"three rows of four views under a header each ({w} x {h})")
        c = colours(sheet)
        expect(c["red"] > 500, f"{sheet.name}: LOD0 (red) is drawn ({c['red']} px)")
        expect(c["green"] < 30 and c["blue"] < 30 and c["magenta"] < 30, f"{sheet.name}: no LOD1, LOD2 or collider ({c['green']}, {c['blue']}, {c['magenta']} px)")
    lines = (out / "kit_family.txt").read_text().splitlines() if (out / "kit_family.txt").exists() else []
    expect(len(lines) == 3 and "Rock / Rock_b" in lines[2], f"the list names each row ({lines})")
    code, man = turntable(glb, TMP / "family2", "--family", "2")
    rows = ((man or {}).get("family") or {}).get("rows", [])
    expect(code == 0 and len(rows) == 2, f"--family 2 samples two of the three ({[r['target'] for r in rows]})")

    print("\nan image-textured material on the shader balls")
    tex = TMP / "tex.glb"
    build_textured(tex)
    out = TMP / "tex"
    code, man = turntable(tex, out)
    expect(code == 0, "turntable.py exits 0 on a textured asset")
    sheet = out / "tex_materials.png"
    if sheet.exists():
        c = colours(sheet)
        # (no UVs on the balls read the atlas at UV (0, 0): all green; UVs over the whole atlas: half green)
        expect(c["red"] > 150 and c["blue"] > 150, f"{sheet.name}: the balls show the atlas's texels, both checker colours ({c['red']}, {c['blue']} px)")
        expect(c["green"] < 0.1 * (c["red"] + c["blue"]), f"{sheet.name}: and only the part the asset's faces use, not the unused green half ({c['green']} px)")
    else:
        expect(False, f"{sheet.name} written")
    txt = (out / "tex_materials.txt").read_text() if (out / "tex_materials.txt").exists() else ""
    expect("64x64 image" in txt and "UV 0.50..1.00" in txt, f"the material list names the image and the part of it shown ({txt.strip()})")

    print("\n--asset Nope")
    code, _ = turntable(glb, TMP / "none", "--asset", "Nope")
    expect(code != 0, "an unknown asset fails")

    failed = [m for ok, m in RESULTS if not ok]
    print(f"\nturntable selftest: {len(RESULTS) - len(failed)} of {len(RESULTS)} checks passed")
    for m in failed:
        print(f"  FAILED: {m}")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        if "--keep" in ARGV:
            print(f"kept {TMP}")
        else:
            shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(code)
