import sys, os
sys.dont_write_bytecode = True
HERE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, HERE)
import kit as K
import ws_hangar as H
for lod in (0, 2):
    tot = 0
    for fn in ("build_shell", "build_mouth", "build_back", "build_floor", "build_pads", "build_walls", "build_frame", "build_gantries", "build_exterior_frame", "build_wings", "build_mast", "build_interior_detail", "build_keel", "build_nav", "build_wear"):
        m = K.Mesh()
        getattr(H, fn)(m, lod)
        tot += m.tris()
        print(lod, fn, m.tris())
    print("TOTAL", lod, tot)
