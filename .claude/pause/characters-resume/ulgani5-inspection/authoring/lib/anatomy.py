"""Body forms of the three peoples as signed-distance 'sculpts' laid on the shared skeleton.

Everything is placed in the frames of the bones (skel.bones), so one description serves all three peoples; the
per-people dicts change sizes and add each people's biology.  Left-side parts are mirrored to the right.
Tags: torso, arm, hand, leg, foot (the cage builder projects each part onto its own tag set first)."""
import numpy as np

from . import sdf as D
from .skel import frame

MIRROR = np.array([-1.0, 1.0, 1.0])


class Ctx:
    def __init__(self, bs, scale):
        self.bs = bs
        self.s = scale
        self.fr = {n: frame(b) for n, b in bs.items()}

    def L(self, bone):
        b = self.bs[bone]
        return float(np.linalg.norm(b['tail'] - b['head']))

    def p(self, bone, t=0.0, a=0.0, f=0.0, up=0.0):
        """Point on `bone` at fraction t from head to tail, offset a along the bone's x axis (medial for left limbs,
        +X for the torso), f along its z axis (front), up along +Z world.  Offsets are in metres * people scale."""
        b = self.bs[bone]
        x, v, z = self.fr[bone]
        return b['head'] + (b['tail'] - b['head']) * t + x * a * self.s + z * f * self.s + np.array([0, 0, up * self.s])

    def axes(self, bone):
        x, v, z = self.fr[bone]
        return np.array([x, v, z])


def _mirror_prim(pr):
    """A mirrored copy (x -> -x) of a primitive."""
    import copy
    q = copy.copy(pr)
    if isinstance(pr, D.RoundCone):
        q = D.RoundCone(pr.a * MIRROR, pr.b * MIRROR, pr.ra, pr.rb, None if pr.side is None else pr.side * MIRROR, pr.squash)
    elif isinstance(pr, D.Ellipsoid):
        R = pr.R * MIRROR
        q = D.Ellipsoid(pr.c * MIRROR, pr.r, R)
    elif isinstance(pr, D.Box):
        q = D.Box(pr.c * MIRROR, pr.h, pr.R * MIRROR, pr.round)
    else:
        raise TypeError(type(pr))
    return q


class Builder:
    def __init__(self, ctx, band=0.05):
        self.c = ctx
        self.S = D.SDF(band=band)

    def add(self, pr, k, tag, mirror=True, op='u'):
        fn = {'u': self.S.add, 's': self.S.sub, 'i': self.S.inter}[op]
        fn(pr, k, tag)
        if mirror:
            # the right leg and foot carry their own tag so the two legs never smooth-blend into each other
            fn(_mirror_prim(pr), k, tag + '_R' if tag in ('leg', 'foot') else tag)
        return pr

    def cone(self, a, b, ra, rb, k, tag, mirror=True, side=None, squash=1.0, op='u'):
        s = self.c.s
        return self.add(D.RoundCone(a, b, ra * s, rb * s, side, squash), k * s, tag, mirror, op)

    def ell(self, c, radii, axes, k, tag, mirror=True, op='u'):
        s = self.c.s
        return self.add(D.Ellipsoid(c, np.asarray(radii) * s, axes), k * s, tag, mirror, op)

    def box(self, c, half, axes, rnd, k, tag, mirror=True, op='u'):
        s = self.c.s
        return self.add(D.Box(c, np.asarray(half) * s, axes, rnd * s), k * s, tag, mirror, op)


def rot(axes, deg, about):
    """Rotates the rows of `axes` (3x3) by deg about one of their own axes (0 x, 1 v, 2 z)."""
    a = np.radians(deg)
    i, j = [k for k in range(3) if k != about]
    A = axes.copy()
    ci, cj = A[i].copy(), A[j].copy()
    A[i] = ci * np.cos(a) + cj * np.sin(a)
    A[j] = -ci * np.sin(a) + cj * np.cos(a)
    return A


def world_axes(z=(0, 0, 1), y=(0, -1, 0)):
    """Rows (x, y, z) for an ellipsoid with local y -> `y` (front) and local z -> `z` (up)."""
    zz = D.nrm(z)
    yy = np.asarray(y, float) - np.dot(y, zz) * zz
    yy = D.nrm(yy)
    xx = np.cross(yy, zz)
    return np.array([xx, yy, zz])


