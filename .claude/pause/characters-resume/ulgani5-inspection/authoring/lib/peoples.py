"""The three peoples' bodies: proportions and biology on top of the generic anatomy (DESIGN 5.1, art bible 2 and 4).

Thalune: amphibious swimmers of the tidal coasts.  Long V-tapered torso, smooth musculature, thick short neck, webbed
  three-fingered hands with pad tips, forearm fins, a low dorsal ridge, long webbed flipper feet.
Ixari: crystal-symbionts of the spire forests.  Tall and gaunt, long neck, long arms and very long jointed fingers,
  angular planes, raised stone sockets along the spine and forearms where the living crystal grows.
Ulgani: fungal-symbionts of the spore moors.  Short, broad and deep-chested, thick neck and limbs, heavy hands with
  short fingers, breathing slits on the throat and ribs, porous swellings on the shoulders.
"""
import numpy as np

from . import anatomy as A
from . import sdf as D

def landmarks(B, P, k=1.0):
    """The skeleton read through the skin, drawn tight (small blend radii) so it survives the cage fit: clavicles with
    the sternal notch between them, a sternum keel, the lower ribs fanning round the flank, elbow points and the
    epicondyles, wrist tendons, kneecaps with their tendon, the ankle bones, nails on every finger and toe.  Each
    form is set on the sculpt as it stands (so a deep chest or a heavy limb does not bury it) and sunk to show
    about half its depth."""
    c = B.c
    W = A.world_axes()
    subs = {}

    def on(p, tag, r, show=0.5):
        S = subs.setdefault(tag, B.S.subset([tag]))
        q = S.project(np.asarray(p, float)[None], iters=10)[0]
        n = S.grad(q[None])[0]
        n = n / max(np.linalg.norm(n), 1e-9)
        return q - n * r * (1.0 - show) * c.s

    def ridge(p0, p1, r0, r1, kk, tag, show=0.5, op='u'):
        B.cone(on(p0, tag, r0, show), on(p1, tag, r1, show), r0, r1, kk, tag, op=op)

    def bump(p, radii, axes, kk, tag, show=0.5, op='u'):
        B.ell(on(p, tag, min(radii), show), radii, axes, kk, tag, op=op)

    # clavicles from the sternal notch out to the shoulder, the notch between them, the sternum down the midline
    ridge(c.p('spine_03', 0.88, a=0.02, f=0.1), c.p('clavicle_L', P.get('clav_end', 0.92), f=0.02, up=0.01), 0.011 * k, 0.012 * k,
          0.007, 'torso', 0.62)
    bump(c.p('spine_03', 0.92, f=0.1), (0.016, 0.011, 0.014), W, 0.008, 'torso', show=0.0, op='s')
    B.ell(on(c.p('spine_03', 0.42, f=0.1), 'torso', 0.006, 0.4), (0.012, 0.006, 0.078), W, 0.01, 'torso', mirror=False)
    B.ell(on(c.p('spine_02', 0.98, f=0.1), 'torso', 0.006, 0.4), (0.008, 0.005, 0.014), W, 0.008, 'torso', mirror=False)
    # the lower ribs: arcs from the back round the flank, dropping toward the front, and the costal margin under the
    # chest
    for i, t in enumerate((0.95, 0.72, 0.5, 0.28)):
        p0 = c.p('spine_02', t, a=0.09, f=-0.05)
        p1 = c.p('spine_02', t - 0.12, a=0.13, f=0.01)
        p2 = c.p('spine_02', t - 0.26, a=0.09, f=0.075 - 0.006 * i)
        rr = (0.0062 - 0.0005 * i) * k
        ridge(p0, p1, rr * 0.8, rr, 0.008, 'torso', 0.5)
        ridge(p1, p2, rr, rr * 0.85, 0.008, 'torso', 0.5)
    ridge(c.p('spine_02', 0.98, a=0.012, f=0.1), c.p('spine_02', 0.4, a=0.075, f=0.09), 0.0062 * k, 0.0056 * k, 0.009, 'torso', 0.45)
    la, ua, ca = 'lowerarm_L', 'upperarm_L', 'calf_L'
    # elbow point and the two epicondyles either side of it
    bump(c.p(la, 0.03, f=-0.03), (0.011, 0.02, 0.011), c.axes(la), 0.01, 'arm', 0.5)
    for aa in (0.022, -0.022):
        bump(c.p(ua, 0.96, a=aa, f=-0.004), (0.008, 0.012, 0.008), c.axes(ua), 0.008, 'arm', 0.5)
    # wrist: three flexor tendons down the inside of the forearm, the ulna's head on the back of the wrist
    for aa in (0.01, 0.0, -0.011):
        ridge(c.p(la, 0.62, a=aa, f=0.016), c.p(la, 0.97, a=aa * 0.8, f=0.012), 0.0042 * k, 0.0036 * k, 0.005, 'arm', 0.62)
    bump(c.p(la, 0.95, a=-0.016, f=-0.01), (0.007, 0.009, 0.006), c.axes(la), 0.006, 'arm', 0.5)
    # kneecap with its tendon down to the shin
    bump(c.p(ca, -0.02, f=0.04), (0.021, 0.025, 0.011), c.axes(ca), 0.009, 'leg', 0.55)
    ridge(c.p(ca, 0.02, f=0.036), c.p(ca, 0.12, f=0.03), 0.0085, 0.0075, 0.008, 'leg', 0.5)
    # ankle: the two ankle bones, the tibialis tendon over the front of the ankle into the instep
    for aa in (0.026, -0.03):
        bump(c.p(ca, 0.96, a=aa), (0.009, 0.013, 0.009), c.axes(ca), 0.008, 'leg', 0.5)
    ridge(c.p(ca, 0.8, a=0.006, f=0.03), c.p(ca, 0.97, a=0.012, f=0.036), 0.0058 * k, 0.0052 * k, 0.01, 'leg', 0.5)
    for fname in ('index', 'middle', 'ring', 'thumb'):
        n = f'{fname}_03_L'
        b = c.bs[n]
        r = P['finger_r'][fname][3]
        B.ell(on(b['head'] + (b['tail'] - b['head']) * 0.62 + c.fr[n][2] * r * 0.75 * c.s, 'hand', r * 0.28, 0.7),
              (r * 0.75, r * 1.3, r * 0.28), c.axes(n), 0.0015, 'hand')
    for base, tip, r in A.toe_axes(c, P):
        q = base + (tip - base) * 0.86
        B.ell(on(q + np.array([0, 0, r]) * c.s, 'foot', r * 0.25, 0.7), (r * 0.7, r * 0.8, r * 0.25),
              A.world_axes(y=-(tip - base)), 0.0015, 'foot')


