#!/usr/bin/env python3
"""Signal, publish-rollback, and manifest retarget controls. Exact run.py/manifest.py bytes."""
import hashlib
import importlib.util
import json
import os
import signal
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("life", "/tmp/t04-r570e7f2-review/lifecycle.py")
life = importlib.util.module_from_spec(spec)
spec.loader.exec_module(life)

OUT = Path("/tmp/t04-r570e7f2-review")
REPO = life.REPO


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def signal_case():
    root = life.make_root("signal-sigint")
    src, dst, cand = life.place_pair(root, b"ORIGINAL-SOURCE", b"CURRENT-GLB", {"status": "PASS"})
    (root / "packages/tools/blender/flora_trees/export_saved.py").write_text("import time\ntime.sleep(30)\nprint('slept', flush=True)\n")
    result = life.run(root, ["export", "round", "--deadline", "40"], deadline_watch=20, sig=signal.SIGINT, sig_after=1.5)
    recs = life.receipts(root)
    archived = list((root / "assets/blend/flora/trees/evidence").glob("*/previous-historical.glb"))
    # Give a killed Blender a moment to disappear.
    time.sleep(0.5)
    return {
        "name": "signal-sigint",
        "exit": result["exit"],
        "receipts": [str(p.relative_to(root)) for p in recs],
        "canonical_export_exists": dst.exists(),
        "candidate_exists": cand.exists(),
        "archived_bytes": archived[0].read_bytes().decode() if archived else None,
        "survivors_immediate": result["survivors"],
        "survivors_after": life.blender_survivors(),
        "log_tail": result["log"][-1500:],
        "source_bytes": src.read_bytes().decode() if src.is_file() else None,
    }


def mutation_case():
    return life.case_publish_then_source_mutation()


def manifest_case():
    root = life.make_root("manifest-retarget")
    (root / "packages/tools/blender/flora_trees/manifest.py").write_bytes((REPO / "packages/tools/blender/flora_trees/manifest.py").read_bytes())
    a = root / "source-a.blend"
    b = root / "source-b.blend"
    a.write_bytes(b"SOURCE-A")
    b.write_bytes(b"SOURCE-B")
    link = root / "assets/blend/flora/tree_round_t04.blend"
    link.symlink_to(a)
    glb = root / "packages/client/public/models/flora/tree_round_t04.glb"
    glb.write_bytes(b"GLB-A")
    ha, hg = sha(link), sha(glb)
    ev = root / "assets/blend/flora/trees/evidence/20260101T000000_validate_round_aaaaaaaa"
    reports = ev / "reports"
    reports.mkdir(parents=True)
    (reports / "flora__tree_round_t04.blend.json").write_text(json.dumps({"status": "PASS"}))
    (reports / "flora__tree_round_t04.glb.json").write_text(json.dumps({"status": "PASS"}))
    audit_dir = root / "assets/blend/flora/trees/evidence/20260101T000000_audit_round_bbbbbbbb"
    export_dir = root / "assets/blend/flora/trees/evidence/20260101T000000_export_round_cccccccc"
    audit_dir.mkdir()
    export_dir.mkdir()
    receipt = {"exit": 0, "remaining_owned_children": [], "source_before": ha, "source_after": ha, "export_sha256": hg}
    for d in (ev, audit_dir, export_dir):
        (d / "receipt.json").write_text(json.dumps(receipt))
    (audit_dir / "audit.json").write_text(json.dumps({"source_sha256": ha, "export_sha256": hg, "source_meshes": {}}))
    # Retarget the caller path before the binder reads it. Receipts still name SOURCE-A.
    link.unlink()
    link.symlink_to(b)
    proc = life.run.__wrapped__ if False else None
    import subprocess
    log = OUT / "lifecycle/manifest-retarget.log"
    env = life.ENV_BASE.copy()
    completed = subprocess.run(
        ["python3", "-B", str(root / "packages/tools/blender/flora_trees/manifest.py")],
        cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30,
    )
    log.write_text(completed.stdout)
    cand = root / "assets/blend/flora/trees/candidate.json"
    return {
        "name": "manifest-retarget",
        "exit": completed.returncode,
        "caller_now": sha(link),
        "receipt_source": ha,
        "candidate_written": cand.exists(),
        "rejected": completed.returncode != 0 and not cand.exists() and sha(link) != ha,
        "log_tail": completed.stdout[-800:],
    }


def main():
    results = [signal_case(), mutation_case(), manifest_case()]
    (OUT / "lifecycle-rest.json").write_text(json.dumps(results, indent=2) + "\n")
    brief = []
    for r in results:
        brief.append({k: r.get(k) for k in ("name", "exit", "defect_reproduced", "rejected", "receipts", "canonical_export_exists", "candidate_exists", "candidate_written", "survivors_after", "archived_bytes", "export_bytes")})
    print(json.dumps(brief, indent=2))
    print("FINAL", life.blender_survivors())


if __name__ == "__main__":
    main()
