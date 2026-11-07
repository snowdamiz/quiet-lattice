#!/usr/bin/env python3
"""Adversarial controls for the committed T08 export_saved.py and run.py.

Scratch only. The repo tree is not a ROOT or HERE. Original assets are not opened.
"""
import importlib.util, json, os, signal, stat, subprocess, sys, time
from pathlib import Path

REPO = Path("/Users/andreyyurlov/.t3/worktrees/space/t3-8895fab5")
PY = sys.executable
SCRATCH = Path("/tmp/t08-r1-review-9ec69d49/life")
if SCRATCH.exists():
    subprocess.check_call(["rm", "-rf", str(SCRATCH)])
SCRATCH.mkdir(parents=True)

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

export_mod = load("t08_export_saved", REPO / "packages/tools/blender/t08/export_saved.py")
results = []

def rec(name, **kw):
    row = {"case": name, **kw}
    results.append(row)
    print("CASE", json.dumps(row), flush=True)

def make_tree(tag):
    root = SCRATCH / tag
    here = root / "packages/tools/blender/t08"
    src = root / "assets/blend/props"
    dst = root / "packages/client/public/models/props"
    src.mkdir(parents=True)
    dst.mkdir(parents=True)
    here.mkdir(parents=True)
    (src / "cargo_pod.blend").write_bytes(b"SOURCE-BYTES-v1")
    (dst / "cargo_pod.glb").write_bytes(b"CURRENT-GLB")
    # fake runner used by the real export_one
    (here / "run.py").write_text(
        "import os, sys\n"
        "from pathlib import Path\n"
        "case = os.environ.get('T08_CASE','ok')\n"
        "args = sys.argv\n"
        "report = Path(args[args.index('--report-dir')+1])\n"
        "report.mkdir(parents=True, exist_ok=True)\n"
        "src = Path(os.environ['T08_SRC'])\n"
        "dst = Path(os.environ['T08_DST'])\n"
        "def stock(status):\n"
        "    for ext in ('blend','glb'):\n"
        "        (report / f'props__cargo_pod.{ext}.json').write_text('{\"status\":\"%s\"}' % status)\n"
        "if case == 'ok':\n"
        "    dst.write_bytes(b'NEW-GLB')\n"
        "    stock('PASS')\n"
        "    sys.exit(0)\n"
        "if case == 'change_source':\n"
        "    src.write_bytes(b'SOURCE-MUTATED')\n"
        "    dst.write_bytes(b'NEW-GLB')\n"
        "    stock('PASS')\n"
        "    sys.exit(0)\n"
        "if case == 'child_fail':\n"
        "    dst.write_bytes(b'BAD-GLB')\n"
        "    stock('FAIL')\n"
        "    sys.exit(1)\n"
        "if case == 'unreadable_new':\n"
        "    dst.write_bytes(b'NEW-UNREADABLE')\n"
        "    os.chmod(dst, 0)\n"
        "    stock('PASS')\n"
        "    sys.exit(0)\n"
        "if case == 'stock_not_pass':\n"
        "    dst.write_bytes(b'NEW-GLB')\n"
        "    stock('FAIL')\n"
        "    sys.exit(0)\n"
        "sys.exit(9)\n"
    )
    return root, here, src / "cargo_pod.blend", dst / "cargo_pod.glb"

