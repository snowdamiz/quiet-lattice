NEW_PADS_DECALS = '''        if decals and lod <= 2:
            z = PAD_TOP + 0.02
            # scorch where thrust lands: four shapes, turned, mirrored, sized and set off-centre per pad; every third pad
            # carries an older burn under the new one
            prng = np.random.default_rng(100 + idx)
            kinds = ("scorch", "scorch_streak", "scorch_ring", "scorch_haze")
            for layer in range(1 + (idx % 3 == 1)):
                r = prng.uniform(5.0, 8.0)
                a0 = prng.uniform(0, 2 * math.pi)
                off = prng.uniform(-1.6, 1.6, 2)
                K.decal(m, (x + off[0], y + off[1], z + layer * 0.004), (0, 0, 1), (math.cos(a0), math.sin(a0), 0), 2 * r * prng.uniform(0.8, 1.2), 2 * r, PD.DECAL_CELLS[kinds[(idx * 7 + layer * 3) % 4]], lift=0.0, flip=bool(prng.random() < 0.5))
'''

NEW_WALLS = '''WALL_ZONES = ((0.0, 7.0), (7.0, 25.6), (25.6, 36.4), (36.4, IN_Z))  # dado, mid, the crystal band, upper
HALF_BAY = 7.5


def recess(m, at, nin, a0, a1, z0, z1, lod, keys, depth=0.4, c=0.5, row=2.0, seed=0, back=None):
    """A recessed panel: a chamfered frame from the wall plane back `depth` to lapped plate rows (or a `back` material).
    `at(a, z, d)` is the point at a along the wall, height z, d metres behind the wall plane; `nin` points into the hall."""
    inn = lambda q: q + np.asarray(nin) * 5.0
    o = (a0, a1, z0, z1)
    i = (a0 + c, a1 - c, z0 + c, z1 - c)
    P = lambda a, z, d=0.0: at(a, z, d)
    frame = [
        ((o[0], o[2]), (o[1], o[2]), (i[1], i[2]), (i[0], i[2])),
        ((o[1], o[3]), (o[0], o[3]), (i[0], i[3]), (i[1], i[3])),
        ((o[0], o[3]), (o[0], o[2]), (i[0], i[2]), (i[0], i[3])),
        ((o[1], o[2]), (o[1], o[3]), (i[1], i[3]), (i[1], i[2])),
    ]
    for q0, q1, q2, q3 in frame:
        K.patch(m, [[P(*q0), P(*q3, depth)], [P(*q1), P(*q2, depth)]], "WS_Shell", "lip", toward=inn, u_off=seed * 0.7)
    if back is not None:
        K.patch(m, [[P(i[0], i[2], depth), P(i[0], i[3], depth)], [P(i[1], i[2], depth), P(i[1], i[3], depth)]], back[0], back[1], toward=inn, u_off=seed * 1.3)
        return
    nrow = max(1, int(round((i[3] - i[2]) / row)))
    zs = np.linspace(i[2], i[3], nrow + 1)
    lap = 0.1 if lod <= 1 else 0.0
    for r in range(nrow):
        za, zb = zs[r], zs[r + 1]
        K.patch(m, [[P(i[0], za, depth - lap), P(i[0], zb, depth)], [P(i[1], za, depth - lap), P(i[1], zb, depth)]], "WS_Shell", keys(r, nrow), toward=inn, u_off=seed * 2.9 + r * 1.7)
        if lap:
            K.patch(m, [[P(i[0], za, depth), P(i[0], za, depth - lap)], [P(i[1], za, depth), P(i[1], za, depth - lap)]], "WS_Shell", "lip", toward=lambda q: q + np.array([0, 0, -5.0]), t_range=(0.0, 0.2))


def wall_keys(zone):
    if zone == 0:
        return lambda r, n: "accent" if r < n - 1 else "plate_band"
    return lambda r, n: "plate"


def build_walls(m, lod):
    """The interior walls carry the exterior's structure through: recessed panels of lapped rows between Thalune ribs, a
    crystal insert in a dark socket in each half bay of the window band, string courses at the zone lines."""
    for sgn in (1, -1):
        x = IN_X * sgn
        nin = (-sgn, 0.0, 0.0)
        at = lambda a, z, d, x=x, sgn=sgn: np.array([x + sgn * d, a, z])
        ys = np.arange(Y_MOUTH, Y_BACK + 0.01, HALF_BAY if lod <= 1 else 15.0)
        for j in range(len(ys) - 1):
            for zi, (z0, z1) in enumerate(WALL_ZONES):
                seed = j * 4 + zi + (0 if sgn > 0 else 50)
                if zi == 2:
                    if lod <= 2:
                        recess(m, at, nin, ys[j], ys[j + 1], z0, z1, lod, None, depth=0.6, c=0.6, seed=seed, back=("WS_Metal", "machine"))
                        mid = (ys[j] + ys[j + 1]) / 2
                        K.crystal_insert(m, at(mid, (z0 + z1) / 2, 0.6), nin, (0, 1, 0), ys[j + 1] - ys[j] - 1.8, z1 - z0 - 2.6, lod, lit=True, seed=seed)
                    else:
                        K.patch(m, [[at(ys[j], z0, 0), at(ys[j], z1, 0)], [at(ys[j + 1], z0, 0), at(ys[j + 1], z1, 0)]], "WS_Metal", "machine", toward=lambda q, nin=nin: q + np.asarray(nin))
                    continue
                if lod <= 1:
                    recess(m, at, nin, ys[j], ys[j + 1], z0, z1, lod, wall_keys(zi), depth=0.35, seed=seed)
                else:
                    zs = np.arange(z0, z1 - 0.01, 2.0).tolist() + [z1]
                    for r in range(len(zs) - 1):
                        K.patch(m, [[at(ys[j], zs[r], 0), at(ys[j], zs[r + 1], 0)], [at(ys[j + 1], zs[r], 0), at(ys[j + 1], zs[r + 1], 0)]], "WS_Shell", wall_keys(zi)(r, len(zs) - 1), toward=lambda q, nin=nin: q + np.asarray(nin), u_off=seed * 2.9)
        # Thalune ribs over the half-bay joints between the frame columns, and string courses at the zone lines
        if lod <= 2:
            for y in np.arange(Y_MOUTH + HALF_BAY, Y_BACK, 15.0):
                K.tube(m, [(x, y, 0.5), (x, y, 7.0), (x, y, 25.6), (x, y, IN_Z)], 0, 0, "WS_Shell", "rib", smooth=True, up=(0, sgn, 0), profile=[(-0.7, -0.05), (-0.5, 0.35), (0.0, 0.55), (0.5, 0.35), (0.7, -0.05)])
            for z in (25.6, 36.4):
                K.box(m, (min(x, x - 0.35 * sgn), Y_MOUTH, z - 0.25), (max(x, x - 0.35 * sgn), Y_BACK, z + 0.25), "WS_Shell", "signal" if z < 30 else "lip", skip=("+x", "-x")[0 if sgn < 0 else 1:][:1])
        # kick plate along the floor (carts and tugs scrape here)
        K.box(m, (x - 0.25 * sgn if sgn > 0 else x, Y_MOUTH, 0), (x if sgn > 0 else x + 0.25, Y_BACK, 0.5), "WS_Shell", "lip")
    # the back wall: recessed bays below the trade deck and above its canopy
    at = lambda a, z, d: np.array([a, Y_BACK + d, z])
    xs = np.linspace(-IN_X, IN_X, 14 if lod <= 1 else 7)
    for j in range(len(xs) - 1):
        for zi, (z0, z1) in enumerate(((0.0, 7.0), (7.0, 17.2), (17.2, 30.0), (30.0, IN_Z))):
            seed = 200 + j * 4 + zi
            if lod <= 1 and zi != 1:
                recess(m, at, (0, -1.0, 0), xs[j + 1], xs[j], z0, z1, lod, wall_keys(0 if zi == 0 else 1), depth=0.35, seed=seed)
            else:
                zs = np.arange(z0, z1 - 0.01, 2.0).tolist() + [z1]
                for r in range(len(zs) - 1):
                    K.patch(m, [[at(xs[j + 1], zs[r], 0), at(xs[j + 1], zs[r + 1], 0)], [at(xs[j], zs[r], 0), at(xs[j], zs[r + 1], 0)]], "WS_Shell", wall_keys(0 if zi == 0 else 1)(r, len(zs) - 1), toward=(0.0, 0.0, 20.0), u_off=seed * 1.3)
    # ceiling: a shallow vault of plate rows along y
    n = (33, 17, 9, 3)[lod]
    xs = np.linspace(-IN_X, IN_X, n)
    zc = IN_Z + 4.0 * (1 - (xs / IN_X) ** 2)
    prof = np.stack([xs, zc], 1)
    K.lapped_rows(m, prof, Y_MOUTH, Y_BACK, "WS_Shell", lambda i: "plate", row=2.0, lap=0.0, lod=2, flip=False, seed=3, toward=lambda c: np.array([0.0, c[1], 10.0]))


def truss(m, x0, x1, y, z_top, depth, n, lod, key="lattice"):
    """An arched Ulgani truss across the hall at y: two curved chords swelling where the webs grow in, the webs bowed
    alternately and fused into the chords with fillets."""
    xs = np.linspace(x0, x1, n + 1)
    span = (x1 - x0) / 2
    top = [np.array((x, y, z_top + 4.0 * (1 - (x / span) ** 2) - 0.6)) for x in xs]
    bot = [np.array((x, y, z_top + 4.0 * (1 - (x / span) ** 2) - depth * (0.45 + 0.55 * (1 - (x / span) ** 2)))) for x in xs]
    K.chord(m, top, 0.36, "WS_Metal", key, lod, nodes=set(range(0, n + 1, 2)), up=(0, 1, 0), sides=5 if lod == 0 else None, sub=1)
    K.chord(m, bot, 0.3, "WS_Metal", key, lod, nodes=set(range(1, n + 1, 2)), up=(0, 1, 0), sides=5 if lod == 0 else None, sub=1)
    for i in range(n):
        a = top[i] if i % 2 == 0 else bot[i]
        b = bot[i + 1] if i % 2 == 0 else top[i + 1]
        K.member(m, a, b, 0.17, "WS_Metal", key, lod=lod, bow=0.05 * (1 if i % 2 else -1), bow_dir=(0, 0, 1), fillet=2.0, sides=5 if lod == 0 else None)
    if lod == 0:
        # the hall's lamps hang under the bottom chord: nav white only in the lens
        for i in range(1, n - 1, 2):
            a, b = bot[i], bot[i + 1]
            K.beam(m, a - [0, 0, 0.6], b - [0, 0, 0.6], 0.5, 0.18, "WS_Metal", "light", up=(0, 1, 0))
            for p in (a + (b - a) * 0.2, a + (b - a) * 0.8):
                K.member(m, p, p - [0, 0, 0.6], 0.05, "WS_Metal", "trim", lod=2, bow=0.0, fillet=1.6)
    return top, bot


def build_frame(m, lod):
    ys = np.arange(Y_MOUTH + 0.0, Y_BACK + 0.01, 15.0)
    for j, y in enumerate(ys):
        if lod >= 2 and j % 2:
            continue
        if lod == 3:
            break
        n = (10, 8, 6, 4)[lod]
        top, bot = truss(m, -IN_X + 0.5, IN_X - 0.5, y, IN_Z, 4.5, n, lod)
        # wall columns: a bowed Ulgani column up each wall fused into the truss, an inner chord and a web between them
        for sgn, end in ((1, top[-1]), (-1, top[0])):
            x = (IN_X - 0.6) * sgn
            K.member(m, (x, y, 0.0), end, 0.42, "WS_Metal", "lattice", lod=lod, bow=0.012, bow_dir=(-sgn, 0, 0), fillet=2.2)
            if lod <= 1:
                x2 = (IN_X - 2.2) * sgn
                inner = [np.array([x2 + 0.25 * sgn * math.sin(t * math.pi), y, 7.6 + (IN_Z - 10.6) * t]) for t in np.linspace(0, 1, 5)]
                K.chord(m, inner, 0.2, "WS_Metal", "lattice", lod, nodes={1, 2, 3}, up=(0, 1, 0), sides=5, sub=1)
                for k in range(4):
                    a = inner[k] if k % 2 == 0 else np.array([x, y, inner[k][2]])
                    b = np.array([x, y, inner[k + 1][2]]) if k % 2 == 0 else inner[k + 1]
                    K.member(m, a, b, 0.14, "WS_Metal", "lattice", lod=lod, bow=0.04, bow_dir=(0, 1, 0), sides=5)
                K.member(m, inner[-1], bot[-1] if sgn > 0 else bot[0], 0.16, "WS_Metal", "lattice", lod=lod, bow=0.05, sides=5)
                K.member(m, inner[0], (x, y, 4.0), 0.16, "WS_Metal", "lattice", lod=lod, bow=0.05, bow_dir=(0, 1, 0), sides=5)


def build_gantries(m, lod):
    """Catwalks along both walls at the trade deck's level (7 m), railings at 1.05 m."""
    z = 7.0
    for sgn in (1, -1):
        xi, xo = (IN_X - 4.0) * sgn, (IN_X - 0.8) * sgn
        x0, x1 = min(xi, xo), max(xi, xo)
        K.box(m, (x0, Y_MOUTH + 4, z - 0.3), (x1, 68.0, z), "WS_Deck", "walk", keys={"-z": "deck"})
        K.box(m, (x0, Y_MOUTH + 4, z - 0.9), (x1, 68.0, z - 0.3), "WS_Metal", "lattice", skip=("+z", "-z"))
        if lod <= 1:
            # brackets grown out of the wall columns
            for y in np.arange(Y_MOUTH + 15, 68.0, 15.0):
                K.member(m, (xi, y, z - 0.9), (xo + 0.6 * sgn, y, z - 4.0), 0.16, "WS_Metal", "lattice", lod=lod, bow=0.06, bow_dir=(0, 0, -1), sides=5)
            railing(m, (xi, Y_MOUTH + 4, z), (xi, 68.0, z), lod)
            # grime runs down the fascia under the rail, where boots and spilt coolant go over the edge
            for k, y in enumerate(np.arange(Y_MOUTH + 9, 64.0, 11.0)):
                K.decal(m, (xi, y + (k % 3) * 1.3, z - 0.75), (-sgn, 0, 0), (0, 1, 0), 9.0 + (k % 2) * 3, 1.2, PD.DECAL_CELLS["grime_runs"], lift=0.02, flip=bool(k % 2))


'''

