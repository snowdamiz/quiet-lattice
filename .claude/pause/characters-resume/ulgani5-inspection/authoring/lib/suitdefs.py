"""The four suit sets of each people: practical suits shaped by biology (gill-frill vents, crystal channels, crest and
slit openings), in the people's design language (Thalune lapped shell, Ixari faceted crystal-and-slate, Ulgani
chitin lattice over membrane).  Each builder returns a list of (name, mesh, rigid) pieces in world space."""
import math

import numpy as np

from . import suits as SU


def _scallop(s_lo, s_hi, th0, th1, depth, lobes):
    """Shape for a scale/plate: top edge straight at s_hi, lower edge scalloped (lobes) around s_lo."""
    def f(U, V):
        th = th0 + (th1 - th0) * U
        lo = s_lo + depth * (1 - np.abs(np.cos(np.pi * lobes * U)) ** 0.7)
        return lo + (s_hi - lo) * V, th
    return f


def _ribs(n, h, w=0.06):
    def f(U, V):
        d = np.abs(((U * n) % 1.0) - 0.5) * 2  # 1 between ribs, 0 on a rib
        return h * np.exp(-((1 - d) / w) ** 2 * 0.25) * (0.4 + 0.6 * V) * np.clip(np.minimum(U, 1 - U) * 8, 0, 1)
    return f


def cover_fn(coords, spec):
    part, side, s, th = coords
    cov = np.zeros(len(part))
    for code, lo, hi in spec:
        sel = (part == code) & (s >= lo) & (s <= hi)
        cov[sel] = 1.0
    return cov


# ---------------------------------------------------------------------------------------------- Thalune
def _fin_slit(coords, cov):
    """Opens the sleeve along the forearm fin (trailing edge of the forearm) so the fin passes through."""
    part, side, s, th = coords
    slit = (part == 1) & (s > 0.6) & (s < 0.97) & (np.abs(((th - 180 + 180) % 360) - 180) < 24)
    cov[slit] = 0.0
    return cov


def _local_scale(bmap, part, side, sv, th):
    """Metres per unit of s and per degree of th at a map point."""
    P, _ = bmap.point(part, side, [sv, sv + 0.01, sv], [th, th, th + 2.0], 0.0)
    return np.linalg.norm(P[1] - P[0]) / 0.01, np.linalg.norm(P[2] - P[0]) / 2.0


def _shell(bmap, name, part, side, hinge, a0, a1, R, off, thick, ribs=7, lobes=None, rib_h=0.0028, dome=0.004, nu=None,
           nv=12, s_dir=1.0):
    """A scallop shell laid on the body: radiating ribs from a hinge (map point), a scalloped rim with one lobe per
    rib, domed between hinge and rim; a = angle in the map plane (0 toward +th, 90 toward +s).  Plates lap like
    shingles by stacking shells with growing offsets.  Thalune joinery: overlap, never bolt; seams follow ribs."""
    sh, thh = hinge
    ms, mth = _local_scale(bmap, part, side, sh, thh)
    lobes = lobes or ribs
    nu = nu or max(16, ribs * 4 + 1)
    def shape(U, V):
        ang = np.radians(a0 + (a1 - a0) * U)
        lob = 1.0 - 0.07 * (1 - np.abs(np.cos(np.pi * lobes * U)) ** 0.6)
        r = R * (0.08 + 0.92 * V) * lob
        ss = sh + s_dir * r * np.sin(ang) / ms
        tt = thh + r * np.cos(ang) / mth
        return ss, tt
    def lift(U, V):
        d = np.abs(((U * ribs) % 1.0) - 0.5) * 2
        rib = np.exp(-((1 - d) / 0.16) ** 2)
        return rib_h * rib * np.clip(V * 3, 0, 1) + dome * np.sin(np.pi * np.clip(V, 0, 1)) ** 0.8 * np.sin(np.pi * U) ** 0.5
    return SU.plate(bmap, name, part, side, None, None, off, thick, nu=nu, nv=nv, shape=shape, lift=lift, round_edge=0.5)


def _spiral(name, S, centre, r, turns=2.2, tube_r=0.0022, s=1.0):
    """A small spiral shell fitting (a clasp or toggle) lying on the body."""
    q = S.project(np.asarray(centre)[None], iters=8)[0]
    N = S.grad(q[None])[0]
    N = N / max(np.linalg.norm(N), 1e-9)
    u = np.cross(N, [0.3, 0.5, 0.8])
    u /= np.linalg.norm(u)
    v = np.cross(N, u)
    t = np.linspace(0, 1, 60)
    ang = t * turns * 2 * np.pi
    rad = r * (0.18 + 0.82 * (1 - t))
    C = q + np.outer(tube_r * 1.5 + 0.004 * s * t, N) + (np.outer(np.cos(ang), u) + np.outer(np.sin(ang), v)) * rad[:, None]
    R = tube_r * (1.6 - 1.1 * t)
    me = SU.tube(name, C, R, sides=8, kind='fitting')
    return me


def _lapped_belt(bmap, pieces, s, sv=0.3, n=14, off=0.007):
    """A belt of small shells lapping round the waist, each hinged at its upper edge, each overlapping the next."""
    for k in range(n):
        th = -180 + 360 * k / n
        pieces.append((f'belt{k}', _shell(bmap, f'belt{k}', 'torso', 1, (sv + 0.025, th), 200, 340, 0.05 * s,
                                          (off + 0.0012 * (k % 2)) * s, 0.003 * s, ribs=4, rib_h=0.0015 * s, dome=0.002 * s, nv=8), False))


def _pauldron(bmap, pieces, s, side, layers=3, flare=0.0):
    """Shingled shells over the shoulder, hinged along a line at the shoulder top, each layer lapping the next."""
    sd = 'L' if side > 0 else 'R'
    for i in range(layers):
        sv = 0.02 + 0.075 * i
        pieces.append((f'paul{i}_{sd}', _shell(bmap, f'paul{i}_{sd}', 'arm', side, (sv, 90), 195, 345, (0.135 - 0.014 * i) * s,
                                               (0.009 + 0.006 * (layers - i) + flare * (layers - i)) * s, 0.004 * s, ribs=8,
                                               rib_h=0.003 * s, dome=0.006 * s, s_dir=-1.0), False))


