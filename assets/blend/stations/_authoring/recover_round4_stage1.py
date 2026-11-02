"""CPU-only adoption of existing stage-one images; retains the failed/unknown execution statuses.

Run with the pinned decoder: uv run --no-project --with Pillow==12.0.0 python <this script>
"""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from PIL import Image, __version__ as pillow_version

sys.path.insert(0, str(Path(__file__).resolve().parent))
from round4_capture_children import identity, process_rows

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
RUN = BASE / "engine_runs/attempt01/standard-waystation-ws_fabricator"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def item(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": sha(path), "bytes": path.stat().st_size}


manual = RUN / "manual_failure_release.json"
old_controller = RUN / "controller_source_at_failure.py"
assert sha(manual) == "401851c5c326a7802d205a76ec4604a33b5d572b141c1874ac8625605aaeb392"
assert sha(old_controller) == "8b91ae9081bb73daa178ff6df967e1304515538118367ff110b9eb4f87976a37"
assert sha(BASE / "capture_readiness.json") == "d1dc9907f657cf9a707a2b5ee2cc477fa15831cf3ba378bebb51b05b6ac973fa"
failure = json.loads(manual.read_text())
plan = json.loads((BASE / "capture_readiness.json").read_text())
stage = next(s for s in plan["stages"] if s["id"] == failure["stage"])
launch = json.loads((RUN / "launch.json").read_text())
assert launch["argv"] == stage["argv"] and launch["prepared_output"] == stage["out_path"]
assert launch["head"] == "2de557c9690752f54843e0e849b658d1bf114d58"
bindings = []
for path, expected in plan["input_sha256"].items():
    bound = item(ROOT / path)
    assert bound["sha256"] == expected, path
    bindings.append(bound)
assert pillow_version == "12.0.0"
decoded = []
expected_names = {"noon-lush_lod0.png", "noon-lush_lod2.png", "night-exotic_lod0.png", "night-exotic_lod2.png",
                  "open-space_lod0.png", "open-space_lod2.png", "wireframe_lod0.png", "wireframe_lod2.png",
                  "overlay.png", "far_lod2.png", "sheet.png", "perf.json"}
out = ROOT / stage["out_path"]
assert {p.name for p in out.iterdir()} == expected_names
for recorded in failure["artifacts"]:
    path = ROOT / recorded["path"]
    bound = item(path)
    assert bound["sha256"] == recorded["sha256"] and bound["bytes"] == recorded["bytes"]
    if path.suffix == ".png":
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            expected = (1920, 2876) if path.name == "sheet.png" else (1920, 1080)
            assert image.size == expected
            rgba = image.convert("RGBA")
            bound.update(pixels=list(image.size), decoded_rgba_sha256=hashlib.sha256(rgba.tobytes()).hexdigest(),
                         extrema=rgba.getextrema(), decoder="Pillow 12.0.0 verify and full raster load")
    decoded.append(bound)
report = json.loads((out / "perf.json").read_text())
assert report["errors"] == [] and report["file"] == "stations/waystation" and report["asset"] == "ws_fabricator"
assert report["variant"] == "ws_fabricator" and report["gl"] == "metal" and report["viewport"] == [1920, 1080]
assert len(report["perf"]) == 3
rows = process_rows()
original_ids = set(failure["all_observed_owned_pids_plus_controller"])
groups = set(failure["positive_verified_owned_groups"])
released = datetime.datetime.fromisoformat(failure["GPU_release_utc"])
unrelated_reuse = []
for row in rows:
    if row["pid"] in original_ids or row["pgid"] in groups:
        current = identity(row["pid"])
        assert current is not None
        born = datetime.datetime.fromtimestamp(current["birth"][0] + current["birth"][1] / 1_000_000, datetime.timezone.utc)
        assert born > released, f"Unresolved original resource identity: {row}"
        unrelated_reuse.append({"row": row, "current_identity": current, "born_after_original_release": True})
profiles = {p for sample in failure["direct_release_samples"] for p in sample["remaining_profiles"]}
profiles.update(failure["final_observed_row"]["profiles"])
assert not any(Path(p).exists() for p in profiles)
assert not any(any(p in row["command"] for p in profiles) for row in rows)
port_checks = {}
for address in failure["final_observed_row"]["ports"]:
    result = subprocess.run(["/usr/sbin/lsof", "-nP", f"-iTCP:{address.rsplit(':', 1)[1]}", "-sTCP:LISTEN", "-Fp"], capture_output=True, text=True, timeout=3)
    pids = {int(line[1:]) for line in result.stdout.splitlines() if line.startswith("p")}
    for pid in pids:
        current = identity(pid)
        assert current is not None and current["birth"][0] > released.timestamp()
    port_checks[address] = {"listener_pids": sorted(pids), "owned_listener_absent": True,
                            "reassigned_after_original_release": bool(pids)}
assertions = subprocess.check_output(["/usr/bin/pmset", "-g", "assertions"], text=True, timeout=3)
owned_assertions = []
reused_ids = {r["row"]["pid"] for r in unrelated_reuse}
for line in assertions.splitlines():
    match = re.search(r"\bpid\s+(\d+)\(", line)
    if match and int(match.group(1)) in original_ids - reused_ids:
        owned_assertions.append(line)
assert not owned_assertions
temporary = [str(p.relative_to(ROOT)) for p in (ROOT / "packages/client/public/models/stations").glob("_review_*.glb")
             if any(p.stem == f"_review_{pid}" for pid in original_ids)]
assert not temporary
recovery = {"task": "P1.E11.T01", "stage": stage["id"], "recovery_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "recovery_mode": "CPU_ONLY", "artifact_status": "VALID_RECOVERED_WITH_EXECUTION_LIMITS", "rerendered": False,
            "original_execution": {"controller_status": "FAILED", "controller_exit": 1, "capture_exit": "UNKNOWN", "caffeinate_exit": "UNKNOWN",
                                   "clean_original_capture_claimed": False, "backend_telemetry_limit": "Standard helper has no actual WebGL renderer string; mapped backend observations were not persisted before controller failure"},
            "preserved_manual_failure": item(manual), "preserved_failed_controller": item(old_controller),
            "original_launch": item(RUN / "launch.json"), "argv_matches_frozen_stage": True, "input_bindings": bindings,
            "decoded_artifacts": decoded, "perf_errors": [], "perf_qualification": "Historical raw readout for this source-bound visual run remains unqualified under E14.T13",
            "resource_absence": {"original_GPU_release_utc": failure["GPU_release_utc"], "owned_process_groups_absent": True,
                                 "unrelated_reused_identities": unrelated_reuse, "profiles_absent": sorted(profiles),
                                 "port_checks": port_checks, "owned_idle_assertions": [], "owned_temp_glbs": []},
            "visual_inspection": failure["visual_inspection"], "GPU_authorization": "REVOKED; a separate new grant is required"}
target = BASE / "stage1_artifact_recovery.json"
assert not target.exists()
target.write_text(json.dumps(recovery, indent=2) + "\n")
target.chmod(0o444)
assert sha(manual) == "401851c5c326a7802d205a76ec4604a33b5d572b141c1874ac8625605aaeb392"
print("CPU RECOVERY VALID", len(decoded), "files fully decoded/parsed; controller FAILED, capture UNKNOWN, caffeinate UNKNOWN retained")
print("RECOVERY SHA256", sha(target))
