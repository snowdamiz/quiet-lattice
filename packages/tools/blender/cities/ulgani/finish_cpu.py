"""Finish saved-asset CPU evidence sequentially, with a fresh gate for each Blender job."""

import subprocess
import sys

from pipeline import HERE, ROOT, run

run(
    "negatives-r01",
    HERE / "negative_controls.py",
    ["--out", "assets/blend/cities/ulgani/negatives/r01"],
    seconds=900,
)
subprocess.run(
    [
        sys.executable,
        str(HERE / "pipeline.py"),
        "--stage",
        "preview",
        "--attempt",
        "r01",
    ],
    cwd=ROOT,
    check=True,
)
for group, asset in [
    ("tall", "ulgani_tall_3"),
    ("anchor", "ulgani_root_island_landmark"),
    ("kit", "ulgani_cap_shelter"),
]:
    run(
        f"preview-export-{group}-r01",
        HERE / "preview.py",
        [
            "--source",
            f"packages/client/public/models/cities/ulgani_{group}.glb",
            "--asset",
            asset,
            "--lod",
            "2",
            "--out",
            "assets/renders/cities/ulgani-cpu",
            "--receipt",
            f"assets/blend/cities/ulgani/previews/export-{group}-r01.json",
        ],
        seconds=900,
    )
run("preview-context-r01", HERE / "context_sheets.py", [], seconds=900)
