"""Sarelun studio tools. Used only during authoring, never imported by the exporter.

Metres, Z up, public entrance faces -Y. Saved meshes and packed painted trim sheets
are the deliverable; later editing is done in those blend files.
"""
import hashlib
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
HOME = ROOT / "assets/blend/cities/thalune"
TAU = math.tau
PEARL, RIB, TIDE, PATH, BRONZE, BASALT, CORAL, INLAY = range(8)


def reset(res=2048):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 2
    sc.cycles.samples = 16
    sc.render.image_settings.file_format = "PNG"
    sc.world = bpy.data.worlds.new("SarelunWorld")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.16, 0.20, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    sc.view_settings.view_transform = "AgX"
    with bpy.data.libraries.load(str(ROOT / "assets/blend/_library.blend"), link=False) as (src, dst):
        dst.materials = [n for n in ("LIB_Nacre", "LIB_ShellRib", "LIB_Basalt") if n in src.materials]
    refs = bpy.data.collections.new("REF")
    sc.collection.children.link(refs)
    me = bpy.data.meshes.new("REF_Grid_mesh")
    v = [(x, y, 0) for y in range(-10, 11) for x in range(-10, 11)]
    edges = [(i, i + 1) for i in range(441) if i % 21 != 20] + [(i, i + 21) for i in range(420)]
    me.from_pydata(v, edges, [])
    o = bpy.data.objects.new("REF_Grid", me)
    refs.objects.link(o)
    # A measured articulated mannequin, not a box-height proxy.
    body = []
    for name, loc, dims in [("Torso", (0, 0, 1.18), (.38, .22, .5)),
                            ("Head", (0, 0, 1.715), (.23, .21, .27)),
                            ("LegL", (-.11, 0, .46), (.15, .16, .92)),
                            ("LegR", (.11, 0, .46), (.15, .16, .92)),
                            ("ArmL", (-.32, 0, 1.13), (.14, .16, .55)),
                            ("ArmR", (.32, 0, 1.13), (.14, .16, .55))]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.object
        o.name = "REF_Part_" + name
        o.scale = dims
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        body.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in body:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = "REF_Biped"
    for c in list(o.users_collection):
        c.objects.unlink(o)
    refs.objects.link(o)
    refs.hide_render = True
    atlas(res)


