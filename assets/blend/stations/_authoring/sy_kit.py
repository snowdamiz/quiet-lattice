"""The Scrapyard kit (DESIGN 13): the Free Reaches' base in a hollowed asteroid. sy_rock is the rock with its cavity and
mouth; sy_mouth a welded girder gate bolted into the mouth; sy_dock a cantilevered landing pad; sy_deck the deck to
fight across, with cover and a container hold. Docks and decks mount on the cavity wall at the rock's Socket_* anchors."""
import math

import numpy as np
from mathutils import Matrix, Vector

import kit as K

R0 = 80.0
MOUTH = math.radians(19.0)
INNER = 0.64
rng0 = np.random.default_rng(1317)
WAVES = [(rng0.normal(size=3), rng0.uniform(1.5, 6.0), rng0.uniform(0, 6.28)) for _ in range(18)]
CRATERS = [(rng0.normal(size=3), rng0.uniform(0.12, 0.34), rng0.uniform(0.06, 0.14)) for _ in range(12)]


def _dir(theta, phi):
    """theta from -Y (the mouth), phi round it."""
    return np.array([math.sin(theta) * math.cos(phi), -math.cos(theta), math.sin(theta) * math.sin(phi)])


def radius(d, inner=False):
    f = 0.0
    tot = 0.0
    for k, fr, ph in WAVES:
        k = k / np.linalg.norm(k)
        a = 1.0 / fr
        f += a * math.sin(np.dot(k, d) * fr + ph)
        tot += a
    f /= tot
    ridge = 1 - abs(math.sin(d[0] * 2.3 + d[2] * 1.7 + 0.4))
    r = R0 * (1 + 0.24 * f + 0.10 * math.sin(d[0] * 2.1 + 1.0) * math.cos(d[2] * 1.6) + 0.07 * ridge ** 3 + 0.12 * max(0.0, d[1]) ** 2)
    if not inner:
        for c, size, depth in CRATERS:
            c = c / np.linalg.norm(c)
            ang = math.acos(max(-1, min(1, np.dot(c, d))))
            if ang < size:
                t = ang / size
                r *= 1 - depth * (1 - t * t) + depth * 0.6 * math.exp(-((t - 1) / 0.15) ** 2)
        return r
    return r * INNER * (1 + 0.05 * f)


def mouth_theta(phi, inner=False):
    """The broken mouth: its rim angle wanders with phi, deeper bites where the rock sheared away."""
    t = MOUTH * (1 + 0.16 * math.sin(phi * 3 + 0.7) + 0.09 * math.sin(phi * 7 + 2.1) + 0.05 * math.sin(phi * 13))
    return t * (1.35 if inner else 1.0)


def shell(m, lod, inner):
    nu = (72, 44, 22, 14)[lod] if not inner else (56, 36, 18, 10)[lod]
    nv = (40, 24, 12, 7)[lod] if not inner else (30, 20, 10, 6)[lod]
    phis = np.linspace(0, 2 * math.pi, nu + 1)
    g = np.zeros((nu + 1, nv, 3))
    for i, p in enumerate(phis):
        t0 = mouth_theta(p, inner)
        for j, t in enumerate(np.linspace(0, 1, nv)):
            t = t0 + (math.pi - 0.08 - t0) * (t ** 0.85)
            d = _dir(t, p)
            g[i, j] = d * radius(d, inner)
    g[-1] = g[0]
    if inner:
        K.patch(m, g, "SY_Rock", None, smooth=True, toward=(0, 0, 0), tile_m=22.0)
    else:
        K.patch(m, g, "SY_Rock", None, smooth=True, away=(0, 0, 0), tile_m=22.0)
    # close the back pole
    cap = g[:-1, -1]
    c = cap.mean(0)
    for i in range(len(cap)):
        a, b = cap[i], cap[(i + 1) % len(cap)]
        m.add([a, b, c], [(0, 0), (0.3, 0), (0.15, 0.3)], "SY_Rock", True, away=None if inner else (0, 0, 0), toward=(0, 0, 0) if inner else None)
    return g


