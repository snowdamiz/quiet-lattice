"""Small edits to a written .glb: its JSON chunk, and its binary chunk where images change (artlib/ktx.py)."""
import json
import re
import struct

SUFFIX = re.compile(r"\.\d{3,}$")
MAGIC = 0x46546C67  # "glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read(path):
    """(json, bin) of a .glb: the parsed JSON chunk and the bytes of the binary chunk (b"" when there is none)."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    if magic != MAGIC or version != 2:
        raise ValueError(f"{path}: not a glTF 2.0 binary")
    clen, ctype = struct.unpack_from("<II", data, 12)
    if ctype != JSON_CHUNK:
        raise ValueError(f"{path}: the first chunk is not JSON")
    js = json.loads(data[20 : 20 + clen])
    rest = 20 + clen
    if rest + 8 <= len(data):
        blen, btype = struct.unpack_from("<II", data, rest)
        if btype == BIN_CHUNK:
            return js, data[rest + 8 : rest + 8 + blen]
    return js, b""


def write(path, js, bin_data=b""):
    """Writes a .glb from its JSON and binary chunk (both padded to 4 bytes: spaces and zeros)."""
    chunk = json.dumps(js, separators=(",", ":")).encode()
    chunk += b" " * ((4 - len(chunk) % 4) % 4)
    body = struct.pack("<II", len(chunk), JSON_CHUNK) + chunk
    if bin_data:
        b = bytes(bin_data) + b"\0" * ((4 - len(bin_data) % 4) % 4)
        body += struct.pack("<II", len(b), BIN_CHUNK) + b
    with open(path, "wb") as f:
        f.write(struct.pack("<III", MAGIC, 2, 12 + len(body)) + body)


def finalize(path, material_names):
    """Removes Blender's .001 uniqueness suffixes from node and mesh names (every LOD can hold its own 'GearFront',
    every variant its own 'Interact'), and names materials by the explicit map the export computed (engine_name, else
    the material's own name). Materials are never renamed by pattern, so two different materials cannot be merged into
    one name here; the validator already refuses a variant whose materials would collide."""
    js, bin_data = read(path)
    for key in ("nodes", "meshes"):
        for item in js.get(key, []):
            name = item.get("name")
            if name and SUFFIX.search(name):
                item["name"] = SUFFIX.sub("", name)
    for item in js.get("materials", []):
        name = item.get("name")
        if name in material_names:
            item["name"] = material_names[name]
    write(path, js, bin_data)


def material_names(path):
    """Material names in a .glb (tests)."""
    return [m.get("name") for m in read(path)[0].get("materials", [])]
