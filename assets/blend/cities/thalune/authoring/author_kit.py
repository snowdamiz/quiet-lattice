"""Explicit Sarelun modelling sessions. NOT an export step. Existing sources require --replace.

Each recipe composes a distinct building or piece, then saves editable parts and four
LODs. Export consumes those files without importing this module or studio.py.
"""
import argparse
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[4] / "packages/tools/blender"))
import bpy
import numpy as np
from studio import Studio, reset, save, HOME, ROOT, PEARL, RIB, TIDE, PATH, BRONZE, BASALT, CORAL, INLAY, TAU


def public_base(s, rx, ry, floor=.36):
    s.deck(rx, ry, floor)
    # Broad, flush approach slab and shallow ramp; service openings keep a 3 m centre line.
    s.block("EntryApron", (0, -ry + 1, .09), (3.2, 4, .18), PATH)
    s.block("EntryApron", (0, -ry + 1, .09), (3.2, 4, .18), collision=True)
    s.marker("Interact_Service", (0, -ry + 2, floor + 1.1))
    s.routes.append({"from": [0, -ry - 1, floor], "to": [0, 0, floor], "width": 3, "height": 3.2})
    for sign in (-1, 1):
        s.lantern(sign * 2.3, -ry + 1, floor, .66)


def clerestory(s, rx, ry, z, height, center=(0, 0), n=16):
    # Opaque, recessed glazing strips nestled between structural ribs.
    for k in range(n):
        a = TAU * k / n
        pts = [(center[0] + rx * math.cos(a + t), center[1] + ry * math.sin(a + t), z)
               for t in np.linspace(-.07, .07, 5)]
        s.tube("RecessedPearlWindow", pts, height, TIDE, sides=8)
        s.tube("WindowNacreInner", [(x * .999, y * .999, zz + height * .15) for x, y, zz in pts], height * .45, glow=True, sides=8)


def residential(level):
    reset()
    heights = {"low": [8.2, 10.4, 12.2, 13.6], "mid": [24, 32, 46, 58], "tall": [184, 224, 264, 308]}[level]
    titles = {"low": ["Hinge Court", "Paired Tide Houses", "Three Shell Courtyard", "Lantern House"],
              "mid": ["Tide Archive", "Twin Balcony House", "Conch Terrace", "Estuary Hall"],
              "tall": ["Crown of the Shelf", "Sister Shells", "Turning Tide", "Three Currents"]}[level]
    items = []
    for variant, height in enumerate(heights):
        s = Studio(f"thalune_{level}_{variant}", "building", level, titles[variant])
        rx, ry = ((7.0, 6.0) if level == "low" else (8.2, 7.0) if level == "mid" else (9.2, 8.0))
        public_base(s, rx, ry)
        s.arcade(rx * .8, ry * .8, top=3.8)
        s.rooms(rx * .78, ry * .78)
        if level == "low":
            if variant == 0:
                s.shell("HingeVault", (0, .2), 6.5, 5.8, 3.8, height - 3.8, ribs=17, tilt=.25)
            elif variant == 1:
                s.shell("NorthValve", (-2.5, .7), 3.8, 5.2, 3.8, height - 3.8, ribs=13)
                s.shell("SouthValve", (2.6, -.2), 3.7, 4.4, 3.8, 4.1, ribs=11)
            elif variant == 2:
                for x, y, scale, h in [(-3.5, -.4, 3.0, 5), (3.5, -.4, 3.0, 5.8), (0, 2.4, 4.2, height - 3.8)]:
                    s.shell("CourtyardValve", (x, y), scale, 3.1, 3.8, h, ribs=11)
            else:
                s.shell("BroadSkirt", (0, 0), 6.6, 5.8, 3.8, 4.6, ribs=19)
                s.loft("LanternDrum", [(7.2, 2.0, 1.8, 0, 0), (10.6, 1.65, 1.5, 0, 0)], lane=RIB, n=64)
                clerestory(s, 1.7, 1.55, 10.0, .32, n=12)
                s.shell("LanternCrown", (0, 0), 2.3, 2.1, 10.6, 3, ribs=13)
        else:
            # Shape profiles are different for each silhouette; the shell never becomes an exposed lattice.
            if variant == 0:
                profile = [(3.8, .72), (.12 * height, .79), (.28 * height, .91),
                           (.52 * height, .86), (.76 * height, .61), (.90 * height, .33)]
                body(s, "SingleValve", profile, rx * .87, ry * .87)
                s.shell("Crown", (0, 0), rx * .42, ry * .40, .89 * height, .11 * height, ribs=17)
            elif variant == 1:
                for x, fac, w in [(-3.4, 1.0, .45), (3.6, .76, .43)]:
                    profile = [(3.8, .8), (.18 * height * fac, 1.0), (.43 * height * fac, .95),
                               (.72 * height * fac, .68), (.91 * height * fac, .35)]
                    body(s, "SisterValve", profile, rx * w, ry * .66, (x, .8))
                    s.shell("SisterCrown", (x, .8), rx * w * .47, ry * .34, .90 * height * fac, .10 * height * fac, ribs=11)
                s.shell("ConnectingMantle", (0, .1), rx * .85, ry * .75, height * .22, height * .065, ribs=17)
            elif variant == 2:
                profile = [(3.8, .62), (.15 * height, .72), (.40 * height, .63), (.65 * height, .5), (.9 * height, .24)]
                body(s, "ConchCore", profile, rx, ry)
                for k, (fraction, width) in enumerate([(.17, .97), (.32, .86), (.48, .75), (.64, .61), (.78, .45)]):
                    a = k * 1.24
                    s.shell("TurningTerrace", (math.cos(a) * 1.2, math.sin(a) * 1.2), rx * width, ry * width,
                            height * fraction, height * .073, ribs=13, tilt=.25)
                s.shell("ConchCrown", (0, 0), rx * .29, ry * .29, height * .9, height * .10, ribs=11)
            else:
                for x, y, fac, r in [(-3.4, .8, .68, .42), (3.2, 1.2, .84, .42), (0, -1.7, 1.0, .5)]:
                    profile = [(3.8, .82), (.20 * height * fac, .97), (.48 * height * fac, .84), (.82 * height * fac, .40)]
                    body(s, "CurrentValve", profile, rx * r, ry * r, (x, y))
                    s.shell("CurrentCrown", (x, y), rx * r * .53, ry * r * .53, height * fac * .82, height * fac * .18, ribs=11)
        clerestory(s, rx * .79, ry * .79, 3.55, .16, n=16)
        e = s.finish()
        e["planner"] = {"class": ["low", "mid", "tall"].index(level), "variant": variant,
                        "policy": "choose only slots whose foot >= footprintRadius; preserve metre-scale base; do not rescale the whole building to planner height"}
        items.append(e)
    save("thalune_" + level, items)


