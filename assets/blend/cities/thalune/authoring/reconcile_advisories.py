"""One-time, hash-guarded metadata amendment of the reviewed 5208f10 manifest."""
import hashlib
import json
import math
from pathlib import Path

HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parents[3]
REV = HOME / "revisions/source-advisories-5208f10"
MANIFEST = HOME / "manifest.json"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
old_sha = sha(MANIFEST)
assert old_sha == "9ef5d4a980b6ba8e7837a9bbe67207ea9e11b486b00ac779910a1159f9cf2a3d", "Only amend the pinned historical manifest"
probe = json.loads((REV / "source-probe-red.json").read_text())
decoded = json.loads((REV / "decoded-boundary-red.json").read_text())
assert probe["manifestSha256"] == decoded["manifestSha256"] == old_sha
assert len(probe["files"]) == 14 and len(decoded["files"]) == 7
for row in probe["files"] + decoded["files"]:
    assert sha(ROOT / row["path"]) == row["sha256"], row["path"]
for row in decoded["files"]:
    for material in row["materials"]:
        assert all(level["bronzeLaneMinimum"] >= .2 for level in material["levels"])
manifest = json.loads(MANIFEST.read_text())
manifest["schema"] = 2
for asset in manifest["assets"]:
    source = next(f for f in probe["files"] if f["path"] == asset["source"])
    export = next(f for f in decoded["files"] if f["path"] == asset["glb"])
    imported = next(f for f in probe["files"] if f["path"] == asset["glb"])
    asset["sourceLodTriangles"] = source["assets"][asset["id"]]["lodTriangles"]
    asset["exportLodTriangles"] = export["assets"][asset["id"]]["lodTriangles"]
    assert asset["exportLodTriangles"] == imported["assets"][asset["id"]]["lodTriangles"]
    del asset["lodTriangles"]
    if asset["id"] == "thalune_low_0":
        source_height = source["assets"][asset["id"]]["routes"][0]["minimumSampledCeiling"]
        export_height = imported["assets"][asset["id"]]["routes"][0]["minimumSampledCeiling"]
        certified = math.floor(min(source_height, export_height) * 1000) / 1000
        assert certified >= 2.4
        for item in asset["walkRoutes"] + asset["clearances"]:
            assert item["height"] == 3.2
            item["height"] = certified
        asset["clearanceCertification"] = {"height": certified, "sourceMinimumSampledHeight": source_height,
            "exportMinimumSampledHeight": export_height, "sourceSha256": source["sha256"], "glbSha256": export["sha256"],
            "method": "25 route stations, full declared width, three vertical probes per station; floor-relative minimum rounded down to a whole millimetre. Full certified-height rays with no endpoint shortening. Finite CPU probes, not live collision or a continuous-volume proof."}
manifest["lodCountContract"] = {"sourceLodTriangles": "Measured evaluated saved Blender render meshes, excluding COL; ordered LOD0..3.",
    "exportLodTriangles": "Decoded final GLB indexed triangles, excluding COL; ordered LOD0..3. E10.T01 uses these export counts. Compression may remove triangles; source counts need not equal export counts."}
manifest["reviewGates"]["historicalCodeReview"] = {"head": "5208f10ce367d3fb179fe19458ab263423ef5432", "verdict": "PASS", "scope": "Historical source/CPU contracts only; does not approve amended head or visuals."}
previews = {}
for batch in ("r1", "r2"):
    files = sorted((ROOT / f"assets/renders/cities/thalune/P1-E10-T05-cpu-{batch}").glob("*.png"))
    previews[batch] = {"pngCount": len(files), "bytes": sum(p.stat().st_size for p in files),
        "files": [{"path": str(p.relative_to(ROOT)), "bytes": p.stat().st_size, "sha256": sha(p)} for p in files]}
assert previews["r1"]["bytes"] == 10774824 and previews["r2"]["bytes"] == 1417497
assert not (REV / "metadata-amendment.json").exists()
MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
receipt = {"oldManifestSha256": old_sha, "newManifestSha256": sha(MANIFEST), "sourceOrExportChanged": False,
    "certifiedDoorHeight": certified, "previewBatches": previews, "retainedPngBytes": previews["r1"]["bytes"] + previews["r2"]["bytes"],
    "historicalReceiptPolicy": "All old receipts and preview files retained byte-for-byte. Batch totals here supersede ambiguous historical canonicalPreviewBytes; old receipts are not rewritten.",
    "roughnessDecision": "All seven source bronze lanes and all decoded export bronze UV bands/mips exceed 0.2. Preserve studio.py, saved sources and exports; enforce actual texels with decode_exports.mjs."}
(REV / "metadata-amendment.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"manifestSha256": sha(MANIFEST), "certifiedHeight": certified, "r1Bytes": previews["r1"]["bytes"], "r2Bytes": previews["r2"]["bytes"]}))
