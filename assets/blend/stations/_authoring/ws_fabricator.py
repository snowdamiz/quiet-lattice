"""The fabricator terminal (DESIGN 15.7): a crystal print chamber under a lapped Compact hood, a console at 1.1 m.
Origin on the floor at the kiosk's centre, the console toward -Y; its user stands 1.2 m in front (STATION_FABRICATOR)."""
import math

import numpy as np
from mathutils import Matrix

import kit as K


def build_lod(lod):
    m = K.Mesh()
    seg = (32, 18, 12, 6)[lod]
    if lod == 3:
        K.box(m, (-1.3, -0.9, 0.0), (1.3, 0.9, 2.2), "WS_Prop", "plate", keys={"+z": "plate"})
        K.patch(m, [[(-0.95, -0.7, 2.2), (0.0, -0.7, 2.78), (0.95, -0.7, 2.2)], [(-0.95, 1.0, 2.3), (0.0, 1.0, 2.9), (0.95, 1.0, 2.3)]], "WS_Prop", "plate", away=(0, 0, 1.5))
        return m
    # plinth: deep blue base with a worn kick strip where boots stand
    K.box(m, (-1.3, -0.9, 0.0), (1.3, 0.9, 0.22), "WS_Prop", "accent", keys={"+z": "lip"})
    if lod <= 2:
        K.box(m, (-1.25, -0.95, 0.0), (1.25, -0.88, 0.12), "WS_Prop", "lip")
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
    K.tube(m, [p + np.array([0, 0, 0.12]) for p in collar], 0, 0, "WS_Prop", "machine", smooth=False, up=(0, 0, 1), profile=[(-0.12, -0.12), (0.12, -0.12), (0.12, 0.12), (-0.12, 0.12), (-0.12, -0.12)])
    collar2 = [p + np.array([lean, 0.02, 0.3 + h]) for p in collar]
    K.tube(m, collar2, 0, 0, "WS_Prop", "machine", smooth=False, up=(0, 0, 1), profile=[(-0.08, -0.08), (0.08, -0.08), (0.08, 0.08), (-0.08, 0.08), (-0.08, -0.08)])
    # inside: the print bed and the nozzle gantry
    if lod <= 1:
        K.revolve(m, [(0.42, 0.62), (0.42, 0.7), (0.0, 0.7)], seg, "WS_Prop", "trim", center=(c[0], c[1], 0.0), axis="z", away=(c[0], c[1], 0.0))
        K.box(m, (c[0] - 0.45, c[1] - 0.03, 1.25), (c[0] + 0.45, c[1] + 0.03, 1.31), "WS_Prop", "trim")
        K.box(m, (c[0] - 0.05, c[1] - 0.06, 1.0), (c[0] + 0.05, c[1] + 0.06, 1.25), "WS_Prop", "machine")
        K.revolve(m, [(0.05, 1.0), (0.0, 0.92)], 8, "NavWhite", None, center=(c[0], c[1], 0.0), axis="z", away=(c[0], c[1], 2.0))
    # the hood: a lapped shell over the chamber, radiating ribs from a hinge at the back
    prof = np.array([(-0.95, 2.2), (-0.6, 2.62), (0.0, 2.78), (0.6, 2.62), (0.95, 2.2)])
    from ws_hangar import catmull
    hood = catmull(prof, (6, 3, 1, 1)[lod])
    K.lapped_rows(m, hood, -0.7, 1.0, "WS_Prop", lambda i: "accent" if i in (0, 5) else "plate", row=0.35 if lod <= 1 else 1.0, lap=0.03 if lod <= 1 else 0.0, lod=min(lod, 2), seed=41, ny=6 if lod == 0 else 2, edge_mat=("WS_Prop", "lip"), seg_m=0.12, away=(0, 0.15, 1.5))
    K.patch(m, [[(p[0], 1.0, p[1] - 0.02) for p in hood], [(p[0] * 0.6, 1.0, 2.1) for p in hood]], "WS_Prop", "machine", toward=(0, 5, 2.3))
    K.patch(m, [[(p[0], -0.7, p[1]) for p in hood], [(p[0] * 0.6, -0.7, 2.1) for p in hood]], "WS_Prop", "accent", toward=(0, -5, 2.3))
    K.tube(m, [np.array([p[0], -0.72, p[1] + 0.02]) for p in hood], 0, 0, "WS_Prop", "signal", smooth=True, up=(0, -1, 0), profile=[(-0.03, -0.03), (0.03, -0.03), (0.03, 0.03), (-0.03, 0.03), (-0.03, -0.03)])
    if lod <= 1:
        # ribs radiating from a hinge at the back of the hood, lying on its rows (the scallop)
        hz = lambda x: float(np.interp(x, hood[:, 0], hood[:, 1]))
        for k in range(7):
            x = -0.84 + k * 0.28
            pts = []
            for t in np.linspace(0.0, 1.0, 8 if lod == 0 else 4):
                px = x * (0.25 + 0.75 * t)
                pts.append(np.array([px, 0.95 - 1.62 * t, hz(px) + 0.05]))
            K.tube(m, pts, 0, 0, "WS_Prop", "rib", smooth=True, up=(0, 0, 1), profile=[(-0.05, -0.02), (-0.035, 0.03), (0.0, 0.045), (0.035, 0.03), (0.05, -0.02)])
    # two pillars carry the hood: lattice members fused at the base
    for x in (-0.95, 0.95):
        K.member(m, (x, 0.85, 0.22), (x, 0.85, 2.3), 0.10, "WS_Prop", "rib", lod, bow_dir=(1, 0, 0))
        K.member(m, (x, -0.6, 1.1), (x, 0.85, 2.25), 0.065, "WS_Prop", "rib", lod, bow_dir=(1, 0, 0))
    # material hoppers at the sides and conduits into the deck
    for s in (-1, 1):
        if lod <= 1:
            hop = [(-0.28, -0.32), (0.28, -0.32), (0.32, -0.26), (0.32, 0.26), (0.28, 0.32), (-0.28, 0.32), (-0.32, 0.26), (-0.32, -0.26), (-0.28, -0.32)]
            K.tube(m, [np.array([s * 1.0, 0.42, 0.22]), np.array([s * 1.0, 0.42, 1.0]), np.array([s * 1.0, 0.42, 1.3])], 0, 0, "WS_Prop", "machine", smooth=False, up=(0, 1, 0), caps=True, profile=hop)
            for z in (0.5, 0.8, 1.1):
                K.box(m, (s * 1.0 - 0.34, 0.08, z), (s * 1.0 + 0.34, 0.76, z + 0.04), "WS_Prop", "trim")
            for k in range(3):
                K.tube(m, [(s * (0.7 + k * 0.08), 0.95, 2.2), (s * (0.7 + k * 0.08), 1.05, 1.6), (s * (0.75 + k * 0.08), 1.1, 0.3), (s * (0.75 + k * 0.08), 1.05, 0.0)], 0.03, 6, "WS_Prop", "hose")
        else:
            K.box(m, (s * 1.0 - 0.28, 0.1, 0.22), (s * 1.0 + 0.28, 0.75, 1.3), "WS_Prop", "machine", u_off=s * 0.4)
        if lod <= 1:
            K.tube(m, [(s * 1.0, 0.85, 1.0), (s * 1.0, 1.1, 0.8), (s * 0.9, 1.15, 0.0)], 0.07, 8 if lod == 0 else 5, "WS_Prop", "hose")
    # the console: an angled panel at 1.1 m with a lit screen strip and a polished hand rail
    xf = Matrix.Translation((0.0, -0.62, 1.0)) @ Matrix.Rotation(math.radians(-32), 4, "X")
    K.box(m, (-0.7, -0.05, -0.02), (0.7, 0.42, 0.06), "WS_Prop", "machine", xf=xf)
    K.box(m, (-0.5, 0.06, 0.06), (0.5, 0.34, 0.075), "WS_Prop", "light", xf=xf)
    K.box(m, (-0.72, -0.72, 0.22), (0.72, -0.5, 1.0), "WS_Prop", "plate", keys={"-y": "plate"})
    if lod <= 1:
        K.tube(m, [(-0.72, -0.8, 0.98), (0.72, -0.8, 0.98)], 0.025, 8 if lod == 0 else 5, "WS_Prop", "rail", caps=True)
    if lod <= 1:
        # Access latches and loop handles follow the service panels' edges.
        for side in (-1, 1):
            for z in (0.4, 0.75):
                K.revolve(m, [(0.045, 0), (0.045, 0.035), (0, 0.04)], 12 if lod == 0 else 6, "WS_Prop", "trim", center=(side * 0.58, -0.73, z), axis="y")
            K.tube(m, [(side * 1.17, -0.25, 0.6), (side * 1.31, -0.25, 0.6), (side * 1.31, 0.15, 0.6), (side * 1.17, 0.15, 0.6)], 0.035, 10 if lod == 0 else 6, "WS_Prop", "trim")
    return m


def build(sc, root):
    asset = K.new_collection("ws_fabricator", root)
    asset["asset_class"] = "prop"
    for lod in range(4):
        c = K.new_collection(f"ws_fabricator_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_fabricator LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_fabricator_L{lod}", c)
    K.collider(asset, "COL_Fabricator", (-1.3, -0.95, 0.0), (1.3, 1.2, 2.8))
    K.empty(asset, "Interact_Fabricator", (0.0, -0.75, 1.15), size=0.3)
    K.empty(asset, "Socket_Floor", (0, 0, 0), size=0.6, props={"interface": "place", "use": [0.0, -1.2, 0.0]})
    return asset
