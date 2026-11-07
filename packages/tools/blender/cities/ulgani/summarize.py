"""Bind the final CPU evidence to current source/export bytes; never author or export."""

import hashlib
import json
import subprocess
from itertools import pairwise

from pipeline import GROUPS, META, ROOT, inventory


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path):
    return str(path.relative_to(ROOT))


def read(path):
    return json.loads(path.read_text())


def main():
    files, assets, audits = [], [], []
    for group in GROUPS:
        attempt = "r05" if group == "props" else "r04"
        audit_path = META / f"audits/{group}-audit-{attempt}/audit.json"
        audit = read(audit_path)
        assert audit["status"] == "PASS" and not audit["failures"]
        for label in ("source", "export"):
            path = ROOT / audit[label]
            assert digest(path) == audit[label + "SHA256"]
            files.append(
                {
                    "path": relative(path),
                    "sha256": digest(path),
                    "bytes": path.stat().st_size,
                }
            )
            stock = read(audit_path.with_name("stock-" + label + ".json"))
            assert stock["status"] == "PASS"
        specifications = {a["id"]: a for a in read(ROOT / inventory(group))["assets"]}
        for asset in audit["assets"]:
            source = asset["source"]
            assets.append(
                {
                    "id": source["id"],
                    "class": source["class"],
                    "source": audit["source"],
                    "export": audit["export"],
                    "specification": specifications[source["id"]],
                    "sourceLods": source["lods"],
                    "decodedLods": asset["decoded"]["lods"],
                    "attributePreservation": asset["preservation"],
                    "sourceCollision": source["collision"],
                    "decodedCollision": asset["decoded"]["collision"],
                    "sourceWalkRoutes": source["walkRoutes"],
                    "decodedWalkRoutes": asset["decoded"]["walkRoutes"],
                    "markers": source["markers"],
                }
            )
            assert all(
                s["properties"] == e["properties"]
                for s, e in zip(
                    sorted(source["markers"], key=lambda x: x["name"]),
                    sorted(asset["decoded"]["markers"], key=lambda x: x["name"]),
                )
            )
        audits.append(
            {
                "path": relative(audit_path),
                "sha256": digest(audit_path),
                "packedImages": audit["packedImages"],
                "sourceMaterials": audit["sourceMaterials"],
                "materialRoutes": audit["materialRoutes"],
                "textures": audit["textures"],
                "paintedMapPreservation": audit["paintedMapPreservation"],
                "extensionsRequired": audit["extensionsRequired"],
            }
        )
    assert len(assets) == 39
    assert len({a["sourceLods"][0]["geometryHash"] for a in assets}) == 39
    negatives = read(META / "negatives/r01/summary.json")
    assert negatives["status"] == "PASS" and negatives["originalsUnchanged"]
    images = sorted((ROOT / "assets/renders/cities").glob("ulgani*/*.png"))
    assert len(images) == 48
    assert sum(p.stat().st_size for p in images) <= 512 * 1024**2
    previews = []
    receipts = [read(p) for p in sorted((META / "previews").glob("*.json"))]
    receipt_artifacts = {a["path"]: (r, a) for r in receipts for a in r["artifacts"]}
    for p in images:
        row = {"path": relative(p), "sha256": digest(p), "bytes": p.stat().st_size}
        if relative(p) in receipt_artifacts:
            receipt, artifact = receipt_artifacts[relative(p)]
            assert artifact["sha256"] == row["sha256"]
            row["receiptBound"] = True
            row["sourceSHA256"] = receipt.get(
                "sourceSHA256", receipt.get("sourceHashes")
            )
            if p.parent.name == "ulgani-cpu":
                if "source" in receipt:
                    assert digest(ROOT / receipt["source"]) == receipt["sourceSHA256"]
                else:
                    for s, h in receipt["sourceHashes"].items():
                        if digest(ROOT / s) != h:
                            revision = read(META / "revisions/bench-join-r03.json")
                            assert (
                                s == revision["source"]
                                and h == revision["beforeSHA256"]
                            )
                            assert (
                                digest(ROOT / s) == revision["afterSHA256"]
                                and revision["packedImagesUnchanged"]
                            )
                            row["historicalMapSourceException"] = (
                                "Context sheet uses props only for its atlas; bench geometry changed later, packed atlas hashes proved unchanged in bench-join-r03.json."
                            )
        else:
            assert p.parent.name == "ulgani-iteration"
            row["receiptBound"] = False
            row["note"] = (
                "Historical first CPU iteration; image saved before receipt path error. Checkpoint records its hash. Not current-source evidence."
            )
        previews.append(row)
    attempts = []
    for path in sorted((META / "attempts").glob("*/process.json")):
        receipt = read(path)
        assert not receipt["remainingGroup"]
        attempts.append(
            {
                "receipt": relative(path),
                "receiptSHA256": digest(path),
                **{
                    k: receipt.get(k)
                    for k in (
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
                    )
                },
            }
        )
    codecs = []
    calls = []
    for path in sorted((META / "attempts").glob("*/codec.jsonl")):
        records = [json.loads(line) for line in path.read_text().splitlines()]
        calls.extend(records)
        for record in records:
            if "--threads" in record["args"]:
                assert record["args"][record["args"].index("--threads") + 1] == "2"
        codecs.append(
            {"path": relative(path), "sha256": digest(path), "calls": len(records)}
        )
    calls.sort(key=lambda row: row["started"])
    assert all(left["ended"] <= right["started"] for left, right in pairwise(calls))
    base = read(META / "base.json")
    contracts = read(META / "source-contract-measurements-r04.json")
    assert all(
        digest(ROOT / path) == value
        for path, value in contracts["sourceHashes"].items()
    )
    base["tree"] = subprocess.check_output(
        ["git", "rev-parse", base["base"] + "^{tree}"], cwd=ROOT, text=True
    ).strip()
    report = {
        "task": "P1.E10.T07",
        "status": "CPU_VALIDATION_PASS_ART_ACCEPTANCE_OPEN",
        "base": base,
        "files": files,
        "assets": assets,
        "sourceContractMeasurements": contracts,
        "audits": audits,
        "negativeControls": negatives,
        "processAttempts": attempts,
        "codecJournals": codecs,
        "codecConcurrency": {
            "measuredCalls": len(calls),
            "maximum": 1,
            "explicitEncoderThreads": 2,
        },
        "previewInventory": previews,
        "previewCount": len(images),
        "previewBytes": sum(p.stat().st_size for p in images),
        "nativeInventory": "assets/blend/cities/ulgani/native-output-inventory.json",
        "nativeStatus": "NOT_RUN; no grant, browser, native renderer, GPU, DB or services started",
        "stockStatus": "8 source and 8 export validations PASS on current bytes",
        "geometryUniqueness": "39 distinct exact LOD0 geometry hashes; authored independently, no other city geometry imported",
    }
    with (META / "delivery-manifest-r02.json").open("x") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(
        json.dumps(
            {
                "assets": len(assets),
                "sourceExportFiles": len(files),
                "images": len(images),
                "imageBytes": report["previewBytes"],
                "attempts": len(attempts),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
