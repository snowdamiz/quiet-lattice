"""Sequential, bounded per-file operations; the export path never invokes authoring."""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).parent
META = ROOT / "assets/blend/cities/ulgani"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
GROUPS = ["low", "mid", "tall", "civic", "kit", "props", "landmarks", "anchor"]


def inventory(group):
    path = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    matches = [
        p
        for p in sorted((META / "inventory").glob(group + "-*.json"))
        if json.loads(p.read_text())["sha256"] == sha
    ]
    if not matches:
        raise RuntimeError("No inventory matches the saved source hash: " + group)
    return str(matches[-1].relative_to(ROOT))


def run(label, script, args, seconds=1200, stale=None):
    command = [sys.executable, str(HERE / "run.py"), "--seconds", str(seconds)]
    if stale:
        command += ["--stale", stale]
    command += [
        label,
        "--",
        BLENDER,
        "-b",
        "--factory-startup",
        "-t",
        "2",
        "--python-exit-code",
        "1",
        "-P",
        str(script),
        "--",
        *args,
    ]
    print("Starting", label, flush=True)
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "--stage",
        choices=["author", "source-audit", "export", "audit", "preview"],
        required=True,
    )
    p.add_argument("--groups", default=",".join(GROUPS))
    p.add_argument("--attempt", required=True)
    a = p.parse_args()
    for group in a.groups.split(","):
        if group not in GROUPS:
            p.error("Unknown group")
        label = f"{a.stage}-{group}-{a.attempt}"
        if a.stage == "author":
            run(
                label,
                HERE / "author.py",
                [
                    "--group",
                    group,
                    "--receipt",
                    f"assets/blend/cities/ulgani/inventory/{group}-{a.attempt}.json",
                ],
            )
        elif a.stage in ("source-audit", "audit"):
            args = [
                "--group",
                group,
                "--inventory",
                inventory(group),
                "--out",
                f"assets/blend/cities/ulgani/audits/{group}-{a.stage}-{a.attempt}",
            ]
            if a.stage == "source-audit":
                args.append("--source-only")
            run(label, HERE / "audit.py", args)
        elif a.stage == "export":
            run(
                label,
                ROOT / "packages/tools/blender/export_cities.py",
                [
                    "--only",
                    "ulgani_" + group,
                    "--report-dir",
                    f"assets/blend/cities/ulgani/exports/{group}-{a.attempt}",
                    "--quiet",
                ],
                seconds=1800,
                stale=f"packages/client/public/models/cities/ulgani_{group}.glb",
            )
        elif a.stage == "preview":
            run(
                label,
                HERE / "preview.py",
                [
                    "--source",
                    f"assets/blend/cities/ulgani_{group}.blend",
                    "--out",
                    "assets/renders/cities/ulgani-cpu",
                    "--receipt",
                    f"assets/blend/cities/ulgani/previews/{group}-{a.attempt}.json",
                ],
                seconds=1800,
            )


if __name__ == "__main__":
    main()
