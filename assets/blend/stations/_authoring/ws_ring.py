"""The ring: eight lapped shell vaults on a 140 m wheel, a flat belly under a dorsal shell (Thalune), lattice spokes
from a hub whose two collars mate the spine's. Joint frames between the vaults keep it from reading as a torus."""
import math

import numpy as np
from mathutils import Matrix

import kit as K
import ws_parts as P

RR = 70.0  # ring radius to the section's centre
HUB_L = 16.0


def ring_section(lod):
    """Section in (radial, axial) offsets: a broad dorsal shell outboard, a flat belly inboard (the floor's side)."""
    pts = [(-4.0, -7.0), (-4.5, -3.0), (-4.5, 3.0), (-4.0, 7.0), (-1.0, 8.2), (2.6, 7.4), (4.6, 4.2), (5.2, 0.0), (4.6, -4.2), (2.6, -7.4), (-1.0, -8.2), (-4.0, -7.0)]
    from ws_hangar import catmull
    return catmull(pts, (4, 3, 2, 1)[lod])


def lod3():
    m = K.Mesh()
    sec = np.array([(-4.5, -7.5), (-4.5, 7.5), (2.6, 7.4), (5.2, 0.0), (2.6, -7.4), (-4.5, -7.5)])
    angs = np.linspace(0, 2 * math.pi, 17)
    grid = np.zeros((len(angs), len(sec), 3))
    for i, a in enumerate(angs):
        for j, (rad, ax) in enumerate(sec):
            grid[i, j] = (math.cos(a) * (RR + rad), ax, math.sin(a) * (RR + rad))
    ctr = lambda q: np.array([q[0], 0.0, q[2]]) / max(1e-6, math.hypot(q[0], q[2])) * RR
    K.patch(m, grid, "WS_Shell", "plate", smooth=True, away=ctr)
    K.revolve(m, [(10.6, -HUB_L / 2), (10.6, HUB_L / 2)], 8, "WS_Shell", "accent", axis="y", away=lambda q: np.array([0.0, q[1], 0.0]))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        K.tube(m, [np.array([ca * 10.4, 0, sa * 10.4]), np.array([ca * (RR - 4.4), 0, sa * (RR - 4.4)])], 1.4, 3, "WS_Metal", "lattice", smooth=False, up=(0, 1, 0))
    return m