def atlas(res):
    """Painted trim sheet: 8 material lanes, placed tide/contact/joint wear, no random noise.

    UV v is a lane-local height. Each lane has an intentionally different wear treatment.
    Occlusion is painted at trim joins; nothing claims a geometry AO bake.
    """
    cols = np.array([[.82, .77, .65], [.12, .40, .35], [.055, .16, .18],
                     [.34, .38, .34], [.27, .28, .17], [.075, .085, .095],
                     [.65, .24, .16], [.74, .64, .40]], dtype=np.float32)
    u = np.linspace(0, 1, res, dtype=np.float32)[None, :]
    base = np.zeros((res, res, 4), np.float32)
    orm = np.ones_like(base)
    height = np.zeros((res, res), np.float32)
    roughs = [.29, .58, .76, .65, .38, .82, .5, .34]
    for lane in range(8):
        sl = slice(lane * res // 8, (lane + 1) * res // 8)
        v = np.linspace(0, 1, res // 8, dtype=np.float32)[:, None]
        seam = np.exp(-((v - .045) / .018) ** 2) + np.exp(-((v - .955) / .018) ** 2)
        edge = np.exp(-((v - .09) / .025) ** 2) + .6 * np.exp(-((v - .9) / .035) ** 2)
        tide = np.exp(-((v - .26 - .017 * np.sin(u * 19)) / .04) ** 2)
        polish = np.exp(-((u - .48) / .19) ** 2) * np.exp(-((v - .57) / .18) ** 2)
        strokes = np.zeros((res // 8, res), np.float32)
        for x, y, width, length in [(.17, .21, .006, .15), (.23, .3, .012, .08),
                                    (.69, .18, .007, .19), (.78, .34, .018, .05),
                                    (.84, .2, .005, .12), (.39, .7, .004, .08)]:
            strokes += np.exp(-((u - x - .02 * (v - y)) / width) ** 2 - ((v - y) / length) ** 2)
        lamina = .5 + .5 * np.cos(v * 31 + .9 * np.sin(u * 7))
        stain = tide * ([.06, .18, .35, .08, .12, .04, .08, .03][lane])
        value = 1 - .20 * seam - stain + .09 * edge + .035 * lamina + .10 * strokes
        base[sl, :, :3] = np.clip(cols[lane] * value[:, :, None] + .035 * strokes[:, :, None], 0, 1)
        base[sl, :, 3] = 1
        orm[sl, :, 0] = np.clip(1 - .22 * seam - .10 * tide, .45, 1)
        orm[sl, :, 1] = np.clip(roughs[lane] + .14 * strokes + .08 * tide - .14 * polish - .07 * edge, .13, .98)
        orm[sl, :, 2] = .68 if lane == BRONZE else 0
        height[sl] = .14 * edge - .22 * seam + .018 * lamina - .045 * strokes
    dy, dx = np.gradient(height)
    normal = np.ones_like(base)
    normal[:, :, 0] = .5 - np.clip(dx * res / 15, -.35, .35)
    normal[:, :, 1] = .5 - np.clip(dy * res / 50, -.35, .35)
    normal[:, :, 2] = np.sqrt(np.clip(1 - (normal[:, :, 0] * 2 - 1) ** 2 - (normal[:, :, 1] * 2 - 1) ** 2, 0, 1)) * .5 + .5
    images = {}
    for name, arr in [("BaseColor", base), ("ORM", orm), ("Normal", normal)]:
        im = bpy.data.images.new(f"Sarelun_{res}_{name}", width=res, height=res, alpha=False)
        im.colorspace_settings.name = "sRGB" if name == "BaseColor" else "Non-Color"
        im.pixels.foreach_set(arr.ravel())
        im.pack()
        images[name] = im
    mat = bpy.data.materials["LIB_Nacre"].copy()
    mat.name = "LIB_Nacre_SarelunTrim"
    mat["source_library_sha256"] = "33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c"
    mat["derived_from"] = "LIB_Nacre; LIB_ShellRib; LIB_Basalt"
    mat["wear"] = "placed salt runnels, tide band, lapped seams, polished hand and foot paths"
    nt = mat.node_tree
    nt.nodes.clear()
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    tex = {}
    for name, im in images.items():
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = im
        tex[name] = node
    nt.links.new(tex["BaseColor"].outputs["Color"], bs.inputs["Base Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex["ORM"].outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    norm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex["Normal"].outputs["Color"], norm.inputs["Color"])
    nt.links.new(norm.outputs[0], bs.inputs["Normal"])
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = group
    nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
    for name, col, strength in [("LIB_Nav_SarelunNacre", (1, .79, .49, 1), .8),
                                ("LIB_GlyphLight_Sarelun", (.70, .92, 1, 1), 1.3)]:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = col
        b.inputs["Roughness"].default_value = .48
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = strength


class Studio:
    def __init__(self, name, cls, role, title):
        self.name, self.cls, self.role, self.title = name, cls, role, title
        self.root = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(self.root)
        self.root["asset_class"] = cls
        self.root["title"] = title
        self.root["front"] = "-Y"
        self.lod = bpy.data.collections.new(name + "_LOD0")
        self.root.children.link(self.lod)
        self.serial = 0
        self.routes = []
        self.clearances = []
        self.pad = None

    def mesh(self, label, verts, faces, lane=PEARL, uv=None, smooth=True, collision=False, glow=False):
        self.serial += 1
        name = ("COL_" if collision else "") + self.name + "_" + label + "_" + str(self.serial)
        me = bpy.data.meshes.new(name + "_mesh")
        me.from_pydata(verts, [], faces)
        me.update()
        ob = bpy.data.objects.new(name, me)
        (self.root if collision else self.lod).objects.link(ob)
        if collision:
            ob.hide_render = True
            ob.display_type = "WIRE"
        else:
            me.materials.append(bpy.data.materials["LIB_GlyphLight_Sarelun" if glow == "glyph" else "LIB_Nav_SarelunNacre" if glow else "LIB_Nacre_SarelunTrim"])
            layer = me.uv_layers.new(name="UVMap")
            for face in me.polygons:
                face.use_smooth = smooth
                for loop in face.loop_indices:
                    vi = me.loops[loop].vertex_index
                    x, y = uv[vi] if uv else (verts[vi][0] % 1, verts[vi][2] % 1)
                    layer.data[loop].uv = (.02 + .96 * x, (lane + .035 + .93 * y) / 8)
        return ob

    def tube(self, label, points, radius, lane=RIB, sides=10, glow=False):
        vs, uv, fs = [], [], []
        for i, point in enumerate(points):
            a, b = Vector(points[max(0, i - 1)]), Vector(points[min(len(points) - 1, i + 1)])
            t = (b - a).normalized()
            u = t.cross(Vector((0, 0, 1)) if abs(t.z) < .97 else Vector((0, 1, 0))).normalized()
            v = t.cross(u).normalized()
            r = radius[i] if isinstance(radius, list) else radius
            for j in range(sides + 1):
                p = Vector(point) + r * (u * math.cos(TAU * j / sides) + v * math.sin(TAU * j / sides))
                vs.append(tuple(p))
                uv.append((j / sides, i / max(1, len(points) - 1)))
        for i in range(len(points) - 1):
            for j in range(sides):
                a = i * (sides + 1) + j
                fs.append((a, a + 1, a + sides + 2, a + sides + 1))
        fs.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * (sides + 1) + j for j in range(sides))])
        return self.mesh(label, vs, fs, lane, uv, glow=glow)

    def loft(self, label, profile, center=(0, 0), lane=RIB, n=64, ribs=0, cap=True, collision=False):
        # profile: (z, x radius, y radius, x offset, y offset)
        vs, uv, fs = [], [], []
        for i, (z, rx, ry, dx, dy) in enumerate(profile):
            for j in range(n + 1):
                t = TAU * j / n
                bump = 1 + ribs * math.cos(t * 12)
                vs.append((center[0] + dx + rx * math.cos(t) * bump,
                           center[1] + dy + ry * math.sin(t) * bump, z))
                uv.append((j / n, i / max(1, len(profile) - 1)))
        for i in range(len(profile) - 1):
            for j in range(n):
                a = i * (n + 1) + j
                fs.append((a, a + 1, a + n + 2, a + n + 1))
        if cap:
            fs.extend([tuple(reversed(range(n))), tuple((len(profile) - 1) * (n + 1) + j for j in range(n))])
        return self.mesh(label, vs, fs, lane, uv, collision=collision)

    def block(self, label, center, dims, lane=PATH, bevel=.12, collision=False):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        o = bpy.context.object
        o.scale = dims
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
        for c in list(o.users_collection):
            c.objects.unlink(o)
        self.serial += 1
        o.name = ("COL_" if collision else "") + self.name + "_" + label + "_" + str(self.serial)
        (self.root if collision else self.lod).objects.link(o)
        if collision:
            o.hide_render = True
            o.display_type = "WIRE"
        else:
            mod = o.modifiers.new("soft_lapped_edge", "BEVEL")
            mod.width = bevel
            mod.segments = 3
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
            o.data.materials.append(bpy.data.materials["LIB_Nacre_SarelunTrim"])
            for uv in o.data.uv_layers.active.data:
                uv.uv = (.02 + .96 * uv.uv.x, (lane + .035 + .93 * uv.uv.y) / 8)
        return o

    def marker(self, name, xyz, **props):
        o = bpy.data.objects.new(name + "_" + self.name, None)
        self.root.objects.link(o)
        o.location = xyz
        for key, value in props.items():
            o[key] = value
        return o

    def light(self, xyz, distance=9):
        return self.marker("Light_Nacre_" + str(self.serial), xyz, color="#FFE7C2", intensity=.65, distance=distance)

    def deck(self, rx, ry, z=.36, center=(0, 0), lane=PATH):
        self.loft("LappedDeck", [(0, rx * .96, ry * .96, 0, 0), (z * .3, rx, ry, 0, 0),
                                   (z, rx, ry, 0, 0)], center, lane, n=96)
        self.loft("Deck", [(0, rx, ry, 0, 0), (z, rx, ry, 0, 0)], center, n=32, collision=True)
        return z

    def pier(self, x, y, z, radius=.4):
        self.loft("TidePier", [(0, radius * 1.35, radius * 1.35, 0, 0),
                              (min(.45, z * .30), radius * 1.22, radius * 1.22, 0, 0),
                              (min(1.1, z * .65), radius, radius, 0, 0), (z, radius * .77, radius * .77, 0, 0)], (x, y), TIDE, n=24)
        self.loft("Pier", [(0, radius * 1.2, radius * 1.2, 0, 0), (z, radius * .77, radius * .77, 0, 0)], (x, y), n=8, collision=True)

    def shell(self, label, center, rx, ry, z, height, ribs=13, tilt=0, segments=48, rings=16):
        vs, uv, fs = [], [], []
        def point(t, phi, extra=0):
            scallop = 1 + .022 * math.cos(phi * ribs)
            return (center[0] + rx * math.sin(t) * math.cos(phi) * scallop,
                    center[1] + ry * (math.sin(t) * math.sin(phi) * scallop + .48 * math.cos(t) ** 1.6),
                    z + height * math.cos(t) + tilt * math.sin(t) * math.sin(phi) + extra)
        for i in range(rings + 1):
            t = .015 + (math.pi / 2 - .015) * i / rings
            for j in range(segments + 1):
                phi = TAU * j / segments
                vs.append(point(t, phi))
                uv.append((j / segments, 1 - i / rings))
        for i in range(rings):
            for j in range(segments):
                a = i * (segments + 1) + j
                fs.append((a, a + segments + 1, a + segments + 2, a + 1))
        o = self.mesh(label, vs, fs, PEARL, uv)
        solid = o.modifiers.new("shell_thickness", "SOLIDIFY")
        solid.thickness = min(.2, height * .07)
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=solid.name)
        for k in range(ribs):
            phi = TAU * k / ribs
            pts = [point(.03 + (math.pi / 2 - .03) * i / 16, phi, .025) for i in range(17)]
            self.tube(label + "RadialRib", pts, .07 + rx * .013, RIB, sides=8)
        self.tube(label + "LapLip", [point(math.pi / 2, TAU * j / 96, -.035) for j in range(97)], .12, BRONZE)
        # The thin upper valve overlaps the lower shell instead of an exposed bolt seam.
        self.tube(label + "OverlappingValve", [point(1.17, TAU * j / 64, .045) for j in range(65)], .075, PEARL, sides=8)
        self.loft(label + "Hull", [(z - abs(tilt), rx, ry, 0, 0),
                                   (z + height * .4, rx * .91, ry * .91, 0, 0),
                                   (z + height * .75, rx * .65, ry * .65, 0, 0),
                                   (z + height, .05, .05, 0, ry * .48)], center, n=16, collision=True)

    def arcade(self, rx, ry, floor=.36, top=3.8, center=(0, 0), bays=12, front_open=True):
        for i in range(bays):
            t = TAU * i / bays
            x, y = center[0] + rx * math.cos(t), center[1] + ry * math.sin(t)
            if front_open and y < center[1] - ry * .68 and abs(x - center[0]) < 1.65:
                continue
            self.pier(x, y, top, .32)
        # An open perimeter: no invisible solid cylinder through the public entrance.
        self.tube("ArcadeCrown", [(center[0] + rx * math.cos(t), center[1] + ry * math.sin(t), top)
                                  for t in np.linspace(0, TAU, 97)], .22, RIB, sides=12)
        self.clearances.append({"width": 2.6, "height": 3.2, "floor": floor, "entry": [center[0], center[1] - ry, floor]})

    def rooms(self, rx, ry, floor=.36, top=3.8):
        # Rear half of the building: stone sills, actual recessed window openings,
        # lapped upper wall. The front half remains the walkable public arcade.
        for bay in range(8):
            a, b = math.pi * bay / 8, math.pi * (bay + 1) / 8
            for low, high in [(floor, 1.55), (2.8, top)]:
                verts = [(r * rx * math.cos(t), r * ry * math.sin(t), z)
                         for z in (low, high) for r in (.94, 1.0) for t in np.linspace(a, b, 9)]
                faces = []
                for k in range(8):
                    faces += [(k, k + 1, 19 + k, 18 + k),
                              (9 + k, 27 + k, 28 + k, 10 + k),
                              (18 + k, 19 + k, 28 + k, 27 + k),
                              (k, 9 + k, 10 + k, k + 1)]
                faces += [(0, 18, 27, 9), (8, 17, 35, 26)]
                self.mesh("LappedRoomWall", verts, faces, PEARL,
                          [(i % 9 / 8, .2 if i < 18 else .9) for i in range(36)])
                self.mesh("RoomWall", verts, faces, collision=True)
            for t in (a, b):
                self.tube("WindowJamb", [(rx * .97 * math.cos(t), ry * .97 * math.sin(t), 1.5),
                                         (rx * .97 * math.cos(t), ry * .97 * math.sin(t), 2.85)], .11, RIB)
            self.tube("WindowRecess", [(rx * .975 * math.cos(t), ry * .975 * math.sin(t), 2.18)
                                       for t in np.linspace(a + .025, b - .025, 17)], .34, TIDE, sides=8)

    def rail(self, points, floor, solid=False):
        if solid:
            for i in range(len(points) - 1):
                a, b = points[i], points[i + 1]
                self.tube("Bulwark", [(a[0], a[1], floor + .55), (b[0], b[1], floor + .55)], .5, PEARL, sides=10)
        self.tube("PolishedHandrail", [(x, y, floor + 1.05) for x, y in points], .065, BRONZE)
        for i in range(0, len(points), max(1, len(points) // 14)):
            x, y = points[i]
            self.tube("RailUpright", [(x, y, floor + .1), (x, y, floor + 1)], .055, RIB, sides=8)

    def lantern(self, x, y, z, scale=1):
        self.loft("LanternPedestal", [(z, .22 * scale, .22 * scale, 0, 0),
                                      (z + 1.7 * scale, .10 * scale, .10 * scale, 0, 0)], (x, y), RIB, n=24)
        self.shell("LanternShade", (x, y), .55 * scale, .48 * scale, z + 2 * scale, .40 * scale, ribs=9, segments=32, rings=8)
        self.loft("NacreDiffuser", [(z + 1.65 * scale, .2 * scale, .2 * scale, 0, 0),
                                    (z + 1.96 * scale, .32 * scale, .32 * scale, 0, 0)], (x, y), PEARL, n=32)
        self.tube("SoftInnerLight", [(x - .21 * scale, y, z + 1.8 * scale), (x + .21 * scale, y, z + 1.8 * scale)], .13 * scale, glow=True)
        self.light((x, y, z + 1.8 * scale))

    def finish(self):
        """Persist reduced meshes now; export may only read these saved LODs."""
        from artlib import lods, scene as S
        meshes = list(self.lod.objects)
        ceilings = {"building": 58000, "kit": 14500, "prop": 9500, "hero": 145000}
        initial = sum(S.tri_count(o) for o in meshes)
        if initial > ceilings[self.cls]:
            # Reduce oversampled curves in the modelling session, retaining separate
            # editable parts. Export never runs this operation on authored LOD0.
            lods._decimate(meshes, ceilings[self.cls])
        bpy.context.view_layer.update()
        points = np.concatenate([S.world_coords(o) for o in meshes])
        low, high = points.min(0), points.max(0)
        self.bounds = [low.tolist(), high.tolist()]
        self.radius = float(np.linalg.norm(points[:, :2], axis=1).max())
        triangles = sum(S.tri_count(o) for o in meshes)
        counts = [triangles]
        for k, ratio in enumerate((.30, .10, .035), 1):
            coll = bpy.data.collections.new(self.name + f"_LOD{k}")
            self.root.children.link(coll)
            copies = []
            for o in meshes:
                p = o.copy()
                p.data = o.data.copy()
                coll.objects.link(p)
                p.name = f"{self.name}_Reduced{k}_{len(copies)}"
                copies.append(p)
            bpy.ops.object.select_all(action="DESELECT")
            for o in copies:
                o.select_set(True)
            bpy.context.view_layer.objects.active = copies[0]
            bpy.ops.object.join()
            o = bpy.context.object
            o.name = f"{self.name}_ReducedSurface{k}"
            counts.append(lods._decimate([o], max(4, int(triangles * ratio))))
            coll.hide_render = True
        entry = {"id": self.name, "title": self.title, "role": self.role, "class": self.cls,
                 "boundsBlender": self.bounds, "footprintRadius": self.radius,
                 "authoredHeight": float(high[2] - low[2]), "lodTriangles": counts,
                 "lodNodes": [self.name + f"_LOD{k}" for k in range(4)],
                 "clearances": self.clearances, "walkRoutes": self.routes,
                 "markers": [{"name": o.name, "positionBlender": list(o.location), "properties": dict(o.items())}
                             for o in self.root.objects if o.type == "EMPTY"],
                 "colliders": [o.name for o in self.root.objects if o.type == "MESH"],
                 "padDiameter": self.pad}
        print("AUTHORED", self.name, counts, "height", entry["authoredHeight"], flush=True)
        return entry


def save(stem, items):
    import json
    path = HOME.parent / (stem + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    for entry in items:
        entry["source"] = str(path.relative_to(ROOT))
        entry["glb"] = f"packages/client/public/models/cities/{stem}.glb"
        entry["node"] = entry["id"]
        entry["sourceSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    (HOME / "receipts" / (stem + "-authored.json")).write_text(json.dumps(items, indent=2) + "\n")
