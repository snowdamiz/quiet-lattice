"""Bakes procedural material channels to images (DESIGN 19.1: "scripts export and bake").

glTF carries only images, so any channel driven by a node tree other than image -> [separate colour | normal map] ->
BSDF is baked with Cycles into an image at the class's texture size, and the material is rewired to it. Objects that
share a procedural material are baked together into one image, so they must not overlap in UV space (a kit atlas).
A material with the custom property bake_ao gets an ambient-occlusion map baked from the geometry.
"""
import bpy

from . import materials as M

COLOUR = {"baseColor", "emissive"}


def ensure_cycles(scene, samples=16):
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"baking needs Cycles, which this Blender does not offer: {e}")
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    scene.render.bake.use_selected_to_active = False


def _select(objects):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def _socket(info, ch):
    nt = info.mat.node_tree
    if ch == "occlusion":
        grp = next((n for n in nt.nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.split(".")[0] in M.GLTF_GROUPS), None)
        return grp.inputs.get("Occlusion") if grp else None
    return info.bsdf.inputs.get(M.SOCKETS[ch])


def _gltf_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def bake_material(mat, objects, res, log=print):
    """Bakes the procedural channels of `mat` over `objects` (LOD0 meshes using it). Returns the baked channels."""
    info = M.MaterialInfo(mat)
    if info.bsdf is None:
        return []
    todo = info.procedural()
    if info.bake_ao and info.channels["occlusion"].kind == "constant":
        todo.append("occlusion")
    if not todo:
        return []
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    surface = out.inputs["Surface"].links[0].from_socket
    _select(objects)
    # Cycles bakes every material of the selected objects into that material's active image node: give the other
    # materials a throwaway target so their real textures are never overwritten.
    others = {s.material for o in objects for s in o.material_slots if s.material and s.material != mat and s.material.node_tree}
    scratch = bpy.data.images.new("_bake_scratch", 8, 8)
    guards = []
    for m in others:
        g = m.node_tree.nodes.new("ShaderNodeTexImage")
        g.image = scratch
        guards.append((m, g, m.node_tree.nodes.active))
        m.node_tree.nodes.active = g
    try:
        images = _bake_channels(info, nt, out, surface, todo, res)
    finally:
        for m, g, prev in guards:
            m.node_tree.nodes.remove(g)
            if prev is not None:
                m.node_tree.nodes.active = prev
        bpy.data.images.remove(scratch)
    _rewire(info, images)
    log(f"    baked {mat.name}: {', '.join(M.LABELS[c] for c in todo)} at {res} px over {len(objects)} mesh(es)")
    return todo


def _bake_channels(info, nt, out, surface, todo, res):
    mat = info.mat
    images = {}
    for ch in todo:
        img = bpy.data.images.new(f"{mat.name}_{ch}", res, res, alpha=False)
        img.colorspace_settings.name = "sRGB" if ch in COLOUR else "Non-Color"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        sock = _socket(info, ch)
        if ch == "normal":
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True)
        elif ch == "occlusion" and (sock is None or not sock.is_linked):
            bpy.ops.object.bake(type="AO", use_clear=True)
        else:
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Strength"].default_value = 1.0
            nt.links.new(sock.links[0].from_socket, em.inputs["Color"])
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
            try:
                bpy.ops.object.bake(type="EMIT", use_clear=True)
            finally:
                nt.nodes.remove(em)
                nt.links.new(surface, out.inputs["Surface"])
        nt.nodes.remove(tex)
        img.pack()
        images[ch] = img
    return images


def _rewire(info, images):
    nt = info.mat.node_tree
    bsdf = info.bsdf
    for ch, img in images.items():
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        if ch == "normal":
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        elif ch in COLOUR:
            nt.links.new(tex.outputs["Color"], bsdf.inputs[M.SOCKETS[ch]])
        else:
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
            if ch == "occlusion":
                grp = next((n for n in nt.nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.split(".")[0] in M.GLTF_GROUPS), None)
                if grp is None:
                    grp = nt.nodes.new("ShaderNodeGroup")
                    grp.node_tree = _gltf_group()
                nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
            else:
                nt.links.new(sep.outputs["Red"], bsdf.inputs[M.SOCKETS[ch]])
