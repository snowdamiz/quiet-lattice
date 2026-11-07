"""One-time Ulgani authoring. Saved editable meshes, maps and LODs are the export inputs.

Never imported by the exporter. Re-running requires a new --receipt and an explicit group;
iterative source edits can instead be made directly in Blender and exported unchanged.
"""

import argparse
import hashlib
import json
import math
import sys
from itertools import pairwise
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import lods
from artlib import scene as S

TAU = math.tau
META = ROOT / "assets/blend/cities/ulgani"
SOURCES = ROOT / "assets/blend/cities"
PALETTE = [
    "D9962B",
    "F2EAD3",
    "D9962B",
    "C7AB73",
    "5B4636",
    "CFC4A8",
    "2A2C30",
    "C7F06A",
]


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def curve(a, b, bend=(0, 0, 0.25), steps=10):
    a, b, bend = np.array(a), np.array(b), np.array(bend)
    return [
        a * (1 - t) + b * t + bend * math.sin(math.pi * t)
        for t in np.linspace(0, 1, steps + 1)
    ]


class Mesh:
    def __init__(self):
        self.v, self.f, self.uv, self.smooth, self.parts = [], [], [], [], []

    def piece(self, name, verts, faces, uv, tile=0, smooth=True):
        start = len(self.v)
        self.v.extend([tuple(v) for v in verts])
        self.parts.append((name, start, len(self.v)))
        self.f.extend([tuple(start + i for i in f) for f in faces])
        self.uv.extend(
            [
                tuple(
                    (
                        (tile % 4 + 0.03 + 0.94 * uv[i][0]) / 4,
                        (tile // 4 + 0.03 + 0.94 * uv[i][1]) / 2,
                    )
                    for i in f
                )
                for f in faces
            ]
        )
        self.smooth.extend([smooth] * len(faces))

    def tube(self, name, points, radius, tile=0, sides=10, flatten=1):
        pts = [Vector(p) for p in points]
        vv, ff, uv = [], [], []
        count = len(pts)
        for j, p in enumerate(pts):
            tangent = (pts[min(j + 1, count - 1)] - pts[max(0, j - 1)]).normalized()
            axis = Vector((0, 0, 1)) if abs(tangent.z) < 0.95 else Vector((0, 1, 0))
            u = tangent.cross(axis).normalized()
            v = tangent.cross(u).normalized()
            t = j / (count - 1)
            r = radius(t) if callable(radius) else radius
            # The broadened ends are grown fillets, not mechanical node fittings.
            r *= 1 + 0.48 * (math.exp(-t * 18) + math.exp(-(1 - t) * 18))
            for i in range(sides + 1):
                a = TAU * i / sides
                vv.append(p + r * (u * math.cos(a) + v * math.sin(a) * flatten))
                uv.append((i / sides, t))
        for j in range(count - 1):
            for i in range(sides):
                a = j * (sides + 1) + i
                ff.append((a, a + 1, a + sides + 2, a + sides + 1))
        ff += [
            tuple(range(sides - 1, -1, -1)),
            tuple((count - 1) * (sides + 1) + i for i in range(sides)),
        ]
        self.piece(name, vv, ff, uv, tile)

    def membrane(self, name, points, tile=1, div=10, sag=0.12):
        a, b, c = map(np.array, points)
        normal = np.cross(b - a, c - a)
        normal /= max(np.linalg.norm(normal), 0.001)
        vv, uv, ff, idx = [], [], [], {}
        for j in range(div + 1):
            for i in range(div + 1 - j):
                u, v = i / div, j / div
                w = 1 - u - v
                idx[i, j] = len(vv)
                vv.append(a * w + b * u + c * v + normal * sag * 27 * u * v * w)
                uv.append((0.06 + 0.88 * u, 0.06 + 0.88 * v))
        for j in range(div):
            for i in range(div - j):
                ff.append((idx[i, j], idx[i + 1, j], idx[i, j + 1]))
                if i + j < div - 1:
                    ff.append((idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]))
        self.piece(name, vv, ff, uv, tile)

    def slab(
        self,
        name,
        rx,
        ry,
        z=0.15,
        depth=0.15,
        tile=5,
        n=72,
        offset=(0, 0),
        scallop=0.02,
    ):
        vv, uv, ff = [], [], []
        for zz in (z - depth, z):
            for r in (0, 1):
                for i in range(n):
                    a = TAU * i / n
                    s = 1 + scallop * math.sin(5 * a + 0.7)
                    vv.append(
                        (
                            offset[0] + rx * r * math.cos(a) * s,
                            offset[1] + ry * r * math.sin(a) * s,
                            zz,
                        )
                    )
                    uv.append(
                        (0.5 + 0.46 * r * math.cos(a), 0.5 + 0.46 * r * math.sin(a))
                    )
        for i in range(n):
            k = (i + 1) % n
            ff += [
                (i, n + k, n + i),
                (2 * n + i, 3 * n + i, 3 * n + k),
                (n + i, n + k, 3 * n + k, 3 * n + i),
            ]
        self.piece(name, vv, ff, uv, tile, False)

    def cap(self, name, x, y, z, rx, ry, rise, n=72, rings=14, gills=24, detail=14):
        vv, uv, ff = [], [], []
        for underside in (False, True):
            for j in range(rings + 1):
                r = max(0.001, j / rings)
                for i in range(n + 1):
                    a = TAU * i / n
                    wave = 1 + 0.065 * math.sin(3 * a + 0.7) + 0.025 * math.cos(7 * a)
                    zz = (
                        z
                        + rise * (1 - r**1.45)
                        + rise * 0.18 * math.sin(3 * a + 0.3) * r**5
                        + rise * 0.65 * r * (1 - r) * math.cos(2 * a + 0.4)
                    )
                    if underside:
                        zz -= 0.12 + rise * 0.09 * (1 - r)
                    vv.append(
                        (
                            x + rx * r * math.cos(a) * wave,
                            y + ry * r * math.sin(a) * wave,
                            zz,
                        )
                    )
                    uv.append((i / n, r))
        side = (rings + 1) * (n + 1)
        for s in (0, 1):
            for j in range(rings):
                for i in range(n):
                    a = s * side + j * (n + 1) + i
                    f = (a, a + 1, a + n + 2, a + n + 1)
                    ff.append(f[::-1] if s == 0 else f)
        for i in range(n):
            a = rings * (n + 1) + i
            ff.append((a, a + side, a + side + 1, a + 1))
        self.piece(name + "Skin", vv, ff, uv, 2)
        for i in range(gills):
            a = TAU * i / gills
            points = []
            for r in np.linspace(0.13, 0.985, detail + 1):
                aa = a + 0.035 * math.sin(r * math.pi)
                wave = 1 + 0.065 * math.sin(3 * aa + 0.7) + 0.025 * math.cos(7 * aa)
                points.append(
                    (
                        x + rx * r * math.cos(aa) * wave,
                        y + ry * r * math.sin(aa) * wave,
                        z
                        + rise * (1 - r**1.45)
                        + rise * 0.18 * math.sin(3 * aa + 0.3) * r**5
                        + rise * 0.65 * r * (1 - r) * math.cos(2 * aa + 0.4)
                        - 0.18
                        - rise * 0.1 * (1 - r),
                    )
                )
            self.tube(
                name + f"Gill{i}", points, max(0.035, rx * 0.006), 3, 8, flatten=2
            )
            if i % 6 == 2:
                p = points[-4]
                self.tube(
                    name + f"Spores{i}",
                    curve(p, np.array(p) + (0, 0, -max(0.07, rx * 0.008)), steps=6),
                    max(0.035, rx * 0.004),
                    7,
                    8,
                )

    def object(self, name, collection, material=None):
        me = bpy.data.meshes.new(name + "Mesh")
        me.from_pydata(self.v, [], self.f)
        me.update()
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        if material:
            me.materials.append(material)
        uv = me.uv_layers.new(name="UlganiTrimUV")
        uv.data.foreach_set(
            "uv", np.asarray([p for f in self.uv for p in f], dtype=np.float32).ravel()
        )
        for p, s in zip(me.polygons, self.smooth):
            p.use_smooth = s
        # Each authored construction remains selectable and editable after mesh consolidation.
        for label, a, b in self.parts:
            group = ob.vertex_groups.new(name=label)
            group.add(list(range(a, b)), 1, "REPLACE")
        return ob


