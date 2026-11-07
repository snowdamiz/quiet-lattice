"""The shared humanoid skeleton (DESIGN 19.2: one skeleton for the three peoples, crews and city NPCs).

Canonical rest pose: the 1.85 m biped of the art bible, A-pose, facing -Y, +Z up, left = +X.  Every people uses the same
bone names, hierarchy and roll convention; only lengths differ (per-people length/width multipliers, then a uniform
scale of at most +-6%).  Joint positions are derived by walking the hierarchy: each bone's head keeps its offset from
the parent expressed in the parent's frame (the along-bone part scales with the parent's new length, the across part
with the people's width multiplier); each bone keeps its canonical direction.
"""
import math
from fnmatch import fnmatchcase

import numpy as np

V = lambda *a: np.array(a, dtype=np.float64)


def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


# ---------------------------------------------------------------------------------------------- canonical joints
F_ARM = nrm(V(0.66, -0.10, -0.745))          # forearm / hand direction (left)
N_PALM = nrm(V(-1, 0, 0) - (-1 * F_ARM[0]) * F_ARM)  # palm normal (out of the palm), down-in
S_IDX = nrm(np.cross(N_PALM, F_ARM))           # across the hand toward the index finger (front)
WRIST = V(0.551, 0.004, 1.056)
PALM_LEN = 0.095


def _finger(base, d, lens, curl_deg, n):
    """Joint positions of one finger: base, then each phalanx end, curling toward the palm normal `n`."""
    pts = [np.array(base)]
    d = nrm(d)
    for i, L in enumerate(lens):
        a = math.radians(curl_deg * (i + 1))
        di = nrm(d * math.cos(a) + n * math.sin(a))
        pts.append(pts[-1] + di * L)
    return pts


KNUCKLE = WRIST + F_ARM * PALM_LEN + N_PALM * 0.004
FINGERS = {
    # name: (knuckle offset across, back along f, splay toward index, phalanx lengths)
    'index': (0.0215, 0.004, 0.10, (0.040, 0.026, 0.020)),
    'middle': (0.0, 0.0, 0.0, (0.044, 0.028, 0.021)),
    'ring': (-0.021, 0.008, -0.10, (0.038, 0.025, 0.019)),
}
THUMB_BASE = WRIST + F_ARM * 0.024 + S_IDX * 0.020 + N_PALM * 0.014
THUMB_DIR = nrm(F_ARM * 0.55 + S_IDX * 0.62 + N_PALM * 0.42)
THUMB_LENS = (0.040, 0.032, 0.026)