def thalune_1(bmap, body, coords, S):
    """Tidewalker: the working suit of the shore.  Fitted torso and legs to mid-calf, short sleeves so the forearm
    fins swim free, the collar left open under the gill-frills; shingled scallop pauldrons hinged at the shoulder top
    (the outline at the shoulders), scallop knee shells, a belt of lapped shells with a spiral clasp; hands and
    webbed feet bare."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.36), (3, -0.5, 0.79)])
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0045 * s), S), False)]
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        _pauldron(bmap, pieces, s, side, layers=3, flare=0.006)
        pieces.append((f'knee_{sd}', _shell(bmap, f'knee_{sd}', 'leg', side, (0.42, 0.0), 210, 330, 0.085 * s, 0.008 * s, 0.004 * s,
                                            ribs=6, s_dir=-1.0), False))
    _lapped_belt(bmap, pieces, s)
    P, N = bmap.point('torso', 1, [0.3], [0], 0.012 * s)
    pieces.append(('clasp', _spiral('clasp', S, P[0], 0.016 * s, s=s), False))
    return pieces


def thalune_2(bmap, body, coords, S):
    """Reef diver: a full-length swimming suit with fin slits on the forearms and cuffs left open over the webbed feet;
    a domed dorsal carapace hinged at the nape and ribbed down the back like a scallop, standing off the back (it keeps
    the gills wet on dry worlds; the outline at the back), elbow and knee shells, spiral fittings at the collar."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.965), (3, -0.5, 0.965)])
    cov = _fin_slit(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.004 * s), S), False)]
    pieces.append(('carapace', _shell(bmap, 'carapace', 'torso', 1, (0.93, 180), 195, 345, 0.34 * s, 0.022 * s, 0.006 * s,
                                      ribs=11, rib_h=0.005 * s, dome=0.03 * s, nv=18, s_dir=1.0), False))
    pieces.append(('carapace2', _shell(bmap, 'carapace2', 'torso', 1, (0.7, 180), 200, 340, 0.2 * s, 0.014 * s, 0.005 * s,
                                       ribs=8, rib_h=0.004 * s, dome=0.012 * s, nv=12), False))
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        pieces.append((f'elbow_{sd}', _shell(bmap, f'elbow_{sd}', 'arm', side, (0.46, 180), 210, 330, 0.07 * s, 0.007 * s, 0.004 * s,
                                             ribs=5, s_dir=-1.0), False))
        pieces.append((f'knee_{sd}', _shell(bmap, f'knee_{sd}', 'leg', side, (0.42, 0.0), 210, 330, 0.085 * s, 0.008 * s, 0.004 * s,
                                            ribs=6, s_dir=-1.0), False))
        P, N = bmap.point('torso', side, [0.93], [40], 0.008 * s)
        pieces.append((f'spiral_{sd}', _spiral(f'spiral_{sd}', S, P[0], 0.014 * s, s=s), False))
    _lapped_belt(bmap, pieces, s, n=12)
    return pieces


def thalune_3(bmap, body, coords, S):
    """Shoal guard: the wardens' armour.  A full suit under lapped shell armour: two breast shells hinged at the
    sternum and ribbed out over the chest, back shells hinged at the spine, three-layer flared pauldrons (the
    outline), forearm shells that leave the fins free, thigh shells, scallop greaves, a belt of lapped shells; no
    sharp facets anywhere."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.97), (3, -0.5, 0.97)])
    cov = _fin_slit(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0045 * s), S), False)]
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        pieces.append((f'breast_{sd}', _shell(bmap, f'breast_{sd}', 'torso', side, (0.9, 4), 268, 352, 0.26 * s, 0.012 * s,
                                              0.005 * s, ribs=9, rib_h=0.004 * s, dome=0.012 * s, nv=16), False))
        pieces.append((f'belly_{sd}', _shell(bmap, f'belly_{sd}', 'torso', side, (0.62, 6), 268, 352, 0.17 * s, 0.009 * s,
                                             0.004 * s, ribs=7, rib_h=0.003 * s, dome=0.008 * s, nv=12), False))
        pieces.append((f'back_{sd}', _shell(bmap, f'back_{sd}', 'torso', side, (0.92, 176), 188, 272, 0.28 * s, 0.012 * s,
                                            0.005 * s, ribs=9, rib_h=0.004 * s, dome=0.012 * s, nv=16), False))
        _pauldron(bmap, pieces, s, side, layers=3, flare=0.01)
        pieces.append((f'bracer_{sd}', _shell(bmap, f'bracer_{sd}', 'arm', side, (0.6, 0), 215, 325, 0.12 * s, 0.008 * s, 0.004 * s,
                                              ribs=6, s_dir=-1.0), False))
        pieces.append((f'thigh_{sd}', _shell(bmap, f'thigh_{sd}', 'leg', side, (0.12, 40), 215, 325, 0.17 * s, 0.009 * s, 0.004 * s,
                                             ribs=7, s_dir=-1.0), False))
        pieces.append((f'greave_{sd}', _shell(bmap, f'greave_{sd}', 'leg', side, (0.58, 0), 215, 325, 0.16 * s, 0.008 * s, 0.004 * s,
                                              ribs=7, s_dir=-1.0), False))
        pieces.append((f'knee_{sd}', _shell(bmap, f'knee_{sd}', 'leg', side, (0.44, 0.0), 210, 330, 0.08 * s, 0.012 * s, 0.004 * s,
                                            ribs=6, s_dir=-1.0), False))
    _lapped_belt(bmap, pieces, s, n=16, off=0.009)
    P, N = bmap.point('torso', 1, [0.3], [0], 0.014 * s)
    pieces.append(('clasp', _spiral('clasp', S, P[0], 0.018 * s, s=s), False))
    return pieces


def thalune_4(bmap, body, coords, S):
    """Pilot: a sleek flight suit with fingerless gloves (the webs stay free) and fin slits; a ridge of small shells
    lapping down the spine from the nape (the outline at the back), carried round the collar and down the front as a
    closure of lapped shells, padded elbows and knees, small verdigris spiral toggles beside the closure."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 1.2), (2, -9, 9), (3, -0.5, 0.965)])
    cov = _fin_slit(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0035 * s), S), False)]
    for k in range(7):
        sv = 0.93 - 0.075 * k
        pieces.append((f'spine{k}', _shell(bmap, f'spine{k}', 'torso', 1, (sv, 180), 205, 335, (0.07 - 0.004 * k) * s,
                                           (0.014 + 0.004 * (6 - k) * 0.5) * s, 0.004 * s, ribs=6, rib_h=0.003 * s, dome=0.014 * s,
                                           nv=10), False))
    # the dorsal ridge carried round the collar and down the front as a closure of lapped shells
    for side in (1, -1):
        for k, th in enumerate((150, 122, 94, 66, 38)):
            pieces.append((f'collar{k}_{side}', _shell(bmap, f'collar{k}_{side}', 'torso', side, (0.955, th), 205, 335, 0.05 * s,
                                                       (0.012 - 0.0008 * k) * s, 0.0035 * s, ribs=5, rib_h=0.0025 * s,
                                                       dome=0.008 * s, nv=8), False))
    for k in range(8):
        sv = 0.92 - 0.065 * k
        pieces.append((f'front{k}', _shell(bmap, f'front{k}', 'torso', 1, (sv, 0), 205, 335, (0.06 - 0.002 * k) * s,
                                           (0.011 + 0.0015 * (k % 2)) * s, 0.0035 * s, ribs=5, rib_h=0.0025 * s, dome=0.009 * s,
                                           nv=8), False))
    for k, sv in enumerate((0.85, 0.66, 0.47)):
        P, N = bmap.point('torso', 1, [sv], [14], 0.012 * s)
        pieces.append((f'clasp{k}', _spiral(f'clasp{k}', S, P[0], 0.009 * s, s=s), False))
    return pieces


