import hashlib
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[4]
p = root / "assets/blend/_library.blend"
assert (
    hashlib.sha256(p.read_bytes()).hexdigest()
    == "33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c"
)
bpy.ops.wm.open_mainfile(filepath=str(p), load_ui=False)
print("LIBRARY", [(c.name, len(c.all_objects)) for c in bpy.data.collections])
print("MATERIALS", [m.name for m in bpy.data.materials])
print(
    "REFERENCE",
    [
        (o.name, tuple(o.dimensions))
        for o in bpy.data.objects
        if o.name.startswith("REF")
    ],
)
print("BLENDER", bpy.app.version_string)
