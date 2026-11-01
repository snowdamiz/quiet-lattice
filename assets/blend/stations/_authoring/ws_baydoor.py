"""The hangar's bay door: ten lapped shell leaves on staggered tracks. Each leaf slides along X by its `open_x` into the
hood's pockets at the jambs, so the 130 m mouth clears completely. The door's frame is the hangar's frame translated to
Socket_BayDoor (its Socket_Mount faces +Y, back into the hall)."""
import math

import bpy
import numpy as np

import kit as K

W, H = 13.4, 42.6
LAP = 0.4


def leaf(m, x0, y, lod, flip_side):
    x1 = x0 + W
    rows = 14  # the same rows at every LOD, so the blue base and the band never move; LOD2+ only drop the laps
    if lod == 3:
        zb = H / rows
        K.patch(m, [[(x0, y, 0), (x0, y, zb)], [(x1, y, 0), (x1, y, zb)]], "WS_Shell", "accent", toward=lambda c: c + np.array([0, -5.0, 0]))
        K.patch(m, [[(x0, y, zb), (x0, y, H)], [(x1, y, zb), (x1, y, H)]], "WS_Shell", "plate", toward=lambda c: c + np.array([0, -5.0, 0]))
        K.patch(m, [[(x0, y + 0.45, 0), (x0, y + 0.45, H)], [(x1, y + 0.45, 0), (x1, y + 0.45, H)]], "WS_Metal", "machine", toward=lambda c: c + np.array([0, 5.0, 0]))
        return
    zs = np.linspace(0.0, H, rows + 1)
    for i in range(rows):
        z0, z1 = zs[i], zs[i + 1]
        lap = 0.18 if lod <= 1 else 0.0
        key = "accent" if i == 0 else ("plate_band" if i == 7 else "plate")
        grid = [[(x0, y - lap, z0), (x0, y, z1)], [(x1, y - lap, z0), (x1, y, z1)]]
        K.patch(m, grid, "WS_Shell", key, u_off=x0 * 0.13 + i * 1.7, toward=lambda c: c + np.array([0, -5.0, 0]))
        if lod <= 1:
            K.patch(m, [[(x0, y, z0), (x0, y - lap, z0)], [(x1, y, z0), (x1, y - lap, z0)]], "WS_Shell", "lip", toward=lambda c: c + np.array([0, 0, -5.0]), t_range=(0, 0.2))
    # the back face, the leading edges and the top
    K.patch(m, [[(x0, y + 0.45, 0), (x0, y + 0.45, H)], [(x1, y + 0.45, 0), (x1, y + 0.45, H)]], "WS_Metal", "machine", toward=lambda c: c + np.array([0, 5.0, 0]))
    for x in (x0, x1):
        K.patch(m, [[(x, y, 0), (x, y, H)], [(x, y + 0.45, 0), (x, y + 0.45, H)]], "WS_Shell", "signal", away=((x0 + x1) / 2, y, H / 2))
    K.patch(m, [[(x0, y, H), (x0, y + 0.45, H)], [(x1, y, H), (x1, y + 0.45, H)]], "WS_Shell", "lip", toward=lambda c: c + np.array([0, 0, 5.0]))
    if lod == 0:
        # a vertical stiffening rib and guide shoes at the foot, top and middle
        xm = (x0 + x1) / 2
        K.beam(m, np.array([xm, y - 0.35, 0.3]), np.array([xm, y - 0.35, H - 0.3]), 0.7, 0.35, "WS_Shell", "rib", up=(0, -1, 0), bevel=0.1)
        for z in (0.0, H / 2, H - 0.8):
            K.box(m, (x0 + 0.6, y + 0.45, z), (x1 - 0.6, y + 0.9, z + 0.8), "WS_Metal", "trim")
        # warning chevrons on the leading edge at walking height
        e = x1 if not flip_side else x0
        K.box(m, (e - 0.25, y - 0.25, 0.0), (e + 0.25, y + 0.5, 2.6), "WS_Shell", "signal")


def build(sc, root):
    asset = K.new_collection("ws_baydoor", root)
    for lod in range(4):
        c = K.new_collection(f"ws_baydoor_LOD{lod}", asset)
        tot = 0
        for side in ("L", "R"):
            for k in range(5):
                m = K.Mesh()
                # leaves overlap like shingles: each inner leaf sits one track further into the hall
                y = 0.3 + (4 - k) * 0.55
                if side == "L":
                    x0 = -65.0 + k * (W - LAP)
                    open_x = -(x0 + 65.0) - W + 0.2 - (4 - k) * 0.3
                else:
                    x0 = 65.0 - W - k * (W - LAP)
                    open_x = (65.0 - (x0 + W)) + W - 0.2 + (4 - k) * 0.3
                leaf(m, x0, y, lod, side == "R")
                tot += m.tris()
                o = m.build(f"Door_Leaf_{side}{k + 1}_L{lod}", c)
                o["open_x"] = round(open_x, 3)
                o["open_seconds"] = 6.0
        print(f"ws_baydoor LOD{lod}: {tot:,} tris")
    for side, sx in (("L", -1), ("R", 1)):
        K.collider(asset, f"COL_BayDoor_{side}", (min(0, 65 * sx), 0.3, 0.0), (max(0, 65 * sx), 3.0, H))
    K.empty(asset, "Socket_Mount", (0, 0, 0), size=6.0, props={"interface": "baydoor"})
    return asset
