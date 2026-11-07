"""Seat the saved ore components on the revised host rock after CPU preview."""

from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[4]
path = ROOT / "assets/blend/flora/non_tree_resources.blend"
bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
assert bpy.context.scene["t05_revision"] == 1
bpy.context.preferences.filepaths.save_version = 0
for ob in bpy.context.scene.objects:
    if ob.type != "MESH" or ob.get("kind") not in (
        "copper",
        "cobalt",
        "gold",
        "dihydrogen",
    ):
        continue
    me = ob.data
    weights = me.color_attributes.active_color
    neighbors = [set() for v in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    seen = set()
    components = []
    for i in range(len(neighbors)):
        if i in seen:
            continue
        todo = [i]
        component = []
        seen.add(i)
        while todo:
            v = todo.pop()
            component.append(v)
            for j in neighbors[v] - seen:
                seen.add(j)
                todo.append(j)
        components.append(sorted(component))
    ore = [
        c for c in components if np.mean([weights.data[i].color[2] for i in c]) > 0.4
    ]
    host = {i for c in components if c not in ore for i in c}
    faces = [
        tuple(p.vertices) for p in me.polygons if all(i in host for i in p.vertices)
    ]
    bvh = BVHTree.FromPolygons([v.co for v in me.vertices], faces)
    # In the authored source, paired disconnected forms are a dendrite and its branch,
    # or a gold nodule and its vein. Keep the pairs rigid, at every LOD that retains both.
    if ob["kind"] in ("copper", "gold") and len(ore) % 2 == 0:
        ore = [ore[i] + ore[i + 1] for i in range(0, len(ore), 2)]
    for comp in ore:
        center = sum((me.vertices[i].co for i in comp), Vector()) / len(comp)
        hit = bvh.ray_cast(Vector((center.x, center.y, 5)), Vector((0, 0, -1)), 10)[0]
        if hit is None:
            continue
        bottom = min(me.vertices[i].co.z for i in comp)
        dz = hit.z - 0.055 - bottom
        for i in comp:
            me.vertices[i].co.z += dz
    me.update()
bpy.context.scene["t05_revision"] = 2
bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