# ---------------------------------------------------------------------------------------------- Ixari
def _hexplate(s_lo, s_hi, th0, th1, cut=0.22):
    """A hexagonal outline (corners cut) over a (th, s) patch: the grown-facet shape of Ixari fittings."""
    def f(U, V):
        th = th0 + (th1 - th0) * U
        # cut the four corners diagonally
        cu = np.minimum(U, 1 - U)
        squeeze = np.clip((cut - cu) / cut, 0, 1) * cut * 0.9
        v2 = squeeze + (1 - 2 * squeeze) * V
        return s_lo + (s_hi - s_lo) * v2, th
    return f


def _facets(n, h):
    """Planar facets: a sawtooth across U gives ridged, flat-faced panels."""
    def f(U, V):
        t = (U * n) % 1.0
        return h * (1 - np.abs(2 * t - 1)) * np.clip(np.minimum(V, 1 - V) * 6, 0, 1)
    return f


def _channels(coords, cov, spine=True, forearm=True):
    """Open the suit where the living crystal grows: a channel down the spine and along the outer forearms."""
    part, side, s, th = coords
    if spine:
        sel = (part == 0) & (s > 0.42) & (np.abs(th) > 158)
        cov[sel] = 0.0
    if forearm:
        sel = (part == 1) & (s > 0.55) & (s < 0.95) & (np.abs(th - 112) < 30)
        cov[sel] = 0.0
    return cov


def _ix_channel_edges(bmap, pieces, s, off=0.005):
    """Rhombic facet plates in slate collars along both edges of the spine channel (the crystal grows between them);
    the seams between plate and collar carry the light."""
    for side in (1, -1):
        for k, sv in enumerate(np.linspace(0.46, 0.92, 7)):
            me = SU.facet_plate(bmap, f'chedge{k}_{side}', 'torso', side, (sv, 150.0), 0.017 * s, 0.006 * s, off * s, sides=4,
                                rot=45.0, stretch=0.7)
            pieces.append((f'chedge{k}_{side}', me, False))


def _ix_shoulder_prisms(bmap, pieces, s, side, n=4, length=0.16, lean=0.55, r0=0.017):
    """A cluster of grown rhombic prisms rising from the shoulder in slate sockets, tallest at the top of the
    shoulder: the suit's outline at the shoulders."""
    sd = 'L' if side > 0 else 'R'
    for k in range(n):
        sv = 0.015 + 0.05 * k
        P, N = bmap.point('arm', side, [sv], [96 - 16 * k], 0.004 * s)
        d = N[0] + np.array([0, 0, lean]) + np.array([side * 0.2, 0.1 * (k - 1.5), 0.0])
        d /= np.linalg.norm(d)
        pieces.append((f'sprism{k}_{sd}', SU.prism(f'sprism{k}_{sd}', P[0], d, (length * (1 - 0.2 * k)) * s, (r0 * (1 - 0.14 * k)) * s,
                                                   sides=4, terraces=3, seed=7 * k + (side > 0)), True))


def _ix_collar_prisms(bmap, pieces, s, ths=(112, 124, 136, 148), length=0.15, r=0.016, lean=1.0, sv=0.955, name='collar'):
    """A high collar of grown rhombic prisms behind the neck, the tallest at the back: the outline at the back."""
    for side in (1, -1):
        for k, th in enumerate(ths):
            P, N = bmap.point('torso', side, [sv], [th], 0.004 * s)
            d = N[0] * 0.4 + np.array([0, 0.25, lean]) + np.array([side * 0.12, 0, 0])
            d /= np.linalg.norm(d)
            L = length * (0.62 + 0.38 * (th - ths[0]) / max(1, ths[-1] - ths[0])) * s
            nm = f'{name}{k}_{side}'
            pieces.append((nm, SU.prism(nm, P[0], d, L, r * s, sides=4, terraces=3, seed=11 + k + 5 * (side > 0)), True))


def _ix_construction(bmap, pieces, s, wrists=True, ankles=True, knees=True, elbows=True):
    """The tailoring under the crystal: a raised collar and cuffs with real edge thickness, padded panels over the
    knees and elbows."""
    pieces.append(('collar', SU.ring(bmap, 'collar', 'torso', 1, 0.955, 0.03 * s, 0.006 * s, 0.006 * s, n=48, nw=5), False))
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        if wrists:
            pieces.append((f'cuff_{sd}', SU.ring(bmap, f'cuff_{sd}', 'arm', side, 0.93, 0.03 * s, 0.005 * s, 0.005 * s, n=32), False))
        if ankles:
            pieces.append((f'anklet_{sd}', SU.ring(bmap, f'anklet_{sd}', 'leg', side, 0.93, 0.034 * s, 0.006 * s, 0.005 * s, n=32), False))
        if knees:
            pieces.append((f'kpad_{sd}', SU.plate(bmap, f'kpad_{sd}', 'leg', side, (0.4, 0.6), (-48, 48), 0.006 * s, 0.006 * s,
                                                  nu=14, nv=10, round_edge=0.8), False))
        if elbows:
            pieces.append((f'epad_{sd}', SU.plate(bmap, f'epad_{sd}', 'arm', side, (0.4, 0.56), (140, 220), 0.005 * s, 0.005 * s,
                                                  nu=12, nv=8, round_edge=0.8), False))


def _ix_keystone(bmap, pieces, s, sv=0.8):
    """A larger grown crystal at the sternum, seated in its own collar (the plate field's centre)."""
    pieces.append(('keystone', SU.facet_plate(bmap, 'keystone', 'torso', 1, (sv, 0.0), 0.03 * s, 0.016 * s, 0.006 * s,
                                              collar_w=0.008 * s, ridge=0.4, terrace=True), False))


