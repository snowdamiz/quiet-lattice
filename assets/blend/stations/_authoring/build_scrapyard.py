import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy

import common
import sy_kit

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else os.path.join(HERE, "..", "scrapyard.blend")
sc = common.reset()
common.reaches_materials()
common.ref_collection(sc)
sy_kit.build(sc, sc.collection)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out), compress=True)
print("saved", os.path.abspath(out))
