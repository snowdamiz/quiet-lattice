"""Final current-art checks and the last permitted compact CPU image."""

import json
import subprocess

from pipeline import HERE, META, ROOT, run

python = json.loads((META / "density-revision/launchers-and-base.json").read_text())[
    "python"
]["path"]
for script, args in [
    ("verify_density_revision.py", ["--attempt", "d10"]),
    ("pipeline.py", ["--stage", "audit", "--attempt", "d10"]),
]:
    subprocess.run([python, str(HERE / script), *args], cwd=ROOT, check=True)
run(
    "negative-stock-d03",
    HERE / "negative_controls.py",
    ["--out", "assets/blend/cities/ulgani/negatives/d03"],
    seconds=900,
)
run("preview-full-final-d01", HERE / "final_metric_sheet.py", [], seconds=1200)
