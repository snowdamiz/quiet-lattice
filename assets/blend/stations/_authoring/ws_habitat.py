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
        f = i / nrow
        key = "accent" if f < 0.12 else ("plate_band" if i == 1 else "plate")
        K.revolve(m, seg, n, "WS_Shell", key, axis="y", away=lambda q: np.array([0.0, q[1], 0.0]), u_off=i * 1.3)
    # Individual crystal inserts sit in socket collars rather than a continuous glass ribbon.
    for row, y in enumerate((6.0, 12.0, 18.0)):
        r = float(np.interp(y, prof[:, 1], prof[:, 0]))
        for k in range(12):
            a = (k + 0.5) * math.pi / 6
            nrm = (math.cos(a), 0, math.sin(a))
            K.crystal_insert(m, (nrm[0] * (r + 0.05), y, nrm[2] * (r + 0.05)), nrm, (-math.sin(a), 0, math.cos(a)), 3.1, 1.4, lod, seed=row * 12 + k)
    # ribs radiating from the cap's tip down to the collar: the scallop
    if lod <= 2:
        nr = 16
        for k in range(nr):
            a = 2 * math.pi * k / nr
            pts = [np.array([math.cos(a) * (r + 0.35), y, math.sin(a) * (r + 0.35)]) for r, y in K.resample(prof, 1.5 if lod == 0 else 3.0)]
            pts = pts[:-1]
            K.tube(m, pts, 0, 0, "WS_Shell", "rib", smooth=True, up=(math.cos(a), 0, math.sin(a)), profile=[(-0.55, -0.1), (-0.42, 0.3), (0.0, 0.5), (0.42, 0.3), (0.55, -0.1)])
    # a lattice girdle at the widest point with antenna mast and radiators
    if lod <= 2:
        sq = [(-0.25, -0.25), (0.25, -0.25), (0.25, 0.25), (-0.25, 0.25), (-0.25, -0.25)]
        for y in (8.0, 15.0):
            ring = [np.array([math.cos(a) * 11.9, y, math.sin(a) * 11.9]) for a in np.linspace(0, 2 * math.pi, 25)]
            K.chord(m, ring, 0.25, "WS_Metal", "lattice", lod, nodes=range(0,25,2), up=(0, 1, 0), sub=0)
        for k in range(12):
            a0, a1 = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
            K.member(m, (math.cos(a0) * 11.9, 8.0, math.sin(a0) * 11.9), (math.cos(a1) * 11.9, 15.0, math.sin(a1) * 11.9), 0.18, "WS_Metal", "lattice", lod, bow_dir=(math.cos(a0), 0, math.sin(a0)))
        K.tube(m, [(0, 29.6, 0), (0, 36.0, 0)], 0.18, 6, "WS_Metal", "trim")
        for s in (-1, 1):
            for k, dz in enumerate((-2.4, 0.0, 2.4)):
                x0, x1 = s * 12.2, s * (12.2 + 6.0 - abs(dz) * 0.6)
                K.box(m, (min(x0, x1), 9.0, dz - 0.09), (max(x0, x1), 14.0, dz + 0.09), "WS_Metal", "radiator", keys={"+y": "trim", "-y": "trim"})
            K.beam(m, np.array([s * 11.6, 11.5, -3.0]), np.array([s * 11.6, 11.5, 3.0]), 0.5, 0.5, "WS_Metal", "lattice", up=(1, 0, 0))
    K.revolve(m, [(0.0, 36.6), (0.3, 36.2), (0.3, 35.9)], 8, "NavRed", None, axis="y", away=(0, 30, 0))
    col = P.collar_mesh(lod)
    P.place(m, col, (0, 0, 0), (0, -1, 0))
    # the hatch inside the collar (the habitat is sealed until a corridor mates)
    hz = (24, 16, 8)[min(lod, 2)]
    K.revolve(m, [(6.25, 0.6), (5.6, 0.75), (0.0, 0.75)], hz, "WS_Metal", "machine", axis="y", away=(0, 3.0, 0))
    if lod <= 1:
        for k in range(6):
            a = k * math.pi / 3
            K.beam(m, np.array([math.cos(a) * 0.8, 0.7, math.sin(a) * 0.8]), np.array([math.cos(a) * 5.4, 0.7, math.sin(a) * 5.4]), 0.35, 0.12, "WS_Shell", "signal" if k % 2 else "lip", up=(0, -1, 0))
    return m


def build(sc, root):
    asset = K.new_collection("ws_habitat", root)
    for lod in range(4):
        c = K.new_collection(f"ws_habitat_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_habitat LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_habitat_L{lod}", c)
    for k, (y0, y1, r) in enumerate(((-P.COLLAR_DEPTH, 17, 11.4), (17, 25, 9.5), (25, 30, 5.8))):
        K.collider(asset, f"COL_Habitat_{k}", (-r, y0, -r), (r, y1, r))
    K.empty(asset, "Socket_Base", (0, -P.COLLAR_DEPTH, 0), rot=P.socket_rotation((0, -1, 0)), size=4.0, props={"interface": "collar"})
    for i, y in enumerate((6.0, 12.0, 18.0)):
        K.empty(asset, f"Light_Window_{i + 1}", (0, y, 0), size=1.0, props={"color": "#FFF3DE", "intensity": 0.6, "distance": 26.0})
    return asset