def run_export(tag, case, prep=None):
    root, here, src, dst = make_tree(tag)
    if prep:
        prep(src, dst)
    export_mod.ROOT = root
    export_mod.HERE = here
    os.environ["T08_CASE"] = case
    os.environ["T08_SRC"] = str(src)
    os.environ["T08_DST"] = str(dst)
    item = {"family": "props", "stem": "cargo_pod"}
    thrown = None
    try:
        ok = export_mod.export_one(item, "probe")
    except Exception as e:
        ok = None
        thrown = type(e).__name__ + ": " + str(e)
    attempts = sorted((here / "exports").glob("*"))
    binding = None
    names = []
    if attempts:
        names = sorted(p.name for p in attempts[-1].iterdir())
        bpath = attempts[-1] / "binding.json"
        if bpath.exists():
            binding = json.loads(bpath.read_text())
    def mode_of(p):
        if not p.exists() and not p.is_symlink():
            return "absent"
        st = p.lstat()
        return {"symlink": stat.S_ISLNK(st.st_mode), "mode": oct(st.st_mode & 0o777), "size": st.st_size}
    # restore mode so later inspection can read
    if dst.exists() and not dst.is_symlink():
        try:
            os.chmod(dst, 0o644)
        except OSError:
            pass
    runtime = dst.read_bytes() if dst.exists() and not dst.is_symlink() else (os.readlink(dst) if dst.is_symlink() else None)
    prev = None
    if attempts and (attempts[-1] / "previous.glb").exists():
        prev = (attempts[-1] / "previous.glb").read_bytes()
        prev_link = (attempts[-1] / "previous.glb").is_symlink()
    else:
        prev_link = None
    src_bytes = None
    if src.exists() and not src.is_symlink():
        try:
            os.chmod(src, 0o644)
            src_bytes = src.read_bytes().decode()
        except OSError as e:
            src_bytes = "unreadable:" + str(e)
    return {
        "ok": ok,
        "thrown": thrown,
        "binding": binding,
        "names": names,
        "runtime": runtime.decode() if isinstance(runtime, bytes) else runtime,
        "runtimeStat": mode_of(dst),
        "previous": prev.decode() if isinstance(prev, bytes) else None,
        "previousIsSymlink": prev_link,
        "src": src_bytes,
    }

# 1. symlink runtime path
def prep_link(src, dst):
    dst.unlink()
    target = dst.parent / "backing.glb"
    target.write_bytes(b"CURRENT-GLB")
    dst.symlink_to(target)

r = run_export("symlink", "ok", prep_link)
# mutate backing after the failed attempt
backing = SCRATCH / "symlink/packages/client/public/models/props/backing.glb"
live = SCRATCH / "symlink/packages/client/public/models/props/cargo_pod.glb"
backing.write_bytes(b"MUTATED-AFTER-FAIL")
rec("symlink_dst_left_live",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    error=(r["binding"] or {}).get("error"), names=r["names"],
    liveIsSymlink=live.is_symlink(), liveReads=live.read_bytes().decode() if live.exists() else None,
    previous=r["previous"])

# 2. unreadable existing GLB
def prep_000(src, dst):
    os.chmod(dst, 0)
r = run_export("mode000", "ok", prep_000)
live = SCRATCH / "mode000/packages/client/public/models/props/cargo_pod.glb"
os.chmod(live, 0o644)
rec("unreadable_existing_glb",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    error=(r["binding"] or {}).get("error"), names=r["names"],
    runtimeBytes=live.read_bytes().decode(), previous=r["previous"])

# 3. unreadable source after a readable GLB (quarantine-before-hash control)
def prep_src(src, dst):
    os.chmod(src, 0)
r = run_export("badsourceread", "ok", prep_src)
live = SCRATCH / "badsourceread/packages/client/public/models/props/cargo_pod.glb"
rec("unreadable_source_after_quarantine",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    error=(r["binding"] or {}).get("error"), names=r["names"],
    runtimeExists=live.exists(), previous=r["previous"])

# 4. child exits 0 and changes source
r = run_export("changed", "change_source")
live = SCRATCH / "changed/packages/client/public/models/props/cargo_pod.glb"
rec("source_changed_after_child_exit_0",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    error=(r["binding"] or {}).get("error"), names=r["names"],
    runtimeExists=live.exists(), previous=r["previous"], src=r["src"])

# 5. child non-zero removes new bytes (control)
r = run_export("childfail", "child_fail")
live = SCRATCH / "childfail/packages/client/public/models/props/cargo_pod.glb"
rec("child_fail_removes_new_glb",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    names=r["names"], runtimeExists=live.exists(), previous=r["previous"],
    rejectedPresent="rejected.glb" in r["names"])

