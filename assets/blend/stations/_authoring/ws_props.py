"""Props for the hangar and the trade deck (DESIGN 19.3): the Compact cargo pod and the pad-side refuel post. Props take
the class's 1k textures, so they paint from WS_Prop, the props' own sheet at the kit's 256 px/m."""
import math

import numpy as np
from mathutils import Matrix

import kit as K

P = "WS_Prop"
EDGE = (P, "lip")


def ellipse(rx, rz, cz, n, a0=-math.pi / 2):
    return np.array([(math.cos(a) * rx, cz + math.sin(a) * rz) for a in np.linspace(a0, a0 + 2 * math.pi, n + 1)])


def dome(m, x, s, rx, rz, cz, n, rings, key, bulge=0.2):
    """An end cap: a dome of `rings` rings from the body's rim to its crown, standing `bulge` m proud along x."""
    prof = []
    for i in range(rings + 1):
        t = i / rings
        a = t * math.pi / 2
        prof.append((math.cos(a), x + s * math.sin(a) * bulge))
    ang = np.linspace(-math.pi / 2, 3 * math.pi / 2, n + 1)
    grid = np.zeros((n + 1, len(prof), 3))
    for i, q in enumerate(ang):
        for j, (f, xx) in enumerate(prof):
            grid[i, j] = (xx, math.cos(q) * rx * f, cz + math.sin(q) * rz * f)
    K.patch(m, grid, P, key, smooth=True, away=(x - s * 2.0, 0.0, cz))


