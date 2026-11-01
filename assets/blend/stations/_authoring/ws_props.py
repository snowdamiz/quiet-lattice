"""Props for the hangar and the trade deck: the Compact cargo pod and the pad-side refuel post."""
import math

import numpy as np
from mathutils import Matrix

import kit as K


def cargo_pod(lod):
    """A 3.2 x 2.0 x 2.0 m pod: a lapped shell capsule on skids, handholds worn bright, a signal band and a latch."""
    m = K.Mesh()
    n = (20, 12, 8, 6)[lod]
    if lod == 3:
        K.box(m, (-1.5, -0.95, 0.0), (1.5, 0.95, 1.95), "WS_Shell", "plate", keys={"-x": "accent", "+x": "accent"}, skip=("-z",))
        return m
    sec = [(math.cos(a) * 0.95, 1.1 + math.sin(a) * 0.85) for a in np.linspace(-math.pi / 2, 3 * math.pi / 2, n + 1)]
    sec = np.array(sec)
    K.lapped_rows(m, sec, -1.45, 1.45, "WS_Shell", lambda i: "accent" if i < 2 else ("signal" if i == 7 else "plate"), row=0.45 if lod == 0 else 1.0, lap=0.025 if lod <= 1 else 0.0, lod=min(lod, 2), seed=31, axis="x", away=(0.0, 0.0, 1.1), ny=3 if lod == 0 else 1)
    if lod <= 1:
        # rib hoops: the frame the shell laps over
        for x in (-1.0, 0.0, 1.0):
            hoop = [np.array([x, math.cos(a) * 1.0, 1.1 + math.sin(a) * 0.9]) for a in np.linspace(0, 2 * math.pi, (24 if lod == 0 else 12) + 1)]
            K.tube(m, hoop, 0, 0, "WS_Shell", "rib", smooth=True, up=(1, 0, 0), profile=[(-0.08, -0.02), (-0.06, 0.05), (0.0, 0.07), (0.06, 0.05), (0.08, -0.02)])
    for x in (-1.45, 1.45):
        s = 1 if x > 0 else -1
        ring = [np.array([x, p[0], p[1]]) for p in sec[:-1]]
        c0 = np.array([x, 0.0, 1.1])
        mid = [c0 + (q - c0) * 0.72 + np.array([s * 0.1, 0, 0]) for q in ring]
        tip = c0 + np.array([s * 0.17, 0, 0])
        for k in range(len(ring)):
            k2 = (k + 1) % len(ring)
            K.patch(m, [[ring[k], ring[k2]], [mid[k], mid[k2]]], "WS_Shell", "lip", away=c0 - np.array([s, 0, 0]))
            K.patch(m, [[mid[k], mid[k2]], [tip, tip]], "WS_Shell", "accent", away=c0 - np.array([s, 0, 0]), smooth=True)
    # skids
    for y in (-0.55, 0.55):
        K.box(m, (-1.5, y - 0.12, 0.0), (1.5, y + 0.12, 0.28), "WS_Metal", "lattice")
    if lod <= 1:
        # handholds at both ends, polished where hands go
        for x in (-1.58, 1.58):
            K.tube(m, [(x, -0.45, 1.3), (x + 0.12 * (1 if x > 0 else -1), -0.45, 1.3), (x + 0.12 * (1 if x > 0 else -1), 0.45, 1.3), (x, 0.45, 1.3)], 0.03, 6, "WS_Metal", "rail")
        K.box(m, (-0.25, -0.98, 1.0), (0.25, -0.9, 1.35), "WS_Metal", "trim")
    return m


def refuel_post(lod):
    """The pad-side refuel post: a ribbed pillar, a hose reel, a lit status strip, a hand-worn grip."""
    m = K.Mesh()
    n = (16, 10, 6, 6)[lod]
    if lod == 3:
        K.revolve(m, [(0.4, 0.0), (0.3, 1.8), (0.0, 1.85)], 5, "WS_Shell", "plate_band", axis="z", away=lambda q: np.array([0, 0, q[2]]))
        return m
    K.revolve(m, [(0.42, 0.0), (0.42, 0.15), (0.32, 0.25)], n, "WS_Shell", "lip", axis="z", away=lambda q: np.array([0, 0, q[2]]))
    K.revolve(m, [(0.32, 0.25), (0.28, 1.6)], n, "WS_Shell", "plate_band", axis="z", away=lambda q: np.array([0, 0, q[2]]))
    K.revolve(m, [(0.28, 1.6), (0.36, 1.75), (0.0, 1.85)], n, "WS_Shell", "accent", axis="z", away=lambda q: np.array([0, 0, q[2] - 0.5]))
    if lod <= 1:
        for k in range(8 if lod == 0 else 4):
            a = 2 * math.pi * k / (8 if lod == 0 else 4) + 0.3
            K.beam(m, np.array([math.cos(a) * 0.3, math.sin(a) * 0.3, 0.3]), np.array([math.cos(a) * 0.29, math.sin(a) * 0.29, 1.58]), 0.06, 0.05, "WS_Shell", "rib", up=(math.cos(a), math.sin(a), 0))
        coil = [np.array([0.0, 0.32 + math.cos(a) * 0.22, 1.1 + math.sin(a) * 0.22]) + np.array([(a / (2 * math.pi)) * 0.05, 0, 0]) for a in np.linspace(0, 6 * math.pi, 36 if lod == 0 else 18)]
        K.tube(m, coil, 0.035, 6, "WS_Metal", "pipe")
        for k in range(6):
            a = 2 * math.pi * k / 6
            K.revolve(m, [(0.03, 0.17), (0.0, 0.19)], 6, "WS_Metal", "trim", center=(math.cos(a) * 0.37, math.sin(a) * 0.37, 0.0), axis="z", away=(math.cos(a) * 0.37, math.sin(a) * 0.37, 0.0))
    K.box(m, (-0.18, -0.34, 0.6), (0.18, -0.26, 1.45), "WS_Metal", "light")
    if lod <= 1:
        K.revolve(m, [(0.28, 0.0), (0.28, 0.25)], n, "WS_Metal", "pipe", center=(0.0, 0.32, 1.1), axis="x")
        K.tube(m, [(0.0, 0.32, 0.85), (0.0, 0.6, 0.6), (0.0, 0.7, 0.1)], 0.05, 6, "WS_Metal", "pipe")
        K.tube(m, [(-0.3, -0.05, 1.25), (-0.3, -0.25, 1.25)], 0.03, 6, "WS_Metal", "rail", caps=True)
    return m


def build(sc, root):
    for name, fn, col in (("ws_cargopod", cargo_pod, ((-1.6, -1.0, 0.0), (1.6, 1.0, 1.95))), ("ws_refuelpost", refuel_post, ((-0.45, -0.45, 0.0), (0.45, 0.45, 1.85)))):
        asset = K.new_collection(name, root)
        asset["asset_class"] = "kit"
        for lod in range(4):
            c = K.new_collection(f"{name}_LOD{lod}", asset)
            m = fn(lod)
            print(f"{name} LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
            m.build(f"{name}_L{lod}", c)
        K.collider(asset, f"COL_{name.split('_')[1].capitalize()}", *col)
        K.empty(asset, "Socket_" + name.split("_")[1].capitalize() + "Floor", (0, 0, 0), size=0.5, props={"interface": "place"})
        if name == "ws_refuelpost":
            K.empty(asset, "Interact_Refuel", (-0.3, -0.35, 1.25), size=0.2)