# ---------------------------------------------------------------------------------------------- generic humanoid
def torso(B, P):
    c = B.c
    m = P['muscle']
    W = world_axes()
    hw, hd = P['hip_w'], P['hip_d']
    # pelvis block, trochanter masses (the widest point of the hips sits on the thigh, not above it)
    B.ell(c.p('pelvis', 0.2, f=0.0), (hw, hd, 0.10), W, 0.04, 'torso', mirror=False)
    tr = P.get('trochanter', 0.0)
    if tr > 0:
        B.ell(c.p('thigh_L', 0.07, a=-0.015, f=-0.004), np.array((0.05, 0.06, 0.06)) * tr, c.axes('thigh_L'), 0.05, 'torso')
    # glutes: compact, high
    g = P.get('glute', 1.0)
    B.ell(c.p('pelvis', -0.1, a=0.052, f=-0.062), np.array((0.064, 0.048, 0.068)) * g, rot(W, 12, 1), 0.045, 'torso')
    # waist and abdomen
    B.cone(c.p('pelvis', 0.55), c.p('spine_02', 0.45, f=0.004), P['waist_w'], P['waist_w'] * 1.05, 0.06, 'torso', mirror=False,
           side=(0, 1, 0), squash=P['waist_d'] / P['waist_w'])
    B.ell(c.p('spine_01', 0.35, f=0.04), (0.098, 0.058, 0.125), W, 0.05, 'torso', mirror=False)
    # obliques over the iliac crest
    B.ell(c.p('spine_01', 0.05, a=0.085, f=0.0), (0.04, 0.06, 0.07), rot(W, -10, 1), 0.04, 'torso')
    # ribcage: a lower cage and a broad upper chest
    cw, cd = P['chest_w'], P['chest_d']
    B.ell(c.p('spine_02', 0.55, f=0.012), (cw * P.get('cage_lo', 0.9), cd * 0.92, 0.12), W, 0.05, 'torso', mirror=False)
    B.ell(c.p('spine_03', 0.3, f=0.012), (cw, cd, 0.13), W, 0.05, 'torso', mirror=False)
    # pectorals: broad flat plates over the upper chest
    pd = P.get('pec_d', 0.03) * (0.7 + 0.6 * m)
    B.ell(c.p('spine_03', 0.36, a=0.058, f=cd * 0.55), (0.08, pd, 0.065), rot(W, -8, 2), 0.06, 'torso')
    # lats and scapulae
    lat = P.get('lat', 1.0)
    B.ell(c.p('spine_02', P.get('lat_t', 0.85), a=0.07 + 0.02 * lat, f=-0.03), np.array((0.06 + 0.02 * lat, 0.05, 0.14)), rot(W, 10, 1), 0.05, 'torso')
    B.ell(c.p('spine_03', 0.45, a=0.062, f=-0.052), (0.07, 0.042, 0.075), W, 0.05, 'torso')
    # trapezius: neck base to the shoulder
    B.cone(c.p('neck_01', 0.1, f=-0.012), c.p('clavicle_L', 0.78, f=-0.008, up=-0.002), 0.045, 0.03, 0.045, 'torso')
    # neck
    B.cone(c.p('neck_01', -0.3, f=-0.004), c.p('head', 0.12, f=0.01), P['neck_r'][0], P['neck_r'][1], 0.04, 'torso', mirror=False,
           side=(1, 0, 0), squash=P.get('neck_squash', 1.0))
    lm = P.get('landmarks', 1.0)
    if lm > 0:
        # clavicles: a ridge from the sternal notch out to the shoulder
        B.cone(c.p('spine_03', 0.9, a=0.018, f=cd * 0.66), c.p('clavicle_L', P.get('clav_end', 0.92), f=0.022, up=0.008), 0.0105 * lm, 0.011 * lm, 0.016,
               'torso')
        # sternal groove and the furrow over the spine
        B.ell(c.p('spine_03', 0.35, f=cd * 0.98), (0.006, 0.006, 0.09), W, 0.02 * lm, 'torso', mirror=False, op='s')
        B.ell(c.p('spine_02', 0.6, f=-cd * 0.86), (0.0055, 0.006, 0.17), W, 0.022 * lm, 'torso', mirror=False, op='s')
        # the lower rib arch: a soft edge where the cage meets the belly
        B.ell(c.p('spine_02', 0.1, a=0.055, f=cd * 0.62), (0.05, 0.016, 0.012), rot(W, 28, 1), 0.02 * lm, 'torso')
    if P.get('head_preview'):
        B.ell(c.p('head', 0.45, f=0.01), (0.075, 0.09, 0.11), W, 0.03, 'torso', mirror=False)


