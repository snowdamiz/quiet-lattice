"""The trade deck: a mezzanine across the hangar's back wall, its floor 7 m up (STATION_LAYOUT: from the back wall 22 m
toward the mouth). Its frame is the hangar's translated to Socket_TradeDeck: the back wall at y = 0, the hall toward -y.
The fabricator mounts at Socket_Fabricator = STATION_FABRICATOR.kiosk; its user stands at STATION_FABRICATOR.use."""
import math

import numpy as np
from mathutils import Matrix

import kit as K
import paint as PD
from ws_hangar import railing

Z = 7.0
D = 22.0
HX = 64.6
FAB = (-30.0, -10.0, Z)
STAIR_W = 4.0
RISE, GOING = 7.0 / 39, 0.30


def stairs(m, lod, x0, x1, y_top):
    """39 risers of 0.18 m and 0.30 m goings from the hall floor up to the deck edge at y_top (toward -y)."""
    n = 39
    if lod >= 2:
        y_bot = y_top - (n - 1) * GOING
        K.patch(m, [[(x0, y_bot, 0.0), (x0, y_top, Z)], [(x1, y_bot, 0.0), (x1, y_top, Z)]], "WS_Deck", "tread", toward=lambda c: c + np.array([0, -3.0, 5.0]))
    else:
        for i in range(n):
            z0, z1 = i * RISE, (i + 1) * RISE
            y1 = y_top - (n - 1 - i) * GOING
            y0 = y1 - GOING
            if i == n - 1:
                y0 = y1 - 0.02
            K.box(m, (x0, y0, z0), (x1, y1, z1), "WS_Deck", "tread", keys={"-y": "track"}, skip=("-z",), u_off=i * 0.21)
    # stringers
    for x in (x0 - 0.15, x1):
        a = np.array([x, y_top - n * GOING, -0.2])
        b = np.array([x, y_top, Z])
        K.beam(m, a + [0.075, 0, 0], b + [0.075, 0, 0], 0.15, 0.45, "WS_Metal", "lattice", up=(-1, 0, 0))
        if lod <= 1:
            railing(m, a + [0.075, 0.0, 0.2], b + [0.075, 0, 0.0], lod, post_step=1.6)


def counter(m, cx, cy, lod, w=3.2, seed=0):
    """A trade counter 3.2 x 0.9 x 1.1 m: a bowed front of lapped shell rows over a dark plinth, a brushed top with a lip,
    two screens leaning toward the customer (-Y) and a crystal display grown into the front."""
    x0, x1 = cx - w / 2, cx + w / 2
    K.box(m, (x0 + 0.1, cy - 0.32, Z), (x1 - 0.1, cy + 0.42, Z + 0.14), "WS_Metal", "machine", skip=("-z",))
    front = np.array([(cy - 0.36, Z + 0.14), (cy - 0.46, Z + 0.45), (cy - 0.47, Z + 0.7), (cy - 0.42, Z + 1.0)])
    if lod <= 1:
        front = K.resample(front, 0.12)
    K.lapped_rows(m, front, x0 + 0.05, x1 - 0.05, "WS_Shell", lambda i: "accent" if i == 0 else "plate", row=0.3, lap=0.025, lod=min(lod, 2), seed=seed, axis="x", away=(cx, cy + 1.0, Z + 0.6))
    K.patch(m, [[(x0 + 0.05, cy + 0.42, Z + 0.14), (x0 + 0.05, cy + 0.42, Z + 1.0)], [(x1 - 0.05, cy + 0.42, Z + 0.14), (x1 - 0.05, cy + 0.42, Z + 1.0)]], "WS_Metal", "machine", toward=lambda c: c + np.array([0, 5.0, 0]))
    for xe, s in ((x0 + 0.05, -1), (x1 - 0.05, 1)):
        pts = [(xe, p[0], p[1]) for p in front] + [(xe, cy + 0.42, Z + 1.0), (xe, cy + 0.42, Z + 0.14)]
        sv = K.strip_v("WS_Shell", "rib")
        m.add(pts, [((p[1] - cy) * 0.125 + seed * 0.1, sv[0] + (sv[1] - sv[0]) * ((p[2] - Z) / 1.0)) for p in pts], "WS_Shell", False, toward=lambda c, s=s: c + np.array([s * 5.0, 0, 0]))
    K.box(m, (x0 - 0.06, cy - 0.55, Z + 1.0), (x1 + 0.06, cy + 0.48, Z + 1.07), "WS_Metal", "trim")
    if lod <= 1:
        K.tube(m, [(x0 - 0.06, cy - 0.55, Z + 1.035), (x1 + 0.06, cy - 0.55, Z + 1.035)], 0.04, 8 if lod == 0 else 5, "WS_Metal", "rail", caps=True)
        for k, dx in enumerate((-0.75, 0.75)):
            xf = Matrix.Translation((cx + dx, cy + 0.15, Z + 1.07)) @ Matrix.Rotation(math.radians(24), 4, "X")
            K.box(m, (-0.55, -0.03, 0.0), (0.55, 0.05, 0.62), "WS_Metal", "machine", xf=xf)
            K.box(m, (-0.5, -0.045, 0.05), (0.5, -0.03, 0.57), "WS_Metal", "light", xf=xf)
            K.member(m, (cx + dx, cy + 0.28, Z + 1.07), (cx + dx, cy + 0.33, Z + 1.3), 0.03, "WS_Metal", "trim", lod=2, bow=0.0)
        K.crystal_insert(m, (cx, cy - 0.47, Z + 0.62), (0, -1, 0), (1, 0, 0), 0.9, 0.34, lod, seed=seed)
        K.decal(m, (cx, cy - 1.0, Z), (0, 0, 1), (1, 0, 0), 2.8, 1.6, PD.DECAL_CELLS["scuff"], lift=0.03, flip=bool(seed % 2))