# (name, parent, head, tail, deform, z-axis hint)  -- left side and centre only; _R bones mirror the _L ones
UP, FWD = V(0, 0, 1), V(0, -1, 0)
CANON = [
    ('root', None, V(0, 0, 0), V(0, 0, 0.15), False, FWD),
    ('pelvis', 'root', V(0, 0.01, 0.975), V(0, 0.01, 1.06), True, FWD),
    ('spine_01', 'pelvis', V(0, 0.01, 1.06), V(0, 0.015, 1.18), True, FWD),
    ('spine_02', 'spine_01', V(0, 0.015, 1.18), V(0, 0.01, 1.31), True, FWD),
    ('spine_03', 'spine_02', V(0, 0.01, 1.31), V(0, 0.015, 1.47), True, FWD),
    ('neck_01', 'spine_03', V(0, 0.015, 1.47), V(0, 0.005, 1.545), True, FWD),
    ('neck_02', 'neck_01', V(0, 0.005, 1.545), V(0, -0.005, 1.615), True, FWD),
    ('head', 'neck_02', V(0, -0.005, 1.615), V(0, -0.005, 1.85), True, FWD),
    ('jaw', 'head', V(0, -0.012, 1.642), V(0, -0.092, 1.588), True, UP),
    ('socket_head', 'head', V(0, -0.005, 1.85), V(0, -0.005, 1.95), False, FWD),
    ('crest_01', 'head', V(0, 0.0, 1.79), V(0, 0.012, 1.87), True, FWD),
    ('crest_02', 'crest_01', V(0, 0.012, 1.87), V(0, 0.03, 1.95), True, FWD),
    ('crest_03', 'crest_02', V(0, 0.03, 1.95), V(0, 0.052, 2.03), True, FWD),
    ('eye_L', 'head', V(0.033, -0.074, 1.70), V(0.033, -0.104, 1.70), True, UP),
    ('eye_upper_L', 'head', V(0.046, -0.058, 1.752), V(0.050, -0.082, 1.756), True, UP),
    ('lid_upper_L', 'head', V(0.033, -0.074, 1.70), V(0.033, -0.102, 1.712), True, UP),
    ('lid_lower_L', 'head', V(0.033, -0.074, 1.70), V(0.033, -0.102, 1.688), True, UP),
    ('lid_nict_L', 'head', V(0.033, -0.074, 1.70), V(0.024, -0.103, 1.70), True, UP),
    ('clavicle_L', 'spine_03', V(0.02, 0.0, 1.455), V(0.165, 0.025, 1.475), True, FWD),
    ('upperarm_L', 'clavicle_L', V(0.175, 0.03, 1.455), V(0.38, 0.03, 1.25), True, FWD),
    ('upperarm_twist_L', 'upperarm_L', V(0.175, 0.03, 1.455), V(0.2775, 0.03, 1.3525), True, FWD),
    ('lowerarm_L', 'upperarm_L', V(0.38, 0.03, 1.25), WRIST.copy(), True, FWD),
    ('lowerarm_twist_L', 'lowerarm_L', (V(0.38, 0.03, 1.25) + WRIST) / 2, WRIST.copy(), True, FWD),
    ('hand_L', 'lowerarm_L', WRIST.copy(), WRIST + F_ARM * PALM_LEN, True, -N_PALM),
    ('socket_hand_L', 'hand_L', WRIST + F_ARM * 0.055 + N_PALM * 0.035, WRIST + F_ARM * 0.055 + N_PALM * 0.035 + S_IDX * 0.08, False, -N_PALM),
    ('thigh_L', 'pelvis', V(0.092, 0.0, 0.94), V(0.094, -0.008, 0.505), True, FWD),
    ('calf_L', 'thigh_L', V(0.094, -0.008, 0.505), V(0.10, 0.032, 0.085), True, FWD),
    ('foot_L', 'calf_L', V(0.10, 0.032, 0.085), V(0.115, -0.088, 0.025), True, UP),
    ('ball_L', 'foot_L', V(0.115, -0.088, 0.025), V(0.122, -0.153, 0.02), True, UP),
]
# fingers
for fname, (across, back, splay, lens) in FINGERS.items():
    base = KNUCKLE + S_IDX * across - F_ARM * back
    pts = _finger(base, F_ARM + S_IDX * splay, lens, 9.0, N_PALM)
    parent = 'hand_L'
    for i in range(3):
        n = f'{fname}_0{i + 1}_L'
        CANON.append((n, parent, pts[i], pts[i + 1], True, -N_PALM))
        parent = n
pts = _finger(THUMB_BASE, THUMB_DIR, THUMB_LENS, 8.0, N_PALM)
parent = 'hand_L'
for i in range(3):
    n = f'thumb_0{i + 1}_L'
    CANON.append((n, parent, pts[i], pts[i + 1], True, nrm(np.cross(THUMB_DIR, F_ARM)) * -1 + -N_PALM * 0.3))
    parent = n