def arm(B, P):
    c = B.c
    m = P['muscle']
    ua, la = 'upperarm_L', 'lowerarm_L'
    # deltoid
    B.ell(c.p(ua, 0.1, a=-0.01, f=0.002), (0.054, 0.075, 0.054), c.axes(ua), 0.04, 'arm')
    # upper arm core
    B.cone(c.p(ua, 0.0), c.p(ua, 1.0), P['uarm_r'][0], P['uarm_r'][1], 0.02, 'arm')
    # biceps (front) and triceps (back)
    B.ell(c.p(ua, 0.55, f=0.018), (0.034, 0.075, 0.03 + 0.006 * m), c.axes(ua), 0.025, 'arm')
    B.ell(c.p(ua, 0.45, f=-0.02), (0.036, 0.09, 0.032 + 0.006 * m), c.axes(ua), 0.025, 'arm')
    # elbow
    B.ell(c.p(la, 0.0, f=-0.012), (0.03, 0.032, 0.03), c.axes(la), 0.02, 'arm')
    # forearm: flattened cone, muscle belly near the elbow
    B.cone(c.p(la, 0.02), c.p(la, 1.0), P['farm_r'][0], P['farm_r'][1], 0.02, 'arm', side=c.fr[la][0], squash=0.82)
    B.ell(c.p(la, 0.28, a=-0.008, f=0.008), (0.036, 0.085, 0.032), c.axes(la), 0.03, 'arm')


def hand(B, P):
    c = B.c
    h = 'hand_L'
    ax = c.axes(h)  # x: toward index, v: along, z: dorsal
    L = c.L(h)
    pw, pt = P['palm_w'], P['palm_t']
    # wrist and palm
    B.cone(c.p('lowerarm_L', 0.93), c.p(h, 0.12), P['farm_r'][1], P['farm_r'][1] * 0.95, 0.012, 'hand', side=ax[0], squash=0.62)
    B.box(c.p(h, 0.52, f=-0.002), (pw, L * 0.46 / c.s, pt), ax, pt * 0.92, 0.012, 'hand')
    # thenar (thumb base pad)
    B.ell(c.p(h, 0.32, a=0.016, f=-0.014), (0.017, 0.028, 0.013), ax, 0.012, 'hand')
    fr = P['finger_r']
    for fname in ('index', 'middle', 'ring', 'thumb'):
        rr = fr[fname]
        names = [f'{fname}_0{i}_L' for i in (1, 2, 3)]
        for i, n in enumerate(names):
            b = c.bs[n]
            r0, r1 = rr[i], rr[i + 1]
            a = b['head']
            e = b['tail'] if i < 2 else b['tail'] - (b['tail'] - b['head']) * (r1 * c.s / c.L(n))
            B.cone(a, e, r0, r1, 0.006, 'hand', side=c.fr[n][2], squash=P.get('finger_squash', 0.86))
            # knuckle: the joint's head standing out on the back of the finger (proud of the finger's own surface; the
            # first row, the big knuckles of the fist, the strongest)
            kn = P.get('knuckles', 0.6) * (1.25 if i == 0 else 1.0)
            if kn > 0:
                B.ell(b['head'] + c.fr[n][2] * rr[i] * 0.72 * c.s, np.array([rr[i] * 0.85, rr[i] * 0.9, rr[i] * 0.42]) * kn,
                      c.axes(n), 0.003, 'hand')
        # metacarpal bridge from palm to the knuckle
        if fname != 'thumb':
            b1 = c.bs[names[0]]
            B.cone(c.p(h, 0.55, f=-0.002) + (b1['head'] - c.p(h, 1.0)) * 0.6, b1['head'], rr[0] * 1.05, rr[0], 0.01, 'hand',
                   side=ax[2], squash=0.8)
        else:
            b1 = c.bs[names[0]]
            B.cone(c.p(h, 0.15, a=0.006, f=-0.008), b1['head'] + (b1['tail'] - b1['head']) * 0.3, rr[0] * 1.15, rr[0], 0.012, 'hand')