def quartermaster(m, lod):
    """The Quartermaster's plinth at Interact_Quartermaster: three stepped shell tiers, a lectern toward the hall, a
    faceted crystal projector in a dark collar on top."""
    c = (0.0, -8.0, 0.0)
    seg = (40, 24, 12, 8)[lod]
    K.revolve(m, [(2.4, Z), (2.4, Z + 0.18), (2.1, Z + 0.24)], seg, "WS_Shell", "lip", center=c, axis="z", away=(0, -8.0, Z - 2))
    K.revolve(m, [(2.1, Z + 0.24), (2.0, Z + 0.4), (1.7, Z + 0.46)], seg, "WS_Shell", "accent", center=c, axis="z", away=(0, -8.0, Z - 2))
    K.revolve(m, [(1.7, Z + 0.46), (1.6, Z + 0.62), (1.25, Z + 0.68), (0.0, Z + 0.68)], seg, "WS_Shell", "plate_band", center=c, axis="z", away=(0, -8.0, Z - 2))
    if lod <= 1:
        for k in range(12):
            a = k * math.pi / 6
            K.tube(m, [(math.cos(a) * 1.3, -8.0 + math.sin(a) * 1.3, Z + 0.7), (math.cos(a) * 2.05, -8.0 + math.sin(a) * 2.05, Z + 0.42), (math.cos(a) * 2.42, -8.0 + math.sin(a) * 2.42, Z + 0.02)], 0, 0, "WS_Shell", "rib", smooth=True, up=(0, 0, 1), profile=[(-0.08, -0.02), (-0.05, 0.05), (0.0, 0.07), (0.05, 0.05), (0.08, -0.02)])
    # the projector: a crystal grown from a socket collar, lit
    K.revolve(m, [(0.7, Z + 0.68), (0.62, Z + 0.95), (0.42, Z + 1.0)], 16 if lod <= 1 else 8, "WS_Metal", "machine", center=c, axis="z", away=(0, -8.0, Z))
    tip = np.array([0.05, -7.95, Z + 2.7])
    ring = [np.array([math.cos(a) * 0.36, -8.0 + math.sin(a) * 0.3, Z + 0.98]) for a in np.linspace(0, 2 * math.pi, 7)[:-1] + 0.3]
    mid = [p * [0.8, 1, 1] + np.array([0.02, -1.6, 0.0]) * 0 + np.array([0.0, 0.0, 1.05]) for p in ring]
    mid = [np.array([q[0] * 0.85, -8.0 + (q[1] + 8.0) * 0.85, q[2]]) for q in mid]
    for q in range(6):
        q2 = (q + 1) % 6
        K.patch(m, [[ring[q], ring[q2]], [mid[q], mid[q2]]], "WS_LitGlass" if q % 2 else "WS_Glass", None, away=(0, -8.0, Z + 1.4))
        K.patch(m, [[mid[q], mid[q2]], [tip, tip]], "WS_Glass" if q % 2 else "WS_LitGlass", None, away=(0, -8.0, Z + 1.4))
    # the lectern toward the hall, where the player stands (Interact_Quartermaster at y -10.2)
    K.box(m, (-0.6, -9.75, Z + 0.68), (0.6, -9.35, Z + 1.0), "WS_Shell", "accent", keys={"-y": "plate_band"})
    xf = Matrix.Translation((0.0, -9.6, Z + 1.0)) @ Matrix.Rotation(math.radians(-28), 4, "X")
    K.box(m, (-0.65, -0.3, 0.0), (0.65, 0.3, 0.06), "WS_Metal", "trim", xf=xf)
    K.box(m, (-0.55, -0.22, 0.06), (0.55, 0.22, 0.07), "WS_Metal", "light", xf=xf)
    K.decal(m, (0.0, -11.2, Z), (0, 0, 1), (1, 0, 0), 3.6, 2.0, PD.DECAL_CELLS["scuff"], lift=0.03)


