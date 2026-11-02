"""One bounded CPU stage; retain commands, process ownership and direct drain evidence."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
stage, *command = sys.argv[1:]
assert command and "/Applications/Blender.app/Contents/MacOS/Blender" == command[0]
assert "-t" in command and command[command.index("-t") + 1] == "2"
assert not (BASE / "HOLD_CPU").exists(), "Parent CPU hold active"
assert subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip() == "task/P1-E11-T01"
record = BASE / "jobs" / f"{stage}.json"
record.parent.mkdir(exist_ok=True)
assert not record.exists(), "Retain old attempts; choose a fresh stage name"


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def processes():
    rows = []
    for line in subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,pcpu=,comm="], text=True).splitlines():
        p = line.strip().split(None, 4)
        if len(p) == 5:
            rows.append({"pid": int(p[0]), "ppid": int(p[1]), "pgid": int(p[2]), "cpu": float(p[3]), "comm": p[4]})
    return rows


env = dict(os.environ, ART_KTX_JOBS="2", OPENBLAS_NUM_THREADS="2", OMP_NUM_THREADS="2", VECLIB_MAXIMUM_THREADS="2")
with record.with_suffix(".log").open("w") as stream:
    child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
owned = {child.pid}
groups = {os.getpgid(child.pid)}
data = {"stage": stage, "argv": command, "start_utc": utc(), "controller_pid": os.getpid(),
        "child_pid": child.pid, "child_pgid": child.pid, "GPU_GATE": "CLOSED", "threads": 2,
        "state": "running", "observations": []}
data["input_bindings"] = [{"path": p, "sha256": hashlib.sha256((ROOT / p).read_bytes()).hexdigest()}
                          for p in command if Path(p).suffix in (".py", ".blend", ".glb") and (ROOT / p).is_file()]
record.write_text(json.dumps(data, indent=2) + "\n")
print("START", stage, "PID/PGID", child.pid, flush=True)
deadline = time.monotonic() + 3600
next_observation = 0
while child.poll() is None:
    rows = processes()
    previous = None
    while previous != owned:
        previous = set(owned)
        owned |= {r["pid"] for r in rows if r["ppid"] in owned}
    active = [r for r in rows if r["pid"] in owned]
    groups |= {r["pgid"] for r in active}
    if time.monotonic() >= next_observation:
        data["observations"].append({"utc": utc(), "owned": active})
        record.write_text(json.dumps(data, indent=2) + "\n")
        next_observation = time.monotonic() + 30
    if time.monotonic() > deadline:
        os.killpg(child.pid, signal.SIGTERM)
        data["timeout"] = True
        break
    time.sleep(1)
try:
    code = child.wait(timeout=30)
except subprocess.TimeoutExpired:
    os.killpg(child.pid, signal.SIGKILL)
    code = child.wait()
remaining = [r for r in processes() if r["pid"] in owned or r["pgid"] in groups]
data.update(end_utc=utc(), exit=code, observed_owned_pids=sorted(owned), process_groups=sorted(groups),
            remaining_owned=remaining, state="drained" if not remaining else "drain_failed")
record.write_text(json.dumps(data, indent=2) + "\n")
assert not remaining, remaining
print("END", stage, "exit", code, "owned process groups drained; no next stage", flush=True)
raise SystemExit(code)
