"""Reads a material's node tree into PBR channels: what drives each one (an image, a procedural tree that the export
bakes, a vertex attribute, or a constant) and how much the image actually varies."""
import bpy
import numpy as np

CHANNELS = ("baseColor", "roughness", "metallic", "normal", "occlusion", "emissive")
LABELS = {
    "baseColor": "base colour",
    "roughness": "roughness",
    "metallic": "metallic",
    "normal": "normal",
    "occlusion": "AO",
    "emissive": "emissive",
}
SOCKETS = {
    "baseColor": "Base Color",
    "roughness": "Roughness",
    "metallic": "Metallic",
    "normal": "Normal",
    "emissive": "Emission Color",
}
GLTF_GROUPS = ("glTF Material Output", "glTF Settings")
# nodes that route an image to a socket without changing it; anything else between an image and the BSDF needs a bake
PASS = {"REROUTE", "SEPARATE_COLOR", "SEPRGB", "SEPARATE_RGB", "NORMAL_MAP"}
COORDS = {"MAPPING", "TEX_COORD", "UVMAP", "REROUTE"}
ATTRS = {"VERTEX_COLOR", "ATTRIBUTE", "COLOR_ATTRIBUTE"}
CHANNEL_INDEX = {"Red": 0, "R": 0, "Green": 1, "G": 1, "Blue": 2, "B": 2, "Alpha": 3}
UNIFORM_STD = 1.0 / 255.0


class Channel:
    def __init__(self, kind, image=None, index=None, value=None):
        self.kind = kind  # image | procedural | attribute | constant
        self.image = image
        self.index = index  # 0..3 for a single image channel, None for RGB
        self.value = value

    def textured(self):
        return self.kind in ("image", "procedural")


def _upstream(socket):
    """All nodes upstream of an input socket."""
    seen, stack, out = set(), [l.from_node for l in socket.links], []
    while stack:
        n = stack.pop()
        if n.name in seen:
            continue
        seen.add(n.name)
        out.append(n)
        for i in n.inputs:
            stack.extend(l.from_node for l in i.links)
    return out


def _const(socket):
    v = getattr(socket, "default_value", None)
    try:
        return tuple(round(float(x), 4) for x in v)
    except TypeError:
        return None if v is None else round(float(v), 4)


def _factor(node):
    """(linked input, constant factor) for a multiply-by-constant node, else None."""
    if node.type == "MATH" and node.operation == "MULTIPLY":
        ins = [i for i in node.inputs[:2]]
    elif node.type in ("MIX", "MIX_RGB") and getattr(node, "blend_type", "") == "MULTIPLY":
        fac = node.inputs[0]
        if fac.is_linked or abs(float(fac.default_value) - 1.0) > 1e-6:
            return None
        ins = [i for i in node.inputs[1:] if i.enabled and i.type == "RGBA"][:2]
    else:
        return None
    linked = [i for i in ins if i.is_linked]
    if len(linked) != 1 or len(ins) != 2:
        return None
    other = ins[1] if linked[0] is ins[0] else ins[0]
    v = _const(other)
    k = min(v[:3]) if isinstance(v, tuple) else v
    return linked[0], (0.0 if k is not None and abs(k) < 1e-6 else k)


def trace(socket):
    if socket is None:
        return Channel("constant", value=None)
    if not socket.is_linked:
        return Channel("constant", value=_const(socket))
    # direct routes: image -> [separate colour | normal map | reroute] -> socket
    link = socket.links[0]
    node, out, index = link.from_node, link.from_socket, None
    for _ in range(6):
        if node.type == "TEX_IMAGE":
            if node.image is None:
                return Channel("constant", value=None)
            if out.name == "Alpha":
                index = 3
            upstream = [n for i in node.inputs for n in _upstream(i)]
            if all(n.type in COORDS for n in upstream):
                return Channel("image", node.image, index)
            break
        if node.type in PASS:
            if node.type in ("SEPARATE_COLOR", "SEPRGB", "SEPARATE_RGB"):
                index = CHANNEL_INDEX.get(out.name, index)
            src = node.inputs.get("Color") or node.inputs[0]
            if not src.is_linked:
                return Channel("constant", value=_const(src))
            link = src.links[0]
            node, out = link.from_node, link.from_socket
            continue
        factor = _factor(node)
        if factor is not None:
            # the glTF importer writes metallicFactor / baseColorFactor as a multiply with a constant
            src, k = factor
            if k == 0.0:
                return Channel("constant", value=0.0)
            link = src.links[0]
            node, out = link.from_node, link.from_socket
            continue
        break
    nodes = _upstream(socket)
    if any(n.type.startswith("TEX_") or n.type in ("AMBIENT_OCCLUSION", "BEVEL") for n in nodes):
        img = next((n.image for n in nodes if n.type == "TEX_IMAGE" and n.image), None)
        return Channel("procedural", img)
    if any(n.type in ATTRS for n in nodes):
        return Channel("attribute")
    return Channel("procedural")  # math on constants: still has to be baked to reach glTF


