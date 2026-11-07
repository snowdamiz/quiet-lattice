"""T08 authored component layouts. Run once to save sources; stock export only reads those files.

Every assembled piece has a name and its own editable mesh. Lower levels remove fastening,
control and surface assemblies before simplifying the principal shell, frame and aperture.
"""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Euler, Matrix

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE))
from geometry import Part, collection, empty
from materials import make_palette

INVENTORY = {
    "cargo_pod": ("props", ["cargo_pod"]),
    "loot_pod": ("props", ["loot_pod"]),
    "terminal": ("props", ["terminal", "terminal_reaches"]),
    "market_stall": ("props", ["market_stall", "market_stall_reaches"]),
    "ammo": ("props", ["ammo_flak", "ammo_torpedo"]),
    "catalyst_vial": (
        "props",
        [
            "catalyst_vial_" + v
            for v in ["frostglass", "stormquartz", "gamma", "acidsalt"]
        ],
    ),
    "crash_debris": (
        "props",
        ["crash_debris_" + v for v in ["plate", "shard", "rim", "scorch"]],
    ),
    **{
        v: ("sites", [v])
        for v in ["outpost_0", "outpost_1", "outpost_2", "beacon_0", "beacon_1"]
    },
}


class Layout:
    def __init__(self, variant, lod, coll, mats, building=False):
        self.variant, self.lod, self.coll, self.mats = variant, lod, coll, mats
        self.res = 2048 if building else 1024
        self.density = 256 if building else 512
        self.parts = []
        self.b = 0.025 if lod == 0 else (0.012 if lod == 1 else 0)
        self.n = [20, 12, 8, 5][lod]

    def part(self, name):
        label = f"{self.variant}_{name}_L{self.lod}"
        if name.startswith("Door"):
            label = "Door_" + label
        p = Part(label, self.coll, self.mats, self.density, self.res)
        self.parts.append(p)
        return p

    def finish(self):
        return [o for p in self.parts if (o := p.finish())]


def arch_points(x, y, z, w, h, steps=12):
    return [
        (
            x + w * math.cos(math.pi * i / steps),
            y,
            z + h * math.sin(math.pi * i / steps),
        )
        for i in range(steps + 1)
    ]


def panel_xz(p, outline, y, depth, role="Hull"):
    verts = [(x, y, z) for x, z in outline] + [(x, y + depth, z) for x, z in outline]
    n = len(outline)
    p.mesh(
        verts,
        [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)],
        role,
    )


def worn_edges(p, center, width, z, role="Wear", count=8):
    x, y = center
    for i in range(count):
        f = (i + 0.5) / count
        length = 0.018 + 0.03 * ((i * 7) % 5)
        p.box(
            (x - width * 0.5 + f * width, y, z + (0.004 if i % 3 else 0.009)),
            (length, 0.015, 0.009),
            role,
        )


def pod(a, opened=False):
    l = a.lod
    frame = a.part("FusedCargoFrame")
    shell = a.part("LappedPressureShell")
    foot = a.part("ShockSkids")
    hatch = a.part("ReleasedHatch" if opened else "SealedHatch")
    for x in [-0.64, 0.64]:
        foot.box((x, 0, 0.11), (0.26, 2.02, 0.22), "Dark", a.b)
    if l == 3:
        shell.box((0, 0.06, 0.85), (1.5, 1.78, 1.3), "Hull")
        hatch.box((0, -1.0, 0.85), (1.4, 0.12, 1.20), "Accent")
        if opened:
            hatch.box((0, -1.48, 0.30), (1.32, 0.85, 0.13), "Accent")
        return
    arch = [
        (-0.78, 0.24),
        (-0.78, 1.12),
        (-0.63, 1.44),
        (-0.28, 1.63),
        (0.28, 1.63),
        (0.63, 1.44),
        (0.78, 1.12),
        (0.78, 0.24),
    ]
    for j, y in enumerate([-0.94, 0, 0.94] if l < 2 else [-0.94, 0.94]):
        frame.tube([(x, y, z) for x, z in arch], 0.045, "Trim", a.n)
    for i in range(len(arch) - 1):
        x0, z0 = arch[i]
        x1, z1 = arch[i + 1]
        for j in range(3 if l < 2 else 1):
            start = -0.88 + j * 1.76 / (3 if l < 2 else 1)
            end = start + 1.76 / (3 if l < 2 else 1) - 0.012
            shell.mesh(
                [(x0, start, z0), (x1, start, z1), (x1, end, z1), (x0, end, z0)],
                [(0, 1, 2, 3)],
                "Accent" if i in [0, 6] else "Hull",
            )
    shell.box((0, 0, 0.25), (1.48, 1.80, 0.12), "Dark", a.b)
    outline = [
        (-0.70, 0.32),
        (0.70, 0.32),
        (0.70, 1.12),
        (0.53, 1.40),
        (0.25, 1.53),
        (-0.25, 1.53),
        (-0.53, 1.40),
        (-0.70, 1.12),
    ]
    panel_xz(shell, outline, 0.89, 0.08, "Hull")
    if not opened:
        panel_xz(hatch, outline, -1.02, 0.08, "Accent")
        hatch.box((0, -1.082, 0.80), (0.94, 0.035, 0.44), "Hull", a.b)
    else:
        hatch.box(
            (0, -1.49, 0.27), (1.43, 1.10, 0.13), "Accent", a.b, Euler((0.24, 0, 0))
        )
        ribs = a.part("ExposedCargoRack")
        for x in [-0.53, 0.53]:
            ribs.tube(
                [(x, -0.94, 0.36), (x, 0.78, 0.36), (x, 0.78, 1.34)],
                0.028,
                "Signal",
                a.n,
            )
        for z in [0.52, 0.83, 1.13]:
            ribs.box((0, 0.73, z), (1.15, 0.08, 0.055), "Trim", a.b)
        for x in [-0.48, 0, 0.48]:
            ribs.box((x, 0.33, 0.43), (0.4, 0.62, 0.25), "Dark", a.b)
    if l < 2:
        hardware = a.part("HingesLatchesAndIdentification")
        for x in [-0.57, 0.57]:
            for y in [-0.91, 0.91]:
                hardware.box(
                    (x, y, 0.37), (0.18, 0.16, 0.18), "Signal", 0.02 if l == 0 else 0
                )
                hardware.lathe(
                    (x, y, 0), [(0.32, 0.075), (0.35, 0.075), (0.36, 0.05)], "Trim", a.n
                )
            hardware.tube(
                [(x, -1.07, 0.71), (x, -1.15, 0.71), (x, -1.15, 1.0), (x, -1.07, 1.0)],
                0.023,
                "Trim",
                a.n,
            )
        for x in [-0.42, -0.21, 0, 0.21, 0.42]:
            hardware.box((x, -1.10, 1.22), (0.12, 0.025, 0.035), "Dark", a.b * 0.3)
        hardware.box((0.32, -1.11, 0.51), (0.19, 0.03, 0.13), "Signal", 0.01)
        if l == 0:
            for y in [-0.74, -0.39, 0.39, 0.74]:
                for x in [-0.79, 0.79]:
                    hardware.lathe(
                        (x, y, 0),
                        [(0.77, 0.035), (0.80, 0.035), (0.81, 0.024)],
                        "Trim",
                        12,
                    )
            wear = a.part("DockScrapesAndLatchPolish")
            worn_edges(wear, (0, -1.115), 1.2, 0.36, count=15)
            for x in [-0.73, 0.73]:
                for j in range(9):
                    wear.box(
                        (x, -0.6 + j * 0.14, 0.28),
                        (0.04, 0.06 + 0.005 * j, 0.018),
                        "Wear",
                    )


