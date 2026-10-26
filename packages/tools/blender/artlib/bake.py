"""Bakes material channels to images (DESIGN 19.1: "scripts export and bake").

glTF carries only images, so any channel driven by a node tree other than image -> [separate colour | normal map] ->
BSDF is baked with Cycles into an image at the class's texture size, and the material is rewired to it. Ambient
occlusion is baked from the variant's own geometry for every material whose profile needs AO and has no AO map.
The export bakes a local copy of each material per variant (library materials are linked and read-only, and each
variant has its own UV layout), so objects of one variant that share a material must not overlap in UV space.
Every bake is checked: a target the bake did not write is an error, never a silent empty map.
"""
import bpy
import numpy as np

from . import materials as M

COLOUR = {"baseColor", "emissive"}
SENTINEL = (1.0, 0.0, 1.0, 1.0)  # texels the bake never writes stay this magenta


class BakeError(RuntimeError):
    pass


def ensure_cycles(scene, samples=16):
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise BakeError(f"baking needs Cycles, which this Blender does not offer: {e}")
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    scene.render.bake.use_selected_to_active = False


def _gltf_group_node(nt):
    return next((n for n in nt.nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.split(".")[0] in M.GLTF_GROUPS), None)


def _socket(info, ch):
    if ch == "occlusion":
        grp = _gltf_group_node(info.mat.node_tree)
        return grp.inputs.get("Occlusion") if grp else None
    return info.bsdf.inputs.get(M.SOCKETS[ch])


def _gltf_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None or ng.library is not None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def channels_to_bake(info, ao):
    todo = info.procedural()
    if ao and "occlusion" not in todo and info.channels["occlusion"].kind == "constant":
        todo.append("occlusion")
    return todo


def bake_material(mat, objects, res, ao=False, label=None, log=print):
    """Bakes `mat`'s procedural channels (and AO when `ao`) over `objects`, the LOD0 meshes of one variant that use it.
    `mat` must be local; images are named <label>_<channel>. Returns the baked channels; raises BakeError when a bake
    did not happen."""
    if mat.library is not None:
        raise BakeError(f"{mat.name} is linked from {mat.library.filepath}; the export bakes a local copy")
    info = M.MaterialInfo(mat)
    if info.bsdf is None:
        return []
    todo = channels_to_bake(info, ao)
    if not todo:
        return []
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    surface = out.inputs["Surface"].links[0].from_socket
    # Cycles bakes every material of the selected objects into that material's active image node: give the other
    # materials a throwaway target so their real textures are never overwritten.
    others = {s.material for o in objects for s in o.material_slots if s.material and s.material != mat and s.material.node_tree}
    linked = [m.name for m in others if m.library is not None]
    if linked:
        raise BakeError(f"{mat.name} shares meshes with linked materials {', '.join(linked)}; the export makes them local first")
    scratch = bpy.data.images.new("_bake_scratch", 8, 8)
    guards = []
    hidden = _isolate(objects)
    for m in others:
        g = m.node_tree.nodes.new("ShaderNodeTexImage")
        g.image = scratch
        guards.append((m, g, m.node_tree.nodes.active))
        m.node_tree.nodes.active = g
    try:
        _select(objects)
        images = _bake_channels(info, nt, out, surface, todo, res, label or mat.name)
    finally:
        for m, g, prev in guards:
            m.node_tree.nodes.remove(g)
            if prev is not None:
                m.node_tree.nodes.active = prev
        bpy.data.images.remove(scratch)
        for o, was in hidden:
            o.hide_render = was
    _rewire(info, images)
    log(f"    baked {mat.name}: {', '.join(M.LABELS[c] for c in todo)} at {res} px over {len(objects)} mesh(es)")
    return todo


def _isolate(objects):
    """Hides every other object from the bake, so AO comes from the variant's own geometry (not REF, not neighbours)."""
    keep = {o.as_pointer() for o in objects}
    changed = []
    for o in bpy.context.scene.objects:
        want = o.as_pointer() not in keep
        if o.hide_render != want:
            changed.append((o, o.hide_render))
            o.hide_render = want
    return changed


def _select(objects):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def _new_target(name, res, colour):
    img = bpy.data.images.new(name, res, res, alpha=False)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    img.generated_color = SENTINEL
    return img


def _finish(img, mat, ch):
    """Fails when the bake wrote nothing; fills the texels it never reached with the mean of those it did."""
    px = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    untouched = np.all(np.abs(px[:, :3] - np.asarray(SENTINEL[:3], np.float32)) < 1e-3, axis=1)
    if untouched.all():
        raise BakeError(f"baking {M.LABELS[ch]} of {mat.name} wrote nothing (no UVs on the target meshes, or the bake target was not selected)")
    if untouched.any():
        px[untouched, :3] = px[~untouched, :3].mean(0)
    px[:, 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.update()
    try:
        img.pack()
    except RuntimeError:
        pass  # the exporter reads the pixels from memory either way


def _bake_channels(info, nt, out, surface, todo, res, label):
    mat = info.mat
    images = {}
    for ch in todo:
        img = _new_target(f"{label}_{ch}", res, ch in COLOUR)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        if nt.nodes.active is None or nt.nodes.active.name != tex.name:
            raise BakeError(f"could not select the bake target in {mat.name} (is the material read-only?)")
        sock = _socket(info, ch)
        try:
            if ch == "normal":
                bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=False)
            elif ch == "occlusion" and (sock is None or not sock.is_linked):
                bpy.ops.object.bake(type="AO", use_clear=False)
            else:
                em = nt.nodes.new("ShaderNodeEmission")
                em.inputs["Strength"].default_value = 1.0
                nt.links.new(sock.links[0].from_socket, em.inputs["Color"])
                nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
                try:
                    bpy.ops.object.bake(type="EMIT", use_clear=False)
                finally:
                    nt.nodes.remove(em)
                    nt.links.new(surface, out.inputs["Surface"])
        finally:
            nt.nodes.remove(tex)
        _finish(img, mat, ch)
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
                grp = _gltf_group_node(nt)
                if grp is None:
                    grp = nt.nodes.new("ShaderNodeGroup")
                    grp.node_tree = _gltf_group()
                nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
            else:
                nt.links.new(sep.outputs["Red"], bsdf.inputs[M.SOCKETS[ch]])
