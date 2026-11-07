"""Light read-only hash/PNG-header audit. No decode, process launch, or asset writes."""
import hashlib
import json
from pathlib import Path
import struct
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]


def fingerprint(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return {"sha256": h.hexdigest(), "bytes": p.stat().st_size}


def main():
    assert len(sys.argv) == 2
    label = sys.argv[1]
    assert label.replace("-", "").isalnum()
    destination = HERE / "evidence" / (label + ".json")
    assert not destination.exists(), "retain previous audit"
    pins = json.loads((HERE / "pins.json").read_text())
    provenance = json.loads((HERE / "evidence/provenance.json").read_text())
    for k in ("source", "export"):
        e = pins[k]
        assert fingerprint(ROOT / e["path"]) == {k: e[k] for k in ("sha256", "bytes")}
    sealed = ROOT / "assets/renders/hulls/kestrel-round3-current/packet-seal.json"
    assert fingerprint(sealed)["sha256"] == provenance["oldPacketSealSha256"]
    old = json.loads(sealed.read_text())
    for section in ("packetFiles", "toolFiles"):
        for n, e in old[section].items():
            assert fingerprint(ROOT / n) == e, n
    current = {str(p.relative_to(ROOT)) for p in sealed.parent.rglob("*.png")}
    assert current == {e["path"] for e in provenance["images"]}
    decoded = encoded = 0
    for e in provenance["images"]:
        p = ROOT / e["path"]
        assert fingerprint(p) == {k: e[k] for k in ("sha256", "bytes")}
        with p.open("rb") as f:
            header = f.read(24)
        assert header[:8] == b"\x89PNG\r\n\x1a\n"
        w, h = struct.unpack(">II", header[16:24])
        assert w * h * 4 == e["decodedRGBABytes"]
        decoded += w * h * 4
        encoded += e["bytes"]
    for e in provenance["copied"]:
        assert fingerprint(HERE / "evidence/independent" / e["path"]) == {k: e[k] for k in ("sha256", "bytes")}
    assert len(current) == 39 and decoded == 250374400 and encoded == 67408889
    report = {"status": "PASS", "scope": "byte preservation only, not source density or visual quality",
              "source": pins["source"], "export": pins["export"], "oldPacketSealSha256": provenance["oldPacketSealSha256"],
              "oldPacketFilesVerified": len(old["packetFiles"]), "oldToolFilesVerified": len(old["toolFiles"]),
              "retainedImages": len(current), "encodedImageBytes": encoded, "decodedRGBABytesFromHeaders": decoded,
              "selectedIndependentRecordsVerified": len(provenance["copied"])}
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