def terminal(a, offset=(0, 0, 0), small=False):
    l = a.lod
    base = a.part("FlaredFoot")
    spine = a.part("RearLatticeSpine")
    face = a.part("CantedDisplay")
    base.box((0, 0.08, 0.10), (0.82, 0.64, 0.20), "Dark", a.b)
    spine.box((0, 0.18, 0.73), (0.37, 0.28, 1.24), "Hull", a.b)
    rot = Euler((math.radians(14), 0, 0))
    face.box((0, -0.04, 1.40), (0.82, 0.20, 0.67), "Accent", a.b, rot)
    face.box((0, -0.155, 1.44), (0.66, 0.025, 0.39), "Screen", a.b * 0.3, rot)
    if l == 3:
        return
    hood = a.part("OverlappedScreenVisor")
    hood.box((0, -0.02, 1.78), (0.94, 0.43, 0.07), "Hull", a.b)
    for x in [-0.43, 0.43]:
        hood.box((x, -0.02, 1.47), (0.05, 0.28, 0.62), "Hull", a.b)
        spine.tube(
            [(x * 0.66, 0.29, 0.18), (x * 0.48, 0.33, 0.73), (x * 0.86, 0.15, 1.22)],
            0.035,
            "Trim",
            a.n,
        )
    face.box((0, -0.22, 1.10), (0.76, 0.27, 0.10), "Dark", a.b, rot)
    if l < 2:
        keys = a.part("KeypadToggleAndServicePort")
        for i in range(4):
            for j in range(3):
                keys.box(
                    (-0.22 + i * 0.13, -0.30 + j * 0.055, 1.16),
                    (0.078, 0.037, 0.022),
                    "Accent",
                    0.006 if l == 0 else 0,
                )
        for x in [0.24, 0.31]:
            keys.lathe(
                (x, -0.24, 0),
                [(1.14, 0.025), (1.19, 0.025), (1.20, 0.016)],
                "Signal",
                a.n,
            )
        for j in range(8):
            keys.box((0, 0.335, 0.49 + j * 0.045), (0.25, 0.025, 0.013), "Dark")
        keys.box((0, -0.03, 0.57), (0.27, 0.04, 0.25), "Accent", a.b)
        cable = a.part("PowerUmbilical")
        cable.tube(
            [
                (0, 0.36, 0.31),
                (0.20, 0.40, 0.24),
                (0.35, 0.37, 0.22),
                (0.38, 0.29, 0.48),
                (0.32, 0.24, 0.86),
            ],
            0.025,
            "Dark",
            a.n,
        )
        if l == 0:
            for i in range(16):
                a0 = math.tau * i / 16
                keys.box(
                    (0.30 + 0.066 * math.cos(a0), -0.27, 1.39 + 0.066 * math.sin(a0)),
                    (0.018, 0.014, 0.018),
                    "Signal",
                    0.003,
                )
            for i in range(8):
                keys.box(
                    (-0.32 + i * 0.09, -0.184, 1.67),
                    (0.043, 0.014, 0.021),
                    "Trim",
                    0.003,
                )
            wear = a.part("PalmWearAndServiceScuffs")
            worn_edges(wear, (0, -0.34), 0.65, 1.16, count=12)


def stall(a):
    l = a.lod
    counter = a.part("SalesCounter")
    frame = a.part("FusedAwningFrame")
    roof = a.part("LappedShellAwning")
    counter.box((0, 0, 0.52), (2.9, 1.18, 1.00), "Hull", a.b)
    counter.box((0, -0.12, 1.04), (3.14, 1.40, 0.12), "Accent", a.b)
    if l == 3:
        roof.box((0, 0.1, 2.38), (3.35, 1.86, 0.12), "Signal")
        for x in [-1.42, 1.42]:
            frame.box((x, 0.62, 1.34), (0.10, 0.10, 2.58), "Dark")
        return
    for x in [-1.42, 1.42]:
        frame.tube(
            [
                (x, 0.66, 0),
                (x, 0.66, 2.18),
                (x * 0.9, 0.51, 2.58),
                (x * 0.85, -0.7, 2.56),
            ],
            0.055,
            "Trim",
            a.n,
        )
        frame.tube(
            [(x, 0.60, 1.2), (x * 0.72, 0.60, 2.28), (x, 0.60, 2.28)],
            0.035,
            "Trim",
            a.n,
        )
    for j in range(7 if l < 2 else 3):
        count = 7 if l < 2 else 3
        x0 = -1.66 + j * 3.32 / count
        x1 = x0 + 3.32 / count + 0.028
        verts = []
        for x in [x0, x1]:
            for i in range(9 if l < 2 else 5):
                steps = 8 if l < 2 else 4
                t = i / steps
                verts.append((x, -0.94 + t * 1.98, 2.37 + 0.27 * math.sin(math.pi * t)))
        n = len(verts) // 2
        roof.mesh(
            verts,
            [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)],
            "Signal" if j % 3 == 0 else "Accent",
        )
    shelving = a.part("StockShelvesAndApron")
    for x in [-1.2, 0, 1.2]:
        shelving.box((x, 0.63, 0.51), (0.07, 0.12, 0.88), "Trim", a.b)
    for z in [0.28, 0.63, 0.93]:
        shelving.box((0, 0.60, z), (2.6, 0.48, 0.045), "Dark", a.b)
    for x in [-0.96, 0, 0.96]:
        counter.box((x, -0.606, 0.55), (0.85, 0.035, 0.74), "Accent", a.b)
    if l < 2:
        fittings = a.part("CounterFittingsAndStock")
        for j in range(6):
            x = -1.16 + j * 0.46
            fittings.box((x, 0.18, 1.16), (0.36, 0.38, 0.16), "Dark", a.b)
            fittings.box((x, -0.06, 1.12), (0.27, 0.08, 0.04), "Signal", a.b * 0.4)
            if l == 0:
                fittings.lathe(
                    (x, 0.18, 0), [(1.24, 0.11), (1.28, 0.11), (1.30, 0.09)], "Trim", 16
                )
        for x in [-1.36, 1.36]:
            fittings.tube(
                [(x, -0.4, 1.08), (x, -0.4, 1.38), (x, -0.20, 1.38), (x, -0.20, 1.08)],
                0.025,
                "Trim",
                a.n,
            )
        for x in [-1.3, -0.88, -0.45, 0, 0.45, 0.88, 1.3]:
            fittings.box((x, -0.95, 2.29), (0.18, 0.04, 0.16), "Hull", a.b)
        if l == 0:
            for x in [-1.25, 1.25]:
                for z in [0.26, 0.47, 0.68, 0.89]:
                    fittings.lathe(
                        (x, -0.64, z),
                        [(-0.01, 0.027), (0.018, 0.027), (0.026, 0.02)],
                        "Trim",
                        12,
                        axis="y",
                    )
            wear = a.part("HandPolishedCounterAndPatchedCanopy")
            worn_edges(wear, (0, -0.817), 2.6, 1.109, count=23)
            wear.box((0.79, -0.19, 2.641), (0.46, 0.31, 0.014), "Hull")
            for i in range(11):
                wear.box(
                    (0.58 + i * 0.038, -0.33, 2.651), (0.012, 0.026, 0.008), "Trim"
                )


