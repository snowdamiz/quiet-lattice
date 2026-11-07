"""Painted trim sheets derived from linked library masters; no export-time geometry."""

import bpy
import numpy as np

PALETTES = {
    "compact": ["22406A", "F4F4F0", "F28C28"],
    "reaches": ["8E2F23", "3A3D42", "D8B23A"],
    "chorus": ["2B2A5C", "E9DFC7", "E8C66A"],
}


def rgb(hexcode):
    return np.array(
        [int(hexcode[i : i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32
    )


def linear(color):
    return [
        float(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
        for c in color
    ]


def image(name, pixels, color=False):
    im = bpy.data.images.new(name, pixels.shape[1], pixels.shape[0], alpha=False)
    im.colorspace_settings.name = "sRGB" if color else "Non-Color"
    rgba = np.ones((*pixels.shape[:2], 4), dtype=np.float32)
    rgba[:, :, :3] = pixels
    # Blender generated buffers are linear even when stored as an sRGB PNG.
    if color:
        rgba[:, :, :3] = np.where(
            pixels <= 0.04045, pixels / 12.92, ((pixels + 0.055) / 1.055) ** 2.4
        )
    im.pixels.foreach_set(rgba.ravel())
    im.update()
    im.pack()
    return im


def make_palette(root, owner, res, tag):
    with bpy.data.libraries.load(
        str(root / "assets/blend/_library.blend"), link=True
    ) as (src, dst):
        dst.materials = [
            "LIB_PaintedPlate",
            "LIB_PaintedAccent",
            "LIB_TrimMetal",
            "LIB_DarkMetal",
            "LIB_Glass",
        ]
    masters = {m.name: m for m in dst.materials}
    for m in masters.values():
        m.use_fake_user = True
    y, x = np.mgrid[0:res, 0:res].astype(np.float32) / res
    # A quiet directional finish. Broad staining is applied only on separate contact/wear parts.
    brush = 0.5 + 0.27 * np.sin(6.13 * x + 2.71 * y) + 0.18 * np.sin(10.7 * x - 1.3 * y)
    grain = 0.5 + 0.28 * np.sin(8.9 * y + 2.1 * x) + 0.17 * np.sin(3.7 * y - 7.1 * x)
    grooves = np.zeros_like(x)
    for cx, cy, length, slope in [
        (0.12, 0.28, 0.18, 0.13),
        (0.43, 0.73, 0.26, -0.08),
        (0.78, 0.44, 0.13, 0.22),
        (0.62, 0.14, 0.09, -0.18),
    ]:
        line = np.exp(-(((y - cy - slope * (x - cx)) / 0.0025) ** 2))
        grooves += line * np.exp(-(((x - cx) / length) ** 8))
    h = -0.00030 * grooves
    dy, dx = np.gradient(h)
    normal = np.stack(
        [
            0.5 + 0.025 * (brush - 0.5) - dx * res * 0.24,
            0.5 + 0.025 * (grain - 0.5) - dy * res * 0.24,
            np.ones_like(x),
        ],
        axis=-1,
    )
    normal = np.clip(normal, 0, 1)
    normal_im = image(tag + "_BrushedNormal", normal)
    aomap = np.clip(0.97 - 0.12 * grooves - 0.025 * grain, 0, 1)
    rough = np.clip(0.40 + 0.13 * grain + 0.05 * brush + 0.12 * grooves, 0.3, 0.8)
    orm_paint = image(
        tag + "_PaintORM", np.stack([aomap, rough, 0.03 + 0.08 * grooves], axis=-1)
    )
    orm_metal = image(
        tag + "_MetalORM", np.stack([aomap, rough, 0.82 + 0.12 * grooves], axis=-1)
    )
    # Instrument bars are warm faction light. Nothing uses the network's cyan.
    bars = (
        ((abs(y - 0.32) < 0.024) | ((abs(y - 0.59) < 0.018) & (x > 0.24)))
        * (x > 0.10)
        * (x < 0.84)
    )
    emit_rgb = rgb(PALETTES[owner][2])
    emit = image(tag + "_InstrumentEmission", bars[:, :, None] * emit_rgb, color=True)
    specs = {
        "Hull": (PALETTES[owner][0], "LIB_PaintedPlate", False),
        "Accent": (PALETTES[owner][1], "LIB_PaintedAccent", False),
        "Signal": (PALETTES[owner][2], "LIB_PaintedAccent", False),
        "Trim": ("8A8F96", "LIB_TrimMetal", True),
        "Dark": ("2C2F34", "LIB_DarkMetal", True),
        "Wear": ("71685A", "LIB_PaintedPlate", True),
        "Screen": ("151D28", "LIB_DarkMetal", False),
    }
    group = bpy.data.node_groups.get("glTF Material Output")
    if not group:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(
            name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat"
        )
    result = {}
    for role, (col, master, metal) in specs.items():
        m = masters[master].copy()
        m.name = f"LIB_T08_{tag}_{role}"
        m["engine_name"] = f"{tag}_{role}"
        m["library_source"] = master
        m["paint_method"] = (
            "Authored prepainted trim, metric UV; separate contact-wear geometry"
        )
        m.use_fake_user = False
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        finish = 0.77 + 0.15 * brush + 0.08 * grain - 0.13 * grooves
        base = np.clip(finish[:, :, None] * rgb(col), 0, 1)
        if role in ("Dark", "Screen") or (owner == "reaches" and role == "Accent"):
            base += (0.085 * brush + 0.055 * grain + 0.12 * grooves)[:, :, None]
            base = np.clip(base, 0, 1)
        if role == "Wear":
            base = np.clip(
                base * (1 - 0.25 * np.exp(-(((y - 0.55) / 0.13) ** 2)))[:, :, None],
                0,
                1,
            )
        base_im = image(f"{tag}_{role}_Base", base, color=True)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = base_im
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = orm_metal if metal else orm_paint
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        ao = nt.nodes.new("ShaderNodeGroup")
        ao.node_tree = group
        nt.links.new(sep.outputs["Red"], ao.inputs["Occlusion"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal_im
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = emit
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.6 if role == "Screen" else 0
        m.diffuse_color = (*linear(rgb(col)), 1)
        result[role] = m
    glass = masters["LIB_Glass"].copy()
    glass.name = f"LIB_T08_{tag}_Glass"
    glass["engine_name"] = f"{tag}_Glass"
    result["Glass"] = glass
    lamp = bpy.data.materials.new("Lamp_" + tag)
    lamp.use_nodes = True
    bsdf = lamp.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*linear(rgb(PALETTES[owner][2])), 1)
    bsdf.inputs["Emission Color"].default_value = (*linear(rgb(PALETTES[owner][2])), 1)
    bsdf.inputs["Emission Strength"].default_value = 3
    lamp.diffuse_color = (*linear(rgb(PALETTES[owner][2])), 1)
    result["Lamp"] = lamp
    return result
