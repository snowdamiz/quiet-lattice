"""Freeze CPU artifact hashes, verify preserved packets and record a direct owned-process drain."""
import datetime
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"


def item(path):
    data = path.read_bytes()
    result = {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    if path.suffix == ".png":
        assert data[:8] == b"\x89PNG\r\n\x1a\n"
        result["pixels"] = list(struct.unpack_from(">II", data, 16))
    return result


integrity = []
for kit in ("waystation", "scrapyard"):
    inventory = json.loads((ROOT / f"assets/renders/stations/review_round3/{kit}/inventory.json").read_text())
    for row in inventory["files"]:
        assert item(ROOT / row["path"])["sha256"] == row["sha256"] and (ROOT / row["path"]).stat().st_size == row["bytes"]
    integrity.append({"kit": kit, "bindings_exact": len(inventory["files"])})
for r in json.loads((BASE / "preservation_bindings.json").read_text()):
    for key in ("preserved_path", "immutable_prior_packet", "protected_T13_path"):
        if key in r:
            assert item(ROOT / r[key])["sha256"] == r["sha256"]
for r in json.loads((BASE / "canonical_promotion.json").read_text()):
    assert item(ROOT / r["canonical_path"])["sha256"] == r["sha256"]
for r in json.loads((BASE / "shared_input_bindings.json").read_text()):
    assert item(ROOT / r["path"])["sha256"] == r["sha256"]
jobs = [json.loads(p.read_text()) for p in sorted((BASE / "jobs").glob("*.json"))]
assert all(j["exit"] == 0 and not j["remaining_owned"] and j["state"] == "drained" for j in jobs)
groups = {g for j in jobs for g in j["process_groups"]}
assert 3340 not in groups
remaining = []
for line in subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,comm="], text=True).splitlines():
    parts = line.strip().split(None, 3)
    if len(parts) == 4 and int(parts[2]) in groups:
        remaining.append({"pid": int(parts[0]), "ppid": int(parts[1]), "pgid": int(parts[2]), "comm": parts[3]})
assert not remaining, remaining
artifacts = [item(p) for directory in (BASE / "current", BASE / "references") for p in sorted(directory.rglob("*")) if p.is_file()]
for p in sorted((BASE / "current").rglob("*")):
    if p.is_file():
        p.chmod(0o444)
result = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "task": "P1.E11.T01", "submission_round": 4,
          "CPU_state": "validated exported inspected and frozen", "GPU_GATE": "CLOSED", "gpu_or_browser_jobs_launched": 0,
          "bakes_performed": 0, "completed_bounded_CPU_jobs": len(jobs), "owned_process_groups": sorted(groups),
          "remaining_owned_group_processes": remaining, "third_packet_integrity": integrity,
          "current_artifacts": artifacts, "source_and_export_canonical_bindings": json.loads((BASE / "canonical_promotion.json").read_text()),
          "future_GPU_plan": item(BASE / "capture_readiness.json"), "module_reuse_proof": item(BASE / "export_module_bindings_final.json"),
          "qualification": "No visual grade, qualified FPS, runtime traversal, door playback or continuous LOD verification claimed"}
(BASE / "cpu_readiness_inventory.json").write_text(json.dumps(result, indent=2) + "\n")
print("CPU READINESS FROZEN", len(artifacts), "artifacts;", len(jobs), "bounded jobs and", len(groups), "groups drained; GPU held")
