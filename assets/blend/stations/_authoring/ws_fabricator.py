"""The fabricator terminal (DESIGN 15.7): a crystal print chamber under a lapped Compact hood, a console at 1.1 m.
Origin on the floor at the kiosk's centre, the console toward -Y; its user stands 1.2 m in front (STATION_FABRICATOR)."""
import math

import numpy as np
from mathutils import Matrix

import kit as K


def build_lod(lod):
    m = K.Mesh()
    seg = (24, 14, 8, 6)[lod]
    if lod == 3:
        K.box(m, (-1.3, -0.9, 0.0), (1.3, 0.9, 2.2), "WS_Shell", "plate_band", keys={"+z": "plate"})
        K.patch(m, [[(-0.95, -0.7, 2.2), (0.0, -0.7, 2.78), (0.95, -0.7, 2.2)], [(-0.95, 1.0, 2.3), (0.0, 1.0, 2.9), (0.95, 1.0, 2.3)]], "WS_Shell", "plate", away=(0, 0, 1.5))
        return m
    # plinth: deep blue base with a worn kick strip where boots stand
    K.box(m, (-1.3, -0.9, 0.0), (1.3, 0.9, 0.22), "WS_Shell", "accent", keys={"+z": "lip"})
    if lod <= 2:
        K.box(m, (-1.25, -0.95, 0.0), (1.25, -0.88, 0.12), "WS_Shell", "lip")
    # the chamber: a leaning hexagonal crystal prism (Ixari) seated in a dark socket collar
    c = np.array([0.15, 0.15, 0.22])
    r, h = 0.62, 1.55
    lean = 0.06
    ring0 = [c + np.array([math.cos(a) * r, math.sin(a) * r * 0.85, 0.3]) for a in np.linspace(0, 2 * math.pi, 7)[:-1] + 0.25]
    ring1 = [p + np.array([lean, 0.02, h]) for p in ring0]
    tip = c + np.array([lean + 0.05, 0.05, 0.3 + h + 0.35])
    for q in range(6):
        q2 = (q + 1) % 6
        K.patch(m, [[ring0[q], ring0[q2]], [ring1[q], ring1[q2]]], "WS_Glass", None, away=c + np.array([0, 0, 1.0]))
        K.patch(m, [[ring1[q], ring1[q2]], [tip, tip]], "WS_Glass", None, away=c + np.array([0, 0, 1.0]))
    collar = [c + np.array([math.cos(a) * (r + 0.12), math.sin(a) * (r + 0.12) * 0.85, 0.0]) for a in np.linspace(0, 2 * math.pi, 7) + 0.25]
    K.tube(m, [p + np.array([0, 0, 0.12]) for p in collar], 0, 0, "WS_Metal", "machine", smooth=False, up=(0, 0, 1), profile=[(-0.12, -0.12), (0.12, -0.12), (0.12, 0.12), (-0.12, 0.12), (-0.12, -0.12)])
    collar2 = [p + np.array([lean, 0.02, 0.3 + h]) for p in collar]
    K.tube(m, collar2, 0, 0, "WS_Metal", "machine", smooth=False, up=(0, 0, 1), profile=[(-0.08, -0.08), (0.08, -0.08), (0.08, 0.08), (-0.08, 0.08), (-0.08, -0.08)])
    # inside: the print bed and the nozzle gantry
    if lod <= 1:
        K.revolve(m, [(0.42, 0.62), (0.42, 0.7), (0.0, 0.7)], seg, "WS_Metal", "trim", center=(c[0], c[1], 0.0), axis="z", away=(c[0], c[1], 0.0))
        K.box(m, (c[0] - 0.45, c[1] - 0.03, 1.25), (c[0] + 0.45, c[1] + 0.03, 1.31), "WS_Metal", "trim")
        K.box(m, (c[0] - 0.05, c[1] - 0.06, 1.0), (c[0] + 0.05, c[1] + 0.06, 1.25), "WS_Metal", "machine")
        K.revolve(m, [(0.05, 1.0), (0.0, 0.92)], 8, "NavWhite", None, center=(c[0], c[1], 0.0), axis="z", away=(c[0], c[1], 2.0))
    # the hood: a lapped shell over the chamber, radiating ribs from a hinge at the back
    prof = np.array([(-0.95, 2.2), (-0.6, 2.62), (0.0, 2.78), (0.6, 2.62), (0.95, 2.2)])
    from ws_hangar import catmull
    hood = catmull(prof, (6, 3, 1, 1)[lod])
    K.lapped_rows(m, hood, -0.7, 1.0, "WS_Shell", lambda i: "accent" if i in (0, 5) else "plate", row=0.35 if lod <= 1 else 1.0, lap=0.03 if lod <= 1 else 0.0, lod=min(lod, 2), seed=41, ny=4 if lod == 0 else 1, away=(0, 0.15, 1.5))
    K.patch(m, [[(p[0], 1.0, p[1] - 0.02) for p in hood], [(p[0] * 0.6, 1.0, 2.1) for p in hood]], "WS_Metal", "machine", toward=(0, 5, 2.3))
    K.patch(m, [[(p[0], -0.7, p[1]) for p in hood], [(p[0] * 0.6, -0.7, 2.1) for p in hood]], "WS_Shell", "signal", toward=(0, -5, 2.3))
    if lod <= 1:
        for k in range(5):
            x = -0.8 + k * 0.4
            K.beam(m, np.array([x * 0.3, 1.0, 2.95]), np.array([x, -0.72, float(np.interp(x, prof[:, 0], prof[:, 1])) + 0.06]), 0.08, 0.06, "WS_Shell", "rib", up=(0, 0, 1))
    # two pillars carry the hood: lattice members fused at the base
    for x in (-0.95, 0.95):
        K.beam(m, np.array([x, 0.85, 0.22]), np.array([x, 0.85, 2.3]), 0.18, 0.18, "WS_Metal", "lattice", up=(1, 0, 0))
        K.beam(m, np.array([x, -0.6, 1.1]), np.array([x, 0.85, 2.25]), 0.12, 0.12, "WS_Metal", "lattice", up=(1, 0, 0))
    # material hoppers at the sides and conduits into the deck
    for s in (-1, 1):
        if lod <= 1:
            hop = [(-0.28, -0.32), (0.28, -0.32), (0.32, -0.26), (0.32, 0.26), (0.28, 0.32), (-0.28, 0.32), (-0.32, 0.26), (-0.32, -0.26), (-0.28, -0.32)]
            K.tube(m, [np.array([s * 1.0, 0.42, 0.22]), np.array([s * 1.0, 0.42, 1.0]), np.array([s * 1.0, 0.42, 1.3])], 0, 0, "WS_Metal", "machine", smooth=False, up=(0, 1, 0), caps=True, profile=hop)
            for z in (0.5, 0.8, 1.1):
                K.box(m, (s * 1.0 - 0.34, 0.08, z), (s * 1.0 + 0.34, 0.76, z + 0.04), "WS_Metal", "trim")
            for k in range(3):
                K.tube(m, [(s * (0.7 + k * 0.08), 0.95, 2.2), (s * (0.7 + k * 0.08), 1.05, 1.6), (s * (0.75 + k * 0.08), 1.1, 0.3), (s * (0.75 + k * 0.08), 1.05, 0.0)], 0.03, 6, "WS_Metal", "pipe")
        else:
            K.box(m, (s * 1.0 - 0.28, 0.1, 0.22), (s * 1.0 + 0.28, 0.75, 1.3), "WS_Metal", "machine", u_off=s * 0.4)
        if lod <= 1:
            K.tube(m, [(s * 1.0, 0.85, 1.0), (s * 1.0, 1.1, 0.8), (s * 0.9, 1.15, 0.0)], 0.07, 8 if lod == 0 else 5, "WS_Metal", "pipe")
    # the console: an angled panel at 1.1 m with a lit screen strip and a polished hand rail
    xf = Matrix.Translation((0.0, -0.62, 1.0)) @ Matrix.Rotation(math.radians(-32), 4, "X")
    K.box(m, (-0.7, -0.05, -0.02), (0.7, 0.42, 0.06), "WS_Metal", "machine", xf=xf)
    K.box(m, (-0.5, 0.06, 0.06), (0.5, 0.34, 0.075), "WS_Metal", "light", xf=xf)
    K.box(m, (-0.72, -0.72, 0.22), (0.72, -0.5, 1.0), "WS_Shell", "plate_band", keys={"-y": "plate_band"})
    if lod <= 1:
        K.tube(m, [(-0.72, -0.8, 0.98), (0.72, -0.8, 0.98)], 0.025, 8 if lod == 0 else 5, "WS_Metal", "rail", caps=True)
    return m


def build(sc, root):
    asset = K.new_collection("ws_fabricator", root)
    asset["asset_class"] = "kit"
    for lod in range(4):
        c = K.new_collection(f"ws_fabricator_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_fabricator LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_fabricator_L{lod}", c)
    K.collider(asset, "COL_Fabricator", (-1.3, -0.95, 0.0), (1.3, 1.2, 2.8))
    K.empty(asset, "Interact_Fabricator", (0.0, -0.75, 1.15), size=0.3)
    K.empty(asset, "Socket_Floor", (0, 0, 0), size=0.6, props={"interface": "place", "use": [0.0, -1.2, 0.0]})
    return asset