def ixari_1(bmap, body, coords, S):
    """Spire walker: a close slate-violet suit open along the spine and the outer forearms where the living crystal
    grows (the channel edges set with rhombic facet plates in slate collars); a shell of hexagonal facet plates packed
    edge to edge over the chest, light in the seams between them; a cluster of tall grown prisms on each shoulder (the
    outline); facet knee shells."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.96), (3, -0.5, 0.96)])
    cov = _channels(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.004 * s), S), False)]
    SU.hex_tiles(bmap, pieces, 'chest', 'torso', 1, (0.6, 0.9), (-62, 62), 0.021 * s, 0.008 * s, 0.005 * s, seed=1, rim=0.4)
    _ix_channel_edges(bmap, pieces, s)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        _ix_shoulder_prisms(bmap, pieces, s, side)
        SU.hex_tiles(bmap, pieces, f'knee{sd}', 'leg', side, (0.43, 0.57), (-38, 38), 0.017 * s, 0.007 * s, 0.009 * s, seed=3)
    _ix_construction(bmap, pieces, s, knees=False)
    return pieces


def ixari_2(bmap, body, coords, S):
    """Listener: a long-cut suit in the listeners' deep violet, open along the spine channel; a high collar of tall
    rhombic prisms rising behind the neck (the outline at the back); a plastron of packed hexagonal facet plates
    narrowing to a point over the sternum; facet shells on the forearms beside the crystal channel."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.96), (3, -0.5, 0.97)])
    cov = _channels(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0045 * s), S), False)]
    _ix_collar_prisms(bmap, pieces, s, length=0.2, r=0.017)
    # a faceted plastron narrowing to a point over the sternum
    SU.hex_tiles(bmap, pieces, 'plast', 'torso', 1, (0.5, 0.9), (-66, 66), 0.02 * s, 0.008 * s, 0.005 * s, seed=2, rim=0.4,
                 skip=lambda sv, th: abs(th) > 8 + 58 * (sv - 0.5) / 0.4)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        SU.hex_tiles(bmap, pieces, f'fore{sd}', 'arm', side, (0.58, 0.9), (10, 75), 0.016 * s, 0.006 * s, 0.004 * s, seed=5)
    _ix_channel_edges(bmap, pieces, s)
    _ix_construction(bmap, pieces, s)
    return pieces