def ammo(a, torpedo=False):
    l = a.lod
    if torpedo:
        body = a.part("GuidanceBody")
        cradle = a.part("TransportCradle")
        fins = a.part("FoldedStabilizers")
        sides = [40, 24, 12, 8][l]
        profile = (
            [
                (-0.77, 0.035),
                (-0.70, 0.105),
                (-0.52, 0.16),
                (0.38, 0.16),
                (0.56, 0.13),
                (0.66, 0.09),
            ]
            if l < 3
            else [(-0.77, 0.03), (-0.50, 0.16), (0.55, 0.14), (0.66, 0.07)]
        )
        body.lathe((0, 0, 0.29), profile, "Hull", sides, axis="x")
        for x in [-0.46, 0.43]:
            cradle.box((x, 0, 0.055), (0.20, 0.48, 0.11), "Dark", a.b)
            if l < 3:
                cradle.tube(
                    [
                        (x, -0.21, 0.07),
                        (x, -0.21, 0.28),
                        (x, 0, 0.50),
                        (x, 0.21, 0.28),
                        (x, 0.21, 0.07),
                    ],
                    0.025,
                    "Signal",
                    a.n,
                )
        if l == 3:
            return
        for i in range(4):
            an = math.tau * i / 4
            mat = Matrix.Translation((0, 0, 0.29)) @ Matrix.Rotation(an, 4, "X")
            fins.mesh(
                [
                    (0.27, 0.11, 0),
                    (0.62, 0.11, 0),
                    (0.56, 0.27, 0),
                    (0.43, 0.27, 0),
                    (0.27, 0.11, 0.025),
                    (0.62, 0.11, 0.025),
                    (0.56, 0.27, 0.025),
                    (0.43, 0.27, 0.025),
                ],
                [
                    (0, 3, 2, 1),
                    (4, 5, 6, 7),
                    (0, 1, 5, 4),
                    (1, 2, 6, 5),
                    (2, 3, 7, 6),
                    (3, 0, 4, 7),
                ],
                "Accent",
                mat,
            )
        if l < 2:
            details = a.part("ArmingCollarAndCoolingFins")
            for x in [-0.50, -0.46, 0.33, 0.37, 0.54]:
                details.lathe(
                    (0, 0, 0.29),
                    [(x, 0.162), (x + 0.015, 0.171), (x + 0.03, 0.162)],
                    "Trim",
                    a.n,
                    axis="x",
                )
            for x in [-0.17, -0.04, 0.09]:
                details.box(
                    (x, -0.162, 0.29),
                    (0.07, 0.02, 0.08),
                    "Signal",
                    0.006 if l == 0 else 0,
                )
            if l == 0:
                for i in range(16):
                    t = math.tau * i / 16
                    details.tube(
                        [
                            (0.42, 0.14 * math.cos(t), 0.29 + 0.14 * math.sin(t)),
                            (0.60, 0.095 * math.cos(t), 0.29 + 0.095 * math.sin(t)),
                        ],
                        0.008,
                        "Dark",
                        8,
                    )
                wear = a.part("CradleContactScars")
                worn_edges(wear, (0, -0.20), 1.1, 0.08, count=14)
    else:
        can = a.part("FragmentRoundCan")
        hardware = a.part("LidAndCarryBail")
        if l == 3:
            can.box((0, 0, 0.19), (0.44, 0.30, 0.38), "Hull")
            hardware.box((0, 0, 0.39), (0.47, 0.33, 0.045), "Accent")
        else:
            # Open carry can: the fitted fragment rounds are visible through its mouth.
            can.box((0, 0, 0.025), (0.44, 0.30, 0.05), "Hull", a.b * 0.4)
            for x in [-0.21, 0.21]:
                can.box((x, 0, 0.17), (0.02, 0.30, 0.30), "Hull", a.b * 0.2)
            for y in [-0.14, 0.14]:
                can.box((0, y, 0.17), (0.44, 0.02, 0.30), "Hull", a.b * 0.2)
            hardware.box(
                (0, 0.17, 0.425),
                (0.47, 0.035, 0.22),
                "Accent",
                a.b * 0.4,
                Euler((-0.20, 0, 0)),
            )
        if l == 3:
            hardware.box((0, 0, 0.45), (0.26, 0.04, 0.05), "Signal")
            return
        hardware.tube(
            [
                (-0.15, 0, 0.41),
                (-0.15, 0, 0.50),
                (-0.09, 0, 0.54),
                (0.09, 0, 0.54),
                (0.15, 0, 0.50),
                (0.15, 0, 0.41),
            ],
            0.014,
            "Trim",
            a.n,
        )
        for x in [-0.20, 0.20]:
            hardware.box(
                (x, -0.17, 0.34), (0.07, 0.04, 0.12), "Signal", 0.007 if l < 2 else 0
            )
        for y in [-0.154, 0.154]:
            for x in [-0.15, -0.075, 0, 0.075, 0.15]:
                can.box((x, y, 0.20), (0.025, 0.012, 0.26), "Accent", a.b * 0.2)
        if l < 2:
            rounds = a.part("SixProtectedFragmentCartridges")
            for x in [-0.135, 0, 0.135]:
                for y in [-0.074, 0.074]:
                    rounds.lathe(
                        (x, y, 0),
                        [
                            (0.045, 0.048),
                            (0.09, 0.048),
                            (0.27, 0.043),
                            (0.31, 0.034),
                            (0.34, 0.013),
                        ],
                        "Trim",
                        a.n,
                    )
                    if l == 0:
                        for z in [0.10, 0.14, 0.18, 0.22, 0.26]:
                            rounds.lathe(
                                (x, y, 0),
                                [(z, 0.044), (z + 0.006, 0.049), (z + 0.012, 0.044)],
                                "Dark",
                                12,
                            )
            for x in [-0.17, 0.17]:
                for z in [0.09, 0.31]:
                    hardware.lathe(
                        (x, -0.17, z),
                        [(0, 0.018), (0.015, 0.018), (0.022, 0.012)],
                        "Trim",
                        12,
                        axis="y",
                    )
            wear = a.part("CarryGripPolish")
            worn_edges(wear, (0, -0.04), 0.28, 0.54, count=10)


def vial(a, kind):
    l = a.lod
    vessel = a.part("AssayVessel")
    cage = a.part("ChorusCarryCage")
    cap = a.part("MeteringCap")
    n = [40, 24, 12, 6][l]
    profile = (
        [
            (0.026, 0.052),
            (0.035, 0.062),
            (0.07, 0.065),
            (0.19, 0.065),
            (0.22, 0.052),
            (0.25, 0.036),
        ]
        if l < 3
        else [(0.025, 0.06), (0.21, 0.06), (0.25, 0.036)]
    )
    vessel.lathe((0, 0, 0), profile, "Glass", n)
    # An actual metered charge and meniscus remain editable behind the reflection glass.
    charge = a.part("MeteredCatalystCharge")
    fill = {
        "frostglass": 0.176,
        "stormquartz": 0.191,
        "gamma": 0.168,
        "acidsalt": 0.202,
    }[kind]
    role = {
        "frostglass": "Accent",
        "stormquartz": "Hull",
        "gamma": "Signal",
        "acidsalt": "Wear",
    }[kind]
    charge.lathe(
        (0, 0, 0),
        [(0.032, 0.050), (0.04, 0.056), (fill, 0.056), (fill + 0.003, 0.052)],
        role,
        n,
    )
    cap.lathe(
        (0, 0, 0),
        [(0.24, 0.042), (0.25, 0.049), (0.278, 0.049), (0.286, 0.039)],
        "Hull",
        n,
    )
    cage.lathe((0, 0, 0), [(0, 0.066), (0.012, 0.072), (0.025, 0.067)], "Signal", n)
    if l == 3:
        return
    for i in range(4):
        t = math.tau * i / 4 + math.pi / 4
        x, y = math.cos(t), math.sin(t)
        cage.tube(
            [
                (x * 0.063, y * 0.063, 0.02),
                (x * 0.079, y * 0.079, 0.08),
                (x * 0.079, y * 0.079, 0.19),
                (x * 0.045, y * 0.045, 0.251),
            ],
            0.007,
            "Accent",
            a.n,
        )
    cage.tube(
        [
            (-0.035, 0, 0.282),
            (-0.04, 0, 0.31),
            (-0.024, 0, 0.333),
            (0.024, 0, 0.333),
            (0.04, 0, 0.31),
            (0.035, 0, 0.282),
        ],
        0.007,
        "Signal",
        a.n,
    )
    if l < 2:
        fittings = a.part("MeteringKnurlAndSocketCollars")
        for z, r in [(0.035, 0.065), (0.211, 0.058), (0.251, 0.049), (0.277, 0.048)]:
            fittings.lathe(
                (0, 0, 0), [(z - 0.004, r), (z, r + 0.003), (z + 0.004, r)], "Trim", n
            )
        for i in range(16 if l == 0 else 8):
            t = math.tau * i / (16 if l == 0 else 8)
            fittings.box(
                (0.049 * math.cos(t), 0.049 * math.sin(t), 0.265),
                (0.007, 0.007, 0.025),
                "Signal",
                0.0015 if l == 0 else 0,
            )
        etch = a.part("MaterialAssay_" + kind)
        for i in range(9 if l == 0 else 4):
            x = -0.044 + i * 0.011 if l == 0 else -0.04 + i * 0.026
            z = 0.07 + (i % 3) * 0.041
            if kind == "frostglass":
                etch.tube(
                    [
                        (x, -0.063, z),
                        (x + 0.009, -0.067, z + 0.024),
                        (x - 0.004, -0.062, z + 0.042),
                    ],
                    0.0016,
                    "Accent",
                    6,
                )
                etch.tube(
                    [(x + 0.009, -0.066, z + 0.024), (x + 0.023, -0.060, z + 0.03)],
                    0.0013,
                    "Accent",
                    5,
                )
            elif kind == "stormquartz":
                etch.tube(
                    [
                        (x, -0.061, z),
                        (x + 0.014, -0.068, z + 0.025),
                        (x + 0.002, -0.064, z + 0.043),
                    ],
                    0.002,
                    "Signal",
                    6,
                )
            elif kind == "gamma":
                etch.lathe(
                    (x, -0.063, z),
                    [(-0.001, 0.005), (0.002, 0.009), (0.006, 0.006)],
                    "Accent",
                    10,
                    axis="y",
                )
            else:
                etch.tube(
                    [
                        (x, -0.060, z),
                        (x + 0.008, -0.068, z + 0.009),
                        (x + 0.018, -0.064, z + 0.004),
                        (x + 0.021, -0.057, z - 0.004),
                    ],
                    0.0025,
                    "Signal",
                    8,
                )
        if l == 0:
            seal = a.part("ParchmentAssayLabelAndCapWear")
            seal.box((0, 0.067, 0.135), (0.072, 0.008, 0.073), "Accent", 0.003)
            for i in range(7):
                seal.box(
                    (-0.026 + i * 0.009, 0.072, 0.136),
                    (0.004, 0.002, 0.027 if i % 2 else 0.043),
                    "Hull",
                )
            for i in range(12):
                t = math.tau * i / 12
                seal.box(
                    (0.043 * math.cos(t), 0.043 * math.sin(t), 0.28),
                    (0.007, 0.004, 0.002),
                    "Wear",
                )