# ---------------------------------------------------------------------------------------------- Thalune
THALUNE = dict(A.GENERIC)
THALUNE.update(
    muscle=0.35, hip_w=0.118, hip_d=0.092, waist_w=0.118, waist_d=0.09, chest_w=0.166, chest_d=0.098, glute=0.85, lat=0.9,
    lat_t=1.25, cage_lo=0.78,
    neck_r=(0.066, 0.058), uarm_r=(0.045, 0.036), farm_r=(0.037, 0.025), palm_w=0.037, palm_t=0.012, knuckles=0.85,
    finger_r={'index': (0.0105, 0.0095, 0.0088, 0.0098), 'middle': (0.011, 0.01, 0.009, 0.0102),
              'ring': (0.0102, 0.0092, 0.0086, 0.0096), 'thumb': (0.0125, 0.011, 0.0095, 0.0098)},
    finger_squash=0.8,
    thigh_r=(0.08, 0.05), calf_r=(0.052, 0.03), foot_r=(0.032, 0.038), foot_flat=1.9, calf_mass=1.3,
    toes=[(0.024, 0.07, 0.0118), (0.0, 0.08, 0.0124), (-0.024, 0.068, 0.0118)], toe_squash=0.85, ankle_r=0.042, clav_end=0.74,
    toe_splay=0.22, toe_rings=[0.2, 0.45, 0.7, 0.88, 0.97],
    web_rings=[1.12, 1.32],
)


