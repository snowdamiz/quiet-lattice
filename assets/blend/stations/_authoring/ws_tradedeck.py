"""The trade deck: a mezzanine across the hangar's back wall, its floor 7 m up (STATION_LAYOUT: from the back wall 22 m
toward the mouth). Its frame is the hangar's translated to Socket_TradeDeck: the back wall at y = 0, the hall toward -y.
The fabricator mounts at Socket_Fabricator = STATION_FABRICATOR.kiosk; its user stands at STATION_FABRICATOR.use."""
import math

import numpy as np
from mathutils import Matrix

import kit as K
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


def kiosk(m, cx, cy, lod, w=2.2):
    """A trade counter: a lapped shell front, a brushed top at 1.05 m, a screen leaning back."""
    K.box(m, (cx - w / 2, cy - 0.35, Z), (cx + w / 2, cy + 0.35, Z + 1.0), "WS_Shell", "plate_band", keys={"+z": "lip"})
    K.box(m, (cx - w / 2 - 0.05, cy - 0.45, Z + 1.0), (cx + w / 2 + 0.05, cy + 0.45, Z + 1.06), "WS_Metal", "trim")
    if lod <= 1:
        xf = Matrix.Translation((cx, cy + 0.2, Z + 1.06)) @ Matrix.Rotation(math.radians(-18), 4, "X")
        K.box(m, (-w / 2 + 0.2, -0.04, 0.0), (w / 2 - 0.2, 0.04, 0.8), "WS_Metal", "light", xf=xf)
        K.box(m, (cx - w / 2, cy - 0.38, Z), (cx + w / 2, cy - 0.33, Z + 0.15), "WS_Shell", "lip")


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
    # the canopy: a lapped shell awning off the back wall over a lattice of brackets, lamps beneath
    prof = np.array([(-0.0, Z + 5.2), (-6.0, Z + 4.4), (-12.0, Z + 3.4)])
    prof2 = np.stack([prof[:, 0], prof[:, 1]], 1)
    K.lapped_rows(m, prof2[::-1], -HX, HX, "WS_Shell", lambda i: "accent" if i == 0 else "plate", row=2.0, lap=0.12, lod=min(lod, 2), seed=11, toward=lambda c: c + np.array([0, 0, 5.0]), axis="x")
    if lod <= 2:
        for x in np.arange(-60.0, 60.1, 10.0):
            K.beam(m, np.array([x, -0.3, Z + 2.0]), np.array([x, -11.8, Z + 3.3]), 0.35, 0.5, "WS_Metal", "lattice", up=(1, 0, 0))
            if lod == 0:
                K.beam(m, np.array([x - 4.0, -6.0, Z + 4.0]), np.array([x + 4.0, -6.0, Z + 4.0]), 0.5, 0.16, "WS_Metal", "light", up=(0, 1, 0))
    # counters: trade terminal, outfitter, the Quartermaster's projector ring, the board on the back wall
    if lod <= 2:
        kiosk(m, 30.0, -10.0, lod)
        kiosk(m, 45.0, -10.0, lod, w=3.0)
        K.revolve(m, [(1.6, Z), (1.6, Z + 0.25), (1.3, Z + 0.35), (0.9, Z + 0.35)], (32, 20, 12, 8)[lod], "WS_Shell", "lip", center=(0, -8.0, 0), axis="z", away=(0, -8.0, Z - 2))
        K.revolve(m, [(0.9, Z + 0.35), (0.0, Z + 0.36)], (32, 20, 12, 8)[lod], "WS_Metal", "light", center=(0, -8.0, 0), axis="z", away=(0, -8.0, Z - 2))
        # the board: a framed display across the back wall
        K.box(m, (-18.0, -0.45, Z + 1.0), (-6.0, -0.12, Z + 4.4), "WS_Metal", "trim")
        K.box(m, (-17.6, -0.52, Z + 1.3), (-6.4, -0.45, Z + 4.1), "WS_Metal", "light")
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
    # a slab of the mark on the deck before each counter, worn where boots stop
    for x in (30.0, 45.0, -30.0):
        m.add([(x - 1.2, -12.6, z), (x + 1.2, -12.6, z), (x + 1.2, -11.0, z), (x - 1.2, -11.0, z)], [(0.5, 0.25), (1.0, 0.25), (1.0, 0.375), (0.5, 0.375)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
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