def leg(B, P):
    c = B.c
    m = P['muscle']
    th, ca = 'thigh_L', 'calf_L'
    B.cone(c.p(th, -0.02, a=0.006), c.p(th, 1.0), P['thigh_r'][0], P['thigh_r'][1], 0.045, 'leg')
    # quadriceps, vastus medialis teardrop, hamstrings, adductors
    B.ell(c.p(th, 0.45, f=0.026), (0.058, 0.18, 0.042 + 0.008 * m), c.axes(th), 0.045, 'leg')
    B.ell(c.p(th, 0.8, a=0.022, f=0.016), (0.035, 0.075, 0.032), c.axes(th), 0.035, 'leg')
    B.ell(c.p(th, 0.45, f=-0.028), (0.055, 0.17, 0.045), c.axes(th), 0.045, 'leg')
    B.ell(c.p(th, 0.22, a=0.035), (0.042, 0.13, 0.05), c.axes(th), 0.045, 'leg')
    # knee and kneecap
    B.ell(c.p(ca, -0.01, f=0.0), (0.048, 0.07, 0.046), c.axes(ca), 0.06, 'leg')
    B.ell(c.p(ca, -0.015, f=0.036), (0.022, 0.026, 0.013), c.axes(ca), 0.025, 'leg')
    # shin and calf (gastrocnemius high and inside, soleus lower)
    B.cone(c.p(ca, -0.02), c.p(ca, 1.0), P['calf_r'][0], P['calf_r'][1], 0.05, 'leg')
    gm = P.get('calf_mass', 1.0)
    B.ell(c.p(ca, 0.27, f=-0.026, a=0.008), np.array((0.042, 0.11, 0.038 + 0.006 * m)) * gm, c.axes(ca), 0.04, 'leg')
    B.ell(c.p(ca, 0.5, f=-0.018), np.array((0.036, 0.13, 0.03)) * gm, c.axes(ca), 0.04, 'leg')
    # ankle
    B.ell(c.p(ca, 0.97), (0.034, 0.035, 0.03), c.axes(ca), 0.025, 'leg')
    if P.get('landmarks', 1.0) > 0 and P.get('leg_landmarks', True):
        # achilles tendon, the tibial tuberosity under the kneecap, the hamstring tendons behind the knee
        B.cone(c.p(ca, 0.62, f=-0.024), c.p(ca, 1.02, f=-0.03), 0.009, 0.008, 0.016, 'leg')
        B.ell(c.p(ca, 0.1, f=0.034), (0.012, 0.016, 0.008), c.axes(ca), 0.018, 'leg')
        for aa in (0.022, -0.024):
            B.cone(c.p(th, 0.78, a=aa, f=-0.03), c.p(ca, 0.06, a=aa * 0.9, f=-0.03), 0.0075, 0.0065, 0.014, 'leg')


def foot(B, P):
    c = B.c
    fo, ba = 'foot_L', 'ball_L'
    ax = c.axes(fo)
    W = world_axes(y=(0, -1, 0))
    # heel
    B.ell(c.p(fo, 0.0, f=0.0, up=-0.04) + np.array([0, P.get('heel_back', 0.035) * c.s, 0]), P.get('heel', (0.032, 0.04, 0.035)), W, 0.02, 'foot')
    if P.get('heel_pad'):
        # a modelled heel: a tapered pad from the heel under the arch, and the tendon's insertion above it
        B.cone(c.p(fo, 0.0, up=-0.05) + np.array([0, 0.03 * c.s, 0]), c.p(fo, 0.45, up=-0.025), 0.022, 0.016, 0.012, 'foot',
               side=(1, 0, 0), squash=0.8)
    # foot body to the ball
    fb = c.bs[fo]
    bb = c.bs[ba]
    B.cone(fb['head'] + np.array([0, 0.01, -0.03]) * c.s, bb['head'] + np.array([0, 0.0, -0.002]) * c.s, P['foot_r'][0], P['foot_r'][1],
           0.025, 'foot', side=(1, 0, 0), squash=1.0 / P.get('foot_flat', 1.6))
    # the ball of the foot: a broad pad under the forefoot, so the front of the foot is a wide sole and not the end
    # of a capsule
    fw = P.get('ball_w', 1.0)
    B.ell(bb['head'] + np.array([0.0, 0.012, -0.012]) * c.s, np.array((0.04 * fw, 0.03, 0.014)), c.axes(ba), 0.012, 'foot')
    # the arch, hollowed under the inner side of the foot
    if P.get('landmarks', 1.0) > 0:
        B.ell(c.p(fo, 0.62, a=0.034, up=-0.03), (0.016, 0.04, 0.012), c.axes(fo), 0.02, 'foot', op='s')
    # toes: fanned out from the forefoot so they part a short way past it, each tapering to a rounded tip
    for base, tip, r in toe_axes(c, P):
        B.cone(base, tip, r, r * 0.78, 0.006, 'foot', side=(0, 0, 1), squash=P.get('toe_squash', 0.75))