def ixari_3(bmap, body, coords, S):
    """Spire guard: armour of grown facets.  Packed hexagonal facet plates over chest, belly and back (leaving the
    spine channel), shoulder prisms (the outline) over faceted pauldrons, facet vambraces beside the forearm channels,
    facet thigh shells and greaves; slate collars everywhere crystal meets the suit, light in the seams."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 0.97), (3, -0.5, 0.97)])
    cov = _channels(coords, cov)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0045 * s), S), False)]
    SU.hex_tiles(bmap, pieces, 'front', 'torso', 1, (0.38, 0.9), (-70, 70), 0.024 * s, 0.009 * s, 0.006 * s, seed=4, rim=0.4)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        SU.hex_tiles(bmap, pieces, f'back{sd}', 'torso', side, (0.48, 0.86), (98, 134), 0.024 * s, 0.009 * s, 0.006 * s, seed=6)
        _ix_shoulder_prisms(bmap, pieces, s, side, n=4, length=0.19, lean=0.75, r0=0.019)
        SU.hex_tiles(bmap, pieces, f'paul{sd}', 'arm', side, (0.05, 0.24), (30, 160), 0.022 * s, 0.009 * s, 0.006 * s, seed=8, rim=0.5)
        SU.hex_tiles(bmap, pieces, f'vamb{sd}', 'arm', side, (0.58, 0.92), (-70, 5), 0.018 * s, 0.007 * s, 0.005 * s, seed=9)
        SU.hex_tiles(bmap, pieces, f'thigh{sd}', 'leg', side, (0.1, 0.36), (-40, 80), 0.024 * s, 0.009 * s, 0.006 * s, seed=10)
        SU.hex_tiles(bmap, pieces, f'greave{sd}', 'leg', side, (0.58, 0.9), (-48, 48), 0.02 * s, 0.008 * s, 0.005 * s, seed=11)
    _ix_channel_edges(bmap, pieces, s, off=0.006)
    _ix_keystone(bmap, pieces, s, 0.78)
    _ix_construction(bmap, pieces, s, knees=False, elbows=False)
    return pieces


def ixari_4(bmap, body, coords, S):
    """Pilot: a sealed flight suit with gloves and boots, the spine channel kept open; a dorsal crest of grown prisms
    along the shoulder blades (the outline at the back), packed facet harness plates over chest and hips, facet shells
    at the knees and elbows; light in the seams."""
    s = bmap.c.s
    cov = cover_fn(coords, [(0, -1, 0.965), (1, -0.5, 1.2), (2, -9, 9), (3, -0.5, 1.2), (4, -9, 9), (7, -9, 9)])
    cov = _channels(coords, cov, forearm=False)
    pieces = [('fabric', SU.fabric(body, 'suit_fabric', cov, np.full(len(cov), 0.0035 * s), S), False)]
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        for k in range(5):
            P, N = bmap.point('torso', side, [0.9 - 0.07 * k], [126 - 3 * k], 0.004 * s)
            d = N[0] + np.array([side * 0.45, 0.25, 0.6])
            d /= np.linalg.norm(d)
            pieces.append((f'fin{k}_{sd}', SU.prism(f'fin{k}_{sd}', P[0], d, (0.15 - 0.022 * k) * s, (0.015 - 0.0015 * k) * s,
                                                    sides=4, terraces=3, seed=20 + k + 5 * (side > 0)), True))
        SU.hex_tiles(bmap, pieces, f'elbow{sd}', 'arm', side, (0.44, 0.56), (140, 210), 0.016 * s, 0.006 * s, 0.004 * s, seed=12)
        SU.hex_tiles(bmap, pieces, f'knee{sd}', 'leg', side, (0.43, 0.57), (-36, 36), 0.017 * s, 0.007 * s, 0.004 * s, seed=13)
        SU.hex_tiles(bmap, pieces, f'hip{sd}', 'torso', side, (0.24, 0.36), (40, 90), 0.018 * s, 0.007 * s, 0.004 * s, seed=14)
    SU.hex_tiles(bmap, pieces, 'harness', 'torso', 1, (0.7, 0.88), (-40, 40), 0.019 * s, 0.007 * s, 0.005 * s, seed=15, rim=0.5)
    _ix_channel_edges(bmap, pieces, s)
    _ix_keystone(bmap, pieces, s, 0.8)
    _ix_construction(bmap, pieces, s, wrists=False, ankles=False, knees=False, elbows=False)
    return pieces


# ---------------------------------------------------------------------------------------------- Ulgani
# Grown chitin lattices (lightly curved members fused at knots) over membrane panels that stretch and sag between them
# (art bible 2.3); no solid masses, no torus bands: rings are irregular grown loops with knots.

def _slits(coords, cov):
    """Open the membrane over the breathing slits on the ribs."""
    part, side, s, th = coords
    sel = (part == 0) & (s > 0.48) & (s < 0.8) & (np.abs(np.abs(th) - 92) < 14)
    cov[sel] = 0.0
    return cov


def _loop(bmap, S, pieces, pts, name, part, side, sv, n, off, r, rj, seed, th0=-180, th1=180, knots=3):
    """An irregular grown loop round a limb or the waist at map coordinate s, knotted in a few places."""
    rng = np.random.default_rng(seed)
    ths = np.linspace(th0, th1, n, endpoint=False) + rng.uniform(-8, 8, n)
    ss = np.full(n, sv) + rng.uniform(-0.01, 0.01, n)
    P, N = bmap.point(part, side, ss, ths, 0.0)
    me, C = SU.member(name, S, list(P), off, r, bow=0.0, closed=True, seed=seed, n=n * 6)
    pieces.append((name, me, False))
    pts.append(C)
    for k in range(knots):
        i = int(k * n / knots)
        q = S.project(P[i][None], iters=6)[0] + N[i] * off
        pieces.append((f'{name}_k{k}', SU.joint(f'{name}_k{k}', q, N[i], rj), False))


def _band(bmap, S, pieces, pts, name, s0, s1, n, off, r, rj, seed):
    """A lattice band round the waist: two grown loops with a zigzag of members between them."""
    rng = np.random.default_rng(seed)
    th = np.linspace(-180, 180, n, endpoint=False)
    A, NA = bmap.point('torso', 1, np.full(n, s0), th, 0.0)
    B, NB = bmap.point('torso', 1, np.full(n, s1), th + 180.0 / n, 0.0)
    for nm, P in (('a', A), ('b', B)):
        me, C = SU.member(f'{name}_{nm}', S, list(P), off, r, closed=True, seed=seed + len(nm), n=n * 6)
        pieces.append((f'{name}_{nm}', me, False))
        pts.append(C)
    for i in range(n):
        for a, b in ((A[i], B[i]), (B[i], A[(i + 1) % n])):
            me, C = SU.member(f'{name}_z{len(pieces)}', S, [a, (a + b) / 2, b], off, r * 0.75, seed=seed + 7 * i)
            pieces.append((f'{name}_z{len(pieces)}', me, False))
            pts.append(C)
    for i in range(0, n, 2):
        for P, N in ((A, NA), (B, NB)):
            q = S.project(P[i][None], iters=6)[0] + N[i] * off
            pieces.append((f'{name}_k{len(pieces)}', SU.joint(f'{name}_k{len(pieces)}', q, N[i], rj * rng.uniform(0.9, 1.1)), False))


def _arch(bmap, S, pieces, pts, name, ctrl, off, r, rj, bow, seed):
    """A free-standing grown arch (members that leave the body: shoulder yokes, dorsal frames)."""
    from .sdf import nrm as _n
    C = SU.catmull(ctrl, max(12, int(np.sum(np.linalg.norm(np.diff(np.asarray(ctrl), axis=0), axis=1)) / 0.012)))
    n = len(C)
    t = np.linspace(0, 1, n)
    R = r * (1 + 0.9 * (np.exp(-(t / 0.1) ** 2) + np.exp(-((1 - t) / 0.1) ** 2)))
    pieces.append((name, SU.tube(name, C, R, sides=8), False))
    pts.append(C)
    for i in (0, n - 1):
        q = C[i]
        Nq = S.grad(q[None])[0]
        Nq = _n(Nq)
        pieces.append((f'{name}_k{i}', SU.joint(f'{name}_k{i}', q, Nq, rj), False))


def _lift(bmap, part, side, sv, th, h):
    """A point `h` metres off the sculpt at map coordinates."""
    P, N = bmap.point(part, side, [sv], [th], h)
    return P[0]


def _web(pieces, name, root, out_dirs, normals, length, rays, s):
    """A membrane web stretched between grown ribs (a fan grown from a root line)."""
    from . import membrane
    me = membrane.build(name, root, out_dirs, normals, length, M=8 * rays + 4, K=10, rays=rays, scallop=0.12,
                        thick=0.0022 * s, rib_h=0.0032 * s, rib_w=0.22, sink=0.004 * s, fan=0.0)
    n = len(me.vertices)
    for key, val in (('kind', SU.KIND['fabric']), ('mt', 0.5), ('fillet', 0.0)):
        a = me.attributes.get(key) or me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(n, val, np.float32))
    pieces.append((name, me, False))


def _ul_fabric(body, coords, S, spec, base, pts, s, sag=True):
    cov = cover_fn(coords, spec)
    cov = _slits(coords, cov)
    thick = SU.sag_thickness(body, pts, base * 0.7, base * 0.9, 0.014 * s) if (sag and pts) else base
    return SU.fabric(body, 'suit_fabric', cov, thick, S)


def _strap(S, pieces, pts, name, ctrl, off, r, rj, seed, knots=(0, -1)):
    """A grown member that hugs the body (laid on the sculpt), knotted where it fuses."""
    me, C = SU.member(name, S, ctrl, off, r, bow=0.002, seed=seed)
    pieces.append((name, me, False))
    pts.append(C)
    for i in knots:
        q = C[i]
        Nq = S.grad(q[None])[0]
        Nq = Nq / max(np.linalg.norm(Nq), 1e-9)
        pieces.append((f'{name}_k{i}', SU.joint(f'{name}_k{i}', q, Nq, rj), False))


def _mantle(bmap, S, pieces, pts, side, s, seed):
    """Over each shoulder: three grown arches from chest to back standing off the shoulder, tied by short members at
    the crown of the arch (the suit's outline at the shoulders)."""
    sd = 'L' if side > 0 else 'R'
    tops = []
    for j, (sv, h, thf, thb) in enumerate(((0.0, 0.05, 30, 150), (0.07, 0.058, 42, 138), (0.14, 0.046, 56, 124))):
        a = _lift(bmap, 'torso', side, 0.86 - 0.02 * j, thf, 0.012 * s)
        b = _lift(bmap, 'torso', side, 0.84 - 0.02 * j, thb, 0.012 * s)
        top = _lift(bmap, 'arm', side, sv, 90, h * s)
        fr = _lift(bmap, 'arm', side, sv, 35, h * 0.75 * s)
        bk = _lift(bmap, 'arm', side, sv, 145, h * 0.75 * s)
        _arch(bmap, S, pieces, pts, f'mantle{j}_{sd}', [a, fr, top, bk, b], 0.0, 0.0058 * s, 0.0095 * s, 0.0, seed + j)
        tops.append((fr, top, bk))
    for j in range(2):
        for q in range(3):
            a, b = tops[j][q], tops[j + 1][q]
            pieces.append((f'mtie{j}{q}_{sd}', SU.tube(f'mtie{j}{q}_{sd}', SU.catmull([a, (a + b) / 2, b], 8),
                                                        np.full(8, 0.0042 * s), sides=6), False))


def _panels(coords, panels, seed):
    """Membrane panels stretched over the lattice: (part, s0, s1, th0, th1) windows of the body map whose borders
    wander (torn and fused edges), everything outside them bare skin."""
    part, side, s, th = coords
    cov = np.zeros(len(part))
    rng = np.random.default_rng(seed)
    for code, s0, s1, t0, t1 in panels:
        ph = rng.uniform(0, 2 * np.pi, 4)
        js = 0.012 * np.sin(np.radians(th) * 5 + ph[0]) + 0.007 * np.sin(np.radians(th) * 13 + ph[1])
        jt = 5.0 * np.sin(s * 37 + ph[2]) + 3.0 * np.sin(s * 91 + ph[3])
        sel = (part == code) & (s >= s0 + js) & (s <= s1 - js) & (th >= t0 + jt) & (th <= t1 - jt)
        cov[sel] = 1.0
    return cov


def _membrane(body, coords, S, panels, pts, s, seed, base=0.005):
    cov = _slits(coords, _panels(coords, panels, seed))
    thick = SU.sag_thickness(body, pts, base * 0.7, base * 1.1, 0.016 * s) if pts else base
    return SU.fabric(body, 'suit_fabric', cov, thick, S)


def _zigzag(bmap, S, pieces, pts, name, s0, s1, n, off, r, rj, seed):
    """A grown waist girdle: a zigzag of members between two staggered rows of knots (no closed hoop)."""
    rng = np.random.default_rng(seed)
    th = np.linspace(-180, 180, n, endpoint=False) + rng.uniform(-6, 6, n)
    A, NA = bmap.point('torso', 1, np.full(n, s0) + rng.uniform(-0.012, 0.012, n), th, 0.0)
    B, NB = bmap.point('torso', 1, np.full(n, s1) + rng.uniform(-0.012, 0.012, n), th + 180.0 / n, 0.0)
    for i in range(n):
        for a, b in ((A[i], B[i]), (B[i], A[(i + 1) % n])):
            me, C = SU.member(f'{name}_z{len(pieces)}', S, [a, (a + b) / 2, b], off, r * rng.uniform(0.75, 1.25), bow=0.003,
                              seed=seed + 7 * i, flare=1.15)
            pieces.append((f'{name}_z{len(pieces)}', me, False))
            pts.append(C)
    for P, N in ((A, NA), (B, NB)):
        for i in range(n):
            q = S.project(P[i][None], iters=6)[0] + N[i] * off
            pieces.append((f'{name}_k{len(pieces)}', SU.joint(f'{name}_k{len(pieces)}', q, N[i], rj * rng.uniform(0.85, 1.2)), False))


def _closure(bmap, S, pieces, pts, s0, s1, s, seed, n=6):
    """The grown front closure: a member down the sternum with fused toggles across it."""
    ctrl = [_lift(bmap, 'torso', 1, sv, 0.0, 0.0) for sv in np.linspace(s0, s1, 4)]
    _strap(S, pieces, pts, 'closure', ctrl, 0.011 * s, 0.0042 * s, 0.0075 * s, seed, knots=(0, -1))
    for i, sv in enumerate(np.linspace(s0 + 0.04, s1 - 0.04, n)):
        a = _lift(bmap, 'torso', 1, sv, 7.0, 0.012 * s)
        b = _lift(bmap, 'torso', -1, sv, 7.0, 0.012 * s)
        pieces.append((f'toggle{i}', SU.tube(f'toggle{i}', SU.catmull([a, (a + b) / 2 + np.array([0, -0.004 * s, 0]), b], 8),
                                             np.full(8, 0.0042 * s), sides=6, kind='joint'), False))


def _cartridges(bmap, S, pieces, s, th=104, sv=0.3, n=2):
    """Cartridge Recycler pods (the people's perk): grown pods on the hips, each with a dark intake port."""
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        for j in range(n):
            c = _lift(bmap, 'torso', side, sv + 0.07 * j, th + 14 * j, 0.03 * s)
            P, N = bmap.point('torso', side, [sv + 0.07 * j], [th + 14 * j], 0.0)
            ax = np.array([0.0, 0.0, 1.0])
            pieces.append((f'cart{j}_{sd}', SU.ovoid_sac(f'cart{j}_{sd}', c, ax, 0.032 * s, 0.021 * s), True))
            top = c + ax * 0.03 * s
            pieces.append((f'port{j}_{sd}', SU.joint(f'port{j}_{sd}', top, ax, 0.011 * s, squash=0.35, kind='port'), True))
            a = _lift(bmap, 'torso', side, sv + 0.07 * j + 0.05, th + 14 * j, 0.004 * s)
            pieces.append((f'cstalk{j}_{sd}', SU.tube(f'cstalk{j}_{sd}', SU.catmull([a, (a + top) / 2 + N[0] * 0.01 * s, top], 8),
                                                      np.linspace(0.006, 0.004, 8) * s, sides=6), False))


def _yoke_web(bmap, pieces, s, height=0.1):
    """A standing membrane fan across the upper back and behind the neck, grown on chitin ribs: a pale mass that
    changes the outline at the shoulders."""
    root = [_lift(bmap, 'torso', 1 if th < 180 else -1, 0.93, th if th < 180 else 360 - th, 0.014 * s) for th in (130, 155, 180, 205, 230)]
    outd = [np.array([0.5 * (2 - i) / 2, 0.5, 1.0]) for i in range(5)]
    _web(pieces, 'yoke', root, outd, [np.array([0.0, -1.0, 0.0])] * 5, [height * s * f for f in (0.8, 1.0, 1.1, 1.0, 0.8)], 4, s)


def ulgani_1(bmap, body, coords, S):
    """Moor walker: grown chitin lattices over chest and back with membrane panels stretched between the members, a
    lattice mantle arching over each shoulder and a membrane fan standing across the upper back (the outline), a
    zigzag girdle, the front closure, cartridge pods on the hips; arms, legs and the rib slits bare."""
    s = bmap.c.s
    pieces, pts = [], []
    rng = np.random.default_rng(11)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.5, 0.66, 0.82], [-60, -30, 0, 30, 60], rng, (0.02, 7))
    pts += SU.lattice(pieces, S, G, N, 'latF', 0.008 * s, 0.0055 * s, 0.0105 * s, seed=1, skip=0.15)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.5, 0.67, 0.84], [130, 155, 180, 205, 230], rng, (0.02, 7))
    pts += SU.lattice(pieces, S, G, N, 'latB', 0.008 * s, 0.0055 * s, 0.0105 * s, seed=2, skip=0.15)
    for side in (1, -1):
        _mantle(bmap, S, pieces, pts, side, s, 30 + 10 * (side > 0))
    _yoke_web(bmap, pieces, s, 0.15)
    _zigzag(bmap, S, pieces, pts, 'waist', 0.28, 0.36, 10, 0.009 * s, 0.0052 * s, 0.0095 * s, 60)
    _closure(bmap, S, pieces, pts, 0.42, 0.9, s, 70)
    _cartridges(bmap, S, pieces, s)
    fab = _membrane(body, coords, S, [(0, 0.48, 0.86, 4, 62), (0, 0.48, 0.88, 126, 181), (1, -0.1, 0.17, -40, 181)], pts, s, 1)
    return [('fabric', fab, False)] + pieces