def body(s, label, profile, rx, ry, center=(0, 0)):
    profile = [(max(z, 3.8 + .3 * i), radius) for i, (z, radius) in enumerate(profile)]
    dense = []
    for (a, ra), (b, rb) in zip(profile, profile[1:]):
        for t in np.linspace(0, 1, 8, endpoint=False):
            ease = t * t * (3 - 2 * t)
            dense.append((a + (b - a) * t, rx * (ra + (rb - ra) * ease), ry * (ra + (rb - ra) * ease), 0, 0))
    z, r = profile[-1]
    dense.append((z, rx * r, ry * r, 0, 0))
    s.loft(label, dense, center, PEARL, n=64, ribs=.012)
    for k in range(13):
        a = TAU * k / 13
        pts = [(center[0] + x * math.cos(a), center[1] + y * math.sin(a), z) for z, x, y, dx, dy in dense]
        s.tube(label + "GrowthRib", pts, .10 + rx * .018, RIB, sides=10)
    for z, r in profile[1:-1]:
        s.tube(label + "LapCollar", [(center[0] + rx * r * math.cos(a), center[1] + ry * r * math.sin(a), z)
                                    for a in np.linspace(0, TAU, 65)], .13, BRONZE)
        clerestory(s, rx * r * 1.005, ry * r * 1.005, z - .4, .17, center, n=12)
    # Separate tapering collision hulls above the arcade. No ground-level blockage.
    s.loft(label, [(z, x, y, dx, dy) for z, x, y, dx, dy in dense[::8]] + [dense[-1]], center, n=12, collision=True)


