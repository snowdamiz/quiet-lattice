"""Bind final CPU receipts to current bytes and preserve the reviewed historical packet."""
import hashlib
import json
from pathlib import Path
import subprocess

HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parents[3]
REV = HOME / "revisions/source-advisories-5208f10"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
load = lambda name: json.loads((REV / name).read_text())
rel = lambda p: str(p.relative_to(ROOT))
baseline = load("baseline.json")
allowed = {rel(HOME / "manifest.json"), rel(HOME / "authoring/audit.py"), rel(HOME / "authoring/run_lane.py")}
protected, changed = {}, {}
for name, old in baseline["files"].items():
    current = sha(ROOT / name)
    if current != old["sha256"]:
        assert name in allowed, "Unexpected protected byte change: " + name
        changed[name] = {"before": old["sha256"], "after": current}
    else:
        protected[name] = current
assert set(changed) == allowed
manifest = json.loads((HOME / "manifest.json").read_text())
manifest_sha = sha(HOME / "manifest.json")
source = load("final-source-audit-r2.json")
export = load("final-export-audit.json")
decoded = load("decoded-final.json")
boundary = load("clearance-boundaries.json")
for record in (source, export, decoded, boundary):
    assert record["pass"] and record["manifestSha256"] == manifest_sha
for record in (source, export):
    assert len(record["validatorReports"]) == 7
    for file in record["validatorReports"]:
        assert file["status"] == "PASS" and file["sha256"] == sha(ROOT / file["path"])
for file in decoded["files"]:
    assert file["sha256"] == sha(ROOT / file["path"])
for entry in manifest["assets"]:
    assert entry["sourceSha256"] == sha(ROOT / entry["source"])
    assert entry["glbSha256"] == sha(ROOT / entry["glb"])
for record in load("lane-tests/tests.json"):
    assert record["pass"]
static = []
for file in sorted((HOME / "authoring").glob("*.py")):
    compile(file.read_text(), str(file), "exec")
    static.append({"pythonCompile": rel(file), "exit": 0})
for command in (["node", "--check", rel(HOME / "authoring/decode_exports.mjs")], ["git", "diff", "--check"]):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    static.append({"command": command, "exit": result.returncode})
commands = []
for file in sorted(REV.rglob("*.json")):
    record = json.loads(file.read_text())
    if not isinstance(record, dict) or "command" not in record or "remainingOwnedPids" not in record:
        continue
    assert record["processTreeReapedBeforeUnlock"] and not record["remainingOwnedPids"]
    log = file.with_suffix(".txt")
    commands.append({"receipt": rel(file), "receiptSha256": sha(file), "command": record["command"],
        "childExit": record["exit"], "wrapperExit": 124 if record["limitExceeded"] else record["exit"],
        "deadlineSeconds": record["deadlineSeconds"], "peakProcessTreeRssKiB": record["peakProcessTreeRssKiB"],
        "failureLast20Lines": log.read_text().splitlines()[-20:] if record["exit"] else [],
        "logSha256": sha(log)})
amendment = load("metadata-amendment.json")
capture = HOME / "receipts/final-capture-inventory.json"
capture_data = json.loads(capture.read_text())
assert capture_data["assetCount"] == len(manifest["assets"]) == 38
for entry in capture_data["assets"]:
    assert sha(ROOT / entry["source"]) == entry["sourceSha256"] and sha(ROOT / entry["glb"]) == entry["glbSha256"]
proof = {"pass": True, "manifestSha256": manifest_sha, "allowedChanges": changed, "protectedFiles": protected,
    "protectedCount": len(protected), "stockSourcePasses": 7, "stockExportPasses": 7,
    "sourceAuditChecks": source["checkCount"], "exportAuditChecks": export["checkCount"],
    "clearanceAssertions": sum(len(f["tests"]) for f in boundary["files"]),
    "decodedBoundaryAssertions": sum(sum(isinstance(v, bool) for v in row.values()) for row in decoded["boundaryTests"]),
    "decodedMipLevels": sum(len(m["levels"]) for f in decoded["files"] for m in f["materials"]),
    "static": static, "commands": commands}
with (REV / "final-verification.json").open("x") as f:
    f.write(json.dumps(proof, indent=2) + "\n")
