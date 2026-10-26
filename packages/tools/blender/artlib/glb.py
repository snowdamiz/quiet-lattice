"""Small edits to a written .glb's JSON chunk."""
import json
import re
import struct

SUFFIX = re.compile(r"\.\d{3,}$")


def finalize(path, material_names):
    """Removes Blender's .001 uniqueness suffixes from node and mesh names (every LOD can hold its own 'GearFront',
    every variant its own 'Interact'), and names materials by the explicit map the export computed (engine_name, else
    the material's own name). Materials are never renamed by pattern, so two different materials cannot be merged into
    one name here; the validator already refuses a variant whose materials would collide."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20 : 20 + clen])
    rest = data[20 + clen :]
    for key in ("nodes", "meshes"):
        for item in js.get(key, []):
            name = item.get("name")
            if name and SUFFIX.search(name):
                item["name"] = SUFFIX.sub("", name)
    for item in js.get("materials", []):
        name = item.get("name")
        if name in material_names:
            item["name"] = material_names[name]
    chunk = json.dumps(js, separators=(",", ":")).encode()
    chunk += b" " * ((4 - len(chunk) % 4) % 4)
    out = struct.pack("<III", magic, version, 12 + 8 + len(chunk) + len(rest)) + struct.pack("<II", len(chunk), ctype) + chunk + rest
    with open(path, "wb") as f:
        f.write(out)


def material_names(path):
    """Material names in a .glb (tests)."""
    with open(path, "rb") as f:
        data = f.read()
    clen, _ = struct.unpack_from("<II", data, 12)
    return [m.get("name") for m in json.loads(data[20 : 20 + clen]).get("materials", [])]
