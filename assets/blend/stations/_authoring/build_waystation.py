import importlib
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy

import common

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else os.path.join(HERE, "..", "waystation.blend")
only = argv[1].split(",") if len(argv) > 1 else ["hangar", "baydoor", "tradedeck", "fabricator", "spine", "ring", "habitat", "props"]
sc = common.reset()
common.compact_materials()
common.ref_collection(sc)
for name in only:
    mod = importlib.import_module("ws_" + name)
    mod.build(sc, sc.collection)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out), compress=True)
print("saved", os.path.abspath(out))