# 6. stock report not PASS (control)
r = run_export("stockfail", "stock_not_pass")
live = SCRATCH / "stockfail/packages/client/public/models/props/cargo_pod.glb"
rec("stock_fail_removes_new_glb",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    names=r["names"], runtimeExists=live.exists(), previous=r["previous"])

# 7. new GLB mode 000, child exit 0
r = run_export("new000", "unreadable_new")
live = SCRATCH / "new000/packages/client/public/models/props/cargo_pod.glb"
try:
    os.chmod(live, 0o644)
except OSError:
    pass
rec("unreadable_new_glb_left_in_place",
    returned=r["ok"], thrown=r["thrown"], bindingStatus=(r["binding"] or {}).get("status"),
    error=(r["binding"] or {}).get("error"), names=r["names"],
    runtimeExists=live.exists(),
    runtimeBytes=live.read_bytes().decode() if live.exists() else None,
    previous=r["previous"])

# 8. happy path archives an independent regular copy (control)
r = run_export("ok", "ok")
live = SCRATCH / "ok/packages/client/public/models/props/cargo_pod.glb"
prev = list((SCRATCH / "ok/packages/tools/blender/t08/exports").glob("*/previous.glb"))[0]
live.write_bytes(b"MUTATED-RUNTIME-AFTER-PASS")
rec("pass_archives_independent_bytes",
    returned=r["ok"], bindingStatus=(r["binding"] or {}).get("status"),
    previousIsSymlink=prev.is_symlink(), previousAfterRuntimeMutation=prev.read_bytes().decode(),
    nlink=prev.stat().st_nlink, runtimeNow=live.read_bytes().decode())

# ---- run.py interrupt / lock, real module, scratch HERE ----
run_mod = load("t08_run", REPO / "packages/tools/blender/t08/run.py")