NEW_EXT_LATTICE = '''    # the Ulgani frame standing proud of the flanks: two curved chords swelling at the nodes, triangulated by bowed webs
    # fused into them, every 15 m
    side = half[(half[:, 0] > 40) & (half[:, 1] > -7)]
    side = K.resample(side, 4.5 if lod <= 1 else 9.0)
    nrm2 = []
    for k in range(len(side)):
        a, b = side[max(0, k - 1)], side[min(len(side) - 1, k + 1)]
        d = b - a
        nn = np.array([d[1], -d[0]])
        nrm2.append(nn / np.linalg.norm(nn))
    nrm2 = np.array(nrm2)
    for j, y in enumerate(np.arange(Y_MOUTH + 7.5, Y_BACK, 15.0)):
        if lod == 2 and j % 2:
            continue
        for sgn in (1, -1):
            inner = [np.array([(p[0] + n[0] * 0.5) * sgn, y, p[1] + n[1] * 0.5]) for p, n in zip(side, nrm2)]
            outer = [np.array([(p[0] + n[0] * 2.4) * sgn, y, p[1] + n[1] * 2.4]) for p, n in zip(side, nrm2)]
            K.chord(m, inner, 0.36, "WS_Metal", "lattice", lod, nodes=set(range(0, len(inner), 2)), up=(0, 1, 0), sides=4, sub=0)
            K.chord(m, outer, 0.36, "WS_Metal", "lattice", lod, nodes=set(range(1, len(outer), 2)), up=(0, 1, 0), sides=4, sub=0)
            for k in range(len(inner) - 1):
                a, b = (inner[k], outer[k + 1]) if k % 2 == 0 else (outer[k], inner[k + 1])
                K.member(m, a, b, 0.2, "WS_Metal", "lattice", lod=lod, bow=0.06 * (1 if k % 2 else -1), bow_dir=(0, 1, 0), sides=4, seg=1 if lod == 0 else None)
'''

