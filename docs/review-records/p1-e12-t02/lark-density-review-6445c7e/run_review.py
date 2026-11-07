#!/usr/bin/env python3
"""Independent Lark stock-validate and density measurement. Writes only under this scratch dir."""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import time
from collections import Counter
from pathlib import Path

SCRATCH = Path("/tmp/lark-grok-6445c7ec")
WT = Path("/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96")
BLEND = WT / "assets/blend/hulls/lark.blend"
GLB = WT / "packages/client/public/models/hulls/lark.glb"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
NODE = "/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node"
KTX_REAL = "/Users/andreyyurlov/.t3/worktrees/space/t3-6f0e842d/node_modules/.cache/ktx-software-4.4.2/bin/ktx"
VALIDATE = WT / "packages/tools/blender/validate.py"
RSS_LIMIT = 8 * 1024 ** 3
TMP_LIMIT = 6 * 1024 ** 3
DEADLINE = 45 * 60
STARTED = time.time()
OWNED = []

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def dir_size(path):
    total = 0
    for root, dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total

def ps_rows():
    out = subprocess.check_output(["ps", "-ax", "-o", "pid=,ppid=,rss="], text=True)
    rows = {}
    children = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        pid, ppid, rss = int(parts[0]), int(parts[1]), int(parts[2]) * 1024
        rows[pid] = rss
        children.setdefault(ppid, []).append(pid)
    return rows, children

def tree_rss(pid):
    rows, children = ps_rows()
    stack = [pid]
    seen = set()
    total = 0
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        total += rows.get(current, 0)
        stack.extend(children.get(current, []))
    return total

def disk_free():
    return shutil.disk_usage(SCRATCH).free

def git_bytes(rev, path):
    data = subprocess.check_output(["git", "-C", str(WT), "cat-file", "-p", f"{rev}:{path}"])
    text = data.decode()
    oid = size = None
    for line in text.splitlines():
        if line.startswith("oid sha256:"):
            oid = line.split()[1]
        elif line.startswith("size "):
            size = int(line.split()[1])
    return {"blob_text": text.strip(), "lfs_oid": oid, "lfs_size": size}

def base_env():
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", ""),
        "TMPDIR": str(SCRATCH / "tmp"),
        "TMP": str(SCRATCH / "tmp"),
        "TEMP": str(SCRATCH / "tmp"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "OMP_NUM_THREADS": "2",
        "OPENBLAS_NUM_THREADS": "2",
        "MKL_NUM_THREADS": "2",
        "VECLIB_MAXIMUM_THREADS": "2",
        "NUMEXPR_NUM_THREADS": "2",
        "UV_THREADPOOL_SIZE": "2",
        "ART_KTX_JOBS": "1",
        "ART_REPO_ROOT": str(WT),
        "KTX": str(SCRATCH / "ktx_one.py"),
        "LARK_KTX_REAL": KTX_REAL,
        "LARK_KTX_LOCK": str(SCRATCH / "ktx.lock"),
        "BLENDER_USER_RESOURCES": str(SCRATCH / "blender-user"),
        "BLENDER_USER_CONFIG": str(SCRATCH / "blender-user/config"),
        "BLENDER_USER_SCRIPTS": str(SCRATCH / "blender-user/scripts"),
        "BLENDER_USER_DATAFILES": str(SCRATCH / "blender-user/datafiles"),
        "XDG_CACHE_HOME": str(SCRATCH / "xdg-cache"),
    }
    return env

def run_monitored(cmd, log_name, env, cwd):
    log_path = SCRATCH / "logs" / log_name
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w") as log:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env, cwd=cwd, start_new_session=True)
    OWNED.append(proc.pid)
    peak = 0
    tmp_peak = dir_size(SCRATCH)
    killed = None
    t0 = time.time()
    while True:
        rc = proc.poll()
        rss = tree_rss(proc.pid)
        peak = max(peak, rss)
        tmp_now = dir_size(SCRATCH)
        tmp_peak = max(tmp_peak, tmp_now)
        if rss > RSS_LIMIT:
            killed = "rss"
        elif tmp_now > TMP_LIMIT:
            killed = "tmp"
        elif time.time() - STARTED > DEADLINE:
            killed = "deadline"
        if killed:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=10)
            rc = proc.returncode
            break
        if rc is not None:
            break
        time.sleep(1)
    tail = log_path.read_text(errors="replace")[-4000:]
    return {
        "cmd": cmd,
        "log": str(log_path),
        "exit": rc,
        "killed": killed,
        "peak_rss": peak,
        "seconds": round(time.time() - t0, 3),
        "tmp_peak": tmp_peak,
        "tail": tail,
    }

