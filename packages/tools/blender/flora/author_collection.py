"""T05 initial authoring only. Saved .blend files are edited/refined independently thereafter.

Never imported by an export. Closed lofted leaves, rachises, growth rings and fracture
surfaces are authored here; no demo geometry or external assets are used.
"""

import argparse
import hashlib
import itertools
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "assets/blend/flora"
EVIDENCE = ROOT / "assets/renders/flora/t05"
TAU = math.tau
UP = Vector((0, 0, 1))
LIB_HASH = "33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c"


def linear(h):
    x = np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


class Sculpt:
    def __init__(self):
        self.v, self.f, self.uv, self.mask, self.smooth = [], [], [], [], []

    def vertex(self, p, uv, region, shade=1):
        self.v.append(tuple(p))
        col, row = region % 2, region // 2
        self.uv.append(
            ((col + 0.025 + 0.95 * uv[0]) / 2, (row + 0.025 + 0.95 * uv[1]) / 2)
        )
        weights = (
            (0.91, 0.09, 0),
            (0.12, 0.88, 0),
            (0.12, 0.08, 0.8),
            (0.56, 0.44, 0),
        )[region]
        self.mask.append((*weights, shade))
        return len(self.v) - 1

    def face(self, vs, smooth=True):
        if len(vs) == 4:
            self.f.extend([(vs[0], vs[1], vs[2]), (vs[0], vs[2], vs[3])])
            self.smooth.extend([smooth, smooth])
        else:
            self.f.append(tuple(vs))
            self.smooth.append(smooth)

    def loft(self, rings, region=0, smooth=True, caps=True):
        ids = []
        for i, ring in enumerate(rings):
            ids.append(
                [
                    self.vertex(p, (j / (len(ring) - 1), i / (len(rings) - 1)), region)
                    for j, p in enumerate(ring)
                ]
            )
        for a, b in itertools.pairwise(ids):
            for j in range(len(a)):
                k = (j + 1) % len(a)
                self.face((a[j], a[k], b[k], b[j]), smooth)
        if caps:
            for index, flip in ((0, True), (-1, False)):
                ring = rings[index]
                mid = sum((Vector(p) for p in ring), Vector()) / len(ring)
                c = self.vertex(mid, (0.5, 0 if flip else 1), region)
                for j in range(len(ring)):
                    a, b = ids[index][j], ids[index][(j + 1) % len(ring)]
                    self.face((c, b, a) if flip else (c, a, b), smooth)

    def stem(self, points, radius, region=1, sides=6):
        ps = [Vector(p) for p in points]
        rings = []
        for i, p in enumerate(ps):
            d = ps[min(i + 1, len(ps) - 1)] - ps[max(i - 1, 0)]
            q = d.normalized().to_track_quat("Z", "Y")
            r = radius * (1 - 0.7 * i / (len(ps) - 1))
            rings.append(
                [
                    p
                    + q
                    @ Vector(
                        (
                            r * math.cos(j * TAU / sides),
                            r * math.sin(j * TAU / sides),
                            0,
                        )
                    )
                    for j in range(sides)
                ]
            )
        self.loft(rings, region)

    def leaf(self, start, end, width, arch=0.12, curl=0, region=0, steps=8, fold=0.18):
        a, b = Vector(start), Vector(end)
        d = b - a
        side = d.cross(UP).normalized()
        if side.length < 0.01:
            side = Vector((1, 0, 0))
        rings = []
        for i in range(steps + 1):
            t = i / steps
            center = a + d * t + UP * (arch * math.sin(math.pi * t) - curl * t**4)
            w = width * (math.sin(math.pi * t) ** 0.72 * (1 - 0.24 * t) + 0.012)
            center += side * (0.07 * width * math.sin(9 * t) * t)
            rib = w * fold
            thick = max(0.002, width * 0.024 * (1 - t))
            rings.append(
                [
                    center - side * w,
                    center + UP * (rib + thick),
                    center + side * w,
                    center - UP * thick,
                ]
            )
        self.loft(rings, region)

    def pod(self, center, scale, region=2, ribs=7, phase=0):
        c, s = Vector(center), Vector(scale)
        rings = []
        for i in range(11):
            t = i / 10
            rad = 0.025 + math.sin(math.pi * t) ** 0.62 * (0.78 + 0.22 * t)
            rings.append(
                [
                    c
                    + Vector(
                        (
                            s.x
                            * rad
                            * (1 + 0.13 * math.cos(ribs * j * TAU / 28))
                            * math.cos(j * TAU / 28 + phase),
                            s.y
                            * rad
                            * (1 + 0.13 * math.cos(ribs * j * TAU / 28))
                            * math.sin(j * TAU / 28 + phase),
                            s.z * (t - 0.5),
                        )
                    )
                    for j in range(28)
                ]
            )
        self.loft(rings, region)

    def fracture(self, center, size, variant, region=0, sides=22, rows=9):
        c, s = Vector(center), Vector(size)
        rings = []
        for i in range(rows):
            t = i / (rows - 1)
            envelope = (0.65 + 0.35 * math.sin(math.pi * t)) * (1 - 0.44 * t**3)
            ring = []
            for j in range(sides):
                a = j * TAU / sides
                radial = envelope * (
                    1
                    + 0.12 * math.sin(3 * a + 0.8 * variant)
                    + 0.065 * math.cos(7 * a - variant)
                    + 0.035 * math.sin(5 * a + 9 * t)
                )
                ledge = 0.045 * math.sin(
                    t * 5 * math.pi + 0.65 * math.cos(a * 2 + variant)
                )
                x = s.x * radial * math.cos(a) + 0.14 * s.x * t * t * math.sin(
                    variant + 1
                )
                y = s.y * radial * math.sin(a)
                z = s.z * (
                    t + 0.09 * math.sin(2 * a + variant) * math.sin(math.pi * t) + ledge
                )
                ring.append(c + Vector((x, y, z)))
            rings.append(ring)
        self.loft(rings, region, False)

    def crystal(self, base, direction, length, radius, region=2, sides=6, blunt=False):
        b = Vector(base)
        q = Vector(direction).normalized().to_track_quat("Z", "Y")
        profiles = [
            (0, 0.95),
            (0.08, 1),
            (0.43, 0.92),
            (0.73, 0.91),
            (0.84, 0.82),
            (1, 0.31 if blunt else 0.025),
        ]
        rings = []
        for t, r in profiles:
            rings.append(
                [
                    b
                    + q
                    @ Vector(
                        (
                            radius
                            * r
                            * (1 + 0.08 * math.sin(j * 2.1))
                            * math.cos(j * TAU / sides),
                            radius * r * math.sin(j * TAU / sides),
                            t * length + 0.03 * length * math.sin(j * 1.7) * t,
                        )
                    )
                    for j in range(sides)
                ]
            )
        self.loft(rings, region, False)


