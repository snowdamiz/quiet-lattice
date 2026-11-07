"""Publish only stock-validated exports of the twelve saved sources, with bound receipts.

Before launching stock export, retire existing bytes to an immutable attempt folder. Thus a
crash, unreadable source, or failed validation cannot leave a stale model at the runtime path.
No imports from author.py, geometry.py, or materials.py are permitted here.
"""

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def digest(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(
            f"expected a regular file, not an alias or missing source: {path}"
        )
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_one(item, label):
    family, stem = item["family"], item["stem"]
    src = ROOT / "assets/blend" / family / (stem + ".blend")
    dst = ROOT / "packages/client/public/models" / family / (stem + ".glb")
    attempt = (
        HERE
        / "exports"
        / (
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + "-"
            + label
            + "-"
            + stem
        )
    )
    attempt.mkdir(parents=True, exist_ok=False)
    report = {
        "source": str(src.relative_to(ROOT)),
        "output": str(dst.relative_to(ROOT)),
        "status": "FAILED",
    }
    try:
        if dst.is_symlink():
            raise RuntimeError(
                "runtime path is an unexpected symlink; refusing alias mutation"
            )
        if dst.exists():
            data = dst.read_bytes()
            (attempt / "previous.glb").write_bytes(data)
            report["retiredSHA256"] = hashlib.sha256(data).hexdigest()
            dst.unlink()
        before = digest(src)
        report["sourceSHA256"] = before
        command = [
            sys.executable,
            str(HERE / "run.py"),
            "--label",
            "export-" + stem + "-" + label,
            "--wall",
            "1800",
            "--",
            "blender",
            "-P",
            f"packages/tools/blender/export_{family}.py",
            "--",
            "--only",
            stem,
            "--report-dir",
            str(attempt / "stock"),
        ]
        report["command"] = command
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        (attempt / "launcher.log").write_text(result.stdout + result.stderr)
        report["exit"] = result.returncode
        if result.returncode:
            raise RuntimeError("stock export failed: " + result.stdout[-3000:])
        if digest(src) != before:
            raise RuntimeError("source changed during export")
        for ext in ["blend", "glb"]:
            raw = json.loads(
                (attempt / "stock" / f"{family}__{stem}.{ext}.json").read_text()
            )
            if raw["status"] != "PASS":
                raise RuntimeError("stock report is not PASS")
        report["outputSHA256"] = digest(dst)
        report["status"] = "PASS"
    except Exception as e:
        report["error"] = str(e)
        if dst.exists() and not dst.is_symlink():
            (attempt / "rejected.glb").write_bytes(dst.read_bytes())
            dst.unlink()
    finally:
        (attempt / "binding.json").write_text(json.dumps(report, indent=2) + "\n")
    print(stem, report["status"], attempt.relative_to(ROOT), flush=True)
    if report["status"] != "PASS":
        print(report.get("error"))
    return report["status"] == "PASS"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only")
    p.add_argument("--label", required=True)
    args = p.parse_args()
    items = json.loads((HERE / "inventory.json").read_text())
    selected = set(args.only.split(",")) if args.only else {x["stem"] for x in items}
    assert selected and selected <= {x["stem"] for x in items}
    results = [export_one(x, args.label) for x in items if x["stem"] in selected]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