def thalune_extra(B, P):
    c = B.c
    W = A.world_axes()
    # lats: a swimmer's V-taper, widest under the armpit and narrowing straight down to the waist
    B.cone(c.p('spine_03', 0.32, a=0.098, f=-0.03), c.p('spine_02', 0.1, a=0.07, f=-0.012), 0.052, 0.026, 0.05, 'torso')
    # sternum keel (soft)
    B.ell(c.p('spine_03', 0.15, f=0.085), (0.03, 0.03, 0.12), W, 0.05, 'torso', mirror=False)
    landmarks(B, P, 1.0)
    # dorsal keel: a soft ridge of flesh standing 4-5 cm off the back from the nape to the small of the back, narrow
    # across and deep front to back, that the dorsal fin grows from (the break in the outline at the back)
    pts = [c.p('neck_02', 0.2, f=-0.06), c.p('neck_01', 0.4, f=-0.085), c.p('spine_03', 0.75, f=-0.125),
           c.p('spine_03', 0.25, f=-0.135), c.p('spine_02', 0.5, f=-0.115), c.p('spine_01', 0.6, f=-0.075)]
    for a, b, r in zip(pts[:-1], pts[1:], (0.012, 0.016, 0.018, 0.016, 0.012)):
        B.cone(a, b, r, r * 0.9, 0.03, 'torso', mirror=False, side=(1, 0, 0), squash=0.55)
    # toes: a pad under each joint, the joints as small knuckles on top
    for base, tip, r in A.toe_axes(c, P):
        Wt = A.world_axes(y=-(tip - base))
        for f in (0.3, 0.62, 0.9):
            q = base + (tip - base) * f
            B.ell(q + np.array([0, 0, -r * 0.5]) * c.s, (r * 0.72, r * 0.7, r * 0.5), Wt, 0.003, 'foot')
            if f < 0.8:
                B.ell(q + np.array([0, 0, r * 0.5]) * c.s, (r * 0.58, r * 0.42, r * 0.4), Wt, 0.003, 'foot')
    # webs between the fingers: thin slabs from the knuckles to two-thirds of the first phalanx
    sfx = '_L'
    pairs = (('index', 'middle'), ('middle', 'ring'))
    for f1, f2 in pairs:
        b1, b2 = c.bs[f'{f1}_01{sfx}'], c.bs[f'{f2}_01{sfx}']
        h1, h2 = b1['head'], b2['head']
        e1 = h1 + (b1['tail'] - h1) * 0.95
        e2 = h2 + (b2['tail'] - h2) * 0.95
        mid0 = (h1 + h2) / 2
        mid1 = (e1 + e2) / 2
        x, v, z = c.fr[f'{f1}_01{sfx}']
        across = D.nrm(h2 - h1)
        along = D.nrm(mid1 - mid0)
        zz = D.nrm(np.cross(across, along))
        R = np.array([across, along, zz])
        span = np.linalg.norm(h2 - h1) / 2 / c.s
        L = np.linalg.norm(mid1 - mid0) / 2 / c.s
        B.box((mid0 + mid1) / 2 - along * 0.004 * c.s, (span + 0.004, L, 0.0016), R, 0.0015, 0.004, 'hand')
    # thumb web
    tb = c.bs['thumb_01_L']
    ib = c.bs['index_01_L']
    p0 = tb['head'] + (tb['tail'] - tb['head']) * 0.9
    p1 = ib['head']
    B.cone(p0, p1, 0.003, 0.003, 0.01, 'hand')
    # finger pads: rounded tips
    for fname in ('index', 'middle', 'ring', 'thumb'):
        b = c.bs[f'{fname}_03_L']
        B.ell(b['tail'] - (b['tail'] - b['head']) * 0.25 - c.fr[f'{fname}_03_L'][2] * 0.002 * c.s, (0.0105, 0.009, 0.0085),
              c.axes(f'{fname}_03_L'), 0.004, 'hand')