def debris(a, kind):
    l = a.lod
    p = a.part("TornSkin")
    ribs = a.part("ExposedFrame")
    wear = a.part("HeatScarsAndSpalledEdges")
    if kind == "rim":
        n = [32, 20, 10, 4][l]
        # A 34 degree fragment of the original ~18 m ring. End-to-end is 5.32 m.
        vertices = []
        for i in range(n + 1):
            t = math.radians(-17 + 34 * i / n)
            for r, z in [
                (8.35, 0.04),
                (8.50, 0.15),
                (8.76, 0.28),
                (9.02, 0.13),
                (9.15, 0.025),
            ]:
                vertices.append((r * math.sin(t), r * math.cos(t) - 8.35, z))
        p.mesh(
            vertices,
            [
                (i * 5 + j, (i + 1) * 5 + j, (i + 1) * 5 + j + 1, i * 5 + j + 1)
                for i in range(n)
                for j in range(4)
            ],
            "Dark",
        )
        if l == 3:
            return
        for i in range(14 if l < 2 else 5):
            t = math.radians(-16 + 32 * i / (13 if l < 2 else 4))
            path = [
                (r * math.sin(t), r * math.cos(t) - 8.35, z)
                for r, z in [(8.4, 0.09), (8.65, 0.29), (8.9, 0.25), (9.13, 0.055)]
            ]
            ribs.tube(path, 0.027, "Trim", a.n)
            if l == 0:
                for j in range(3):
                    r = 8.51 + 0.19 * j
                    wear.box(
                        (r * math.sin(t), r * math.cos(t) - 8.35, 0.24),
                        (0.11, 0.08, 0.012),
                        "Wear",
                        0.003,
                    )
    elif kind == "scorch":
        outline = [
            (-2.4, -0.63, 0),
            (-1.7, -1.18, 0.015),
            (-0.6, -1.34, 0),
            (0.67, -1.13, 0.01),
            (2.35, -0.45, 0),
            (2.55, 0.11, 0.02),
            (1.62, 0.92, 0),
            (0.27, 1.18, 0.01),
            (-1.4, 0.87, 0),
            (-2.55, 0.19, 0.012),
        ]
        p.plate(outline, 0.033, "Dark")
        if l == 3:
            return
        for j in range(26 if l == 0 else (13 if l == 1 else 5)):
            t = j / (25 if l == 0 else (12 if l == 1 else 4))
            x = -2.1 + t * 4.1
            y = 0.35 * math.sin(t * 8)
            path = [
                (x - 0.13, y - 0.31, 0.045),
                (x + 0.04, y, 0.10 + 0.07 * math.sin(t * 12) ** 2),
                (x + 0.29, y + 0.33, 0.047),
            ]
            ribs.tube(
                path, 0.027 + 0.018 * (j % 3), "Wear" if j % 4 == 0 else "Dark", a.n
            )
            if l == 0:
                wear.plate(
                    [
                        (x - 0.18, y, 0.04),
                        (x - 0.06, y - 0.12, 0.07),
                        (x + 0.10, y - 0.02, 0.11),
                        (x + 0.17, y + 0.17, 0.04),
                    ],
                    0.018,
                    "Trim",
                )
    else:
        scale = 1 if kind == "plate" else 0.56
        outline = [
            (-1.26, -0.67, 0.08),
            (-0.96, -0.93, 0.12),
            (-0.10, -0.85, 0.03),
            (0.40, -0.95, 0.09),
            (1.24, -0.52, 0.12),
            (1.13, -0.20, 0.02),
            (0.88, -0.02, 0.13),
            (1.19, 0.26, 0.16),
            (0.52, 0.71, 0.11),
            (0.25, 0.56, 0.18),
            (-0.26, 0.77, 0.22),
            (-1.09, 0.49, 0.10),
        ]
        outline = [(x * scale, y * scale, z * scale) for x, y, z in outline]
        p.plate(outline, 0.045 * scale, "Hull" if kind == "plate" else "Accent")
        if l == 3:
            return
        for j in range(8 if l < 2 else 3):
            y = (-0.62 + j * (1.12 / (7 if l < 2 else 2))) * scale
            ribs.tube(
                [
                    (-1.07 * scale, y, 0.14 * scale),
                    (-0.35 * scale, y, 0.22 * scale),
                    (0.43 * scale, y, 0.18 * scale),
                    (0.96 * scale, y, 0.13 * scale),
                ],
                0.024 * scale,
                "Trim",
                a.n,
            )
        if l < 2:
            for i in range(12):
                x, y, z = outline[i]
                wear.tube(
                    [
                        (x, y, z + 0.045 * scale),
                        (x * 0.93, y * 0.94, z + 0.075 * scale),
                    ],
                    0.023 * scale,
                    "Wear",
                    a.n,
                )
                if l == 0:
                    ribs.box(
                        (x * 0.87, y * 0.85, z + 0.045 * scale),
                        (0.08 * scale, 0.06 * scale, 0.035 * scale),
                        "Dark",
                        0.009 * scale,
                    )
    if l == 0:
        fittings = a.part("SplitSeamsAndDelaminatedSplinters")
        count = 26 if kind in ["rim", "scorch"] else 18
        for j in range(count):
            x = (
                (-1.9 + j * 3.8 / (count - 1))
                if kind in ["rim", "scorch"]
                else (-0.87 + j * 1.74 / (count - 1)) * (1 if kind == "plate" else 0.56)
            )
            y = 0.10 + 0.10 * math.sin(j * 1.7)
            z = 0.14 if kind in ["plate", "shard"] else 0.10
            fittings.tube(
                [
                    (x, y, z),
                    (x + 0.05, y + 0.06, z + 0.05),
                    (x + 0.13, y + 0.045, z + 0.033),
                ],
                0.011,
                "Wear",
                12,
            )


