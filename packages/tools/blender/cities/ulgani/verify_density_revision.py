"""Immutable correction checks, sequential and bounded; reads saved sources only."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import GROUPS, HERE, META, ROOT, run

parser = argparse.ArgumentParser()
parser.add_argument("--attempt", required=True)
a = parser.parse_args()
run(
    f"preservation-density-{a.attempt}",
    HERE / "preservation.py",
    ["--attempt", a.attempt],
    seconds=600,
)
output = META / f"density-revision/density-all-{a.attempt}.json"
if output.exists():
    evidence = json.loads(output.read_text())
    assert evidence["status"] == "PASS"
    assert all(
        hashlib.sha256((ROOT / r["path"]).read_bytes()).hexdigest() == r["sha256"]
        for r in evidence["files"]
    )
    print("Reusing exact current immutable density evidence", str(output), flush=True)
else:
    run(
        f"density-all-{a.attempt}",
        HERE / "density.py",
        ["--groups", ",".join(GROUPS), "--out", str(output)],
        seconds=900,
    )
run(
    f"material-all-{a.attempt}",
    HERE / "material_routes.py",
    [
        "--groups",
        ",".join(GROUPS),
        "--out",
        str(META / f"density-revision/material-all-{a.attempt}.json"),
    ],
    seconds=300,
)
run(
    f"negative-density-{a.attempt}",
    HERE / "density_controls.py",
    ["--attempt", a.attempt],
    seconds=300,
)
