"""Analytic skin weights for the shared skeleton: chain-parameter blends at every joint, twist splits, shoulder and hip
blends, per-finger chains, then smoothing over the mesh and a four-influence limit (glTF JOINTS_0)."""
import numpy as np

from . import mesh as M
from .cage import PARTS


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def seg_param(P, a, b):
    """Parameter of the closest point on segment ab (unclamped) and distance to the clamped point."""
    ab = b - a
    L2 = float(ab @ ab)
    t = ((P - a) @ ab) / L2
    q = a + np.clip(t, 0, 1)[:, None] * ab
    return t, np.linalg.norm(P - q, axis=1)


def chain(P, bs, names, widths):
    """Weights for points along a chain of bones (head->tail of each, consecutive).  widths[i] = half-width (m) of
    the blend at the joint between names[i] and names[i+1].  Returns dict name -> weight."""
    n = len(names)
    # distance along the chain: project on each segment, pick the closest segment, compute arc position
    heads = [bs[x]['head'] for x in names]
    tails = [bs[x]['tail'] for x in names]
    lens = [np.linalg.norm(t - h) for h, t in zip(heads, tails)]
    best = np.full(len(P), np.inf)
    arc = np.zeros(len(P))
    start = 0.0
    for i in range(n):
        t, d = seg_param(P, heads[i], tails[i])
        tt = t if i in (0, n - 1) else np.clip(t, 0, 1)
        if i == 0:
            tt = np.minimum(t, 1.0)
        if i == n - 1:
            tt = np.maximum(t, 0.0)
        better = d < best - 1e-9
        best = np.where(better, d, best)
        arc = np.where(better, start + tt * lens[i], arc)
        start += lens[i]
    out = {}
    joints = np.cumsum(lens)[:-1]
    prev = np.ones(len(P))
    for i in range(n):
        if i < n - 1:
            w = widths[i]
            nxt = smooth01(joints[i] - w, joints[i] + w, arc)
        else:
            nxt = np.zeros(len(P))
        out[names[i]] = prev * (1 - nxt) if i < n - 1 else prev
        prev = prev * nxt if i < n - 1 else prev
    return out


def _add(W, name, vals, mask=None):
    if mask is not None:
        vals = np.where(mask, vals, 0.0)
    W[name] = W.get(name, 0.0) + vals