def pad(a):
    l = a.lod
    deck = a.part("Clear24mLandingSurface")
    edge = a.part("PadPerimeterAndRamp")
    # Radius 12.18 guarantees a clear 24 m inscribed disc even in the 24-sided LOD3.
    # Occupied shelter assemblies are behind y=14, outside this clear disc.
    n = [96, 64, 40, 24][l]
    deck.lathe((0, 0, 0), [(0, 12.18), (0.18, 12.18)], "Dark", n)
    if l == 3:
        edge.box((0, -13.08, 0.09), (3.2, 1.9, 0.18), "Dark")
        return
    # Thin wedge approach reaches pad deck at 0.18 m: no unsupported plinth.
    edge.mesh(
        [
            (-1.6, -14.03, 0),
            (1.6, -14.03, 0),
            (1.6, -12.13, 0.18),
            (-1.6, -12.13, 0.18),
            (-1.6, -12.13, 0),
            (1.6, -12.13, 0),
        ],
        [(0, 1, 2, 3), (0, 4, 5, 1), (0, 3, 4), (1, 5, 2), (4, 3, 2, 5)],
        "Accent",
    )
    # Individually fitted sector plates and interrupted markings break long repeats.
    for j in range(32 if l < 2 else 16):
        count = 32 if l < 2 else 16
        t = math.tau * j / count
        if abs(math.sin(t) + 1) < 0.045:
            continue
        r = 12.14
        edge.box(
            (r * math.cos(t), r * math.sin(t), 0.23),
            (0.34, 0.09, 0.10),
            "Signal" if j % 4 == 0 else "Accent",
            a.b,
            Euler((0, 0, t + math.pi / 2)),
        )
    markings = a.part("InsetLandingGuidesAndServiceWalk")
    for x in [-7, 7]:
        for y in [-5, -2, 1, 4]:
            markings.box((x, y, 0.183), (0.16, 1.25, 0.008), "Accent")
    for y in [6.8, 8.7, 10.6, 12.5, 14.1]:
        markings.box((0, y, 0.183), (1.5, 0.08, 0.012), "Signal")
    if l < 2:
        plates = a.part("PadExpansionJointsAndDrainage")
        for j in range(24):
            t = math.tau * j / 24
            # Long, thin drains on the perimeter; no obstacles on the usable pad.
            x, y = 11.50 * math.cos(t), 11.50 * math.sin(t)
            plates.box((x, y, 0.186), (0.18, 0.75, 0.009), "Trim", 0, Euler((0, 0, t)))
            if l == 0:
                for k in range(9):
                    plates.box(
                        (
                            x + 0.10 * math.cos(t) + k * 0.047 * math.sin(t),
                            y + 0.10 * math.sin(t) - k * 0.047 * math.cos(t),
                            0.194,
                        ),
                        (0.10, 0.017, 0.008),
                        "Dark",
                        0,
                        Euler((0, 0, t)),
                    )
        for j in range(12):
            t = math.tau * j / 12
            plates.tube(
                [
                    (2.3 * math.cos(t), 2.3 * math.sin(t), 0.181),
                    (11.1 * math.cos(t), 11.1 * math.sin(t), 0.181),
                ],
                0.008,
                "Trim",
                6,
            )
        if l == 0:
            wear = a.part("LandingFootScarsAndRainRunoff")
            for cx, cy in [(-3.7, -2.3), (3.6, -2.1), (0, 4.6)]:
                for j in range(11):
                    wear.box(
                        (cx - 0.38 + j * 0.073, cy + 0.17 * math.sin(j), 0.191),
                        (0.025, 0.27 + 0.023 * (j % 4), 0.004),
                        "Wear",
                    )
    # Continuation to the shelter, outside the flight circle.
    deck.box((0, 13.55, 0.09), (3.2, 3.0, 0.18), "Dark")


def service_front(a, y=14.20, x=0, z=0.18):
    l = a.lod
    door = a.part("DoorService")
    hood = a.part("EntryPortal")
    door.box((x, y, z + 1.23), (1.52, 0.10, 2.46), "Accent", a.b)
    if l == 3:
        return
    for dx in [-0.88, 0.88]:
        hood.box((x + dx, y, z + 1.36), (0.16, 0.38, 2.72), "Trim", a.b)
    hood.box((x, y, z + 2.72), (1.92, 0.42, 0.18), "Hull", a.b)
    hood.box((x + 1.55, y - 0.1, z + 0.74), (0.56, 0.40, 1.48), "Hull", a.b)
    hood.box((x + 1.55, y - 0.32, z + 1.32), (0.45, 0.05, 0.38), "Screen", a.b)
    if l < 2:
        hood.box((x + 0.54, y - 0.09, z + 1.10), (0.08, 0.075, 0.27), "Dark", a.b)
        for i in range(8):
            hood.box(
                (x - 0.49 + i * 0.14, y - 0.063, z + 0.4),
                (0.06, 0.026, 0.035),
                "Signal",
                a.b * 0.3,
            )
        for i in range(5):
            hood.box(
                (x + 1.55, y - 0.35, z + 0.98 + i * 0.035),
                (0.35, 0.015, 0.012),
                "Accent",
            )


def shelter_dome(a):
    l = a.lod
    shell = a.part("LappedShellVault")
    frame = a.part("OpenLatticeButtresses")
    windows = a.part("SocketedCrystalWindows")
    cx, cy = 0, 18.4
    if l == 3:
        shell.lathe(
            (cx, cy, 0), [(0.18, 4.7), (2.0, 4.6), (4.8, 2.9), (5.7, 0.3)], "Hull", 10
        )
        return
    bands = [0, 0.24, 0.48, 0.70, 0.90, 1.09, 1.30, 1.50]
    seg = [32, 20, 12][l]
    for k in range(len(bands) - 1 if l < 2 else 4):
        b0, b1 = (
            (bands[k], bands[k + 1]) if l < 2 else (k * 1.50 / 4, (k + 1) * 1.50 / 4)
        )
        for j in range(seg):
            t0 = math.tau * j / seg + 0.006
            t1 = math.tau * (j + 1) / seg - 0.006
            # Door aperture on the south; this is actual absent shell, not a painted rectangle.
            if k < 3 and abs((t0 + math.pi / 2 + math.pi) % math.tau - math.pi) < 0.25:
                continue
            pts = []
            for b, t in [(b0, t0), (b0, t1), (b1, t1), (b1, t0)]:
                r = 4.7 * math.cos(b) + (0.045 if k % 2 else 0)
                pts.append(
                    (
                        cx + r * math.cos(t),
                        cy + r * math.sin(t),
                        0.18 + 5.55 * math.sin(b),
                    )
                )
            shell.mesh(pts, [(0, 1, 2, 3)], "Accent" if k % 3 == 0 else "Hull")
    for j in range(12 if l < 2 else 6):
        t = math.tau * j / (12 if l < 2 else 6)
        if abs(t - math.pi * 1.5) < 0.2:
            continue
        path = [
            (cx + r * math.cos(t), cy + r * math.sin(t), z)
            for r, z in [(5.0, 0.18), (4.7, 1.6), (3.45, 4.15), (1.2, 5.6)]
        ]
        frame.tube(path, 0.09, "Trim", a.n)
        frame.tube(
            [
                path[0],
                (cx + 3.8 * math.cos(t + 0.25), cy + 3.8 * math.sin(t + 0.25), 3.2),
                path[2],
            ],
            0.055,
            "Trim",
            a.n,
        )
        if l < 2:
            for q in [0, 1, 2]:
                frame.lathe(
                    path[q], [(0, 0.12), (0.07, 0.15), (0.14, 0.10)], "Dark", 12
                )
    for j in [0, 2, 4, 6, 8]:
        t = math.tau * j / 10
        r = 4.15
        windows.box(
            (cx + r * math.cos(t), cy + r * math.sin(t), 2.35),
            (0.72, 0.12, 1.12),
            "Glass",
            a.b,
            Euler((0, 0, t - math.pi / 2)),
        )
        frame.box(
            (cx + 4.11 * math.cos(t), cy + 4.11 * math.sin(t), 2.35),
            (0.86, 0.15, 1.27),
            "Dark",
            a.b,
            Euler((0, 0, t - math.pi / 2)),
        )