# ---------------------------------------------------------------------------------------------- the three peoples
# scale: uniform, applied last (art bible: the shared 1.85 m skeleton, scaled +-6% per people)
# len: bone-name globs -> length multiplier;  width: bone-name globs -> multiplier on the across-parent part of the head
PEOPLE = {
    'thalune': {
        'dz': 0.004,
        'scale': 1.005,
        'len': {'spine_0*': 1.04, 'pelvis': 1.0, 'neck_0*': 0.86, 'clavicle_*': 1.10, 'upperarm*': 1.0, 'lowerarm*': 0.98,
                'hand_*': 1.04, 'index_*': 1.06, 'middle_*': 1.06, 'ring_*': 1.06, 'thumb_*': 1.0, 'thigh_*': 0.97,
                'calf_*': 0.98, 'foot_*': 1.18, 'ball_*': 1.55, 'head': 0.98, 'crest_*': 0.6},
        'width': {'thigh_*': 1.02, 'eye_*': 1.42, 'lid_*': 1.42, 'eye_upper_*': 1.0},
    },
    'ixari': {
        'dz': 0.066,
        'scale': 0.97,
        'len': {'spine_0*': 1.02, 'neck_0*': 1.22, 'clavicle_*': 0.96, 'upperarm*': 1.06, 'lowerarm*': 1.10,
                'hand_*': 1.08, 'index_*': 1.42, 'middle_*': 1.42, 'ring_*': 1.42, 'thumb_*': 1.25, 'thigh_*': 1.05,
                'calf_*': 1.08, 'foot_*': 1.05, 'ball_*': 1.2, 'head': 1.05, 'crest_*': 0.5},
        'width': {'thigh_*': 0.97, 'eye_*': 0.92, 'lid_*': 0.92},
    },
    'ulgani': {
        'dz': -0.048,
        'scale': 1.023,
        'len': {'spine_0*': 0.98, 'neck_0*': 0.78, 'clavicle_*': 1.14, 'upperarm*': 0.97, 'lowerarm*': 0.95,
                'hand_*': 0.98, 'index_*': 0.86, 'middle_*': 0.86, 'ring_*': 0.86, 'thumb_*': 0.92, 'thigh_*': 0.93,
                'calf_*': 0.92, 'foot_*': 1.02, 'ball_*': 1.0, 'head': 0.96, 'crest_*': 1.25},
        'width': {'thigh_*': 1.12, 'eye_*': 1.12, 'lid_*': 1.12},
    },
    'canon': {'scale': 1.0, 'len': {}, 'width': {}},
}


def _mul(table, name):
    base = name[:-2] if name.endswith(('_L', '_R')) else name
    for pat, m in table.items():
        if fnmatchcase(name, pat) or fnmatchcase(base, pat):
            return m
    return 1.0


def _frame(head, tail, hint):
    v = nrm(tail - head)
    z = np.asarray(hint, dtype=np.float64)
    z = z - np.dot(z, v) * v
    if np.linalg.norm(z) < 1e-6:
        z = np.array([0, 0, 1.0]) - np.dot([0, 0, 1.0], v) * v
    z = nrm(z)
    x = nrm(np.cross(v, z))
    return x, v, z


def bones(people='canon'):
    """name -> dict(head, tail, parent, deform, hint) for every bone (left, centre and mirrored right)."""
    p = PEOPLE[people]
    out = {}
    canon = {b[0]: b for b in CANON}
    for name, parent, head, tail, deform, hint in CANON:
        L = _mul(p['len'], name)
        W = _mul(p['width'], name)
        if parent is None:
            nh = head.copy()
        else:
            ph, pt, *_ = canon[parent][2], canon[parent][3]
            x, v, z = _frame(canon[parent][2], canon[parent][3], canon[parent][5])
            d = head - ph
            plen = np.linalg.norm(pt - ph)
            along = np.dot(d, v) / plen
            P = out[parent]
            nplen = np.linalg.norm(P['tail'] - P['head'])
            nh = P['head'] + v * along * nplen + (x * np.dot(d, x) + z * np.dot(d, z)) * W
        nt = nh + (tail - head) * L
        out[name] = {'head': nh, 'tail': nt, 'parent': parent, 'deform': deform, 'hint': np.asarray(hint, dtype=np.float64)}
    s = p['scale']
    dz = np.array([0, 0, p.get('dz', 0.0)])
    for name, b in out.items():
        b['head'] = b['head'] * s + (dz if name != 'root' else 0.0)
        b['tail'] = b['tail'] * s + (dz if name != 'root' else 0.0)
    for name in [n for n in out if n.endswith('_L')]:
        b = out[name]
        m = np.array([-1, 1, 1.0])
        par = b['parent']
        out[name[:-2] + '_R'] = {
            'head': b['head'] * m,
            'tail': b['tail'] * m,
            'parent': (par[:-2] + '_R') if par and par.endswith('_L') else par,
            'deform': b['deform'],
            'hint': b['hint'] * m,
        }
    return out