def cargo_pod(lod):
    """A 3.2 x 2.0 x 2.0 m pod: a lapped shell capsule on skids under three hoop straps, domed caps, a hatch with two latches
    on one cap, lifting eyes, handholds worn bright."""
    m = K.Mesh()
    rx, rz, cz = 0.95, 0.85, 1.1
    if lod == 3:
        sec = ellipse(rx, rz, cz, 8)
        for i in range(8):
            K.patch(m, [[(-1.5, sec[i][0], sec[i][1]), (-1.5, sec[i + 1][0], sec[i + 1][1])], [(1.5, sec[i][0], sec[i][1]), (1.5, sec[i + 1][0], sec[i + 1][1])]], P, "plate" if i > 2 else "accent", away=(0.0, 0.0, cz))
        for x, s in ((-1.5, -1), (1.5, 1)):
            m.add([(x, p[0], p[1]) for p in sec[:-1]], [(0.0, 0.5)] * 8, P, False, away=(-s * 5.0, 0.0, cz))
        return m
    n = (48, 28, 16)[lod]
    sec = ellipse(rx, rz, cz, n)
    K.lapped_rows(m, sec, -1.45, 1.45, P, lambda i: "accent" if i < 3 or i > 10 else ("signal" if i == 7 else "plate"), row=0.42, lap=0.025 if lod <= 1 else 0.0, lod=min(lod, 2), seed=31, axis="x", away=(0.0, 0.0, cz), ny=3 if lod == 0 else 1, seg_m=(0.08, 0.16)[min(lod, 1)], edge_mat=EDGE)
    for x, s in ((-1.45, -1), (1.45, 1)):
        dome(m, x, s, rx, rz, cz, n, (5, 3, 1)[lod], "accent", bulge=0.22)
    # hoop straps: the frame the shell laps over, smooth at walking distance
    hs = (48, 28, 16)[lod]
    for x in (-1.0, 0.0, 1.0):
        hoop = [np.array([x, math.cos(a) * (rx + 0.05), cz + math.sin(a) * (rz + 0.05)]) for a in np.linspace(0, 2 * math.pi, hs + 1)]
        prof = [(-0.08, -0.02), (-0.06, 0.05), (0.0, 0.075), (0.06, 0.05), (0.08, -0.02)] if lod <= 1 else [(-0.08, 0.0), (0.0, 0.07), (0.08, 0.0)]
        K.tube(m, hoop, 0, 0, P, "rib", smooth=True, up=(1, 0, 0), profile=prof)
    # skids with rounded runners and four feet
    for y in (-0.55, 0.55):
        K.tube(m, [(-1.55, y, 0.16), (1.55, y, 0.16)], 0, 0, P, "machine", smooth=lod <= 1, up=(0, 0, 1), caps=True, profile=[(-0.12, -0.14), (0.12, -0.14), (0.14, 0.0), (0.12, 0.12), (-0.12, 0.12), (-0.14, 0.0), (-0.12, -0.14)])
        for x in (-1.2, 1.2):
            K.revolve(m, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.04), (0.1, 0.08)], (16, 10, 6)[lod], P, "trim", center=(x, y, 0.0), axis="z", away=(x, y, 1.0))
    if lod <= 1:
        # the hatch on the +x cap: a raised rim, a seal of worn metal, two latches and a pull handle
        hx = 1.45 + 0.2
        K.revolve(m, [(0.5, 0.0), (0.5, 0.05), (0.44, 0.06), (0.0, 0.06)], (32, 16)[lod], P, "lip", center=(hx - 0.03, 0.0, cz), axis="x", away=(hx - 1.0, 0.0, cz))
        for z in (cz + 0.3, cz - 0.3):
            K.box(m, (hx + 0.02, 0.38, z - 0.06), (hx + 0.1, 0.62, z + 0.06), P, "trim")
            xf = Matrix.Translation((hx + 0.1, 0.5, z)) @ Matrix.Rotation(0.4, 4, "X")
            K.box(m, (0.0, -0.02, -0.12), (0.05, 0.02, 0.12), P, "rail", xf=xf)
        K.tube(m, [(hx + 0.03, -0.18, cz - 0.05), (hx + 0.14, -0.18, cz - 0.05), (hx + 0.14, 0.18, cz - 0.05), (hx + 0.03, 0.18, cz - 0.05)], 0.025, (8, 6)[lod], P, "rail", up=(0, 0, 1))
        # handholds at the -x end, polished where hands go
        K.tube(m, [(-1.6, -0.45, 1.3), (-1.74, -0.45, 1.3), (-1.74, 0.45, 1.3), (-1.6, 0.45, 1.3)], 0.03, (8, 6)[lod], P, "rail", up=(0, 0, 1))
        for y in (-0.45, 0.45):
            K.revolve(m, [(0.06, 0.0), (0.06, 0.03), (0.0, 0.03)], 8, P, "trim", center=(-1.62, y, 1.3), axis="x", away=(-1.0, y, 1.3))
    if lod == 0:
        # lifting eyes on the crown, latches on each strap
        for x in (-1.0, 1.0):
            for y in (-0.35, 0.35):
                ring = [np.array([x + math.cos(a) * 0.09, y, cz + rz + 0.14 + math.sin(a) * 0.09]) for a in np.linspace(0, 2 * math.pi, 13)]
                K.tube(m, ring, 0.022, 6, P, "trim", up=(0, 1, 0))
        for x in (-1.0, 0.0, 1.0):
            for s in (-1, 1):
                xf = Matrix.Translation((x, s * (rx + 0.1), cz)) @ Matrix.Rotation(0.0, 4, "Z")
                K.box(m, (-0.11, -0.04 if s > 0 else -0.02, -0.12), (0.11, 0.02 if s > 0 else 0.04, 0.12), P, "machine", xf=xf)
                K.box(m, (-0.03, -0.05 if s > 0 else 0.03, -0.1), (0.03, -0.03 if s > 0 else 0.05, 0.16), P, "rail", xf=xf)
    return m