# ---------------------------------------------------------------------------------------------- Ixari
IXARI = dict(A.GENERIC)
IXARI.update(
    muscle=0.75, hip_w=0.11, hip_d=0.088, waist_w=0.1, waist_d=0.08, chest_w=0.14, chest_d=0.095, glute=0.78, lat=0.75,
    lat_t=1.25, cage_lo=0.76,
    neck_r=(0.05, 0.042), neck_squash=0.9, uarm_r=(0.04, 0.031), farm_r=(0.034, 0.022), palm_w=0.031, palm_t=0.011,
    finger_r={'index': (0.0092, 0.0078, 0.0068, 0.0058), 'middle': (0.0096, 0.008, 0.007, 0.006),
              'ring': (0.009, 0.0076, 0.0066, 0.0056), 'thumb': (0.011, 0.0094, 0.0078, 0.0066)},
    knuckles=1.05, finger_squash=0.9, heel=(0.024, 0.036, 0.024), heel_back=0.016, heel_pad=True, heel_reach=0.85,
    ankle_r=0.04, clav_end=0.74, toe_rings=[0.2, 0.45, 0.7, 0.88, 0.97],
    thigh_r=(0.066, 0.044), calf_r=(0.045, 0.026), foot_r=(0.028, 0.033), foot_flat=1.6, calf_mass=1.0,
    toes=[(0.022, 0.072, 0.0108), (0.0, 0.08, 0.0112), (-0.022, 0.068, 0.0104)], toe_squash=0.85,
    toe_splay=0.2,
)


def ixari_extra(B, P):
    c = B.c
    W = A.world_axes()
    # angular planes: a faceted ribcage and pectoral plates (rounded boxes, not ellipsoids)
    # V-taper: the upper ribcage under the armpits is the widest; the lower ribs narrow to the waist
    B.box(c.p('spine_03', 0.55, f=0.024), (0.098, 0.06, 0.07), W, 0.04, 0.026, 'torso', mirror=False)
    B.box(c.p('spine_03', -0.2, f=0.022), (0.07, 0.054, 0.055), W, 0.035, 0.026, 'torso', mirror=False)
    # abdominal plates
    for i, t in enumerate((0.15, 0.55, 0.95)):
        B.box(c.p('spine_01', t, a=0.03, f=0.07 - 0.004 * i), (0.026, 0.012, 0.03), W, 0.01, 0.022, 'torso')
    # spine sockets: raised slate collars where the dorsal crystal grows (crystals are separate meshes)
    for bone, t, r in SPINE_SOCKETS:
        p = c.p(bone, t, f=-0.075 - (0.01 if bone == 'spine_03' else 0.0))
        B.ell(p, (r * 1.15, r * 1.35, r * 0.75), A.rot(W, 0, 0), 0.02, 'torso', mirror=False)
    # forearm sockets (outer forearm, toward the back of the hand)
    la = 'lowerarm_L'
    for t, r in FOREARM_SOCKETS:
        B.ell(c.p(la, t, a=-0.022, f=-0.012), (r * 0.75, r * 1.5, r), c.axes(la), 0.012, 'arm')
    # shoulder plates (angular cap over the deltoid)
    ua = 'upperarm_L'
    B.box(c.p(ua, 0.1, a=-0.03), (0.022, 0.045, 0.036), c.axes(ua), 0.012, 0.06, 'arm')
    landmarks(B, P, 0.9)
    # long calves, a raised heel line
    ca = 'calf_L'
    B.box(c.p(ca, 0.12, f=0.03), (0.022, 0.06, 0.012), c.axes(ca), 0.008, 0.02, 'leg')  # shin plate


