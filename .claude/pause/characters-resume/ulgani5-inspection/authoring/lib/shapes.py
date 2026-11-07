"""Facial blendshapes for the dialogue bar (skel.BLENDSHAPES), generated from the head's own landmarks: the jaw hinge
and jaw weights, the mouth line, the eye frames and lid shells, and the accessories' flare fields.  The same field
definitions run on every head of every people, so the names and the motion read the same everywhere."""
import math

import numpy as np

from . import mesh as M
from .weights import smooth01


def _rot(P, piv, axis, ang):
    axis = axis / np.linalg.norm(axis)
    v = P - piv
    c, s = np.cos(ang)[:, None], np.sin(ang)[:, None]
    cr = np.cross(axis, v)
    dot = (v @ axis)[:, None]
    return piv + v * c + cr * s + axis * dot * (1 - c)


def build(obj, ctx, info):
    """info: dict(jaw_w (per-vertex), lid_up_w, lid_lo_w (per eye side dict), eyes (frames), zc, w (mouth half
    width), M (mouth front point), flare (per-vertex displacement or None), s)."""
    me = obj.data
    P0 = M.coords(me)
    s = info['s']
    zc = info['zc']
    hw = info['w']
    Mf = info['M']
    jw = info['jaw_w']
    hinge = ctx.bs['jaw']['head']
    xax = np.array([1.0, 0, 0])
    if me.shape_keys is None:
        obj.shape_key_add(name='Basis', from_mix=False)
    keys = {}

    # ---- mouth regions
    rel = P0 - Mf
    dx, dy, dz = rel[:, 0], rel[:, 1], P0[:, 2] - zc
    near_mouth = np.exp(-((np.abs(dx) / (hw * 1.25)) ** 4)) * np.exp(-((dz / (0.035 * s)) ** 2)) * smooth01(0.06 * s, 0.0, dy)
    upper = smooth01(-0.0015 * s, 0.0025 * s, dz) * near_mouth
    lower = smooth01(0.0015 * s, -0.0025 * s, dz) * near_mouth
    lipband = np.exp(-((dz / (0.012 * s)) ** 2)) * near_mouth
    def corner(sign):
        c = Mf + np.array([sign * hw, 0.012 * s, 0.0])
        c[2] = zc
        d = np.linalg.norm(P0 - c, axis=1)
        return np.exp(-(d / (0.022 * s)) ** 2) * smooth01(0.07 * s, 0.0, dy)

    def jaw(t):
        return _rot(P0, hinge, xax, np.radians(17.0) * t * jw) - P0

    def spread(k):  # lips widen (k > 0) or purse (k < 0) toward the centre line
        return np.stack([dx * k * lipband, np.zeros_like(dx), np.zeros_like(dx)], 1)

    def protrude(m):
        return np.stack([np.zeros_like(dx), -np.ones_like(dx) * m * s * lipband, np.zeros_like(dx)], 1)

    def lift(up_m, lo_m):
        return np.stack([np.zeros_like(dx), np.zeros_like(dx), up_m * s * upper + lo_m * s * lower], 1)

    keys['jawOpen'] = jaw(1.0)
    keys['vis_AA'] = jaw(0.8) + spread(-0.05) + lift(0.0015, 0)
    keys['vis_E'] = jaw(0.3) + spread(0.14) + lift(0.0015, -0.0005)
    keys['vis_I'] = jaw(0.12) + spread(0.22) + lift(0.001, -0.001)
    keys['vis_O'] = jaw(0.5) + spread(-0.28) + protrude(0.004)
    keys['vis_U'] = jaw(0.22) + spread(-0.42) + protrude(0.007)
    keys['vis_MBP'] = lift(-0.0012, 0.0016) + spread(-0.04) + protrude(-0.001)
    keys['vis_FV'] = jaw(0.08) + np.stack([np.zeros_like(dx), 0.004 * s * lower, 0.0035 * s * lower], 1) + lift(0.001, 0)
    keys['vis_L'] = jaw(0.28) + spread(0.04)
    keys['vis_SS'] = jaw(0.05) + lift(0.0018, -0.0016) + spread(0.1)
    for sign, sfx in ((1, '_L'), (-1, '_R')):
        cw = corner(sign)
        keys['smile' + sfx] = np.stack([sign * 0.0035 * s * cw, 0.004 * s * cw, 0.0065 * s * cw], 1)
        keys['frown' + sfx] = np.stack([sign * 0.0012 * s * cw, 0.0012 * s * cw, -0.0062 * s * cw], 1)

    # ---- eyes: blink, squint, brows
    rigid = info.get('rigid', np.zeros(len(P0)))
    for e in info['eyes']:
        sfx = '_L' if e['E'][0] > 0 else '_R'
        E, n, u, v, r = e['E'], e['n'], e['u'], e['v'], e['r']
        # +angle about u closes an upper lid when it carries v toward the gaze n
        t = _rot((E + v)[None], E, u, np.array([0.1]))[0] - (E + v)
        cs = 1.0 if t @ n > 0 else -1.0
        up_w = info['lid_up'].get(sfx, np.zeros(len(P0)))
        lo_w = info['lid_lo'].get(sfx, np.zeros(len(P0)))
        if e.get('upper'):
            # Ixari's second pair: lid masks from the geometry round this eye (its lids ride the head bone), its own
            # blink (blinkUpper), widening in moodFlare
            from .head import _beta
            rel = P0 - E
            dd = np.linalg.norm(rel, axis=1)
            near = (dd < r + 0.012 * s) & (rigid < 0.5)
            beta = np.arccos(np.clip((rel @ n) / np.maximum(dd, 1e-9), -1, 1))
            alpha = np.arctan2(rel @ v, rel @ u)
            bopen = np.array([_beta(a, e['spec']) for a in alpha])
            w = np.where(near, smooth01(1.8, 1.04, beta / np.maximum(bopen, 1e-3)), 0.0)
            kk = smooth01(-0.0015 * s, 0.0015 * s, rel @ v)
            up_w, lo_w = w * kk, w * (1 - kk)
            close_up = np.radians(e['open_up'] + e['open_lo'] * 0.75)
            close_lo = np.radians(e['open_lo'] * 0.25)
            b = (_rot(P0, E, u, cs * close_up * up_w) - P0) + (_rot(P0, E, u, -cs * close_lo * lo_w) - P0)
            Pb = P0 + b
            relb = Pb - E
            dist = np.linalg.norm(relb, axis=1)
            moved = (up_w + lo_w) > 0.02
            newd = np.where(moved, np.maximum(dist, r * 1.065 + 0.45 * e['spec'].get('lid', 0.0025) * s), dist)
            b = np.where(moved[:, None], E + relb / np.maximum(dist, 1e-9)[:, None] * newd[:, None] - P0, b)
            keys['blinkUpper' + sfx] = keys.get('blinkUpper' + sfx, 0) + b
            keys['moodFlare'] = keys.get('moodFlare', 0) + (_rot(P0, E, u, -cs * np.radians(9) * up_w) - P0) + (_rot(P0, E, u, cs * np.radians(7) * lo_w) - P0)
            continue
        nw = info.get('nict', {}).get(sfx)
        if nw is not None and nw.max() > 0.5:
            # Thalune: the translucent second lid sweeps from the inner corner across the eye
            bh = np.radians(e['spec']['open'][0])
            test = E + n * r * np.cos(bh) - u * r * np.sin(bh)
            moved_t = _rot(test[None], E, v, np.array([0.3]))[0]
            sg = 1.0 if (moved_t - E) @ u > (test - E) @ u else -1.0
            # the membrane rests folded at the inner corner (the -u side as nictitating() lays it): sweep it across
            # the front of the eye toward the outer corner
            # it unfolds like a fan from its root deep in the inner corner: the free edge travels across to the outer
            # corner, the root stays (the angle of each vertex scales with its distance from the root)
            rel = P0 - E
            h = np.arctan2(-(rel @ u), rel @ n)
            h0, h1 = bh * 0.86, bh * 1.22
            f = np.clip((h1 - h) / (h1 - h0), 0.0, 1.0)
            keys['nictitate' + sfx] = _rot(P0, E, v, sg * (bh * 1.95) * f * nw) - P0
        open_up, open_lo = e['open_up'], e['open_lo']
        lid = e['spec'].get('lid', 0.0035) * s
        close_up = np.radians(open_up + open_lo * 0.88)
        close_lo = np.radians(open_lo * 0.12)
        # the upper lid comes down as an opaque fold of skin to the lower lid's line (the lower lid barely rises, so
        # the two do not crumple into each other); whatever moved is kept well outside the eyeball, so the closed lid
        # covers the eye instead of showing it through
        b = _rot(P0, E, u, cs * close_up * up_w) - P0
        b = b + (_rot(P0, E, u, -cs * close_lo * lo_w) - P0)
        Pb = P0 + b
        rel = Pb - E
        dist = np.linalg.norm(rel, axis=1)
        moved = (up_w + lo_w) > 0.02
        floor = r * 1.1 + 0.6 * lid
        newd = np.where(moved, np.maximum(dist, floor), dist)
        Pb = E + rel / np.maximum(dist, 1e-9)[:, None] * newd[:, None]
        b = np.where(moved[:, None], Pb - P0, b)
        keys['blink' + sfx] = keys.get('blink' + sfx, 0) + b
        sq = _rot(P0, E, u, -cs * np.radians(open_lo) * 0.45 * lo_w) - P0
        cheek = np.exp(-(np.linalg.norm(P0 - (E - v * r * 1.6), axis=1) / (0.02 * s)) ** 2)
        sq = sq + np.outer(cheek * 0.0025 * s, v)
        sq = sq + (_rot(P0, E, u, cs * np.radians(open_up) * 0.12 * up_w) - P0)
        keys['squint' + sfx] = sq
        # brow: the brow mass above the socket (and the upper lid fold with it, a little)
        bc = E + v * (r + 0.017 * s) + n * 0.004 * s
        db = np.linalg.norm(P0 - bc, axis=1)
        bw = np.exp(-(db / (0.021 * s)) ** 2) * (1 - up_w) + 0.35 * up_w * smooth01(0.6, 0.95, up_w) * 0
        fold = up_w * (1 - smooth01(0.7, 0.98, up_w))
        med = np.array([-np.sign(E[0]), 0, 0])
        # (about 6 mm of travel at the inner brow, which lifts and knits more than the outer end)
        inner = 1.0 + 0.5 * np.clip((P0[:, 0] - E[0]) * med[0] / (0.02 * s), -1.0, 1.0)
        bwi = bw * inner
        keys['browUp' + sfx] = np.outer(bwi * 0.0068 * s + fold * 0.0028 * s, np.array([0, 0, 1.0])) + np.outer(bwi * 0.0015 * s, n)
        keys['browDown' + sfx] = (np.outer(bwi * 0.0055 * s + fold * 0.0022 * s, np.array([0, 0, -1.0])) + np.outer(bwi * 0.0035 * s, med)
                                  + np.outer(bwi * 0.003 * s, n))
    # ---- mood display (accessories carry their own field)
    if info.get('flare') is not None:
        keys['moodFlare'] = keys.get('moodFlare', 0) + info['flare']
    from .skel import BLENDSHAPES
    for name, _ in BLENDSHAPES:
        d = keys.get(name)
        if d is None or np.ndim(d) == 0:
            d = np.zeros_like(P0)
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set('co', (P0 + d).ravel())
        kb.slider_min, kb.slider_max = 0.0, 1.0
        kb.value = 0.0
    for kb in me.shape_keys.key_blocks:
        if kb.name != 'Basis':
            kb.value = 0.0
    obj.active_shape_key_index = 0
    return [k.name for k in me.shape_keys.key_blocks]