def civic():
    reset()
    items = []
    specs = [("plaza", "Tide Exchange Plaza"), ("market_hall", "The Open Shell Market"),
             ("skill_house", "House of Second Breath"), ("compact_office", "Compact Passage Archive"),
             ("listening_house", "Chorus House of Returning Water"), ("shipyard", "Shelf Shipwrights"),
             ("salvage_yard", "Beached Hull Salvage Court"), ("tide_hall", "Stilt Hall of the Tide Council")]
    for role, title in specs:
        s = Studio("thalune_" + role, "building", role, title)
        if role == "plaza":
            public_base(s, 24, 24, .18)
            for r in (7, 14, 22):
                s.tube("ConcentricShellInlay", [(r * math.cos(t), r * math.sin(t), .195) for t in np.linspace(0, TAU, 193)], .08, INLAY, sides=10)
            for i in range(8):
                a = (i + .5) * TAU / 8
                x, y = 19 * math.cos(a), 19 * math.sin(a)
                s.shell("CouncilSeatShell", (x, y), 2.3, 1.3, .45, .25, ribs=9, segments=32, rings=8)
                s.lantern(x, y, .18)
            s.marker("Interact_RecallPlaza", (0, 0, 1.2))
            s.routes = [{"from": [-23, 0, .18], "to": [23, 0, .18], "width": 3, "height": 5},
                        {"from": [0, -23, .18], "to": [0, 23, .18], "width": 3, "height": 5}]
        elif role in ("shipyard", "salvage_yard"):
            public_base(s, 21 if role == "shipyard" else 18, 18, .18)
            # A clear 24 m hull cradle with paired workshop shells, not a dummy hull.
            for x in ((-15, 15) if role == "shipyard" else (-14,)):
                s.arcade(3, 7, top=4.5, center=(x, 3), bays=8)
                s.shell("ShipwrightWorkshop", (x, 3), 3.5, 8, 4.5, 4.7, ribs=15)
            for x in (-7, 7):
                s.tube("CradleRunner", [(x, y, .35 + .02 * (y + 10)) for y in np.linspace(-10, 10, 50)], .20, BRONZE, sides=12)
            for y in ((7, 12) if role == "shipyard" else (11,)):
                pts = [(12 * math.cos(t), y, 4.5 + 6 * math.sin(t)) for t in np.linspace(0, math.pi, 65)]
                s.tube("ShellLiftArch", pts, .42, RIB, sides=16)
                for x in (-12, 12):
                    s.pier(x, y, 4.5, .52)
            if role == "salvage_yard":
                # Sorted salvaged valves are separate authored objects in an open
                # workshop court; this is not a second copy of the shipwright hall.
                for y, span, h in [(-5, 3.6, 1.2), (1, 3.1, 1.8), (7, 2.5, 2.4)]:
                    s.block("SalvageRack", (13, y, .48), (4.2, 3.4, .6), RIB)
                    s.block("SalvageRack", (13, y, .48), (4.2, 3.4, .6), collision=True)
                    s.shell("RecoveredShellPlate", (13, y), span, 2.3, .8, h, ribs=11)
                s.block("SortingBench", (-9, -8, .75), (6, 1.6, 1.14), PEARL)
                s.block("SortingBench", (-9, -8, .75), (6, 1.6, 1.14), collision=True)
                s.marker("Interact_SalvageAssessment", (-9, -9.5, 1.2))
            s.marker("Interact_Yardmaster", (-13, -7, 1.25))
            s.marker("BAY_Cradle", (0, 1, .18), diameter=24)
            s.routes = [{"from": [0, -17, .18], "to": [0, 5, .18], "width": 6, "height": 4.5}]
        else:
            public_base(s, 13, 11)
            s.arcade(10, 8.5, top=4.6, bays=16)
            if role == "market_hall":
                for x in (-6, 0, 6):
                    s.shell("MarketLeaf", (x, 1), 6.1, 9.5, 4.6, 5.8 + (2 if x == 0 else 0), ribs=15, tilt=.4)
                for x in (-7, 7):
                    for y in (-3, 2, 6):
                        s.block("VendorCounter", (x, y, .87), (2.4, 1.2, 1.02), PEARL)
                        s.block("VendorCounter", (x, y, .87), (2.4, 1.2, 1.02), collision=True)
                        s.marker("Interact_Vendor_" + str(s.serial), (x + (1.7 if x < 0 else -1.7), y, 1.35))
            elif role == "skill_house":
                s.shell("TeachingValve", (-3, 1), 8.4, 8, 4.6, 9.2, ribs=19)
                s.shell("PracticeValve", (6.6, 1.5), 4.3, 6.2, 4.6, 5.7, ribs=13)
                for i in range(5):
                    s.loft("PracticeBasin", [(.36, .8, .8, 0, 0), (.8, 1, 1, 0, 0)], (6, -3 + i * 1.7), RIB, n=48)
                s.marker("Interact_SkillMaster", (-4, -1, 1.5))
            elif role == "compact_office":
                s.shell("RecordVault", (0, 1), 11, 8.3, 4.6, 10, ribs=21)
                s.loft("ArchiveLantern", [(12, 3, 2.8, 0, 0), (18, 2.4, 2.2, 0, 0)], lane=RIB, n=64)
                s.shell("ArchiveCap", (0, 0), 3.3, 3.0, 18, 2.7, ribs=13)
                s.block("PassageRecordsBoard", (5, -6, 1.6), (3, .4, 2.3), TIDE)
                s.marker("Interact_QuestBoard", (5, -7, 1.4))
                s.marker("Interact_CompactClerk", (-4, -1, 1.4))
            elif role == "listening_house":
                s.shell("ListeningConch", (0, 1), 10.9, 9, 4.6, 12.8, ribs=23, tilt=.7)
                s.shell("InnerResonator", (0, 1.2), 4.5, 4.2, 15, 5, ribs=17)
                for x in (-6, 6):
                    s.tube("ResonanceBowl", [(x + 2.2 * math.cos(t), 3 + 2.2 * math.sin(t), 1.2) for t in np.linspace(0, TAU, 65)], .38, BRONZE, sides=16)
                s.marker("Interact_Listener", (0, 3, 1.4))
            else:
                for y, width, h in [(-3, 11.5, 7), (2, 9, 9), (6, 6, 11)]:
                    s.shell("CouncilLappedValve", (0, y), width, 5, 4.6, h, ribs=19, tilt=.35)
                s.marker("Interact_Speaker", (0, 5, 1.4))
            clerestory(s, 10, 8.5, 4.25, .18, n=20)
        items.append(s.finish())
    save("thalune_civic", items)


