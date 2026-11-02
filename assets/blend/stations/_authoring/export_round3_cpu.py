"""Export saved station sources while the GPU/bake gate is closed.

The normal shared exporter owns validation, compression and writing. This station-only entry point
checks its complete channel/AO bake plan first and refuses any pending bake. It never authors geometry.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import bake, checks, export, materials

original_bake = export._bake
records = []
report = ROOT / "assets/renders/stations/round3/export_bake_preflight.json"


def refuse_pending_bake(rules, family, model, bake_resolution):
    plans = []
    for asset in model.assets:
        for variant in asset.variants.values():
            for material in checks._materials_of(rules, variant):
                info = materials.MaterialInfo(material)
                ao = checks.ao_to_bake(rules, family, variant.cls, info)
                channels = bake.channels_to_bake(info, ao) if info.bsdf is not None else []
                plans.append({"asset": asset.name, "variant": variant.id, "material": material.name,
                              "pending_bakes": channels, "ao_bake_needed": ao})
    records.append({"file": bpy.data.filepath,
                    "source_sha256": hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
                    "plans": plans})
    report.write_text(json.dumps(records, indent=2) + "\n")
    if any(plan["pending_bakes"] for plan in plans):
        raise RuntimeError("Station bake gate is CLOSED; pending bake plan recorded, no bake started.")
    bpy.context.scene.render.threads_mode = "FIXED"
    bpy.context.scene.render.threads = 2
    original_bake(rules, family, model, bake_resolution)


assert os.environ.get("ART_KTX_JOBS") == "2"
export._bake = refuse_pending_bake
args = sys.argv[sys.argv.index("--") + 1:]
raise SystemExit(export.main("stations", args))
