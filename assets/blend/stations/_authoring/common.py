"""Scene, scale references and the kit materials (trim sheets packed into the .blend)."""
import math
import os

import bmesh
import bpy

from kit import TEX


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    return sc


def ref_collection(sc, grid_z=0.0, biped_at=(0.0, 0.0)):
    ref = bpy.data.collections.new("REF")
    sc.collection.children.link(ref)
    me = bpy.data.meshes.new("REF_Grid")
    verts, edges = [], []
    for i in range(21):
        a = -10 + i
        verts += [(a, -10, 0), (a, 10, 0), (-10, a, 0), (10, a, 0)]
    # every unit segment its own edge, so the median edge is 1 m
    verts = []
    for i in range(21):
        for j in range(21):
            verts.append((-10 + i, -10 + j, 0))
    idx = lambda i, j: i * 21 + j
    for i in range(21):
        for j in range(21):
            if i < 20:
                edges.append((idx(i, j), idx(i + 1, j)))
            if j < 20:
                edges.append((idx(i, j), idx(i, j + 1)))
    me.from_pydata(verts, edges, [])
    g = bpy.data.objects.new("REF_Grid", me)
    g.location = (biped_at[0], biped_at[1], grid_z)
    ref.objects.link(g)
    b = biped(ref, "REF_Biped")
    b.location = (biped_at[0], biped_at[1], grid_z)
    ref.hide_render = True
    return ref


def biped(coll, name, pose=0.0):
    """A 1.85 m standing biped in a neutral A-pose (feet at the origin)."""
    bm = bmesh.new()

    def part(cx, cy, cz, sx, sy, sz, rx=0.0, seg=8):
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=1, radius2=1, depth=1)
        vs = r["verts"]
        for v in vs:
            v.co.x *= sx
            v.co.y *= sy
            v.co.z *= sz
        if rx:
            for v in vs:
                y, z = v.co.y, v.co.z
                v.co.y = y
                v.co.x, v.co.z = v.co.x * math.cos(rx) - z * math.sin(rx), v.co.x * math.sin(rx) + z * math.cos(rx)
        for v in vs:
            v.co.x += cx
            v.co.y += cy
            v.co.z += cz

    part(-0.11, 0, 0.47, 0.075, 0.08, 0.94)  # legs
    part(0.11, 0, 0.47, 0.075, 0.08, 0.94)
    part(0, 0, 1.23, 0.19, 0.12, 0.58)  # torso
    part(0, 0, 1.56, 0.06, 0.06, 0.1)  # neck
    r = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.115)
    for v in r["verts"]:
        v.co.z *= 1.15
        v.co.z += 1.85 - 0.115 * 1.15
    part(-0.3, 0, 1.12, 0.045, 0.045, 0.62, rx=-0.32)  # arms
    part(0.3, 0, 1.12, 0.045, 0.045, 0.62, rx=0.32)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def _img(name, colour=True):
    path = os.path.join(TEX, name + ".png")
    if not os.path.exists(path):
        return None
    img = bpy.data.images.load(path, check_existing=True)
    img.name = name
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    img.pack()
    img.filepath = "//" + name + ".png"
    return img


def sheet_material(name, emit_strength=6.0, alpha=False):
    """Principled BSDF fed by the sheet's maps: base colour, ORM (R occlusion, G roughness, B metallic), normal and,
    where painted, emissive."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    base = nt.nodes.new("ShaderNodeTexImage")
    base.image = _img(f"{name}_base")
    base.location = (-400, 300)
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(base.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.surface_render_method = "BLENDED"
    orm = nt.nodes.new("ShaderNodeTexImage")
    orm.image = _img(f"{name}_orm", colour=False)
    orm.location = (-400, 0)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-150, 0)
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        grp.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = grp
    g.location = (300, -400)
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    nrm = nt.nodes.new("ShaderNodeTexImage")
    nrm.image = _img(f"{name}_normal", colour=False)
    nrm.location = (-400, -300)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-150, -300)
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    emit = _img(f"{name}_emit")
    if emit is not None:
        e = nt.nodes.new("ShaderNodeTexImage")
        e.image = emit
        e.location = (-400, -600)
        nt.links.new(e.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def flat_material(name, base, rough, metal=0.0, emit=None, strength=1.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def lin(hexs):
    h = hexs.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def compact_materials():
    for n in ("WS_Shell", "WS_Metal", "WS_Deck", "WS_Floor"):
        sheet_material(n)
    sheet_material("WS_Decal", alpha=True)
    # Ixari crystal glazing: dark, glossy, a faint lilac cast; lit from within at night
    flat_material("WS_Glass", lin("#141a26"), 0.06, 0.0, emit=lin("#B9A6FF"), strength=0.12)
    flat_material("WS_LitGlass", lin("#1a1d24"), 0.08, 0.0, emit=lin("#FFF3DE"), strength=0.45)
    flat_material("NavWhite", (0.02, 0.02, 0.02), 0.5, emit=(1, 1, 1), strength=8.0)
    flat_material("NavRed", (0.02, 0.0, 0.0), 0.5, emit=(1, 0.05, 0.03), strength=8.0)
    flat_material("NavGreen", (0.0, 0.02, 0.0), 0.5, emit=(0.05, 1, 0.2), strength=8.0)
