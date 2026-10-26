"""Small edits to a written .glb's JSON chunk."""
import json
import re
import struct

SUFFIX = re.compile(r"\.\d{3,}$")


def strip_suffixes(path):
    """Removes Blender's .001 uniqueness suffixes from node, mesh and material names, so the engine sees the names the
    artist wrote (every LOD can hold its own 'GearFront', every variant its own 'Interact')."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20 : 20 + clen])
    rest = data[20 + clen :]
    changed = 0
    for key in ("nodes", "meshes", "materials"):
        for item in js.get(key, []):
            name = item.get("name")
            if name and SUFFIX.search(name):
                item["name"] = SUFFIX.sub("", name)
                changed += 1
    if not changed:
        return 0
    chunk = json.dumps(js, separators=(",", ":")).encode()
    chunk += b" " * ((4 - len(chunk) % 4) % 4)
    out = struct.pack("<III", magic, version, 12 + 8 + len(chunk) + len(rest)) + struct.pack("<II", len(chunk), ctype) + chunk + rest
    with open(path, "wb") as f:
        f.write(out)
    return changed