def module(a, name, center, size):
    l = a.lod
    p = a.part(name + "Shell")
    frame = a.part(name + "SocketFrame")
    x, y, z = center
    w, d, h = size
    if l == 3:
        p.box((x, y, z + h / 2), (w, d, h), "Hull")
        return
    # Faceted shell sidewalls and a crown of overlapping curved plates.
    for dx in [-w / 2, w / 2]:
        p.box((x + dx, y, z + h * 0.42), (0.11, d, h * 0.84), "Hull", a.b)
    for dy in [-d / 2, d / 2]:
        p.box((x, y + dy, z + h * 0.42), (w, 0.11, h * 0.84), "Accent", a.b)
    for j in range(7 if l < 2 else 4):
        count = 7 if l < 2 else 4
        y0 = y - d / 2 + j * d / count
        y1 = y0 + d / count + 0.06
        verts = []
        steps = 12 if l < 2 else 6
        for yy in [y0, y1]:
            for i in range(steps + 1):
                t = math.pi * i / steps
                verts.append(
                    (
                        x + w * 0.53 * math.cos(t),
                        yy,
                        z + h * 0.82 + h * 0.23 * math.sin(t),
                    )
                )
        p.mesh(
            verts,
            [(i, i + 1, steps + 2 + i, steps + 1 + i) for i in range(steps)],
            "Hull" if j % 3 else "Accent",
        )
    # Socketed fan windows close the shell's end arcs. Front ribs carry rain to the ground.
    for dy in [-d / 2 - 0.025, d / 2 + 0.025]:
        outline = [(x - w * 0.51, z + h * 0.82), (x + w * 0.51, z + h * 0.82)] + [
            (
                x + w * 0.51 * math.cos(math.pi * i / 8),
                z + h * 0.82 + h * 0.215 * math.sin(math.pi * i / 8),
            )
            for i in range(1, 9)
        ]
        panel_xz(frame, outline, y + dy, 0.05, "Glass")
        frame.box((x, y + dy, z + 0.48), (w, 0.08, 0.40), "Hull", a.b)
        for dx in [-w * 0.40, 0, w * 0.40]:
            frame.box(
                (x + dx, y + dy, z + h * 0.42), (0.08, 0.11, h * 0.78), "Trim", a.b
            )
        if l < 2:
            for j in range(3):
                frame.box(
                    (x - w * 0.29 + j * w * 0.29, y + dy - 0.015, z + h * 0.52),
                    (0.64, 0.11, 0.76),
                    "Dark",
                    a.b,
                )
                frame.box(
                    (x - w * 0.29 + j * w * 0.29, y + dy - 0.036, z + h * 0.52),
                    (0.52, 0.12, 0.64),
                    "Glass",
                    a.b,
                )
    for xx in [-w * 0.54, w * 0.54]:
        for yy in [-d * 0.38, d * 0.38]:
            frame.tube(
                [(x + xx, y + yy, 0.18), (x + xx * 0.88, y + yy, z + h * 0.7)],
                0.09,
                "Trim",
                a.n,
            )
            if l < 2:
                frame.tube(
                    [(x + xx, y + yy, 0.18), (x - xx * 0.52, y + yy, z + h * 0.52)],
                    0.055,
                    "Trim",
                    a.n,
                )
    for j in range(4 if l < 2 else 2):
        yy = y - d * 0.34 + j * d * 0.68 / (3 if l < 2 else 1)
        frame.box((x + w * 0.52, yy, z + h * 0.52), (0.13, 0.55, 0.84), "Dark", a.b)
        frame.box((x + w * 0.536, yy, z + h * 0.52), (0.13, 0.43, 0.70), "Glass", a.b)


def outpost(a, index):
    l = a.lod
    pad(a)
    if index == 0:
        shelter_dome(a)
    elif index == 1:
        module(a, "WestDeckModule", (-4.6, 18.3, 0.72), (4.3, 7.3, 3.6))
        module(a, "EastDeckModule", (4.6, 18.9, 0.72), (4.3, 6.1, 3.6))
        module(a, "EntryLink", (0, 16.2, 0.18), (4.9, 4.0, 3.1))
        if l < 3:
            deck = a.part("RaisedServiceDeck")
            deck.box((0, 18.4, 0.39), (13.8, 8.0, 0.42), "Dark", a.b)
    else:
        module(a, "LowOperationsWing", (-3.8, 18.1, 0.18), (6.0, 6.8, 3.1))
        module(a, "SplitLevelLookout", (3.1, 19.3, 0.18), (4.0, 5.7, 6.5))
        module(a, "EntryLink", (0, 15.4, 0.18), (4.0, 2.5, 2.9))
        if l < 3:
            canopy = a.part("AsymmetricHighCanopy")
            for x in [-2, 0, 2]:
                canopy.tube(
                    [(x, 16.0, 3.2), (x, 17.2, 4.6), (x, 20.8, 6.9)], 0.08, "Trim", a.n
                )
            for x0 in [-2, 0]:
                canopy.mesh(
                    [
                        (x0, 16.1, 3.25),
                        (x0 + 2, 16.1, 3.25),
                        (x0 + 2, 17.2, 4.62),
                        (x0, 17.2, 4.62),
                        (x0, 20.5, 6.76),
                        (x0 + 2, 20.5, 6.76),
                    ],
                    [(0, 1, 2, 3), (3, 2, 5, 4)],
                    "Accent",
                )
    service_front(a)
    if l < 3:
        services = a.part("AbandonedServiceEquipment")
        for x, y in [(-5.4, 15.2), (5.5, 15.6)]:
            services.box((x, y, 0.62), (1.0, 1.5, 0.88), "Dark", a.b)
            services.box((x, y, 1.09), (1.05, 1.55, 0.08), "Accent", a.b)
            if l < 2:
                for j in range(12):
                    services.box(
                        (x - 0.39 + j * 0.071, y - 0.77, 0.72),
                        (0.025, 0.04, 0.48),
                        "Trim",
                        a.b * 0.2,
                    )
        if l < 2:
            rain = a.part("LapFlashingAndRepairPlates")
            for j in range(18):
                t = math.tau * j / 18
                x, y = 4.9 * math.cos(t), 18.4 + 4.9 * math.sin(t)
                if y < 14.4:
                    continue
                rain.box(
                    (x, y, 0.41), (0.35, 0.21, 0.25), "Wear", a.b, Euler((0, 0, t))
                )
            cable = a.part("DiscardedCableAndEmptySupplyHarness")
            cable.tube(
                [
                    (-4.9, 14.8, 0.22),
                    (-3.8, 13.8, 0.21),
                    (-2.8, 14.1, 0.22),
                    (-3.5, 15.0, 0.23),
                    (-4.3, 14.4, 0.22),
                ],
                0.035,
                "Dark",
                a.n,
            )
            for x in [-3.7, -2.6]:
                cable.box((x, 15.3, 0.22), (0.13, 1.2, 0.08), "Signal", a.b)
            if l == 0:
                fixtures = a.part("ServiceGasketsPressureClampsAndSeamCaps")
                # Clamps reinforce fitted service housings; they are omitted entirely at distant LODs.
                for x in [-5.4, 5.5]:
                    for y in [14.85, 15.25, 15.65]:
                        fixtures.tube(
                            [
                                (x - 0.47, y, 0.30),
                                (x - 0.57, y, 0.7),
                                (x - 0.42, y, 1.17),
                                (x + 0.42, y, 1.17),
                                (x + 0.57, y, 0.7),
                                (x + 0.47, y, 0.30),
                            ],
                            0.028,
                            "Trim",
                            16,
                        )
                for j in range(28):
                    t = math.tau * j / 28
                    x, y = 4.84 * math.cos(t), 18.4 + 4.84 * math.sin(t)
                    if y < 14.5:
                        continue
                    fixtures.lathe(
                        (x, y, 0.18),
                        [(0, 0.11), (0.04, 0.14), (0.11, 0.11)],
                        "Signal",
                        16,
                    )


