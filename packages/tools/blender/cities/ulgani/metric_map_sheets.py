"""Packed source-map diagnostics, without resaving or regenerating source data."""

import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from audit import core, sha
from pipeline import META, ROOT

artifacts = []
for group, res in [("props", 1024), ("low", 2048), ("anchor", 4096)]:
    source = ROOT / f"assets/blend/cities/ulgani_{group}.blend"
    before = sha(source)
    core.load(source)
    sheet = np.ones((1024, 2048, 4), np.float32)
    maps = []
    for i, channel in enumerate(["BaseColor", "ORM", "Normal", "Emissive"]):
        image = bpy.data.images[f"UlganiMetric_{res}_{channel}"]
        pix = np.empty(res * res * 4, np.float32)
        image.pixels.foreach_get(pix)
        pix = pix.reshape(res, res, 4)
        # Top: the complete periodic tile. Bottom: native 512px detail, no resampling.
        sheet[512:, i * 512 : (i + 1) * 512] = pix[:: res // 512, :: res // 512]
        sheet[:512, i * 512 : (i + 1) * 512] = pix[:512, :512]
        maps.append(
            {
                "name": image.name,
                "size": list(image.size),
                "packedSHA256": __import__("hashlib")
                .sha256(image.packed_file.data)
                .hexdigest(),
            }
        )
    output = ROOT / f"assets/renders/cities/ulgani-density/maps-{res}-d01.png"
    assert not output.exists()
    image = bpy.data.images.new("MetricMapSheet", width=2048, height=1024, alpha=True)
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw = str(output)
    image.file_format = "PNG"
    image.save()
    assert sha(source) == before
    artifacts.append(
        {
            "path": str(output.relative_to(ROOT)),
            "sha256": sha(output),
            "bytes": output.stat().st_size,
            "source": str(source.relative_to(ROOT)),
            "sourceSHA256": before,
            "maps": maps,
            "columns": ["BaseColor", "ORM", "Normal", "Emissive"],
            "rows": ["full periodic tile", "native 512px crop"],
        }
    )
with (META / "density-revision/preview-maps-d01.json").open("x") as f:
    json.dump({"artifacts": artifacts, "nativeAcceptance": False}, f, indent=2)
