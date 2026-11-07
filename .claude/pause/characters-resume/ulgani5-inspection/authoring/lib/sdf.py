"""Signed-distance anatomy in numpy: primitives, smooth booleans, gradient and projection of mesh vertices onto the zero
set.  The sculpted form of a body or head is an SDF; the topology comes from a hand-designed cage that is subdivided
and projected onto it (a scripted 'shrinkwrap onto the sculpt' retopology)."""
import numpy as np

BIG = 1.0


def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


def basis(axis, hint=(0, 0, 1)):
    """Orthonormal (u, v, w) with v = axis and w as close to hint as possible."""
    v = nrm(axis)
    w = np.asarray(hint, dtype=np.float64)
    w = w - np.dot(w, v) * v
    if np.linalg.norm(w) < 1e-6:
        w = np.array([1.0, 0, 0]) - v[0] * v
    w = nrm(w)
    u = np.cross(v, w)
    return u, v, w


class Prim:
    lo = hi = None

    def bounds(self):
        return self.lo, self.hi


class RoundCone(Prim):
    """Capsule from a (radius ra) to b (radius rb), optionally with an elliptical section: `squash` scales the
    section along `side` (1 = round)."""

    def __init__(self, a, b, ra, rb, side=None, squash=1.0):
        self.a, self.b = np.asarray(a, float), np.asarray(b, float)
        self.ra, self.rb = float(ra), float(rb)
        self.side = None if side is None else nrm(side)
        self.squash = float(squash)
        r = max(ra, rb) * max(1.0, 1.0 / max(self.squash, 1e-3))
        self.lo = np.minimum(self.a, self.b) - r
        self.hi = np.maximum(self.a, self.b) + r

    def __call__(self, P):
        a, b, r1, r2 = self.a, self.b, self.ra, self.rb
        if self.side is not None and self.squash != 1.0:
            # squash the section along `side` around the axis
            ax = nrm(b - a)
            s = self.side - np.dot(self.side, ax) * ax
            s = nrm(s)
            d = P - a
            k = d @ s
            P = P + np.outer(k * (1.0 / self.squash - 1.0), s)
        ba = b - a
        l2 = np.dot(ba, ba)
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        pa = P - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - np.outer(y, ba)
        x2 = np.einsum('ij,ij->i', xv, xv)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        out = np.empty(len(P))
        c1 = np.sign(z) * a2 * z2 > k
        c2 = np.sign(y) * a2 * y2 < k
        out[:] = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
        out[c2] = np.sqrt(x2[c2] + y2[c2]) * il2 - r1
        out[c1] = np.sqrt(x2[c1] + z2[c1]) * il2 - r2
        if self.side is not None and self.squash != 1.0:
            out *= min(1.0, self.squash) ** 0.5
        return out


class Ellipsoid(Prim):
    def __init__(self, c, radii, axes=None):
        self.c = np.asarray(c, float)
        self.r = np.asarray(radii, float)
        self.R = np.eye(3) if axes is None else np.asarray(axes, float)  # rows = local axes in world
        m = self.r.max()
        self.lo, self.hi = self.c - m, self.c + m

    def __call__(self, P):
        q = (P - self.c) @ self.R.T
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class Box(Prim):
    def __init__(self, c, half, axes=None, round=0.0):
        self.c = np.asarray(c, float)
        self.h = np.asarray(half, float)
        self.R = np.eye(3) if axes is None else np.asarray(axes, float)
        self.round = round
        m = np.linalg.norm(self.h) + round
        self.lo, self.hi = self.c - m, self.c + m

    def __call__(self, P):
        q = np.abs((P - self.c) @ self.R.T) - (self.h - self.round)
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - self.round


class Plane(Prim):
    """Half-space: negative below the plane through c with outward normal n (bounded by a box for culling)."""

    def __init__(self, c, n, lo, hi):
        self.c, self.n = np.asarray(c, float), nrm(n)
        self.lo, self.hi = np.asarray(lo, float), np.asarray(hi, float)

    def __call__(self, P):
        return (P - self.c) @ self.n


class Fn(Prim):
    """Any callable with explicit bounds."""

    def __init__(self, f, lo, hi):
        self.f = f
        self.lo, self.hi = np.asarray(lo, float), np.asarray(hi, float)

    def __call__(self, P):
        return self.f(P)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * h * k / 6.0


def smax(a, b, k):
    return -smin(-a, -b, k)


class SDF:
    """Ordered list of smooth booleans.  Each primitive is evaluated only inside its bounds (plus blend and band),
    so a body with hundreds of parts stays fast; distances are clamped to +-BIG."""

    def __init__(self, band=0.05):
        self.ops = []
        self.band = band

    def add(self, prim, k=0.0, tag=None):
        self.ops.append(('u', prim, k, tag))
        return prim

    def sub(self, prim, k=0.0, tag=None):
        self.ops.append(('s', prim, k, tag))
        return prim

    def inter(self, prim, k=0.0, tag=None):
        self.ops.append(('i', prim, k, tag))
        return prim

    SPLIT = ('leg', 'foot')

    def subset(self, tags):
        out = SDF(self.band)
        tags = list(tags) + [t + '_R' for t in tags if t in self.SPLIT]
        out.ops = [op for op in self.ops if op[3] in tags]
        return out

    def __call__(self, P, upto=None):
        right = [op for op in self.ops if op[3] and str(op[3]).endswith('_R')]
        if not right or upto is not None:
            return self._eval(P, self.ops, upto)
        left_tags = {op[3][:-2] for op in right}
        a = [op for op in self.ops if not (op[3] and str(op[3]).endswith('_R'))]
        b = [op for op in self.ops if op[3] not in left_tags]
        return np.minimum(self._eval(P, a), self._eval(P, b))

    def _eval(self, P, ops, upto=None):
        P = np.asarray(P, float)
        d = np.full(len(P), BIG)
        for i, (op, prim, k, tag) in enumerate(ops):
            if upto is not None and i >= upto:
                break
            m = k + self.band
            lo, hi = prim.lo - m, prim.hi + m
            if op == 'i':
                idx = np.arange(len(P))
            else:
                idx = np.nonzero(np.all((P >= lo) & (P <= hi), axis=1))[0]
            if not len(idx):
                if op == 'i':
                    d[:] = BIG
                continue
            v = prim(P[idx])
            if op == 'u':
                d[idx] = smin(d[idx], v, k)
            elif op == 's':
                d[idx] = smax(d[idx], -v, k)
            else:
                d[idx] = smax(d[idx], v, k)
        return np.clip(d, -BIG, BIG)

    def grad(self, P, eps=4e-4):
        P = np.asarray(P, float)
        g = np.zeros_like(P)
        for i in range(3):
            e = np.zeros(3)
            e[i] = eps
            g[:, i] = (self(P + e) - self(P - e)) / (2 * eps)
        return g

    def project(self, P, iters=8, max_step=0.02, mask=None):
        """Moves points onto the zero set along the gradient (Newton steps, clamped)."""
        P = np.array(P, float)
        idx = np.arange(len(P)) if mask is None else np.nonzero(mask)[0]
        for _ in range(iters):
            Q = P[idx]
            d = self(Q)
            g = self.grad(Q)
            gl2 = np.einsum('ij,ij->i', g, g)
            step = np.clip(d / np.maximum(gl2, 1e-6), -max_step, max_step)
            P[idx] = Q - g * step[:, None]
        return P
