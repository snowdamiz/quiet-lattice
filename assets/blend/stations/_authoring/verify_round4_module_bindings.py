"""Compare actual compressed exports per module, independently of global buffer/index layout.

Exact byte-bound geometry, materials, image payloads, transforms and markers permit unchanged-module
evidence reuse. Whole-file or changed-module images are never rebound by this tool.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read(path, details=False):
    raw = path.read_bytes()
    length, kind = struct.unpack_from("<II", raw, 12)
    assert kind == 0x4E4F534A
    doc = json.loads(raw[20:20 + length])
    at = 20 + length
    binary_length, kind = struct.unpack_from("<II", raw, at)
    assert kind == 0x004E4942
    binary = raw[at + 8:at + 8 + binary_length]
    accessor_hashes = json.loads(subprocess.check_output(["node", str(Path(__file__).with_name("decode_round4_accessors.mjs")), str(path)], text=True))

    def view(index):
        v = dict(doc["bufferViews"][index])
        compressed = v.get("extensions", {}).get("EXT_meshopt_compression")
        if compressed:
            c = dict(compressed)
            offset, size = c.pop("byteOffset", 0), c.pop("byteLength")
            c.pop("buffer", None)
            return {"meshopt": c, "payload_sha256": hashlib.sha256(binary[offset:offset + size]).hexdigest()}
        offset, size = v.get("byteOffset", 0), v["byteLength"]
        return {"byteLength": size, "byteStride": v.get("byteStride"),
                "payload_sha256": hashlib.sha256(binary[offset:offset + size]).hexdigest()}

    def accessor(index):
        a = dict(doc["accessors"][index])
        a.pop("bufferView", None)
        a.pop("byteOffset", None)
        a["decoded_payload_sha256"] = accessor_hashes[index]
        return a

    def image(index):
        i = dict(doc["images"][index])
        if "bufferView" in i:
            i["bufferView"] = view(i["bufferView"])
        return i

    def texture(index):
        t = dict(doc["textures"][index])
        if "sampler" in t:
            t["sampler"] = doc["samplers"][t["sampler"]]
        if "source" in t:
            t["source"] = image(t["source"])
        if "KHR_texture_basisu" in t.get("extensions", {}):
            t["extensions"] = {**t["extensions"], "KHR_texture_basisu": {"source": image(t["extensions"]["KHR_texture_basisu"]["source"])}}
        return t

    def material(index):
        def normalize(value, key=""):
            if isinstance(value, dict):
                return {k: texture(v) if k == "index" and key.endswith("Texture") else normalize(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [normalize(v) for v in value]
            return value
        return normalize(doc["materials"][index])

    def node(index):
        n = dict(doc["nodes"][index])
        if "children" in n:
            n["children"] = [node(i) for i in n["children"]]
        if "mesh" in n:
            mesh = dict(doc["meshes"][n["mesh"]])
            primitives = []
            for original in mesh["primitives"]:
                p = dict(original)
                p["attributes"] = {key: accessor(value) for key, value in p["attributes"].items()}
                if "indices" in p:
                    p["indices"] = accessor(p["indices"])
                if "material" in p:
                    p["material"] = material(p["material"])
                primitives.append(p)
            mesh["primitives"] = primitives
            n["mesh"] = mesh
        return n

    modules = {}
    for i, n in enumerate(doc["nodes"]):
        name = n.get("name", "")
        if name.startswith(("ws_", "sy_")) and "_LOD" not in name and "_L" not in name and any(doc["nodes"][j].get("name", "").endswith("_LOD0") for j in n.get("children", [])):
            modules[name] = node(i) if details else fingerprint(node(i))
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(raw).hexdigest(), "modules": modules}


records = []
for kit in ("waystation", "scrapyard"):
    old = read(BASE / "preserved_round3/packages/client/public/models/stations" / f"{kit}.glb")
    current_root = ROOT / sys.argv[1] if len(sys.argv) > 1 else BASE / "exported"
    new = read(current_root / "stations" / f"{kit}.glb")
    assert old["modules"] and old["modules"].keys() == new["modules"].keys()
    modules = [{"module": name, "previous_fingerprint": value, "current_fingerprint": new["modules"][name],
                "exact_export_module_match": value == new["modules"][name]} for name, value in old["modules"].items()]
    records.append({"kit": kit, "previous_export": old, "current_export": new, "modules": modules})
    print(kit, [(m["module"], m["exact_export_module_match"]) for m in modules])
report_path = ROOT / sys.argv[2] if len(sys.argv) > 2 else BASE / "export_module_bindings.json"
assert not report_path.exists(), "Choose a fresh binding report; preserve prior runs"
report_path.write_text(json.dumps(records, indent=2) + "\n")