def refuel_post(lod):
    """The pad-side refuel post: a ribbed pillar on a bolted base, a hose wound on a flanged reel with a crank, the hose
    hanging in a loop to a nozzle in its holster, a latched service panel, a thin status line round the top."""
    m = K.Mesh()
    n = (40, 24, 12)[min(lod, 2)]
    if lod == 3:
        K.revolve(m, [(0.42, 0.0), (0.3, 0.3), (0.3, 1.7), (0.0, 1.85)], 6, P, "plate", axis="z", away=lambda q: np.array([0, 0, q[2]]))
        K.box(m, (-0.2, 0.32, 0.85), (0.2, 0.62, 1.3), P, "machine")
        return m
    up = lambda q: np.array([0, 0, q[2]])
    K.revolve(m, [(0.45, 0.0), (0.45, 0.1), (0.38, 0.16), (0.31, 0.24)], n, P, "lip", axis="z", away=up)
    K.revolve(m, [(0.31, 0.24), (0.3, 1.0)], n, P, "accent", axis="z", away=up)
    K.revolve(m, [(0.3, 1.0), (0.28, 1.5)], n, P, "plate", axis="z", away=up)
    K.revolve(m, [(0.28, 1.5), (0.285, 1.52), (0.285, 1.58), (0.28, 1.6)], n, P, "light", axis="z", away=up)
    K.revolve(m, [(0.28, 1.6), (0.37, 1.68), (0.33, 1.78), (0.18, 1.84), (0.0, 1.86)], n, P, "accent", axis="z", away=lambda q: np.array([0, 0, q[2] - 0.5]))
    if lod <= 2:
        nr = (8, 6, 4)[lod]
        for k in range(nr):
            a = 2 * math.pi * k / nr + 0.3
            K.tube(m, [(math.cos(a) * 0.3, math.sin(a) * 0.3, 0.26), (math.cos(a) * 0.285, math.sin(a) * 0.285, 1.48)], 0, 0, P, "rib", smooth=True, up=(math.cos(a), math.sin(a), 0), profile=[(-0.035, 0.0), (0.0, 0.03), (0.035, 0.0)])
    if lod <= 1:
        for k in range(6):
            a = 2 * math.pi * k / 6
            K.revolve(m, [(0.035, 0.1), (0.035, 0.13), (0.0, 0.14)], 8, P, "trim", center=(math.cos(a) * 0.4, math.sin(a) * 0.4, 0.0), axis="z", away=(math.cos(a) * 0.4, math.sin(a) * 0.4, 0.0))
    # the reel on the +Y side: two arms from the pillar, an axle along X, a drum between flanges, a crank
    ry, rz = 0.5, 1.12
    for x in (-0.24, 0.24):
        K.tube(m, [(x, 0.2, rz + 0.12), (x, ry, rz)], 0, 0, P, "machine", smooth=False, up=(1, 0, 0), caps=True, profile=[(-0.025, -0.05), (0.025, -0.05), (0.025, 0.05), (-0.025, 0.05), (-0.025, -0.05)])
    rs = (32, 20, 10)[min(lod, 2)]
    K.revolve(m, [(0.17, -0.19), (0.17, 0.19)], rs, P, "trim", center=(0.0, ry, rz), axis="x", away=(0.0, ry, rz))
    for x, s in ((-0.2, -1), (0.2, 1)):
        K.revolve(m, [(0.05, x), (0.33, x), (0.34, x + s * 0.015), (0.33, x + s * 0.03), (0.05, x + s * 0.03)], rs, P, "accent", center=(0.0, ry, rz), axis="x", away=lambda q, s=s: np.array([q[0] - s, ry, rz]))
    K.revolve(m, [(0.03, -0.29), (0.03, 0.29)], 8, P, "trim", center=(0.0, ry, rz), axis="x", away=(0.0, ry, rz))
    if lod <= 1:
        K.tube(m, [(0.29, ry, rz), (0.29, ry + 0.16, rz + 0.1), (0.33, ry + 0.16, rz + 0.1)], 0.02, 6, P, "trim", up=(1, 0, 0))
        K.tube(m, [(0.33, ry + 0.16, rz + 0.1), (0.42, ry + 0.16, rz + 0.1)], 0.028, 8, P, "rail", up=(0, 0, 1), caps=True)
    # the hose wound on the drum, then hanging in a loop to the nozzle's holster on the pillar's front (-Y)
    hr = 0.025
    if lod <= 1:
        turns, per = 3.5, (22, 12)[lod]
        pts = []
        for i in range(int(turns * per) + 1):
            a = i / per * 2 * math.pi
            pts.append((-0.16 + 0.32 * i / (turns * per), ry + math.cos(a) * (0.17 + hr), rz + math.sin(a) * (0.17 + hr)))
        K.tube(m, pts, hr, (6, 5)[lod], P, "hose", up=(1, 0, 0))
        tail = pts[-1]
    else:
        K.revolve(m, [(0.2, -0.17), (0.2, 0.17)], 8, P, "hose", center=(0.0, ry, rz), axis="x", away=(0.0, ry, rz))
        tail = (0.16, ry, rz - 0.2)
    loop = [tail, (0.17, ry + 0.06, rz - 0.3), (0.2, ry + 0.1, 0.6), (0.24, ry - 0.05, 0.3), (0.3, 0.1, 0.32), (0.34, -0.25, 0.55), (0.24, -0.4, 0.82), (0.12, -0.42, 0.92)]
    loop = K.resample(np.array(loop), (0.06, 0.12, 0.3)[min(lod, 2)])
    K.tube(m, loop, hr, (6, 5, 4)[min(lod, 2)], P, "hose", up=(0, 0, 1))
    # the nozzle: a grip with a trigger guard and a spout, seated in its holster
    nz = np.array([0.0, -0.42, 0.95])
    K.box(m, (-0.14, -0.38, 0.82), (0.14, -0.3, 1.12), P, "machine")
    K.tube(m, [nz + [0.12, 0, 0], nz + [-0.08, 0, 0.04]], 0.04, (10, 7, 5)[min(lod, 2)], P, "accent", up=(0, 0, 1), caps=True)
    K.tube(m, [nz + [-0.08, 0, 0.04], nz + [-0.22, 0, 0.0], nz + [-0.3, 0, -0.08]], 0.018, (8, 6, 4)[min(lod, 2)], P, "trim", up=(0, 0, 1), caps=True)
    if lod <= 1:
        K.tube(m, [nz + [0.08, 0, -0.03], nz + [0.06, 0, -0.12], nz + [-0.05, 0, -0.1], nz + [-0.07, 0, -0.02]], 0.012, 6, P, "rail", up=(0, 1, 0))
        # a latched service panel on the -X side
        K.box(m, (-0.31, -0.16, 0.4), (-0.27, 0.16, 0.85), P, "machine")
        for z in (0.48, 0.77):
            K.box(m, (-0.335, 0.08, z - 0.03), (-0.305, 0.14, z + 0.03), P, "trim")
        K.tube(m, [(-0.31, -0.08, 0.6), (-0.36, -0.08, 0.6), (-0.36, -0.08, 0.68), (-0.31, -0.08, 0.68)], 0.012, 6, P, "rail", up=(1, 0, 0))
    return m


def build(sc, root):
    for name, fn, col in (("ws_cargopod", cargo_pod, ((-1.75, -1.0, 0.0), (1.9, 1.0, 1.95))), ("ws_refuelpost", refuel_post, ((-0.45, -0.5, 0.0), (0.45, 0.85, 1.86)))):
        asset = K.new_collection(name, root)
        for lod in range(4):
            c = K.new_collection(f"{name}_LOD{lod}", asset)
            m = fn(lod)
            print(f"{name} LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
            m.build(f"{name}_L{lod}", c)
        K.collider(asset, f"COL_{name.split('_')[1].capitalize()}", *col)
        K.empty(asset, "Socket_" + name.split("_")[1].capitalize() + "Floor", (0, 0, 0), size=0.5, props={"interface": "place"})
        if name == "ws_refuelpost":
            K.empty(asset, "Interact_Refuel", (0.0, -0.55, 0.95), size=0.2)