def beacon(a, index):
    l = a.lod
    base = a.part("SteppedGroundPlatform")
    mast = a.part("SignalStructure")
    cap = a.part("SignalCrown")
    if index == 0:
        base.box((0, 0, 0.18), (5.6, 5.6, 0.36), "Dark", a.b)
        for k in range(2):
            base.box(
                (0, -3.1 - 0.3 * (1 - k), 0.09 * (k + 1)),
                (2.4, 0.6 - 0.3 * k, 0.18 * (k + 1)),
                "Accent",
            )
        if l == 3:
            mast.box((0, 0, 9.2), (0.62, 0.62, 17.7), "Hull")
            cap.box((0, 0, 18.2), (1.4, 1.4, 0.8), "Signal")
            return
        for x, y in [(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)]:
            mast.tube(
                [
                    (x * 1.8, y * 1.8, 0.36),
                    (x, y, 4.2),
                    (x * 0.58, y * 0.58, 12.6),
                    (x * 0.36, y * 0.36, 17.8),
                ],
                0.085,
                "Trim",
                a.n,
            )
        for j in range(12 if l < 2 else 6):
            z = 0.7 + j * 16.7 / (11 if l < 2 else 5)
            w = 1.1 - 0.65 * z / 18
            for i in range(4):
                t = math.tau * i / 4 + math.pi / 4
                p0 = (w * math.cos(t), w * math.sin(t), z)
                p1 = (
                    w * math.cos(t + math.pi / 2),
                    w * math.sin(t + math.pi / 2),
                    z + 1.1,
                )
                mast.tube([p0, p1], 0.035, "Hull", a.n)
            mast.lathe((0, 0, z), [(0, w * 0.8), (0.08, w * 0.8)], "Accent", 8)
        cap.lathe(
            (0, 0, 0),
            [(17.5, 0.42), (17.8, 0.87), (17.92, 0.87)],
            "Hull",
            [32, 20, 12][l],
        )
        cap.lathe(
            (0, 0, 0),
            [(18.48, 0.87), (18.58, 0.87), (18.7, 0.35)],
            "Hull",
            [32, 20, 12][l],
        )
        for j in range(6):
            t = math.tau * j / 6
            cap.tube(
                [
                    (0.80 * math.cos(t), 0.80 * math.sin(t), 17.90),
                    (0.80 * math.cos(t), 0.80 * math.sin(t), 18.49),
                ],
                0.035,
                "Trim",
                a.n,
            )
    else:
        base.lathe((0, 0, 0), [(0, 3.1), (0.36, 3.1)], "Dark", 6)
        for k in range(2):
            base.box(
                (0, -2.95 - 0.3 * (1 - k), 0.09 * (k + 1)),
                (1.8, 0.6 - 0.3 * k, 0.18 * (k + 1)),
                "Accent",
            )
        if l == 3:
            mast.lathe(
                (0, 0, 0),
                [(0.36, 1.1), (3.4, 0.82), (9.2, 0.35), (13.1, 0.05)],
                "Hull",
                6,
            )
            return
        for j in range(6):
            t = math.tau * j / 6
            mast.tube(
                [
                    (2.3 * math.cos(t), 2.3 * math.sin(t), 0.36),
                    (1.4 * math.cos(t), 1.4 * math.sin(t), 2.4),
                    (0.68 * math.cos(t), 0.68 * math.sin(t), 7.7),
                    (0.25 * math.cos(t), 0.25 * math.sin(t), 10.8),
                ],
                0.10,
                "Trim",
                a.n,
            )
        for j in range(18 if l < 2 else 7):
            z = 0.5 + j * 8.7 / (17 if l < 2 else 6)
            r = 1.0 - 0.064 * z
            mast.lathe(
                (0, 0, 0),
                [(z, r), (z + 0.24, r + 0.065), (z + 0.35, r)],
                "Accent" if j % 4 == 0 else "Hull",
                [24, 16, 8][l],
            )
        cap.lathe(
            (0, 0, 0), [(9.2, 0.44), (9.4, 0.65), (9.43, 0.65)], "Hull", [24, 16, 8][l]
        )
        cap.lathe(
            (0, 0, 0),
            [(9.96, 0.65), (10.1, 0.33), (13.1, 0.045)],
            "Hull",
            [24, 16, 8][l],
        )
        for j in range(6):
            t = math.tau * j / 6
            cap.tube(
                [
                    (0.61 * math.cos(t), 0.61 * math.sin(t), 9.42),
                    (0.61 * math.cos(t), 0.61 * math.sin(t), 9.97),
                ],
                0.023,
                "Trim",
                a.n,
            )
    if l < 3:
        control = a.part("GroundServiceConsole")
        control.box((1.1, -1.65, 1.1), (0.7, 0.48, 1.48), "Hull", a.b)
        control.box((1.1, -1.91, 1.47), (0.54, 0.05, 0.38), "Screen", a.b)
        if l < 2:
            equipment = a.part("ServiceLadderAndInsulatorBanks")
            top = 17.3 if index == 0 else 8.8
            if index == 0:
                # Real ladder lift sections keep narrow rails in local quantization bounds.
                for section in range(10):
                    lower = 0.45 + (top - 0.45) * section / 10
                    upper = 0.45 + (top - 0.45) * (section + 1) / 10
                    ladder = a.part(f"LadderLiftSection_{section}")
                    for x in [-0.25, 0.25]:
                        ladder.tube(
                            [
                                (x, 0.84 - 0.2 * lower / top, lower),
                                (x, 0.84 - 0.2 * upper / top, upper),
                            ],
                            0.028,
                            "Dark",
                            a.n,
                        )
                    for j in range(int(top / 0.36)):
                        z = 0.63 + j * 0.36
                        if lower <= z < upper:
                            ladder.tube(
                                [
                                    (-0.25, 0.84 - 0.2 * z / top, z),
                                    (0.25, 0.84 - 0.2 * z / top, z),
                                ],
                                0.018,
                                "Trim",
                                a.n,
                            )
            else:
                for x in [-0.25, 0.25]:
                    equipment.tube(
                        [(x, 0.84, 0.45), (x, 0.64, top)], 0.028, "Dark", a.n
                    )
                for j in range(int(top / 0.36)):
                    z = 0.63 + j * 0.36
                    equipment.tube(
                        [
                            (-0.25, 0.84 - 0.2 * z / top, z),
                            (0.25, 0.84 - 0.2 * z / top, z),
                        ],
                        0.018,
                        "Trim",
                        a.n,
                    )
            for x in [-1.5, 1.5]:
                equipment.lathe(
                    (x, 0, 0.36),
                    [(0, 0.31), (0.25, 0.34), (1.25, 0.27), (1.4, 0.18)],
                    "Hull",
                    a.n,
                )
                for j in range(9):
                    equipment.lathe(
                        (x, 0, 0.36),
                        [
                            (0.29 + j * 0.10, 0.28),
                            (0.32 + j * 0.10, 0.36),
                            (0.35 + j * 0.10, 0.28),
                        ],
                        "Accent",
                        a.n,
                    )
            if l == 0:
                hardware = a.part("ConduitClampsAndAccessPanels")
                for j in range(18):
                    if index == 0 and j % 4 == 0:
                        hardware = a.part(f"ConduitClampRun_{j // 4}")
                    z = 0.6 + j * 0.43
                    hardware.box((0.39, 0.0, z), (0.21, 0.20, 0.09), "Signal", 0.018)
                if index == 0:
                    hardware = a.part("GroundFeedConduits")
                for x in [-1.15, 1.15]:
                    hardware.tube(
                        [
                            (x, -0.4, 0.39),
                            (x, -1.0, 0.42),
                            (0.4 * x, -1.35, 0.43),
                            (1.1, -1.65, 0.54),
                        ],
                        0.035,
                        "Dark",
                        16,
                    )
                wear = a.part("StepTreadWear")
                worn_edges(wear, (0, -3.45), 1.65, 0.19, count=18)


def refs():
    c = collection("REF")
    c.hide_render = True
    vs = [(x, y, 0) for y in range(-10, 11) for x in range(-10, 11)]
    edges = []
    for y in range(21):
        for x in range(21):
            k = y * 21 + x
            if x < 20:
                edges.append((k, k + 1))
            if y < 20:
                edges.append((k, k + 21))
    me = bpy.data.meshes.new("REF_Grid_mesh")
    me.from_pydata(vs, edges, [])
    o = bpy.data.objects.new("REF_Grid", me)
    c.objects.link(o)
    dummy = bpy.data.materials.new("Reference")
    dummy.diffuse_color = (0.4, 0.4, 0.4, 1)
    p = Part("REF_Biped", c, {"Hull": dummy}, 512, 1024)
    p.box((0, 0, 1.15), (0.42, 0.23, 0.53))
    p.box((0, 0, 1.735), (0.22, 0.21, 0.23))
    for x in [-0.115, 0.115]:
        p.box((x, 0, 0.46), (0.15, 0.16, 0.92))
    for s in [-1, 1]:
        p.tube(
            [(s * 0.22, 0, 1.38), (s * 0.44, 0, 1.08), (s * 0.52, 0, 0.92)],
            0.065,
            sides=8,
            role="Hull",
        )
    p.finish()


