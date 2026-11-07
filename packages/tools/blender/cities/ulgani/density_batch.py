"""Resume explicit saved-data revision stages, one bounded Blender job at a time."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import HERE, run

p = argparse.ArgumentParser()
p.add_argument("--groups", required=True)
p.add_argument(
    "--stage",
    choices=["trim", "preview", "polygons", "codec-margin", "bound", "walk"],
    required=True,
)
p.add_argument("--attempt", required=True)
a = p.parse_args()
for group in a.groups.split(","):
    script = {
        "trim": "revise_trims.py",
        "preview": "density_preview.py",
        "polygons": "restore_polygon_normals.py",
        "codec-margin": "codec_density_margin.py",
        "bound": "bound_trim_distortion.py",
        "walk": "patch_walk_wear.py",
    }[a.stage]
    run(
        f"{a.stage}-{group}-density-{a.attempt}",
        HERE / script,
        ["--group", group, "--attempt", a.attempt],
        seconds=1200,
    )
