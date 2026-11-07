"""Preserve COLOR_0 before Blender's RGBA packer rounds it to normalized UINT16.

Blender 5.2 extracts POINT/CORNER colours into Float32 primitive arrays, including
loop splits and material partitions, but labels RGBA as UnsignedShort. Its
gather_attribute_change hook runs *after* rounding; gather_attributes_change runs
before COLOR_0 exists. Scope this adapter to one synchronous exact-family export.
No installed files, source colours, indices, or non-mask attributes are changed.
"""
from contextlib import contextmanager

from . import glb, meshopt
from . import rules as R


def required(rules, family):
    return bool(rules["families"][family].get("colorMask")) and meshopt.settings(rules, family).get("quantize") is False


@contextmanager
def preserve(enabled):
    if not enabled:
        yield
        return

    import numpy as np
    from io_scene_gltf2.blender.exp import primitive_attributes

    original = primitive_attributes.gather_primitive_attributes

    def gather(primitive, export_settings):
        attributes = primitive["attributes"]
        mask = attributes.get("COLOR_0")
        if mask is None:
            return original(primitive, export_settings)
        data = mask["data"]
        if (mask["component_type"] not in (5123, 5126) or mask["data_type"] != "VEC4"
                or mask.get("normalized") or data.dtype != np.float32
                or data.ndim != 2 or data.shape[1] != 4):
            raise RuntimeError("exact COLOR_0 requires unpacked Float32 RGBA; refusing an incompatible Blender packing boundary")
        # Only the descriptor changes. The mapped Float32 bytes reach the ordinary
        # float accessor writer without the packer's clip/multiply/round step.
        adapted = dict(primitive, attributes=dict(attributes, COLOR_0=dict(mask, component_type=5126)))
        return original(adapted, export_settings)

    primitive_attributes.gather_primitive_attributes = gather
    try:
        yield
    finally:
        primitive_attributes.gather_primitive_attributes = original


def format_problems(rules, family, path):
    """Export accessor failures, independently of Blender's imported colour type.

All render nodes/primitives count, including every LOD and a mesh also instanced
by a collider. Only nodes named as colliders are outside the mask contract.
Compression opt-outs and legacy names do not waive the exact-mask format.
"""
    if not required(rules, family):
        return []
    js, _ = glb.read(path)
    problems = []
    accessors = js.get("accessors", [])
    colliders = [p for m in rules["markers"] if m["role"] == "collider" for p in m["patterns"]]
    for n, node in enumerate(js.get("nodes", [])):
        if "mesh" not in node or R.match(R.strip(node.get("name", "")), colliders, ci=True):
            continue
        for p, primitive in enumerate(js["meshes"][node["mesh"]].get("primitives", [])):
            label = f"{node.get('name', n)}/primitive{p}"
            index = primitive.get("attributes", {}).get("COLOR_0")
            if type(index) is not int or not 0 <= index < len(accessors):
                problems.append((label, "missing COLOR_0 accessor for exact RGBA mask"))
                continue
            a = accessors[index]
            if a.get("componentType") != 5126 or a.get("type") != "VEC4" or a.get("normalized", False) is not False:
                problems.append((label, "COLOR_0 must be FLOAT (5126), VEC4, non-normalized for exact RGBA mask (A occlusion)"))
    return problems