def waterfront():
    reset()
    items = []
    for kind in ("straight", "curve", "steps"):
        s = Studio("wall_thalune_" + kind, "kit", "wall", "Battered seawall: " + kind)
        if kind == "curve":
            pts = [(12 * math.sin(t), 12 * (1 - math.cos(t)), 0) for t in np.linspace(-.65, .65, 33)]
        else:
            pts = [(x, 0, 0) for x in np.linspace(-8, 8, 33)]
        # Hand-shaped battered cross-section, tide band and upper walk.
        vs, uv, fs = [], [], []
        profile = [(-1.8, 0), (-1.7, .7), (-1.05, 2.6), (-.85, 3.6), (.85, 3.6), (1.05, 2.6), (1.7, .7), (1.8, 0)]
        for i, (x, y, z) in enumerate(pts):
            for j, (dy, zz) in enumerate(profile):
                vs.append((x, y + dy, zz))
                uv.append((i / 32, j / 7))
        for i in range(32):
            for j in range(7):
                a = i * 8 + j
                fs.append((a, a + 8, a + 9, a + 1))
        fs += [tuple(reversed(range(8))), tuple(32 * 8 + j for j in range(8))]
        s.mesh("BatteredStone", vs, fs, TIDE, uv)
        # Collider uses the same cross-section, sampled coarsely below the 512-tri limit.
        vc, fc = [], []
        for x, y, z in pts[::4]:
            vc.extend((x, y + dy, zz) for dy, zz in profile)
        for i in range(8):
            for j in range(7):
                a = i * 8 + j
                fc.append((a, a + 8, a + 9, a + 1))
        fc += [tuple(reversed(range(8))), tuple(64 + j for j in range(8))]
        s.mesh("WallHull", vc, fc, collision=True)
        for side in (-1, 1):
            s.tube("LappedCoping", [(x, y + side * .82, 3.65) for x, y, z in pts], .17, PEARL, sides=16)
            s.tube("SaltTideLip", [(x, y + side * 1.55, .95) for x, y, z in pts], .08, INLAY, sides=12)
        for x, y, z in pts[::4]:
            s.tube("ButtressRib", [(x, y - 1.75, .2), (x, y - 1.4, 1.5), (x, y - .85, 3.5)], .21, RIB, sides=12)
        if kind == "steps":
            for k in range(20):
                s.block("TidalStep", (0, -1.8 - .3 * (19 - k), .09 * (k + 1)), (3, .32, .18 * (k + 1)), PATH, bevel=.04)
                s.block("Step", (0, -1.8 - .3 * (19 - k), .09 * (k + 1)), (3, .32, .18 * (k + 1)), collision=True)
            s.clearances.append({"stepRise": .18, "stepGoing": .30, "width": 3, "height": 4})
        items.append(s.finish())
    for kind in ("land", "water"):
        s = Studio("gate_thalune_" + kind, "kit", "gate", "Shell gate: " + kind)
        width = 4 if kind == "land" else 8
        top = 4.0 if kind == "land" else 7.0
        for x in (-width / 2 - .8, width / 2 + .8):
            s.pier(x, 0, top, .75)
            s.shell("GatePierCrown", (x, 0), 1.1, 1.4, top, 1.1, ribs=9, segments=32, rings=8)
        for y in (-.7, .7):
            pts = [(width / 2 * math.cos(t), y, top + 1.8 * math.sin(t)) for t in np.linspace(0, math.pi, 49)]
            s.tube("OverlappingArch", pts, .45, PEARL, sides=16)
        s.block("GateBridgeLintel", (0, 0, top + 1.1), (width + 1, 2, .3), PEARL)
        s.block("ArchHighCollision", (0, 0, top + 1.1), (width + 1, 2, .3), collision=True)
        for x in (-width / 2 - .8, width / 2 + .8):
            s.lantern(x, 0, top + .8, .7)
        s.clearances.append({"width": width - .1, "height": top - .5, "floor": 0, "entry": [0, -2, 0]})
        s.routes = [{"from": [0, -3, 0], "to": [0, 3, 0], "width": 3, "height": 3.2}]
        s.marker("Interact_Gate", (width / 2 + .3, -1.1, 1.2))
        items.append(s.finish())
    for kind in ("flat", "arch"):
        s = Studio("bridge_thalune_" + kind, "kit", "bridge", "Canal bridge: " + kind)
        length, width = (20, 4.5) if kind == "flat" else (28, 6)
        z = lambda y: .36 + (0 if kind == "flat" else .85 * math.sin(math.pi * (y / length + .5)) ** 2)
        vs, uv, fs = [], [], []
        for i, y in enumerate(np.linspace(-length / 2, length / 2, 65)):
            for x, dz in [(-width / 2, -.3), (width / 2, -.3), (width / 2, 0), (-width / 2, 0)]:
                vs.append((x, y, z(y) + dz))
                uv.append((i / 64, (x / width + .5) * .8 + .1))
        for i in range(64):
            for j in range(4):
                a = i * 4 + j
                fs.append((a, i * 4 + (j + 1) % 4, (i + 1) * 4 + (j + 1) % 4, a + 4))
        fs += [(3, 2, 1, 0), (256, 257, 258, 259)]
        s.mesh("BridgeWalkingSurface", vs, fs, PATH, uv, smooth=False)
        bridge_deck_collision(s, length, width)
        for side in (-1, 1):
            for dz, rad, lane in [(1.05, .09, BRONZE), (.55, .12, PEARL), (-.1, .22, RIB)]:
                s.tube("BridgeShellRail", [(side * width / 2, y, z(y) + dz) for y in np.linspace(-length / 2, length / 2, 65)], rad, lane, sides=12)
            for y in np.linspace(-length / 2, length / 2, 15):
                s.tube("BridgeBaluster", [(side * width / 2, y, z(y)), (side * width / 2, y, z(y) + 1.05)], .08, RIB)
            for y in (-length / 2 + .5, length / 2 - .5):
                s.lantern(side * width / 2, y, z(y), .6)
        bridge_rail_collision(s, length, width)
        s.clearances.append({"width": width - .44, "height": 20, "floor": .36, "railingHeight": 1.05})
        s.routes = [{"from": [0, -length / 2, .36], "to": [0, length / 2, .36], "width": 3, "height": 3.2}]
        s.marker("Interact_Bridge", (width / 2 - .7, -length / 2 + 1, 1.5))
        items.append(s.finish())
    for diameter in (24, 36):
        s = Studio("kit_thalune_pad_" + str(diameter), "kit", "landing_pad", f"{diameter} metre shell pad")
        r = diameter / 2
        s.deck(r + 1.2, r + 1.2, .18)
        for radius in (r, r + .8):
            s.tube("PadBoundaryInlay", [(radius * math.cos(a), radius * math.sin(a), .195) for a in np.linspace(0, TAU, 129)], .055, INLAY)
        for i in range(8):
            a = TAU * i / 8
            s.tube("PadRadialLap", [(rr * math.cos(a), rr * math.sin(a), .19) for rr in np.linspace(r * .84, r + .9, 16)], .045, RIB)
            # Low diffusers outside the clear landing circle.
            s.tube("PadDiffuser", [((r + .65) * math.cos(a + d), (r + .65) * math.sin(a + d), .25) for d in np.linspace(-.05, .05, 12)], .07, glow=True)
        s.marker("BAY_Landing", (0, 0, .18), diameter=diameter)
        s.marker("Interact_Pad", (0, -r - .6, 1.25))
        s.pad = diameter
        items.append(s.finish())
    for kind in ("single", "double"):
        s = Studio("lamp_thalune_" + kind, "kit", "lamp", "Nacre lantern: " + kind)
        s.loft("Socket", [(0, .55, .55, 0, 0), (.2, .55, .55, 0, 0), (.36, .3, .3, 0, 0)], lane=TIDE, n=48)
        s.loft("Socket", [(0, .5, .5, 0, 0), (.36, .3, .3, 0, 0)], n=12, collision=True)
        if kind == "single":
            s.lantern(0, 0, .36, 1.6)
        else:
            s.tube("CurvedStem", [(0, 0, .2), (0, 0, 1.5), (.2, 0, 2.6), (.5, 0, 3)], .15, RIB, sides=16)
            for x in (-.8, .8):
                s.lantern(x, 0, 1.2, .85)
        s.marker("Interact_Maintenance", (.65, 0, 1))
        items.append(s.finish())
    save("thalune_waterfront", items)