def markers(root, variant, kind):
    multi = variant != root.name
    c = collection(variant, root) if multi else root
    mats = {
        "Dark": bpy.data.materials.get("Collider") or bpy.data.materials.new("Collider")
    }

    def col(name, center, size):
        p = Part("COL_" + variant + "_" + name, c, mats, 256, 2048)
        p.box(center, size, "Dark")
        o = p.finish()
        o.hide_render = True
        o.display_type = "WIRE"

    if kind.startswith("outpost"):
        index = int(kind[-1])
        # Separate shallow perimeter segments keep the whole 24 m landing disc traversable.
        for i in range(16):
            t = math.tau * i / 16
            if abs(math.sin(t) + 1) < 0.02:
                continue
            x, y = 12.18 * math.cos(t), 12.18 * math.sin(t)
            col("PadEdge" + str(i), (x, y, 0.1), (0.20, 0.20, 0.20))
        if index == 0:
            col("Shelter", (0, 18.5, 2.8), (9.2, 7.8, 5.3))
        elif index == 1:
            col("West", (-4.6, 18.3, 2.5), (4.3, 7.3, 4.3))
            col("East", (4.6, 18.9, 2.5), (4.3, 6.1, 4.3))
            col("Link", (0, 16.3, 1.7), (4.9, 4.0, 3.1))
        else:
            col("Wing", (-3.8, 18.1, 1.7), (6.0, 6.8, 3.1))
            col("Tower", (3.1, 19.3, 3.4), (4.0, 5.7, 6.5))
        empty("Interact", c, (1.55, 13.60, 1.50))
        empty(
            "Light_Entry",
            c,
            (0, 13.95, 2.95),
            {"color": [1, 0.55, 0.16], "intensity": 0.9, "distance": 6},
        )
    elif kind.startswith("beacon"):
        height = 18.2 if kind == "beacon_0" else 9.7
        col("Mast", (0, 0, height / 2), (1.1, 1.1, height))
        col("Platform", (0, 0, 0.15), (5.4, 5.4, 0.30))
        empty("Interact", c, (1.1, -2.22, 1.32))
        empty(
            "Light_1",
            c,
            (0, 0, height),
            {"color": [0.949, 0.549, 0.157], "intensity": 2.2, "distance": 34},
        )
        # Each LOD contains its own pivot/lens, so lamps simplify and don't bypass LOD selection.
    elif kind in ["cargo_pod", "loot_pod"]:
        col("Body", (0, 0, 0.82), (1.55, 1.85, 1.50))
        empty("Interact", c, (0, -1.22, 0.9))
    elif kind == "terminal":
        col("Body", (0, 0.07, 0.90), (0.88, 0.58, 1.8))
        empty("Interact_" + variant, c, (0, -0.55, 1.4))
    elif kind == "market_stall":
        col("Counter", (0, 0, 0.51), (2.95, 1.2, 1.02))
        empty("Interact_" + variant, c, (0, -0.93, 1.05))
    elif kind == "ammo":
        torpedo = variant.endswith("torpedo")
        col(
            "Carry", (0, 0, 0.26), (1.60, 0.50, 0.52) if torpedo else (0.48, 0.35, 0.55)
        )
        empty("Interact_" + variant, c, (0, 0, 0.50 if torpedo else 0.54))
    elif kind == "catalyst_vial":
        col("Vial", (0, 0, 0.16), (0.16, 0.16, 0.33))
        empty("Interact_" + variant, c, (0, 0, 0.33))
    else:
        sizes = {
            "plate": (2.6, 1.9, 0.32),
            "shard": (1.5, 1.1, 0.22),
            "rim": (5.5, 1, 0.35),
            "scorch": (5.2, 2.7, 0.2),
        }
        size = sizes[variant.split("_")[-1]]
        col("Piece", (0, 0.1, size[2] / 2), size)
        empty("Interact_" + variant, c, (0, 0, 0.23))
    return c


def author(stem):
    family, variants = INVENTORY[stem]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.render.threads_mode = "FIXED"
    bpy.context.scene.render.threads = 2
    bpy.context.preferences.filepaths.save_version = 0
    refs()
    root = collection(stem)
    counts = {}
    palettes = {}
    for variant in variants:
        owner = (
            "chorus"
            if stem == "catalyst_vial"
            else (
                "reaches"
                if variant.endswith("reaches")
                or stem == "loot_pod"
                or variant.endswith("shard")
                else "compact"
            )
        )
        if owner not in palettes:
            palettes[owner] = make_palette(
                ROOT, owner, 2048 if family == "sites" else 1024, owner
            )
        mats = palettes[owner]
        if stem == "catalyst_vial":
            mats = dict(mats)
            glass = mats["Glass"].copy()
            glass.name = "LIB_T08_" + variant + "_Glass"
            glass["engine_name"] = variant + "_Glass"
            tone = {
                "frostglass": (0.16, 0.15, 0.12),
                "stormquartz": (0.038, 0.035, 0.105),
                "gamma": (0.11, 0.075, 0.025),
                "acidsalt": (0.12, 0.10, 0.047),
            }[variant.split("_")[-1]]
            bsdf = next(n for n in glass.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            bsdf.inputs["Base Color"].default_value = (*tone, 1)
            bsdf.inputs["Roughness"].default_value = {
                "frostglass": 0.27,
                "stormquartz": 0.09,
                "gamma": 0.22,
                "acidsalt": 0.34,
            }[variant.split("_")[-1]]
            glass.diffuse_color = (*tone, 1)
            mats["Glass"] = glass
        vc = markers(root, variant, stem)
        counts[variant] = []
        for lod in range(4):
            c = collection(f"{variant}_LOD{lod}", vc)
            a = Layout(variant, lod, c, mats, family == "sites")
            if stem in ["cargo_pod", "loot_pod"]:
                pod(a, stem == "loot_pod")
            elif stem == "terminal":
                terminal(a)
            elif stem == "market_stall":
                stall(a)
            elif stem == "ammo":
                ammo(a, variant.endswith("torpedo"))
            elif stem == "catalyst_vial":
                vial(a, variant.split("_")[-1])
            elif stem == "crash_debris":
                debris(a, variant.split("_")[-1])
            elif stem.startswith("outpost"):
                outpost(a, int(stem[-1]))
            else:
                beacon(a, int(stem[-1]))
            objects = a.finish()
            if stem.startswith("beacon"):
                h = 18.2 if stem == "beacon_0" else 9.7
                blink = empty("Blink_" + variant + "_L" + str(lod), c, (0, 0, h))
                p = Part(variant + "_SignalLens_L" + str(lod), c, mats, 256, 2048)
                p.lathe(
                    (0, 0, h),
                    [(-0.23, 0.52), (0.23, 0.52)],
                    "Lamp",
                    [24, 16, 8, 6][lod],
                )
                lens = p.finish()
                lens.parent = blink
                lens.matrix_parent_inverse = blink.matrix_world.inverted()
                bpy.context.view_layer.update()
                # Geometry is already world-space; preserve that after parenting.
                lens.matrix_parent_inverse = Matrix.Translation((0, 0, -h))
                objects.append(lens)
            for o in objects:
                o.data.calc_loop_triangles()
            counts[variant].append(sum(len(o.data.loop_triangles) for o in objects))
            if lod > 0:
                c.hide_render = True
    for c in bpy.context.scene.collection.children:
        if c.name == "REF":
            c.hide_render = True
    path = ROOT / "assets/blend" / family / (stem + ".blend")
    path.parent.mkdir(parents=True, exist_ok=True)
    for lib in bpy.data.libraries:
        if lib.filepath.endswith("_library.blend"):
            lib.filepath = "//../_library.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    print("SAVED", path, "TRIANGLES", json.dumps(counts), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("stem", choices=list(INVENTORY))
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    author(args.stem)