def plant_geometry(kind, variant):
    s = Sculpt()
    if kind == "bush":
        # Three architectural habits: layered thicket, dryland rosette, open candelabra shrub.
        if variant == 1:
            for k in range(24):
                a = k * 2.39996
                h = 0.38 + 0.047 * (k % 7)
                r = 0.8 if k < 14 else 0.46
                s.leaf(
                    (0, 0, 0.02),
                    (r * math.cos(a), r * math.sin(a), h),
                    0.17 if k < 14 else 0.12,
                    0.28,
                    0.12,
                )
            s.stem([(0, 0, 0), (0.04, 0, 0.55), (0.1, 0.03, 1.05)], 0.05)
            for k in range(5):
                a = k * 2.4
                s.pod(
                    (0.1 + 0.07 * math.cos(a), 0.07 * math.sin(a), 0.73 + k * 0.07),
                    (0.055, 0.055, 0.13),
                    2,
                    ribs=5,
                )
        else:
            arms = 5 if variant == 0 else 7
            for k in range(arms):
                a = k * TAU / arms + 0.14 * math.sin(k * 3)
                h = (
                    0.8 + 0.13 * math.sin(k * 1.7)
                    if variant == 0
                    else 1.05 + 0.22 * math.sin(k * 2)
                )
                d = Vector((math.cos(a), math.sin(a), 0))
                pts = [
                    Vector((0, 0, 0.01)),
                    d * 0.14 + UP * h * 0.35,
                    d * 0.37 + UP * h * 0.72,
                    d * 0.51 + UP * h,
                ]
                s.stem(pts, 0.055)
                for j in range(10 if variant == 0 else 7):
                    t = 0.28 + j * 0.065
                    start = d * (0.51 * t) + UP * (h * t)
                    az = a + (1 if j % 2 else -1) * (1.1 + j * 0.11)
                    end = start + Vector(
                        (
                            math.cos(az) * 0.34,
                            math.sin(az) * 0.34,
                            0.19 if j % 3 else 0.3,
                        )
                    )
                    s.leaf(start, end, 0.105 if variant == 0 else 0.075, 0.08, 0, 0, 6)
                if variant == 2:
                    head = pts[-1]
                    for j in range(5):
                        a2 = j * TAU / 5
                        s.leaf(
                            head,
                            head
                            + Vector((0.16 * math.cos(a2), 0.16 * math.sin(a2), 0.07)),
                            0.065,
                            0.055,
                            0.025,
                            2,
                            5,
                        )
    elif kind == "fern":
        for k in range(7 if variant == 0 else 6):
            az = k * 2.39996
            d = Vector((math.cos(az), math.sin(az), 0))
            side = Vector((-d.y, d.x, 0))
            length = 0.88 + 0.2 * math.sin(k * 1.7)
            pts = [
                d * (length * t * 0.88)
                + UP * (0.04 + length * (1.6 * t - 0.95 * t * t))
                for t in np.linspace(0, 1, 12)
            ]
            s.stem([Vector((0, 0, 0.01)), *pts], 0.025, 1, 5)
            if variant == 0:
                for j in range(1, 10):
                    t = j / 11
                    base = pts[j]
                    for sign in (-1, 1):
                        reach = 0.25 * math.sin(math.pi * t) ** 0.7
                        s.leaf(
                            base,
                            base + side * reach * sign + d * 0.1 + UP * 0.035,
                            0.045 * (1 - 0.45 * t),
                            0.045,
                            0.01,
                            0,
                            4,
                        )
            else:
                s.leaf(
                    (0, 0, 0.02), d * length + UP * 0.7, 0.16, 0.36, 0.29, 0, 18, 0.35
                )
        for k in range(2):
            pts = [Vector((k * 0.08, 0, 0)), Vector((k * 0.08, 0, 0.32))]
            pts += [
                Vector((k * 0.08 + 0.095 * math.cos(t), 0, 0.45 + 0.095 * math.sin(t)))
                for t in np.linspace(-math.pi / 2, math.pi * 1.45, 18)
            ]
            s.stem(pts, 0.018, 0, 5)
    elif kind == "grass":
        for k in range(23 if variant == 0 else 17):
            a = k * 2.39996
            r = 0.14 * math.sqrt(k / 23)
            p = Vector((r * math.cos(a), r * math.sin(a), 0.004))
            length = (0.43 if variant == 0 else 0.7) * (
                0.68 + 0.32 * math.sin(k * 1.31) ** 2
            )
            s.leaf(
                p,
                p + Vector((0.25 * math.cos(a), 0.25 * math.sin(a), length)),
                0.024 if variant == 0 else 0.045,
                0.09,
                0.11,
                0,
                7,
                0.35,
            )
        if variant == 1:
            for k in range(3):
                x, y = 0.07 * math.cos(k * 2.4), 0.07 * math.sin(k * 2.4)
                s.stem(
                    [(x, y, 0), (x + 0.04, y, 0.55), (x + 0.1, y, 0.88)], 0.009, 1, 5
                )
                for j in range(5):
                    s.leaf(
                        (x + 0.09, y, 0.66 + j * 0.035),
                        (x + 0.13, y + 0.04 * (1 if j % 2 else -1), 0.72 + j * 0.035),
                        0.018,
                        0.02,
                        0,
                        3,
                        4,
                    )
    elif kind == "plant":
        if variant == 0:
            for k in range(13):
                a = k * 2.39996
                s.leaf(
                    (0, 0, 0.01),
                    (0.62 * math.cos(a), 0.62 * math.sin(a), 0.22 + 0.04 * (k % 3)),
                    0.23,
                    0.2,
                    0.04,
                    0,
                    10,
                    0.3,
                )
            for k in range(3):
                s.pod(
                    (0.09 * math.cos(k * 2), 0.09 * math.sin(k * 2), 0.32 + k * 0.12),
                    (0.06, 0.06, 0.24),
                    1,
                    5,
                )
        else:
            for k in range(8):
                a = k * 2.39996
                d = Vector((math.cos(a), math.sin(a), 0))
                pts = [
                    d * 0.06,
                    d * 0.17 + UP * 0.45,
                    d * 0.3 + UP * (0.75 + 0.07 * (k % 3)),
                ]
                s.stem(pts, 0.018)
                for j in range(3):
                    start = pts[1].lerp(pts[2], j * 0.28)
                    s.leaf(start, start + d * 0.3 + UP * 0.12, 0.13, 0.12, 0.07, 0, 8)
    elif kind in ("sodium", "oxygen"):
        h = 0.91 if variant == 0 else 1.16
        tip = Vector((0.12 if variant == 0 else -0.11, 0.04, h))
        s.stem(
            [(0, 0, 0.005), (-0.04, 0.01, h * 0.35), (0.02, 0.02, h * 0.72), tip], 0.034
        )
        for k in range(7):
            a = k * 2.39996
            base = Vector((0, 0, 0.015 + 0.075 * (k % 3)))
            s.leaf(
                base,
                base
                + Vector((0.45 * math.cos(a), 0.45 * math.sin(a), 0.19 + 0.04 * k)),
                0.13,
                0.14,
                0.08,
                0,
                8,
            )
        if kind == "sodium":
            s.pod(tip, (0.19, 0.17, 0.4), 2, 7)
            for k in range(7):
                a = k * TAU / 7
                s.leaf(
                    tip - UP * 0.18,
                    tip + Vector((0.21 * math.cos(a), 0.21 * math.sin(a), -0.08)),
                    0.06,
                    0.12,
                    0.02,
                    0,
                    6,
                )
            for k in range(2 if variant == 0 else 3):
                a = k * 2.1 + 0.8
                base = Vector((0, 0, h * 0.55))
                end = base + Vector((0.24 * math.cos(a), 0.24 * math.sin(a), 0.16))
                s.stem([base, end - UP * 0.06, end], 0.016)
                s.pod(end, (0.07, 0.065, 0.16), 2, 5)
        else:
            # A trumpet throat with overlapping, curled lobes; nectar confined to inner lip.
            rings = []
            for t in np.linspace(0, 1, 9):
                r = 0.035 + 0.19 * t * t
                rings.append(
                    [
                        tip
                        + Vector((r * math.cos(a), r * math.sin(a), -0.13 + 0.2 * t))
                        for a in np.linspace(0, TAU, 18, endpoint=False)
                    ]
                )
            s.loft(rings, 2)
            for k in range(6 if variant == 0 else 8):
                a = k * TAU / (6 if variant == 0 else 8)
                start = tip + Vector((0.12 * math.cos(a), 0.12 * math.sin(a), 0.01))
                end = tip + Vector((0.38 * math.cos(a), 0.38 * math.sin(a), 0.08))
                s.leaf(start, end, 0.16, 0.14, 0.1, 2, 9, 0.28)
            for k in range(5):
                a = k * TAU / 5
                s.stem(
                    [
                        tip,
                        tip + Vector((0.045 * math.cos(a), 0.045 * math.sin(a), 0.18)),
                    ],
                    0.009,
                    2,
                    5,
                )
    return s