report = {
    "TASK": "P1.E10.T05 — source/evidence advisory correction",
    "STATUS": "BLOCKED",
    "statusReason": "All four CPU advisories resolved. Fresh independent review of this amended pin and whole-kit blind/native/runtime visual gates remain with parent. The historical source PASS does not approve this revision.",
    "SUMMARY": "Preserved all seven blends, seven GLBs and historical packet bytes. Certified the actual Hinge Court clearance, separated measured source/export LOD counts, decoded and enforced bronze roughness floor, and corrected separate preview batch accounting. No new art direction or rendering.",
    "BASE": "634c51d2378748c6a514af2a792ee4500b912643", "revisionBase": baseline["head"], "revisionBaseTree": baseline["tree"],
    "branch": "task/P1-E10-T05-thalune-sarelun", "finalPin": "Reported after commit in /tmp/P1-E10-T05-source-advisories-<HEAD>.json and worker response; a receipt cannot contain its own Git commit hash.",
    "FILES CHANGED": {"existing": sorted(changed), "newAuthoring": sorted(rel(p) for p in (HOME / "authoring").glob("*") if p.is_file() and rel(p) not in baseline["files"]), "newReceipts": rel(REV)},
    "VERIFY": {"result": "PASS for local CPU contracts", "evidence": rel(REV / "final-verification.json"), "evidenceSha256": sha(REV / "final-verification.json"),
        "stockCallsPassed": 14, "sourceAuditRows": source["checkCount"], "exportAuditRows": export["checkCount"],
        "rowMeaning": "Seven actual stock validations per mode plus kit predicates; not thousands of independent stock runs.",
        "clearanceAssertions": proof["clearanceAssertions"], "decodedBoundaryAssertions": proof["decodedBoundaryAssertions"], "laneGuardTests": 4,
        "protectedHashesMatched": len(protected), "assetFilesChanged": 0, "newPreviewImages": 0,
        "commandsAndExits": commands, "static": static,
        "historicalTestsNotRerun": "Original five negative validation mutations and twelve compression Vitest tests remain historical; new tests target these advisories and actual final artifacts."},
    "DECISIONS": [
        "Door declaration versus unchanged geometry → certify 3.189 m, rounded down from source 3.189999461 and compressed export 3.189597845 m; full endpoint probes reject sub-centimetre violations. Both exceed the 2.4 m minimum and 3 m service-door target.",
        "LOD catalog ambiguity → schema 2 sourceLodTriangles and exportLodTriangles. Saved mid_2/tall_2 LOD3 are 2014/2014; decoded export LOD3 are 2009/2004. Other LOD counts agree.",
        "Potential bronze roughness underflow → independently decode all 84 mip levels and the full bronze UV band, including margins. Actual source floor 0.239215702; export floor 0.243137255 for six files, 0.231372549 in the unused anchor bronze lane. No authoring, saved-source or export change warranted. Validator rejects 50/255, accepts 51/255 at factor 1, rejects a below-floor material factor.",
        "Trace lossy-codec metallic values outside bronze → separate diagnostic records roughness 0.168627451 at metallic 2/255; this is outside the bronze band. The complete bronze band is tested independently of the metallic >=0.5 diagnostic threshold.",
        "Preview accounting → r1 seven PNGs 10,774,824 bytes; r2 one PNG 1,417,497 bytes; 12,192,321 retained PNG bytes total. Historical receipts and image bytes unchanged.",
        "Historical evidence → audit reads current manifest and writes exclusive new receipts. Initial revision decoder overrequired bronze usage on the anchor; corrected to validate the unused band without demanding a surface. Initial door audit treated a stair record as an entry and raised KeyError; corrected entry filtering. Both failed runs retained."
    ],
    "OUT OF SCOPE FOUND": {"E10.T01": "Existing renderer/planner scaling, variant selection, actual collision consumers, canals/tides/terrain remain unchanged.",
        "parentGates": ["fresh independent code review", "blind visual grade of full artifact set", "in-engine three-light LOD0/LOD2/wire review", "live walker collision", "GPU appearance and performance", "merged smoke"]},
    "ARTIFACTS": {"manifest": rel(HOME / "manifest.json"), "manifestSha256": manifest_sha,
        "revisionReceipts": rel(REV), "previewBatches": amendment["previewBatches"],
        "plannedNativeInventory": {"path": rel(capture), "sha256": sha(capture), "images": 342, "turntableSheets": 38, "materialSheets": 38, "threeLightingByTwoLodCaptures": 228, "wireframes": 38, "authorization": "NOT AUTHORIZED BY THIS CPU CORRECTION; parent schedules and grants separately"}},
    "resources": {"backend": "CPU only", "blenderProcessesAtOnceInLane": 1, "blenderThreads": 2, "rssLimitKiB": 6291456, "outputLimitBytes": 16777216,
        "peakMeasuredProcessTreeRssKiB": max(c["peakProcessTreeRssKiB"] for c in commands), "allOwnedProcessGroupsReaped": True, "nativeGpuBrowserServerDbRuns": 0},
    "delivery": "Same branch; no push, PR, merge, orchestration edits or shared library/exporter/runtime edits."
}
with (REV / "APPENDIX-C2.json").open("x") as f:
    f.write(json.dumps(report, indent=2) + "\n")
print(json.dumps({"pass": True, "protected": len(protected), "stockPasses": 14, "manifestSha256": manifest_sha}))