def ulgani_2(bmap, body, coords, S):
    """Spore tender: a harness of grown members over the shoulders carrying a dorsal spore frame (an open chitin cage
    standing off the back with three spore sacs: the outline), membrane panels over the shoulder yoke, the belly and
    the knees, lattice knee caps, a zigzag girdle, cartridge pods in small cradles on the hips."""
    s = bmap.c.s
    pieces, pts = [], []
    rng = np.random.default_rng(12)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        for j, (thf, thb) in enumerate(((18, 162), (40, 144))):
            ctrl = [_lift(bmap, 'torso', side, 0.42, thf, 0.0), _lift(bmap, 'torso', side, 0.62, thf + 6, 0.0),
                    _lift(bmap, 'torso', side, 0.84, thf + 14, 0.0), _lift(bmap, 'torso', side, 0.985, 90 - 12 * j, 0.0),
                    _lift(bmap, 'torso', side, 0.84, thb - 14, 0.0), _lift(bmap, 'torso', side, 0.62, thb - 6, 0.0),
                    _lift(bmap, 'torso', side, 0.44, thb, 0.0)]
            _strap(S, pieces, pts, f'harness{j}_{sd}', ctrl, 0.009 * s, 0.0055 * s, 0.009 * s, 20 + j, knots=(0, len(ctrl) * 2, -1))
        # a lattice mantle over each shoulder: the suit's mass in the outline, as on the other three
        _mantle(bmap, S, pieces, pts, side, s, 34 + 10 * (side > 0))
        for k, th in enumerate((56, 98)):
            a = _lift(bmap, 'torso', side, 0.2, th, 0.008 * s)
            b = _lift(bmap, 'torso', side, 0.36, th, 0.008 * s)
            mid = _lift(bmap, 'torso', side, 0.28, th, 0.05 * s)
            _arch(bmap, S, pieces, pts, f'cradle{k}_{sd}', [a, mid, b], 0.0, 0.0045 * s, 0.0075 * s, 0.0, 80 + k)
        G, N = SU.node_grid(bmap, 'leg', side, [0.42, 0.5, 0.58], [-50, 0, 50], rng, (0.008, 6))
        pts += SU.lattice(pieces, S, G, N, f'knee{sd}', 0.01 * s, 0.0046 * s, 0.0085 * s, seed=11 + side)
    for k, th in enumerate((146, 165, 195, 214)):
        ctrl = [_lift(bmap, 'torso', 1, 0.44, th, 0.012 * s), _lift(bmap, 'torso', 1, 0.56, th, 0.085 * s),
                _lift(bmap, 'torso', 1, 0.76, th, 0.1 * s), _lift(bmap, 'torso', 1, 0.94, th, 0.035 * s)]
        _arch(bmap, S, pieces, pts, f'frame{k}', ctrl, 0.0, 0.006 * s, 0.0095 * s, 0.0, 90 + k)
    for h, sv in enumerate((0.56, 0.68, 0.8)):
        hoop = [_lift(bmap, 'torso', 1, sv, th, (0.084 + 0.014 * (h == 1)) * s) for th in (138, 165, 195, 222)]
        _arch(bmap, S, pieces, pts, f'hoop{h}', hoop, 0.0, 0.0048 * s, 0.008 * s, 0.0, 100 + h)
    for h, sv in enumerate((0.6, 0.71, 0.82)):
        c = _lift(bmap, 'torso', 1, sv, 180, 0.07 * s)
        pieces.append((f'sac{h}', SU.ovoid_sac(f'sac{h}', c, np.array([0.0, 0.25, 1.0]), 0.064 * s, 0.05 * s), True))
    # a grown lattice over the chest with its membrane, the same coverage as the other suits
    G, N = SU.node_grid(bmap, 'torso', 1, [0.48, 0.64, 0.8], [-58, -29, 0, 29, 58], rng, (0.02, 7))
    pts += SU.lattice(pieces, S, G, N, 'latF', 0.008 * s, 0.0055 * s, 0.0105 * s, seed=5, skip=0.18)
    _zigzag(bmap, S, pieces, pts, 'waist', 0.28, 0.35, 10, 0.009 * s, 0.005 * s, 0.009 * s, 60)
    _cartridges(bmap, S, pieces, s, th=78, sv=0.24, n=1)
    fab = _membrane(body, coords, S, [(0, 0.84, 0.97, -1, 181), (0, 0.3, 0.5, 3, 70), (0, 0.48, 0.84, 4, 58), (3, 0.38, 0.62, -70, 70)],
                    pts, s, 2)
    return [('fabric', fab, False)] + pieces