def mineral_geometry(kind, variant):
    s = Sculpt()
    if kind in ("rock", "boulder"):
        dims = (
            [
                (0.57, 0.44, 0.36),
                (0.65, 0.32, 0.29),
                (0.42, 0.36, 0.56),
                (0.58, 0.5, 0.24),
            ]
            if kind == "rock"
            else [(1.25, 1.05, 1.25), (0.93, 0.72, 1.94), (1.37, 0.88, 0.91)]
        )
        dim = dims[variant]
        s.fracture((0, 0, 0), dim, variant, sides=28, rows=13)
        for j in range(3 if variant != 2 else 5):
            a = j * 2.4 + variant
            r = 0.72
            center = (dim[0] * r * math.cos(a), dim[1] * r * math.sin(a), 0)
            s.fracture(
                center, (dim[0] * 0.23, dim[1] * 0.25, dim[2] * 0.19), j + 3, 1, 14, 5
            )
    elif kind == "crystal":
        s.fracture((0, 0, 0), (0.69, 0.58, 0.22), variant, 1, 22, 8)
        for j in range((7, 11, 5)[variant]):
            a = j * 2.39996 + 0.3
            r = 0 if j == 0 else 0.15 + 0.045 * j
            h = (
                (1.9, 1.25, 1.65)[variant]
                if j == 0
                else (0.7 + 0.23 * math.sin(j * 3) ** 2) * (1.5 if variant == 2 else 1)
            )
            s.crystal(
                (r * math.cos(a), r * math.sin(a), 0.12),
                (r * math.cos(a) * 0.9, r * math.sin(a) * 0.9, 1),
                h,
                0.17 if variant != 2 else 0.26,
                0,
                6,
                variant == 2,
            )
            # Thin growth seams on two faces retain localized accent feedback.
            s.crystal(
                (r * math.cos(a) + 0.06, r * math.sin(a) - 0.03, 0.14),
                (r * math.cos(a), r * math.sin(a), 1),
                h * 0.86,
                0.021,
                2,
                4,
            )
    else:
        # Each ore has a separate geological habit, beyond a palette change.
        s.fracture(
            (0, 0, 0),
            (1.05, 0.79, 0.49 if variant == 0 else 0.64),
            variant + 2,
            0,
            28,
            10,
        )
        if kind == "copper":
            for j in range(7):
                a = j * 2.39996
                p = Vector((0.55 * math.cos(a), 0.4 * math.sin(a), 0.34 + 0.035 * j))
                s.stem(
                    [
                        p,
                        p + Vector((0.07, -0.02, 0.16)),
                        p + Vector((0.16, 0.04, 0.27)),
                    ],
                    0.045,
                    2,
                    7,
                )
                s.stem([p + UP * 0.08, p + Vector((-0.09, 0.08, 0.2))], 0.033, 2, 6)
        elif kind == "cobalt":
            for j in range(9):
                a = j * 2.39996
                s.crystal(
                    (0.53 * math.cos(a), 0.39 * math.sin(a), 0.3),
                    (math.cos(a) * 0.25, math.sin(a) * 0.25, 1),
                    0.3 + 0.13 * (j % 3),
                    0.12,
                    2,
                    4,
                    True,
                )
        elif kind == "gold":
            for j in range(8):
                a = j * 2.39996
                p = Vector(
                    (0.6 * math.cos(a), 0.43 * math.sin(a), 0.33 + 0.025 * (j % 4))
                )
                s.fracture(p, (0.16, 0.09, 0.08 + 0.04 * (j % 3)), j, 2, 14, 6)
                s.stem(
                    [p, p + Vector((0.12, 0.07, 0.1)), p + Vector((0.27, 0.08, 0.04))],
                    0.022,
                    2,
                    5,
                )
        elif kind == "dihydrogen":
            for j in range(8):
                a = j * 2.39996
                r = 0 if j == 0 else 0.17 + 0.055 * j
                s.crystal(
                    (r * math.cos(a), r * math.sin(a), 0.27),
                    (math.cos(a) * 0.23, math.sin(a) * 0.23, 1),
                    1.1 if j == 0 else 0.45 + 0.09 * (j % 4),
                    0.15,
                    2,
                    6,
                )
    return s