def summarize_validate(path):
    data = json.loads(Path(path).read_text())
    warns = Counter()
    fails = []
    for check in data.get("checks", []):
        for finding in check.get("findings", []):
            if finding["level"] == "warn":
                warns[(check["id"], finding["message"])] += 1
            elif finding["level"] == "fail":
                fails.append({"check": check["id"], "subject": finding.get("subject"), "message": finding.get("message")})
    assets = []
    for asset in data.get("assets") or []:
        for variant in asset.get("variants", []):
            assets.append({
                "asset": asset.get("asset"),
                "id": variant.get("id"),
                "class": variant.get("class"),
                "lodTris": variant.get("lodTris"),
                "dims": variant.get("dims"),
                "materials": variant.get("materials"),
            })
    return {
        "status": data.get("status"),
        "error": data.get("error"),
        "blender": data.get("blender"),
        "summary": data.get("summary"),
        "assets": assets,
        "fail_findings": fails,
        "warn_messages": [{"check": k[0], "message": k[1], "count": n} for k, n in warns.most_common()],
    }

def main():
    os.chmod(SCRATCH / "ktx_one.py", 0o755)
    for sub in ("tmp", "blender-user/config", "blender-user/scripts", "blender-user/datafiles", "xdg-cache", "logs", "reports"):
        (SCRATCH / sub).mkdir(parents=True, exist_ok=True)
    before = {
        "blend_sha256": sha256(BLEND),
        "glb_sha256": sha256(GLB),
        "blend_bytes": BLEND.stat().st_size,
        "glb_bytes": GLB.stat().st_size,
        "git_status": subprocess.check_output(["git", "-C", str(WT), "status", "--porcelain=v1"], text=True),
        "git_head": subprocess.check_output(["git", "-C", str(WT), "rev-parse", "HEAD"], text=True).strip(),
        "git_tree": subprocess.check_output(["git", "-C", str(WT), "rev-parse", "HEAD^{tree}"], text=True).strip(),
        "disk_free": disk_free(),
    }
    shutil.copy2(BLEND, SCRATCH / "backup-lark.blend")
    shutil.copy2(GLB, SCRATCH / "backup-lark.glb")
    identity = {}
    for rev in (
        "6445c7ec07aa2a08b722aeca22d56132154ea32c",
        "8b6c3604bb842019c899956a1b57d6a01385d6f3",
        "9648690f6e3149684cbd7fe7787d6ae8cfc1c5f1",
        "1331891dcaba3e8438c6a62b2b698a1d054c0e79",
    ):
        identity[rev] = {
            "blend": git_bytes(rev, "assets/blend/hulls/lark.blend"),
            "glb": git_bytes(rev, "packages/client/public/models/hulls/lark.glb"),
        }
    ktx_version = subprocess.check_output([KTX_REAL, "-v"], text=True, stderr=subprocess.STDOUT).strip()
    env = base_env()
    stages = {}
    measure_env = dict(env)
    measure_env["LARK_BLEND"] = str(BLEND)
    measure_env["LARK_OUT"] = str(SCRATCH / "reports" / "blend-density.json")
    stages["blend_measure"] = run_monitored(
        [BLENDER, "-b", "-t", "2", "--factory-startup", "--python-exit-code", "1", "-P", str(SCRATCH / "measure_blend.py")],
        "blend-measure.log",
        measure_env,
        str(SCRATCH),
    )
    stages["validate_source"] = run_monitored(
        [BLENDER, "-b", "-t", "2", "--factory-startup", "--python-exit-code", "1", "-P", str(VALIDATE), "--",
         "--quiet", "--report", str(SCRATCH / "reports" / "validate-source.json"), str(BLEND)],
        "validate-source.log",
        env,
        str(WT),
    )
    stages["validate_glb"] = run_monitored(
        [BLENDER, "-b", "-t", "2", "--factory-startup", "--python-exit-code", "1", "-P", str(VALIDATE), "--",
         "--quiet", "--report", str(SCRATCH / "reports" / "validate-glb.json"), str(GLB)],
        "validate-glb.log",
        env,
        str(WT),
    )
    stages["glb_measure"] = run_monitored(
        [NODE, str(SCRATCH / "measure_glb.mjs"), str(GLB), str(SCRATCH / "reports" / "glb-density.json")],
        "glb-measure.log",
        env,
        str(SCRATCH),
    )
    after = {
        "blend_sha256": sha256(BLEND),
        "glb_sha256": sha256(GLB),
        "git_status": subprocess.check_output(["git", "-C", str(WT), "status", "--porcelain=v1"], text=True),
        "disk_free": disk_free(),
        "scratch_bytes": dir_size(SCRATCH),
    }
    restored = []
    if after["blend_sha256"] != before["blend_sha256"]:
        shutil.copy2(SCRATCH / "backup-lark.blend", BLEND)
        restored.append("blend")
        after["blend_sha256_after_restore"] = sha256(BLEND)
    if after["glb_sha256"] != before["glb_sha256"]:
        shutil.copy2(SCRATCH / "backup-lark.glb", GLB)
        restored.append("glb")
        after["glb_sha256_after_restore"] = sha256(GLB)
    alive = []
    for pid in OWNED:
        try:
            os.kill(pid, 0)
        except OSError:
            continue
        alive.append(pid)
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            pass
    facts = {
        "before": before,
        "after": after,
        "restored": restored,
        "alive_reaped": alive,
        "identity": identity,
        "ktx_version": ktx_version,
        "stages": {name: {k: v for k, v in stage.items() if k != "tail"} for name, stage in stages.items()},
        "stage_tails": {name: stage["tail"] for name, stage in stages.items()},
    }
    for label, report in (("validate_source", "validate-source.json"), ("validate_glb", "validate-glb.json")):
        path = SCRATCH / "reports" / report
        facts[label] = summarize_validate(path) if path.exists() else {"missing": True}
    for label, report in (("blend_measure_json", "blend-density.json"), ("glb_measure_json", "glb-density.json")):
        path = SCRATCH / "reports" / report
        if not path.exists():
            facts[label] = {"missing": True}
            continue
        data = json.loads(path.read_text())
        if label == "blend_measure_json":
            facts[label] = {
                "summary": data.get("summary"),
                "uv_inventory": data.get("uv_inventory"),
                "uv_bounds_lod0_UVMap": data.get("uv_bounds_lod0_UVMap"),
                "image_size_counts": data.get("image_size_counts"),
                "gate_linked_image_size_counts": data.get("gate_linked_image_size_counts"),
                "force_fit_properties": data.get("force_fit_properties"),
                "libraries": data.get("libraries"),
                "linked_object_count": data.get("linked_object_count"),
                "local_mesh_object_count": data.get("local_mesh_object_count"),
                "name_matches": data.get("name_matches_seam_glyph_hollow_wear_husk"),
                "husk_slot_engine_names": data.get("husk_slot_engine_names"),
                "matrix_convention_error": data.get("matrix_convention_error"),
                "blender": data.get("blender"),
                "outside_min": {"key": (data.get("summary") or {}).get("outside_min_key"), "median": (data.get("summary") or {}).get("outside_min_median")},
                "rows": data.get("density"),
                "outside_rows": data.get("outside_gate"),
            }
        else:
            facts[label] = data
    (SCRATCH / "facts.json").write_text(json.dumps(facts, indent=2) + "\n")
    print("REVIEW_DONE", json.dumps({"restored": restored, "alive": alive, "exits": {k: v["exit"] for k, v in stages.items()}, "killed": {k: v["killed"] for k, v in stages.items()}}))

if __name__ == "__main__":
    main()