class MaterialInfo:
    def __init__(self, mat):
        self.mat = mat
        self.bsdf = None
        self.problem = None
        self.channels = {}
        self.emitting = False
        self.bake_ao = bool(mat.get("bake_ao"))
        self._read()

    def _read(self):
        m = self.mat
        if not m.node_tree:
            self.problem = "has no node tree (needs a Principled BSDF)"
            for c in CHANNELS:
                self.channels[c] = Channel("constant")
            return
        nt = m.node_tree
        outs = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"]
        out = next((n for n in outs if n.is_active_output), outs[0] if outs else None)
        surf = out.inputs["Surface"] if out else None
        if surf is None or not surf.is_linked:
            self.problem = "has no surface shader"
        else:
            node = surf.links[0].from_node
            if node.type != "BSDF_PRINCIPLED":
                self.problem = f"surface is a {node.type} node; glTF needs a Principled BSDF"
            else:
                self.bsdf = node
        for c in CHANNELS:
            if c == "occlusion":
                grp = next(
                    (n for n in nt.nodes if n.type == "GROUP" and n.node_tree and n.node_tree.name.split(".")[0] in GLTF_GROUPS),
                    None,
                )
                sock = grp.inputs.get("Occlusion") if grp else None
                self.channels[c] = trace(sock) if sock and sock.is_linked else Channel("constant", value=None)
            elif self.bsdf is None:
                self.channels[c] = Channel("constant")
            else:
                self.channels[c] = trace(self.bsdf.inputs.get(SOCKETS[c]))
        if self.bsdf is not None:
            strength = self.bsdf.inputs.get("Emission Strength")
            col = self.channels["emissive"]
            lit = strength is not None and (strength.is_linked or float(strength.default_value) > 0.0)
            coloured = col.kind != "constant" or (col.value is not None and any(x > 0.0 for x in col.value[:3]))
            self.emitting = bool(lit and coloured)

    def images(self):
        out = {}
        for c, ch in self.channels.items():
            if ch.image is not None:
                out.setdefault(ch.image.name, (ch.image, []))[1].append(c)
        return list(out.values())

    def procedural(self):
        return [c for c, ch in self.channels.items() if ch.kind == "procedural" and (c != "emissive" or self.emitting)]


_std = {}


def clear_cache():
    _std.clear()


def channel_std(image, index):
    """Largest per-channel standard deviation of an image (index: one channel, None: RGB), on a 256 px copy."""
    key = (image.name, index)
    if key in _std:
        return _std[key]
    w, h = image.size
    if w == 0 or h == 0:
        _std[key] = None
        return None
    src, tmp = image, None
    if max(w, h) > 256:
        tmp = image.copy()
        tmp.scale(min(w, 256), min(h, 256))
        src = tmp
    try:
        ch = max(int(src.channels), 1)
        px = np.empty(len(src.pixels), np.float32)
        src.pixels.foreach_get(px)
    finally:
        if tmp is not None:
            bpy.data.images.remove(tmp)
    px = px.reshape(-1, ch)
    if index is not None and index < px.shape[1]:
        v = float(px[:, index].std())
    else:
        v = float(px[:, : min(3, px.shape[1])].std(0).max())
    _std[key] = v
    return v


def image_missing(image):
    """True when an image has no pixels to export (an external file that is not there)."""
    if image.packed_file is not None or image.source == "GENERATED":
        return False
    try:
        return image.size[0] == 0
    except Exception:
        return True