def ulgani_3(bmap, body, coords, S):
    """Root guard: grown lattices over chest, back, forearms and shins with membrane panels taut between the members,
    a lattice knee cap, shoulder flanges of chitin ribs with membrane webs and the mantle (the outline), a zigzag
    girdle, the front closure, cartridge pods; upper arms, thighs and feet bare."""
    s = bmap.c.s
    pieces, pts = [], []
    rng = np.random.default_rng(13)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.38, 0.52, 0.66, 0.8, 0.92], [-66, -33, 0, 33, 66], rng, (0.015, 6))
    pts += SU.lattice(pieces, S, G, N, 'latF', 0.009 * s, 0.0055 * s, 0.0105 * s, seed=3, skip=0.12)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.44, 0.62, 0.8, 0.93], [122, 151, 180, 209, 238], rng, (0.015, 6))
    pts += SU.lattice(pieces, S, G, N, 'latB', 0.009 * s, 0.0055 * s, 0.0105 * s, seed=4, skip=0.12)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        G, N = SU.node_grid(bmap, 'arm', side, [0.6, 0.76, 0.92], np.linspace(-180, 180, 5, endpoint=False), rng, (0.015, 10))
        pts += SU.lattice(pieces, S, G, N, f'latA{sd}', 0.008 * s, 0.0048 * s, 0.0085 * s, seed=7 + side, closed_th=True)
        G, N = SU.node_grid(bmap, 'leg', side, [0.6, 0.76, 0.92], np.linspace(-180, 180, 5, endpoint=False), rng, (0.015, 10))
        pts += SU.lattice(pieces, S, G, N, f'latL{sd}', 0.009 * s, 0.0052 * s, 0.009 * s, seed=9 + side, closed_th=True)
        G, N = SU.node_grid(bmap, 'leg', side, [0.44, 0.56], [-40, 0, 40], rng, (0.005, 4))
        pts += SU.lattice(pieces, S, G, N, f'knee{sd}', 0.01 * s, 0.0046 * s, 0.0085 * s, seed=11 + side)
        _mantle(bmap, S, pieces, pts, side, s, 30 + 10 * (side > 0))
        root = [_lift(bmap, 'arm', side, sv, 90, 0.012 * s) for sv in (0.0, 0.08, 0.16)]
        outd = [np.array([side * 0.55, 0.0, 1.0]), np.array([side * 0.8, 0.0, 0.75]), np.array([side * 1.0, 0.0, 0.45])]
        _web(pieces, f'flange_{sd}', root, outd, [np.array([0.0, -1.0, 0.0])] * 3, [0.095 * s, 0.11 * s, 0.09 * s], 4, s)
    _zigzag(bmap, S, pieces, pts, 'waist', 0.25, 0.33, 10, 0.01 * s, 0.0056 * s, 0.01 * s, 61)
    _closure(bmap, S, pieces, pts, 0.36, 0.93, s, 71, n=7)
    _cartridges(bmap, S, pieces, s, th=112, sv=0.27)
    fab = _membrane(body, coords, S, [(0, 0.36, 0.94, 4, 66), (0, 0.42, 0.95, 120, 181), (1, 0.58, 0.94, -181, 181),
                                      (3, 0.58, 0.94, -181, 181)], pts, s, 3)
    return [('fabric', fab, False)] + pieces