def order(bs):
    """Bone names, parents first."""
    done, out = set(), []
    names = list(bs)
    while len(out) < len(names):
        for n in names:
            if n in done:
                continue
            par = bs[n]['parent']
            if par is None or par in done:
                out.append(n)
                done.add(n)
    return out


def frame(b):
    return _frame(b['head'], b['tail'], b['hint'])


def build_armature(bpy, name, people, collection):
    """Creates the armature object `name` for `people` (rest pose = the A-pose above)."""
    from mathutils import Vector
    bs = bones(people)
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    collection.objects.link(obj)
    arm.display_type = 'STICK'
    vl = bpy.context.view_layer
    for o in list(bpy.context.scene.objects):
        if o is not None:
            o.select_set(False)
    vl.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n in order(bs):
        b = bs[n]
        e = arm.edit_bones.new(n)
        e.head = Vector(b['head'])
        e.tail = Vector(b['tail'])
        x, v, z = frame(b)
        e.align_roll(Vector(z))
        e.use_deform = b['deform']
        if b['parent']:
            e.parent = eb[b['parent']]
            e.use_connect = bool(np.linalg.norm(bs[b['parent']]['tail'] - b['head']) < 1e-5) and not n.startswith(('socket', 'upperarm_twist', 'lowerarm_twist'))
        eb[n] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


BLENDSHAPES = [
    ('jawOpen', 'jaw dropped, lips parted (bone jaw does the same; use one or the other)'),
    ('vis_AA', 'viseme A (father): jaw open, lips relaxed'),
    ('vis_E', 'viseme E (bed): lips spread, small opening'),
    ('vis_I', 'viseme I (see): lips wide, teeth near closed'),
    ('vis_O', 'viseme O (go): lips rounded, medium opening'),
    ('vis_U', 'viseme U (you): lips pursed forward'),
    ('vis_MBP', 'viseme M B P: lips pressed'),
    ('vis_FV', 'viseme F V: lower lip under the upper teeth line'),
    ('vis_L', 'viseme L / D / T / N: small opening, tongue tip up'),
    ('vis_SS', 'viseme S / Z / CH: teeth together, lips apart'),
    ('blink_L', 'upper lid closes over the left eye (pair: blink_R)'),
    ('blink_R', 'upper lid closes over the right eye'),
    ('browUp_L', 'brow ridge raised (pair: browUp_R)'),
    ('browUp_R', 'brow ridge raised'),
    ('browDown_L', 'brow ridge lowered and drawn in (pair: browDown_R)'),
    ('browDown_R', 'brow ridge lowered and drawn in'),
    ('smile_L', 'mouth corner up and back (pair: smile_R)'),
    ('smile_R', 'mouth corner up and back'),
    ('frown_L', 'mouth corner down (pair: frown_R)'),
    ('frown_R', 'mouth corner down'),
    ('squint_L', 'lower lid raised, cheek up (pair: squint_R)'),
    ('squint_R', 'lower lid raised, cheek up'),
    ('blinkUpper_L', 'Ixari: the upper (second) eye closes (pair: blinkUpper_R); no effect on the other peoples'),
    ('blinkUpper_R', 'Ixari: the upper (second) eye closes'),
    ('nictitate_L', 'Thalune: the translucent second lid sweeps across the left eye (pair: nictitate_R); no effect on the others'),
    ('nictitate_R', 'Thalune: the translucent second lid sweeps across the right eye'),
    ('moodFlare', 'the people\'s mood display: Thalune gill-frills flare, Ixari secondary eyes widen, Ulgani spore-fronds rise'),
]


