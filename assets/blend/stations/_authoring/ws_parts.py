"""Parts shared by the Waystation modules: the standard collar every socket of type `collar` carries."""
import math

import numpy as np
from mathutils import Matrix, Vector

import kit as K

COLLAR_R = 9.0
COLLAR_DEPTH = 2.5


def collar_mesh(lod):
    """The collar along +Y from y = 0 (the module's skin) to its mating face at y = COLLAR_DEPTH."""
    m = K.Mesh()
    n = (36, 24, 12, 8)[lod]
    if lod == 3:
        K.revolve(m, [(9.0, 0.0), (9.0, 2.5)], n, "WS_Shell", "accent", axis="y", smooth=True, away=lambda q: np.array([0.0, q[1], 0.0]))
        K.revolve(m, [(9.0, 2.5), (6.8, 2.5)], n, "WS_Shell", "lip", axis="y", smooth=False, toward=lambda q: q + np.array([0, 1.0, 0]))
        return m
    prof = [(9.0, 0.0), (9.0, 1.6), (8.4, 1.9), (8.4, 2.5), (6.8, 2.5), (6.8, 1.0), (6.2, 0.6)]
    keys = [("WS_Shell", "accent"), ("WS_Shell", "signal"), ("WS_Shell", "lip"), ("WS_Shell", "lip"), ("WS_Metal", "trim"), ("WS_Metal", "trim")]
    axis_pt = lambda q: np.array([0.0, q[1], 0.0])
    for i in range(len(prof) - 1):
        mat, key = keys[i]
        if i < 3:
            K.revolve(m, [prof[i], prof[i + 1]], n, mat, key, axis="y", smooth=True, away=axis_pt)
        elif i == 3:
            K.revolve(m, [prof[i], prof[i + 1]], n, mat, key, axis="y", smooth=False, toward=lambda q: q + np.array([0, 1.0, 0]))
        else:
            K.revolve(m, [prof[i], prof[i + 1]], n, mat, key, axis="y", smooth=True, toward=axis_pt)
    if lod <= 1:
        for k in range(12):
            a = k * math.pi / 6
            xf = Matrix.Rotation(-a, 4, "Y") @ Matrix.Translation((8.7, 0, 0))
            K.box(m, (-0.45, 0.2, -0.5), (0.45, 2.2, 0.5), "WS_Metal", "machine", xf=xf)
    return m


def place(m, part, origin, direction, up=(0, 0, 1)):
    """Places a part built along +Y so its +Y points along `direction` at `origin`."""
    d = Vector(direction).normalized()
    u = Vector(up)
    if abs(d.dot(u)) > 0.99:
        u = Vector((1, 0, 0))
    x = d.cross(u).normalized()
    z = x.cross(d).normalized()
    R = Matrix(((x[0], d[0], z[0], origin[0]), (x[1], d[1], z[1], origin[1]), (x[2], d[2], z[2], origin[2]), (0, 0, 0, 1)))
    m.extend(part, R)
    return R


def socket_rotation(direction):
    """Euler rotation turning an empty's +Y to `direction` (Z kept up where possible)."""
    d = Vector(direction).normalized()
    q = d.to_track_quat("Y", "Z")
    return q.to_euler()
