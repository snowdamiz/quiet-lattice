"""One remaining station capture, gated by a future parent grant and the CPU-reviewed lifecycle.

The original nine-stage grant is revoked. This controller does not accept it and cannot launch
without the separate remaining-eight grant file. Capture argv and shared helpers remain frozen.
"""
import datetime
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import time

from round4_capture_children import CaptureChildren, process_rows

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
READY = BASE / "remaining8_readiness.json"
GRANT_FILE = BASE / "gpu_grant_remaining8.json"
CAPTURE_SECONDS = 600
CLEANUP_SECONDS = 60


class CaptureWindowExpired(BaseException):
    pass


@contextmanager
def capture_deadline(seconds):
    previous = signal.getsignal(signal.SIGALRM)
    def expired(*_):
        raise CaptureWindowExpired("Capture hard deadline expired")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    temp = path.with_name(path.name + ".writing")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temp, path)


def main(stage_id):
    # Only a subsequent explicit parent grant may create this file after independent CPU review.
    assert GRANT_FILE.is_file(), "No new GPU grant. The previous nine-stage grant is revoked."
    grant = json.loads(GRANT_FILE.read_text())
    assert grant["authorization_id"] == os.environ.get("STATION_ROUND4_GPU_GRANT")
    assert grant["readiness_sha256"] == sha(READY)
    assert grant["controller_sha256"] == sha(__file__)
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == grant["authorized_head"]
    assert subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip() == "task/P1-E11-T01"
    assert not (BASE / "PARENT_HOLD_GPU").exists()
    ready = json.loads(READY.read_text())
    assert len(ready["stages"]) == 8
    stage = next(s for s in ready["stages"] if s["id"] == stage_id)
    assert stage_id != "standard-waystation-ws_fabricator", "Recovered stage must never be rerendered"
    for path, expected in ready["input_sha256"].items():
        assert sha(ROOT / path) == expected, path
    out = ROOT / stage["out_path"]
    assert not out.exists(), "No overwrite, rerender or automatic retry"
    run = BASE / "engine_runs/remaining8" / stage_id
    assert not run.exists()
    run.mkdir(parents=True)
    launch = {"stage": stage_id, "controller_pid": os.getpid(), "controller_pgid": os.getpgrp(),
              "controller_sha256": sha(__file__), "authorization": grant, "argv": stage["argv"],
              "prepared_output": stage["out_path"], "recorded_before_launch_utc": utc(),
              "capture_timeout_seconds": CAPTURE_SECONDS, "cleanup_timeout_seconds": CLEANUP_SECONDS}
    write(run / "launch.json", launch)
    state = {}
    owner = CaptureChildren({}, state, persist=lambda: write(run / "child_lifecycle.json", state))
    profiles, ports, backend = set(), set(), {}
    baseline_temp = set((ROOT / "packages/client/public/models/stations").glob("_review_*.glb"))
    stream = (run / "stdout.txt").open("w")
    capture_outcome = "launch_failed"
    failure = None
    next_detail = 0

    def observe():
        nonlocal next_detail
        active = owner.refresh()
        detail = time.monotonic() >= next_detail
        for row in active:
            for match in re.finditer(r'--user-data-dir=(?:"([^"]+)"|([^ ]+))', row["command"]):
                profile = match.group(1) or match.group(2)
                assert Path(profile).name.startswith("playwright_chromiumdev_profile-")
                profiles.add(profile)
            if "--type=gpu-process" in row["command"] and detail:
                mapped = subprocess.run(["/usr/sbin/lsof", "-p", str(row["pid"]), "-Fn"], capture_output=True, text=True, timeout=3).stdout
                backend[row["pid"]] = {"pid": row["pid"], "kernel_identity": owner.known[row["pid"]],
                                        "flags": [x for x in row["command"].split() if "angle=" in x or "type=gpu" in x],
                                        "mapped_backend_files": [x for x in mapped.splitlines() if any(k in x for k in ("Metal", "AGX", "metallib"))]}
        if active and detail:
            listing = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", ",".join(str(r["pid"]) for r in active),
                                      "-iTCP", "-sTCP:LISTEN", "-Fn"], capture_output=True, text=True, timeout=3).stdout
            ports.update(x[1:] for x in listing.splitlines() if x.startswith("n") and re.search(r":\d+$", x))
        if detail:
            next_detail = time.monotonic() + 10
        record = {"utc": utc(), "active_owned": active, "identities": owner.known,
                  "profiles": sorted(profiles), "ports": sorted(ports), "backend": list(backend.values())}
        with (run / "ownership.jsonl").open("a") as journal:
            journal.write(json.dumps(record) + "\n")
        write(run / "observation_summary.json", record)

    print("READY", stage_id, "controller", os.getpid(), "600s+60s", flush=True)
    try:
        env = dict(os.environ, STATION_GPU_CAPTURE_WINDOW="granted", SMOKE_GL="metal")
        capture = subprocess.Popen(stage["argv"], cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        owner.add_direct("capture", capture)
        caffeinate = subprocess.Popen(["caffeinate", "-i", "-w", str(capture.pid)], start_new_session=True)
        owner.add_direct("caffeinate", caffeinate)
        launch.update(start_utc=utc(), pid=capture.pid, caffeinate_pid=caffeinate.pid,
                      initial_identities=owner.known)
        write(run / "launch.json", launch)
        with capture_deadline(CAPTURE_SECONDS):
            capture_outcome = owner.watch(CAPTURE_SECONDS, observe)
    except CaptureWindowExpired as error:
        capture_outcome = "timed_out"
        failure = str(error)
        owner.error(error)
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
        owner.error(error)
    finally:
        # drain retains individual errors and continues every other known owned child/group.
        cleanup_deadline = time.monotonic() + CLEANUP_SECONDS
        lifecycle = owner.drain(CLEANUP_SECONDS - 10)  # Reserve ten seconds for direct resource audits.
        stream.close()
        audit_errors = []
        checks = {}
        for address in sorted(ports):
            try:
                checks[address] = subprocess.run(["/usr/sbin/lsof", "-nP", f"-iTCP:{address.rsplit(':', 1)[1]}", "-sTCP:LISTEN"], capture_output=True, text=True, timeout=min(3, max(0.1, cleanup_deadline - time.monotonic()))).stdout
            except Exception as error:
                audit_errors.append(f"Port {address}: {error}")
        try:
            assertions = subprocess.check_output(["/usr/bin/pmset", "-g", "assertions"], text=True, timeout=min(3, max(0.1, cleanup_deadline - time.monotonic())))
            idle = [line for line in assertions.splitlines() if any(re.search(rf"\bpid\s+{pid}\(", line) for pid in owner.known)]
        except Exception as error:
            audit_errors.append(f"Idle assertion audit: {error}")
            idle = ["Unverified"]
        removed_profiles, removed_temp = [], []
        if lifecycle["drained"]:
            for profile in sorted(profiles):
                try:
                    path = Path(profile)
                    assert path.name.startswith("playwright_chromiumdev_profile-") and not path.is_symlink()
                    if path.exists():
                        shutil.rmtree(path)
                        removed_profiles.append(profile)
                except Exception as error:
                    audit_errors.append(f"Profile {profile}: {error}")
            for path in (ROOT / "packages/client/public/models/stations").glob("_review_*.glb"):
                if path not in baseline_temp and any(path.stem == f"_review_{pid}" for pid in owner.known):
                    try:
                        path.unlink()
                        removed_temp.append(str(path.relative_to(ROOT)))
                    except Exception as error:
                        audit_errors.append(f"Temporary GLB {path}: {error}")
        remaining_profiles = [p for p in profiles if Path(p).exists()]
        remaining_temp = [str(p.relative_to(ROOT)) for p in (ROOT / "packages/client/public/models/stations").glob("_review_*.glb")
                          if p not in baseline_temp and any(p.stem == f"_review_{pid}" for pid in owner.known)]
        result = {**launch, "end_utc": utc(), "capture_outcome": capture_outcome, "failure": failure,
                  "exit": lifecycle["exits"].get("capture"), "caffeinate_exit": lifecycle["exits"].get("caffeinate"),
                  "lifecycle": lifecycle, "all_owned_pids": sorted(owner.known), "owned_groups": sorted(owner.groups),
                  "remaining_owned_processes": lifecycle["remaining"], "profiles_observed": sorted(profiles),
                  "remaining_profiles": remaining_profiles, "removed_owned_profiles": removed_profiles,
                  "port_release_checks": checks, "owned_idle_assertions": idle, "audit_errors": audit_errors,
                  "removed_owned_temp_glbs": removed_temp, "remaining_owned_temp_glbs": remaining_temp,
                  "owned_backend_evidence": list(backend.values())}
        write(run / "result.json", result)
    assert capture_outcome == "completed" and result["exit"] == 0
    assert lifecycle["clean"] and not audit_errors
    assert not remaining_profiles and not remaining_temp and not idle and not any(checks.values())
    for path, expected in ready["input_sha256"].items():
        assert sha(ROOT / path) == expected, path
    artifacts = []
    for path in sorted(out.iterdir()):
        if path.is_file():
            data = path.read_bytes()
            row = {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            if path.suffix == ".png":
                assert data[:8] == b"\x89PNG\r\n\x1a\n"
                row["pixels"] = list(struct.unpack_from(">II", data, 16))
            artifacts.append(row)
    report = json.loads((out / ("perf.json" if stage["kind"] == "standard" else "shots.json")).read_text())
    if stage["kind"] == "standard":
        assert report["errors"] == [] and report["gl"] == "metal" and report["viewport"] == [1920, 1080]
        assert len([a for a in artifacts if a["path"].endswith(".png")]) == 11
    else:
        assert len(report) == len(stage["requested_shots"])
        assert all(r["errors"] == [] and r["perf"] == [] and r["gl"] == "metal" and r["viewport"] == [1920, 1080] for r in report)
    result.update(artifacts=artifacts, capture_metadata=report, inspection="Pending image inspection before another stage",
                  performance_qualification="Unqualified standard readout, or supplemental visual-only evidence with zero perf calls")
    write(run / "result.json", result)
    print("COMPLETE", stage_id, "capture exit0; owned resources drained; inspect before another stage", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