def doc_text(people):
    bs = bones(people)
    lines = [
        'SHARED HUMANOID SKELETON  (P1.E05.T01; DESIGN 19.2, art bible 1 and 8)',
        '',
        'One skeleton for the three peoples, crews and city NPCs: identical bone names, hierarchy and roll convention in',
        'thalune.blend, ixari.blend and ulgani.blend.  Rest pose = A-pose, facing -Y (glTF +Z), +Z up (glTF +Y), left = +X.',
        'Canonical rest height 1.85 m (the art bible biped, eye height 1.70 m).  Per people only lengths differ',
        '(multipliers on bone lengths and joint widths, then a uniform scale within +-6%; Ixari fingers are the same',
        'bones, ~1.4x longer).  Roll: each bone\'s local Y runs head->tail, local Z points to the front (-Y) for the',
        'torso, legs and arms, to the back of the hand for hand and fingers, and up for jaw, eyes, lids and feet, so',
        'flexion is a rotation about local X everywhere.  _R bones mirror _L bones (rolls mirrored).',
        '',
        f'This file: {people}  (uniform scale {PEOPLE[people]["scale"]}, dz {PEOPLE[people].get("dz", 0.0):+.3f} m).',
        '',
        'BONES (name  parent  deform  head  tail, metres):',
    ]
    for n in order(bs):
        b = bs[n]
        h = ', '.join(f'{x:+.3f}' for x in b['head'])
        t = ', '.join(f'{x:+.3f}' for x in b['tail'])
        lines.append(f'  {n:<18} {str(b["parent"]):<16} {"D" if b["deform"] else "-"}  ({h})  ({t})')
    lines += [
        '',
        'Groups: root; pelvis; spine_01..03; neck_01..02; head; jaw; eye_L/R (main eyes); eye_upper_L/R (Ixari second',
        'pair of eyes, unweighted on the others); lid_upper_L/R, lid_lower_L/R (lids rotate about the eye centre);',
        'lid_nict_L/R (Thalune second lid, the nictitating membrane; unweighted on the others); clavicle; upperarm,',
        'upperarm_twist (shoulder half of the upper arm); lowerarm, lowerarm_twist (wrist half of the forearm, carries',
        'the forearm roll); hand; thumb_01..03, index_01..03, middle_01..03, ring_01..03 (all three peoples have a thumb',
        'and three fingers); thigh; calf; foot; ball (toes).',
        'crest_01..03: a secondary-motion chain from the crown up and back through the crest (Ulgani spore-fronds,',
        'Thalune crest fins; unweighted on Ixari, whose crown crystal is rigid on the head).',
        'Sockets (non-deforming): socket_hand_L/R (tool grip, +Y along the grip axis), socket_head (crest / helmet',
        'attach point at the crown).',
        'Rest pose stands on the ground: each people is shifted in Z so its soles touch z = 0 (dz below).',
        '',
        'BLENDSHAPES (shape keys on every head mesh at LOD0, same names on all three peoples; LOD1-3 carry none):',
    ]
    for n, d in BLENDSHAPES:
        lines.append(f'  {n:<12} {d}')
    lines += [
        '',
        'Meshes: <P>_Body_* (body, split by suit coverage), <P>_Head<n>_* (head variant n, with eyes and mouth), <P>_Suit<n>_*',
        '(suit set n).  Variants: <people>_head1..6 (unsuited body + head n), <people>_suit1..4 (head 1 + suit n).',
    ]
    return '\n'.join(lines) + '\n'
