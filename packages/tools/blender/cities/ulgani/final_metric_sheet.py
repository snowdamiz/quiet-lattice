"""One final CPU composite for all 39 saved assets plus current decoded tall/anchor assets."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import sha
from density_preview import main as render
from pipeline import GROUPS, META, ROOT

size = 384
# 39 saved assets plus four decoded tall variants and the decoded root island.
columns = 12
rows = 11
sheet = np.ones((rows * size, columns * size, 4), np.float32)
records = []
sources = []
asset_index = 0
for group, decoded in [(g, False) for g in GROUPS] + [("tall", True), ("anchor", True)]:
    pixels, receipt = render(
        SimpleNamespace(
            group=group, export=decoded, attempt="final", return_pixels=True
        )
    )
    sources.append({"path": receipt["source"], "sha256": receipt["sourceSHA256"]})
    for i in range(0, len(receipt["views"]), 3):
        localrow, localcol = receipt["views"][i]["tileFromTop"]
        block = pixels[
            pixels.shape[0] - (localrow + 1) * size : pixels.shape[0] - localrow * size,
            localcol * size : (localcol + 3) * size,
        ]
        row = asset_index // 4
        col = (asset_index % 4) * 3
        sheet[
            (rows - row - 1) * size : (rows - row) * size, col * size : (col + 3) * size
        ] = block
        for mode in range(3):
            record = dict(receipt["views"][i + mode])
            record.update(
                {
                    "tileFromTop": [row, col + mode],
                    "source": receipt["source"],
                    "sourceSHA256": receipt["sourceSHA256"],
                    "decodedExport": decoded,
                }
            )
            records.append(record)
        asset_index += 1
assert asset_index == 44
output = ROOT / "assets/renders/cities/ulgani-density/full-kit-final-d01.png"
assert not output.exists()
image = bpy.data.images.new(
    "FinalMetricComposite", width=columns * size, height=rows * size, alpha=True
)
image.pixels.foreach_set(sheet.ravel())
image.filepath_raw = str(output)
image.file_format = "PNG"
image.save()
for source in sources:
    assert sha(ROOT / source["path"]) == source["sha256"]
with (META / "density-revision/preview-final-d01.json").open("x") as f:
    json.dump(
        {
            "renderer": "Cycles CPU",
            "threads": 2,
            "samples": {"whole": 24, "closeup": 64},
            "nativeAcceptance": False,
            "sources": sources,
            "views": records,
            "artifacts": [
                {
                    "path": str(output.relative_to(ROOT)),
                    "sha256": sha(output),
                    "bytes": output.stat().st_size,
                    "dimensions": [columns * size, rows * size],
                }
            ],
            "layout": "Each consecutive triplet is LOD0 whole, two-metre LOD0 material closeup, LOD2 whole; four assets per row. Final five triplets are decoded GLBs.",
        },
        f,
        indent=2,
    )
