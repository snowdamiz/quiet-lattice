"""A habitat pod: decks inside a ribbed Thalune shell, the ribs radiating from the cap like a scallop's, warm window
bands between them, the standard collar at its base (Socket_Base). 30 m long, 22 m across."""
import math

import numpy as np

import kit as K
import ws_parts as P

L = 30.0


def profile(lod):
    """(radius, y) from the collar's skin to the cap's tip."""
    from ws_hangar import catmull
    pts = [(9.2, 0.0), (10.6, 3.0), (11.0, 9.0), (10.8, 16.0), (9.6, 22.0), (7.0, 26.5), (3.6, 29.2), (0.0, 30.0)]
    return catmull(pts, (3, 2, 1, 1)[lod])


def build_lod(lod):
    m = K.Mesh()
    if lod == 3:
        K.revolve(m, [(9.2, 0.0), (11.0, 9.0), (9.6, 22.0), (0.0, 30.0)], 8, "WS_Shell", "plate", axis="y", away=lambda q: np.array([0.0, q[1], 0.0]))
        P.place(m, P.collar_mesh(3), (0, 0, 0), (0, -1, 0))
        return m
    prof = profile(lod)
    n = (40, 28, 14, 8)[lod]
    c = K._cum(prof)
    nrow = int(round(c[-1] / 2.0))
    edges = np.linspace(0, c[-1], nrow + 1)
    win_rows = {3, 6, 9}
    for i in range(nrow):
        ss = np.linspace(edges[i], edges[i + 1], 3 if lod <= 1 else 2)
        seg = [(float(np.interp(s_, c, prof[:, 0])), float(np.interp(s_, c, prof[:, 1]))) for s_ in ss]
        # rows lap toward the base; the lower edge stands proud
        lap = 0.14 if lod <= 1 else 0.0
        seg = [(r + lap * (1 - k / (len(seg) - 1)), y) for k, (r, y) in enumerate(seg)]
        if i in win_rows and lod <= 2:
            key = None
            K.revolve(m, seg, n, "WS_LitGlass", None, axis="y", away=lambda q: np.array([0.0, q[1], 0.0]), smooth=False)
            continue
        f = i / nrow
        key = "accent" if f < 0.12 else ("plate_band" if i == 1 else "plate")
        K.revolve(m, seg, n, "WS_Shell", key, axis="y", away=lambda q: np.array([0.0, q[1], 0.0]), u_off=i * 1.3)
    # ribs radiating from the cap's tip down to the collar: the scallop
    if lod <= 2:
        nr = (16, 12, 8)[lod]
        for k in range(nr):
            a = 2 * math.pi * k / nr
            pts = [np.array([math.cos(a) * (r + 0.35), y, math.sin(a) * (r + 0.35)]) for r, y in K.resample(prof, 1.5 if lod == 0 else 3.0)]
            pts = pts[:-1]
            K.tube(m, pts, 0, 0, "WS_Shell", "rib", smooth=True, up=(math.cos(a), 0, math.sin(a)), profile=[(-0.55, -0.1), (-0.42, 0.3), (0.0, 0.5), (0.42, 0.3), (0.55, -0.1)])
    # a lattice girdle at the widest point with antenna mast and radiators
    if lod <= 1:
        sq = [(-0.25, -0.25), (0.25, -0.25), (0.25, 0.25), (-0.25, 0.25), (-0.25, -0.25)]
        for y in (8.0, 15.0):
            ring = [np.array([math.cos(a) * 11.9, y, math.sin(a) * 11.9]) for a in np.linspace(0, 2 * math.pi, 25)]
            K.tube(m, ring, 0, 0, "WS_Metal", "lattice", smooth=False, up=(0, 1, 0), profile=sq)
        for k in range(12):
            a0, a1 = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
            K.beam(m, np.array([math.cos(a0) * 11.9, 8.0, math.sin(a0) * 11.9]), np.array([math.cos(a1) * 11.9, 15.0, math.sin(a1) * 11.9]), 0.25, 0.25, "WS_Metal", "lattice", up=(0, 1, 0))
        K.tube(m, [(0, 29.6, 0), (0, 36.0, 0)], 0.18, 6, "WS_Metal", "trim")
        for s in (-1, 1):
            K.box(m, (s * 12.0 - 0.15, 9.0, -3.0), (s * 12.0 + 0.15 + s * 4.0, 14.0, 3.0), "WS_Metal", "radiator")
    K.revolve(m, [(0.0, 36.6), (0.3, 36.2), (0.3, 35.9)], 8, "NavRed", None, axis="y", away=(0, 30, 0))
    col = P.collar_mesh(lod)
    P.place(m, col, (0, 0, 0), (0, -1, 0))
    return m


def build(sc, root):
    asset = K.new_collection("ws_habitat", root)
    for lod in range(4):
        c = K.new_collection(f"ws_habitat_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_habitat LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_habitat_L{lod}", c)
    K.collider(asset, "COL_Habitat", (-11.4, -P.COLLAR_DEPTH, -11.4), (11.4, 30.2, 11.4))
    K.empty(asset, "Socket_Base", (0, -P.COLLAR_DEPTH, 0), rot=P.socket_rotation((0, -1, 0)), size=4.0, props={"interface": "collar"})
    for i, y in enumerate((6.0, 12.0, 18.0)):
        K.empty(asset, f"Light_Window_{i + 1}", (0, y, 0), size=1.0, props={"color": "#FFF3DE", "intensity": 0.6, "distance": 26.0})
    return asset
