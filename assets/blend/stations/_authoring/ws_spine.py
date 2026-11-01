"""The spine: a 48 m pressurised segment, a lapped shell over a triangulated lattice tube, collars at both ends and two
side collars at its middle. Any collar mates any other (Socket_* with interface "collar"), so spine, ring hub, habitat and
the hangar's back join in whatever order the builder picks."""
import math

import numpy as np

import kit as K
import ws_parts as P

L = 48.0
R = 7.0


def section(lod):
    """A hexagonal-round section: six flats eased into each other, the Ixari facet under a Thalune skin."""
    n = (36, 24, 12, 6)[lod]
    a = np.linspace(0, 2 * math.pi, n + 1)
    r = R * (1 + 0.045 * np.cos(6 * a))
    return np.stack([np.cos(a) * r, np.sin(a) * r], 1)


def build_lod(lod):
    m = K.Mesh()
    y0, y1 = P.COLLAR_DEPTH, L - P.COLLAR_DEPTH
    if lod == 3:
        sec = section(3)
        K.lapped_rows(m, sec, y0, y1, "WS_Shell", lambda i: "plate", row=12.0, lap=0.0, lod=2, seed=21, away=lambda q: np.array([0.0, q[1], 0.0]))
        col = P.collar_mesh(3)
        P.place(m, col, (0, y0, 0), (0, -1, 0))
        P.place(m, col, (0, y1, 0), (0, 1, 0))
        return m
    sec = section(lod)
    # lapped rows wrap the tube; the belly in deep blue, a blue band at the shoulders
    c = K._cum(sec)
    nrow = int(round(c[-1] / 2.0))
    K.lapped_rows(m, sec, y0, y1, "WS_Shell", lambda i: "accent" if (i < nrow * 0.18 or i > nrow * 0.82) else ("plate_band" if i in (nrow // 4, 3 * nrow // 4) else "plate"), row=2.0, lap=0.12, lod=min(lod, 2), seed=21, away=lambda q: np.array([0.0, q[1], 0.0]))
    # end bulkheads (seen inside the collar ring)
    for y, s in ((y0, -1), (y1, 1)):
        ring = [(p[0], y, p[1]) for p in sec[:-1]]
        ctr = (0.0, y, 0.0)
        for k in range(len(ring)):
            K.patch(m, [[ring[k], ring[(k + 1) % len(ring)]], [ctr, ctr]], "WS_Metal", "machine", toward=lambda q, s=s: q + np.array([0, s * 5.0, 0]))
    col = P.collar_mesh(lod)
    P.place(m, col, (0, y0, 0), (0, -1, 0))
    P.place(m, col, (0, y1, 0), (0, 1, 0))
    # side collars at the middle (habitats, the ring hub, another spine)
    mid = L / 2
    if lod <= 2:
        P.place(m, col, (R * 0.98, mid, 0), (1, 0, 0))
        P.place(m, col, (-R * 0.98, mid, 0), (-1, 0, 0))
    if lod == 3:
        return m
    # the lattice: six longerons, ring frames every 8 m, a diagonal web between them
    sq = [(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3), (-0.3, -0.3)]
    angs = [math.pi / 6 + k * math.pi / 3 for k in range(6)]
    rr = R + 1.1
    ys = np.arange(y0 + 1.0, y1, 8.0)
    for k, a in enumerate(angs):
        for ya, yb in ((y0 + 0.5, mid - 10.5), (mid + 10.5, y1 - 0.5)):
            p0 = np.array([math.cos(a) * rr, ya, math.sin(a) * rr])
            p1 = np.array([math.cos(a) * rr, yb, math.sin(a) * rr])
            K.member(m, p0, p1, 0.3, "WS_Metal", "lattice", lod, bow_dir=(math.cos(a), 0, math.sin(a)))
    for j, y in enumerate(ys):
        if abs(y - mid) < 10.5:
            continue
        ring = [np.array([math.cos(a) * rr, y, math.sin(a) * rr]) for a in angs + [angs[0]]]
        K.chord(m, ring, 0.3, "WS_Metal", "lattice", lod, nodes=range(7), up=(0, 1, 0))
        if lod <= 2 and j < len(ys) - 1:
            for k in range(6):
                a, b = angs[k], angs[(k + 1) % 6]
                y2 = ys[j + 1]
                if abs(y2 - mid) < 10.5:
                    continue
                pa = np.array([math.cos(a) * rr, y, math.sin(a) * rr])
                pb = np.array([math.cos(b) * rr, y2, math.sin(b) * rr])
                K.member(m, pa, pb, 0.17, "WS_Metal", "lattice", lod, bow_dir=(0, 1, 0))
    # crystal window strips along the shoulders, lit from the corridor inside
    if lod <= 2:
        for s in (-1, 1):
            for yy in (y0 + 3.0, mid + 11.0):
                a = math.pi / 2 + s * 0.55
                p = lambda t, h: np.array([math.cos(a + h) * (R * 1.06 + 0.15), yy + t, math.sin(a + h) * (R * 1.06 + 0.15)])
                for k in range(3):
                    K.crystal_insert(m, p(1.2 + k * 2.8, 0), (math.cos(a), 0, math.sin(a)), (0, 1, 0), 2.4, 1.7, lod, seed=k + int(yy))
    # a conduit run and radiator vanes along the belly
    if lod <= 1:
        for s in (-1, 1):
            K.tube(m, [(s * 2.2, y0 + 1.0, -R - 0.55), (s * 2.2, y1 - 1.0, -R - 0.55)], 0.45, 10 if lod == 0 else 6, "WS_Metal", "pipe")
        for y in np.arange(y0 + 4.0, y1 - 3.0, 4.5):
            if abs(y - mid) < 10.5:
                continue
            K.box(m, (-1.2, y, -R - 2.6), (1.2, y + 0.25, -R - 0.4), "WS_Metal", "radiator")
    # nav studs at the collar shoulders
    for y in (y0 + 0.6, y1 - 0.6):
        K.revolve(m, [(0.0, R + 1.0), (0.3, R + 0.85), (0.35, R + 0.6)], 8, "NavWhite", None, center=(0, y, 0), axis="z", away=(0, y, R))
    return m


def build(sc, root):
    asset = K.new_collection("ws_spine", root)
    for lod in range(4):
        c = K.new_collection(f"ws_spine_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_spine LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_spine_L{lod}", c)
    K.collider(asset, "COL_Spine", (-R - 1.5, 0.0, -R - 2.7), (R + 1.5, L, R + 1.5))
    K.collider(asset, "COL_Collar_Port", (-R - 2.5, L / 2 - 9.0, -9.0), (-R + 1.0, L / 2 + 9.0, 9.0))
    K.collider(asset, "COL_Collar_Starboard", (R - 1.0, L / 2 - 9.0, -9.0), (R + 2.5, L / 2 + 9.0, 9.0))
    K.empty(asset, "Socket_Aft", (0, 0, 0), rot=P.socket_rotation((0, -1, 0)), size=4.0, props={"interface": "collar"})
    K.empty(asset, "Socket_Fore", (0, L, 0), size=4.0, props={"interface": "collar"})
    K.empty(asset, "Socket_Port", (-R * 0.98 - P.COLLAR_DEPTH, L / 2, 0), rot=P.socket_rotation((-1, 0, 0)), size=4.0, props={"interface": "collar"})
    K.empty(asset, "Socket_Starboard", (R * 0.98 + P.COLLAR_DEPTH, L / 2, 0), rot=P.socket_rotation((1, 0, 0)), size=4.0, props={"interface": "collar"})
    return asset