def toe_axes(c, P, side=1):
    """(base, tip, radius) of each toe of the left foot (`side` -1: the right foot, mirrored).  The toes start
    together inside the forefoot and fan out from the ball (toe_fan degrees each side), so neighbours part about a
    sixth of the way along and every toe is its own digit; the tips curl down toward the ground."""
    bb = c.bs['ball_L']
    d0 = (bb['tail'] - bb['head']) / np.linalg.norm(bb['tail'] - bb['head'])
    fan = np.radians(P.get('toe_fan', 15.0))
    out = []
    for dx, ln, r in P['toes']:
        a = fan * np.sign(dx)
        d = np.array([d0[0] * np.cos(a) - d0[1] * np.sin(a), d0[0] * np.sin(a) + d0[1] * np.cos(a), d0[2]])
        base = bb['head'] + np.array([dx * P.get('toe_spread', 0.9), 0.0, -0.004]) * c.s
        tip = base + d * ln * c.s + np.array([0, 0, -0.007]) * c.s
        M = np.array([side, 1.0, 1.0])
        out.append((base * M, tip * M, r))
    return out


GENERIC = dict(
    muscle=0.6, hip_w=0.138, hip_d=0.10, waist_w=0.135, waist_d=0.098, chest_w=0.15, chest_d=0.102,
    neck_r=(0.058, 0.05), uarm_r=(0.045, 0.036), farm_r=(0.038, 0.025), palm_w=0.034, palm_t=0.012,
    finger_r={'index': (0.0105, 0.0095, 0.0085, 0.0075), 'middle': (0.011, 0.01, 0.009, 0.008),
              'ring': (0.0102, 0.0092, 0.0082, 0.0072), 'thumb': (0.013, 0.0115, 0.0095, 0.0085)},
    thigh_r=(0.078, 0.05), calf_r=(0.05, 0.03), foot_r=(0.03, 0.036), foot_flat=1.7, calf_mass=1.15,
    toes=[(0.022, 0.05, 0.011), (0.0, 0.055, 0.012), (-0.022, 0.048, 0.011)],
    # one more ring of the foot tube past the ball, where the fanned toes part: the cage splits into toes there
    foot_web=[0.1],
    # cage rings: loops gathered at the shoulder, elbow, hip and knee so the joints have edges to fold on
    arm_rings=[('upperarm_L', 0.05), ('upperarm_L', 0.13), ('upperarm_L', 0.32), ('upperarm_L', 0.54), ('upperarm_L', 0.74),
               ('upperarm_L', 0.86), ('upperarm_L', 0.94), ('lowerarm_L', 0.0), ('lowerarm_L', 0.06), ('lowerarm_L', 0.13),
               ('lowerarm_L', 0.34), ('lowerarm_L', 0.58), ('lowerarm_L', 0.8), ('lowerarm_L', 0.93), ('lowerarm_L', 1.0)],
    leg_rings=[('thigh_L', 0.06), ('thigh_L', 0.14), ('thigh_L', 0.32), ('thigh_L', 0.52), ('thigh_L', 0.72), ('thigh_L', 0.86),
               ('thigh_L', 0.94), ('calf_L', 0.0), ('calf_L', 0.06), ('calf_L', 0.14), ('calf_L', 0.34), ('calf_L', 0.56),
               ('calf_L', 0.76), ('calf_L', 0.9)],
)


def body(ctx, P, extra=None):
    B = Builder(ctx)
    torso(B, P)
    arm(B, P)
    hand(B, P)
    leg(B, P)
    foot(B, P)
    if extra:
        extra(B, P)
    return B.S