def body(me, bs, s=1.0, people='canon'):
    """Weights for the body mesh (cage attributes part/side interpolated by subdivision)."""
    P = M.coords(me)
    part = np.rint(M.attr(me, 'part'))
    side = M.attr(me, 'side')
    N = len(P)
    W = {}
    x = P[:, 0]
    # ---------------- torso: spine chain by height, with hips (thigh) and shoulders (clavicle, upperarm)
    tor = part == PARTS['torso']
    # (the neck's bend spread over neck_01 and the top of spine_03, so a bowed head keeps a neck under it)
    spine = chain(P, bs, ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01'], [0.035 * s, 0.045 * s, 0.05 * s, 0.06 * s])
    for side_sfx, sg in (('_L', 1.0), ('_R', -1.0)):
        on = (x * sg) > 0
        # shoulder: upper arm and clavicle
        S = bs['upperarm' + side_sfx]['head']
        ad = bs['upperarm' + side_sfx]['tail'] - S
        ad /= np.linalg.norm(ad)
        ta = (P - S) @ ad
        perp = np.linalg.norm((P - S) - np.outer(ta, ad), axis=1)
        u = smooth01(-0.045 * s, 0.045 * s, ta) * on * np.exp(-(perp / (0.11 * s)) ** 4)
        ch, ct = bs['clavicle' + side_sfx]['head'], bs['clavicle' + side_sfx]['tail']
        tc, dc = seg_param(P, ch, ct)
        z3 = bs['spine_03']['head'][2]
        zmask = smooth01(z3 + 0.04 * s, z3 + 0.1 * s, P[:, 2])
        cf = np.exp(-(dc / (0.05 * s)) ** 2) * smooth01(0.0, 0.5, tc) * on * zmask
        cf = np.clip(cf * 0.9, 0, 1) * (1 - u)
        # hip: thigh
        H = bs['thigh' + side_sfx]['head']
        td = bs['thigh' + side_sfx]['tail'] - H
        td /= np.linalg.norm(td)
        tt = (P - H) @ td
        lat = np.abs(x) > 0.02 * s
        h = smooth01(-0.05 * s, 0.07 * s, tt) * on * smooth01(0.0, 0.05 * s, np.abs(x))
        for name, w in spine.items():
            _add(W, name, w * (1 - u - cf) * (1 - h) * on, tor)
        _add(W, 'clavicle' + side_sfx, cf, tor)
        _add(W, 'upperarm' + side_sfx, u, tor)
        _add(W, 'thigh' + side_sfx, h * (1 - u - cf), tor)
    # centre line (x == 0 exactly): give both halves' spine weight once
    mid = tor & (np.abs(x) < 1e-6)
    for name, w in spine.items():
        _add(W, name, w, mid)
    # ---------------- limbs
    for side_sfx, sg in (('_L', 1.0), ('_R', -1.0)):
        sd = side * sg > 0
        arm = sd & (part == PARTS['arm'])
        a = chain(P, bs, ['clavicle' + side_sfx, 'upperarm' + side_sfx, 'lowerarm' + side_sfx, 'hand' + side_sfx],
                  [0.03 * s, 0.035 * s, 0.022 * s])
        for name, w in a.items():
            _add(W, name, w, arm)
        hand = sd & (part == PARTS['hand'])
        hw = chain(P, bs, ['lowerarm' + side_sfx, 'hand' + side_sfx], [0.018 * s])
        for name, w in hw.items():
            _add(W, name, w, hand)
        fing = sd & ((part == PARTS['finger']) | (part == PARTS['thumb']))
        if fing.any():
            idx = np.nonzero(fing)[0]
            Q = P[idx]
            best = np.full(len(idx), np.inf)
            pick = np.zeros(len(idx), int)
            fnames = ['thumb', 'index', 'middle', 'ring']
            for fi, f in enumerate(fnames):
                d = np.min(np.stack([seg_param(Q, bs[f'{f}_0{k}{side_sfx}']['head'], bs[f'{f}_0{k}{side_sfx}']['tail'])[1] for k in (1, 2, 3)]), 0)
                better = d < best
                best = np.where(better, d, best)
                pick = np.where(better, fi, pick)
            for fi, f in enumerate(fnames):
                sel = pick == fi
                if not sel.any():
                    continue
                names = ['hand' + side_sfx] + [f'{f}_0{k}{side_sfx}' for k in (1, 2, 3)]
                ww = chain(Q[sel], bs, names, [0.012 * s, 0.007 * s, 0.006 * s])
                for name, w in ww.items():
                    full = np.zeros(N)
                    full[idx[sel]] = w
                    _add(W, name, full)
        leg = sd & (part == PARTS['leg'])
        lg = chain(P, bs, ['pelvis', 'thigh' + side_sfx, 'calf' + side_sfx, 'foot' + side_sfx], [0.07 * s, 0.045 * s, 0.03 * s])
        for name, w in lg.items():
            _add(W, name, w, leg)
        ft = sd & ((part == PARTS['foot']) | (part == PARTS['toe']))
        fw = chain(P, bs, ['calf' + side_sfx, 'foot' + side_sfx, 'ball' + side_sfx], [0.03 * s, 0.015 * s])
        for name, w in fw.items():
            _add(W, name, w, ft)
    # twist splits
    for side_sfx in ('_L', '_R'):
        ua = 'upperarm' + side_sfx
        la = 'lowerarm' + side_sfx
        if ua in W:
            t, _ = seg_param(P, bs[ua]['head'], bs[ua]['tail'])
            f = (1 - smooth01(0.0, 0.55, t)) * 0.5
            w = np.asarray(W[ua]) * f
            W[ua] = W[ua] - w
            _add(W, 'upperarm_twist' + side_sfx, w)
        if la in W:
            t, _ = seg_param(P, bs[la]['head'], bs[la]['tail'])
            f = smooth01(0.25, 1.0, t) * 0.75
            w = np.asarray(W[la]) * f
            W[la] = W[la] - w
            _add(W, 'lowerarm_twist' + side_sfx, w)
    return finish(me, W)


def finish(me, W, smooth_iters=8, lam=0.5, keep=4, fixed=None):
    names = sorted(n for n, w in W.items() if np.ndim(w) and np.max(w) > 1e-4)
    N = len(me.vertices)
    A = np.stack([np.broadcast_to(np.asarray(W[n], float), (N,)) for n in names], 1)
    A = np.maximum(A, 0)
    off, nb = M.neighbours(me)
    deg = np.diff(off)
    rows = np.repeat(np.arange(N), deg)
    for _ in range(smooth_iters):
        S = np.zeros_like(A)
        np.add.at(S, rows, A[nb])
        avg = S / np.maximum(deg, 1)[:, None]
        B = A + lam * (avg - A)
        if fixed is not None:
            B[fixed] = A[fixed]
        A = B
    # keep the strongest four
    if A.shape[1] > keep:
        order = np.argsort(-A, axis=1)
        mask = np.zeros_like(A, bool)
        np.put_along_axis(mask, order[:, :keep], True, axis=1)
        A = np.where(mask, A, 0.0)
    A = np.where(A < 0.01, 0.0, A)
    tot = A.sum(1, keepdims=True)
    A = A / np.maximum(tot, 1e-9)
    return names, A


def apply(obj, names, A, rig):
    obj.vertex_groups.clear()
    for j, n in enumerate(names):
        g = obj.vertex_groups.new(name=n)
        col = A[:, j]
        nz = np.nonzero(col > 0)[0]
        for i in nz:
            g.add([int(i)], float(col[i]), 'REPLACE')
    md = obj.modifiers.get('Armature') or obj.modifiers.new('Armature', 'ARMATURE')
    md.object = rig
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()


def head(me, bs, s, eyes, mouth_z, seam=None):
    """Head weights: spine_03/neck/head by height, jaw below the mouth line, lids from the lid shell ('free'),
    eyeballs are separate.  seam = (positions, names, A) of the body's neck boundary: copied exactly and held."""
    P = M.coords(me)
    N = len(P)
    W = {}
    nh = chain(P, bs, ['spine_03', 'neck_01', 'neck_02', 'head'], [0.06 * s, 0.05 * s, 0.045 * s])
    free = M.attr(me, 'free') if 'free' in me.attributes else np.ones(N)
    jaw_attr = M.attr(me, 'jaw') if 'jaw' in me.attributes else np.zeros(N)
    # jaw: below the mouth line and in front of the hinge
    hinge = bs['jaw']['head']
    chin = bs['jaw']['tail']
    zc = mouth_z
    j = smooth01(zc + 0.003 * s, zc - 0.012 * s, P[:, 2]) * smooth01(hinge[1] + 0.01 * s, hinge[1] - 0.03 * s, P[:, 1])
    # fade into the throat under the chin
    j *= smooth01(chin[2] - 0.045 * s, chin[2] - 0.01 * s, P[:, 2])
    j = np.maximum(j, jaw_attr)
    j = np.clip(j, 0, 1)
    # lids
    lidw = {}
    from .head import _beta
    for e in eyes:
        E, n, u, v, r = e['E'], e['n'], e['u'], e['v'], e['r']
        rel = P - E
        d = np.linalg.norm(rel, axis=1)
        near = d < r + 0.016 * s
        beta = np.arccos(np.clip((rel @ n) / np.maximum(d, 1e-9), -1, 1))
        alpha = np.arctan2(rel @ v, rel @ u)
        bopen = np.array([_beta(a, e['spec']) for a in alpha])
        t = beta / np.maximum(bopen, 1e-3)
        w = np.where(near, smooth01(1.8, 1.04, t), 0.0)
        up = rel @ v
        k = smooth01(-0.002 * s, 0.002 * s, up)
        bone = 'lid_upper' if not e.get('upper') else 'eye_upper'
        side = '_L' if E[0] > 0 else '_R'
        if e.get('upper'):
            continue
        lidw['lid_upper' + side] = lidw.get('lid_upper' + side, 0) + w * k
        lidw['lid_lower' + side] = lidw.get('lid_lower' + side, 0) + w * (1 - k)
    lsum = sum(lidw.values()) if lidw else np.zeros(N)
    rest = (1 - lsum)
    for name, w in nh.items():
        if name == 'head':
            _add(W, 'head', w * (1 - j) * rest)
            _add(W, 'jaw', w * j * rest)
        else:
            _add(W, name, w * rest)
    for name, w in lidw.items():
        _add(W, name, w)
    fixed = None
    if seam is not None:
        sp, sn, sA = seam
        # nearest seam position for each head boundary vertex
        bnd = M.boundary_verts(me)
        dd = np.linalg.norm(P[bnd, None, :] - sp[None], axis=2)
        k = np.argmin(dd, axis=1)
        ok = dd[np.arange(len(bnd)), k] < 1e-4
        bnd, k = bnd[ok], k[ok]
        for name in list(W):
            W[name] = np.asarray(W[name], float) * 1.0
            W[name][bnd] = 0.0
        for j_, name in enumerate(sn):
            if name not in W:
                W[name] = np.zeros(N)
            W[name][bnd] = sA[k, j_]
        fixed = bnd
    return finish(me, W, fixed=fixed)


def copy_nearest(src, dst):
    """Gives dst the vertex-group weights of the nearest vertex of src (accessories grown from the skin)."""
    sco = M.coords(src.data)
    names = [g.name for g in src.vertex_groups]
    W = np.zeros((len(sco), len(names)))
    for v in src.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    dco = M.coords(dst.data)
    idx = nearest(sco, dco)
    A = W[idx]
    keep = A.max(0) > 0
    return [n for n, k in zip(names, keep) if k], A[:, keep]


def nearest(A, B, chunk=2048):
    """Index of the nearest point of A for every point of B."""
    out = np.empty(len(B), np.int64)
    A2 = (A * A).sum(1)
    for i in range(0, len(B), chunk):
        b = B[i:i + chunk]
        d = A2[None] - 2 * b @ A.T
        out[i:i + chunk] = np.argmin(d, axis=1)
    return out


def crest(me, bs, s, base_names, base_A, gv):
    """Spore-fronds: the root rides the head (its nearest-skin weights), the stalk hands over along its length to the
    crest chain (crest_01..03) so the crest sways as a secondary-motion chain."""
    N = len(gv)
    W = {n: base_A[:, j] * (1 - smooth01(0.04, 0.16, gv)) for j, n in enumerate(base_names)}
    t = smooth01(0.04, 0.16, gv)
    a = 1 - smooth01(0.3, 0.45, gv)
    b = smooth01(0.3, 0.45, gv) * (1 - smooth01(0.6, 0.75, gv))
    c = smooth01(0.6, 0.75, gv)
    W['crest_01'] = W.get('crest_01', 0) + t * a
    W['crest_02'] = W.get('crest_02', 0) + t * b
    W['crest_03'] = W.get('crest_03', 0) + t * c
    names = [n for n in W if np.max(W[n]) > 1e-4]
    A = np.stack([np.asarray(W[n], float) for n in names], 1)
    A = A / np.maximum(A.sum(1, keepdims=True), 1e-9)
    return names, A
