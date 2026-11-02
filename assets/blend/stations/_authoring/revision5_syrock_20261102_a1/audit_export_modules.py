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

ROOT = Path(__file__).resolve().parents[5]
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
    accessor_hashes = json.loads(subprocess.check_output(["node", str(Path(__file__).parent.parent / "decode_round4_accessors.mjs"), str(path)], text=True))

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



OUT = ROOT / "assets/renders/stations/round5/syrock_20261102_a1"
records = []
for kit in ("waystation", "scrapyard"):
    old = read(BASE / "current/models/stations" / f"{kit}.glb")
    candidate = ROOT / "packages/client/public/models/stations/waystation.glb" if kit == "waystation" else OUT / "exported02/stations/scrapyard.glb"
    new = read(candidate)
    assert old["modules"].keys() == new["modules"].keys()
    changed = [n for n in old["modules"] if old["modules"][n] != new["modules"][n]]
    record = {"kit":kit,"baseline":old,"candidate":new,"changed_modules":changed,
              "unchanged_modules":[n for n in old["modules"] if n not in changed]}
    records.append(record)
report=OUT/"normalized_export_modules02.json"
assert not report.exists()
report.write_text(json.dumps(records,indent=2)+"\n")
assert records[0]["changed_modules"] == []
assert records[0]["baseline"]["sha256"] == records[0]["candidate"]["sha256"]
assert records[1]["changed_modules"] == ["sy_rock"],records[1]["changed_modules"]
assert len(records[0]["unchanged_modules"]) == 9 and len(records[1]["unchanged_modules"]) == 5
print("NORMALIZED MODULE IDENTITY PASS",[(r["kit"],r["changed_modules"],len(r["unchanged_modules"])) for r in records])
