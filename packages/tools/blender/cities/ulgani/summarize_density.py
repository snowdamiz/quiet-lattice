"""Bind the density correction to exact current saved sources, exports and immutable evidence."""

import hashlib
import json
import re
import struct
import subprocess
from itertools import pairwise
from pathlib import Path

from pipeline import GROUPS, META, ROOT, inventory

D = META / "density-revision"


def read(p):
    return json.loads(p.read_text())


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def relative(p):
    return str(p.relative_to(ROOT))


def file(p):
    return {"path": relative(p), "sha256": digest(p), "bytes": p.stat().st_size}


def export_details(path):
    blob = path.read_bytes()
    json_length, chunk_type = struct.unpack_from("<II", blob, 12)
    assert chunk_type == 0x4E4F534A
    document = json.loads(blob[20 : 20 + json_length])
    binary = memoryview(blob)[28 + json_length :]
    images = []
    for index, image in enumerate(document["images"]):
        view = document["bufferViews"][image["bufferView"]]
        start = view.get("byteOffset", 0)
        data = binary[start : start + view["byteLength"]]
        images.append(
            {
                "index": index,
                "name": image.get("name"),
                "mimeType": image["mimeType"],
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    parent = {
        child: i
        for i, node in enumerate(document["nodes"])
        for child in node.get("children", [])
    }
    primitives = {}
    for i, node in enumerate(document["nodes"]):
        if "mesh" not in node:
            continue
        owner = i
        while owner is not None and not re.search(
            r"_LOD[0-3]$", document["nodes"][owner].get("name", "")
        ):
            owner = parent.get(owner)
        if owner is not None:
            lod = document["nodes"][owner]["name"]
            primitives[lod] = primitives.get(lod, 0) + len(
                document["meshes"][node["mesh"]]["primitives"]
            )
    return {
        "embeddedKTX2Images": images,
        "renderPrimitivesByLOD": primitives,
        "exportedMaterialCount": len(document["materials"]),
    }


def main():
    pins = read(D / "launchers-and-base.json")
    old_paths = set(
        subprocess.check_output(
            ["git", "ls-tree", "-r", "--name-only", pins["base"]["head"]],
            cwd=ROOT,
            text=True,
        ).splitlines()
    )
    density = read(D / "density-all-d10.json")
    materials = read(D / "material-all-d10.json")
    preservation = read(D / "preservation-d10.json")
    assert all(x["status"] == "PASS" for x in [density, materials, preservation])
    assert len(density["rows"]) == 312
    for f in density["files"]:
        assert digest(ROOT / f["path"]) == f["sha256"]
    files = []
    assets = []
    audits = []
    for group in GROUPS:
        path = META / f"audits/{group}-audit-d10/audit.json"
        audit = read(path)
        assert audit["status"] == "PASS" and not audit["failures"]
        for kind in ["source", "export"]:
            f = ROOT / audit[kind]
            assert digest(f) == audit[kind + "SHA256"]
            files.append(file(f))
            assert read(path.with_name("stock-" + kind + ".json"))["status"] == "PASS"
        specs = {x["id"]: x for x in read(ROOT / inventory(group))["assets"]}
        for asset in audit["assets"]:
            name = asset["source"]["id"]
            assert all(
                s["properties"] == e["properties"]
                for s, e in zip(
                    sorted(asset["source"]["markers"], key=lambda x: x["name"]),
                    sorted(asset["decoded"]["markers"], key=lambda x: x["name"]),
                    strict=True,
                )
            )
            assets.append(
                {
                    "id": name,
                    "group": group,
                    "specification": specs[name],
                    **asset,
                    "density": [r for r in density["rows"] if r["asset"] == name],
                }
            )
        audits.append(
            {
                **file(path),
                "packedImages": audit["packedImages"],
                "sourceMaterials": audit["sourceMaterials"],
                "exportMaterials": audit["materialRoutes"],
                "textures": audit["textures"],
                "paintedMapPreservation": audit["paintedMapPreservation"],
                **export_details(ROOT / audit["export"]),
            }
        )
    assert (
        len(assets) == 39
        and len({a["source"]["lods"][0]["geometryHash"] for a in assets}) == 39
    )
    for row in pins["historicalImages"]:
        p = ROOT / row["path"]
        assert digest(p) == row["sha256"] and p.stat().st_size == row["bytes"]
    previews = [
        file(p)
        for p in sorted((ROOT / "assets/renders/cities/ulgani-density").glob("*.png"))
    ]
    assert len(previews) <= 16 and sum(p["bytes"] for p in previews) <= 128 * 1024**2
    allimages = pins["historicalImages"] + previews
    assert len(allimages) <= 64 and sum(x["bytes"] for x in allimages) <= 512 * 1024**2
    preview_receipts = []
    map_hashes = {
        audit["path"].split("/audits/")[1].split("-audit-")[0]: {
            im["name"]: im["packedSHA256"] for im in audit["packedImages"]
        }
        for audit in audits
    }
    for p in sorted(D.glob("preview-*.json")):
        row = read(p)
        if row.get("sources"):
            assert all(digest(ROOT / s["path"]) == s["sha256"] for s in row["sources"])
        artifacts = row.get("artifacts", [row])
        statuses = []
        for artifact in artifacts:
            image = ROOT / artifact.get("output", artifact.get("path"))
            assert digest(image) == artifact.get("outputSHA256", artifact.get("sha256"))
            if row.get("sources"):
                status = "CURRENT_FINAL_COMPOSITE"
            elif artifact.get("maps"):
                group = Path(artifact["source"]).stem.removeprefix("ulgani_")
                assert all(
                    map_hashes[group][m["name"]] == m["packedSHA256"]
                    for m in artifact["maps"]
                )
                status = "CURRENT_MAP_PIXELS; source snapshot may precede material-assignment-only wear correction"
            elif digest(ROOT / artifact["source"]) == artifact["sourceSHA256"]:
                status = "CURRENT_CPU_SNAPSHOT"
            else:
                status = (
                    "HISTORICAL_REVISION_ITERATION; retained, not current-source proof"
                )
            statuses.append(status)
            next(item for item in previews if item["path"] == relative(image))[
                "evidenceStatus"
            ] = status
        preview_receipts.append({**file(p), "evidenceStatuses": statuses})
    attempts = []
    calls = []
    journals = []
    for p in sorted((META / "attempts").glob("*/process.json")):
        if relative(p) in old_paths:
            continue
        row = read(p)
        assert not row["remainingGroup"]
        assert not Path(row["scratchDirectory"]).exists()
        attempts.append(
            {
                **file(p),
                **{
                    k: row.get(k)
                    for k in [
                        "command",
                        "exit",
                        "error",
                        "failureTail",
                        "preflight",
                        "postflight",
                        "peakGroupRSSKiB",
                        "wallSeconds",
                        "remainingGroup",
                        "scratchDirectory",
                        "scratchRemovedBytes",
                        "pinnedLaunchers",
                    ]
                },
            }
        )
        journal = p.with_name("codec.jsonl")
        if journal.exists():
            records = [json.loads(line) for line in journal.read_text().splitlines()]
            calls.extend(records)
            journals.append({**file(journal), "calls": len(records)})
    calls.sort(key=lambda x: x["started"])
    assert all(a["ended"] <= b["started"] for a, b in pairwise(calls))
    assert all(
        r["args"][r["args"].index("--threads") + 1] == "2"
        for r in calls
        if "--threads" in r["args"]
    )
    negative = read(D / "negative-density-d10.json")
    stocknegative = read(META / "negatives/d03/summary.json")
    assert negative["status"] == "PASS" and stocknegative["status"] == "PASS"
    result = {
        "task": "P1.E10.T07",
        "status": "CPU_DENSITY_CORRECTION_PASS_SOURCE_AND_NATIVE_REVIEW_PENDING",
        "base": pins["base"],
        "originalParentBase": "f9d9cbe2e4b629a14063c9a933c331f213826906",
        "files": files,
        "assets": assets,
        "audits": audits,
        "density": density,
        "materialRoutes": materials,
        "preservationAgainstBase": file(D / "preservation-d10.json"),
        "negativeDensityAndRoutes": negative,
        "stockNegativeControls": stocknegative,
        "historicalImagesPreserved": pins["historicalImages"],
        "newPreviews": previews,
        "previewReceipts": preview_receipts,
        "newPreviewCount": len(previews),
        "newPreviewBytes": sum(x["bytes"] for x in previews),
        "combinedPreviewCount": len(allimages),
        "combinedPreviewBytes": sum(x["bytes"] for x in allimages),
        "processAttempts": attempts,
        "codecJournals": journals,
        "codecCalls": len(calls),
        "codecConcurrency": 1,
        "nativeStatus": "NOT_RUN_CPU_ONLY_NO_GRANT",
        "exactFutureNativeInventory": "assets/blend/cities/ulgani/density-revision/native-output-inventory.json",
    }
    with (D / "delivery-manifest-d01.json").open("x") as f:
        json.dump(result, f, indent=2)
    native = read(META / "native-output-inventory.json")
    for asset in native["assets"]:
        asset["sourceSHA256"] = digest(ROOT / asset["source"])
        asset["exportSHA256"] = digest(ROOT / asset["export"])
    native["candidateManifestSHA256"] = digest(D / "delivery-manifest-d01.json")
    native["storageProposal"] = {
        "batchAssets": 4,
        "nativeImagesPerBatch": "44 ordinary; at most 47 with both hero far views and the family sheet",
        "nativeFullInventoryImages": native["outputCounts"]["images"],
        "estimatedNativePNGBytesAt2MiB": native["outputCounts"]["images"] * 2 * 1024**2,
        "currentCPUImages": len(allimages),
        "currentCPUBytes": sum(x["bytes"] for x in allimages),
        "currentRevisionLimitImages": 64,
        "currentRevisionLimitBytes": 512 * 1024**2,
        "requiredParentDecision": "Authorize a separate native storage budget/location before capture. The retained CPU evidence plus a native batch exceeds this revision image limit; no archival, deletion or limit expansion is implied. Prefer compact reviewed batches with content-addressed artifact storage; no raw sequences.",
    }
    native["storageProposalForCorrection"] = {
        "currentCPUImages": len(allimages),
        "currentCPUBytes": sum(x["bytes"] for x in allimages),
        "newRevisionLimitImages": 16,
        "newRevisionLimitBytes": 128 * 1024**2,
        "combinedLimitImages": 64,
        "combinedLimitBytes": 512 * 1024**2,
        "nativeCaptureAuthorized": False,
        "cleanupAuthorized": False,
        "proposal": "Parent must make a separate approved storage decision before native batches; preserve all historical and correction evidence. Existing exact native output names remain the plan, not created files.",
    }
    with (D / "native-output-inventory.json").open("x") as f:
        json.dump(native, f, indent=2)
    print(
        "PASS",
        len(assets),
        "assets",
        len(density["rows"]),
        "density rows",
        len(previews),
        "new images",
    )


if __name__ == "__main__":
    main()