def bridge_rail_collision(s, length, width):
    z = lambda y: .36 + (0 if length == 20 else .85 * math.sin(math.pi * (y / length + .5)) ** 2)
    for side in (-1, 1):
        verts, faces = [], []
        for y in np.linspace(-length / 2, length / 2, 17):
            for dx, dz in [(-.08, 0), (.08, 0), (.08, 1.05), (-.08, 1.05)]:
                verts.append((side * width / 2 + dx, y, z(y) + dz))
        for i in range(16):
            for j in range(4):
                faces.append((i * 4 + j, i * 4 + (j + 1) % 4, (i + 1) * 4 + (j + 1) % 4, (i + 1) * 4 + j))
        faces += [(3, 2, 1, 0), (64, 65, 66, 67)]
        s.mesh("BridgeGuardrail", verts, faces, collision=True)


def bridge_deck_collision(s, length, width):
    z = lambda y: .36 + (0 if length == 20 else .85 * math.sin(math.pi * (y / length + .5)) ** 2)
    verts, faces = [], []
    for y in np.linspace(-length / 2, length / 2, 33):
        for x, dz in [(-width / 2, -.3), (width / 2, -.3), (width / 2, 0), (-width / 2, 0)]:
            verts.append((x, y, z(y) + dz))
    for i in range(32):
        for j in range(4):
            faces.append((i * 4 + j, i * 4 + (j + 1) % 4, (i + 1) * 4 + (j + 1) % 4, (i + 1) * 4 + j))
    faces += [(3, 2, 1, 0), (128, 129, 130, 131)]
    s.mesh("ContinuousDeck", verts, faces, collision=True)


