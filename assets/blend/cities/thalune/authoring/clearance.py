"""Sample full declared public-route extents against named, world-space COL meshes.

These are finite CPU collision probes, not a live walker or a continuous-volume proof.
The 0.20 m ray origin skips the supporting floor; its endpoint is the full height.
"""
import math

import numpy as np
from mathutils import Vector


def probe_route(named_trees, route):
    start, end = Vector(route["from"]), Vector(route["to"])
    direction = (end - start).normalized()
    right = Vector((direction.y, -direction.x, 0))
    minimum, witness, blocked = math.inf, None, []
    for t in np.linspace(0, 1, 25):
        point = start.lerp(end, float(t))
        hits = [tree.ray_cast(Vector((point.x, point.y, 2)), Vector((0, 0, -1)), 2.1)[0]
                for _, tree in named_trees]
        floors = [hit.z for hit in hits if hit is not None and hit.z < 1.6]
        floor = max(floors, default=point.z)
        for h in (.2, 1, 2, route["height"]):
            origin = Vector((point.x, point.y, floor + h)) - right * (route["width"] / 2)
            for name, tree in named_trees:
                if tree.ray_cast(origin, right, route["width"])[0] is not None:
                    blocked.append({"collider": name, "t": float(t), "axis": "width", "height": h})
        for offset in (-.5, 0, .5):
            origin = Vector((point.x, point.y, floor + .2)) + right * (offset * route["width"])
            for name, tree in named_trees:
                hit = tree.ray_cast(origin, Vector((0, 0, 1)), 400)[0]
                if hit is not None:
                    clearance = float(hit.z - floor)
                    if clearance < minimum:
                        minimum = clearance
                        witness = {"collider": name, "position": list(hit), "floor": floor, "t": float(t), "offset": offset}
                # No endpoint shortening or tolerance that could excuse a short door.
                if tree.ray_cast(origin, Vector((0, 0, 1)), route["height"] - .2)[0] is not None:
                    blocked.append({"collider": name, "t": float(t), "axis": "height", "offset": offset})
    return {"pass": not blocked, "minimumSampledCeiling": minimum if math.isfinite(minimum) else None,
            "limitingWitness": witness, "hits": blocked}