def boxmesh(name, lo, hi, collection):
    x, y, z = lo
    X, Y, Z = hi
    b = Mesh()
    b.piece(
        name,
        [
            (x, y, z),
            (X, y, z),
            (X, Y, z),
            (x, Y, z),
            (x, y, Z),
            (X, y, Z),
            (X, Y, Z),
            (x, Y, Z),
        ],
        [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (1, 2, 6, 5),
            (2, 3, 7, 6),
            (3, 0, 4, 7),
        ],
        [(0, 0)] * 8,
    )
    ob = b.object(name, collection)
    ob.hide_render = True
    ob.display_type = "WIRE"
    return ob


class Asset:
    def __init__(self, name, title, role, cls, mat):
        self.id = name
        self.c = coll(name)
        self.c["asset_class"] = cls
        self.c["title"] = title
        self.c["role"] = role
        self.mesh = Mesh()
        self.mat = mat
        self.openings = []
        self.routes = []
        self.markers = []
        self.cols = []
        self.meta = {"id": name, "title": title, "role": role, "class": cls}

    def box(self, label, lo, hi):
        ob = boxmesh("COL_" + self.id + "_" + label, lo, hi, self.c)
        self.cols.append(ob)
        return ob

    def hull(self, label, points, radius):
        m = Mesh()
        m.tube(label, points, radius, sides=6)
        ob = m.object("COL_" + self.id + "_" + label, self.c)
        ob.hide_render = True
        ob.display_type = "WIRE"
        self.cols.append(ob)
        return ob

    def cap_collision(self, label, x, y, z, rx, ry, rise):
        m = Mesh()
        m.cap(label, x, y, z, rx, ry, rise, n=16, rings=5, gills=0)
        ob = m.object("COL_" + self.id + "_" + label, self.c)
        ob.hide_render = True
        ob.display_type = "WIRE"
        self.cols.append(ob)

    def marker(self, role, pos, **props):
        ob = bpy.data.objects.new(role + "_" + self.id, None)
        self.c.objects.link(ob)
        ob.location = pos
        for k, v in props.items():
            ob[k] = v
        self.markers.append(
            {"name": ob.name, "position": list(pos), "properties": props}
        )

    def light(self, pos, energy=0.55, distance=9):
        label = "SporeLantern" + str(len(self.markers))
        p = np.array(pos)
        self.mesh.tube(
            label,
            curve(p - (0, 0, 0.065), p + (0, 0, 0.065), bend=(0, 0, 0), steps=4),
            0.055,
            7,
            8,
        )
        self.mesh.tube(
            label + "Frond",
            curve(p + (0.14, 0.08, 0.25), p, bend=(0.08, 0, 0), steps=5),
            0.018,
            4,
            8,
        )
        self.marker(
            "Light_Spore" + str(len(self.markers)),
            pos,
            color="#C7F06A",
            intensity=energy,
            distance=distance,
        )

    def route(self, a, b, width=3, height=3.2):
        self.routes.append(
            {"from": list(a), "to": list(b), "width": width, "height": height}
        )

    def doorway(self, y, floor=0.18, width=3.4, height=3.4):
        self.openings.append(
            {"center": [0, y, floor], "width": width, "height": height, "axis": "Y"}
        )

    def save_lods(self):
        c = coll(self.id + "_LOD0", self.c)
        ob = self.mesh.object(self.id + "_Surface0", c, self.mat)
        ob["authoring"] = "editable mesh; component vertex groups; painted trim atlas"
        bpy.context.view_layer.update()
        t0 = S.tri_count(ob)
        counts = [t0]
        for n, ratio in enumerate([0.3, 0.1, 0.035], 1):
            target = coll(self.id + f"_LOD{n}", self.c)
            dupe = ob.copy()
            dupe.data = ob.data.copy()
            dupe.name = self.id + f"_Surface{n}"
            target.objects.link(dupe)
            lods._decimate([dupe], max(12, int(t0 * ratio)))
            counts.append(S.tri_count(dupe))
            target.hide_render = True
        lo, hi = S.bounds([ob])
        self.meta.update(
            {
                "bounds": [lo.tolist(), hi.tolist()],
                "height": float(hi[2] - lo[2]),
                "footprintRadius": max(math.hypot(v[0], v[1]) for v in self.mesh.v),
                "lodTriangles": counts,
                "lodNodes": [self.id + f"_LOD{i}" for i in range(4)],
                "openings": self.openings,
                "walkRoutes": self.routes,
                "markers": self.markers,
                "colliders": [o.name for o in self.cols],
            }
        )
        print(self.id, counts, flush=True)
        return self.meta