SPINE_SOCKETS = [('neck_01', 0.4, 0.012), ('spine_03', 0.85, 0.016), ('spine_03', 0.55, 0.018), ('spine_03', 0.25, 0.018),
                 ('spine_02', 0.85, 0.017), ('spine_02', 0.5, 0.015), ('spine_02', 0.15, 0.013), ('spine_01', 0.6, 0.011)]
FOREARM_SOCKETS = [(0.3, 0.012), (0.5, 0.013), (0.7, 0.011)]


# ---------------------------------------------------------------------------------------------- Ulgani
ULGANI = dict(A.GENERIC)
ULGANI.update(
    muscle=0.75, hip_w=0.14, hip_d=0.11, waist_w=0.15, waist_d=0.12, chest_w=0.175, chest_d=0.125, glute=0.9, lat=1.4,
    landmarks=1.3, knuckles=1.0, ankle_r=0.048, toe_rings=[0.2, 0.45, 0.7, 0.9],
    neck_r=(0.075, 0.066), uarm_r=(0.05, 0.042), farm_r=(0.043, 0.03), palm_w=0.04, palm_t=0.015,
    finger_r={'index': (0.0128, 0.0122, 0.0115, 0.0105), 'middle': (0.013, 0.0124, 0.0118, 0.0108),
              'ring': (0.0125, 0.012, 0.0112, 0.0102), 'thumb': (0.0145, 0.0135, 0.012, 0.011)},
    finger_squash=0.85,
    thigh_r=(0.088, 0.058), calf_r=(0.058, 0.036), foot_r=(0.038, 0.04), foot_flat=1.5, calf_mass=1.3,
    toes=[(0.026, 0.076, 0.0135), (0.0, 0.084, 0.0142), (-0.025, 0.07, 0.013)], toe_squash=0.88,
    toe_splay=0.12,
)


