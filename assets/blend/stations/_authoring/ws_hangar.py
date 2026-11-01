"""The Waystation hangar bay: a broad lapped shell over a lattice frame, a stepped hood at the mouth, 24 pads.

Station frame in Blender: +Z up, the mouth faces -Y. Interior x -65..65, y -60..90, z 0..42 (STATION_LAYOUT.hangar with
the station's +z = Blender -Y). The trade deck mounts at Socket_TradeDeck, the bay door at Socket_BayDoor, the spine
at Socket_Spine.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

import kit as K

IN_X, Y_MOUTH, Y_BACK, IN_Z = 65.0, -60.0, 90.0, 42.0
Y_FRONT = -62.0  # where the body shell meets the hood's skirt
Y_LIP = -72.0  # the hood's flared outer lip
Y_REAR = 96.0
PADS_X = (-50.0, -25.0, 0.0, 25.0, 50.0)
PADS_Y = (55.0, 30.0, 5.0, -20.0, -45.0)
PAD_R = 12.0
PAD_TOP = 0.45


def pad_centres():
    out = []
    for y in PADS_Y:
        for x in PADS_X:
            if x == 0.0 and y == PADS_Y[0]:
                continue  # the aisle to the trade deck's stairs
            out.append((x, y))
    return out


def catmull(pts, n):
    pts = np.asarray(pts, np.float64)
    P = np.concatenate([pts[:1] * 2 - pts[1:2], pts, pts[-1:] * 2 - pts[-2:-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


# the exterior section from the keel's centre to the crown (x >= 0), a broad low shell
HALF = [(0, -9), (34, -8), (60, -5.5), (71, 2), (76.5, 14), (77, 26), (74, 37), (67, 46), (52, 53.5), (27, 58), (0, 59.5)]


def section(lod):
    n = (6, 4, 2, 1)[lod]
    half = catmull(HALF, n)
    return half


def roof_z(x):
    """Height of the exterior roof at |x| (for fan ribs and roof furniture)."""
    h = section(0)
    top = h[np.argmax(h[:, 0]) :]
    xs, zs = top[::-1, 0], top[::-1, 1]
    return float(np.interp(abs(x), xs, zs))


def shell_keys(i, nrow, side_rows):
    return "plate"


def build_shell(m, lod):
    half = section(lod)
    for sgn in (1, -1):
        prof = half.copy()
        prof[:, 0] *= sgn
        nrow = int(round(K._cum(prof)[-1] / 2.0))

        # large zones: the belly and the lower flank in deep blue up to the frame's knee, one banded row, a white
        # upper flank and roof
        def key(i, nrow=nrow):
            f = i / nrow
            if f < 0.455:
                return "accent"
            if f < 0.48:
                return "plate_band"
            return "plate"

        K.lapped_rows(m, prof, Y_FRONT, Y_REAR, "WS_Shell", key, row=2.0, lap=0.16 if lod == 0 else 0.12, lod=lod, flip=(sgn < 0), seed=7 + sgn, away=lambda c: (0.0, c[1], 22.0))


def ring_curve(t, n):
    """Closed curve between the mouth's opening (t=0) and the exterior section (t=1), from the floor on the left, over
    the top, to the floor on the right; n points."""
    half = section(0)
    hz = half[:, 1]
    # only the part above the floor line for the U-shaped mouth surround
    above = half[hz >= -0.5]
    ext = np.concatenate([above * [-1, 1], above[::-1][1:]])
    ext = K.resample(ext, K._cum(ext)[-1] / (n - 1))
    w, h = IN_X, IN_Z
    rect = np.array([(-w, 0), (-w, h), (w, h), (w, 0)], np.float64)
    rect = K.resample(rect, K._cum(rect)[-1] / (n - 1))
    return rect * (1 - t) + ext * t


def flare(n, k=1.09):
    e = ring_curve(1.0, n)
    c = np.array([0.0, 18.0])
    out = (e - c) * k + c
    out[:, 1] = np.maximum(out[:, 1], e[:, 1] * 0 - 1.5)
    return out


def build_mouth(m, lod):
    """A stepped shell hood: two steps from the opening, then a flared brow whose skirt sweeps back into the body."""
    n = (61, 41, 21, 13)[lod]
    curves = [ring_curve(0.0, n), ring_curve(0.33, n), ring_curve(0.66, n), flare(n)]
    ys = [Y_MOUTH, Y_MOUTH - 4.0, Y_MOUTH - 8.0, Y_LIP]
    front = lambda c: c + np.array([0.0, -10.0, 0.0])
    axis = lambda c: np.array([0.0, c[1], 20.0])

    def band(a, b, ya, yb, key, toward, u=0.0):
        g = np.zeros((n, 2, 3))
        g[:, 0] = np.stack([a[:, 0], np.full(n, ya), a[:, 1]], 1)
        g[:, 1] = np.stack([b[:, 0], np.full(n, yb), b[:, 1]], 1)
        K.patch(m, g, "WS_Shell", key, toward=toward, u_off=u)

    band(curves[0], curves[1], ys[0], ys[0], "accent", front)
    band(curves[1], curves[1], ys[0], ys[1], "signal", axis)
    band(curves[1], curves[2], ys[1], ys[1], "plate_band", front, 1.3)
    band(curves[2], curves[2], ys[1], ys[2], "lip", axis)
    band(curves[2], curves[3], ys[2], ys[3], "accent", front, 2.1)
    # the brow's skirt: from the flared lip back over the body (seen from above and the sides)
    body = ring_curve(1.0, n)
    band(curves[3], body, ys[3], Y_FRONT, "plate", lambda c: c + np.array([0.0, 0.0, 0.0]) + (c - np.array([0.0, c[1], 18.0])), 0.7)
    # the opening's reveal: from the mouth back into the hall
    band(curves[0], curves[0], Y_MOUTH, Y_MOUTH + 1.5, "lip", axis)
    if lod <= 1:
        # scallop ribs radiating over the brow from a hinge above the mouth, standing proud
        nrib = 17 if lod == 0 else 11
        for i in range(nrib):
            j = int(round(i / (nrib - 1) * (n - 1)))
            a = np.array([curves[2][j, 0], ys[2] - 0.2, curves[2][j, 1]])
            b = np.array([curves[3][j, 0], ys[3] - 0.3, curves[3][j, 1]])
            c = np.array([body[j, 0], Y_FRONT + 4.0, body[j, 1]]) + np.append(body[j] - [0, 18.0], 0)[[0, 2, 1]] * 0.0
            K.tube(m, [a, b, c], 0, 0, "WS_Shell", "rib", smooth=True, up=(0, -1, 0), profile=[(-0.8, -0.1), (-0.6, 0.45), (0.0, 0.7), (0.6, 0.45), (0.8, -0.1)])
    # door track across the floor at the mouth (the bay door's lower guide)
    K.box(m, (-IN_X, Y_MOUTH + 0.3, -0.02), (IN_X, Y_MOUTH + 1.3, 0.02), "WS_Deck", "track")


def build_back(m, lod):
    """The rear shell: lapped rings round the spine collar (the scallop's hinge)."""
    half = section(lod)
    loop = np.concatenate([half[::-1] * [-1, 1], half[1:]])
    loop = np.concatenate([loop, half[::-1][1:] * [1, 1]])
    # a closed loop: left keel -> crown -> right keel -> back to the keel centre
    full = np.concatenate([half * [1, 1], (half[::-1] * [-1, 1])[1:]])
    n = (96, 64, 32, 16)[lod]
    full = K.resample(full, K._cum(full)[-1] / n)
    cz = 22.0
    collar_r = 9.0
    angs = np.arctan2(full[:, 1] - cz, full[:, 0])
    inner = np.stack([np.cos(angs) * collar_r, cz + np.sin(angs) * collar_r], 1)
    rows = 5 if lod <= 1 else 2
    for r in range(rows):
        t0, t1 = r / rows, (r + 1) / rows
        a = inner * (1 - t0) + full * t0
        b = inner * (1 - t1) + full * t1
        depth0 = Y_REAR + 3.0 * (1 - t0) ** 1.5
        depth1 = Y_REAR + 3.0 * (1 - t1) ** 1.5
        grid = np.zeros((len(full), 2, 3))
        lap = 0.25 if lod <= 1 else 0.0
        grid[:, 0] = np.stack([a[:, 0], np.full(len(a), depth0 + lap), a[:, 1]], 1)
        grid[:, 1] = np.stack([b[:, 0], np.full(len(b), depth1), b[:, 1]], 1)
        K.patch(m, grid, "WS_Shell", "plate_band" if r == 1 else "plate", u_off=r * 2.3, smooth=True, away=(0.0, 80.0, cz))
    if lod <= 1:
        for k in range(0, len(full) - 1, max(1, len(full) // (24 if lod == 0 else 12))):
            a = np.array([inner[k, 0] * 1.05, Y_REAR + 3.2, cz + (inner[k, 1] - cz) * 1.05])
            b = np.array([full[k, 0], Y_REAR + 0.5, full[k, 1]])
            K.tube(m, [a, b], 0, 0, "WS_Shell", "rib", smooth=True, up=(0, 1, 0), profile=[(-0.6, -0.1), (-0.45, 0.35), (0.0, 0.55), (0.45, 0.35), (0.6, -0.1)])
    # the collar: the kit's standard docking interface
    import ws_parts as P

    P.place(m, P.collar_mesh(lod), (0.0, Y_REAR + 3.0, cz), (0, 1, 0))


def collar(m, centre, lod, facing=1, axis="y"):
    """The kit's standard collar: 18 m across, 2.5 m deep, its mating face 2.5 m from `centre` along `facing`.
    Clamp teeth every 30 degrees and a signal-orange ring at the face."""
    n = (36, 24, 12, 8)[lod]
    c = np.asarray(centre, np.float64)
    prof = [(9.0, 0.0), (9.0, 1.6), (8.4, 1.9), (8.4, 2.5), (6.8, 2.5), (6.8, 1.0), (6.2, 0.6)]
    prof = [(r, h * facing) for r, h in prof]
    keys = ["accent", "signal", "lip", "lip", "trim"]
    for i in range(len(prof) - 1):
        seg = [prof[i], prof[i + 1]]
        mat = "WS_Metal" if keys[min(i, 4)] == "trim" else "WS_Shell"
        K.revolve(m, seg, n, mat, keys[min(i, 4)], center=c, axis="y", smooth=True, away=lambda q, c=c: np.array([c[0], q[1], c[2]]) if abs(q[1] - c[1]) < 2.4 else q - np.array([0, facing, 0]))
    if lod <= 1:
        for k in range(12):
            a = k * math.pi / 6
            ca, sa = math.cos(a), math.sin(a)
            p = c + np.array([ca * 8.7, 0, sa * 8.7])
            xf = Matrix.Translation(p) @ Matrix.Rotation(-a, 4, "Y")
            K.box(m, (-0.5, 0.2 * facing if facing > 0 else -2.2, -0.45), (0.5, 2.2 if facing > 0 else -0.2, 0.45), "WS_Metal", "machine", xf=xf)


def build_floor(m, lod):
    # hall floor in 6 bands so the planar tiles carry a little offset per band
    for i, (y0, y1) in enumerate(((-60, -35), (-35, -10), (-10, 15), (15, 40), (40, 65), (65, 90))):
        K.planar(m, [(-IN_X, y0, 0), (IN_X, y0, 0), (IN_X, y1, 0), (-IN_X, y1, 0)], "WS_Floor", off=(i * 0.37, i * 0.19))
    # walkways: the centre aisle to the trade deck and the cross aisles between pad rows
    if lod <= 2:
        K.box(m, (-1.5, -58.0, 0.0), (1.5, 68.0, 0.03), "WS_Deck", "walk", skip=("-z",))
        for y in (42.5, 17.5, -7.5, -32.5):
            for x0, x1 in ((-63.0, -1.5), (1.5, 63.0)):
                K.box(m, (x0, y - 1.0, 0.0), (x1, y + 1.0, 0.03), "WS_Deck", "walk", skip=("-z",), u_off=x0 * 0.03)
    # floor slab edge under the mouth (the lip ships cross)
    K.box(m, (-IN_X - 1, Y_MOUTH - 7.2, -4.0), (IN_X + 1, Y_MOUTH, 0.0), "WS_Shell", "lip", skip=("-z",))


def build_pads(m, lod, decals=True):
    seg = (48, 32, 16, 8)[lod]
    for idx, (x, y) in enumerate(pad_centres()):
        c = (x, y, 0.0)
        uo = idx * 1.37
        if lod <= 2:
            K.revolve(m, [(PAD_R, 0.0), (PAD_R - 0.6, PAD_TOP)], seg, "WS_Shell", "lip", center=c, axis="z", smooth=False, u_off=uo, away=(x, y, -6.0))
            K.revolve(m, [(PAD_R - 0.6, PAD_TOP), (9.4, PAD_TOP)], seg, "WS_Deck", "ring", center=c, axis="z", smooth=False, u_off=uo, away=(x, y, -6.0))
            # the heat-tile field, planar mapped
            ang = np.linspace(0, 2 * math.pi, seg + 1)
            ring = [(x + 9.4 * math.cos(a), y + 9.4 * math.sin(a), PAD_TOP) for a in ang[:-1]]
            ring2 = [(x + 4.0 * math.cos(a), y + 4.0 * math.sin(a), PAD_TOP) for a in ang[:-1]]
            for k in range(seg):
                K.planar(m, [ring2[k], ring[k], ring[(k + 1) % seg], ring2[(k + 1) % seg]], "WS_Floor", off=(0.13 * idx, 0.29 * idx))
            K.planar(m, ring2, "WS_Floor", off=(0.13 * idx, 0.29 * idx))
        else:
            K.revolve(m, [(PAD_R, 0.0), (PAD_R - 0.6, PAD_TOP)], seg, "WS_Deck", "ring", center=c, axis="z", smooth=False, u_off=uo, away=(x, y, -6.0))
            ang = np.linspace(0, 2 * math.pi, seg + 1)
            K.planar(m, [(x + (PAD_R - 0.6) * math.cos(a), y + (PAD_R - 0.6) * math.sin(a), PAD_TOP) for a in ang[:-1]], "WS_Floor")
        if decals and lod <= 2:
            z = PAD_TOP + 0.02
            # scorch where thrust lands (a slightly different size and turn per pad)
            r = 6.5 + (idx % 5) * 0.35
            a0 = idx * 0.9
            corners = [(x + r * math.cos(a0 + q * math.pi / 2 + math.pi / 4) * 1.414, y + r * math.sin(a0 + q * math.pi / 2 + math.pi / 4) * 1.414, z) for q in range(4)]
            m.add(corners, [(0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
            # the pad number, read from the aisle side (toward the mouth: -y)
            k = idx
            cu, cv = (k % 8) * 0.125, 1.0 - 0.125 - (k // 8) * 0.125
            s = 2.6
            py = y - 7.6
            pts = [(x - s, py - s, z + 0.01), (x + s, py - s, z + 0.01), (x + s, py + s, z + 0.01), (x - s, py + s, z + 0.01)]
            m.add(pts, [(cu, cv), (cu + 0.125, cv), (cu + 0.125, cv + 0.125), (cu, cv + 0.125)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
        if lod == 0:
            # rim lights: eight studs on the chamfer, the only emissive on a pad
            for q in range(8):
                a = q * math.pi / 4 + math.pi / 8
                px, py = x + (PAD_R - 0.3) * math.cos(a), y + (PAD_R - 0.3) * math.sin(a)
                xf = Matrix.Translation((px, py, PAD_TOP * 0.5)) @ Matrix.Rotation(a, 4, "Z")
                K.box(m, (-0.08, -0.3, -0.06), (0.08, 0.3, 0.12), "NavWhite", None, xf=xf)


def build_walls(m, lod):
    zs = np.arange(0.0, IN_Z + 0.01, 2.0)
    for sgn in (1, -1):
        x = IN_X * sgn
        for i in range(len(zs) - 1):
            z0, z1 = zs[i], zs[i + 1]
            if 26.0 <= z0 < 36.0 and lod <= 2:
                continue  # the window band
            key = "plate_band" if i == 0 else ("accent" if i == 1 else "plate")
            grid = [[(x, Y_MOUTH, z0), (x, Y_MOUTH, z1)], [(x, Y_BACK, z0), (x, Y_BACK, z1)]]
            K.patch(m, grid, "WS_Shell", key, u_off=i * 2.9, toward=lambda c: np.array([0.0, c[1], 20.0]))
        if lod <= 2:
            # window band: Ixari crystal panes between the frame columns, leaning in like grown facets
            ys = np.arange(Y_MOUTH, Y_BACK + 0.01, 15.0)
            for j in range(len(ys) - 1):
                y0, y1 = ys[j] + 1.0, ys[j + 1] - 1.0
                inset = 0.6 * sgn
                K.patch(m, [[(x, y0, 26), (x - inset, y0 + 0.5, 31)], [(x, y1, 26), (x - inset, y1 - 0.5, 31)]], "WS_Glass", None, toward=lambda c: np.array([0.0, c[1], 20.0]))
                K.patch(m, [[(x - inset, y0 + 0.5, 31), (x, y0, 36)], [(x - inset, y1 - 0.5, 31), (x, y1, 36)]], "WS_Glass", None, toward=lambda c: np.array([0.0, c[1], 20.0]))
                K.patch(m, [[(x, y0 - 1.0, 26), (x, y0 - 1.0, 36)], [(x, y0, 26), (x, y0, 36)]], "WS_Metal", "trim", toward=lambda c: np.array([0.0, c[1], 20.0]))
                K.patch(m, [[(x, y1, 26), (x, y1, 36)], [(x, y1 + 1.0, 26), (x, y1 + 1.0, 36)]], "WS_Metal", "trim", toward=lambda c: np.array([0.0, c[1], 20.0]))
        # kick plate along the floor (carts and tugs scrape here)
        K.box(m, (x - 0.25 * sgn if sgn > 0 else x, Y_MOUTH, 0), (x if sgn > 0 else x + 0.25, Y_BACK, 0.5), "WS_Shell", "lip")
    # the back wall
    for i in range(len(zs) - 1):
        z0, z1 = zs[i], zs[i + 1]
        key = "plate_band" if i == 0 else ("accent" if i == 1 else "plate")
        K.patch(m, [[(IN_X, Y_BACK, z0), (IN_X, Y_BACK, z1)], [(-IN_X, Y_BACK, z0), (-IN_X, Y_BACK, z1)]], "WS_Shell", key, u_off=i * 1.3, toward=(0.0, 0.0, 20.0))
    # ceiling: a shallow vault of plate rows along y
    n = (33, 17, 9, 3)[lod]
    xs = np.linspace(-IN_X, IN_X, n)
    zc = IN_Z + 4.0 * (1 - (xs / IN_X) ** 2)
    prof = np.stack([xs, zc], 1)
    K.lapped_rows(m, prof, Y_MOUTH, Y_BACK, "WS_Shell", lambda i: "plate", row=2.0, lap=0.0, lod=2, flip=False, seed=3, toward=lambda c: np.array([0.0, c[1], 10.0]))


def truss(m, x0, x1, y, z_top, depth, n, lod, key="lattice"):
    """An arched lattice truss across the hall at y (Ulgani lattice: triangulated, lightly curved)."""
    xs = np.linspace(x0, x1, n + 1)
    span = (x1 - x0) / 2
    top = [(x, y, z_top + 4.0 * (1 - (x / span) ** 2) - 0.6) for x in xs]
    bot = [(x, y, z_top + 4.0 * (1 - (x / span) ** 2) - depth * (0.45 + 0.55 * (1 - (x / span) ** 2))) for x in xs]
    w = 0.7 if lod == 0 else 0.8
    K.tube(m, top, 0, 0, "WS_Metal", key, smooth=False, up=(0, 1, 0), profile=[(-0.35, -0.35), (0.35, -0.35), (0.35, 0.35), (-0.35, 0.35), (-0.35, -0.35)])
    K.tube(m, bot, 0, 0, "WS_Metal", key, smooth=False, up=(0, 1, 0), profile=[(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3), (-0.3, -0.3)])
    if lod <= 1:
        for i in range(n):
            a = top[i] if i % 2 == 0 else bot[i]
            b = bot[i + 1] if i % 2 == 0 else top[i + 1]
            K.beam(m, np.array(a), np.array(b), 0.36, 0.36, "WS_Metal", key, up=(0, 1, 0), bevel=0.08 if lod == 0 else 0.0)
        # the light strip under the bottom chord: the hall's lamps, nav white only in the lens
        if lod == 0:
            for i in range(1, n - 1, 2):
                a, b = np.array(bot[i]), np.array(bot[i + 1])
                K.beam(m, a - [0, 0, 0.45], b - [0, 0, 0.45], 0.5, 0.18, "WS_Metal", "light", up=(0, 1, 0))
    return top, bot


def build_frame(m, lod):
    ys = np.arange(Y_MOUTH + 0.0, Y_BACK + 0.01, 15.0)
    for j, y in enumerate(ys):
        if lod >= 2 and j % 2:
            continue
        if lod == 3:
            break
        n = (16, 10, 6, 4)[lod]
        truss(m, -IN_X + 0.5, IN_X - 0.5, y, IN_Z, 4.5, n, lod)
        # wall columns: a lattice ladder up each wall, fused into the truss
        for sgn in (1, -1):
            x = (IN_X - 0.4) * sgn
            K.beam(m, np.array([x, y, 0.0]), np.array([x, y, IN_Z]), 0.8, 0.8, "WS_Metal", "lattice", up=(1, 0, 0), bevel=0.12 if lod == 0 else 0.0)
            if lod == 0:
                x2 = (IN_X - 1.6) * sgn
                K.beam(m, np.array([x2, y, 7.6]), np.array([x2, y, IN_Z - 3.0]), 0.4, 0.4, "WS_Metal", "lattice", up=(1, 0, 0))
                for z in np.arange(8.0, IN_Z - 4, 4.0):
                    a = np.array([x, y, z])
                    b = np.array([x2, y, z + 2.0])
                    K.beam(m, a, b, 0.3, 0.3, "WS_Metal", "lattice", up=(0, 1, 0))
                # a fillet bracket where the column meets the floor (members fuse, never bolt)
                K.beam(m, np.array([x, y, 0.0]), np.array([x - 1.4 * sgn, y, 0.0]) + [0, 0, 0.01], 1.0, 0.02, "WS_Metal", "lattice")


def build_gantries(m, lod):
    """Catwalks along both walls at the trade deck's level (7 m), railings at 1.05 m."""
    z = 7.0
    for sgn in (1, -1):
        xi, xo = (IN_X - 4.0) * sgn, (IN_X - 0.8) * sgn
        x0, x1 = min(xi, xo), max(xi, xo)
        K.box(m, (x0, Y_MOUTH + 4, z - 0.3), (x1, 68.0, z), "WS_Deck", "walk", keys={"-z": "deck"})
        K.box(m, (x0, Y_MOUTH + 4, z - 0.9), (x1, 68.0, z - 0.3), "WS_Metal", "lattice", skip=("+z", "-z"))
        if lod <= 1:
            # brackets back to the wall columns
            for y in np.arange(Y_MOUTH + 15, 68.0, 15.0):
                K.beam(m, np.array([xi, y, z - 0.9]), np.array([xo + 0.6 * sgn, y, z - 4.0]), 0.3, 0.3, "WS_Metal", "lattice", up=(0, 1, 0))
            railing(m, (xi, Y_MOUTH + 4, z), (xi, 68.0, z), lod)


def railing(m, a, b, lod, post_step=2.0, height=1.05):
    a, b = np.array(a, np.float64), np.array(b, np.float64)
    L = np.linalg.norm(b - a)
    n = max(1, int(round(L / post_step)))
    sides = 6 if lod == 0 else 4
    K.tube(m, [a + [0, 0, height], b + [0, 0, height]], 0.035, sides, "WS_Metal", "rail", up=(0, 0, 1))
    if lod == 0:
        K.tube(m, [a + [0, 0, 0.55], b + [0, 0, 0.55]], 0.025, 4, "WS_Metal", "trim", up=(0, 0, 1))
        for i in range(n + 1):
            p = a + (b - a) * i / n
            K.box(m, p + [-0.03, -0.03, 0.0], p + [0.03, 0.03, height], "WS_Metal", "trim")


def build_exterior_frame(m, lod):
    """Ribs over the shell: a scallop fan over the roof from the hinge at the spine collar, and the frame's columns
    down the flanks between the crystal window bays."""
    if lod == 3:
        return
    half = section(0)
    nfan = (13, 9, 7)[lod]
    hinge_y = Y_REAR - 6.0
    roofx = 66.0
    for i in range(nfan):
        X = -roofx + 2 * roofx * i / (nfan - 1)
        ts = np.linspace(0, 1, (24, 14, 8)[lod])
        pts = []
        for t in ts:
            y = hinge_y + (Y_FRONT + 1.0 - hinge_y) * t
            x = X * (t ** 0.8)
            pts.append((x, y, roof_z(x) + 0.35))
        K.tube(m, pts, 0, 0, "WS_Shell", "rib", smooth=True, up=(0, 0, 1), profile=[(-0.9, -0.1), (-0.7, 0.45), (0.0, 0.75), (0.7, 0.45), (0.9, -0.1)])
    # the lattice frame standing proud of the flanks: paired chords with a zigzag web, every 15 m
    side = half[(half[:, 0] > 40) & (half[:, 1] > -7)]
    side = K.resample(side, 3.0 if lod == 0 else 6.0)
    nrm2 = []
    for k in range(len(side)):
        a, b = side[max(0, k - 1)], side[min(len(side) - 1, k + 1)]
        d = b - a
        nn = np.array([d[1], -d[0]])
        nrm2.append(nn / np.linalg.norm(nn))
    nrm2 = np.array(nrm2)
    sq = [(-0.4, -0.4), (0.4, -0.4), (0.4, 0.4), (-0.4, 0.4), (-0.4, -0.4)]
    for j, y in enumerate(np.arange(Y_MOUTH + 7.5, Y_BACK, 15.0)):
        if lod == 2 and j % 2:
            continue
        for sgn in (1, -1):
            inner = [np.array([(p[0] + n[0] * 0.5) * sgn, y, p[1] + n[1] * 0.5]) for p, n in zip(side, nrm2)]
            outer = [np.array([(p[0] + n[0] * 2.4) * sgn, y, p[1] + n[1] * 2.4]) for p, n in zip(side, nrm2)]
            K.tube(m, inner, 0, 0, "WS_Metal", "lattice", smooth=False, up=(0, 1, 0), profile=sq)
            K.tube(m, outer, 0, 0, "WS_Metal", "lattice", smooth=False, up=(0, 1, 0), profile=sq)
            if lod <= 1:
                for k in range(len(inner) - 1):
                    a, b = (inner[k], outer[k + 1]) if k % 2 == 0 else (outer[k], inner[k + 1])
                    K.beam(m, a, b, 0.42, 0.42, "WS_Metal", "lattice", up=(0, 1, 0))
    # crystal windows between the frames: clusters of leaning hexagonal prisms grown out of the shell, lit from within
    if lod <= 2:
        rng = np.random.default_rng(5)
        for y in np.arange(Y_MOUTH + 15.0, Y_BACK - 1, 15.0):
            for sgn in (1, -1):
                for q, (L, r, dz, dy) in enumerate(((12.5, 3.0, 0.0, 0.0), (8.5, 2.2, -4.2, 1.8), (6.0, 1.7, 3.6, -2.2))):
                    if lod == 2 and q:
                        continue
                    L *= 0.9 + rng.random() * 0.2
                    zc = 29.0 + dz + rng.random() * 0.8
                    xs = 77.2 - abs(dz) * 0.15
                    tilt = 0.32 + rng.random() * 0.12
                    crystal(m, np.array([xs * sgn, y + dy, zc]), sgn, L, r, tilt, rng, lod)


def crystal(m, c, sgn, L, r, tilt, rng, lod):
    """A hexagonal prism lying along y, leaning out of the shell, pointed at both ends, seated in a sooted collar."""
    ax = np.array([np.cos(-tilt) * sgn, 0, np.sin(-tilt)])
    up = np.array([-np.sin(-tilt) * sgn, 0, np.cos(-tilt)])
    c = c + ax * r * 0.45
    ring = lambda yy, sc: [c + np.array([0, yy, 0]) + (ax * np.cos(a * np.pi / 3 + 0.2) * 0.8 + up * np.sin(a * np.pi / 3 + 0.2)) * r * sc for a in range(6)]
    ends = (-L / 2, L / 2)
    ra, rb = ring(ends[0], 1.0), ring(ends[1], 1.0)
    tip_a = c + np.array([0, ends[0] - r * 0.9, 0]) + ax * r * 0.25
    tip_b = c + np.array([0, ends[1] + r * 0.7, 0]) + ax * r * 0.2
    for q in range(6):
        q2 = (q + 1) % 6
        lit = q in (0, 5)
        K.patch(m, [[ra[q], ra[q2]], [rb[q], rb[q2]]], "WS_LitGlass" if lit else "WS_Glass", None, away=c)
        K.patch(m, [[ra[q], ra[q2]], [tip_a, tip_a]], "WS_Glass", None, away=c)
        K.patch(m, [[rb[q], rb[q2]], [tip_b, tip_b]], "WS_Glass", None, away=c)
    # growth terraces: a stepped collar part-way along each prism, and the socket collar at the shell
    if lod <= 1:
        for yy in (ends[0] + L * 0.3,):
            rr = ring(yy, 1.08)
            K.tube(m, rr + [rr[0]], 0, 0, "WS_Metal", "machine", smooth=False, up=(0, 1, 0), profile=[(-0.16, -0.12), (0.16, -0.12), (0.16, 0.12), (-0.16, 0.12), (-0.16, -0.12)])
    base = [c - ax * r * 0.55 + np.array([0, yy, 0]) for yy in np.linspace(ends[0] - 0.4, ends[1] + 0.4, 2)]
    K.beam(m, base[0], base[1], r * 1.5, 0.8, "WS_Metal", "machine", up=tuple(ax))


def build_wings(m, lod):
    """Radiator wings off the aft eaves: a lattice spar carrying three fin panels canted up, the hangar's read at range."""
    tilt = math.radians(9)
    for sgn in (1, -1):
        root = np.array([71.0 * sgn, 62.0, 44.0])
        rot = Matrix.Rotation(0 if sgn > 0 else math.pi, 4, "Z") @ Matrix.Rotation(-tilt, 4, "Y")
        if lod == 3:
            K.box(m, (4.0, -17.0, -0.25), (38.0, 17.0, 0.25), "WS_Metal", "radiator", xf=Matrix.Translation(tuple(root)) @ rot)
            continue
        for k, dy in enumerate((-11.5, 0.0, 11.5)):
            xf = Matrix.Translation(tuple(root + np.array([0, dy, 0]))) @ rot
            K.box(m, (5.0, -5.0, -0.22), (38.0, 5.0, 0.22), "WS_Metal", "radiator", keys={"+x": "trim", "-x": "trim", "+y": "trim", "-y": "trim"}, xf=xf)
            K.box(m, (4.0, -5.4, -0.35), (38.6, -5.0, 0.35), "WS_Shell", "signal" if k == 1 else "lip", xf=xf)
            K.box(m, (4.0, 5.0, -0.35), (38.6, 5.4, 0.35), "WS_Shell", "lip", xf=xf)
            K.box(m, (38.0, -5.4, -0.45), (39.0, 5.4, 0.45), "WS_Shell", "accent", xf=xf)
            if lod <= 1:
                for t in (0.0, 0.33, 0.66, 1.0):
                    p0 = xf @ Vector((5.0 + 33.0 * t, -5.0, -0.45))
                    p1 = xf @ Vector((5.0 + 33.0 * t, 5.0, -0.45))
                    K.beam(m, np.array(p0), np.array(p1), 0.4, 0.4, "WS_Metal", "lattice", up=(0, 0, 1))
        # the spar: from the eave's frame out under the panels, braced back to the flank
        xf = Matrix.Translation(tuple(root)) @ rot
        s0, s1 = np.array(xf @ Vector((0.0, -18.0, -1.2))), np.array(xf @ Vector((0.0, 18.0, -1.2)))
        K.beam(m, s0, s1, 1.2, 1.2, "WS_Metal", "lattice", up=(1, 0, 0))
        for y in (-11.5, 0.0, 11.5):
            p0 = np.array(xf @ Vector((0.0, y, -1.2)))
            p1 = np.array(xf @ Vector((22.0, y, -0.8)))
            K.beam(m, p0, p1, 0.8, 0.8, "WS_Metal", "lattice", up=(0, 0, 1))
            if lod <= 1:
                K.beam(m, np.array([75.0 * sgn, 62.0 + y, 30.0]), p1 + np.array([0, 0, -0.4]), 0.5, 0.5, "WS_Metal", "lattice", up=(0, 1, 0))


def build_mast(m, lod):
    """The beacon mast on the hinge of the roof's fan: a three-chord lattice with nav lights, 34 m tall."""
    base = np.array([0.0, Y_REAR - 10.0, roof_z(0) + 0.5])
    H = 34.0
    if lod == 3:
        K.tube(m, [base, base + [0, 0, H]], 0.8, 3, "WS_Metal", "lattice", smooth=False)
        return
    chords = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        p0 = base + np.array([math.cos(a) * 2.2, math.sin(a) * 2.2, 0.0])
        p1 = base + np.array([math.cos(a) * 0.7, math.sin(a) * 0.7, H])
        chords.append((p0, p1))
        K.beam(m, p0, p1, 0.35, 0.35, "WS_Metal", "lattice", up=(math.cos(a), math.sin(a), 0))
    if lod <= 1:
        n = 10
        for j in range(n):
            for k in range(3):
                a0, a1 = chords[k]
                b0, b1 = chords[(k + 1) % 3]
                pa = a0 + (a1 - a0) * j / n
                pb = b0 + (b1 - b0) * (j + 1) / n
                K.beam(m, pa, pb, 0.16, 0.16, "WS_Metal", "lattice", up=(0, 0, 1))
    K.revolve(m, [(1.6, 0.0), (1.6, 0.6), (1.0, 1.0)], 12, "WS_Shell", "signal", center=tuple(base + [0, 0, H * 0.55]), axis="z", away=tuple(base + [0, 0, H * 0.55 - 3]))
    K.revolve(m, [(0.0, 1.4), (0.6, 0.9), (0.6, 0.0)], 10, "NavWhite", None, center=tuple(base + [0, 0, H]), axis="z", away=tuple(base + [0, 0, H - 3]))
    K.revolve(m, [(0.0, 0.5), (0.45, 0.3), (0.45, 0.0)], 8, "NavRed", None, center=tuple(base + [0, 0, H * 0.55 + 1.0]), axis="z", away=tuple(base + [0, 0, H * 0.55 - 3]))


def build_keel(m, lod):
    """Under the floor: radiator fins and plant boxes in the shell's belly (seen on approach)."""
    if lod >= 2:
        K.box(m, (-30, -40, -11.0), (30, 70, -8.0), "WS_Metal", "machine")
        return
    for i, x in enumerate((-36.0, -12.0, 12.0, 36.0)):
        K.box(m, (x - 8, -45, -11.5), (x + 8, 75, -8.0), "WS_Metal", "machine", u_off=i * 2.1)
        for k in range(10 if lod == 0 else 5):
            y = -40 + k * (110 / (10 if lod == 0 else 5))
            K.box(m, (x - 7.5, y, -14.5), (x + 7.5, y + 0.3, -11.5), "WS_Metal", "radiator", u_off=k * 0.7)
    # a conduit run the length of the belly
    for x in (-24.0, 24.0):
        K.tube(m, [(x, -55, -9.5), (x, 85, -9.5)], 1.0, 10 if lod == 0 else 6, "WS_Metal", "pipe", up=(0, 0, 1))


def build_nav(m, lod):
    if lod == 3:
        return
    for (x, z, mat) in ((-74.0, 47.0, "NavRed"), (74.0, 47.0, "NavGreen"), (0.0, 61.0, "NavWhite")):
        K.revolve(m, [(0.0, -0.6), (0.45, -0.3), (0.5, 0.0)], 10, mat, None, center=(x * 1.08, Y_LIP - 0.2, z * 1.08), axis="y", smooth=True, away=(x * 1.08, Y_LIP + 2, z * 1.08))
    K.revolve(m, [(0.0, 0.8), (0.6, 0.4), (0.6, 0.0)], 10, "NavWhite", None, center=(0.0, Y_REAR - 6.0, roof_z(0) + 0.6), axis="z", away=(0.0, Y_REAR - 6.0, roof_z(0) - 2))


def build_interior_detail(m, lod):
    """Service doors (3.0 x 2.0 m) at floor and gantry level, conduits along the walls, drain grates at the wall foot,
    the Compact mark at the mouth's aisle, lit signs over the doors."""
    for sgn in (1, -1):
        x = IN_X * sgn
        xin = x - 0.02 * sgn
        for y in (-30.0, 0.0, 30.0, 60.0) if lod == 0 else (-30.0, 30.0):
            for z in (0.0, 7.0):
                if z == 7.0 and y > 66:
                    continue
                f = lambda a, b, c_: (xin - a * sgn, b, c_)
                # frame: two jambs and a signal-orange header, the leaf, a worn threshold
                K.box(m, (min(x, x - 0.5 * sgn), y - 1.6, z), (max(x, x - 0.5 * sgn), y - 1.0, z + 3.4), "WS_Shell", "lip")
                K.box(m, (min(x, x - 0.5 * sgn), y + 1.0, z), (max(x, x - 0.5 * sgn), y + 1.6, z + 3.4), "WS_Shell", "lip")
                K.box(m, (min(x, x - 0.5 * sgn), y - 1.6, z + 3.0), (max(x, x - 0.5 * sgn), y + 1.6, z + 3.5), "WS_Shell", "signal")
                K.box(m, (min(x, x - 0.12 * sgn), y - 1.0, z), (max(x, x - 0.12 * sgn), y + 1.0, z + 3.0), "WS_Metal", "machine")
                K.box(m, (min(x, x - 1.2 * sgn), y - 1.0, z), (max(x, x - 1.2 * sgn), y + 1.0, z + 0.03), "WS_Shell", "lip", skip=("-z",))
                K.box(m, (min(x, x - 0.15 * sgn), y - 0.8, z + 3.6), (max(x, x - 0.15 * sgn), y + 0.8, z + 3.85), "WS_Metal", "light")
        # conduits along the wall above the gantry, with brackets every 5 m
        for z, r in ((10.6, 0.32), (11.4, 0.22)):
            K.tube(m, [(x - 0.6 * sgn, Y_MOUTH + 2, z), (x - 0.6 * sgn, Y_BACK - 1, z)], r, 8 if lod == 0 else 5, "WS_Metal", "pipe", u_off=z)
        if lod == 0:
            for y in np.arange(Y_MOUTH + 5, Y_BACK, 5.0):
                K.box(m, (min(x, x - 1.0 * sgn), y - 0.1, 10.1), (max(x, x - 1.0 * sgn), y + 0.1, 11.8), "WS_Metal", "trim")
        # drain grate at the wall foot (wash-down water and spilled coolant run here)
        K.box(m, (min(x - 0.5 * sgn, x - 1.0 * sgn), Y_MOUTH + 2, -0.01), (max(x - 0.5 * sgn, x - 1.0 * sgn), Y_BACK - 1, 0.015), "WS_Deck", "track", skip=("-z",))
    # the Compact mark on the floor of the centre aisle near the mouth, and chevrons leading in
    z = 0.035
    m.add([(-5.0, -46.0, z), (5.0, -46.0, z), (5.0, -36.0, z), (-5.0, -36.0, z)], [(0.0, 0.25), (0.25, 0.25), (0.25, 0.5), (0.0, 0.5)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
    for y in (-56.0, -52.0):
        m.add([(-1.4, y, z), (1.4, y, z), (1.4, y + 2.8, z), (-1.4, y + 2.8, z)], [(0.25, 0.25), (0.5, 0.25), (0.5, 0.5), (0.25, 0.5)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
    # oil and skid marks off the pads toward the aisles (where tugs turn)
    rng = np.random.default_rng(12)
    for i, (px, py) in enumerate(pad_centres()):
        if i % 3:
            continue
        dx = rng.uniform(-4, 4)
        y0 = py - PAD_R - 0.5
        m.add([(px - 6 + dx, y0 - 3.0, z), (px + 6 + dx, y0 - 3.0, z), (px + 6 + dx, y0, z), (px - 6 + dx, y0, z)], [(0.5, 0.0), (1.0, 0.0), (1.0, 0.25), (0.5, 0.25)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
        m.add([(px - 2 + dx, py - 6.0, PAD_TOP + 0.03), (px + 2 + dx, py - 6.0, PAD_TOP + 0.03), (px + 2 + dx, py - 2.0, PAD_TOP + 0.03), (px - 2 + dx, py - 2.0, PAD_TOP + 0.03)], [(0.25, 0.0), (0.5, 0.0), (0.5, 0.25), (0.25, 0.25)], "WS_Decal", toward=lambda c: c + np.array([0, 0, 1.0]))
    # cable trays between the trusses, under the ceiling
    for x in (-30.0, 30.0):
        K.box(m, (x - 0.6, Y_MOUTH + 1, IN_Z + 1.2), (x + 0.6, Y_BACK - 1, IN_Z + 1.5), "WS_Metal", "machine")


def build_lod(lod):
    m = K.Mesh()
    build_shell(m, lod)
    build_mouth(m, lod)
    build_back(m, lod)
    build_floor(m, lod)
    build_pads(m, lod)
    build_walls(m, lod)
    build_frame(m, lod)
    if lod <= 2:
        build_gantries(m, lod)
    build_exterior_frame(m, lod)
    build_wings(m, lod)
    build_mast(m, lod)
    if lod <= 1:
        build_interior_detail(m, lod)
    build_keel(m, lod)
    build_nav(m, lod)
    return m


def build(sc, root):
    import bpy

    asset = K.new_collection("ws_hangar", root)
    for lod in range(4):
        c = K.new_collection(f"ws_hangar_LOD{lod}", asset)
        m = build_lod(lod)
        print(f"ws_hangar LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
        m.build(f"ws_hangar_L{lod}", c)
    # colliders: the shell's solid parts (walkers and ships)
    K.collider(asset, "COL_Floor", (-77, Y_LIP, -12), (77, Y_REAR, 0))
    K.collider(asset, "COL_Wall_L", (-78, Y_MOUTH, 0), (-IN_X, Y_REAR, IN_Z + 6))
    K.collider(asset, "COL_Wall_R", (IN_X, Y_MOUTH, 0), (78, Y_REAR, IN_Z + 6))
    K.collider(asset, "COL_Roof", (-84, Y_LIP, IN_Z), (84, Y_REAR, 64))
    K.collider(asset, "COL_Back", (-IN_X, Y_BACK, 0), (IN_X, Y_REAR + 3, IN_Z))
    K.collider(asset, "COL_Hood_L", (-84, Y_LIP, 0), (-IN_X, Y_MOUTH, IN_Z))
    K.collider(asset, "COL_Hood_R", (IN_X, Y_LIP, 0), (84, Y_MOUTH, IN_Z))
    for sgn, nm in ((1, "R"), (-1, "L")):
        xi, xo = (IN_X - 4.0) * sgn, IN_X * sgn
        K.collider(asset, f"COL_Gantry_{nm}", (min(xi, xo), Y_MOUTH + 4, 6.1), (max(xi, xo), 68.0, 7.0))
    for i, (x, y) in enumerate(pad_centres()):
        n = 12
        verts = []
        for k in range(n):
            a = 2 * math.pi * k / n
            verts.append((x + PAD_R * math.cos(a), y + PAD_R * math.sin(a), 0.0))
        for k in range(n):
            a = 2 * math.pi * k / n
            verts.append((x + (PAD_R - 0.6) * math.cos(a), y + (PAD_R - 0.6) * math.sin(a), PAD_TOP))
        faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
        K.collider_mesh(asset, f"COL_Pad_{i + 1:02d}", verts, faces)
        K.empty(asset, f"BAY_Pad_{i + 1:02d}", (x, y, PAD_TOP), size=3.0, props={"pad": i + 1, "radius": PAD_R - 0.6})
    K.empty(asset, "BAY_Mouth", (0, Y_LIP - 40, 21.0), size=6.0, props={"approach": True})
    # sockets: +Y of each empty points out of the module through its mating face
    K.empty(asset, "Socket_Spine", (0, Y_REAR + 3.0 + 2.5, 22.0), size=6.0, props={"interface": "collar"})
    K.empty(asset, "Socket_TradeDeck", (0, Y_BACK, 0.0), rot=(0, 0, math.pi), size=6.0, props={"interface": "tradedeck"})
    K.empty(asset, "Socket_BayDoor", (0, Y_MOUTH, 0.0), rot=(0, 0, math.pi), size=6.0, props={"interface": "baydoor"})
    for i, y in enumerate((-45.0, -10.0, 25.0, 60.0)):
        K.empty(asset, f"Light_Hall_{i + 1}", (0, y, 38.0), size=2.0, props={"color": "#FFF6EA", "intensity": 2.5, "distance": 90.0})
    return asset