NEW_WEAR = '''def number(m, at, nin, t, a, z, d, value, size=1.8):
    """A stencilled panel number from two blue digit decals: every number in the hall appears once."""
    s = f"{value:02d}"
    for k, ch in enumerate(s):
        p = at(a, z, d) + np.asarray(t) * (k - 0.5) * size * 0.52
        K.decal(m, p, nin, t, size * 0.5, size, PD.DECAL_CELLS["digit" + ch], lift=0.02)


def build_wear(m, lod):
    """Wear where use goes: soot and grime at the mouth lip ships cross, numbers stencilled once per bay."""
    if lod >= 2:
        return
    rng = np.random.default_rng(77)
    for k, x in enumerate(np.arange(-58.0, 59.0, 12.5)):
        w = rng.uniform(9.0, 14.0)
        K.decal(m, (x + rng.uniform(-2, 2), Y_MOUTH - 7.2, -1.7), (0, -1, 0), (1, 0, 0), w, 3.4, PD.DECAL_CELLS["grime_runs"], lift=0.02, flip=bool(k % 2))
        K.decal(m, (x + rng.uniform(-3, 3), Y_MOUTH - 3.4 + rng.uniform(-1, 1), 0.0), (0, 0, 1), (1, 0, 0.0), rng.uniform(12, 20), rng.uniform(4.5, 6.5), PD.DECAL_CELLS[("scorch_streak", "scorch_haze", "skid")[k % 3]], lift=0.03, flip=bool(rng.random() < 0.5))
    # soot on the hood's inner reveal where exhaust licks the opening's corners and lintel
    for x, z, w, h in ((-IN_X + 1.0, 6.0, 10.0, 12.0), (IN_X - 1.0, 6.0, 10.0, 12.0), (-20.0, IN_Z - 0.5, 26.0, 6.0), (24.0, IN_Z - 0.5, 20.0, 5.0)):
        nrm = (np.sign(-x), 0, 0) if abs(x) > 60 else (0, 0, -1)
        tt = (0, 1, 0) if abs(x) > 60 else (1, 0, 0)
        K.decal(m, (x * 0.995, Y_MOUTH + 0.75, z), nrm, tt, w, h * 0.3 if abs(x) < 60 else 1.4, PD.DECAL_CELLS["scorch_haze"], lift=0.03)
    for sgn, start in ((1, 11), (-1, 31)):
        x = IN_X * sgn
        at = lambda a, z, d, x=x, sgn=sgn: np.array([x + sgn * d, a, z])
        for j, y in enumerate(np.arange(Y_MOUTH, Y_BACK - 0.01, HALF_BAY)):
            number(m, at, (-sgn, 0, 0), (0, -sgn, 0), y + HALF_BAY / 2, 4.3, 0.2, start + j)
    at = lambda a, z, d: np.array([a, Y_BACK + d, z])
    xs = np.linspace(-IN_X, IN_X, 14)
    for j in range(len(xs) - 1):
        number(m, at, (0, -1, 0), (1, 0, 0), (xs[j] + xs[j + 1]) / 2, 24.0, 0.2, 51 + j, size=2.4)


'''
