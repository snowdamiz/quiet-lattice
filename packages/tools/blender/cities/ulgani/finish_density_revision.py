"""Final stock/geometry and CPU image evidence, preserving every historical receipt."""

import json
import subprocess

from pipeline import GROUPS, HERE, META, ROOT, run

python = json.loads((META / "density-revision/launchers-and-base.json").read_text())[
    "python"
]["path"]
subprocess.run(
    [python, str(HERE / "pipeline.py"), "--stage", "audit", "--attempt", "d08"],
    cwd=ROOT,
    check=True,
)
run(
    "negative-stock-d02",
    HERE / "negative_controls.py",
    ["--out", "assets/blend/cities/ulgani/negatives/d02"],
    seconds=900,
)
for group in GROUPS:
    run(
        f"preview-{group}-source-d02",
        HERE / "density_preview.py",
        ["--group", group, "--attempt", "d02"],
        seconds=900,
    )
for group in ["props", "tall", "anchor"]:
    run(
        f"preview-{group}-export-d02",
        HERE / "density_preview.py",
        ["--group", group, "--export", "--attempt", "d02"],
        seconds=900,
    )
run("preview-metric-maps-d01", HERE / "metric_map_sheets.py", [], seconds=300)
