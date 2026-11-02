"""Run exactly ONE parent-authorized third-round CPU static artifact stage.

STATION_CPU_SINGLE_STAGE=granted python3 assets/blend/stations/_authoring/static_stage_round3.py scrapyard sy_deck
Use target 'family' for a family sheet. There is deliberately no batch/next-stage option.
Check parent messages before every invocation. A scratch/hold-round3-cpu marker prevents new stages.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round3"
OUT = BASE / "static"
ALLOWED = {"waystation": {"ws_hangar", "ws_tradedeck", "ws_fabricator", "ws_spine", "ws_ring", "ws_habitat", "ws_baydoor", "ws_cargopod", "ws_refuelpost", "family"},
           "scrapyard": {"sy_rock", "sy_mouth", "sy_dock", "sy_dock_l", "sy_deck", "sy_gangway", "family"}}
assert os.environ.get("STATION_CPU_SINGLE_STAGE") == "granted", "No current single-stage CPU grant."
family, target = sys.argv[1:]
assert family in ALLOWED and target in ALLOWED[family]
assert not (Path(__file__).parent / "scratch/hold-round3-cpu").exists(), "CPU-heavy HOLD is active."
assert subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip() == "task/P1-E11-T01"


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def processes():
    rows = []
    for line in subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,pcpu=,comm="], text=True).splitlines():
        fields = line.strip().split(None, 4)
        if len(fields) == 5:
            rows.append({"pid": int(fields[0]), "ppid": int(fields[1]), "pgid": int(fields[2]),
                         "cpu_percent": float(fields[3]), "comm": fields[4]})
    return rows


source = ROOT / f"packages/client/public/models/stations/{family}.glb"
expected = next(x["sha256"] for x in json.loads((BASE / "export_checkpoint.json").read_text())["outputs"] if x["family"] == family)
assert digest(source) == expected, "Saved-source export changed; do not mix submissions."
manifest = OUT / f"{family}_{target}_manifest.json"
binding = BASE / f"stage_{family}_{target}.json"
if binding.exists():
    prior = json.loads(binding.read_text())
    if prior.get("exit") == 0 and prior["source_sha256"] == expected and all(digest(ROOT / x["path"]) == x["sha256"] for x in prior["artifacts"]):
        print("SKIP: matching complete single stage", family, target)
        raise SystemExit(0)
    raise SystemExit("Preserve the existing attempt and use an explicit new attempt path before retrying.")
assert not manifest.exists(), "Existing evidence has no matching stage record; preserve it instead of overwriting."

OUT.mkdir(exist_ok=True)
args = ["/Applications/Blender.app/Contents/MacOS/Blender", "-b", "--factory-startup", "--python-exit-code", "1", "-t", "2",
        "-P", "packages/tools/blender/turntable.py", "--", str(source.relative_to(ROOT)), str(OUT.relative_to(ROOT)),
        "--samples", "48", "--scale", "1", "--manifest", str(manifest.relative_to(ROOT)), "--cycles-device", "CPU"]
args += ["--family"] if target == "family" else ["--asset", target]
journal = BASE / f"stage_{family}_{target}_window.jsonl"


def record(data):
    with journal.open("a") as stream:
        stream.write(json.dumps({"utc": utc(), **data}) + "\n")


env = dict(os.environ, ART_KTX_JOBS="2", OPENBLAS_NUM_THREADS="2", OMP_NUM_THREADS="2")
started = utc()
with (BASE / f"stage_{family}_{target}.txt").open("w") as stream:
    child = subprocess.Popen(args, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
caffeinate = subprocess.Popen(["caffeinate", "-i", "-w", str(child.pid)], start_new_session=True)
owned = {child.pid, caffeinate.pid}
groups = {os.getpgid(child.pid), os.getpgid(caffeinate.pid)}
initial = {"family": family, "target": target, "source": str(source.relative_to(ROOT)), "source_sha256": expected,
           "start_utc": started, "argv": args, "observer_pid": os.getpid(), "render_pid": child.pid,
           "render_pgid": os.getpgid(child.pid), "render_sid": os.getsid(child.pid), "caffeinate_pid": caffeinate.pid,
           "settings": {"device_override": "CPU", "threads": 2, "samples": 48, "resolution_scale": 1}, "GPU_GATE": "CLOSED"}
record({"kind": "launch", **initial})
print("START", family, target, started, "Blender", child.pid, "caffeinate", caffeinate.pid, "observer", os.getpid(), flush=True)
next_sample = time.monotonic()
last_pids = None
while True:
    rows = processes()
    changed = True
    while changed:
        new = {x["pid"] for x in rows if x["ppid"] in owned}
        changed = bool(new - owned)
        owned |= new
    active = [x for x in rows if x["pid"] in owned]
    groups |= {x["pgid"] for x in active}
    pids = tuple(x["pid"] for x in active)
    if pids != last_pids:
        record({"kind": "owned_process_transition", "active": active})
        last_pids = pids
    if time.monotonic() >= next_sample:
        record({"kind": "host_cpu_observation", "loadavg": os.getloadavg(), "active_owned": active,
                "top_processes_by_cpu": sorted(rows, key=lambda x: x["cpu_percent"], reverse=True)[:12]})
        next_sample = time.monotonic() + 30
    if child.poll() is not None:
        break
    time.sleep(1)
code = child.wait()
caffeinate.wait(timeout=15)
remaining = [x for x in processes() if x["pid"] in owned or x["pgid"] in groups]
assert not remaining and caffeinate.returncode == 0
assert digest(source) == expected
result = {**initial, "end_utc": utc(), "exit": code, "caffeinate_exit": caffeinate.returncode,
          "all_observed_owned_pids": sorted(owned), "process_groups": sorted(groups), "remaining_owned_processes": remaining,
          "hold": "Check parent messages. No further stage is scheduled or launched."}
if code == 0:
    info = json.loads(manifest.read_text())
    paths = info["family"]["sheets"] if target == "family" else [p for sheet in info["sheets"] for p in (sheet["turntable"], sheet["materials_sheet"])]
    assert paths and all(Path(p).is_file() and Path(p).stat().st_size for p in paths)
    result["artifacts"] = [{"path": str(Path(p).relative_to(ROOT)), "sha256": digest(Path(p)), "bytes": Path(p).stat().st_size}
                           for p in paths + [str(manifest)]]
binding.write_text(json.dumps(result, indent=2) + "\n")
record({"kind": "finished", **result})
print("COMPLETE", family, target, result["end_utc"], "exit", code, "owned processes drained; no next stage", flush=True)
raise SystemExit(code)