def props():
    reset(1024)
    items = []
    for kind, title in [("bench", "Shell bench"), ("terminal", "Harbour terminal"), ("crate", "Lapped cargo pod"),
                        ("bollard", "Spiral mooring bollard"), ("basin", "Tide basin"), ("stall", "Pearl awning stall")]:
        s = Studio("prop_thalune_" + kind, "prop", "prop", title)
        if kind == "bench":
            for x in (-.8, .8):
                s.pier(x, 0, .34, .18)
            s.loft("Seat", [(.34, 1.45, .28, 0, 0), (.40, 1.45, .28, 0, 0),
                            (.45, 1.36, .25, 0, 0)], lane=PEARL, n=96)
            s.tube("BackShell", [(1.3 * math.cos(t), .35 + .15 * math.sin(t), .48 + .5 * math.sin(t)) for t in np.linspace(0, math.pi, 65)], .14, PEARL, sides=16)
            s.block("Seat", (0, 0, .39), (2.6, .7, .12), collision=True)
            s.marker("Interact_Seat", (0, -.65, .9))
        elif kind == "terminal":
            s.loft("TerminalStem", [(0, .6, .5, 0, 0), (.2, .65, .55, 0, 0), (1.1, .35, .32, 0, 0), (1.45, .7, .45, 0, -.15)], lane=RIB, n=64)
            s.shell("TerminalHood", (0, -.1), .9, .65, 1.45, .38, ribs=13)
            s.block("InlaidScreen", (0, -.53, 1.25), (.92, .06, .46), TIDE, bevel=.06)
            for x in (-.3, 0, .3):
                s.tube("StatusNacre", [(x, -.57, 1.23), (x, -.57, 1.4)], .035, glow=True)
            s.block("TerminalHull", (0, 0, .7), (1, .8, 1.4), collision=True)
            s.marker("Interact_Terminal", (0, -1.0, 1.25))
        elif kind == "crate":
            s.loft("CargoBelly", [(0, 1, .7, 0, 0), (.22, 1.15, .82, 0, 0), (.8, 1.12, .8, 0, 0)], lane=RIB, n=64)
            s.shell("CargoValve", (0, 0), 1.15, .82, .8, .65, ribs=17)
            for x in (-.85, .85):
                s.tube("PolishedHandle", [(x, -.7, .6), (x, -.92, .7), (x, -.92, 1), (x, -.7, 1.05)], .07, BRONZE, sides=12)
            s.loft("CargoHull", [(0, 1.1, .8, 0, 0), (1.35, .85, .6, 0, 0)], n=16, collision=True)
            s.marker("Interact_Cargo", (0, -1.3, 1))
        elif kind == "bollard":
            s.loft("MooringSocket", [(0, .7, .7, 0, 0), (.3, .65, .65, 0, 0), (.8, .28, .28, 0, 0)], lane=TIDE, n=64)
            pts = [(math.cos(t) * (.48 - .03 * t), math.sin(t) * (.48 - .03 * t), .6 + .045 * t) for t in np.linspace(0, math.pi * 3.5, 129)]
            s.tube("WornSpiralHorn", pts, .16, BRONZE, sides=16)
            s.loft("MooringHull", [(0, .65, .65, 0, 0), (1.2, .3, .3, 0, 0)], n=12, collision=True)
            s.marker("Interact_Mooring", (.9, 0, .9))
        elif kind == "basin":
            s.loft("BasinFoot", [(0, .6, .6, 0, 0), (.35, .48, .48, 0, 0)], lane=RIB, n=64)
            # Open vessel with a real return lip, not a capped solid cylinder.
            prof = [(.3, .4, .4, 0, 0), (.5, .85, .85, 0, 0), (.85, 1, 1, 0, 0),
                    (.9, .94, .94, 0, 0), (.55, .72, .72, 0, 0), (.38, .2, .2, 0, 0)]
            dense = []
            for a, b in zip(prof, prof[1:]):
                for t in np.linspace(0, 1, 5, endpoint=False):
                    dense.append(tuple(a[i] + (b[i] - a[i]) * t for i in range(5)))
            s.loft("CarvedShellBasin", dense + [prof[-1]], lane=PEARL, n=96)
            s.loft("BasinHull", [(0, .65, .65, 0, 0), (.9, 1, 1, 0, 0)], n=16, collision=True)
            s.marker("Interact_Basin", (0, -1.2, .95))
        else:
            for x in (-1.4, 1.4):
                for y in (-.7, .7):
                    s.pier(x, y, 2.7, .12)
            s.shell("StallAwning", (0, 0), 1.9, 1.35, 2.7, .75, ribs=13)
            s.block("WornMarketCounter", (0, .2, .55), (2.8, 1, 1.1), PEARL)
            s.block("CounterHull", (0, .2, .55), (2.8, 1, 1.1), collision=True)
            for i in (-1, 0, 1):
                s.loft("DisplayDish", [(1.1, .2, .2, 0, 0), (1.25, .35, .35, 0, 0)], (i * .75, .2), CORAL, n=40)
            s.marker("Interact_Vendor", (0, -1.1, 1.25))
        items.append(s.finish())
    save("thalune_props", items)