PALETTES = {
    "bush": ("2E8F84", "5B4636", "D9962B"),
    "fern": ("2E8F84", "1F4E5F", "EDE6D6"),
    "grass": ("2E8F84", "5B4636", "EDE6D6"),
    "plant": ("2E8F84", "5B4636", "EDE6D6"),
    "sodium": ("2E8F84", "5B4636", "D9962B"),
    "oxygen": ("2E8F84", "1F4E5F", "E07A5F"),
    "rock": ("4A4D52", "2A2C30", "E9DFC7"),
    "boulder": ("4A4D52", "2A2C30", "E9DFC7"),
    "crystal": ("7A4FD0", "3B4252", "B9A6FF"),
    "copper": ("4A4D52", "2A2C30", "AE704B"),
    "cobalt": ("4A4D52", "2A2C30", "566B8E"),
    "gold": ("4A4D52", "2A2C30", "BA9B54"),
    "dihydrogen": ("4A4D52", "2A2C30", "B39CDB"),
}
GLOW = {
    "sodium": 1.6,
    "oxygen": 1.4,
    "crystal": 0.8,
    "dihydrogen": 0.3,
    "copper": 0.035,
    "cobalt": 0.035,
    "gold": 0.025,
}


def material(kind):
    # Append T02 master; the asset's atlas is an independently editable local material.
    mineral = kind in (
        "rock",
        "boulder",
        "copper",
        "cobalt",
        "gold",
        "dihydrogen",
        "crystal",
    )
    master = (
        "LIB_GrownCrystal"
        if kind in ("crystal", "dihydrogen")
        else ("LIB_Basalt" if mineral else "LIB_Chitin")
    )
    with bpy.data.libraries.load(
        str(ROOT / "assets/blend/_library.blend"), link=False
    ) as (_src, dst):
        dst.materials = [master]
    m = dst.materials[0]
    m.name = "Flora_" + kind
    m["engine_name"] = m.name
    m["library_master"] = master
    m["library_sha256"] = LIB_HASH
    m["glow_accent"] = GLOW.get(kind, 0)
    m["palette_srgb"] = ",".join(PALETTES[kind])
    nt = m.node_tree
    nt.nodes.clear()
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    n = 1024
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    u = (xx % 512 + 0.5) / 512
    v = (yy % 512 + 0.5) / 512
    tile = (xx // 512 + 2 * (yy // 512)).astype(int)
    edge = np.minimum(u, 1 - u)
    if mineral:
        cracks = np.exp(-((np.sin(15 * u + 2 * np.sin(8 * v)) / 0.12) ** 2))
        strata = 0.5 + 0.5 * np.sin(31 * v + 3 * np.sin(4 * u))
        height = 0.018 * strata - 0.045 * cracks
        detail = 0.75 + 0.2 * strata - 0.15 * cracks
    else:
        mid = np.exp(-(((u - 0.5) / 0.025) ** 2))
        lateral = np.exp(-((np.sin(42 * v - 15 * np.abs(u - 0.5)) / 0.2) ** 2))
        edge_dry = np.exp(-edge * 32) * (0.5 + 0.5 * np.sin(v * 19) ** 2)
        height = 0.045 * mid + 0.008 * lateral - 0.018 * edge_dry
        detail = 0.72 + 0.18 * v + 0.07 * mid - 0.14 * edge_dry
    palettes = [linear(h) for h in PALETTES[kind]]
    palettes.append(palettes[0] * 0.72)
    base = np.array(palettes)[tile] * detail[:, :, None]
    rough = np.clip(
        (0.74 if mineral else 0.62)
        + 0.13 * (1 - detail)
        - 0.15 * (tile == 2)
        + 0.06 * np.sin(v * 11),
        0.24,
        0.94,
    )
    metal = np.zeros_like(u)
    if kind in ("copper", "gold", "cobalt"):
        metal = np.where(tile == 2, 0.76 if kind == "cobalt" else 0.9, 0)
        rough = np.where(tile == 2, 0.3 + 0.17 * (1 - detail), rough)
    if kind in ("crystal", "dihydrogen"):
        rough = np.where(
            tile == (0 if kind == "crystal" else 2), 0.22 + 0.16 * (1 - detail), rough
        )
    gy, gx = np.gradient(height)
    normal = np.stack((-gx * 95, -gy * 95, np.ones_like(u)), axis=2)
    normal /= np.linalg.norm(normal, axis=2)[:, :, None]
    normal = normal * 0.5 + 0.5
    ao = np.clip(0.75 + 0.25 * detail, 0, 1)
    orm = np.stack((ao, rough, metal), axis=2)
    # Recessed/vein-local glow, not entire metal deposits; runtime mask feedback is separate.
    emission = np.zeros_like(base)
    band = np.exp(-(((u - 0.5) / 0.11) ** 2)) * (0.35 + 0.65 * v)
    emission[tile == 2] = base[tile == 2] * band[tile == 2, None]
    maps = {}
    for name, rgb, data in [
        ("Base", base, False),
        ("ORM", orm, True),
        ("Normal", normal, True),
        ("Emission", emission, False),
    ]:
        im = bpy.data.images.new(kind + "_" + name, n, n, alpha=True)
        if data:
            im.colorspace_settings.name = "Non-Color"
        rgba = np.ones((n, n, 4), dtype=np.float32)
        rgba[:, :, :3] = rgb
        im.pixels.foreach_set(rgba.ravel())
        im.pack()
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = im
        maps[name] = tex
    nt.links.new(maps["Base"].outputs["Color"], bs.inputs["Base Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(maps["ORM"].outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    bs.inputs["Metallic"].default_value = 1
    normal_node = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(maps["Normal"].outputs["Color"], normal_node.inputs["Color"])
    nt.links.new(normal_node.outputs["Normal"], bs.inputs["Normal"])
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(
            name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat"
        )
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = group
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    nt.links.new(maps["Emission"].outputs["Color"], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = GLOW.get(kind, 0) * 0.2
    m.diffuse_color = (*linear(PALETTES[kind][0]), 1)
    return m


def create_mesh(s, name, mat, coll, kind, variant):
    me = bpy.data.meshes.new(name)
    me.from_pydata(s.v, [], s.f)
    me.update()
    for p, smooth in zip(me.polygons, s.smooth):
        p.use_smooth = smooth
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li in p.loop_indices:
            uv.data[li].uv = s.uv[me.loops[li].vertex_index]
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    weights = np.array(s.mask, dtype=np.float32)
    # Vertex AO is measured against this variant's real geometry (12 hemispherical rays).
    bvh = BVHTree.FromPolygons([Vector(v) for v in s.v], s.f, all_triangles=True)
    for i, vert in enumerate(me.vertices):
        normal = vert.normal.normalized()
        q = normal.to_track_quat("Z", "Y")
        blocked = 0
        for j in range(12):
            z = (j + 0.5) / 12
            radius = math.sqrt(1 - z * z)
            phi = j * 2.39996
            d = q @ Vector((radius * math.cos(phi), radius * math.sin(phi), z))
            hit = bvh.ray_cast(vert.co + normal * 0.0025, d, 0.38)[0]
            blocked += hit is not None
        ground = max(0, min(1, vert.co.z / 0.2))
        weights[i, 3] = max(0.18, (1 - 0.7 * blocked / 12) * (0.78 + 0.22 * ground))
    ca.data.foreach_set("color", weights.ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    glow = me.attributes.new("_glow", "FLOAT", "POINT")
    glow.data.foreach_set("value", weights[:, 2] * GLOW.get(kind, 0))
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob["kind"] = kind
    ob["variant"] = variant
    ob["glow_accent"] = GLOW.get(kind, 0)
    ob["mask_semantics"] = "R primary; G secondary; B accent; A measured occlusion"
    return ob


def add_asset(name, kind, variant, mat):
    root = bpy.data.collections.new("Flora_" + name)
    bpy.context.scene.collection.children.link(root)
    root["resource_kind"] = kind
    col = bpy.data.collections.new("Flora_" + name + "_LOD0")
    root.children.link(col)
    s = (
        plant_geometry(kind, variant)
        if kind in ("bush", "fern", "grass", "plant", "sodium", "oxygen")
        else mineral_geometry(kind, variant)
    )
    ob = create_mesh(s, name, mat, col, kind, variant)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    # Saved editable lower LODs; exporting never rebuilds these meshes.
    counts = [len(ob.data.polygons)]
    for level, ratio in enumerate((0.32, 0.12, 0.035), 1):
        lc = bpy.data.collections.new("Flora_" + name + f"_LOD{level}")
        root.children.link(lc)
        lo = ob.copy()
        lo.data = ob.data.copy()
        lo.name = name + f"_lod{level}"
        lc.objects.link(lo)
        bpy.context.view_layer.objects.active = lo
        dec = lo.modifiers.new("Silhouette_reduction", "DECIMATE")
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dec.name)
        counts.append(sum(len(p.vertices) - 2 for p in lo.data.polygons))
        lo.hide_render = True
    ob.select_set(False)
    bpy.context.view_layer.update()
    print("ASSET", name, counts, list(ob.dimensions), flush=True)
    return {
        "mesh": name,
        "root": "Flora_" + name,
        "kind": kind,
        "variant": variant,
        "triangles": counts,
        "dimensions_m": list(ob.dimensions),
        "glow_accent": GLOW.get(kind, 0),
        "palette_srgb": PALETTES[kind],
    }


GROUPS = {
    "foliage": [
        (f"{kind}_{i}", kind, i)
        for kind, n in [("bush", 3), ("fern", 2), ("plant", 2), ("grass", 2)]
        for i in range(n)
    ],
    "stone": [
        (f"{kind}_{i}", kind, i)
        for kind, n in [("rock", 4), ("boulder", 3), ("crystal", 3)]
        for i in range(n)
    ],
    "resources": [
        ("deposit_0", "copper", 0),
        ("deposit_copper_1", "copper", 1),
        ("deposit_1", "cobalt", 0),
        ("deposit_cobalt_1", "cobalt", 1),
        ("deposit_gold_0", "gold", 0),
        ("deposit_gold_1", "gold", 1),
        ("deposit_dihydrogen_0", "dihydrogen", 0),
        ("deposit_dihydrogen_1", "dihydrogen", 1),
        ("plant_bulb_0", "sodium", 0),
        ("plant_bulb_1", "sodium", 1),
        ("plant_flower_0", "oxygen", 0),
        ("plant_flower_1", "oxygen", 1),
    ],
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--group", choices=GROUPS)
    p.add_argument("--replace", action="store_true")
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    library = ROOT / "assets/blend/_library.blend"
    assert hashlib.sha256(library.read_bytes()).hexdigest() == LIB_HASH
    OUT.mkdir(parents=True, exist_ok=True)
    for group, items in GROUPS.items():
        if args.group and group != args.group:
            continue
        path = OUT / f"non_tree_{group}.blend"
        if path.exists() and not args.replace:
            raise RuntimeError(
                f"Refusing to regenerate saved source {path}; edit it or explicitly --replace"
            )
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.preferences.filepaths.save_version = 0
        scene = bpy.context.scene
        scene.unit_settings.system = "METRIC"
        scene.unit_settings.scale_length = 1
        scene.render.threads_mode = "FIXED"
        scene.render.threads = 2
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 12
        with bpy.data.libraries.load(str(library), link=False) as (_src, dst):
            dst.collections = ["REF"]
        ref = dst.collections[0]
        scene.collection.children.link(ref)
        ref.hide_render = True
        mats = {
            kind: material(kind) for kind in dict.fromkeys(kind for _, kind, _ in items)
        }
        inventory = [add_asset(name, kind, v, mats[kind]) for name, kind, v in items]
        scene["task"] = "P1.E14.T05"
        scene["source_policy"] = (
            "Saved geometry is truth. Export never imports authoring."
        )
        bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
        (EVIDENCE / f"{group}_inventory.json").write_text(
            json.dumps(inventory, indent=2) + "\n"
        )


if __name__ == "__main__":
    main()