def board(m, lod):
    """The board at Interact_Board: a lit listing screen in a lapped shell surround on the back wall, a lamp hood above."""
    x0, x1, z0, z1, y = -18.0, -6.0, Z + 1.0, Z + 4.4, -0.12
    K.box(m, (x0 - 0.5, y - 0.35, z0 - 0.4), (x1 + 0.5, y, z0), "WS_Shell", "accent", skip=("+y",))
    K.box(m, (x0 - 0.5, y - 0.35, z1), (x1 + 0.5, y, z1 + 0.5), "WS_Shell", "signal", skip=("+y",))
    for xa, xb in ((x0 - 0.5, x0), (x1, x1 + 0.5)):
        K.box(m, (xa, y - 0.35, z0), (xb, y, z1), "WS_Shell", "rib", skip=("+y",))
    K.patch(m, [[(x0, y - 0.2, z0), (x0, y - 0.2, z1)], [(x1, y - 0.2, z0), (x1, y - 0.2, z1)]], "WS_LitGlass", None, toward=lambda c: c + np.array([0, -5.0, 0]))
    if lod <= 1:
        for k, zz in enumerate(np.linspace(z0 + 0.35, z1 - 0.35, 9)):
            for xa, xb in ((x0 + 0.3, -12.2), (-11.8, x1 - 0.3)):
                if (k + int(xa)) % 4 == 3:
                    continue
                K.box(m, (xa, y - 0.24, zz - 0.07), (xb, y - 0.2, zz + 0.07), "WS_Metal", "light", skip=("+y",))
        K.lapped_rows(m, np.array([(y - 1.2, z1 + 0.9), (y - 0.6, z1 + 1.15), (y, z1 + 1.3)]), x0 - 0.8, x1 + 0.8, "WS_Shell", lambda i: "plate", row=0.6, lap=0.04, lod=min(lod, 2), seed=5, axis="x", away=(-12.0, y + 2.0, z1 - 1.0))
        K.box(m, (x0, y - 1.05, z1 + 0.7), (x1, y - 0.95, z1 + 0.84), "WS_Metal", "light", keys={"+z": "machine"})
        K.decal(m, (-12.0, -2.4, Z), (0, 0, 1), (1, 0, 0), 9.0, 2.2, PD.DECAL_CELLS["scuff"], lift=0.03)