def anchor():
    reset(4096)
    s = Studio("anchor_sarelun", "hero", "anchor", "The Tide Remembers — shoal anchor")
    # Eroded basalt back and sides. Hand-shaped broad monolith, not a Thalune shell copy.
    profile = []
    for i in range(193):
        z = 49 * i / 192
        t = z / 49
        radius = 1 - .23 * t + .055 * math.sin(t * 9) - .3 * max(0, (t - .87) / .13)
        profile.append((z, 4.2 * radius, 2.8 * radius, .3 * math.sin(t * 4), .7))
    s.loft("WeatheredAnchorCore", profile, lane=BASALT, n=128, ribs=.013)
    # The front tablet is cut into discrete V-section channels using boolean cuts.
    s.block("InscribedFace", (0, -1.75, 26), (6.2, .7, 38), BASALT, bevel=.24)
    face = list(s.lod.objects)[-1]
    signs = {letter: re.findall(r"[SR][0-5]", strokes) for letter, strokes in re.findall(r"letter: '([^']+)', strokes: \[([^\]]*)\]", (ROOT / "packages/shared/src/art/glyphs.ts").read_text())}
    for row, letter in enumerate("sarelun"):
        z = 41 - row * 4.4
        for stroke in signs[letter]:
            i = int(stroke[1])
            def node(k):
                a = math.pi / 2 - k * math.pi / 3
                return (1.3 * math.cos(a), 1.3 * math.sin(a))
            a = (0, 0) if stroke[0] == "S" else node(i)
            b = node(i if stroke[0] == "S" else (i + 1) % 6)
            # Incised channel made with a rotated square cutter, 3 cm below the face.
            pts = [(a[0] + (b[0] - a[0]) * t, -2.095, z + a[1] + (b[1] - a[1]) * t) for t in np.linspace(0, 1, 9)]
            cutter = s.tube("GlyphCutTool", pts, .104, BASALT, sides=4)
            for vertex in cutter.data.vertices:
                vertex.co.y = -2.11 + (vertex.co.y + 2.095) * .35
            mod = face.modifiers.new("IncisedGlyph", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.object = cutter
            with bpy.context.temp_override(object=face, active_object=face):
                bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cutter, do_unlink=True)
            s.tube("IncisedGlyphCore", [(x, -2.07, zz) for x, y, zz in pts], .025, glow="glyph", sides=12)
    notch = s.mesh("OrientationNotchTool", [(-.22, y, 45.2) for y in (-2.3, -1.9)] +
                   [(.22, y, 45.2) for y in (-2.3, -1.9)] + [(0, y, 44.45) for y in (-2.3, -1.9)],
                   [(0, 2, 4), (1, 5, 3), (0, 1, 3, 2), (2, 3, 5, 4), (4, 5, 1, 0)], BASALT)
    mod = face.modifiers.new("TopOrientationNotch", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = notch
    with bpy.context.temp_override(object=face, active_object=face):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(notch, do_unlink=True)
    # Radial shoal stones leave the wading approach open; no built bridge to the anchor.
    for i, (r, z, rx, ry) in enumerate([(7.3, .3, 2.4, 1.8), (8.2, .5, 2.2, 1.5), (6.8, .25, 1.7, 2.3),
                                     (7.8, .35, 2.8, 1.6), (9.4, .2, 2.4, 2.0), (6.5, .4, 1.8, 1.4)]):
        a = .15 + i * TAU / 6
        x, y = r * math.cos(a), r * math.sin(a)
        verts, faces, uv = [], [], []
        for ring in range(33):
            t = ring / 32
            section = math.sqrt(max(.001, 1 - t * t))
            for j in range(65):
                angle = TAU * j / 64
                erosion = 1 + .09 * math.cos(3 * angle + i) + .06 * math.sin(5 * angle - .7 * i)
                verts.append((x + rx * section * math.cos(angle) * erosion + .22 * t,
                              y + ry * section * math.sin(angle) * erosion - .18 * t,
                              (z + .6) * t + .07 * math.sin(4 * angle + i) * math.sin(math.pi * t)))
                uv.append((j / 64, t))
        for ring in range(32):
            for j in range(64):
                p = ring * 65 + j
                faces.append((p, p + 1, p + 66, p + 65))
        faces += [tuple(reversed(range(64))), tuple(32 * 65 + j for j in range(64))]
        s.mesh("ErodedShoalBasalt", verts, faces, BASALT, uv)
        s.loft("ShoalRock", [(0, rx, ry, 0, 0), (z + .5, rx * .5, ry * .5, 0, 0)], (x, y), n=12, collision=True)
    s.loft("AnchorHull", [profile[i] for i in (0, 32, 64, 96, 128, 160, 192)], n=16, collision=True)
    s.marker("Interact_Anchor", (0, -4.2, 1.2))
    s.marker("Light_Glyph", (0, -2.4, 24), color="#D8F6FF", intensity=1.1, distance=12)
    s.marker("Interact_Recall", (0, -5, 1.1))
    e = s.finish()
    e["placement"] = "Independent shoal placement, ground z=0 at exposed low-tide shelf; no permanent bridge. Tide simulation belongs to E10.T01."
    save("thalune_anchor", [e])


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("family", choices=["low", "mid", "tall", "civic", "waterfront", "props", "anchor"])
    p.add_argument("--replace", action="store_true")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if (HOME.parent / ("thalune_" + a.family + ".blend")).exists() and not a.replace:
        raise SystemExit("Saved source exists. Edit that blend, or explicitly opt into an authoring replacement.")
    if a.family in ("low", "mid", "tall"):
        residential(a.family)
    else:
        globals()[a.family]()