def start_runner(label, command, patch=None):
    here = SCRATCH / ("run-" + label)
    here.mkdir(parents=True)
    (here / "evidence").mkdir()
    code = (
        "import importlib.util, sys\n"
        "from pathlib import Path\n"
        f"spec = importlib.util.spec_from_file_location('t08run', r'{REPO / 'packages/tools/blender/t08/run.py'}')\n"
        "m = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(m)\n"
        f"m.HERE = Path(r'{here}')\n"
        f"m.ROOT = Path(r'{SCRATCH}')\n"
        + (patch or "")
        + f"sys.argv = {command!r}\n"
        "raise SystemExit(m.main())\n"
    )
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.Popen([PY, "-B", "-c", code], start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
    return here, proc

def wait_launch(here, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        hits = list((here / "evidence").glob("*/launch.json"))
        if hits:
            return hits[0].parent
        time.sleep(0.05)
    return None

def reap(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except OSError:
        pass

# SIGTERM
marker = SCRATCH / "term-marker"
cmd = ["run.py", "--label", "sigterm", "--wall", "30", "--", PY, "-c",
       "import sys,time; from pathlib import Path; time.sleep(4); Path(sys.argv[1]).write_text('WROTE')",
       str(marker)]
here, proc = start_runner("sigterm", cmd)
launch = wait_launch(here)
time.sleep(0.4)
os.kill(proc.pid, signal.SIGTERM)
try:
    out, _ = proc.communicate(timeout=8)
except subprocess.TimeoutExpired:
    reap(proc.pid)
    out, _ = proc.communicate(timeout=5)
time.sleep(4.5)
receipts = list((here / "evidence").glob("*/result.json"))
rec("sigterm_runner",
    runnerExit=proc.returncode,
    launch=bool(launch),
    receipt=bool(receipts),
    markerWritten=marker.exists(),
    marker=marker.read_text() if marker.exists() else None,
    stdoutTail=(out or "")[-500:])
# cleanup any sleeper
subprocess.call(["pkill", "-f", str(marker)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# SIGINT
marker2 = SCRATCH / "int-marker"
cmd = ["run.py", "--label", "sigint", "--wall", "30", "--", PY, "-c",
       "import sys,time; from pathlib import Path; time.sleep(8); Path(sys.argv[1]).write_text('WROTE')",
       str(marker2)]
here, proc = start_runner("sigint", cmd)
launch = wait_launch(here)
time.sleep(0.4)
os.kill(proc.pid, signal.SIGINT)
try:
    out, _ = proc.communicate(timeout=15)
except subprocess.TimeoutExpired:
    reap(proc.pid)
    out, _ = proc.communicate(timeout=5)
receipt = None
remaining = None
if list((here / "evidence").glob("*/result.json")):
    receipt = json.loads(list((here / "evidence").glob("*/result.json"))[0].read_text())
    remaining = receipt.get("remainingGroup")
rec("sigint_runner",
    runnerExit=proc.returncode,
    receipt=receipt is not None,
    receiptExit=None if receipt is None else receipt.get("exit"),
    receiptPass=None if receipt is None else receipt.get("pass"),
    remaining=remaining,
    markerWritten=marker2.exists(),
    stdoutTail=(out or "")[-400:])
subprocess.call(["pkill", "-f", str(marker2)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# killpg raises
marker3 = SCRATCH / "eperm-marker"
cmd = ["run.py", "--label", "eperm", "--wall", "30", "--", PY, "-c",
       "import sys,time; from pathlib import Path; time.sleep(8); Path(sys.argv[1]).write_text('WROTE')",
       str(marker3)]
patch = "m.os.killpg = lambda *a, **k: (_ for _ in ()).throw(PermissionError(1, 'Operation not permitted'))\n"
here, proc = start_runner("eperm", cmd, patch=patch)
launch = wait_launch(here)
time.sleep(0.4)
os.kill(proc.pid, signal.SIGINT)
try:
    out, _ = proc.communicate(timeout=12)
except subprocess.TimeoutExpired:
    reap(proc.pid)
    out, _ = proc.communicate(timeout=5)
receipts = list((here / "evidence").glob("*/result.json"))
# is the sleeper alive?
ps = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
alive = [ln for ln in ps.splitlines() if str(marker3) in ln]
rec("killpg_permissionerror",
    runnerExit=proc.returncode,
    receipt=bool(receipts),
    sleeperAlive=alive,
    markerWritten=marker3.exists(),
    stdoutTail=(out or "")[-600:])
for ln in alive:
    pid = int(ln.split()[0])
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass

# lock ownership: second runner must not truncate the first log
cmd = ["run.py", "--label", "lockhold", "--wall", "20", "--", PY, "-c", "import time; time.sleep(12)"]
here, proc = start_runner("lockhold", cmd)
launch = wait_launch(here)
time.sleep(0.3)
log = launch / "command.log"
before = log.read_bytes()
cmd2 = ["run.py", "--label", "locktry", "--wall", "10", "--", PY, "-c", "import time; time.sleep(1)"]
here2, proc2 = start_runner("locktry", cmd2)
try:
    out2, _ = proc2.communicate(timeout=8)
except subprocess.TimeoutExpired:
    reap(proc2.pid)
    out2, _ = proc2.communicate(timeout=3)
after = log.read_bytes()
os.kill(proc.pid, signal.SIGINT)
try:
    proc.communicate(timeout=12)
except subprocess.TimeoutExpired:
    reap(proc.pid)
    proc.communicate(timeout=3)
rec("lock_second_runner",
    secondExit=proc2.returncode,
    firstLogUnchanged=before == after,
    secondReceipts=len(list((here2 / "evidence").glob("*/result.json"))),
    secondLaunch=len(list((here2 / "evidence").glob("*/launch.json"))),
    stdoutTail=(out2 or "")[-400:])

# repo untouched?
st = subprocess.check_output(["git", "status", "--porcelain=v1", "-uall"], cwd=REPO, text=True)
rec("repo_status_after_lifecycle", porcelain=st)

Path("/tmp/t08-r1-review-9ec69d49/lifecycle.json").write_text(json.dumps(results, indent=2) + "\n")
print("LIFECYCLE_DONE", len(results))