def tunnel(m, lod):
    """The mouth: rock folding from the outer rim into the cavity, jagged where it broke."""
    nu = (72, 44, 22, 14)[lod]
    rings = (7, 4, 2, 1)[lod]
    phis = np.linspace(0, 2 * math.pi, nu + 1)
    g = np.zeros((nu + 1, rings + 1, 3))
    for i, p in enumerate(phis):
        a = _dir(mouth_theta(p), p) * radius(_dir(mouth_theta(p), p))
        b = _dir(mouth_theta(p, True), p) * radius(_dir(mouth_theta(p, True), p), True)
        for j in range(rings + 1):
            t = j / rings
            q = a * (1 - t) + b * t
            # bulge toward the axis in the middle: a throat
            ax = np.array([0, q[1], 0])
            q = q + (ax - q) * 0.12 * math.sin(t * math.pi) * (1 + 0.4 * math.sin(p * 5 + 1.3))
            g[i, j] = q
    g[-1] = g[0]
    K.patch(m, g, "SY_Rock", None, smooth=True, toward=lambda c: np.array([0, c[1], 0]), tile_m=22.0)
    return g


def patch_plates(m, lod):
    """Salvage plates bolted over breaches in the rock: the Reaches patch what they cannot fix."""
    if lod >= 2:
        return
    rng = np.random.default_rng(9)
    for k in range(14 if lod == 0 else 7):
        t = rng.uniform(0.5, 2.6)
        p = rng.uniform(0, 2 * math.pi)
        d = _dir(t, p)
        c = d * (radius(d) + 0.35)
        n = d
        up = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        x = np.cross(up, n)
        x /= np.linalg.norm(x)
        y = np.cross(n, x)
        w, h = rng.uniform(6, 14), rng.uniform(4, 9)
        key = ["plate", "oxide", "patch"][k % 3]
        pts = [c + x * sx * w / 2 + y * sy * h / 2 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        g = [[pts[0], pts[3]], [pts[1], pts[2]]]
        K.patch(m, g, "SY_Scrap", key, away=c - n * 3)
        for e in range(4):
            a, b = pts[e], pts[(e + 1) % 4]
            K.beam(m, a + n * 0.15, b + n * 0.15, 0.35, 0.3, "SY_Scrap", "girder", up=tuple(n))


def rock_lod(lod):
    m = K.Mesh()
    shell(m, lod, False)
    shell(m, lod, True)
    tunnel(m, lod)
    patch_plates(m, lod)
    if lod <= 1:
        # an antenna mast and a lamp on the crown, welded from salvage
        top = _dir(math.pi / 2, math.pi / 2)
        base = top * radius(top)
        K.beam(m, base - top * 2, base + top * 22, 0.8, 0.8, "SY_Scrap", "girder", up=(1, 0, 0))
        for k in range(3):
            K.beam(m, base + top * (6 + k * 5), base + top * (6 + k * 5) + np.array([5.0 - k, 0, 0]), 0.3, 0.3, "SY_Scrap", "girder", up=(0, 1, 0))
        K.revolve(m, [(0.0, 0.0), (0.6, 0.4), (0.6, 0.9)], 8, "NavReaches", None, center=tuple(base + top * 22.5), axis="z", away=tuple(base))
    return m


def mouth_lod(lod):
    """A welded octagon of girders in the mouth, struts into the rock, floodlights and a hazard-striped lintel."""
    m = K.Mesh()
    r = 25.0
    n = 8
    pts = [np.array([math.cos(a) * r, 0.0, math.sin(a) * r]) for a in np.linspace(0, 2 * math.pi, n + 1) + math.pi / 8]
    for i in range(n):
        a, b = pts[i], pts[i + 1]
        if lod == 3:
            K.tube(m, [a, b], 1.4, 3, "SY_Scrap", "girder", smooth=False, up=(0, 1, 0))
            continue
        # an I-beam: two flanges and a web
        d = (b - a) / np.linalg.norm(b - a)
        out = np.cross(d, np.array([0, 1.0, 0]))
        K.beam(m, a + out * 1.0, b + out * 1.0, 0.3, 2.4, "SY_Scrap", "girder", up=(0, 1, 0))
        K.beam(m, a - out * 1.0, b - out * 1.0, 0.3, 2.4, "SY_Scrap", "girder", up=(0, 1, 0))
        K.beam(m, a, b, 2.0, 0.35, "SY_Scrap", "plate" if i % 3 else "oxide", up=(0, 1, 0))
        if lod <= 1:
            # struts into the rock, splayed
            for s in (-1, 1):
                p0 = a + (b - a) * (0.3 if s < 0 else 0.7)
                p1 = p0 + (p0 / np.linalg.norm(p0)) * 7.0 + np.array([0, -3.0 + s * 1.5, 0])
                K.beam(m, p0, p1, 0.6, 0.6, "SY_Scrap", "girder", up=(0, 1, 0))
            # gussets welded across each corner, a cable run along the inside flange
            if lod == 0:
                c_ = a / np.linalg.norm(a)
                for s2 in (-1, 1):
                    K.beam(m, a + d * 3.0 + np.array([0, s2 * 1.0, 0]), a - c_ * 2.8 + np.array([0, s2 * 1.0, 0]), 0.25, 0.25, "SY_Scrap", "girder", up=(0, 1, 0))
                K.tube(m, [a - out * 1.3 + np.array([0, -0.8, 0]), b - out * 1.3 + np.array([0, -0.8, 0])], 0.18, 6, "SY_Scrap", "girder")
                for t in (0.25, 0.5, 0.75):
                    p_ = a + (b - a) * t
                    K.box(m, (-0.8, -1.25, -0.8), (0.8, 1.25, 0.8), "SY_Scrap", ["patch", "oxide", "plate"][(i + int(t * 4)) % 3], xf=Matrix.Translation(Vector(p_ + out * 1.25)) @ Matrix.Rotation(-math.atan2(d[2], d[0]), 4, "Y"))
            # floodlights at the nodes
            K.box(m, (-0.9, -1.6, -0.6), (0.9, -0.2, 0.6), "SY_Scrap", "lamp", xf=Matrix.Translation(Vector(a * 0.95)) @ Matrix.Rotation(-math.atan2(a[2], a[0]), 4, "Y"))
    if lod <= 2:
        # the lintel: a hazard band across the top of the gate, mismatched patch plates hung below it
        K.box(m, (-14.0, -1.2, r * 0.86), (14.0, 0.6, r * 0.86 + 2.2), "SY_Scrap", "hazard")
        for k, x in enumerate(np.arange(-12.0, 12.1, 4.0)):
            K.box(m, (x - 1.9, -0.6, r * 0.86 - 2.5 - (k % 2) * 0.6), (x + 1.9, -0.2, r * 0.86), "SY_Scrap", ["patch", "oxide", "plate"][k % 3])
    if lod <= 2:
        for a in (0.3, 2.8):
            p = np.array([math.cos(a) * (r + 1.4), -1.3, math.sin(a) * (r + 1.4)])
            K.revolve(m, [(0.0, 0.0), (0.5, 0.3), (0.5, 0.7)], 8, "NavReaches", None, center=tuple(p), axis="y", away=tuple(p + [0, 2, 0]))
    return m


def dock_lod(lod):
    """A 26 m landing pad on a girder cantilever, anchored to the cavity wall at y = 0, the pad toward -Y."""
    m = K.Mesh()
    cy = -17.0
    R = 12.5
    seg = (24, 16, 8, 8)[lod]
    ang = np.linspace(0, 2 * math.pi, seg + 1)[:-1] + math.pi / seg
    top = [(math.cos(a) * R, cy + math.sin(a) * R, 0.0) for a in ang]
    bot = [(math.cos(a) * R, cy + math.sin(a) * R, -1.2) for a in ang]
    K.planar(m, top, "SY_Grate")
    if lod == 3:
        K.box(m, (-R, cy - R, -1.2), (R, cy + R, 0.0), "SY_Scrap", "oxide", keys={"+z": "plate"}, skip=("+z",))
        K.box(m, (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0), "SY_Scrap", "oxide", skip=("+y",))
        return m
    for k in range(seg):
        k2 = (k + 1) % seg
        approach = math.sin(ang[k]) < -0.55
        K.patch(m, [[bot[k], top[k]], [bot[k2], top[k2]]], "SY_Scrap", "hazard" if approach else "oxide", away=(0, cy, -0.6))
    K.planar(m, bot[::-1], "SY_Scrap", toward=lambda c: c + np.array([0, 0, -1.0]))
    if lod <= 2:
        # the pad ring: a welded band of patch plates, landing lamps on it
        ring_o = [(math.cos(a) * (R - 0.5), cy + math.sin(a) * (R - 0.5), 0.05) for a in ang]
        ring_i = [(math.cos(a) * (R - 2.0), cy + math.sin(a) * (R - 2.0), 0.05) for a in ang]
        for k in range(seg):
            k2 = (k + 1) % seg
            K.patch(m, [[ring_i[k], ring_o[k]], [ring_i[k2], ring_o[k2]]], "SY_Scrap", "patch", toward=lambda c: c + np.array([0, 0, 1.0]))
        if lod <= 1:
            for k in range(0, seg, 3):
                p = np.array(ring_o[k]) + np.array([0, 0, 0.05])
                K.revolve(m, [(0.0, 0.25), (0.25, 0.15), (0.3, 0.0)], 6, "NavReaches", None, center=tuple(p), axis="z", away=tuple(p - [0, 0, 1]))
    # cantilever: two deep girders back to the anchor plate, braced
    for x in (-5.0, 5.0):
        K.beam(m, np.array([x, cy + 4.0, -1.6]), np.array([x, 0.0, -1.6]), 0.8, 2.2, "SY_Scrap", "girder", up=(1, 0, 0))
        if lod <= 2:
            K.beam(m, np.array([x, cy + 2.0, -2.7]), np.array([x, 0.0, -12.0]), 0.7, 0.7, "SY_Scrap", "girder", up=(1, 0, 0))
    K.box(m, (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0), "SY_Scrap", "oxide", skip=("+y",) if lod == 3 else ())
    if lod == 0:
        # bollards and a fuel line round the pad, cable reels at the hatch
        for k in range(0, seg, 4):
            p = np.array([math.cos(ang[k]) * (R - 1.0), cy + math.sin(ang[k]) * (R - 1.0), 0.0])
            K.revolve(m, [(0.25, 0.0), (0.2, 0.6), (0.3, 0.7), (0.0, 0.75)], 8, "SY_Scrap", "girder", center=tuple(p), axis="z", away=tuple(p - [0, 0, 1]))
        ring = [np.array([math.cos(a) * (R + 0.35), cy + math.sin(a) * (R + 0.35), -0.6]) for a in np.linspace(0.3, 2 * math.pi - 0.3, 25)]
        K.tube(m, ring, 0.14, 6, "SY_Scrap", "girder")
        for x in (-2.5, 2.5):
            K.revolve(m, [(0.7, 0.0), (0.7, 0.5)], 12, "SY_Scrap", "patch", center=(x, -1.4, 0.7), axis="x", away=(x, -1.4, 0.7))
        for x in np.arange(-11.0, 11.1, 2.2):
            K.box(m, (x - 0.5, -cy * 0 - 0.75, -12.0), (x + 0.5, -0.6, -11.6), "SY_Scrap", "girder")
    if lod <= 1:
        for z in (-12.0, -6.0, 0.0):
            for x in (-6.5, 6.5):
                K.revolve(m, [(0.25, 0.0), (0.25, 0.35), (0.0, 0.4)], 6, "SY_Scrap", "girder", center=(x, -0.6, z), axis="y", away=(x, 0, z))
        # a walkway from the pad's edge to a hatch in the anchor plate
        K.box(m, (-1.2, cy + R - 1.5, -0.3), (1.2, -0.6, 0.0), "SY_Scrap", "plate", keys={"+z": "plate"})
        K.box(m, (-1.0, -0.65, 0.0), (1.0, -0.6, 2.6), "SY_Scrap", "hazard")
    return m


def deck_lod(lod):
    """The fight deck: a 30 x 14 m grated platform, welded cover plates, a container hold, railings; anchored at y = 0."""
    m = K.Mesh()
    X, Y0, Y1 = 15.0, -14.0, 0.0
    K.planar(m, [(-X, Y0, 0), (X, Y0, 0), (X, Y1, 0), (-X, Y1, 0)], "SY_Grate")
    K.patch(m, [[(-X, Y0, -1.0), (-X, Y0, 0.0)], [(X, Y0, -1.0), (X, Y0, 0.0)]], "SY_Scrap", "hazard", toward=lambda c: c + np.array([0, -1.0, 0]))
    K.planar(m, [(-X, Y0, -1.0), (-X, Y1, -1.0), (X, Y1, -1.0), (X, Y0, -1.0)], "SY_Scrap", toward=lambda c: c + np.array([0, 0, -1.0]))
    for s in (-1, 1):
        K.patch(m, [[(s * X, Y0, -1.0), (s * X, Y0, 0.0)], [(s * X, Y1, -1.0), (s * X, Y1, 0.0)]], "SY_Scrap", "plate", toward=lambda c, s=s: c + np.array([s, 0, 0]))
    if lod == 3:
        K.box(m, (4.0, -6.0, 0.0), (10.0, -3.5, 2.6), "SY_Scrap", "oxide")
        return m
    # walkway strip of worn patch plates across the deck (where the crews walk)
    K.box(m, (-X + 0.5, -8.0, 0.0), (X - 0.5, -6.6, 0.04), "SY_Scrap", "plate", skip=("-z",))
    # container hold: a salvaged container with a hatch (3.0 x 2.0 m service size)
    K.box(m, (3.0, -6.2, 0.0), (12.0, -3.2, 2.9), "SY_Scrap", "oxide", keys={"+z": "plate", "-y": "oxide"})
    if lod <= 1:
        for x in np.arange(3.3, 12.0, 0.6):
            K.box(m, (x, -6.28, 0.1), (x + 0.25, -6.2, 2.8), "SY_Scrap", "oxide")
        K.box(m, (6.4, -6.35, 0.0), (8.6, -6.25, 3.0), "SY_Scrap", "hazard")
    # cover: angled welded plates and crates across the deck
    rng = np.random.default_rng(4)
    for k in range(7 if lod == 0 else (5 if lod == 1 else 3)):
        x = -12.0 + k * 3.6 + rng.uniform(-0.5, 0.5)
        y = -11.0 + rng.uniform(-1.0, 1.5)
        if x > 2.0 and y > -7.0:
            continue
        a = rng.uniform(-0.4, 0.4)
        xf = Matrix.Translation((x, y, 0.0)) @ Matrix.Rotation(a, 4, "Z")
        if k % 2:
            K.box(m, (-1.4, -0.12, 0.0), (1.4, 0.12, 1.25), "SY_Scrap", ["patch", "plate", "oxide"][k % 3], xf=xf)
            if lod <= 1:
                K.box(m, (-1.2, 0.12, 0.0), (-1.0, 0.7, 1.0), "SY_Scrap", "girder", xf=xf)
                K.box(m, (1.0, 0.12, 0.0), (1.2, 0.7, 1.0), "SY_Scrap", "girder", xf=xf)
        else:
            K.box(m, (-0.7, -0.7, 0.0), (0.7, 0.7, 1.1), "SY_Scrap", "plate", keys={"+z": "patch"}, xf=xf)
    # railings along the open edge: girder posts and a pipe rail at 1.05 m
    for x0, x1 in ((-X, X),):
        n = 10 if lod <= 1 else 4
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            K.box(m, (x - 0.06, Y0 + 0.05, 0.0), (x + 0.06, Y0 + 0.2, 1.05), "SY_Scrap", "girder")
        K.tube(m, [(x0, Y0 + 0.12, 1.05), (x1, Y0 + 0.12, 1.05)], 0.04, 6 if lod <= 1 else 4, "SY_Scrap", "girder")
    if lod == 0:
        # straps on the crates, a pipe run along the deck's back edge, bollards at the open edge
        K.tube(m, [(-X + 0.6, -0.6, 0.5), (X - 0.6, -0.6, 0.5)], 0.2, 8, "SY_Scrap", "girder")
        K.tube(m, [(-X + 0.6, -1.1, 0.35), (X - 0.6, -1.1, 0.35)], 0.13, 6, "SY_Scrap", "oxide")
        for x in np.arange(-X + 1.5, X, 3.0):
            K.box(m, (x - 0.2, -1.4, 0.0), (x + 0.2, -0.3, 0.8), "SY_Scrap", "girder")
        for x in (-13.0, -4.0, 5.0):
            K.revolve(m, [(0.22, 0.0), (0.18, 0.5), (0.26, 0.6), (0.0, 0.65)], 8, "SY_Scrap", "girder", center=(x, Y0 + 0.8, 0.0), axis="z", away=(x, Y0 + 0.8, -1))
    # deck lamps under the hold's eave
    if lod <= 1:
        K.box(m, (3.5, -6.6, 2.5), (11.5, -6.3, 2.7), "SY_Scrap", "lamp")
    # anchor beams into the rock
    for x in (-10.0, 0.0, 10.0):
        K.beam(m, np.array([x, Y1 - 1.0, -1.0]), np.array([x, Y1 + 0.5, -8.0]), 0.6, 0.6, "SY_Scrap", "girder", up=(1, 0, 0))
    return m


SOCKETS = {
    # (name, theta from the mouth, phi round it, inset) on the cavity wall, +Y pointing into the cavity
    "Socket_Dock_1": (1.35, 3.6, 0.0),
    "Socket_Dock_2": (1.75, 5.6, 0.0),
    "Socket_Dock_3": (1.15, 1.2, 0.0),
    "Socket_Deck_1": (2.2, 4.7, 0.0),
    "Socket_Deck_2": (2.5, 2.4, 0.0),
}


def build(sc, root):
    for name, fn, cls in (("sy_rock", rock_lod, "building"), ("sy_mouth", mouth_lod, "kit"), ("sy_dock", dock_lod, "kit"), ("sy_deck", deck_lod, "kit")):
        asset = K.new_collection(name, root)
        for lod in range(4):
            c = K.new_collection(f"{name}_LOD{lod}", asset)
            m = fn(lod)
            print(f"{name} LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
            m.build(f"{name}_L{lod}", c)
        if name == "sy_rock":
            K.collider(asset, "COL_Rock_Back", (-70, 30, -70), (70, 75, 70))
            for k in range(8):
                a = k * math.pi / 4
                xf = Matrix.Rotation(-a, 4, "Y") @ Matrix.Translation((62.0, 0.0, 0.0))
                K.collider(asset, f"COL_Rock_Wall_{k + 1}", (-12.0, -70.0, -26.0), (14.0, 40.0, 26.0), xf=xf)
            # the mouth's socket: at the rim's centre, +Y out of the rock (toward -Y world)
            mid = np.mean([_dir(MOUTH * 1.1, p) * radius(_dir(MOUTH * 1.1, p)) for p in np.linspace(0, 2 * math.pi, 16)], 0)
            K.empty(asset, "Socket_Mouth", (0.0, float(mid[1]), 0.0), rot=(0, 0, math.pi), size=8.0, props={"interface": "mouth"})
            for nm, (t, p, _) in SOCKETS.items():
                d = _dir(t, p)
                pos = d * radius(d, True) * 0.97
                inward = -d
                q = Vector(inward).to_track_quat("Y", "Z")
                o = K.empty(asset, nm, tuple(pos), rot=tuple(q.to_euler()), size=4.0, props={"interface": "anchor"})
            K.empty(asset, "BAY_Mouth", (0.0, -R0 - 40.0, 0.0), size=8.0, props={"approach": True})
            K.empty(asset, "Light_Cavity", (0.0, 0.0, 0.0), size=3.0, props={"color": "#FF8A5C", "intensity": 1.6, "distance": 110.0})
        elif name == "sy_mouth":
            for k in range(8):
                a = k * math.pi / 4 + math.pi / 8 + math.pi / 8
                xf = Matrix.Translation((math.cos(a) * 25.0, 0.0, math.sin(a) * 25.0)) @ Matrix.Rotation(-a, 4, "Y")
                K.collider(asset, f"COL_Gate_{k + 1}", (-1.3, -1.3, -10.2), (1.3, 1.3, 10.2), xf=xf)
            K.empty(asset, "Socket_GateMount", (0, 0, 0), size=6.0, props={"interface": "mouth"})
            K.empty(asset, "Light_Gate", (0.0, -3.0, 21.0), size=2.0, props={"color": "#FF6A3D", "intensity": 2.0, "distance": 60.0})
        elif name == "sy_dock":
            K.collider(asset, "COL_Pad", (-12.5, -29.5, -1.2), (12.5, -4.5, 0.0))
            K.collider(asset, "COL_Cantilever", (-6.0, -6.0, -3.0), (6.0, 0.0, 0.0))
            K.collider(asset, "COL_Anchor", (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0))
            K.empty(asset, "BAY_Dock", (0.0, -17.0, 0.0), size=4.0, props={"radius": 11.0})
            K.empty(asset, "Socket_DockAnchor", (0, 0, 0), size=3.0, props={"interface": "anchor"})
            K.empty(asset, "Interact_Hatch", (0.0, -1.0, 1.4), size=0.3)
        else:
            K.collider(asset, "COL_Deck", (-15.0, -14.0, -1.0), (15.0, 0.0, 0.0))
            K.collider(asset, "COL_Hold", (3.0, -6.2, 0.0), (12.0, -3.2, 2.9))
            K.collider(asset, "COL_Rail", (-15.0, -14.0, 0.0), (15.0, -13.8, 1.1))
            K.empty(asset, "Socket_DeckAnchor", (0, 0, 0), size=3.0, props={"interface": "anchor"})
            K.empty(asset, "Interact_Hold", (7.5, -6.8, 1.3), size=0.3)
            K.empty(asset, "Light_Deck", (7.5, -7.5, 2.4), size=1.0, props={"color": "#FF8A5C", "intensity": 0.8, "distance": 18.0})
