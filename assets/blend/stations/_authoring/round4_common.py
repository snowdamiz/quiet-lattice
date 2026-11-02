"""Saved-source fingerprints for the fourth station submission; no generation/export hooks."""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def plain(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "items"):
        return {k: plain(v) for k, v in value.items()}
    return [plain(v) for v in value]


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def mesh_state(obj):
    mesh = obj.data
    return {"vertices": [list(v.co) for v in mesh.vertices],
            "polygons": [[list(p.vertices), p.material_index, p.use_smooth] for p in mesh.polygons],
            "uv": [[list(v.uv) for v in layer.data] for layer in mesh.uv_layers],
            "materials": [m.name if m else None for m in mesh.materials]}


def snapshot():
    objects = {}
    for obj in bpy.data.objects:
        state = {"type": obj.type, "matrix": [list(r) for r in obj.matrix_world],
                 "properties": plain(dict(obj.items())), "collections": sorted(c.name for c in obj.users_collection)}
        if obj.type == "MESH":
            state["mesh_sha256"] = fingerprint(mesh_state(obj))
            state["triangles"] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if obj.type == "LIGHT":
            state["light"] = {"type": obj.data.type, "energy": obj.data.energy, "color": list(obj.data.color)}
        objects[obj.name] = state
    materials = {}
    for mat in bpy.data.materials:
        nodes = []
        for node in mat.node_tree.nodes if mat.use_nodes else []:
            ins = {}
            for socket in node.inputs:
                if not socket.is_linked and hasattr(socket, "default_value"):
                    try:
                        ins[socket.identifier] = plain(socket.default_value)
                    except TypeError:
                        pass
            state = {"name": node.name, "type": node.type, "inputs": ins}
            if node.type == "TEX_IMAGE" and node.image:
                img = node.image
                state["image"] = {"name": img.name, "size": list(img.size), "space": img.colorspace_settings.name,
                                  "packed_sha256": hashlib.sha256(img.packed_file.data).hexdigest() if img.packed_file else None}
            nodes.append(state)
        links = [[l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier] for l in mat.node_tree.links] if mat.use_nodes else []
        materials[mat.name] = fingerprint({"properties": plain(dict(mat.items())), "nodes": nodes, "links": links})
    return {"objects": objects, "materials": materials,
            "collections": {c.name: plain(dict(c.items())) for c in bpy.data.collections}}


def compare(before, after, changed_objects=(), changed_materials=()):
    permitted = set(changed_objects)
    changed = sorted(k for k in set(before["objects"]) | set(after["objects"])
                     if before["objects"].get(k) != after["objects"].get(k))
    unexpected = set(changed) - permitted
    assert not unexpected, f"Unrelated objects changed: {sorted(unexpected)}"
    material_changes = sorted(k for k in set(before["materials"]) | set(after["materials"])
                              if before["materials"].get(k) != after["materials"].get(k))
    assert not set(material_changes) - set(changed_materials), material_changes
    assert before["collections"] == after["collections"], "Collection metadata changed"
    return {"changed_objects": changed, "changed_materials": material_changes,
            "unaffected_objects_exact": len(set(before["objects"]) - set(changed)),
            "all_other_materials_exact": True, "collection_properties_exact": True}


def save_report(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n")