def ulgani_4(bmap, body, coords, S):
    """Pilot: grown lattices over chest, back, upper arms and thighs with membrane panels between the members,
    grown straps crossing the chest to the hips, a dorsal arch rising behind the head from the shoulder blades with a
    membrane web (the outline), a zigzag girdle, the front closure, cartridge pods; forearms, shins and feet bare."""
    s = bmap.c.s
    pieces, pts = [], []
    rng = np.random.default_rng(14)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.46, 0.6, 0.74, 0.88], [-62, -31, 0, 31, 62], rng, (0.015, 6))
    pts += SU.lattice(pieces, S, G, N, 'latF', 0.009 * s, 0.0052 * s, 0.01 * s, seed=5, skip=0.1)
    G, N = SU.node_grid(bmap, 'torso', 1, [0.46, 0.62, 0.78, 0.9], [124, 152, 180, 208, 236], rng, (0.015, 6))
    pts += SU.lattice(pieces, S, G, N, 'latB', 0.009 * s, 0.0052 * s, 0.01 * s, seed=6, skip=0.1)
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        G, N = SU.node_grid(bmap, 'arm', side, [0.12, 0.28, 0.44], np.linspace(-180, 180, 5, endpoint=False), rng, (0.015, 10))
        pts += SU.lattice(pieces, S, G, N, f'latA{sd}', 0.009 * s, 0.0048 * s, 0.0085 * s, seed=15 + side, closed_th=True)
        G, N = SU.node_grid(bmap, 'leg', side, [0.1, 0.26, 0.42], np.linspace(-180, 180, 6, endpoint=False), rng, (0.015, 10))
        pts += SU.lattice(pieces, S, G, N, f'latL{sd}', 0.01 * s, 0.0052 * s, 0.009 * s, seed=17 + side, closed_th=True)
        ctrl = [_lift(bmap, 'torso', side, 0.9, 42, 0.0), _lift(bmap, 'torso', side, 0.74, 22, 0.0),
                _lift(bmap, 'torso', 1, 0.6, 0, 0.0), _lift(bmap, 'torso', -side, 0.45, 28, 0.0), _lift(bmap, 'torso', -side, 0.3, 62, 0.0)]
        _strap(S, pieces, pts, f'cross_{sd}', ctrl, 0.016 * s, 0.0062 * s, 0.01 * s, 20 + side)
    lb = _lift(bmap, 'torso', 1, 0.76, 150, 0.018 * s)
    rb = _lift(bmap, 'torso', -1, 0.76, 150, 0.018 * s)
    head = bmap.c.bs['neck_02']['tail']
    apex = head + np.array([0.0, 0.13 * s, 0.1 * s])
    ql = (lb + apex) / 2 + np.array([0.045 * s, 0.045 * s, 0.0])
    qr = (rb + apex) / 2 + np.array([-0.045 * s, 0.045 * s, 0.0])
    arch = [lb, ql, apex, qr, rb]
    _arch(bmap, S, pieces, pts, 'arch', arch, 0.0, 0.0075 * s, 0.012 * s, 0.0, 30)
    C = SU.catmull(arch, 41)
    tgt = [C[i] for i in (7, 13, 20, 27, 33)]
    root = [lb + (rb - lb) * f + np.array([0.0, 0.006 * s, 0.012 * s]) for f in (0.2, 0.35, 0.5, 0.65, 0.8)]
    outd = [t_ - r_ for t_, r_ in zip(tgt, root)]
    _web(pieces, 'archweb', root, outd, [np.array([0.0, 1.0, 0.0])] * 5, [np.linalg.norm(o) * 0.97 for o in outd], 4, s)
    _zigzag(bmap, S, pieces, pts, 'waist', 0.27, 0.35, 10, 0.009 * s, 0.005 * s, 0.009 * s, 62)
    _closure(bmap, S, pieces, pts, 0.42, 0.9, s, 72)
    _cartridges(bmap, S, pieces, s, th=96, sv=0.29)
    fab = _membrane(body, coords, S, [(0, 0.44, 0.9, 4, 64), (0, 0.44, 0.92, 122, 181), (1, 0.1, 0.46, -181, 181),
                                      (3, 0.08, 0.44, -181, 181)], pts, s, 4)
    return [('fabric', fab, False)] + pieces


SUITS = {
    'thalune': {1: thalune_1, 2: thalune_2, 3: thalune_3, 4: thalune_4},
    'ixari': {1: ixari_1, 2: ixari_2, 3: ixari_3, 4: ixari_4},
    'ulgani': {1: ulgani_1, 2: ulgani_2, 3: ulgani_3, 4: ulgani_4},
}