def build_lod(lod):
    if lod == 3:
        return lod3()
    m = K.Mesh()
    sec = ring_section(lod)
    nseg = 8
    gap = math.radians(3.2)
    steps = (10, 6, 3, 2)[lod]
    for s in range(nseg):
        a0 = s * 2 * math.pi / nseg + gap / 2
        a1 = (s + 1) * 2 * math.pi / nseg - gap / 2
        angs = np.linspace(a0, a1, steps + 1)
        c = K._cum(sec)
        nrow = max(1, int(round(c[-1] / 2.0)))
        edges = np.linspace(0, c[-1], nrow + 1)
        for i in range(nrow):
            ss = np.linspace(edges[i], edges[i + 1], 3 if lod <= 1 else 2)
            pts = np.stack([np.interp(ss, c, sec[:, 0]), np.interp(ss, c, sec[:, 1])], 1)
            f = (edges[i] + edges[i + 1]) / 2 / c[-1]
            key = "accent" if (f < 0.12 or f > 0.88) else ("plate_band" if 0.42 < f < 0.5 else "plate")
            grid = np.zeros((len(angs), len(pts), 3))
            for a_i, a in enumerate(angs):
                ca, sa = math.cos(a), math.sin(a)
                for j, (rad, ax) in enumerate(pts):
                    lap = (0.12 * (1 - j / (len(pts) - 1))) if lod <= 1 else 0.0
                    rr = RR + rad
                    grid[a_i, j] = (ca * rr, ax, sa * rr)
            ctr = lambda q: np.array([q[0], 0.0, q[2]]) / max(1e-6, math.hypot(q[0], q[2])) * RR
            K.patch(m, grid, "WS_Shell", key, smooth=True, u_off=s * 1.9 + i * 0.7, away=ctr)
        # crystal window band on both faces of the vault (the decks look out along the axle)
        if lod <= 2:
            for side in (-1, 1):
                ax = side * 7.2
                wa = np.linspace(a0 + 0.04, a1 - 0.04, steps + 1)
                g = np.zeros((len(wa), 2, 3))
                for k, a in enumerate(wa):
                    g[k, 0] = (math.cos(a) * (RR - 1.4), ax + side * 0.95, math.sin(a) * (RR - 1.4))
                    g[k, 1] = (math.cos(a) * (RR + 1.6), ax + side * 0.62, math.sin(a) * (RR + 1.6))
                K.patch(m, g, "WS_LitGlass", None, toward=lambda q, side=side: q + np.array([0, side * 5.0, 0]))
        # the joint frame: a lattice rib hoop around the section at each gap, standing proud
        a = s * 2 * math.pi / nseg
        hoop = [np.array([math.cos(a) * (RR + p[0] * 1.12), p[1] * 1.12, math.sin(a) * (RR + p[0] * 1.12)]) for p in sec]
        K.tube(m, hoop, 0, 0, "WS_Shell", "rib", smooth=True, up=(-math.sin(a), 0, math.cos(a)), profile=[(-1.4, -0.4), (1.4, -0.4), (1.2, 0.5), (-1.2, 0.5), (-1.4, -0.4)])
        if lod <= 1:
            # radiators off the outboard shell at the joints
            for side in (-1, 1):
                xf = Matrix.Translation((math.cos(a) * (RR + 5.4), side * 3.0, math.sin(a) * (RR + 5.4))) @ Matrix.Rotation(-a, 4, "Y")
                K.box(m, (0.0, -0.15, -3.5), (5.5, 0.15, 3.5), "WS_Metal", "radiator", xf=xf)
    # hub: a lapped drum with the standard collars fore and aft
    hub = [(9.4, -HUB_L / 2 + P.COLLAR_DEPTH), (10.6, -3.0), (10.6, 3.0), (9.4, HUB_L / 2 - P.COLLAR_DEPTH)]
    hn = (36, 24, 12, 8)[lod]
    for i in range(len(hub) - 1):
        K.revolve(m, [hub[i], hub[i + 1]], hn, "WS_Shell", "accent" if i == 1 else "plate", axis="y", away=lambda q: np.array([0.0, q[1], 0.0]))
    col = P.collar_mesh(lod)
    P.place(m, col, (0, -HUB_L / 2 + P.COLLAR_DEPTH, 0), (0, -1, 0))
    P.place(m, col, (0, HUB_L / 2 - P.COLLAR_DEPTH, 0), (0, 1, 0))
    # spokes: four lattice trusses (triangular section) carrying a lift tube
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        r0, r1 = 10.4, RR - 4.4
        if lod == 3:
            K.beam(m, np.array([ca * r0, 0, sa * r0]), np.array([ca * r1, 0, sa * r1]), 2.4, 2.4, "WS_Metal", "lattice", up=(0, 1, 0))
            continue
        tri = [(0.0, 1.6), (-1.4, -0.8), (1.4, -0.8)]
        rails = []
        for (ox, oy) in tri:
            off = np.array([-sa * ox, oy, ca * ox])
            p0 = np.array([ca * r0, 0, sa * r0]) + off
            p1 = np.array([ca * r1, 0, sa * r1]) + off
            rails.append((p0, p1))
            K.tube(m, [p0, p1], 0, 0, "WS_Metal", "lattice", smooth=False, up=(0, 1, 0), profile=[(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3), (-0.3, -0.3)])
        K.tube(m, [np.array([ca * r0, 0, sa * r0]), np.array([ca * r1, 0, sa * r1])], 0.85, 10 if lod == 0 else 6, "WS_Shell", "plate_band", up=(0, 1, 0))
        if lod <= 1:
            nb = 12 if lod == 0 else 6
            for j in range(nb):
                t0, t1 = j / nb, (j + 1) / nb
                for q in range(3):
                    a0p = rails[q][0] + (rails[q][1] - rails[q][0]) * t0
                    b0p = rails[(q + 1) % 3][0] + (rails[(q + 1) % 3][1] - rails[(q + 1) % 3][0]) * t1
                    K.beam(m, a0p, b0p, 0.2, 0.2, "WS_Metal", "lattice", up=(0, 1, 0))
    # nav lights on the rim at the spokes
    if lod <= 2:
        for k in range(8):
            a = k * math.pi / 4
            p = (math.cos(a) * (RR + 5.4), 0.0, math.sin(a) * (RR + 5.4))
            K.revolve(m, [(0.0, 0.0), (0.4, 0.3), (0.4, 0.6)], 8, "NavRed" if k % 2 else "NavWhite", None, center=p, axis="y", away=(0, 0, 0))
    return m


def build(sc, root):
    asset = K.new_collection("ws_ring", root)
    for lod in range(4):
        c = K.new_collection(f"ws_ring_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_ring LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        o = m.build(f"ws_ring_L{lod}", c)
        o["spin_axis"] = [0.0, 1.0, 0.0]
        o["spin_rpm"] = 0.9
    K.collider(asset, "COL_Hub", (-10.6, -HUB_L / 2, -10.6), (10.6, HUB_L / 2, 10.6))
    for k in range(16):
        a = (k + 0.5) * 2 * math.pi / 16
        xf = Matrix.Translation((math.cos(a) * RR, 0, math.sin(a) * RR)) @ Matrix.Rotation(-a, 4, "Y")
        K.collider(asset, f"COL_Rim_{k + 1:02d}", (-4.6, -8.3, -14.0), (5.3, 8.3, 14.0), xf=xf)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        xf = Matrix.Translation((math.cos(a) * (RR / 2 + 3.0), 0, math.sin(a) * (RR / 2 + 3.0))) @ Matrix.Rotation(-a, 4, "Y")
        K.collider(asset, f"COL_Spoke_{k + 1}", (-RR / 2 + 7.0, -1.8, -1.8), (RR / 2 - 7.4, 1.8, 1.8), xf=xf)
    K.empty(asset, "Socket_Aft", (0, -HUB_L / 2, 0), rot=P.socket_rotation((0, -1, 0)), size=4.0, props={"interface": "collar"})
    K.empty(asset, "Socket_Fore", (0, HUB_L / 2, 0), size=4.0, props={"interface": "collar"})
    return asset