def dressing(m, lod):
    """Benches under the canopy, crate stacks by the service doors, wayfinding pylons at the stair head, scuffs on the
    stair landing and the walkway, grime running down the fascia under the front rail."""
    rng = np.random.default_rng(23)
    for x in (-52.0, -38.0, -22.0, 12.0, 20.0, 58.0):
        K.lapped_rows(m, np.array([(-2.2, Z + 0.42), (-1.85, Z + 0.47), (-1.5, Z + 0.45)]), x - 1.6, x + 1.6, "WS_Shell", lambda i: "accent", row=0.4, lap=0.0, lod=2, seed=abs(int(x)), axis="x", away=(x, -1.85, Z))
        K.lapped_rows(m, np.array([(-1.5, Z + 0.45), (-1.38, Z + 0.8), (-1.32, Z + 1.0)]), x - 1.6, x + 1.6, "WS_Shell", lambda i: "plate", row=0.6, lap=0.0, lod=2, seed=abs(int(x)) + 1, axis="x", away=(x, -2.6, Z + 0.4))
        for dx in (-1.2, 1.2):
            K.member(m, (x + dx, -1.85, Z), (x + dx, -1.85, Z + 0.44), 0.07, "WS_Metal", "lattice", lod=lod, bow=0.06, bow_dir=(0, -1, 0), sides=4, seg=1)
    for x0, n in ((-48.0, 4), (36.0, 3), (50.0, 5)):
        for k in range(n):
            dx, dy = (k % 3) * 1.25, -2.0 - (k // 3) * 1.25
            z0 = Z + (1.0 if k == n - 1 and n > 3 else 0.0)
            if z0 > Z:
                dx, dy = 0.6, -2.0
            xf = Matrix.Translation((x0 + dx, dy, z0)) @ Matrix.Rotation(rng.uniform(-0.12, 0.12), 4, "Z")
            K.box(m, (-0.55, -0.55, 0.0), (0.55, 0.55, 1.0), "WS_Shell", "accent" if (k + n) % 3 == 0 else "plate", keys={"+z": "lip"}, xf=xf)
            for zz in (0.0, 0.92):
                K.box(m, (-0.6, -0.6, zz), (0.6, 0.6, zz + 0.08), "WS_Metal", "trim", xf=xf)
    for s in (-1, 1):
        x = s * (STAIR_W / 2 + 1.4)
        K.box(m, (x - 0.3, -D + 0.6, Z), (x + 0.3, -D + 1.2, Z + 2.4), "WS_Shell", "accent", keys={"+z": "lip"})
        K.box(m, (x - 0.32, -D + 0.56, Z + 1.6), (x + 0.32, -D + 0.6, Z + 2.2), "WS_Metal", "light", skip=("+y",))
        K.decal(m, (x, -D + 0.53, Z + 0.9), (0, -1, 0), (1, 0, 0), 0.6, 0.9, PD.DECAL_CELLS["chevron"], lift=0.0)
    K.decal(m, (0.0, -D + 1.6, Z), (0, 0, 1), (1, 0, 0), 5.0, 3.0, PD.DECAL_CELLS["scuff"], lift=0.03)
    K.decal(m, (0.0, -D - 39 * GOING - 0.6, 0.0), (0, 0, 1), (1, 0, 0), 5.5, 3.0, PD.DECAL_CELLS["scuff"], lift=0.03)
    for k, x in enumerate(np.arange(-56.0, 57.0, 9.5)):
        K.decal(m, (x, -15.0, Z), (0, 0, 1), (1, 0, 0), rng.uniform(5.0, 8.0), 2.2, PD.DECAL_CELLS["scuff"], lift=0.035, flip=bool(k % 2))
        if abs(x) > 4:
            K.decal(m, (x + rng.uniform(-2, 2), -D, Z - 0.45), (0, -1, 0), (1, 0, 0), rng.uniform(6.0, 9.0), 0.9, PD.DECAL_CELLS["grime_runs"], lift=0.02, flip=bool(k % 2))


def build_lod(lod):
    m = K.Mesh()
    if lod == 3:
        K.box(m, (-HX, -D, Z - 0.9), (HX, 0.0, Z), "WS_Shell", "signal", keys={"+z": "lip"}, skip=("+y",))
        n = 39
        y_bot = -D - (n - 1) * GOING
        K.patch(m, [[(-STAIR_W / 2, y_bot, 0.0), (-STAIR_W / 2, -D, Z)], [(STAIR_W / 2, y_bot, 0.0), (STAIR_W / 2, -D, Z)]], "WS_Deck", "tread", toward=lambda c: c + np.array([0, -3.0, 5.0]))
        K.patch(m, [[(-HX, 0.0, Z + 5.2), (-HX, -12.0, Z + 3.4)], [(HX, 0.0, Z + 5.2), (HX, -12.0, Z + 3.4)]], "WS_Shell", "plate", toward=lambda c: c + np.array([0, 0, 5.0]))
        return m
    # the deck slab: floor plates on top, a signal-orange fascia, lattice underneath
    K.planar(m, [(-HX, -D, Z), (HX, -D, Z), (HX, 0, Z), (-HX, 0, Z)], "WS_Floor", off=(0.31, 0.77))
    K.patch(m, [[(-HX, -D, Z - 0.9), (-HX, -D, Z)], [(HX, -D, Z - 0.9), (HX, -D, Z)]], "WS_Shell", "signal", toward=lambda c: c + np.array([0, -5.0, 0]))
    K.planar(m, [(-HX, -D, Z - 0.9), (-HX, 0, Z - 0.9), (HX, 0, Z - 0.9), (HX, -D, Z - 0.9)], "WS_Floor", toward=lambda c: c + np.array([0, 0, -5.0]))
    # walkway strip along the deck (the boots' path between the counters)
    K.box(m, (-HX + 2, -16.0, Z), (HX - 2, -14.0, Z + 0.02), "WS_Deck", "walk", skip=("-z",))
    # columns: the lattice carries the deck down to the hall floor
    for x in np.arange(-60.0, 60.1, 12.0):
        if abs(x) < 4:
            continue
        K.beam(m, np.array([x, -D + 0.6, 0.0]), np.array([x, -D + 0.6, Z - 0.9]), 0.7, 0.7, "WS_Metal", "lattice", up=(1, 0, 0), bevel=0.1 if lod == 0 else 0.0)
        if lod <= 1:
            for s in (-1, 1):
                K.beam(m, np.array([x, -D + 0.6, Z - 3.5]), np.array([x + 3.0 * s, -D + 0.6, Z - 0.9]), 0.3, 0.3, "WS_Metal", "lattice", up=(0, 1, 0))
                K.beam(m, np.array([x, -D + 0.6, Z - 3.5]), np.array([x, -D + 5.0, Z - 0.9]), 0.3, 0.3, "WS_Metal", "lattice", up=(1, 0, 0))
    # front railing with a gap at the stair head
    if lod <= 2:
        railing(m, (-HX, -D + 0.15, Z), (-STAIR_W / 2 - 0.2, -D + 0.15, Z), lod)
        railing(m, (STAIR_W / 2 + 0.2, -D + 0.15, Z), (HX, -D + 0.15, Z), lod)
        railing(m, (-HX, -D, Z), (-HX, 0, Z), lod)
        railing(m, (HX, -D, Z), (HX, 0, Z), lod)
    stairs(m, lod, -STAIR_W / 2, STAIR_W / 2, -D)
    # the canopy: lapped shell rows off the back wall following Thalune ribs, carried on Ulgani brackets, lamps beneath
    prof = np.array([(-0.0, Z + 5.2), (-6.0, Z + 4.4), (-12.0, Z + 3.4)])
    K.lapped_rows(m, prof[::-1], -HX, HX, "WS_Shell", lambda i: "accent" if i == 0 else "plate", row=2.0, lap=0.12, lod=min(lod, 2), seed=11, toward=lambda c: c + np.array([0, 0, 5.0]), axis="x")
    if lod <= 2:
        for x in np.arange(-60.0, 60.1, 5.0 if lod <= 1 else 10.0):
            K.tube(m, [(x, -0.3, Z + 5.45), (x, -6.0, Z + 4.65), (x, -12.3, Z + 3.6)], 0, 0, "WS_Shell", "rib", smooth=True, up=(0, 0, 1), profile=[(-0.32, -0.05), (-0.22, 0.14), (0.0, 0.22), (0.22, 0.14), (0.32, -0.05)])
        for x in np.arange(-60.0, 60.1, 10.0):
            # knee braces from 2.9 m up the back wall, clear of a walker's head, to the canopy's mid line
            K.member(m, (x, -0.3, Z + 2.9), (x, -7.0, Z + 4.25), 0.16, "WS_Metal", "lattice", lod=lod, bow=-0.03, bow_dir=(0, 0, 1), sides=5 if lod == 0 else None)
            if lod <= 1:
                K.member(m, (x, -3.5, Z + 3.5), (x, -2.0, Z + 4.95), 0.09, "WS_Metal", "lattice", lod=lod, bow=0.03, sides=4, seg=1)
        # pendant lamps between the brackets: a shell hood over a lens bar, hung on two rods
        if lod <= 1:
            for x in np.arange(-55.0, 55.1, 10.0):
                for yy in (-4.0, -9.0):
                    zt = float(np.interp(yy, [-12.0, -6.0, 0.0], [Z + 3.4, Z + 4.4, Z + 5.2]))
                    zl = zt - 1.2
                    K.box(m, (x - 1.8, yy - 0.25, zl), (x + 1.8, yy + 0.25, zl + 0.16), "WS_Metal", "light", keys={"+z": "machine", "+y": "machine", "-y": "machine"})
                    K.lapped_rows(m, np.array([(yy - 0.45, zl + 0.1), (yy, zl + 0.32), (yy + 0.45, zl + 0.1)]), x - 1.95, x + 1.95, "WS_Shell", lambda i: "plate", row=0.5, lap=0.0, lod=2, seed=abs(int(x)), axis="x", away=(x, yy, zl - 1.0))
                    for dx in (-1.4, 1.4):
                        K.member(m, (x + dx, yy, zl + 0.3), (x + dx, yy, zt), 0.03, "WS_Metal", "trim", lod=2, bow=0.0, fillet=1.5)
    # the counters: trade terminal (x 30) and outfitter (x 45), built to COL_Counter_30 and COL_Counter_45
    if lod <= 2:
        for cx in (30.0, 45.0):
            counter(m, cx, -10.0, lod, seed=int(cx))
        quartermaster(m, lod)
        board(m, lod)
    # the deck's own back lining: lapped rows over the hangar's back wall (8 cm proud of it), the blue dado where carts
    # and crates knock it, a lattice cornice under the canopy
    LY = -0.08
    for i, z0 in enumerate(np.arange(Z, Z + 10.0, 2.0)):
        key = "plate_band" if i == 0 else ("accent" if i == 4 else "plate")
        lap = 0.1 if lod <= 1 else 0.0
        K.patch(m, [[(-HX, LY - lap, z0), (-HX, LY, z0 + 2.0)], [(HX, LY - lap, z0), (HX, LY, z0 + 2.0)]], "WS_Shell", key, u_off=i * 2.3, toward=lambda c: c + np.array([0, -5.0, 0]))
    if lod <= 1:
        for x in np.arange(-60.0, 60.1, 10.0):
            K.beam(m, np.array([x, LY - 0.25, Z]), np.array([x, LY - 0.25, Z + 10.0]), 0.5, 0.4, "WS_Shell", "rib", up=(0, -1, 0), bevel=0.1 if lod == 0 else 0.0)
    # service doors into the spine, 3.0 x 2.0 m, in shell frames
    for x in (-42.0, 0.0, 42.0):
        K.box(m, (x - 1.6, -0.6, Z), (x - 1.0, -0.08, Z + 3.4), "WS_Shell", "lip")
        K.box(m, (x + 1.0, -0.6, Z), (x + 1.6, -0.08, Z + 3.4), "WS_Shell", "lip")
        K.box(m, (x - 1.6, -0.6, Z + 3.0), (x + 1.6, -0.08, Z + 3.4), "WS_Shell", "signal")
        K.box(m, (x - 1.0, -0.22, Z), (x + 1.0, -0.12, Z + 3.0), "WS_Metal", "machine")
        K.box(m, (x - 1.0, -1.2, Z), (x + 1.0, -0.5, Z + 0.02), "WS_Shell", "lip", skip=("-z",))
    # decals: the Compact mark over the Quartermaster, chevrons at the stair head
    z = Z + 0.025
    m.add([(-1.8, -D + 4.6, z), (1.8, -D + 4.6, z), (1.8, -D + 1.0, z), (-1.8, -D + 1.0, z)], [(0.25, 0.25), (0.5, 0.25), (0.5, 0.5), (0.25, 0.5)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
    y = -0.14
    m.add([(-3.0, y, Z + 5.4), (3.0, y, Z + 5.4), (3.0, y, Z + 11.4), (-3.0, y, Z + 11.4)][::-1], [(0.0, 0.25), (0.25, 0.25), (0.25, 0.5), (0.0, 0.5)][::-1], "WS_Decal", toward=lambda c: c + np.array([0, -1.0, 0]))
    if lod <= 1:
        dressing(m, lod)
    return m


def build(sc, root):
    asset = K.new_collection("ws_tradedeck", root)
    for lod in range(4):
        c = K.new_collection(f"ws_tradedeck_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_tradedeck LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_tradedeck_L{lod}", c)
        # the main door into the spine, a part the station opens
        d = K.Mesh()
        K.box(d, (-1.0, -0.4, Z), (1.0, -0.25, Z + 3.0), "WS_Metal", "machine")
        d.build(f"Door_Spine_L{lod}", c)
    K.collider(asset, "COL_Deck", (-HX, -D, Z - 0.9), (HX, 0.0, Z))
    K.collider(asset, "COL_Rail_Front_L", (-HX, -D, Z), (-STAIR_W / 2 - 0.2, -D + 0.3, Z + 1.1))
    K.collider(asset, "COL_Rail_Front_R", (STAIR_W / 2 + 0.2, -D, Z), (HX, -D + 0.3, Z + 1.1))
    n = 39
    run = (n - 1) * GOING
    K.collider_mesh(asset, "COL_Stairs", [(-STAIR_W / 2, -D - run, 0), (STAIR_W / 2, -D - run, 0), (STAIR_W / 2, -D, Z), (-STAIR_W / 2, -D, Z), (-STAIR_W / 2, -D, 0), (STAIR_W / 2, -D, 0)], [(0, 1, 2, 3), (4, 5, 1, 0)[::-1], (0, 3, 4), (1, 5, 2), (3, 2, 5, 4)])
    for x in (30.0, 45.0):
        K.collider(asset, f"COL_Counter_{int(x)}", (x - 1.6, -10.45, Z), (x + 1.6, -9.55, Z + 1.1))
    K.empty(asset, "Socket_DeckMount", (0, 0, 0), size=4.0, props={"interface": "tradedeck"})
    K.empty(asset, "Socket_Fabricator", FAB, size=1.5, props={"interface": "place", "use": [FAB[0], FAB[1] - 1.2, FAB[2]]})
    K.empty(asset, "Interact_Trade", (30.0, -10.9, Z + 1.1), size=0.4)
    K.empty(asset, "Interact_Outfitter", (45.0, -10.9, Z + 1.1), size=0.4)
    K.empty(asset, "Interact_Quartermaster", (0.0, -10.2, Z + 1.2), size=0.4)
    K.empty(asset, "Interact_Board", (-12.0, -1.4, Z + 1.6), size=0.4)
    for i, x in enumerate((-40.0, 0.0, 40.0)):
        K.empty(asset, f"Light_Deck_{i + 1}", (x, -6.0, Z + 3.8), size=1.0, props={"color": "#FFF6EA", "intensity": 1.2, "distance": 30.0})
    return asset
