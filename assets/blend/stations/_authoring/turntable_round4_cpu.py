"""Run the standard studio renderer with its GPU setup replaced by an explicit CPU-only setup.

Camera, lighting, resolution, samples, denoising, sheets and labels remain the shared tool's values.
No shared tool is modified. The executed program is retained so a reviewer can compare the one stanza.
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[4]
shared = ROOT / "packages/tools/blender/turntable.py"
original = shared.read_text()
start = original.index("try:\n    prefs = bpy.context.preferences.addons['cycles'].preferences")
end = original.index("scene.cycles.samples = samples", start)
replacement = "scene.cycles.device = 'CPU'\nscene.render.threads_mode = 'FIXED'\nscene.render.threads = 2\n"
program = original[:start] + replacement + original[end:]
args = sys.argv[sys.argv.index("--") + 1:]
assert args[args.index("--samples") + 1] == "48"
assert args[args.index("--scale") + 1] == "1"
assert "--cycles-device" not in args
base = ROOT / "assets/renders/stations/round4"
executed = base / "standard_turntable_cpu_program.py.txt"
if executed.exists():
    assert executed.read_text() == program
else:
    executed.write_text(program)
    (base / "cpu_studio_program_binding.json").write_text(json.dumps({
        "shared_tool": str(shared.relative_to(ROOT)), "shared_sha256": hashlib.sha256(original.encode()).hexdigest(),
        "executed_program": str(executed.relative_to(ROOT)), "executed_sha256": hashlib.sha256(program.encode()).hexdigest(),
        "replacement": replacement, "removed_gpu_setup": original[start:end],
        "samples": 48, "resolution_scale": 1, "threads": 2, "device": "CPU"}, indent=2) + "\n")


def insist_cpu(scene, *_):
    assert scene.cycles.device == "CPU"
    assert scene.cycles.samples == 48
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2


bpy.app.handlers.render_pre.append(insist_cpu)
exec(compile(program, str(shared), "exec"), {"__name__": "__main__", "__file__": str(shared)})
