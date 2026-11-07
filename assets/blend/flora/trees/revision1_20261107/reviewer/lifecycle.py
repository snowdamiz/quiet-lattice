#!/usr/bin/env python3
"""Reproduce T04 runner failure handling with scratch roots and the exact run.py bytes.

A harness exit of 0 means each asserted defect or control behaved as recorded.
It does not mean the tree is safe.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

REPO = Path("/Users/andreyyurlov/.t3/worktrees/space/t3-9dcc2975")
OUT = Path("/tmp/t04-r570e7f2-review/lifecycle")
RUN_PY = (REPO / "packages/tools/blender/flora_trees/run.py").read_bytes()
EXPORT_PY = (REPO / "packages/tools/blender/flora_trees/export_saved.py").read_bytes()
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
ENV_BASE = os.environ.copy()
ENV_BASE.update({
    "PYTHONDONTWRITEBYTECODE": "1",
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "MKL_NUM_THREADS": "2",
    "NUMEXPR_NUM_THREADS": "2",
    "VECLIB_MAXIMUM_THREADS": "2",
    "CUDA_VISIBLE_DEVICES": "",
})


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def make_root(name: str) -> Path:
    root = OUT / name
    if root.exists():
        shutil.rmtree(root)
    script = root / "packages/tools/blender/flora_trees"
    script.mkdir(parents=True)
    (script / "run.py").write_bytes(RUN_PY)
    (root / "assets/blend/flora").mkdir(parents=True)
    (root / "packages/client/public/models/flora").mkdir(parents=True)
    (root / "assets/blend/flora/trees/evidence").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "-b", "scratch"], cwd=root, check=True)
    subprocess.run(
        ["git", "-c", "user.email=review@example.invalid", "-c", "user.name=review", "commit", "--allow-empty", "-q", "-m", "init"],
        cwd=root, check=True,
    )
    assert hashlib.sha256((script / "run.py").read_bytes()).hexdigest() == hashlib.sha256(RUN_PY).hexdigest()
    return root


def place_pair(root: Path, source: bytes, export: bytes, candidate: dict):
    src = root / "assets/blend/flora/tree_round_t04.blend"
    dst = root / "packages/client/public/models/flora/tree_round_t04.glb"
    src.write_bytes(source)
    dst.write_bytes(export)
    cand = root / "assets/blend/flora/trees/candidate.json"
    cand.write_text(json.dumps(candidate) + "\n")
    return src, dst, cand


def run(root: Path, args, deadline_watch=None, sig=None, sig_after=None):
    cmd = ["python3", "-B", str(root / "packages/tools/blender/flora_trees/run.py"), *args]
    log = OUT / f"{root.name}.log"
    proc = subprocess.Popen(cmd, cwd=root, env=ENV_BASE, stdout=log.open("w"), stderr=subprocess.STDOUT, start_new_session=True)
    if sig is not None:
        time.sleep(sig_after)
        os.kill(proc.pid, sig)
    try:
        rc = proc.wait(timeout=deadline_watch or 90)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        rc = proc.wait(timeout=10)
    survivors = blender_survivors()
    return {"exit": rc, "log": log.read_text()[-4000:], "survivors": survivors, "pid": proc.pid}


def blender_survivors():
    rows = subprocess.check_output(["ps", "-axo", "pid=,pgid=,command="], text=True)
    hits = []
    for line in rows.splitlines():
        if "t04-r570e7f2-review/lifecycle/" in line:
            hits.append(line.strip())
    return hits


def receipts(root: Path):
    return sorted((root / "assets/blend/flora/trees/evidence").glob("*/receipt.json"))


def case_unreadable():
    root = make_root("unreadable-source")
    src, dst, cand = place_pair(root, b"BLEND-BYTES", b"CURRENT-GLB", {"status": "PASS", "export": "CURRENT-GLB"})
    before = {"src": sha(src), "dst": sha(dst), "cand": sha(cand)}
    os.chmod(src, 0)
    result = run(root, ["export", "round", "--deadline", "30"])
    os.chmod(src, 0o644)
    after = {
        "source_exists": src.exists(),
        "export_exists": dst.exists(),
        "export_sha256": sha(dst),
        "candidate_exists": cand.exists(),
        "candidate_sha256": sha(cand),
        "receipts": [str(p.relative_to(root)) for p in receipts(root)],
        "run_dirs": sorted(p.name for p in (root / "assets/blend/flora/trees/evidence").iterdir() if p.is_dir()),
    }
    # Defect: exception before quarantine leaves the accepted GLB and candidate, and writes no receipt.
    defect = (
        result["exit"] != 0
        and after["export_sha256"] == before["dst"]
        and after["candidate_sha256"] == before["cand"]
        and after["receipts"] == []
        and after["run_dirs"] != []
    )
    return {"name": "unreadable-source", "defect_reproduced": defect, "before": before, "after": after, "run": result}


def case_directory_source():
    root = make_root("directory-source")
    _src, dst, cand = place_pair(root, b"BLEND-BYTES", b"CURRENT-GLB", {"status": "PASS"})
    src = root / "assets/blend/flora/tree_round_t04.blend"
    src.unlink()
    src.mkdir()
    before = {"dst": sha(dst), "cand": sha(cand)}
    result = run(root, ["export", "round", "--deadline", "30"])
    after = {
        "export_exists": dst.exists(),
        "export_sha256": sha(dst),
        "candidate_exists": cand.exists(),
        "receipts": [str(p.relative_to(root)) for p in receipts(root)],
        "run_dirs": sorted(p.name for p in (root / "assets/blend/flora/trees/evidence").iterdir() if p.is_dir()),
    }
    defect = (
        result["exit"] != 0
        and after["export_sha256"] == before["dst"]
        and not after["candidate_exists"]
        and after["receipts"] == []
    )
    return {"name": "directory-source", "defect_reproduced": defect, "before": before, "after": after, "run": result}


def case_lock():
    root = make_root("lock-held")
    src, dst, cand = place_pair(root, b"BLEND-BYTES", b"CURRENT-GLB", {"status": "PASS"})
    before = (sha(src), sha(dst), sha(cand))
    import fcntl
    lock_path = root / "assets/blend/flora/trees/evidence/.lane.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = lock_path.open("a")
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        result = run(root, ["export", "round", "--deadline", "15"])
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        fd.close()
    after = (sha(src), sha(dst), sha(cand))
    ok = result["exit"] == 75 and after == before and receipts(root) == [] and "T04 lane already owned" in result["log"]
    return {"name": "lock-held", "control_passed": ok, "before": before, "after": after, "run": result}


def case_missing_source_control():
    """Readable-absent source must quarantine the current GLB before Blender starts."""
    root = make_root("missing-source")
    src, dst, cand = place_pair(root, b"not-a-blend", b"CURRENT-GLB", {"status": "PASS"})
    src.unlink()
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_bytes(EXPORT_PY)
    result = run(root, ["export", "round", "--deadline", "45"], deadline_watch=70)
    archived = list((root / "assets/blend/flora/trees/evidence").glob("*/previous-historical.glb"))
    recs = receipts(root)
    body = json.loads(recs[0].read_text()) if recs else None
    ok = (
        not dst.exists()
        and not cand.exists()
        and len(archived) == 1
        and archived[0].read_bytes() == b"CURRENT-GLB"
        and not archived[0].is_symlink()
        and recs
        and body["exit"] != 0
        and body["remaining_owned_children"] == []
        and result["survivors"] == []
    )
    return {"name": "missing-source", "control_passed": ok, "exit": result["exit"], "receipt": body, "survivors": result["survivors"], "log_tail": result["log"][-800:]}


def case_symlink_archive():
    root = make_root("symlink-archive")
    backing = OUT / "symlink-backing.glb"
    backing.write_bytes(b"ARCHIVED-BYTES")
    src = root / "assets/blend/flora/tree_round_t04.blend"
    src.write_bytes(b"not-a-blend")
    dst = root / "packages/client/public/models/flora/tree_round_t04.glb"
    dst.symlink_to(backing)
    cand = root / "assets/blend/flora/trees/candidate.json"
    cand.write_text('{"status":"PASS"}\n')
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_bytes(EXPORT_PY)
    result = run(root, ["seal", "round", "--deadline", "45"], deadline_watch=70)
    archived = list((root / "assets/blend/flora/trees/evidence").glob("*/previous-historical.glb"))
    mutated = False
    archive_sha_before = None
    archive_sha_after = None
    if len(archived) == 1:
        archive_sha_before = sha(archived[0])
        backing.write_bytes(b"MUTATED-OUTSIDE-ATTEMPT")
        archive_sha_after = sha(archived[0])
        mutated = archive_sha_before != archive_sha_after and archived[0].is_symlink()
    defect = mutated and not dst.exists() and not cand.exists() and result["survivors"] == []
    return {
        "name": "symlink-archive",
        "defect_reproduced": defect,
        "archive_is_symlink": bool(archived and archived[0].is_symlink()),
        "archive_target": os.readlink(archived[0]) if archived and archived[0].is_symlink() else None,
        "sha_before": archive_sha_before,
        "sha_after": archive_sha_after,
        "canonical_export_exists": dst.exists(),
        "candidate_exists": cand.exists(),
        "exit": result["exit"],
        "survivors": result["survivors"],
        "receipts": [str(p.relative_to(root)) for p in receipts(root)],
    }


def case_signal_receipt():
    root = make_root("signal-sigint")
    src, dst, cand = place_pair(root, b"not-a-blend", b"CURRENT-GLB", {"status": "PASS"})
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_bytes(EXPORT_PY)
    result = run(root, ["export", "round", "--deadline", "40"], deadline_watch=50, sig=signal.SIGINT, sig_after=1.2)
    recs = receipts(root)
    archived = list((root / "assets/blend/flora/trees/evidence").glob("*/previous-historical.glb"))
    return {
        "name": "signal-sigint",
        "exit": result["exit"],
        "receipts": [str(p.relative_to(root)) for p in recs],
        "receipt": json.loads(recs[0].read_text()) if recs else None,
        "canonical_export_exists": dst.exists(),
        "archived": [str(p.relative_to(root)) for p in archived],
        "archived_bytes": archived[0].read_bytes().decode() if archived else None,
        "candidate_exists": cand.exists(),
        "survivors": result["survivors"],
        "log_tail": result["log"][-1000:],
        "source_exists": src.exists(),
    }


def case_publish_then_source_mutation():
    """Real run.py bytes. The child is Blender executing the runner-selected export script.
    That script publishes a canonical GLB and then changes the source, then exits 0.
    """
    root = make_root("source-mutation")
    src, dst, cand = place_pair(root, b"ORIGINAL-SOURCE", b"OLD-GLB", {"status": "PASS"})
    stub = '''import sys
from pathlib import Path
root = Path(__file__).resolve().parents[4]
kind = sys.argv[-2]
src = root / "assets/blend/flora" / f"tree_{kind}_t04.blend"
dst = root / "packages/client/public/models/flora" / f"tree_{kind}_t04.glb"
dst.write_bytes(b"PUBLISHED-GLB")
src.write_bytes(b"MUTATED-SOURCE")
print("child-published", flush=True)
'''
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_text(stub)
    result = run(root, ["export", "round", "--deadline", "40"], deadline_watch=60)
    recs = receipts(root)
    body = json.loads(recs[0].read_text()) if recs else None
    defect = (
        dst.exists() and dst.read_bytes() == b"PUBLISHED-GLB"
        and src.read_bytes() == b"MUTATED-SOURCE"
        and body is not None and body.get("source_mutation") is True and body.get("exit") == 1
        and not cand.exists()
        and result["survivors"] == []
    )
    return {
        "name": "source-mutation-published",
        "defect_reproduced": defect,
        "export_bytes": dst.read_bytes().decode() if dst.exists() else None,
        "source_bytes": src.read_bytes().decode() if src.exists() else None,
        "receipt": body,
        "survivors": result["survivors"],
        "log_tail": result["log"][-800:],
    }


def case_unreadable_export():
    root = make_root("unreadable-export")
    src, dst, cand = place_pair(root, b"not-a-blend", b"PRIOR-GLB", {"status": "PASS"})
    os.chmod(dst, 0)
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_bytes(EXPORT_PY)
    result = run(root, ["export", "round", "--deadline", "40"], deadline_watch=70)
    os.chmod(dst, 0o644)
    archived = list((root / "assets/blend/flora/trees/evidence").glob("*/previous-historical.glb"))
    if archived:
        os.chmod(archived[0], 0o644)
    return {
        "name": "unreadable-export",
        "exit": result["exit"],
        "canonical_exists": dst.exists(),
        "candidate_exists": cand.exists(),
        "archived": [p.name for p in archived],
        "archived_bytes": archived[0].read_bytes().decode() if archived else None,
        "archived_symlink": bool(archived and archived[0].is_symlink()),
        "receipts": [str(p.relative_to(root)) for p in receipts(root)],
        "survivors": result["survivors"],
        "log_tail": result["log"][-600:],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    load = os.getloadavg()
    free = shutil.disk_usage("/tmp").free
    cases = []
    # No Blender.
    cases.append(case_unreadable())
    cases.append(case_directory_source())
    cases.append(case_lock())
    # One Blender at a time.
    cases.append(case_missing_source_control())
    cases.append(case_symlink_archive())
    cases.append(case_unreadable_export())
    cases.append(case_signal_receipt())
    cases.append(case_publish_then_source_mutation())
    survivors = blender_survivors()
    out = {"load_at_start": load, "free_disk": free, "cases": cases, "final_survivors": survivors}
    (OUT.parent / "lifecycle-results.json").write_text(json.dumps(out, indent=2) + "\n")
    brief = [{k: c.get(k) for k in ("name", "defect_reproduced", "control_passed", "exit", "survivors", "receipts", "canonical_export_exists", "canonical_exists")} for c in cases]
    print(json.dumps({"load": load, "free_disk": free, "brief": brief, "final_survivors": survivors}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
