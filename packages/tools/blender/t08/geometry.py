"""Small authoring tools. Saved meshes remain independently editable; export never imports this module."""

import hashlib
import math
import re
import bpy
import bmesh
from mathutils import Matrix, Vector


class Part:
    def __init__(self, name, collection, materials, density, resolution):
        self.name, self.collection, self.materials = name, collection, materials
        self.scale = density / resolution
        self.precision = name.startswith(("catalyst_vial", "crash_debris", "beacon_0"))
        self.vertices, self.faces, self.roles = [], [], []

    def mesh(self, vertices, faces, role="Hull", matrix=None, fan_caps=False):
        if fan_caps and self.precision:
            vertices = list(vertices)
            repaired = []
            for face in faces:
                if len(face) <= 4:
                    repaired.append(face)
                    continue
                center = tuple(
                    sum(vertices[i][k] for i in face) / len(face) for k in range(3)
                )
                ci = len(vertices)
                vertices.append(center)
                repaired.extend(
                    (face[i], face[(i + 1) % len(face)], ci) for i in range(len(face))
                )
            faces = repaired
        start = len(self.vertices)
        self.vertices.extend(
            [tuple(matrix @ Vector(v)) if matrix else tuple(v) for v in vertices]
        )
        self.faces.extend([tuple(start + i for i in f) for f in faces])
        self.roles.extend([role] * len(faces))

    def box(self, center, size, role="Hull", bevel=0, rotation=None):
        x, y, z = [d / 2 for d in size]
        b = min(bevel, min(x, y, z) * 0.7)
        rot = rotation.to_matrix().to_4x4() if rotation else Matrix.Identity(4)
        mat = Matrix.Translation(Vector(center)) @ rot
        if b <= 0:
            verts = [
                (a * x, c * y, d * z) for d in (-1, 1) for c in (-1, 1) for a in (-1, 1)
            ]
            self.mesh(
                verts,
                [
                    (0, 2, 3, 1),
                    (4, 5, 7, 6),
                    (0, 1, 5, 4),
                    (1, 3, 7, 5),
                    (3, 2, 6, 7),
                    (2, 0, 4, 6),
                ],
                role,
                mat,
            )
            return
        ring = [
            (-x + b, -y),
            (x - b, -y),
            (x, -y + b),
            (x, y - b),
            (x - b, y),
            (-x + b, y),
            (-x, y - b),
            (-x, -y + b),
        ]
        verts = []
        for zc, inset in [(-z, b), (-z + b, 0), (z - b, 0), (z, b)]:
            for xc, yc in ring:
                verts.append((xc * (1 - inset / x), yc * (1 - inset / y), zc))
        faces = [tuple(reversed(range(8))), tuple(range(24, 32))]
        faces += [
            (k * 8 + i, k * 8 + (i + 1) % 8, (k + 1) * 8 + (i + 1) % 8, (k + 1) * 8 + i)
            for k in range(3)
            for i in range(8)
        ]
        self.mesh(verts, faces, role, mat, fan_caps=True)

    def tube(self, path, radii, role="Trim", sides=12, cap=True):
        vertices = []
        if isinstance(radii, (int, float)):
            radii = [radii] * len(path)
        points = [Vector(v) for v in path]
        for i, (p, r) in enumerate(zip(points, radii)):
            direction = (
                points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
            ).normalized()
            ref = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((0, 1, 0))
            u = direction.cross(ref).normalized()
            v = direction.cross(u).normalized()
            for j in range(sides):
                a = math.tau * j / sides
                vertices.append(tuple(p + r * (math.cos(a) * u + math.sin(a) * v)))
        faces = [
            (
                k * sides + i,
                k * sides + (i + 1) % sides,
                (k + 1) * sides + (i + 1) % sides,
                (k + 1) * sides + i,
            )
            for k in range(len(path) - 1)
            for i in range(sides)
        ]
        if cap:
            faces += [
                tuple(reversed(range(sides))),
                tuple(range((len(path) - 1) * sides, len(path) * sides)),
            ]
        self.mesh(vertices, faces, role, fan_caps=True)

    def lathe(self, center, profile, role="Hull", sides=32, axis="z", phase=0):
        vertices = []
        for z, r in profile:
            for j in range(sides):
                a = math.tau * j / sides + phase
                v = (r * math.cos(a), r * math.sin(a), z)
                if axis == "x":
                    v = (z, v[0], v[1])
                if axis == "y":
                    v = (v[0], z, v[1])
                vertices.append(tuple(v[k] + center[k] for k in range(3)))
        faces = [
            (
                k * sides + i,
                k * sides + (i + 1) % sides,
                (k + 1) * sides + (i + 1) % sides,
                (k + 1) * sides + i,
            )
            for k in range(len(profile) - 1)
            for i in range(sides)
        ]
        faces += [
            tuple(reversed(range(sides))),
            tuple(range((len(profile) - 1) * sides, len(profile) * sides)),
        ]
        self.mesh(vertices, faces, role, fan_caps=True)

    def plate(self, outline, thickness, role="Hull"):
        n = len(outline)
        verts = [tuple(p) for p in outline] + [
            (p[0], p[1], p[2] + thickness) for p in outline
        ]
        faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.mesh(verts, faces, role)

    def finish(self):
        if not self.faces:
            return None
        me = bpy.data.meshes.new(self.name + "_mesh")
        me.from_pydata(self.vertices, [], self.faces)
        me.update()
        obj = bpy.data.objects.new(self.name, me)
        self.collection.objects.link(obj)
        keys = list(dict.fromkeys(self.roles))
        for k in keys:
            me.materials.append(self.materials[k])
        for p, r in zip(me.polygons, self.roles):
            p.material_index = keys.index(r)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
        me.update()
        uv = me.uv_layers.new(name="TrimMetric")
        for p in me.polygons:
            coords = [me.vertices[me.loops[j].vertex_index].co for j in p.loop_indices]
            n = p.normal.normalized()
            guide = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
            u = (guide - n * guide.dot(n)).normalized()
            v = n.cross(u).normalized()
            seed = int(
                hashlib.sha256(re.sub(r"_L[0-3]$", "", self.name).encode()).hexdigest()[
                    :8
                ],
                16,
            )
            ox = (seed % 997) / 997
            oy = ((seed // 997) % 991) / 991
            if self.name.startswith("catalyst_vial") and "MaterialAssay" in self.name:
                ox = oy = 0.0
            values = [
                (ox + co.dot(u) * self.scale, oy + co.dot(v) * self.scale)
                for co in coords
            ]
            # Integer wrap preserves the exact trim texels while keeping exponential-filter
            # coordinates near zero. Tiny cap UVs no longer spend precision on whole repeats.
            shift = (0, 0)
            if self.precision:
                shift = tuple(
                    round(sum(q[k] for q in values) / len(values)) for k in range(2)
                )
            for j, q in zip(p.loop_indices, values):
                uv.data[j].uv = (q[0] - shift[0], q[1] - shift[1])
        obj["authoring_unit"] = "P1.E14.T08"
        obj["trim_density_px_m"] = round(
            self.scale * (1024 if self.scale > 0.2 else 2048)
        )
        return obj


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def empty(name, coll, position, props=None):
    o = bpy.data.objects.new(name, None)
    coll.objects.link(o)
    o.location = position
    o.empty_display_type = "PLAIN_AXES"
    o.empty_display_size = 0.18
    if props:
        for k, v in props.items():
            o[k] = v
    return o