def ulgani_extra(B, P):
    c = B.c
    W = A.world_axes()
    # deep barrel chest and a soft belly
    B.ell(c.p('spine_03', 0.05, f=0.03), (0.16, 0.128, 0.15), W, 0.05, 'torso', mirror=False)
    B.ell(c.p('spine_01', 0.4, f=0.045), (0.115, 0.06, 0.11), W, 0.05, 'torso', mirror=False)
    # porous shoulder swellings (the skin that takes in air): lumpy, several overlapping masses
    B.ell(c.p('spine_03', 0.7, a=0.11, f=-0.02), (0.062, 0.052, 0.048), A.rot(W, -20, 1), 0.03, 'torso')
    B.ell(c.p('spine_03', 0.82, a=0.14, f=0.01), (0.034, 0.03, 0.03), W, 0.02, 'torso')
    B.ell(c.p('spine_03', 0.62, a=0.125, f=-0.04), (0.03, 0.028, 0.032), W, 0.02, 'torso')
    landmarks(B, P, 1.25)
    # breathing openings down the ribs (UL_SLITS): four flared slits per side, each a cut between two raised lips
    for p0, p1 in ulgani_slits(c, B.S.subset(['torso'])):
        mid, d = (p0 + p1) / 2, p1 - p0
        L = np.linalg.norm(d) / 2 / c.s
        out = np.array([1.0, 0.0, 0.0])
        up = d / np.linalg.norm(d)
        ax = np.array([np.cross(up, out), up, out])
        # (flared: a wide cut between two full lips, so the opening reads at turntable distance)
        for lip in (1, -1):
            B.ell(mid + (np.cross(up, out) * 0.0095 * lip + out * 0.0035) * c.s, (0.0068, L, 0.0072), ax, 0.004, 'torso')
        B.ell(mid + out * 0.0045 * c.s, (0.0058, L * 0.95, 0.011), ax, 0.002, 'torso', op='s')
    # bracket shelves over the shoulder blades: three stacked fungal lamellae per side, stepping out from the back
    for j in range(3):
        B.ell(c.p('spine_03', 0.66 - 0.2 * j, a=0.072 + 0.008 * j, f=-0.088 - 0.012 * j), (0.058 - 0.01 * j, 0.032, 0.0085),
              A.rot(A.rot(W, -14, 1), 16, 0), 0.01, 'torso')
    # mycelial cords: raised strands from the neck openings over the shoulders, down the upper arms and round the ribs
    # (kept clear of the armpit, where the torso and arm surfaces meet)
    cords = [
        [c.p('neck_02', 0.3, a=0.05, f=0.0), c.p('neck_01', 0.0, a=0.07, f=-0.01), c.p('clavicle_L', 0.6, f=-0.012, up=0.012)],
        [c.p('neck_01', 0.4, a=0.058, f=0.02), c.p('spine_03', 0.9, a=0.08, f=0.06), c.p('spine_03', 0.55, a=0.095, f=0.07),
         c.p('spine_02', 0.7, a=0.09, f=0.075)],
        [c.p('neck_01', 0.2, a=0.04, f=-0.045), c.p('spine_03', 0.85, a=0.07, f=-0.075), c.p('spine_03', 0.5, a=0.085, f=-0.08),
         c.p('spine_02', 0.7, a=0.08, f=-0.07)],
    ]
    for pts in cords:
        for k, (p0, p1) in enumerate(zip(pts[:-1], pts[1:])):
            r0 = 0.0058 * (1 - 0.12 * k)
            B.cone(p0, p1, r0, r0 * 0.88, 0.006, 'torso')
    # pitting over the porous swellings and the upper chest: open breathing pits modelled in the surface, in clusters
    rng = np.random.default_rng(7)
    for cen, rad, n in ((c.p('spine_03', 0.7, a=0.11, f=-0.02), np.array([0.062, 0.052, 0.048]), 9),
                        (c.p('spine_03', 0.82, a=0.14, f=0.01), np.array([0.034, 0.03, 0.03]), 4)):
        for _ in range(n):
            d = rng.normal(size=3)
            d[1] = -abs(d[1]) if cen[1] < 0.0 and rng.uniform() < 0.5 else d[1]
            d[0] = abs(d[0])
            d /= np.linalg.norm(d)
            p = cen + d * rad * c.s * 0.98
            r = rng.uniform(0.008, 0.011)
            # a wide, shallow pit: the sphere sits mostly outside the skin (the mesh resolves ~1 cm dimples cleanly)
            B.ell(p + d * r * 0.62, (r, r, r), W, 0.004, 'torso', op='s')
    # heavy forearms
    la = 'lowerarm_L'
    B.ell(c.p(la, 0.35, f=0.005), (0.045, 0.1, 0.04), c.axes(la), 0.03, 'arm')


SLITS = []


def ulgani_slits(c, S):
    """The rib openings of the left side as (top, bottom) points on the flank sculpt `S`, from under the armpit down
    the ribs, slanting forward; kept in SLITS so the skin paints their wet insides at the same places."""
    out = []
    for i in range(4):
        top = c.p('spine_03', 0.18 - 0.2 * i, a=0.152 - 0.004 * i, f=0.03 - 0.004 * i)
        bot = c.p('spine_03', 0.02 - 0.2 * i, a=0.158 - 0.004 * i, f=0.058 - 0.004 * i)
        out.append(tuple(S.project(np.array([top, bot]), iters=12)))
    SLITS[:] = out
    return out


PEOPLES = {
    'thalune': (THALUNE, thalune_extra),
    'ixari': (IXARI, ixari_extra),
    'ulgani': (ULGANI, ulgani_extra),
    'canon': (A.GENERIC, None),
}


def body_sdf(ctx, people):
    P, extra = PEOPLES[people]
    return A.body(ctx, P, extra), P
