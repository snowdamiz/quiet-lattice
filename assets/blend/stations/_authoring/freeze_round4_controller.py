"""Freeze CPU-tested station controller sources and the eight unchanged, unlaunched commands."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil

from round4_capture_children import identity, process_rows

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
HERE = Path(__file__).resolve().parent


def item(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}


original_plan = BASE / "capture_readiness.json"
assert item(original_plan)["sha256"] == "d1dc9907f657cf9a707a2b5ee2cc477fa15831cf3ba378bebb51b05b6ac973fa"
plan = json.loads(original_plan.read_text())
recovery_file = BASE / "stage1_artifact_recovery.json"
recovery = json.loads(recovery_file.read_text())
assert recovery["original_execution"]["controller_status"] == "FAILED"
assert recovery["original_execution"]["capture_exit"] == recovery["original_execution"]["caffeinate_exit"] == "UNKNOWN"
assert recovery["rerendered"] is False
assert not (BASE / "gpu_grant_remaining8.json").exists()
test_log = BASE / "controller_final14.txt"
assert "Ran 14 tests" in test_log.read_text() and test_log.read_text().rstrip().endswith("OK")
fixture_file = BASE / "controller_cpu_tests/final14/fixtures.json"
fixtures = json.loads(fixture_file.read_text())
assert len(fixtures) == 14 and all(r["all_fixture_pids_and_groups_absent"] for r in fixtures)
fixture_ids, fixture_groups = set(), set()
for r in fixtures:
    fixture_ids.update(int(pid) for pid in r["exit_statuses"])
    fixture_groups.update(p["pgid"] for p in r["children"])
    fixture_ids.update(int(pid) for pid in r.get("lifecycle", {}).get("identities", {}))
current = [r for r in process_rows() if r["pid"] in fixture_ids or r["pgid"] in fixture_groups]
assert not current, current
for path, expected in plan["input_sha256"].items():
    assert item(ROOT / path)["sha256"] == expected
for kit in ("waystation", "scrapyard"):
    inventory = json.loads((ROOT / f"assets/renders/stations/review_round3/{kit}/inventory.json").read_text())
    assert all(item(ROOT / r["path"])["sha256"] == r["sha256"] for r in inventory["files"])
freeze = BASE / "controller_freeze"
freeze.mkdir(exist_ok=False)
sources = []
for name in ("capture_round4_stage.py", "round4_capture_children.py", "test_round4_capture_lifecycle.py", "recover_round4_stage1.py"):
    source = HERE / name
    copy = freeze / name
    shutil.copy2(source, copy)
    copy.chmod(0o444)
    sources.append({"source": item(source), "frozen_copy": item(copy)})
qualification = {
    "task": "P1.E11.T01", "mode": "CPU_ONLY", "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "corrected_source_bindings": sources, "passing_test_log": item(test_log), "passing_fixture_records": item(fixture_file),
    "test_count": 14, "all_final_fixture_pids_and_groups_absent": True,
    "final_fixture_pids": sorted(fixture_ids), "final_fixture_groups": sorted(fixture_groups),
    "old_failure_reproduction": item(BASE / "controller_red_reproduced.txt"),
    "old_failure_fixture_records": item(BASE / "controller_cpu_tests/red_actual/fixtures.json"),
    "kernel_identity_source": "macOS PROC_PIDTBSDINFO birth seconds/microseconds, UID, PID and PGID; SZOMB=5 from installed SDK",
    "permission_control": "Real macOS seatbelt signal denial. The unsandboxed fixture supervisor verifies birth identity, kills and reaps the denied target after fail-closed output.",
    "prior_attempts_preserved": [str(p.relative_to(ROOT)) for p in sorted((BASE / "controller_cpu_tests").iterdir())],
    "independent_review_status": "PENDING", "GPU_authorization": "NONE. Previous nine-stage grant revoked."
}
qualification_file = BASE / "controller_cpu_qualification.json"
qualification_file.write_text(json.dumps(qualification, indent=2) + "\n")
qualification_file.chmod(0o444)
stages = [s for s in plan["stages"] if s["id"] != "standard-waystation-ws_fabricator"]
assert len(stages) == 8 and all(not (ROOT / s["out_path"]).exists() for s in stages)
inputs = dict(plan["input_sha256"])
for source in sources:
    inputs[source["source"]["path"]] = source["source"]["sha256"]
for path in (recovery_file, qualification_file, test_log, fixture_file):
    bound = item(path)
    inputs[bound["path"]] = bound["sha256"]
ready = {"task": "P1.E11.T01", "submission_round": 4, "status": "CPU_READY_FOR_INDEPENDENT_CONTROLLER_REVIEW",
         "GPU_GATE": "CLOSED; fresh explicit parent grant required after independent review", "previous_nine_stage_grant_revoked": True,
         "original_plan": item(original_plan), "recovered_stage1": item(recovery_file),
         "recovered_original_execution": recovery["original_execution"], "controller_qualification": item(qualification_file),
         "input_sha256": inputs, "stages": stages, "stages_exactly_match_original_prepared_argv_and_paths": True,
         "future_grant_file": "assets/renders/stations/round4/gpu_grant_remaining8.json",
         "future_grant_fields": ["authorization_id", "authorized_head", "readiness_sha256", "controller_sha256"],
         "future_run": "STATION_ROUND4_GPU_GRANT=<new-parent-authorization-id> python3 assets/blend/stations/_authoring/capture_round4_stage.py <stage-id>",
         "policy": "One stage at a time; unchanged helpers, source assets, resolution, samples, lights, exposure and shot requests. Inspect and fully drain before another stage. No automatic retry.",
         "capture_hard_timeout_seconds": 600, "cleanup_window_seconds": 60,
         "performance": "Standard readouts unqualified under E14.T13; supplements retain zero perf calls",
         "fourth_component_packets": "Pending eight remaining captures and full GPU release"}
ready_file = BASE / "remaining8_readiness.json"
assert not ready_file.exists()
ready_file.write_text(json.dumps(ready, indent=2) + "\n")
ready_file.chmod(0o444)
print("CPU CONTROLLER FROZEN", item(qualification_file))
print("REMAINING EIGHT READY, NO GPU GRANT", item(ready_file))