def make_atlas(res):
    with bpy.data.libraries.load(
        str(SOURCES.parent / "_library.blend"), link=False
    ) as (_src, dst):
        dst.materials = ["LIB_Chitin", "LIB_Membrane", "LIB_CapFlesh", "LIB_Basalt"]
    references = [m.name for m in dst.materials if m]
    mat = bpy.data.materials["LIB_Chitin"].copy()
    mat.name = "Ulgani_PaintedAtlas_" + str(res)
    mat["library_sources"] = ",".join(references)
    mat["atlas_regions"] = "chitin,membrane,cap,gill,root,walk,basalt,spore"
    mat["occlusion_method"] = (
        "painted joint and growth-fold occlusion; no exporter rebake"
    )
    nt = mat.node_tree
    nt.nodes.clear()
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    bs.inputs["Roughness"].default_value = 0.6
    bs.inputs["Emission Strength"].default_value = 0.65
    bs.inputs["Specular IOR Level"].default_value = 0.28
    arrays = {
        name: np.ones((res, res, 4), np.float32)
        for name in ("BaseColor", "ORM", "Normal", "Emissive")
    }
    arrays["Emissive"][:, :, :3] = 0
    w, h = res // 4, res // 2
    u, v = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    for tile, hexcol in enumerate(PALETTE):
        col = np.array([int(hexcol[i : i + 2], 16) / 255 for i in (0, 2, 4)])
        # Authored strokes: directional growth, sheltered joins, one irregular patch and a hand-worn path.
        seam = np.exp(-(((u - (0.22 + 0.08 * np.sin(5 * v))) / 0.012) ** 2))
        vein = np.exp(-(((u - (0.67 - 0.17 * v + 0.04 * np.sin(9 * v))) / 0.008) ** 2))
        edge = np.exp(-v * 18) + np.exp(-(1 - v) * 18)
        patch = ((u - 0.63) / 0.22) ** 2 + ((v - 0.6) / 0.19) ** 2
        patch = np.clip((1 - patch) * 7, 0, 1)
        fine = 0.5 + 0.5 * np.sin((u * 19 + v * 2) * TAU + 0.45 * np.sin(9 * v))
        if tile in (1, 2, 3):
            pattern = 0.85 + 0.025 * fine - 0.13 * seam + 0.1 * patch
            relief = 0.015 * fine + 0.3 * seam + 0.1 * patch
        else:
            pattern = (
                0.82
                + 0.09 * np.cos(v * math.pi)
                - 0.22 * edge
                - 0.18 * vein
                + 0.025 * fine
            )
            relief = 0.018 * fine + 0.5 * vein + 0.24 * edge
        base = np.clip(pattern[:, :, None] * col, 0, 1)
        if tile == 1:
            base = (
                base * (1 - 0.28 * patch[:, :, None])
                + np.array([0.97, 0.94, 0.85]) * 0.28 * patch[:, :, None]
            )
        if tile == 0:
            weather = np.exp(-(((v - 0.78) / 0.16) ** 2)) * 0.22
            base = (
                base * (1 - weather[:, :, None])
                + np.array([0.5, 0.49, 0.43]) * weather[:, :, None]
            )
        rough = np.clip(
            (0.48 if tile == 0 else 0.63) + 0.13 * edge + 0.08 * seam - 0.09 * patch,
            0.35,
            0.88,
        )
        ao = np.clip(0.94 - 0.2 * edge - 0.16 * vein - 0.12 * seam, 0.45, 1)
        dy, dx = np.gradient(relief)
        normal = np.stack((-dx * w * 0.014, -dy * h * 0.014, np.ones_like(dx)), axis=2)
        normal /= np.linalg.norm(normal, axis=2)[:, :, None]
        sl = np.s_[
            tile // 4 * h : (tile // 4 + 1) * h, tile % 4 * w : (tile % 4 + 1) * w
        ]
        arrays["BaseColor"][sl][:, :, :3] = base
        arrays["ORM"][sl][:, :, :3] = np.stack((ao, rough, np.zeros_like(ao)), axis=2)
        arrays["Normal"][sl][:, :, :3] = normal * 0.5 + 0.5
        if tile == 7:
            arrays["Emissive"][sl][:, :, :3] = (
                base
                * (0.55 + 0.45 * np.sin(u * math.pi) * np.sin(v * math.pi))[:, :, None]
            )
    images = {}
    for name, px in arrays.items():
        im = bpy.data.images.new(
            "Ulgani_" + str(res) + "_" + name, width=res, height=res, alpha=True
        )
        im.colorspace_settings.name = (
            "sRGB" if name in ("BaseColor", "Emissive") else "Non-Color"
        )
        im.pixels.foreach_set(px.ravel())
        im.pack()
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = im
        node.label = name
        images[name] = node
    nt.links.new(images["BaseColor"].outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(images["Emissive"].outputs["Color"], bs.inputs["Emission Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(images["ORM"].outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    normal = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(images["Normal"].outputs["Color"], normal.inputs["Color"])
    nt.links.new(normal.outputs["Normal"], bs.inputs["Normal"])
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(
        name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat"
    )
    node = nt.nodes.new("ShaderNodeGroup")
    node.node_tree = group
    nt.links.new(sep.outputs["Red"], node.inputs["Occlusion"])
    return mat


def reference():
    c = coll("REF")
    c.hide_render = True
    mesh = bpy.data.meshes.new("REF_GridMesh")
    vertices = []
    edges = []
    vertices = [(x, y, 0) for y in range(-10, 11) for x in range(-10, 11)]
    for j in range(21):
        for i in range(21):
            k = j * 21 + i
            if i < 20:
                edges.append((k, k + 1))
            if j < 20:
                edges.append((k, k + 21))
    mesh.from_pydata(vertices, edges, [])
    ob = bpy.data.objects.new("REF_Grid", mesh)
    c.objects.link(ob)
    ob["spacing"] = 1.0
    m = Mesh()
    for label, p, q, r in [
        ("Torso", (0, 0, 0.85), (0, 0, 1.5), 0.19),
        ("LegL", (-0.13, 0, 0.04), (-0.13, 0, 0.9), 0.085),
        ("LegR", (0.13, 0, 0.04), (0.13, 0, 0.9), 0.085),
        ("ArmL", (-0.17, 0, 1.4), (-0.44, 0, 0.9), 0.06),
        ("ArmR", (0.17, 0, 1.4), (0.44, 0, 0.9), 0.06),
        ("Head", (0, 0, 1.55), (0, 0, 1.75), 0.10),
    ]:
        m.tube(label, curve(p, q, bend=(0, 0, 0), steps=6), r)
    ob = m.object("REF_Biped", c)
    # Set the sole/crown to exactly 0/1.85 rather than trusting a capsule's nominal dimensions.
    zs = [v.co.z for v in ob.data.vertices]
    lo, hi = min(zs), max(zs)
    for v in ob.data.vertices:
        v.co.z = (v.co.z - lo) / (hi - lo) * 1.85


def floor(a, rx, ry, z=0.18):
    a.mesh.slab("WalkShelf", rx, ry, z=z, depth=0.18, n=96)
    # Flat connection tongues retain the full corridor width where the organic perimeter curves away.
    half = (
        3.6
        if a.meta["role"] == "plaza"
        else 2.6
        if a.meta["role"] in ("anchor", "shipyard", "salvage")
        else 1.9
    )
    for sign in (-1, 1):
        y0, y1 = sorted([sign * (ry - 1.4), sign * (ry + 0.5)])
        vv = [
            (-half, y0, 0),
            (half, y0, 0),
            (half, y1, 0),
            (-half, y1, 0),
            (-half, y0, z + 0.006),
            (half, y0, z + 0.006),
            (half, y1, z + 0.006),
            (-half, y1, z + 0.006),
        ]
        ff = [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (1, 2, 6, 5),
            (2, 3, 7, 6),
            (3, 0, 4, 7),
        ]
        a.mesh.piece(
            "Threshold" + str(sign),
            vv,
            ff,
            [(0, 0), (1, 0), (1, 1), (0, 1)] * 2,
            5,
            False,
        )
        a.box("Threshold" + str(sign), (-half, y0, 0), (half, y1, z + 0.006))
    # Twelve convex wedges fit the curved shelf, leaving its perimeter accurate enough for walking.
    n = 12
    for i in range(n):
        t0, t1 = TAU * i / n, TAU * (i + 1) / n
        vv = [
            (0, 0, 0),
            (rx * math.cos(t0), ry * math.sin(t0), 0),
            (rx * math.cos(t1), ry * math.sin(t1), 0),
        ]
        vv += [(x, y, z) for x, y, _ in vv]
        m = Mesh()
        m.piece(
            "Deck",
            vv,
            [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)],
            [(0, 0)] * 6,
        )
        ob = m.object(f"COL_{a.id}_Deck{i}", a.c)
        ob.hide_render = True
        a.cols.append(ob)


def building(a, height, variant, rx, ry, levels=None, civic=False):
    m = a.mesh
    floor(a, rx, ry)
    levels = levels or (3 if height < 20 else 5 if height < 70 else 7)
    n = 8 if height < 70 else 10
    zvalues = [0.18, 4.4] + list(
        np.linspace(max(5, height * 0.26), height * 0.84, levels - 1)
    )
    nodes = []
    for j, z in enumerate(zvalues):
        t = z / height
        profile = 1 - 0.36 * t + 0.14 * math.sin(t * math.pi * (1.2 + variant * 0.17))
        center = (
            math.sin(t * math.pi) * rx * 0.1 * (variant - 1),
            math.sin(t * math.pi * 1.3) * ry * 0.08,
        )
        ring = []
        for i in range(n):
            ang = TAU * i / n + (0.06 * variant * math.sin(t * math.pi))
            lobe = 1 + 0.10 * math.sin((3 if variant == 3 else 2) * ang + variant * 0.7)
            ring.append(
                (
                    center[0] + rx * 0.8 * profile * lobe * math.cos(ang),
                    center[1] + ry * 0.8 * profile * lobe * math.sin(ang),
                    z,
                )
            )
        nodes.append(ring)
    r = 0.12 if height < 20 else 0.17 if height < 70 else 0.29
    for j in range(len(nodes) - 1):
        for i in range(n):
            nxt = (i + 1) % n
            p, q = nodes[j][i], nodes[j + 1][i]
            if j > 0 or abs(p[0]) > 1.9:
                m.tube(
                    f"GrowingRib{j}_{i}",
                    curve(
                        p,
                        q,
                        bend=(
                            0.45 * math.cos(TAU * i / n),
                            0.45 * math.sin(TAU * i / n),
                            0,
                        ),
                        steps=10,
                    ),
                    r,
                    0,
                    10,
                )
            if j == 0 and abs(p[0]) > 1.9:
                a.hull(f"RootPillar{i}", curve(p, q, bend=(0, 0, 0), steps=2), r * 1.45)
            # Front and rear sectors remain open through the 4.2 m ground storey.
            mx = (p[0] + nodes[j][nxt][0]) / 2
            if j == 0 and abs(mx) < rx * 0.44:
                continue
            p2 = nodes[j][nxt]
            m.tube(
                f"Diagonal{j}_{i}",
                curve(
                    p,
                    nodes[j + 1][nxt],
                    bend=(
                        0.22 * math.cos(TAU * i / n),
                        0.22 * math.sin(TAU * i / n),
                        0.36,
                    ),
                    steps=10,
                ),
                r * 0.78,
                0,
                8,
            )
            m.tube(
                f"Crossring{j}_{i}",
                curve(p, p2, bend=(0, 0, 0.16), steps=6),
                r * 0.85,
                4,
                8,
            )
            if (i + j + variant) % 3 != 0:
                tri = [
                    np.array(p) * 0.94 + np.array(nodes[j + 1][nxt]) * 0.06,
                    np.array(nodes[j + 1][i]) * 0.94 + np.array(nodes[j][nxt]) * 0.06,
                    np.array(nodes[j + 1][nxt]) * 0.94 + np.array(p) * 0.06,
                ]
                m.membrane(f"TensionPanel{j}_{i}", tri, div=9, sag=0.16)
                if (i + j) % 4 == 1:
                    center = sum(tri) / 3
                    patch = [
                        center + (point - center) * 0.25 + np.array((0, -0.04, 0.03))
                        for point in tri
                    ]
                    m.membrane(f"RepairPatch{j}_{i}", patch, div=5, sag=0.04)
            if j == 0:
                a.hull(f"EdgeWall{i}", [p, nodes[j][nxt]], r * 1.4)
            else:
                a.hull(f"UpperRib{j}_{i}", [p, q], r * 1.4)
    roof = height * 0.87
    crowns = []
    if variant == 1:
        crowns = [
            (-rx * 0.38, 0, roof, rx * 0.76, ry * 1.02, height * 0.13),
            (rx * 0.38, ry * 0.08, roof - 0.3, rx * 0.74, ry * 0.9, height * 0.12),
        ]
    elif variant == 3:
        crowns = [
            (
                rx * 0.38 * math.cos(t),
                ry * 0.38 * math.sin(t),
                roof,
                rx * 0.72,
                ry * 0.72,
                height * 0.13,
            )
            for t in (0, TAU / 3, 2 * TAU / 3)
        ]
    else:
        crowns = [
            (
                rx * 0.08 * (variant - 1),
                0,
                roof,
                rx * (1 + 0.05 * variant),
                ry * 0.94,
                height * 0.13,
            )
        ]
        if variant == 2:
            crowns.append(
                (
                    rx * 0.55,
                    -ry * 0.3,
                    height * 0.69,
                    rx * 0.62,
                    ry * 0.58,
                    height * 0.13,
                )
            )
    for k, args in enumerate(crowns):
        m.cap(
            f"RainCrown{k}",
            *args,
            n=56 if len(crowns) == 1 else 48,
            rings=10 if len(crowns) == 1 else 8,
            gills=24 if len(crowns) == 1 else 16,
            detail=10,
        )
        a.cap_collision(f"Crown{k}", *args)
    if height > 20:
        shelves = 1 if height < 70 else 2 + variant % 2
        for k in range(shelves):
            z = height * (0.35 + 0.17 * k)
            m.cap(
                f"OffsetShelf{k}",
                (-1 if k % 2 else 1) * rx * 0.21,
                0,
                z,
                rx * 0.85,
                ry * 0.82,
                min(2.8, height * 0.045),
                n=40,
                rings=6,
                gills=12,
                detail=7,
            )
    # Roof collider is overhead, not a solid cylinder from ground to crown.
    a.doorway(-ry * 0.79)
    a.doorway(ry * 0.79)
    a.route((0, -ry, 0.18), (0, ry, 0.18))
    if civic:
        a.marker(
            "Interact_" + a.meta["role"],
            (0, -ry * 0.30, 1.38),
            service_role=a.meta["role"],
            dispatch="T01_T02_pending",
        )
        a.route((0, -ry, 0.18), (0, -ry * 0.3, 0.18))
    a.light((-rx * 0.55, -ry * 0.55, 3.3))
    a.light((rx * 0.55, ry * 0.55, 3.3))


def bridge(a, length=24, width=5, turn=False):
    m = a.mesh
    bend = 5 if turn else 0

    def path(t, x, z):
        return (x + bend * math.sin(math.pi * t), length * (t - 0.5), z)

    # Smooth level pedestrian deck: travel clearances do not inherit the root arch below it.
    for i in range(32):
        t0, t1 = i / 32, (i + 1) / 32
        p = [
            path(t0, -width / 2, 0.18),
            path(t0, width / 2, 0.18),
            path(t1, width / 2, 0.18),
            path(t1, -width / 2, 0.18),
        ]
        m.piece(
            f"Deck{i}",
            p,
            [(0, 1, 2, 3)],
            [(0, t0), (1, t0), (1, t1), (0, t1)],
            5,
            False,
        )
        a.box(
            f"Deck{i}",
            (min(p[0][0], p[3][0]), p[0][1], 0),
            (max(p[1][0], p[2][0]), p[2][1], 0.18),
        )
    for side in (-1, 1):
        for braid in (0, 1):
            pts = [
                path(
                    t,
                    side * (width / 2 + 0.28)
                    + 0.25 * math.sin(t * TAU * 2 + braid * math.pi),
                    -0.30
                    - 0.5 * math.sin(math.pi * t)
                    + 0.22 * math.cos(t * TAU * 2 + braid * math.pi),
                )
                for t in np.linspace(0, 1, 56)
            ]
            m.tube(f"BraidedRoot{side}_{braid}", pts, 0.25, 4, 12)
        rail = [path(t, side * (width / 2 + 0.03), 1.14) for t in np.linspace(0, 1, 32)]
        m.tube(f"Handrail{side}", rail, 0.075, 0, 10)
        for i in range(9):
            t = i / 8
            p, q = (
                path(t, side * (width / 2 + 0.03), 0.18),
                path(t, side * (width / 2 + 0.03), 1.14),
            )
            m.tube(
                f"RailSprout{side}_{i}",
                curve(p, q, bend=(side * 0.09, 0, 0), steps=8),
                0.045,
                0,
                8,
            )
        for i in range(8):
            p, q = rail[i * 4], rail[min(i * 4 + 4, 31)]
            a.box(
                f"Rail{side}_{i}",
                (min(p[0], q[0]) - 0.1, p[1], 0.18),
                (max(p[0], q[0]) + 0.1, q[1], 1.28),
            )
    pts = [path(t, 0, 0.18) for t in np.linspace(0, 1, 9)]
    for p, q in pairwise(pts):
        a.route(p, q)
    a.meta["deckWidth"] = width
    a.meta["railHeight"] = 1.05
    a.light(path(0.18, -width / 2, 1.2))


def wall(a, corner=False, gate=False):
    m = a.mesh
    length = 18 if not gate else 14
    xs = [-length / 2 + i * length / 8 for i in range(9)]
    for i, x in enumerate(xs):
        if gate and abs(x) < 3.2:
            continue
        y = abs(x) * 0.45 if corner else 0
        p = (x, y, 0)
        q = (x + 0.22 * math.sin(i), y, 5.8 + 0.4 * math.cos(i * 0.8))
        m.tube(f"Stem{i}", curve(p, q, bend=(0.3, 0, 0), steps=18), 0.18, 0, 12)
        a.hull(f"Stem{i}", [p, q], 0.23)
        if i and not (gate and abs(x) < 4):
            prev = (xs[i - 1], abs(xs[i - 1]) * 0.45 if corner else 0, 0)
            m.tube(
                f"Cross{i}", curve(prev, q, bend=(0, 0.25, 0.25), steps=18), 0.12, 0, 10
            )
            m.membrane(f"Mesh{i}", [prev, q, (x, y, 0.3)], div=12)
            a.box(
                f"Panel{i}",
                (xs[i - 1], min(prev[1], y) - 0.15, 0),
                (x, max(prev[1], y) + 0.15, 5.8),
            )
    if gate:
        m.cap("GateCap", 0, 0, 6.6, 8, 3.5, 2, n=64, rings=12, gills=20)
        m.tube(
            "GrownLintel",
            curve((-5, 0, 5.6), (5, 0, 5.6), bend=(0, 0, 1.4), steps=32),
            0.3,
            4,
            12,
        )
        a.box("Lintel", (-5, -0.4, 5.5), (5, 0.4, 6.5))
        a.doorway(0, 0, 6.4, 5.4)
        a.route((0, -4, 0), (0, 4, 0))
        a.marker("Interact_Gate", (-3.4, -1, 1.2), dispatch="T01_pending")
    a.light((-length / 2, 0, 4.5))


def cap_shelter(a, half=False, hero=False):
    m = a.mesh
    rx, ry, z, rise = (66, 52, 50, 14) if hero else (26, 16 if half else 23, 14, 5)
    m.cap(
        "CommunityCanopy",
        0,
        0,
        z,
        rx,
        ry,
        rise,
        n=128 if hero else 64,
        rings=36 if hero else 10,
        gills=48 if hero else 24,
        detail=55 if hero else 10,
    )
    for i in range(6):
        ang = TAU * i / 6
        p = (rx * 0.72 * math.cos(ang), ry * 0.72 * math.sin(ang), 0)
        q = (
            rx * 0.45 * math.cos(ang + 0.2),
            ry * 0.45 * math.sin(ang + 0.2),
            z + rise * 0.5,
        )
        m.tube(
            f"RootColumn{i}",
            curve(p, q, bend=(-p[0] * 0.17, -p[1] * 0.17, 0), steps=64 if hero else 24),
            (lambda t: (1.1 if hero else 0.5) * (1.5 - 0.6 * t)),
            4,
            14,
        )
        a.hull(
            f"Column{i}",
            curve(p, q, bend=(-p[0] * 0.17, -p[1] * 0.17, 0), steps=6),
            1.3 if hero else 0.7,
        )
        a.light((p[0], p[1], 4), 0.7, 12)
    a.cap_collision("HighCap", 0, 0, z, rx, ry, rise)
    a.route((0, -ry, 0), (0, ry, 0), width=16, height=8)
    a.meta["canopyClearance"] = z - 1
    a.meta["placement"] = "separate canopy coverage, not residential footprint scaling"


def ring(a, joint=False):
    m = a.mesh
    radius = 100 if not joint else 70
    n = 40
    width = 12
    arc = 0.42 if not joint else 0.28
    vv = []
    uv = []
    ff = []
    for i in range(n + 1):
        t = (i / n - 0.5) * arc
        for r, z in [
            (radius - width / 2, 0),
            (radius + width / 2, 0),
            (radius - width / 2, 0.18),
            (radius + width / 2, 0.18),
        ]:
            vv.append((r * math.sin(t), r * math.cos(t) - radius, z))
            uv.append((i / n, (r - radius) / width + 0.5))
    for i in range(n):
        k = i * 4
        ff.extend(
            [
                (k + 2, k + 3, k + 7, k + 6),
                (k, k + 4, k + 5, k + 1),
                (k, k + 2, k + 6, k + 4),
                (k + 1, k + 5, k + 7, k + 3),
            ]
        )
    ff += [(0, 1, 3, 2), (4 * n, 4 * n + 2, 4 * n + 3, 4 * n + 1)]
    m.piece("LakeShelf", vv, [f[::-1] for f in ff], uv, 5, False)
    for side in (-1, 1):
        for b in range(3):
            pts = []
            for t in np.linspace(-arc / 2, arc / 2, 80):
                r = (
                    radius
                    + side * (width / 2 + 0.2)
                    + 0.18 * math.sin(t * 45 + b * TAU / 3)
                )
                pts.append(
                    (
                        r * math.sin(t),
                        r * math.cos(t) - radius,
                        -0.35 + 0.2 * math.cos(t * 45 + b * TAU / 3),
                    )
                )
            m.tube(f"BraidedShore{side}_{b}", pts, 0.22, 4, 10)
    for i in range(10):
        verts = vv[i * 16 : i * 16 + 4] + vv[(i + 1) * 16 : (i + 1) * 16 + 4]
        cm = Mesh()
        cm.piece(
            "Deck",
            verts,
            [
                f[::-1]
                for f in [
                    (2, 3, 7, 6),
                    (0, 4, 5, 1),
                    (0, 2, 6, 4),
                    (1, 5, 7, 3),
                    (0, 1, 3, 2),
                    (4, 6, 7, 5),
                ]
            ],
            [(0, 0)] * 8,
        )
        ob = cm.object(f"COL_{a.id}_Deck{i}", a.c)
        ob.hide_render = True
        a.cols.append(ob)
    # Connection endpoints specify a tangent/yaw, not a runtime-generated lake.
    a.meta["ringRadius"] = radius
    a.meta["arcRadians"] = arc
    a.meta["deckWidth"] = width
    pts = [
        (radius * math.sin(t), radius * math.cos(t) - radius, 0.18)
        for t in np.linspace(-arc / 2, arc / 2, 11)
    ]
    for p, q in pairwise(pts):
        a.route(p, q, width=3)


def prop(a, kind):
    m = a.mesh
    if kind == "bench":
        for y in (-0.2, 0.2):
            m.tube(
                "SeatLamina",
                curve((-1.2, y, 0.45), (1.2, y, 0.45), bend=(0, 0, 0.03), steps=32),
                0.09,
                1,
                16,
            )
        for x in (-0.85, 0.85):
            m.tube(
                "Leg",
                curve((x, 0, 0), (x, 0, 0.45), bend=(0.15, 0, 0), steps=20),
                0.11,
                4,
                14,
            )
        m.tube(
            "Back",
            curve((-1.1, 0.28, 0.85), (1.1, 0.28, 0.85), bend=(0, 0.1, 0.08), steps=40),
            0.10,
            0,
            14,
        )
        a.box("Seat", (-1.25, -0.32, 0.35), (1.25, 0.36, 0.54))
        a.box("Back", (-1.2, 0.25, 0.54), (1.2, 0.42, 0.95))
        a.meta["seatHeight"] = 0.45
    elif kind in ("terminal", "board", "wayfinding"):
        height = 2.6 if kind != "terminal" else 1.4
        m.tube(
            "RootStand",
            curve((0, 0, 0), (0.15, 0, height), bend=(0.24, 0, 0), steps=30),
            0.12,
            4,
            14,
        )
        for x in (-0.65, 0.65):
            m.tube(
                "PanelRim",
                curve(
                    (x, 0, height * 0.5), (x, 0, height), bend=(0.1, -0.1, 0), steps=24
                ),
                0.07,
                0,
                12,
            )
        for z in (height * 0.5, height):
            m.tube(
                "TopRim",
                curve((-0.65, 0, z), (0.65, 0, z), bend=(0, -0.04, 0.08), steps=24),
                0.07,
                0,
                12,
            )
        m.membrane(
            "NoticeSkin",
            [(-0.62, 0, height * 0.51), (0.62, 0, height * 0.51), (0.62, 0, height)],
            div=20,
            sag=0.04,
        )
        m.membrane(
            "NoticeSkin2",
            [(-0.62, 0, height * 0.51), (0.62, 0, height), (-0.62, 0, height)],
            div=20,
            sag=0.04,
        )
        for i in range(5):
            z = height * (0.58 + i * 0.07)
            m.tube(
                "GrownMark",
                curve(
                    (-0.4, -0.05, z),
                    (0.25 - (i % 2) * 0.2, -0.05, z + 0.025),
                    bend=(0, 0, 0.03),
                    steps=12,
                ),
                0.018,
                7,
                8,
            )
        a.box("Stand", (-0.2, -0.18, 0), (0.42, 0.18, height))
        a.box("Board", (-0.7, -0.12, height * 0.5), (0.7, 0.12, height + 0.1))
        if kind != "wayfinding":
            a.marker(
                "Interact_" + kind,
                (0, -1.1, 1.2),
                service_role="board:belost" if kind == "board" else "trade",
                dispatch="T01_T02_pending",
            )
        a.light((0, -0.1, height * 0.9), 0.25, 4)
        if kind == "wayfinding":
            for side, z in [(-1, 2.1), (1, 1.5)]:
                m.tube(
                    "DirectionalSprout",
                    curve(
                        (0, 0, z - 0.2),
                        (side * 1.25, 0, z + 0.3),
                        bend=(0, 0, 0.16),
                        steps=24,
                    ),
                    0.065,
                    0,
                    12,
                )
                m.membrane(
                    "LeafSign",
                    [
                        (side * 0.5, -0.03, z),
                        (side * 1.4, -0.03, z + 0.3),
                        (side * 0.5, -0.03, z + 0.55),
                    ],
                    div=12,
                    sag=0.04,
                )
    elif kind == "planter":
        m.slab("Basin", 0.8, 0.7, 0.3, 0.3, n=96, tile=4)
        for i in range(7):
            t = i * 2.399
            x, y = 0.45 * math.cos(t), 0.4 * math.sin(t)
            m.tube(
                "Frond",
                curve(
                    (x, y, 0.25),
                    (x * 1.4, y * 1.4, 1 + 0.15 * (i % 3)),
                    bend=(0.14, 0, 0.1),
                    steps=24,
                ),
                0.045,
                4,
                12,
            )
            m.cap(
                "GillFan" + str(i),
                x * 1.4,
                y * 1.4,
                1 + 0.15 * (i % 3),
                0.35,
                0.24,
                0.12,
                n=24,
                rings=3,
                gills=4,
                detail=4,
            )
        a.box("Basin", (-0.7, -0.6, 0), (0.7, 0.6, 0.35))
        a.light((0, 0, 1.25), 0.22, 3)
    elif kind == "stall":
        for x in (-1.6, 1.6):
            m.tube(
                "Strut",
                curve((x, 0.6, 0), (x * 0.8, 0.6, 2.6), bend=(0.15, 0, 0.1), steps=24),
                0.09,
                0,
                12,
            )
            a.box(
                "Leg" + str(x).replace(".", ""),
                (x - 0.12, 0.45, 0),
                (x + 0.12, 0.75, 2.7),
            )
        m.cap("Awning", 0, 0.15, 2.6, 2.15, 1.4, 0.5, n=48, rings=6, gills=16, detail=8)
        m.slab("Counter", 1.7, 0.6, 1.0, 0.12, n=64, offset=(0, 0.3))
        a.box("Counter", (-1.6, -0.2, 0.88), (1.6, 0.8, 1.0))
        a.marker(
            "Interact_Apothecary",
            (0, -1.2, 1.2),
            service_role="npc:apothecary",
            dispatch="T01_T02_pending",
        )
        a.light((0, 0.1, 2.55), 0.35, 5)
    a.meta["propKind"] = kind


def plaza(a):
    floor(a, 30, 27)
    for i in range(16):
        ang = TAU * i / 16
        p = (29 * math.cos(ang), 26 * math.sin(ang), 0.1)
        q = (27 * math.cos(ang + 0.2), 24 * math.sin(ang + 0.2), 0.2)
        a.mesh.tube(
            f"RootBorder{i}", curve(p, q, bend=(0, 0, 0.3), steps=26), 0.34, 4, 14
        )
        if i % 4:
            a.mesh.cap(
                f"SeatShelf{i}",
                p[0] * 0.9,
                p[1] * 0.9,
                0.5,
                2.2,
                1,
                0.25,
                n=40,
                rings=5,
                gills=8,
                detail=5,
            )
    for i in range(4):
        ang = TAU * i / 4
        x, y = 24 * math.cos(ang + 0.4), 22 * math.sin(ang + 0.4)
        a.mesh.cap(
            f"GatheringCap{i}", x, y, 4.4, 5, 4, 1.2, n=48, rings=8, gills=16, detail=8
        )
        a.mesh.tube(
            f"GatheringRoot{i}",
            curve((x, y, 0.18), (x + 1, y, 5), bend=(1, 0, 0), steps=30),
            0.3,
            4,
            14,
        )
        a.hull(f"GatheringRoot{i}", [(x, y, 0.18), (x + 1, y, 5)], 0.4)
        a.light((x, y, 3.7), 0.6, 10)
    a.route((0, -27, 0.18), (0, 27, 0.18), width=6)
    a.marker(
        "Interact_Recall",
        (0, 0, 1.38),
        service_role="recall",
        dispatch="T01_T02_pending",
    )


def yard(a, salvage=False):
    floor(a, 24 if salvage else 31, 23)
    m = a.mesh
    pad = 12 if salvage else 18
    m.slab("LandingPad", pad, pad, 0.22, 0.04, n=128, tile=5)
    for i in range(12):
        ang = TAU * i / 12
        p = (pad * math.cos(ang), pad * math.sin(ang), 0.24)
        q = ((pad + 1) * math.cos(ang), (pad + 1) * math.sin(ang), 0.24)
        m.tube(f"PadGills{i}", curve(p, q, bend=(0, 0, 0.06), steps=12), 0.08, 7, 8)
    for side in (-1, 1):
        x = side * (pad + 4)
        m.tube(
            "YardRoot",
            curve(
                (x, -13, 0.18),
                (x, 13, 12 if salvage else 17),
                bend=(-side * 4, 0, 2),
                steps=52,
            ),
            0.65,
            4,
            16,
        )
        m.cap(
            "WorkCanopy" + str(side),
            x,
            9,
            11 if salvage else 16,
            8,
            7,
            2,
            n=64,
            rings=10,
            gills=20,
            detail=12,
        )
        a.hull(
            "YardRoot" + str(side),
            curve(
                (x, -13, 0.18),
                (x, 13, 12 if salvage else 17),
                bend=(-side * 4, 0, 2),
                steps=8,
            ),
            0.8,
        )
        a.light((x, 5, 4), 0.6, 12)
    if salvage:
        for i in range(5):
            x, y = (-17 + i * 3.2, 14)
            m.tube(
                f"GrownCradle{i}",
                curve((x - 1, y, 0.2), (x + 1, y, 0.2), bend=(0, 0, 2), steps=32),
                0.15,
                0,
                12,
            )
            a.box(f"Cradle{i}", (x - 1.2, y - 0.25, 0.18), (x + 1.2, y + 0.25, 2.2))
    a.marker(
        "Interact_" + a.meta["role"],
        (0, -19, 1.38),
        service_role=a.meta["role"],
        dispatch="T01_T02_pending",
    )
    a.marker("BAY_Pad", (0, 0, 0.22), pad_diameter=pad * 2)
    a.route((0, -23, 0.18), (0, -19, 0.18), width=4)
    a.meta["padDiameter"] = pad * 2


def anchor(a):
    m = a.mesh
    floor(a, 74, 66)
    for i in range(24):
        angle = TAU * i / 24
        pts = []
        for t in np.linspace(0, 1, 85):
            r = 8 + 70 * t
            ang = (
                angle + 0.18 * math.sin(t * math.pi) + 0.035 * math.sin(t * TAU * 3 + i)
            )
            pts.append(
                (
                    r * math.cos(ang),
                    r * 0.87 * math.sin(ang),
                    0.35 + 2.2 * math.sin(t * math.pi) ** 2,
                )
            )
        # Roots climb the island's perimeter but never cross the four causeway landing routes.
        if abs(math.sin(angle)) < 0.12 or abs(math.cos(angle)) < 0.12:
            pts = [(x, y, z - 3.2) for x, y, z in pts]
        pts = [(x, y, min(z, -1.2) if abs(x) < 3.8 and y < 0 else z) for x, y, z in pts]
        m.tube(f"IslandRoot{i}", pts, lambda t: 0.8 * (1 - 0.45 * t), 4, 12)
        a.hull(f"IslandRoot{i}", [pts[j] for j in range(0, 85, 12)], 0.95)
    for i in range(8):
        ang = TAU * (i + 0.5) / 8
        x, y = 54 * math.cos(ang), 48 * math.sin(ang)
        m.cap(
            f"ShoreShelf{i}", x, y, 1.2, 13, 9, 1.8, n=64, rings=10, gills=16, detail=14
        )
    # The anchor is a tapered split basalt blade, not a fungal primitive. Glyph semantics remain T08's.
    for side in (-1, 1):
        vv = []
        uv = []
        n = 12
        profile = [(0, 4.6), (5, 4.9), (18, 4.6), (35, 3.7), (48, 2.0)]
        for j, (z, r) in enumerate(profile):
            for i in range(n):
                ang = TAU * i / n
                vv.append(
                    (
                        side * (2.7 + z * 0.018) + r * 0.52 * math.cos(ang),
                        r * 0.62 * math.sin(ang),
                        0.18 + z,
                    )
                )
                uv.append((i / n, j / (len(profile) - 1)))
        ff = []
        for j in range(len(profile) - 1):
            for i in range(n):
                k = j * n + i
                nxt = j * n + (i + 1) % n
                ff.append((k, nxt, nxt + n, k + n))
        ff += [
            tuple(range(n - 1, -1, -1)),
            tuple((len(profile) - 1) * n + i for i in range(n)),
        ]
        m.piece("AnchorBlade" + str(side), vv, ff, uv, 6, False)
        cm = Mesh()
        cm.piece("Blade", vv, ff, uv, 6, False)
        ob = cm.object(
            "COL_" + a.id + "_AnchorBlade" + str(side).replace("-", "Neg"), a.c
        )
        ob.hide_render = True
        a.cols.append(ob)
        for j in range(9):
            z = 5 + j * 4.3
            m.tube(
                f"Incision{side}_{j}",
                curve(
                    (side * 2.8 - 1, -3.01, z),
                    (side * 2.8 + 0.6, -3.01, z + 0.15),
                    bend=(0, 0, 0.1),
                    steps=16,
                ),
                0.045,
                7,
                8,
            )
    a.marker(
        "Interact_Anchor",
        (0, -5, 1.38),
        service_role="recall_anchor",
        dispatch="T01_T02_T08_pending",
    )
    a.route((0, -66, 0.18), (0, -5, 0.18), width=4)
    a.light((0, -4, 1.8), 0.65, 10)
    a.meta["anchorStoneHeight"] = 48
    a.meta["lake"] = (
        "external lake composition/terrain belongs to T01; no water collider"
    )


def make_group(group, mat):
    assets = []

    def add(name, title, role, cls="building"):
        a = Asset("ulgani_" + name, title, role, cls, mat)
        assets.append(a)
        return a

    if group in ("low", "mid", "tall"):
        heights = {
            "low": [7, 9, 11, 13],
            "mid": [24, 34, 46, 58],
            "tall": [174, 224, 276, 332],
        }[group]
        names = ["Gathered Veil", "Saddle Court", "Patched Fan", "Threefold Crown"]
        for i, h in enumerate(heights):
            a = add(f"{group}_{i}", names[i], group)
            building(
                a,
                h,
                i,
                [7, 8.2, 8, 9][i]
                * (1.4 if group == "tall" else 1.1 if group == "mid" else 1),
                [6.5, 7.5, 6.6, 8][i]
                * (1.35 if group == "tall" else 1.1 if group == "mid" else 1),
            )
    elif group == "civic":
        plaza(add("plaza", "Root Commons", "plaza"))
        for i, (role, title, rx, ry, h) in enumerate(
            [
                ("market", "Cap Market", 15, 12, 12),
                ("city_master", "House of Grafting", 12, 13, 17),
                ("compact", "Compact Root Registry", 13, 11, 20),
                ("chorus_listener", "Listening Canopy", 11, 15, 15),
            ]
        ):
            building(add(role, title, role), h, i, rx, ry, civic=True)
        yard(add("shipyard", "Open Root Dock", "shipyard"))
        yard(add("salvage", "Reclaiming Yard", "salvage"), True)
    elif group == "kit":
        wall(add("wall", "Woven Boundary", "wall", "kit"))
        wall(add("wall_corner", "Turning Boundary", "wall_corner", "kit"), True)
        wall(add("gate", "Open Gill Gate", "gate", "kit"), gate=True)
        bridge(add("bridge_short", "Braided Footbridge", "bridge_short", "kit"), 18)
        bridge(add("bridge_long", "Lake Root Crossing", "bridge_long", "kit"), 44, 6)
        bridge(
            add("bridge_turn", "Turning Root Crossing", "bridge_turn", "kit"),
            24,
            5,
            True,
        )
        cap_shelter(add("cap_shelter", "Street Rain Cap", "cap_shelter", "kit"))
        cap_shelter(add("cap_half", "Market Edge Cap", "cap_half", "kit"), True)
        ring(add("ring_shelf", "Ring Promenade", "ring_shelf", "kit"))
        ring(add("ring_joint", "Ring Landing", "ring_joint", "kit"), True)
        lamp = add("lamp", "Gill Lantern", "lamp", "kit")
        lamp.mesh.tube(
            "Stem",
            curve((0, 0, 0), (0.4, 0, 4), bend=(0.5, 0, 0), steps=40),
            0.12,
            4,
            12,
        )
        lamp.mesh.cap(
            "Lantern", 0.4, 0, 3.6, 1.1, 0.9, 0.6, n=48, rings=8, gills=16, detail=10
        )
        lamp.hull("Stem", [(0, 0, 0), (0.4, 0, 4)], 0.22)
        lamp.light((0.4, 0, 3.4), 0.65, 10)
        bridge(add("shore_walk", "Shore Walk Segment", "shore_walk", "kit"), 12, 8)
    elif group == "props":
        for kind in ("stall", "terminal", "bench", "planter", "wayfinding", "board"):
            prop(add(kind, "Grown " + kind, kind, "prop"), kind)
    elif group == "landmarks":
        cap_shelter(
            add("great_cap_landmark", "Belost Great Shelter", "great_cap", "hero"),
            hero=True,
        )
    elif group == "anchor":
        anchor(add("root_island_landmark", "Belost Root Island", "anchor", "hero"))
    return assets


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "--group",
        required=True,
        choices=["low", "mid", "tall", "civic", "kit", "props", "landmarks", "anchor"],
    )
    p.add_argument("--receipt", required=True)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    report = Path(a.receipt)
    if report.exists():
        raise RuntimeError("receipt already exists")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
    bpy.context.preferences.filepaths.save_version = 0
    mat = make_atlas(
        4096
        if a.group in ("landmarks", "anchor")
        else 1024
        if a.group == "props"
        else 2048
    )
    reference()
    assets = make_group(a.group, mat)
    inventory = [asset.save_lods() for asset in assets]
    path = SOURCES / f"ulgani_{a.group}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(
            {
                "source": str(path.relative_to(ROOT)),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "assets": inventory,
            },
            indent=2,
        )
        + "\n"
    )
    print("Saved", path, flush=True)


if __name__ == "__main__":
    main()
