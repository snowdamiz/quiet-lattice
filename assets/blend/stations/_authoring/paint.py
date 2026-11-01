"""Trim sheets for the station kits, painted with numpy (rows are v from the bottom, as Blender stores pixels).

Every sheet is 2048 x 2048 at 256 px/m: strips run the full width and tile along u every 8 m, so a mesh maps a face to a
strip by its role (a plate row, a lap edge, a threshold, a rail) and the wear sits where that role is used.
"""
import numpy as np

N = 2048
PPM = 256  # pixels per metre


def srgb(hexs):
    h = hexs.lstrip("#")
    c = np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


class Rng:
    def __init__(self, seed):
        self.r = np.random.default_rng(seed)


def _up(grid, h, w):
    """Tileable smooth upsample of a small random grid to h x w."""
    gh, gw = grid.shape
    y = (np.arange(h) + 0.5) * gh / h - 0.5
    x = (np.arange(w) + 0.5) * gw / w - 0.5
    y0 = np.floor(y).astype(int)
    x0 = np.floor(x).astype(int)
    fy = y - y0
    fx = x - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = grid[np.ix_(y0 % gh, x0 % gw)]
    b = grid[np.ix_(y0 % gh, (x0 + 1) % gw)]
    c = grid[np.ix_((y0 + 1) % gh, x0 % gw)]
    d = grid[np.ix_((y0 + 1) % gh, (x0 + 1) % gw)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def noise(h, w, cells, rng, octaves=4, gain=0.5, aspect=1.0):
    """fBm value noise in 0..1, tileable along both axes; `cells` across the width at the first octave."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    cw = max(1, int(cells))
    for _ in range(octaves):
        ch = max(1, int(round(cw * h / w * aspect)))
        out += amp * _up(rng.r.random((ch, cw)).astype(np.float32), h, w)
        tot += amp
        amp *= gain
        cw *= 2
    return out / tot


def blur(a, r):
    """Box blur three times (about Gaussian), wrapping along u, clamped along v."""
    r = int(max(1, r))
    out = a.astype(np.float32)
    for _ in range(3):
        p = np.concatenate([out[:, -r:], out, out[:, :r]], axis=1)
        c = np.cumsum(p, axis=1)
        c = np.concatenate([np.zeros((c.shape[0], 1), np.float32), c], axis=1)
        out = (c[:, 2 * r + 1 :] - c[:, : -2 * r - 1]) / (2 * r + 1)
        p = np.concatenate([np.repeat(out[:1], r, 0), out, np.repeat(out[-1:], r, 0)], axis=0)
        c = np.cumsum(p, axis=0)
        c = np.concatenate([np.zeros((1, c.shape[1]), np.float32), c], axis=0)
        out = (c[2 * r + 1 :] - c[: -2 * r - 1]) / (2 * r + 1)
    return out


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Sheet:
    """Channels of one trim sheet. `rows(v0, v1)` paints a strip, v in pixels from the bottom."""

    def __init__(self, name, seed, n=N):
        self.name = name
        self.n = n
        self.rng = Rng(seed)
        self.base = np.zeros((n, n, 3), np.float32)
        self.rough = np.full((n, n), 0.5, np.float32)
        self.metal = np.zeros((n, n), np.float32)
        self.height = np.zeros((n, n), np.float32)
        self.ao = np.ones((n, n), np.float32)
        self.emit = np.zeros((n, n, 3), np.float32)
        self.alpha = None
        self.strips = {}

    def strip(self, key, v0, v1):
        self.strips[key] = (v0 / self.n, v1 / self.n)
        return Strip(self, v0, v1)

    def finish(self, normal_strength=6.0, cavity=0.55):
        h = self.height
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
        dy = np.zeros_like(h)
        dy[1:-1] = (h[2:] - h[:-2]) * 0.5
        n = np.stack([-dx * normal_strength, -dy * normal_strength, np.ones_like(h)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        self.normal = n * 0.5 + 0.5
        cav = np.clip((blur(h, 6) - h) * 9.0, 0, 1)
        self.ao = np.clip(self.ao * (1 - cav * cavity), 0, 1)


class Strip:
    def __init__(self, sheet, v0, v1):
        self.s = sheet
        self.v0, self.v1 = v0, v1
        self.h = v1 - v0
        self.sl = (slice(v0, v1), slice(None))
        self.v = (np.arange(self.h, dtype=np.float32) + 0.5)[:, None] / PPM * np.ones((1, sheet.n), np.float32)  # m from strip bottom
        self.u = (np.arange(sheet.n, dtype=np.float32) + 0.5)[None, :] / PPM * np.ones((self.h, 1), np.float32)  # m along u

    @property
    def H(self):
        return self.h / PPM

    def noise(self, cells, octaves=4, gain=0.5, aspect=1.0):
        return noise(self.h, self.s.n, cells * self.s.n // N, self.s.rng, octaves, gain, aspect)

    def set(self, base=None, rough=None, metal=None, height=None, ao=None, emit=None):
        s = self.s
        if base is not None:
            s.base[self.sl] = base
        if rough is not None:
            s.rough[self.sl] = rough
        if metal is not None:
            s.metal[self.sl] = metal
        if height is not None:
            s.height[self.sl] = height
        if ao is not None:
            s.ao[self.sl] = ao
        if emit is not None:
            s.emit[self.sl] = emit


def mix(a, b, t):
    t = t[..., None] if a.ndim == 3 or (np.ndim(b) and np.ndim(b) == 3) else t
    return a * (1 - t) + b * t


def col(c, shape):
    return np.ones(shape + (3,), np.float32) * c


def periodic(x, period):
    return np.mod(x, period)


def dist_to_grid(x, period):
    """Distance from x to the nearest multiple of period."""
    m = np.mod(x, period)
    return np.minimum(m, period - m)


def rivets(st, u_step, v_at, r=0.012, u_off=0.0):
    """Dome rivet height field along a line v = v_at, every u_step metres."""
    du = dist_to_grid(st.u - u_off, u_step)
    dv = st.v - v_at
    d = np.sqrt(du * du + dv * dv)
    return np.clip(1 - (d / r) ** 2, 0, 1) ** 0.5


def chip_mask(st, edge_dist, width, cells=40, bias=0.0):
    """Paint chipped off near an edge: `edge_dist` metres from the edge that wears, noisy boundary, a few deep chips."""
    n = st.noise(cells, octaves=5, gain=0.55)
    n2 = st.noise(cells * 3, octaves=3)
    reach = width * (0.35 + 1.3 * n) + bias
    m = smooth(0.0, 0.006, reach - edge_dist)
    spots = smooth(0.70, 0.74, n2) * smooth(width * 3, width * 0.5, edge_dist)
    return np.clip(np.maximum(m, spots), 0, 1)


def grime_from(cav, st, amount=1.0, cells=12):
    n = st.noise(cells, octaves=4)
    return np.clip(cav * (0.6 + 0.8 * n) * amount, 0, 1)


# ---------------------------------------------------------------------------------------------- the Compact sheets
WHITE = srgb("#F4F4F0") * 0.86  # station white, held under 0.9 albedo so it never blows out
BLUE = srgb("#22406A")
ORANGE = srgb("#F28C28")
METAL = srgb("#8A8F96")
DARK = srgb("#2C2F34")
GRAPHITE = srgb("#3A3B3D")
GRIME = srgb("#3b352c")


def plate_row(st, body, *, lap_top=0.05, seam_every=4.0, seam_off=0.0, band=None, chip_bottom=0.05, grime=1.0, tone=0.08, rivet_step=0.25):
    """A lapped shell plate row: the row above overlaps its top edge, its own bottom edge is the exposed lap that chips;
    vertical joints every `seam_every` m; a rivet line under the lap. `band` = (v0, v1, colour) paints a livery band."""
    H = st.H
    v, u = st.v, st.u
    h = np.zeros_like(v)
    # lap: the top lip sits under the row above (recessed), the bottom edge is a rounded exposed edge
    h -= smooth(H - lap_top, H - lap_top + 0.01, v) * 0.35
    h += (1 - smooth(0.0, 0.03, v)) * -0.25
    j = dist_to_grid(u - seam_off, seam_every)
    h -= (1 - smooth(0.004, 0.012, j)) * 0.5
    h += rivets(st, rivet_step, H - lap_top - 0.07, 0.014, u_off=seam_off + rivet_step / 2) * 0.35
    panel = np.floor((u - seam_off) / seam_every)
    rnd = np.random.default_rng(int(st.v0) + 7)
    shade = rnd.random(int(st.s.n / PPM / seam_every) + 2).astype(np.float32)[(panel.astype(int) % (int(st.s.n / PPM / seam_every)))]
    b = col(body, v.shape) * (1 + (shade[..., None] - 0.5) * tone)
    if band is not None:
        bv0, bv1, bc = band
        bm = smooth(bv0 - 0.004, bv0 + 0.004, v) * (1 - smooth(bv1 - 0.004, bv1 + 0.004, v))
        b = mix(b, col(bc, v.shape), bm)
    # chips at the exposed bottom edge and at the joints (hands and tools catch edges, not faces)
    chips = chip_mask(st, np.minimum(v, j * 1.6 + 0.02), chip_bottom, cells=60)
    cav = np.clip((blur(h, 5) - h) * 8, 0, 1)
    g = grime_from(cav, st, grime)
    # a faint run-off below the rivet line, strongest under joints
    runoff = smooth(H - lap_top - 0.07, H - lap_top - 0.5, v) * smooth(H - lap_top - 0.9, H - lap_top - 0.07, v)
    runoff *= (st.noise(80, octaves=2, aspect=0.15) ** 3) * 0.6 * grime
    base = mix(b, col(METAL * 0.9, v.shape), chips)
    base = mix(base, col(GRIME, v.shape), np.clip(g * 0.55 + runoff * 0.35, 0, 0.7))
    rough = 0.40 + 0.06 * st.noise(24, 3) + g * 0.25 - chips * 0.08
    metal = chips * 0.95
    h = h - chips * 0.08
    st.set(base=base, rough=rough, metal=metal, height=h)
    return h


def stencil(st, text, u0, v0, size, colour, alpha=0.85):
    """Paints stencil numerals (3 x 5 cells, gaps between cells like a cut stencil) at (u0, v0) metres, `size` tall."""
    cw = size / 5.0
    for k, ch in enumerate(text):
        g = DIGITS.get(ch)
        if g is None:
            continue
        for r in range(5):
            for c in range(3):
                if g[r][c] != "1":
                    continue
                x0 = u0 + (k * 4 + c) * cw
                y1 = v0 + size - r * cw
                m = (st.u > x0 + cw * 0.12) & (st.u < x0 + cw * 0.88) & (st.v > y1 - cw * 0.88) & (st.v < y1 - cw * 0.12)
                if m.any():
                    a = m.astype(np.float32) * alpha
                    base = st.s.base[st.sl]
                    st.s.base[st.sl] = base * (1 - a[..., None]) + colour * a[..., None]
                    st.s.rough[st.sl] = st.s.rough[st.sl] * (1 - a) + 0.5 * a


def compact_shell():
    s = Sheet("WS_Shell", 11)
    # A: white plate row, 2 m, with panel numbers stencilled where the riggers read them
    st = s.strip("plate", 0, 512)
    plate_row(st, WHITE)
    # B: white plate row with the Compact blue band, 2 m
    st = s.strip("plate_band", 512, 1024)
    plate_row(st, WHITE, band=(0.35, 0.80, BLUE), seam_off=0.7)
    # C: deep blue accent row, 2 m
    st = s.strip("accent", 1024, 1536)
    plate_row(st, BLUE, seam_off=1.3, tone=0.09)
    # D: rib cap, 1 m (v across the rib, u along it): crown wears where the shell is handled during maintenance
    st = s.strip("rib", 1536, 1792)
    v = st.v
    prof = np.sin(np.clip(v / st.H, 0, 1) * np.pi)
    h = prof * 0.6 + rivets(st, 0.3, st.H * 0.5, 0.016) * 0.3
    edge = np.minimum(v, st.H - v)
    chips = chip_mask(st, edge, 0.06, cells=70)
    crown = (1 - smooth(0.0, 0.05, np.abs(v - st.H * 0.5))) * smooth(0.55, 0.8, st.noise(30, 3, aspect=0.2)) * 0.5
    base = mix(col(WHITE * 0.97, v.shape), col(METAL * 0.9, v.shape), np.maximum(chips, crown))
    cav = np.clip((blur(h, 4) - h) * 8, 0, 1)
    base = mix(base, col(GRIME, v.shape), grime_from(cav, st) * 0.5)
    st.set(base=base, rough=0.4 + 0.1 * st.noise(30, 3) - crown * 0.1, metal=np.maximum(chips, crown) * 0.95, height=h)
    # E: signal-orange trim stripe, 0.5 m, with Compact lap chevrons
    st = s.strip("signal", 1792, 1920)
    v, u = st.v, st.u
    chev = np.mod(u + np.abs(v - st.H / 2) * 1.2, 0.8) < 0.4
    body = np.where(chev[..., None], ORANGE, ORANGE * 0.62)
    edge = np.minimum(v, st.H - v)
    h = -(1 - smooth(0.0, 0.02, edge)) * 0.3
    chips = chip_mask(st, edge, 0.03, cells=90)
    base = mix(body.astype(np.float32), col(METAL * 0.85, v.shape), chips)
    st.set(base=base, rough=0.45 + 0.08 * st.noise(30, 3), metal=chips * 0.9, height=h)
    # F: lip / threshold, 0.5 m: bare worn metal where traffic crosses, scuffs along u, paint left at the margins
    st = s.strip("lip", 1920, 2048)
    v, u = st.v, st.u
    edge = np.minimum(v, st.H - v)
    worn = smooth(0.03, 0.12, edge) * (0.75 + 0.25 * st.noise(20, 3))
    scuff = smooth(0.6, 0.9, st.noise(200, octaves=2, aspect=0.04)) * worn
    base = mix(col(BLUE * 0.9, v.shape), col(METAL * 0.95, v.shape), smooth(0.35, 0.6, worn))
    base = mix(base, col(METAL * 1.1, v.shape), scuff * 0.6)
    packed = (1 - smooth(0.0, 0.1, edge)) * (0.55 + 0.45 * st.noise(40, 3, aspect=0.2))
    base = mix(base, col(GRIME * 0.8, v.shape), packed * 0.75)
    h = (1 - smooth(0.0, 0.015, edge)) * -0.3 - scuff * 0.05
    st.set(base=base, rough=0.5 - worn * 0.18 - scuff * 0.08 + packed * 0.2, metal=smooth(0.35, 0.6, worn) * (1 - packed), height=h)
    s.finish()
    return s


def compact_metal():
    s = Sheet("WS_Metal", 23)
    # A: lattice member, 2 m across the member's girth: painted graphite with fused fillet grime at the edges
    st = s.strip("lattice", 0, 512)
    v, u = st.v, st.u
    edge = np.minimum(v, st.H - v)
    h = smooth(0.0, 0.12, edge) * 0.4 + (st.noise(6, 3, aspect=0.3) - 0.5) * 0.08
    rib = 1 - smooth(0.004, 0.012, dist_to_grid(u, 1.5))
    h -= rib * 0.25
    cav = np.clip((blur(h, 8) - h) * 6, 0, 1)
    g = grime_from(cav, st, 1.2)
    chips = chip_mask(st, edge, 0.05, cells=50)
    body = col(GRAPHITE * 1.15, v.shape) * (1 + (st.noise(4, 2) - 0.5)[..., None] * 0.08)
    base = mix(mix(body, col(METAL * 0.8, v.shape), chips), col(GRIME * 0.8, v.shape), g * 0.5)
    st.set(base=base, rough=0.48 + g * 0.2 - chips * 0.1, metal=0.25 + chips * 0.7, height=h)
    # B: dark machinery panel, 2 m: louvres in the middle, bolts at the corners
    st = s.strip("machine", 512, 1024)
    v, u = st.v, st.u
    pu = np.mod(u, 1.0)
    inner = (np.abs(v - st.H / 2) < 0.7) & (np.abs(pu - 0.5) < 0.42)
    louvre = np.where(inner, (np.mod(v, 0.08) / 0.08) * 0.5 - 0.4, 0.0)
    frame = 1 - smooth(0.004, 0.01, dist_to_grid(u, 1.0))
    h = louvre - frame * 0.4 + rivets(st, 1.0, 0.15, 0.02, 0.06) * 0.4 + rivets(st, 1.0, st.H - 0.15, 0.02, 0.06) * 0.4
    cav = np.clip((blur(h, 5) - h) * 6, 0, 1)
    g = grime_from(cav, st, 1.3)
    base = mix(col(DARK * 1.1, v.shape), col(GRIME * 0.6, v.shape), g * 0.6)
    st.set(base=base, rough=0.42 + g * 0.2, metal=0.8, height=h)
    # C: brushed trim metal, 1 m (brushing follows u)
    st = s.strip("trim", 1024, 1280)
    v, u = st.v, st.u
    brush = st.noise(4, 2) * 0.3 + noise(st.h, N, 600, s.rng, 2, 0.5, aspect=0.004) * 0.7
    edge = np.minimum(v, st.H - v)
    h = -(1 - smooth(0.0, 0.02, edge)) * 0.3
    cav = np.clip((blur(h, 4) - h) * 6, 0, 1)
    base = mix(col(METAL * (0.92 + 0.1 * brush[..., None]), v.shape), col(GRIME, v.shape), grime_from(cav, st) * 0.4)
    st.set(base=base, rough=0.3 + brush * 0.12, metal=1.0, height=h)
    # D: radiator fins, 1 m: parallel channels along u, heat-darkened mid band
    st = s.strip("radiator", 1280, 1536)
    v, u = st.v, st.u
    fin = np.abs(np.mod(v, 0.0625) / 0.0625 - 0.5) * 2
    h = fin * 0.5
    heat = np.exp(-((v - st.H / 2) / 0.3) ** 2) * (0.7 + 0.3 * st.noise(10, 2))
    base = mix(col(METAL * 0.75, v.shape), col(srgb("#4a3d36"), v.shape), heat * 0.5)
    st.set(base=base, rough=0.35 + heat * 0.15, metal=0.9, height=h)
    # E: conduit, 1 m around the pipe: clamps every 1.5 m, grime on the underside (v near 0 and H)
    st = s.strip("pipe", 1536, 1792)
    v, u = st.v, st.u
    clamp = 1 - smooth(0.04, 0.06, dist_to_grid(u, 1.5))
    h = clamp * 0.5 + rivets(st, 1.5, st.H * 0.5, 0.025) * clamp * 0.3
    under = 1 - smooth(0.0, 0.3, np.minimum(v, st.H - v))
    base = mix(col(BLUE * 1.1, v.shape), col(METAL, v.shape), clamp)
    base = mix(base, col(GRIME, v.shape), under * 0.35 * st.noise(20, 3))
    st.set(base=base, rough=0.45 + under * 0.15, metal=clamp * 0.9, height=h)
    # F: railing tube, 0.5 m around: the top third polished bare by hands, painted orange below
    st = s.strip("rail", 1792, 1920)
    v, u = st.v, st.u
    top = np.exp(-((v - st.H * 0.5) / 0.06) ** 2) * (0.8 + 0.2 * st.noise(40, 3, aspect=0.3))
    under = (1 - smooth(0.0, 0.12, np.minimum(v, st.H - v))) * (0.5 + 0.5 * st.noise(30, 3, aspect=0.3))
    base = mix(col(ORANGE * 0.85, v.shape), col(METAL * 1.05, v.shape), smooth(0.3, 0.6, top))
    base = mix(base, col(GRIME * 0.7, v.shape), under * 0.7)
    st.set(base=base, rough=0.45 - top * 0.25 + under * 0.2, metal=smooth(0.3, 0.6, top), height=top * 0.1)
    # G: light fixture, 0.5 m: dark housing, a nav-white lens strip only in the middle
    st = s.strip("light", 1920, 2048)
    v, u = st.v, st.u
    lens = (np.abs(v - st.H / 2) < 0.07) & (dist_to_grid(u, 2.0) > 0.08)
    h = np.where(lens, 0.2, 0.0) - (1 - smooth(0.0, 0.02, np.minimum(v, st.H - v))) * 0.3
    h -= (np.abs(np.abs(v - st.H / 2) - 0.085) < 0.008).astype(np.float32) * 0.3
    base = np.where(lens[..., None], np.float32(0.85), DARK * 1.2).astype(np.float32)
    emit = np.where(lens[..., None], np.float32(1.0), np.float32(0.0)) * np.ones((1, 1, 3), np.float32)
    st.set(base=base, rough=np.where(lens, 0.15, 0.45), metal=np.where(lens, 0.0, 0.7), height=h, emit=emit)
    s.finish()
    return s


def compact_deck():
    s = Sheet("WS_Deck", 37)
    # A: deck plate, 2 m: 1 m tread tiles, tie-down sockets, scuffs where carts turn (light, broad)
    st = s.strip("deck", 0, 512)
    v, u = st.v, st.u
    seam = np.minimum(dist_to_grid(u, 1.0), dist_to_grid(v, 1.0))
    h = -(1 - smooth(0.004, 0.01, seam)) * 0.5
    du, dv = np.mod(u, 0.1) - 0.05, np.mod(v + 0.05 * (np.floor(u / 0.1) % 2), 0.1) - 0.05
    h += np.clip(1 - (np.sqrt(du * du * 4 + dv * dv * 0.6) / 0.03), 0, 1) * 0.15  # tread bosses
    tie = np.sqrt(dist_to_grid(u - 1.0, 2.0) ** 2 + dist_to_grid(v - 1.0, 2.0) ** 2)
    h -= (np.abs(tie - 0.06) < 0.015).astype(np.float32) * 0.3
    cav = np.clip((blur(h, 4) - h) * 6, 0, 1)
    scuff = smooth(0.55, 0.85, st.noise(30, 4, aspect=0.5)) * 0.5
    base = col(srgb("#6d7178"), v.shape) * (1 + (st.noise(3, 2) - 0.5)[..., None] * 0.1)
    base = mix(base, col(GRIME, v.shape), grime_from(cav, st, 1.2) * 0.6)
    base = mix(base, col(METAL * 1.05, v.shape), scuff * 0.4)
    st.set(base=base, rough=0.55 - scuff * 0.15 + cav * 0.1, metal=0.5 + scuff * 0.3, height=h)
    # B: walkway, 2 m: a polished path down the middle where boots go, orange edge lines, grime at the margins
    st = s.strip("walk", 512, 1024)
    v, u = st.v, st.u
    path = np.exp(-((v - st.H / 2) / 0.45) ** 2) * (0.75 + 0.25 * st.noise(12, 3, aspect=0.3))
    line = (np.abs(v - 0.12) < 0.05) | (np.abs(v - (st.H - 0.12)) < 0.05)
    seam = dist_to_grid(u, 2.0)
    h = -(1 - smooth(0.004, 0.01, seam)) * 0.5 - (1 - smooth(0.0, 0.03, np.minimum(v, st.H - v))) * 0.3
    base = col(srgb("#5d6168"), v.shape)
    base = mix(base, col(ORANGE * 0.8, v.shape), line.astype(np.float32) * (1 - path * 0.3) * (0.7 + 0.3 * st.noise(50, 3)))
    base = mix(base, col(METAL * 1.1, v.shape), smooth(0.4, 0.8, path) * 0.55)
    margin = 1 - smooth(0.0, 0.35, np.minimum(v, st.H - v))
    base = mix(base, col(GRIME, v.shape), margin * 0.35 * st.noise(20, 3))
    st.set(base=base, rough=0.55 - path * 0.25 + margin * 0.1, metal=0.4 + smooth(0.4, 0.8, path) * 0.5, height=h)
    # C: landing pad surface, 2 m: heat tiles, scorch and soot rising toward the pad centre (v = 0 is the pad centre side)
    st = s.strip("pad", 1024, 1536)
    v, u = st.v, st.u
    seam = np.minimum(dist_to_grid(u, 0.5), dist_to_grid(v, 0.5))
    h = -(1 - smooth(0.004, 0.01, seam)) * 0.5 + (st.noise(40, 3) - 0.5) * 0.05
    scorch = np.clip((1 - v / st.H) * 0.8 * (0.6 + 0.6 * st.noise(8, 4)), 0, 1)
    base = col(srgb("#8c8f93"), v.shape) * (1 + (st.noise(16, 2) - 0.5)[..., None] * 0.12)
    base = mix(base, col(srgb("#2a2622"), v.shape), scorch * 0.75)
    cav = np.clip((blur(h, 3) - h) * 6, 0, 1)
    base = mix(base, col(GRIME * 0.7, v.shape), cav * 0.5)
    st.set(base=base, rough=0.62 + scorch * 0.15, metal=0.05, height=h)
    # D: pad ring, 1 m: orange and white segments, tie-down rings worn bright
    st = s.strip("ring", 1536, 1792)
    v, u = st.v, st.u
    seg = np.mod(u, 2.0) < 1.4
    body = np.where(seg[..., None], ORANGE * 0.85, WHITE * 0.85).astype(np.float32)
    edge = np.minimum(v, st.H - v)
    tie = np.sqrt(dist_to_grid(u - 1.7, 2.0) ** 2 + (v - st.H / 2) ** 2)
    ring = np.abs(tie - 0.09) < 0.025
    h = -(1 - smooth(0.0, 0.02, edge)) * 0.3 + ring.astype(np.float32) * 0.4 - (tie < 0.065).astype(np.float32) * 0.2
    wear = smooth(0.55, 0.85, st.noise(60, 4, aspect=0.4)) * 0.6
    base = mix(body, col(srgb("#2a2622"), v.shape), wear * 0.5)
    base = mix(base, col(METAL * 1.1, v.shape), ring.astype(np.float32))
    st.set(base=base, rough=0.5 + wear * 0.15 - ring * 0.25, metal=ring * 1.0, height=h)
    # E: stair tread, 0.5 m (v = 0 is the nosing): the nosing is worn bright, the back collects grit
    st = s.strip("tread", 1792, 1920)
    v, u = st.v, st.u
    nose = 1 - smooth(0.0, 0.06, v)
    grooves = (np.mod(v, 0.04) < 0.012) & (v > 0.07)
    h = -grooves.astype(np.float32) * 0.3 + nose * 0.2
    worn = nose * (0.7 + 0.3 * st.noise(20, 3)) * np.exp(-((np.mod(u, 2.0) - 1.0) / 0.6) ** 2)
    base = mix(col(srgb("#5d6168"), v.shape), col(METAL * 1.1, v.shape), np.clip(worn + nose * 0.3, 0, 1))
    base = mix(base, col(ORANGE * 0.8, v.shape), (np.abs(v - 0.09) < 0.02) * (1 - worn))
    back = smooth(st.H - 0.12, st.H, v)
    base = mix(base, col(GRIME, v.shape), back * 0.5)
    st.set(base=base, rough=0.55 - worn * 0.25 + back * 0.1, metal=np.clip(worn + nose * 0.3, 0, 1), height=h)
    # F: drain grate and door track, 0.5 m: slotted grate either side of a steel track worn bright in its groove
    st = s.strip("track", 1920, 2048)
    v, u = st.v, st.u
    groove = np.abs(v - st.H / 2) < 0.05
    slots = (np.abs(v - st.H / 2) > 0.09) & (np.abs(v - st.H / 2) < 0.2) & (np.mod(u, 0.05) < 0.03)
    h = -groove.astype(np.float32) * 0.5 - slots.astype(np.float32) * 0.8
    base = col(DARK * 1.2, v.shape)
    base = mix(base, col(METAL * 1.15, v.shape), (groove & (np.abs(v - st.H / 2) < 0.035)).astype(np.float32))
    base = mix(base, col(GRIME * 0.5, v.shape), slots.astype(np.float32) * 0.8)
    st.set(base=base, rough=np.where(groove, 0.25, 0.5), metal=np.where(groove, 1.0, 0.7), height=h)
    s.finish()
    return s


# glyph-free numerals for pad numbers: 3 x 5 stencil cells
DIGITS = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
}


def compact_decal():
    """Decal atlas, alpha in `alpha`: row 0..3 pad numerals 01..24 (6 per row, 256 px cells), the Compact mark, scorch,
    walkway chevrons, a hazard band."""
    s = Sheet("WS_Decal", 41)
    s.alpha = np.zeros((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    paintn = s.rng.r
    stencil = np.zeros((N, N), np.float32)
    # numerals: cells 256 x 256 (1 m), 8 per row, rows from the top
    for k in range(24):
        txt = f"{k + 1:02d}"
        cx, cy = (k % 8) * 256, N - 256 - (k // 8) * 256
        for d, ch in enumerate(txt):
            g = DIGITS[ch]
            x0 = cx + 40 + d * 96
            for r in range(5):
                for c in range(3):
                    if g[r][c] == "1":
                        x1, y1 = x0 + c * 26, cy + 220 - (r + 1) * 36
                        stencil[y1 + 3 : y1 + 36 - 3, x1 + 3 : x1 + 26 - 3] = 1
    # the Compact mark: three lapped arcs over a hexagon, one 512 cell at (0, 512)
    cx, cy = 256, 512 + 256 - 256
    dx, dy = xx - cx, yy - (cy + 256)
    r = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx)
    hexd = np.maximum(np.abs(dx) * 0.866 + np.abs(dy) * 0.5, np.abs(dy))
    mark = ((hexd < 230) & (hexd > 200)).astype(np.float32)
    for i in range(3):
        a0 = np.pi / 2 + i * 2 * np.pi / 3
        ox, oy = cx + np.cos(a0) * 70, cy + 256 + np.sin(a0) * 70
        rr = np.sqrt((xx - ox) ** 2 + (yy - oy) ** 2)
        mark = np.maximum(mark, ((rr > 95) & (rr < 125) & (hexd < 195)).astype(np.float32))
    cell = (xx < 512) & (yy >= 512) & (yy < 1024)
    stencil = np.where(cell, mark, stencil)
    # walkway chevrons in the cell (512..1024, 512..1024)
    cell = (xx >= 512) & (xx < 1024) & (yy >= 512) & (yy < 1024)
    lx, ly = xx - 768, yy - 768
    chev = (np.mod(ly + np.abs(lx) * 0.9, 170) < 70) & (np.abs(lx) < 200) & (np.abs(ly) < 230)
    stencil = np.where(cell, chev.astype(np.float32), stencil)
    # hazard band (1024..2048, 512..768): diagonal stripes
    cell = (xx >= 1024) & (yy >= 512) & (yy < 768)
    haz = np.mod(xx + yy, 128) < 64
    yellow = cell & haz
    stencil = np.where(cell, 1.0, stencil)
    # scorch: radial soot in the bottom-left 512 cell (0..512, 0..512), feathered alpha
    dx, dy = xx - 256, yy - 256
    r = np.sqrt(dx * dx + dy * dy) / 250
    n = noise(N, N, 24, s.rng, 5)
    streak = noise(N, N, 6, s.rng, 2)
    soot = np.clip((1 - r) * 1.4 * (0.55 + 0.7 * n) * (0.7 + 0.5 * streak), 0, 1) * ((xx < 512) & (yy < 512))
    # oil stains (512..1024, 0..512)
    dx, dy = xx - 768, yy - 256
    r2 = np.sqrt(dx * dx + dy * dy) / 220
    oil = np.clip((1 - r2 * (0.7 + 0.6 * n)) * 1.6, 0, 1) * ((xx >= 512) & (xx < 1024) & (yy < 512))
    # tyre / skid scuffs (1024..2048, 0..512): long streaks along x
    sk = noise(N, N, 3, s.rng, 3, aspect=8.0)
    skid = smooth(0.62, 0.8, sk) * ((xx >= 1024) & (yy < 512)) * 0.8
    edge_soft = noise(N, N, 120, s.rng, 2)
    paint_a = stencil * (0.82 + 0.18 * smooth(0.25, 0.6, edge_soft))
    a = np.clip(paint_a + soot + oil * 0.85 + skid, 0, 1)
    base = np.zeros((N, N, 3), np.float32) + WHITE * 0.95
    numeral = (yy >= N - 768)
    base[numeral] = WHITE * 0.92
    base[(xx < 512) & (yy >= 512) & (yy < 1024)] = BLUE * 1.1
    base[(xx >= 512) & (xx < 1024) & (yy >= 512) & (yy < 1024)] = ORANGE * 0.9
    base[cell] = srgb("#26282c")
    base[yellow] = ORANGE * 0.95
    base = mix(base, col(srgb("#1b1916"), (N, N)), smooth(0.0, 0.2, soot))
    base = mix(base, col(srgb("#15130f"), (N, N)), smooth(0.0, 0.3, oil))
    base = mix(base, col(srgb("#202020"), (N, N)), smooth(0.0, 0.3, skid))
    s.base = base
    s.alpha = a
    s.rough = np.clip(0.55 + soot * 0.3 - oil * 0.35 + (1 - edge_soft) * 0.05 * paint_a, 0, 1)
    s.metal = np.zeros((N, N), np.float32)
    s.height = paint_a * 0.08 - soot * 0.02
    _decal_round2(s, xx, yy)
    s.strips = {"numerals": (1 - 768 / N, 1.0), "mark": (512 / N, 1024 / N), "chevron": (512 / N, 1024 / N), "hazard": (512 / N, 768 / N), "scorch": (0, 512 / N)}
    s.finish(normal_strength=3.0, cavity=0.2)
    return s


def compact_prop():
    """The props' own 1k sheet (DESIGN 19.2: props take 1k textures) at the kit's 256 px/m, so it tiles every 4 m and its
    strips are prop-sized: shell rows that chip hard at their edges, the hose's rubber, a thin indicator lens."""
    s = Sheet("WS_Prop", 83, n=1024)
    st = s.strip("plate", 0, 256)
    plate_row(st, WHITE, lap_top=0.03, seam_every=1.0, chip_bottom=0.045, rivet_step=0.1, tone=0.1, grime=1.3)
    st = s.strip("accent", 256, 512)
    plate_row(st, BLUE, lap_top=0.03, seam_every=1.0, seam_off=0.4, chip_bottom=0.045, rivet_step=0.1, tone=0.1, grime=1.3)
    st = s.strip("signal", 512, 576)
    v, u = st.v, st.u
    chev = np.mod(u + np.abs(v - st.H / 2) * 1.2, 0.3) < 0.15
    edge = np.minimum(v, st.H - v)
    chips = chip_mask(st, edge, 0.025, cells=90)
    base = mix(np.where(chev[..., None], ORANGE, ORANGE * 0.62).astype(np.float32), col(METAL * 0.85, v.shape), chips)
    st.set(base=base, rough=0.45 + 0.08 * st.noise(30, 3), metal=chips * 0.9, height=-(1 - smooth(0.0, 0.01, edge)) * 0.3)
    st = s.strip("lip", 576, 640)
    v, u = st.v, st.u
    edge = np.minimum(v, st.H - v)
    worn = smooth(0.01, 0.05, edge) * (0.7 + 0.3 * st.noise(40, 3))
    base = mix(col(BLUE * 0.9, v.shape), col(METAL * 1.05, v.shape), smooth(0.3, 0.6, worn))
    base = mix(base, col(GRIME * 0.8, v.shape), (1 - smooth(0.0, 0.03, edge)) * 0.6)
    st.set(base=base, rough=0.5 - worn * 0.2, metal=smooth(0.3, 0.6, worn), height=-(1 - smooth(0.0, 0.01, edge)) * 0.3)
    st = s.strip("rib", 640, 704)
    v = st.v
    prof = np.sin(np.clip(v / st.H, 0, 1) * np.pi)
    edge = np.minimum(v, st.H - v)
    chips = chip_mask(st, edge, 0.03, cells=120)
    crown = (1 - smooth(0.0, 0.03, np.abs(v - st.H * 0.5))) * smooth(0.5, 0.8, st.noise(60, 3, aspect=0.2)) * 0.6
    base = mix(col(WHITE * 0.97, v.shape), col(METAL * 0.9, v.shape), np.maximum(chips, crown))
    st.set(base=base, rough=0.4 - crown * 0.1, metal=np.maximum(chips, crown) * 0.95, height=prof * 0.6)
    st = s.strip("trim", 704, 768)
    v, u = st.v, st.u
    brush = st.noise(8, 2) * 0.3 + noise(st.h, s.n, 300, s.rng, 2, 0.5, aspect=0.004) * 0.7
    edge = np.minimum(v, st.H - v)
    h = -(1 - smooth(0.0, 0.01, edge)) * 0.3
    cav = np.clip((blur(h, 3) - h) * 6, 0, 1)
    st.set(base=mix(col(METAL * (0.92 + 0.1 * brush[..., None]), v.shape), col(GRIME, v.shape), cav * 0.5), rough=0.3 + brush * 0.12, metal=1.0, height=h)
    st = s.strip("machine", 768, 896)
    v, u = st.v, st.u
    pu = np.mod(u, 0.5)
    inner = (np.abs(v - st.H / 2) < 0.15) & (np.abs(pu - 0.25) < 0.19)
    louvre = np.where(inner, (np.mod(v, 0.03) / 0.03) * 0.5 - 0.4, 0.0)
    frame = 1 - smooth(0.003, 0.008, dist_to_grid(u, 0.5))
    h = louvre - frame * 0.4 + rivets(st, 0.5, 0.05, 0.012, 0.04) * 0.4 + rivets(st, 0.5, st.H - 0.05, 0.012, 0.04) * 0.4
    cav = np.clip((blur(h, 3) - h) * 6, 0, 1)
    g = grime_from(cav, st, 1.4)
    st.set(base=mix(col(DARK * 1.1, v.shape), col(GRIME * 0.6, v.shape), g * 0.6), rough=0.42 + g * 0.2, metal=0.8, height=h)
    st = s.strip("hose", 896, 960)
    v, u = st.v, st.u
    rib = np.abs(np.mod(u, 0.02) / 0.02 - 0.5) * 2
    scuff = smooth(0.6, 0.85, st.noise(80, 3, aspect=0.3)) * 0.5
    base = mix(col(srgb("#1d1e20"), v.shape), col(srgb("#4a4c50"), v.shape), scuff)
    st.set(base=base, rough=0.75 - scuff * 0.2, metal=0.0, height=rib * 0.25)
    st = s.strip("rail", 960, 992)
    v, u = st.v, st.u
    top = np.exp(-((v - st.H * 0.5) / 0.025) ** 2) * (0.8 + 0.2 * st.noise(60, 3, aspect=0.3))
    base = mix(col(ORANGE * 0.85, v.shape), col(METAL * 1.05, v.shape), smooth(0.3, 0.6, top))
    st.set(base=base, rough=0.45 - top * 0.25, metal=smooth(0.3, 0.6, top), height=top * 0.1)
    st = s.strip("light", 992, 1024)
    v, u = st.v, st.u
    lens = (np.abs(v - st.H / 2) < 0.006) & (dist_to_grid(u, 1.0) > 0.03)
    h = np.where(lens, 0.2, 0.0) - (1 - smooth(0.0, 0.01, np.minimum(v, st.H - v))) * 0.3
    base = np.where(lens[..., None], np.float32(0.85), DARK * 1.2).astype(np.float32)
    emit = np.where(lens[..., None], np.float32(1.0), np.float32(0.0)) * np.ones((1, 1, 3), np.float32)
    st.set(base=base, rough=np.where(lens, 0.15, 0.45), metal=np.where(lens, 0.0, 0.7), height=h, emit=emit)
    s.finish()
    return s


DECAL_DIGIT_W = 128  # blue stencil digits 0-9 in 128 x 256 cells along y 1024..1280, so any panel number is two quads


def _decal_round2(s, xx, yy):
    """Cells the round-1 atlas left empty: blue stencil digits 0-9 (x 0..1280, y 1024..1280), grime runs (1280..1792),
    a hatch-rim wear ring (1792..2048), three more scorch shapes and a boot-scuff patch (x 1024..2048, y 768..1024)."""
    rng = s.rng
    a = s.alpha
    base = s.base

    def put(mask, colour, alpha, rough, height=0.0):
        m = mask > 0
        base[m] = colour[m] if np.ndim(colour) == 3 else colour
        a[m] = alpha[m]
        s.rough[m] = rough[m] if np.ndim(rough) == 2 else rough
        s.height[m] = height[m] if np.ndim(height) == 2 else height

    cell = (yy >= 1024) & (yy < 1280) & (xx < 1280)
    dig = np.zeros((N, N), np.float32)
    for d in range(10):
        g = DIGITS[str(d)]
        x0 = d * DECAL_DIGIT_W + 22
        for r in range(5):
            for c in range(3):
                if g[r][c] == "1":
                    x1, y1 = x0 + c * 28, 1024 + 236 - (r + 1) * 42
                    dig[y1 + 4 : y1 + 42 - 4, x1 + 3 : x1 + 28 - 3] = 1
    rough_edge = noise(N, N, 160, rng, 2)
    dig_a = dig * (0.78 + 0.22 * smooth(0.3, 0.6, rough_edge))
    put(cell.astype(np.float32), BLUE * 1.15, dig_a, np.full((N, N), 0.5, np.float32), dig_a * 0.08)

    # grime runs: dense under a ledge (the cell's top), streaking down in uneven runs
    cell = (yy >= 1024) & (yy < 1280) & (xx >= 1280) & (xx < 1792)
    t = np.clip((1280 - yy) / 256.0, 0, 1)
    runs = noise(N, N, 48, rng, 3, aspect=0.05)
    blot = noise(N, N, 10, rng, 4)
    g = np.clip((1 - t) ** 1.5 * 0.9 + smooth(0.55, 0.85, runs) * (1 - t) ** 0.6 * 0.8, 0, 1) * (0.6 + 0.6 * blot)
    put(cell.astype(np.float32), col(GRIME * 0.75, (N, N)), np.clip(g, 0, 0.85), 0.62 + g * 0.2, -g * 0.02)

    # hatch-rim wear: an annulus of packed grime round a seal, bright where hands and boots rub at the bottom
    cell = (yy >= 1024) & (yy < 1280) & (xx >= 1792)
    dx, dy = (xx - 1920) / 128.0, (yy - 1152) / 128.0
    r = np.sqrt(dx * dx + dy * dy)
    ring = smooth(0.58, 0.68, r) * (1 - smooth(0.88, 0.99, r))
    rub = ring * smooth(0.0, -0.6, dy) * (0.5 + 0.7 * noise(N, N, 70, rng, 3))
    gr = ring * (0.45 + 0.55 * noise(N, N, 30, rng, 3)) * (1 - rub)
    colr = mix(col(GRIME * 0.7, (N, N)), col(METAL * 1.15, (N, N)), np.clip(rub * 1.5, 0, 1))
    put(cell.astype(np.float32), colr, np.clip(gr * 0.8 + rub, 0, 0.9), 0.55 + gr * 0.2 - rub * 0.3, rub * 0.02)

    # three more scorch shapes so no two pads read alike: a blown streak, a burn ring, a soft haze with a hard core
    n5 = noise(N, N, 40, rng, 5)
    for k, kind in enumerate(("streak", "ring", "haze")):
        cx, cy = 1024 + 128 + k * 256, 896
        cell = (yy >= 768) & (yy < 1024) & (xx >= 1024 + k * 256) & (xx < 1024 + (k + 1) * 256)
        dx, dy = (xx - cx) / 120.0, (yy - cy) / 120.0
        r = np.sqrt(dx * dx + dy * dy)
        ang = np.arctan2(dy, dx)
        if kind == "streak":
            rr = np.sqrt((dx * 0.6) ** 2 + (dy * 1.25) ** 2)
            soot = np.clip((1 - rr) * 1.5, 0, 1) * (0.5 + 0.8 * n5) * (0.7 + 0.5 * np.abs(np.sin(ang * 7 + n5 * 4)))
        elif kind == "ring":
            soot = np.clip(np.exp(-((r - 0.6) / 0.18) ** 2) * 1.2 + (1 - r) * 0.25, 0, 1) * (0.55 + 0.7 * n5)
        else:
            soot = np.clip((1 - r) * 0.7 * (0.5 + 0.6 * n5) + smooth(0.3, 0.1, r) * 0.7, 0, 1)
        soot = soot * smooth(1.0, 0.85, r)
        put(cell.astype(np.float32), mix(col(srgb("#1b1916"), (N, N)), col(srgb("#3a2e24"), (N, N)), n5 * 0.6), np.clip(soot, 0, 1), 0.8 + soot * 0.1, -soot * 0.02)

    # boot scuffs: short dark arcs and rubbed-bright marks where crews turn and stand
    cell = (yy >= 768) & (yy < 1024) & (xx >= 1792)
    sc = smooth(0.66, 0.8, noise(N, N, 90, rng, 3, aspect=0.35)) * (0.6 + 0.5 * noise(N, N, 12, rng, 2))
    br = smooth(0.7, 0.85, noise(N, N, 60, rng, 3, aspect=2.5)) * 0.6
    dx, dy = (xx - 1920) / 128.0, (yy - 896) / 128.0
    fade = smooth(1.0, 0.6, np.sqrt(dx * dx + dy * dy))
    colr = mix(col(srgb("#24221f"), (N, N)), col(METAL * 1.1, (N, N)), np.clip(br / (sc + br + 1e-3), 0, 1))
    put(cell.astype(np.float32), colr, np.clip((sc + br) * fade, 0, 0.8), 0.5 - br * 0.2, -sc * 0.01)


# decal cells (u0, v0, u1, v1) in WS_Decal for the authoring scripts
DECAL_CELLS = {
    "scorch": (0.0, 0.0, 0.25, 0.25),
    "oil": (0.25, 0.0, 0.5, 0.25),
    "skid": (0.5, 0.0, 1.0, 0.25),
    "mark": (0.0, 0.25, 0.25, 0.5),
    "chevron": (0.25, 0.25, 0.5, 0.5),
    "hazard": (0.5, 0.25, 1.0, 0.375),
    "scorch_streak": (0.5, 0.375, 0.625, 0.5),
    "scorch_ring": (0.625, 0.375, 0.75, 0.5),
    "scorch_haze": (0.75, 0.375, 0.875, 0.5),
    "scuff": (0.875, 0.375, 1.0, 0.5),
    "grime_runs": (0.625, 0.5, 0.875, 0.625),
    "hatch_wear": (0.875, 0.5, 1.0, 0.625),
}
for _d in range(10):
    DECAL_CELLS[f"digit{_d}"] = (_d * 0.0625, 0.5, (_d + 1) * 0.0625, 0.625)


def save_png(path, arr, alpha=None):
    """Writes an image with Blender (numpy rows bottom-up), returns the bpy image."""
    import bpy

    h, w = arr.shape[:2]
    img = bpy.data.images.new("tmp_write", w, h, alpha=alpha is not None)
    px = np.ones((h, w, 4), np.float32)
    if arr.ndim == 2:
        px[..., :3] = arr[..., None]
    else:
        px[..., :3] = arr
    if alpha is not None:
        px[..., 3] = alpha
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def compact_floor():
    """Tileable hangar and deck floor, 8 x 8 m: staggered 2 x 1 m plates, tread bosses, tie-down sockets every 4 m.
    Scuffs and stains come from decals and walkway strips, not from this tile."""
    s = Sheet("WS_Floor", 53)
    st = Strip(s, 0, N)
    v, u = st.v, st.u
    row = np.floor(v / 1.0)
    uu = u + (row % 2) * 1.0
    seam = np.minimum(dist_to_grid(uu, 2.0), dist_to_grid(v, 1.0))
    h = -(1 - smooth(0.004, 0.011, seam)) * 0.5
    du = np.mod(uu, 0.125) - 0.0625
    dv = np.mod(v + 0.0625 * (np.floor(uu / 0.125) % 2), 0.125) - 0.0625
    h += np.clip(1 - np.sqrt(du * du * 5 + dv * dv * 0.5) / 0.03, 0, 1) * 0.12
    tie = np.sqrt(dist_to_grid(u - 2.0, 4.0) ** 2 + dist_to_grid(v - 2.0, 4.0) ** 2)
    h -= (np.abs(tie - 0.07) < 0.018).astype(np.float32) * 0.35 + (tie < 0.05).astype(np.float32) * 0.25
    plate_id = (np.floor(uu / 2.0) * 7 + row * 13) % 17
    tone = (plate_id / 17.0 - 0.5) * 0.06
    base = col(srgb("#70747a"), v.shape) * (1 + tone[..., None])
    cav = np.clip((blur(h, 4) - h) * 6, 0, 1)
    base = mix(base, col(GRIME, v.shape), cav * 0.55)
    tieb = (np.abs(tie - 0.07) < 0.018)
    base = mix(base, col(METAL * 1.1, v.shape), tieb.astype(np.float32))
    st.set(base=base, rough=0.58 + cav * 0.12 + tone * 0.5 - tieb * 0.25, metal=0.45 + tieb * 0.5, height=h)
    s.finish(normal_strength=5.0)
    return s


# ---------------------------------------------------------------------------------------------- the Free Reaches sheets
OXIDE = srgb("#8E2F23")
GUNMETAL = srgb("#3A3D42")
PATCH = srgb("#D8B23A")
RUST = srgb("#6b3a22")


def _scrap_row(st, colours, plate_w=(1.2, 3.2), seed=0, weld=True):
    """Mismatched painted plates welded edge to edge: weld beads and bolt heads at the seams, rust running down from both,
    paint chipped back to bare metal along the seams only. Paint is dielectric; only the chips read as metal."""
    v, u = st.v, st.u
    rng = np.random.default_rng(seed)
    edges = [0.0]
    while edges[-1] < 8.0:
        edges.append(edges[-1] + rng.uniform(*plate_w))
    edges[-1] = 8.0
    idx = np.searchsorted(np.array(edges), u[0], side="right") - 1
    cols = np.array([colours[rng.integers(len(colours))] for _ in edges], np.float32)
    lift = rng.uniform(-0.08, 0.08, len(edges)).astype(np.float32)
    base = cols[idx][None, :, :] * np.ones((st.h, 1, 1), np.float32)
    h = np.zeros_like(v) + lift[idx][None, :]
    seam = np.min(np.abs(u[..., None] - np.array(edges)[None, None, :]), axis=-1)
    seam = np.minimum(seam, np.minimum(v, st.H - v))
    bead = (1 - smooth(0.0, 0.03, seam)) * (0.5 + 0.5 * st.noise(400, 2, aspect=0.05)) if weld else 0
    h = h + bead * 0.35 - (1 - smooth(0.0, 0.006, seam)) * 0.4
    boltu = np.array(edges)
    bd = np.min(np.abs(u[..., None] - (boltu[None, None, :] + 0.12)), axis=-1)
    bolts = np.clip(1 - (np.sqrt(bd ** 2 + (dist_to_grid(v - 0.15, 0.5)) ** 2) / 0.025) ** 2, 0, 1)
    h += bolts * 0.3
    # rust runs down from welds and bolts (v is up the face), longest under bolts, pooling at each plate's lower edge
    src = np.clip(blur(bead * 0.6 + bolts * 2.5, 4) * 2.2, 0, 1)
    streak = src.copy()
    n_run = st.noise(120, 2, aspect=0.08)
    for k in range(1, 90):
        streak[:-k] = np.maximum(streak[:-k], src[k:] * (1 - k / 90) ** 1.5 * (0.5 + 0.7 * n_run[:-k]))
    pool = (1 - smooth(0.0, 0.12, v)) * smooth(0.5, 0.8, st.noise(20, 3))
    n = st.noise(30, 4, aspect=0.4)
    rust = np.clip(streak * (0.55 + n) + pool * 0.6, 0, 1)
    chips = chip_mask(st, seam, 0.04, cells=70)
    base = mix(base, col(METAL * 0.75, v.shape), chips)
    base = mix(base, col(RUST, v.shape), rust * 0.8)
    cav = np.clip((blur(h, 5) - h) * 8, 0, 1)
    base = mix(base, col(GRIME * 0.7, v.shape), cav * 0.6)
    base = base * (1 + (st.noise(6, 3) - 0.5)[..., None] * 0.12)
    st.set(base=base, rough=0.62 + rust * 0.25 - chips * 0.25 + n * 0.08, metal=np.clip(0.06 + chips * 0.85 - rust * 0.05, 0, 1), height=h)


def reaches_scrap():
    """Salvage trim sheet of the Free Reaches: painted plate rows (gunmetal, oxide, patch), a salvaged Compact hull row,
    girder flange, chipped hazard paint, a scuffed walkway, a landing pad's burn ring and a lamp lens."""
    s = Sheet("SY_Scrap", 61)
    # one colour per strip so the geometry, not the texture, decides the zones; the deliberate mismatch is the patch strip
    _scrap_row(s.strip("plate", 0, 384), [GUNMETAL, GUNMETAL * 1.07, GUNMETAL * 0.94], seed=1)
    _scrap_row(s.strip("oxide", 384, 768), [OXIDE, OXIDE * 0.95, OXIDE * 1.04], seed=2)
    _scrap_row(s.strip("patch", 768, 1152), [PATCH * 0.85, GUNMETAL * 1.05, PATCH * 0.72, OXIDE * 0.95], plate_w=(1.2, 2.6), seed=3)
    # girder flange, 0.75 m: gunmetal with a weld line down the middle, lightening holes, rust at both edges
    st = s.strip("girder", 1152, 1344)
    v, u = st.v, st.u
    mid = np.abs(v - st.H / 2)
    h = -(1 - smooth(0.0, 0.03, np.minimum(v, st.H - v))) * 0.3 + (1 - smooth(0.0, 0.025, mid)) * 0.3
    holes = np.sqrt(dist_to_grid(u, 0.6) ** 2 + (mid - 0.22) ** 2) < 0.06
    h -= holes.astype(np.float32) * 0.8
    edge = np.minimum(v, st.H - v)
    rust = np.clip((1 - smooth(0.0, 0.2, edge)) * (0.4 + st.noise(40, 4)), 0, 1)
    base = mix(col(GUNMETAL * 1.1, v.shape), col(RUST, v.shape), rust * 0.7)
    base = mix(base, col(GRIME * 0.4, v.shape), holes.astype(np.float32))
    st.set(base=base, rough=0.5 + rust * 0.3, metal=0.7 - rust * 0.5, height=h)
    # hazard, 0.5 m: patch-yellow and black; the paint is chipped back along both edges, where boots and cargo hit
    st = s.strip("hazard", 1344, 1472)
    v, u = st.v, st.u
    stripe = np.mod(u + v, 0.5) < 0.25
    body = np.where(stripe[..., None], PATCH * 0.9, srgb("#1c1c1c")).astype(np.float32)
    chips = chip_mask(st, np.minimum(v, st.H - v), 0.05, cells=90)
    scuff = smooth(0.62, 0.8, st.noise(60, 4, aspect=0.25)) * 0.6
    rust = chips * smooth(0.4, 0.7, st.noise(50, 3))
    base = mix(body, col(METAL * 0.7, v.shape), np.clip(chips + scuff * 0.5, 0, 1))
    base = mix(base, col(RUST, v.shape), rust * 0.7)
    base = mix(base, col(GRIME, v.shape), smooth(0.5, 0.9, st.noise(16, 4)) * 0.3)
    st.set(base=base, rough=0.6 - chips * 0.2 + rust * 0.25, metal=np.clip(chips * 0.8 - rust * 0.4, 0, 1), height=-chips * 0.06)
    # lamp housing, 0.25 m: a red-orange lens behind cage bars (emissive only in the lens)
    st = s.strip("lamp", 1472, 1536)
    v, u = st.v, st.u
    lens = (np.abs(v - st.H / 2) < 0.07) & (dist_to_grid(u, 1.0) > 0.12)
    bars = (dist_to_grid(u, 0.12) < 0.012) & lens
    h = np.where(lens, 0.2, 0.0) + bars * 0.4
    base = np.where(lens[..., None], srgb("#FF6A3D") * 0.7, GUNMETAL).astype(np.float32)
    base = np.where(bars[..., None], GUNMETAL * 0.6, base).astype(np.float32)
    emit = np.where((lens & ~bars)[..., None], srgb("#FF6A3D"), np.float32(0)).astype(np.float32) * np.ones((1, 1, 3), np.float32)
    st.set(base=base, rough=np.where(lens, 0.2, 0.5), metal=np.where(lens, 0.0, 0.7), height=h, emit=emit)
    # salvaged Compact hull, 1 m row: lapped station-white plate gone grey, a torn scrap of the blue belly band, crude
    # oxide overpaint over part of it (Reaches livery is paint), chips showing the white under the red, scorch
    st = s.strip("hull", 1536, 1792)
    v, u = st.v, st.u
    H = st.H
    h = -smooth(H - 0.06, H - 0.05, v) * 0.35 - (1 - smooth(0.0, 0.03, v)) * 0.25
    j = dist_to_grid(u, 2.4)
    h -= (1 - smooth(0.004, 0.012, j)) * 0.5
    h += rivets(st, 0.2, H - 0.13, 0.014, u_off=0.1) * 0.35
    white = col(srgb("#F4F4F0") * 0.62, v.shape) * (1 + (st.noise(8, 4) - 0.5)[..., None] * 0.18)
    band = (np.abs(v - 0.42) < 0.12) & (st.noise(5, 3) > 0.55)
    base = mix(white, col(srgb("#22406A") * 0.8, v.shape), band.astype(np.float32) * 0.9)
    over = smooth(0.48, 0.52, st.noise(3, 4, aspect=0.5) + (st.noise(40, 3) - 0.5) * 0.12)
    ochips = chip_mask(st, np.minimum(v, j * 1.5 + 0.02), 0.06, cells=60) * over
    base = mix(base, col(OXIDE * 0.95, v.shape), over * (1 - ochips))
    chips = chip_mask(st, np.minimum(v, j * 1.6 + 0.02), 0.03, cells=60) * (1 - over)
    base = mix(base, col(METAL * 0.8, v.shape), chips)
    soot = smooth(0.55, 0.85, st.noise(4, 5)) * 0.55
    cav = np.clip((blur(h, 5) - h) * 8, 0, 1)
    base = mix(base, col(GRIME * 0.6, v.shape), np.clip(soot + cav * 0.5, 0, 0.8))
    st.set(base=base, rough=0.5 + soot * 0.3 + over * 0.12 - chips * 0.15, metal=np.clip(chips * 0.9, 0, 1), height=h)
    # walkway, 0.5 m across: tread plate scuffed bright down the middle where boots go, grime packed at the edges
    st = s.strip("walk", 1792, 1920)
    v, u = st.v, st.u
    tread = (dist_to_grid(u + (np.floor(v / 0.05) % 2) * 0.05, 0.1) < 0.02) & (dist_to_grid(v, 0.05) < 0.012)
    h = tread * 0.25 - (1 - smooth(0.0, 0.02, np.minimum(v, st.H - v))) * 0.3
    centre = 1 - smooth(0.05, 0.22, np.abs(v - st.H / 2))
    scuff = np.clip(centre * (0.55 + 0.6 * st.noise(50, 4, aspect=0.2)), 0, 1)
    edge = 1 - smooth(0.0, 0.1, np.minimum(v, st.H - v))
    base = mix(col(GUNMETAL * 1.15, v.shape), col(METAL * 0.95, v.shape), scuff * 0.8)
    base = mix(base, col(GRIME * 0.6, v.shape), np.clip(edge * 0.8 + (1 - scuff) * 0.15, 0, 1))
    st.set(base=base, rough=0.7 - scuff * 0.35 + edge * 0.15, metal=0.3 + scuff * 0.55, height=h)
    # pad burn ring, 0.5 m across (stretched over the ring between the pad's centre and its rim): engine scorch heaviest
    # mid-ring, soot streaks blown outward (along v), heat tint at the edge of the burn, deck plates beneath
    st = s.strip("burn", 1920, 2048)
    v, u = st.v, st.u
    t = v / st.H
    plates = np.minimum(dist_to_grid(u, 1.6), dist_to_grid(v, 0.25))
    h = -(1 - smooth(0.0, 0.01, plates)) * 0.4
    streaks = st.noise(160, 3, aspect=0.04)
    burn = np.clip(np.sin(np.pi * t) ** 0.7 * (0.55 + 0.6 * streaks) - 0.05, 0, 1)
    tint = smooth(0.15, 0.35, burn) * (1 - smooth(0.45, 0.75, burn))
    base = col(GUNMETAL * 1.2, v.shape) * (1 + (st.noise(10, 3) - 0.5)[..., None] * 0.15)
    base = mix(base, col(srgb("#4a3a5e") * 0.9, v.shape), tint * 0.35)
    base = mix(base, col(srgb("#0f0d0c"), v.shape), burn * 0.85)
    st.set(base=base, rough=0.6 + burn * 0.3, metal=0.55 - burn * 0.45, height=h)
    s.finish()
    return s


def reaches_rock():
    """Tileable asteroid rock, 8 x 8 m: fractured faces broken by strata and a crack network; the dust lies on its own
    sheet (SY_Regolith), so hollows read darker and rougher at the scale of the whole asteroid."""
    s = Sheet("SY_Rock", 71)
    st = Strip(s, 0, N)
    v, u = st.v, st.u
    big = st.noise(3, 5, 0.55)
    f1 = 1 - np.abs(st.noise(5, 3) * 2 - 1)
    f2 = 1 - np.abs(st.noise(13, 3) * 2 - 1)
    cracks = smooth(0.88, 0.975, f1) + smooth(0.91, 0.985, f2) * 0.6
    # strata: wavy beds that step at each bed line
    wav = v + (st.noise(2, 3) - 0.5) * 1.4
    bed = np.floor(wav / 0.55)
    strata = np.mod(wav, 0.55) / 0.55
    h = big * 0.7 + st.noise(40, 4) * 0.12 + strata * 0.12 - cracks * 0.6
    h = h * 0.6 + np.floor(big * 6) / 6 * 0.4 - cracks * 0.3
    bedtone = (np.mod(bed * 7, 5) / 5.0 - 0.5) * 0.16
    cav = np.clip((blur(h, 10) - h) * 4, 0, 1)
    dust = np.clip(cav * 1.3, 0, 1)
    rock = srgb("#5a5550") * (0.82 + 0.3 * big[..., None] + bedtone[..., None])
    base = mix(rock.astype(np.float32), col(srgb("#3d3936"), v.shape), dust * 0.6)
    base = mix(base, col(srgb("#1e1b1a"), v.shape), cracks.clip(0, 1) * 0.7)
    st.set(base=base, rough=0.74 + dust * 0.14 + big * 0.06, metal=0.0, height=h)
    s.finish(normal_strength=12.0, cavity=0.7)
    return s


def reaches_regolith():
    """Tileable regolith, 8 x 8 m: the dark dust and grit that settles in the asteroid's hollows, pebbles half buried."""
    s = Sheet("SY_Regolith", 77)
    st = Strip(s, 0, N)
    v, u = st.v, st.u
    soft = st.noise(4, 5)
    grit = st.noise(300, 2)
    peb = smooth(0.78, 0.86, st.noise(60, 2)) * smooth(0.5, 0.7, st.noise(20, 3))
    h = soft * 0.5 + grit * 0.06 + peb * 0.4
    base = col(srgb("#36312d"), v.shape) * (0.85 + 0.25 * soft[..., None] + 0.1 * grit[..., None])
    base = mix(base, col(srgb("#5a5550"), v.shape), peb * 0.7)
    st.set(base=base, rough=0.93 - peb * 0.15, metal=0.0, height=h)
    s.finish(normal_strength=6.0, cavity=0.5)
    return s


def reaches_grate():
    """Tileable deck grating, 8 x 8 m: bar grating on staggered 2 x 1 m panels of mismatched salvage; the walking wear
    sits on the deck's walkway strips, not in this tile."""
    s = Sheet("SY_Grate", 83)
    st = Strip(s, 0, N)
    v, u = st.v, st.u
    row = np.floor(v / 1.0)
    uu = u + (row % 2) * 1.0
    panel = np.minimum(dist_to_grid(uu, 2.0), dist_to_grid(v, 1.0))
    bars = dist_to_grid(uu, 0.04) < 0.008
    cross = dist_to_grid(v, 0.2) < 0.006
    h = np.where(bars | cross, 0.0, -1.0) - (1 - smooth(0.0, 0.02, panel)) * 0.2
    pid = (np.floor(uu / 2.0) * 5 + row * 3) % 7
    tint = col(GUNMETAL * 1.2, v.shape) * (1 + (pid[..., None] / 7.0 - 0.5) * 0.12)
    base = np.where((bars | cross)[..., None], tint, srgb("#0d0d0e")).astype(np.float32)
    rust = smooth(0.6, 0.85, st.noise(10, 5)) * (bars | cross)
    base = mix(base, col(RUST, v.shape), rust * 0.6)
    st.set(base=base, rough=np.where(bars | cross, 0.5 + rust * 0.3, 0.9), metal=np.where(bars | cross, 0.7 - rust * 0.5, 0.0), height=h)
    s.finish(normal_strength=4.0, cavity=0.6)
    return s
