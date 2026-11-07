"""Plain decisions for the Lark CPU evidence capture.

The Blender script feeds extracted scene facts in and gets a report back.
Nothing here imports bpy, renders, or writes a blend. A missing livery, a
missing seat, or a mesh over the triangle cap stays a named gap. Clearance
numbers are static point-to-triangle distances. Dynamic clearance is never
a number.
"""

import fnmatch
import math
import re
from pathlib import Path

SCHEMA = "lark-evidence-prep/1"
DYNAMIC_CLEARANCE = "not_measured"

STATURE_M = 1.85
STATURE_TOL_M = 0.02
EYE_ABOVE_FEET_M = 1.70
SEAT_ABOVE_FLOOR_M = 1.2
GRID_SPACING_M = 1.0
GRID_TOL_M = 0.01
CONTACT_M = 0.001
VERTEX_CAP = 8000
TRIANGLE_CAP = 20000
PRODUCT_CAP = 2_000_000
CHILD_MESH_CAP = 8
ROUND_M = 6

MAX_WIDTH = 960
MAX_HEIGHT = 540
MAX_PIXELS = MAX_WIDTH * MAX_HEIGHT
MAX_SAMPLES = 16
MAX_IMAGES = 4
THREADS = 2

MATERIALS = ("Lark_Hull", "Lark_Accent", "Lark_Trim")
ALT_IMAGES = {"compact": "lark_livery_compact", "working": "lark_livery_working"}
GPU_DENOISERS = frozenset({"OPTIX"})
HP_GLOBS = ("HP_S_*", "HP_M_*", "HP_L_*")
_SUFFIX = re.compile(r"\.\d{3}$")

VIEWS = {
    "boarding-standing": (-0.9, 0.35, 0.26),
    "cockpit-closed-canopy": (0.55, 0.75, 0.38),
    "colliders-axes": (0.8, 0.7, 0.4),
    "livery-lineup": (0.72, 0.62, 0.32),
}


def conventions():
    return {
        "stature_m": STATURE_M,
        "stature_tolerance_m": STATURE_TOL_M,
        "stature_source": "families.json reference.biped and art bible section 1",
        "eye_above_feet_m": EYE_ABOVE_FEET_M,
        "eye_source": "art bible section 1 standing biped eye height",
        "seat_above_floor_m": SEAT_ABOVE_FLOOR_M,
        "seat_source": "art bible section 1 cockpit seat reference point above the cockpit floor",
        "seated_pose": "standing mesh with feet on the plane seat_z minus 1.2 m and no joint rotation",
        "dynamic_clearance": DYNAMIC_CLEARANCE,
        "rounded_m": 10 ** -ROUND_M,
    }


def num(value):
    if value is None:
        return None
    return round(float(value), ROUND_M)


def point(value):
    if value is None:
        return None
    return [num(value[0]), num(value[1]), num(value[2])]


def strip_blender_suffix(name):
    return _SUFFIX.sub("", name)


def prefer_unsuffixed(names):
    groups = {}
    for name in names:
        groups.setdefault(strip_blender_suffix(name), []).append(name)
    kept = []
    dropped = []
    for base in sorted(groups):
        group = groups[base]
        if base in group:
            kept.append(base)
            dropped.extend(item for item in group if item != base)
        else:
            chosen = sorted(group)[0]
            kept.append(chosen)
            dropped.extend(item for item in group if item != chosen)
    return {"kept": kept, "dropped_duplicates": dropped}


def _variant_name(name):
    base = strip_blender_suffix(name)
    return "_dmg" in base or "_husk" in base


def is_hardpoint_name(name):
    base = strip_blender_suffix(name)
    if _variant_name(name):
        return False
    return any(fnmatch.fnmatchcase(base, pattern) for pattern in HP_GLOBS)


def is_collider_name(name):
    base = strip_blender_suffix(name)
    if _variant_name(name):
        return False
    return fnmatch.fnmatchcase(base, "COL_*")


def is_canopy_surface(name, kind):
    base = strip_blender_suffix(name)
    if _variant_name(name):
        return False
    expected = "CanopyGlass" if kind == "glass" else "CanopyFrame"
    return base == expected


def is_rest_pivot(name):
    base = strip_blender_suffix(name)
    if _variant_name(name):
        return False
    return base == "Canopy" or base.startswith("Gear")


def is_boarding_foot(name):
    return strip_blender_suffix(name) == "BoardingFoot"


def is_pilot_seat(name):
    return strip_blender_suffix(name) == "PilotSeat"


def is_biped(name):
    return strip_blender_suffix(name) == "REF_Biped"


def is_grid(name):
    return strip_blender_suffix(name) == "REF_Grid"


def output_allowed(out, blend):
    out_path = Path(out).resolve()
    blend_path = Path(blend).resolve()
    if out_path == blend_path or out_path == blend_path.parent:
        return False
    return not blend_path.is_relative_to(out_path)


def parse_args(argv):
    if argv and argv[0] == "--":
        argv = argv[1:]
    blend = out = None
    variant = "lark"
    width, height, samples = 640, 480, 8
    index = 0
    while index < len(argv):
        flag = argv[index]

        def take(flag=flag):
            nonlocal index
            if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
                raise SystemExit(f"missing value for {flag}")
            index += 1
            return argv[index]

        if flag == "--blend":
            blend = take()
        elif flag == "--out":
            out = take()
        elif flag == "--variant":
            variant = take()
        elif flag == "--width":
            width = int(take())
        elif flag == "--height":
            height = int(take())
        elif flag == "--samples":
            samples = int(take())
        else:
            raise SystemExit(f"unknown argument {flag}")
        index += 1
    if not blend or not out:
        raise SystemExit(
            "usage: capture.py -- --blend PATH --out DIR [--variant lark] [--width 640] [--height 480] [--samples 8]"
        )
    if not variant or "/" in variant or "\\" in variant or ".." in variant:
        raise SystemExit("variant must be a single collection prefix")
    errors = gate_render(
        {
            "engine": "CYCLES",
            "device": "CPU",
            "denoising_use_gpu": False,
            "use_denoising": False,
            "denoiser": "OPENIMAGEDENOISE",
            "samples": samples,
            "width": width,
            "height": height,
            "images_already": 0,
            "threads": THREADS,
        }
    )
    if errors:
        raise SystemExit(f"bounds refused: {errors}")
    return {
        "blend": blend,
        "out": out,
        "variant": variant,
        "width": width,
        "height": height,
        "samples": samples,
    }


def gate_render(observed):
    errors = []
    if observed.get("engine") != "CYCLES":
        errors.append("engine")
    if observed.get("device") != "CPU":
        errors.append("device")
    if observed.get("denoising_use_gpu") is not False:
        errors.append("denoising_use_gpu")
    if observed.get("use_denoising") and observed.get("denoiser") in GPU_DENOISERS:
        errors.append("denoiser")
    samples = observed.get("samples")
    if not isinstance(samples, int) or isinstance(samples, bool) or samples < 1 or samples > MAX_SAMPLES:
        errors.append("samples")
    width = observed.get("width")
    height = observed.get("height")
    if (
        not isinstance(width, int)
        or not isinstance(height, int)
        or isinstance(width, bool)
        or isinstance(height, bool)
        or width < 1
        or height < 1
        or width > MAX_WIDTH
        or height > MAX_HEIGHT
        or width * height > MAX_PIXELS
    ):
        errors.append("resolution")
    if observed.get("images_already", 0) >= MAX_IMAGES:
        errors.append("image_count")
    if observed.get("threads") != THREADS:
        errors.append("threads")
    return errors


def _backed(fact):
    if "backed" not in fact:
        return True
    return bool(fact["backed"])


def _image_ok(fact):
    if not fact or not fact.get("key"):
        return False
    if not _backed(fact):
        return False
    return int(fact.get("width") or 0) > 0 and int(fact.get("height") or 0) > 0


def resolve_liveries(materials, images):
    missing = []
    keys = []
    for name in MATERIALS:
        fact = materials.get(name)
        if not _image_ok(fact):
            missing.append(name)
            continue
        keys.append(fact)
    thalune = None
    reason = None
    if len(keys) == len(MATERIALS):
        distinct = {fact["key"] for fact in keys}
        if len(distinct) == 1:
            thalune = {
                "id": "thalune",
                "image_name": keys[0].get("name"),
                "key": keys[0]["key"],
                "width": int(keys[0]["width"]),
                "height": int(keys[0]["height"]),
            }
        else:
            reason = "thalune_materials_disagree"
    alts = {}
    for livery_id, image_name in ALT_IMAGES.items():
        fact = images.get(image_name)
        if _image_ok(fact):
            alts[livery_id] = {
                "id": livery_id,
                "image_name": image_name,
                "key": fact["key"],
                "width": int(fact["width"]),
                "height": int(fact["height"]),
            }
        else:
            missing.append(image_name)
    sources = [item for item in (thalune, alts.get("compact"), alts.get("working")) if item]
    if reason == "thalune_materials_disagree" or thalune is None or len(sources) < 3:
        return {
            "status": "incomplete",
            "reason": reason or "missing_source",
            "lineup": False,
            "sources": sources,
            "missing": missing,
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    if len({item["key"] for item in sources}) < 3:
        return {
            "status": "incomplete",
            "reason": "liveries_not_distinct",
            "lineup": False,
            "sources": sources,
            "missing": missing,
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    return {
        "status": "ready",
        "reason": "three_distinct_sources",
        "lineup": True,
        "sources": sources,
        "missing": [],
        "order_left_to_right": ["thalune", "compact", "working"],
        "dynamic_clearance": DYNAMIC_CLEARANCE,
    }


def surface_showable(surface):
    return surface.get("status") == "ok" and len(surface.get("triangles") or []) > 0


def shot_facts(extracted, lineup_ready):
    biped = extracted.get("biped") or {}
    grid = extracted.get("grid") or {}
    colliders = extracted.get("colliders") or {}
    return {
        "biped": bool(biped.get("vertices")),
        "grid": grid.get("origin_z") is not None,
        "boarding_marker": extracted.get("boarding_xyz") is not None,
        "pilot_seat": extracted.get("seat_xyz") is not None,
        "canopy_glass": surface_showable(extracted.get("canopy_glass") or {}),
        "canopy_frame": surface_showable(extracted.get("canopy_frame") or {}),
        "collider_names": list(colliders.get("names") or []),
        "hardpoint_names": [item["name"] for item in extracted.get("hardpoints") or []],
        "lineup": bool(lineup_ready),
    }


def plan_shots(facts, width=640, height=480):
    if width > MAX_WIDTH or height > MAX_HEIGHT or width < 1 or height < 1 or width * height > MAX_PIXELS:
        raise ValueError("still exceeds bounds")
    shots = []
    skipped = []

    def skip(shot_id, missing):
        skipped.append({"id": shot_id, "status": "skipped", "missing": missing})

    missing = []
    if not facts.get("biped"):
        missing.append("REF_Biped")
    if not facts.get("grid"):
        missing.append("REF_Grid")
    if not facts.get("boarding_marker"):
        missing.append("BoardingFoot")
    if missing:
        skip("boarding-standing", missing)
    else:
        shots.append(
            {
                "id": "boarding-standing",
                "width": width,
                "height": height,
                "direction": VIEWS["boarding-standing"],
                "margin": 1.8,
                "frame": "biped",
                "subjects": ["lod0", "REF_Biped", "REF_Grid"],
            }
        )
    missing = []
    if not facts.get("biped"):
        missing.append("REF_Biped")
    if not facts.get("pilot_seat"):
        missing.append("PilotSeat")
    if not facts.get("canopy_glass") and not facts.get("canopy_frame"):
        missing.append("CanopyGlass|CanopyFrame")
    if missing:
        skip("cockpit-closed-canopy", missing)
    else:
        shots.append(
            {
                "id": "cockpit-closed-canopy",
                "width": width,
                "height": height,
                "direction": VIEWS["cockpit-closed-canopy"],
                "margin": 1.25,
                "frame": "biped_and_canopy",
                "subjects": ["lod0", "REF_Biped", "REF_Grid", "closed_canopy"],
            }
        )
    if not facts.get("collider_names") and not facts.get("hardpoint_names"):
        skip("colliders-axes", ["COL_*", "HP_*"])
    else:
        shots.append(
            {
                "id": "colliders-axes",
                "width": width,
                "height": height,
                "direction": VIEWS["colliders-axes"],
                "margin": 1.15,
                "frame": "shown_meshes",
                "subjects": ["lod0", "COL_*", "HP_axes"],
            }
        )
    if facts.get("lineup"):
        shots.append(
            {
                "id": "livery-lineup",
                "width": 960,
                "height": 320,
                "cell_width": 320,
                "cell_height": 320,
                "direction": VIEWS["livery-lineup"],
                "margin": 1.15,
                "frame": "lod0",
                "subjects": ["lod0", "liveries"],
                "order_left_to_right": ["thalune", "compact", "working"],
            }
        )
    else:
        skip("livery-lineup", ["three distinct livery sources"])
    if len(shots) > MAX_IMAGES:
        raise RuntimeError("shot plan exceeds image cap")
    for shot in shots:
        pixels = shot["width"] * shot["height"]
        if shot["width"] > MAX_WIDTH or shot["height"] > MAX_HEIGHT or pixels > MAX_PIXELS:
            raise RuntimeError(f"shot {shot['id']} exceeds pixel cap")
    return {
        "shots": shots,
        "skipped": skipped,
        "dynamic_clearance": DYNAMIC_CLEARANCE,
        "max_images": MAX_IMAGES,
    }


def qualify_height(height_m):
    return {
        "height_m": num(height_m),
        "matches_1_85": abs(height_m - STATURE_M) <= STATURE_TOL_M,
        "expected_m": STATURE_M,
        "tolerance_m": STATURE_TOL_M,
    }


def qualify_grid(spacing_m):
    if spacing_m is None:
        return {"spacing_m": None, "matches_1m": False, "expected_m": GRID_SPACING_M, "tolerance_m": GRID_TOL_M}
    return {
        "spacing_m": num(spacing_m),
        "matches_1m": abs(spacing_m - GRID_SPACING_M) <= GRID_TOL_M,
        "expected_m": GRID_SPACING_M,
        "tolerance_m": GRID_TOL_M,
    }


def median_edge_length(vertices, edges):
    if not vertices or not edges:
        return None
    lengths = []
    for start, end in edges:
        delta = _sub(vertices[start], vertices[end])
        lengths.append(math.sqrt(_dot(delta, delta)))
    if not lengths:
        return None
    lengths.sort()
    mid = len(lengths) // 2
    if len(lengths) % 2:
        return lengths[mid]
    return 0.5 * (lengths[mid - 1] + lengths[mid])


def feet_from_vertices(vertices, band_m=0.01):
    if not vertices:
        return None
    min_z = min(vertex[2] for vertex in vertices)
    max_z = max(vertex[2] for vertex in vertices)
    band = [vertex for vertex in vertices if vertex[2] <= min_z + band_m]
    return {
        "feet_xyz": (
            sum(vertex[0] for vertex in band) / len(band),
            sum(vertex[1] for vertex in band) / len(band),
            min_z,
        ),
        "crown_z": max_z,
        "height_m": max_z - min_z,
        "vertex_count": len(vertices),
    }


def translation(feet_xyz, target_xy, target_z):
    return (target_xy[0] - feet_xyz[0], target_xy[1] - feet_xyz[1], target_z - feet_xyz[2])


def move_point(point_xyz, delta):
    return (point_xyz[0] + delta[0], point_xyz[1] + delta[1], point_xyz[2] + delta[2])


def move_vertices(vertices, delta):
    return [move_point(vertex, delta) for vertex in vertices]


def clearance_probes(feet_xyz, height_m, matches_1_85):
    probes = [
        {
            "id": "mesh_crown",
            "kind": "measured_mesh",
            "point": point((feet_xyz[0], feet_xyz[1], feet_xyz[2] + height_m)),
        }
    ]
    if matches_1_85:
        probes.append(
            {
                "id": "convention_eye",
                "kind": "art_bible_standing_eye",
                "status": "measured",
                "point": point((feet_xyz[0], feet_xyz[1], feet_xyz[2] + EYE_ABOVE_FEET_M)),
            }
        )
    else:
        probes.append(
            {
                "id": "convention_eye",
                "kind": "art_bible_standing_eye",
                "status": "skipped_height_mismatch",
                "point": None,
            }
        )
    return probes


def transform_record(name, matrix3, translation_xyz):
    columns = [[matrix3[row][col] for row in range(3)] for col in range(3)]
    identity = True
    for col in range(3):
        for row in range(3):
            expected = 1.0 if col == row else 0.0
            if abs(columns[col][row] - expected) > 1e-5:
                identity = False
    return {
        "name": name,
        "translation_m": point(translation_xyz),
        "axis_columns_xyz": [[num(item) for item in column] for column in columns],
        "rotation_identity": identity,
    }


def module_clearance(child_mesh_names):
    names = list(child_mesh_names)
    if not names:
        return {
            "mounted_module": "absent",
            "axis_clearance": "not_measured",
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    if len(names) > CHILD_MESH_CAP:
        return {
            "mounted_module": "ambiguous",
            "child_meshes": names,
            "axis_clearance": "not_measured",
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    return {
        "mounted_module": "present",
        "child_meshes": names,
        "dynamic_clearance": DYNAMIC_CLEARANCE,
    }


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul(a, scale):
    return (a[0] * scale, a[1] * scale, a[2] * scale)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _closest_on_triangle(p, a, b, c):
    ab = _sub(b, a)
    ac = _sub(c, a)
    ap = _sub(p, a)
    d1 = _dot(ab, ap)
    d2 = _dot(ac, ap)
    if d1 <= 0.0 and d2 <= 0.0:
        return a
    bp = _sub(p, b)
    d3 = _dot(ab, bp)
    d4 = _dot(ac, bp)
    if d3 >= 0.0 and d4 <= d3:
        return b
    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        scale = d1 / (d1 - d3)
        return _add(a, _mul(ab, scale))
    cp = _sub(p, c)
    d5 = _dot(ab, cp)
    d6 = _dot(ac, cp)
    if d6 >= 0.0 and d5 <= d6:
        return c
    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        scale = d2 / (d2 - d6)
        return _add(a, _mul(ac, scale))
    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        scale = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return _add(b, _mul(_sub(c, b), scale))
    denom = va + vb + vc
    if denom == 0.0:
        return min((a, b, c), key=lambda vertex: _dot(_sub(p, vertex), _sub(p, vertex)))
    v = vb / denom
    w = vc / denom
    return _add(a, _add(_mul(ab, v), _mul(ac, w)))


def point_triangle_distance(p, triangle):
    closest = _closest_on_triangle(p, triangle[0], triangle[1], triangle[2])
    delta = _sub(p, closest)
    return math.sqrt(_dot(delta, delta))


def segment_intersects_triangle(p0, p1, triangle, eps=1e-9):
    """Segment versus triangle. A coplanar hit returns false."""
    a, b, c = triangle
    direction = _sub(p1, p0)
    ab = _sub(b, a)
    ac = _sub(c, a)
    pvec = _cross(direction, ac)
    det = _dot(ab, pvec)
    if abs(det) < eps:
        return False
    inv = 1.0 / det
    tvec = _sub(p0, a)
    u = _dot(tvec, pvec) * inv
    if u < -eps or u > 1.0 + eps:
        return False
    qvec = _cross(tvec, ab)
    v = _dot(direction, qvec) * inv
    if v < -eps or u + v > 1.0 + eps:
        return False
    t = _dot(ac, qvec) * inv
    return -eps <= t <= 1.0 + eps


def distances_to_triangles(points, triangles, vertex_cap=VERTEX_CAP, triangle_cap=TRIANGLE_CAP):
    point_count = 0 if points is None else len(points)
    triangle_count = 0 if triangles is None else len(triangles)
    base = {
        "dynamic": False,
        "dynamic_clearance": DYNAMIC_CLEARANCE,
        "points": point_count,
        "triangles": triangle_count,
    }
    if triangle_count > triangle_cap:
        return {**base, "status": "triangle_cap_exceeded", "distance_m": None}
    if point_count > vertex_cap:
        return {**base, "status": "vertex_cap_exceeded", "distance_m": None}
    if point_count * triangle_count > PRODUCT_CAP:
        return {**base, "status": "product_cap_exceeded", "distance_m": None}
    if point_count == 0 or triangle_count == 0:
        return {**base, "status": "not_measured", "distance_m": None, "reason": "empty"}
    best = None
    for probe in points:
        for triangle in triangles:
            distance = point_triangle_distance(probe, triangle)
            if best is None or distance < best:
                best = distance
    return {
        **base,
        "status": "measured",
        "distance_m": num(best),
        "method": "point_to_triangle",
        "contact_or_closer_than_1mm": best <= CONTACT_M,
    }


def segment_against(p0, p1, triangles, triangle_cap=TRIANGLE_CAP):
    if triangles is None:
        return {"status": "not_measured", "hits": None, "dynamic_clearance": DYNAMIC_CLEARANCE}
    if len(triangles) > triangle_cap:
        return {"status": "triangle_cap_exceeded", "hits": None, "dynamic_clearance": DYNAMIC_CLEARANCE}
    if not triangles:
        return {"status": "not_measured", "hits": None, "reason": "empty", "dynamic_clearance": DYNAMIC_CLEARANCE}
    return {
        "status": "measured",
        "hits": any(segment_intersects_triangle(p0, p1, triangle) for triangle in triangles),
        "method": "moller_trumbore_excluding_coplanar",
        "dynamic_clearance": DYNAMIC_CLEARANCE,
    }


def _surface_count(surface):
    if not surface:
        return {"status": "missing", "triangle_count": 0}
    triangles = surface.get("triangles") or []
    return {"status": surface.get("status", "missing"), "triangle_count": len(triangles)}


def _triangles_of(surface):
    if not surface or surface.get("status") != "ok":
        return None
    return surface.get("triangles") or []


def assemble_report(extracted):
    liveries = resolve_liveries(extracted.get("materials") or {}, extracted.get("images") or {})
    biped_raw = extracted.get("biped")
    feet = feet_from_vertices(biped_raw["vertices"]) if biped_raw and biped_raw.get("vertices") else None
    biped = None
    if biped_raw and feet:
        height = qualify_height(feet["height_m"])
        biped = {
            "name": biped_raw.get("name"),
            "feet_xyz": point(feet["feet_xyz"]),
            "crown_z": num(feet["crown_z"]),
            "vertex_count": feet["vertex_count"],
            **height,
        }
    grid_raw = extracted.get("grid")
    grid = None
    if grid_raw and grid_raw.get("origin_z") is not None:
        spacing = median_edge_length(grid_raw.get("vertices") or [], grid_raw.get("edges") or [])
        grid = {"name": grid_raw.get("name"), "origin_z": num(grid_raw["origin_z"]), **qualify_grid(spacing)}
        if grid_raw.get("vertices"):
            mesh_min_z = min(vertex[2] for vertex in grid_raw["vertices"])
            grid["mesh_min_z"] = num(mesh_min_z)
            grid["origin_minus_mesh_min_m"] = num(grid_raw["origin_z"] - mesh_min_z)

    placements = {"boarding": None, "cockpit_standing": None}
    if biped and grid and extracted.get("boarding_xyz") is not None:
        marker = extracted["boarding_xyz"]
        delta = translation(feet["feet_xyz"], (marker[0], marker[1]), grid_raw["origin_z"])
        placed = move_point(feet["feet_xyz"], delta)
        placements["boarding"] = {
            "pose": "standing_mesh_feet_on_grid_origin",
            "translation_m": point(delta),
            "feet_xyz": point(placed),
            "marker_xyz": point(marker),
            "marker_z_minus_grid_m": num(marker[2] - grid_raw["origin_z"]),
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    if biped and extracted.get("seat_xyz") is not None:
        seat = extracted["seat_xyz"]
        floor_z = seat[2] - SEAT_ABOVE_FLOOR_M
        delta = translation(feet["feet_xyz"], (seat[0], seat[1]), floor_z)
        placed = move_point(feet["feet_xyz"], delta)
        placements["cockpit_standing"] = {
            "pose": conventions()["seated_pose"],
            "translation_m": point(delta),
            "feet_xyz": point(placed),
            "seat_xyz": point(seat),
            "implied_floor_z": num(floor_z),
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }

    glass = extracted.get("canopy_glass") or {"status": "missing", "triangles": []}
    frame = extracted.get("canopy_frame") or {"status": "missing", "triangles": []}
    clearance = {
        "status": "not_measured",
        "reason": "missing_seat_or_biped",
        "dynamic_clearance": DYNAMIC_CLEARANCE,
        "glass": _surface_count(glass),
        "frame": _surface_count(frame),
        "method_note": "Static point-to-triangle and segment tests. Coplanar segment hits are not detected. This is not a dynamic clearance.",
    }
    if placements["cockpit_standing"] is not None:
        delta = placements["cockpit_standing"]["translation_m"]
        delta_t = (delta[0], delta[1], delta[2])
        placed_feet = (
            placements["cockpit_standing"]["feet_xyz"][0],
            placements["cockpit_standing"]["feet_xyz"][1],
            placements["cockpit_standing"]["feet_xyz"][2],
        )
        probes = clearance_probes(placed_feet, feet["height_m"], biped["matches_1_85"])
        probe_rows = []
        for probe in probes:
            row = {"id": probe["id"], "kind": probe["kind"], "point": probe["point"], "dynamic_clearance": DYNAMIC_CLEARANCE}
            if probe["point"] is None:
                row["status"] = probe["status"]
                probe_rows.append(row)
                continue
            xyz = (probe["point"][0], probe["point"][1], probe["point"][2])
            row["glass"] = _gap(glass, [xyz])
            row["frame"] = _gap(frame, [xyz])
            probe_rows.append(row)
        moved = move_vertices(biped_raw["vertices"], delta_t)
        crown = (placed_feet[0], placed_feet[1], placed_feet[2] + feet["height_m"])
        clearance = {
            "status": "measured" if any(surface_showable(item) for item in (glass, frame)) else "not_measured",
            "dynamic_clearance": DYNAMIC_CLEARANCE,
            "glass": _surface_count(glass),
            "frame": _surface_count(frame),
            "probes": probe_rows,
            "biped_vertices": {"glass": _gap(glass, moved), "frame": _gap(frame, moved)},
            "standing_segment_intersects": {
                "glass": segment_against(placed_feet, crown, _triangles_of(glass)),
                "frame": segment_against(placed_feet, crown, _triangles_of(frame)),
            },
            "method_note": "Static point-to-triangle and segment tests. Coplanar segment hits are not detected. This is not a dynamic clearance.",
        }

    colliders = extracted.get("colliders") or {"names": [], "status": "missing", "triangles": []}
    hardpoints = []
    for item in extracted.get("hardpoints") or []:
        record = transform_record(item["name"], item["matrix3"], item["translation"])
        record.update(module_clearance(item.get("child_meshes") or []))
        if record["mounted_module"] == "present":
            record["static_origin_to_collider"] = _gap(colliders, [tuple(item["translation"])])
            record["static_origin_to_collider_note"] = (
                "Unsigned distance from the empty origin to collider triangles. "
                "A point inside a volume is not reported as penetration."
            )
        hardpoints.append(record)
    pivots = [
        {**transform_record(item["name"], item["matrix3"], item["translation"]), "motion": "not_measured"}
        for item in extracted.get("pivots") or []
    ]
    return {
        "schema": SCHEMA,
        "dynamic_clearance": DYNAMIC_CLEARANCE,
        "review_qualification": "not_claimed",
        "conventions": conventions(),
        "biped": biped,
        "grid": grid,
        "placements": placements,
        "clearance": clearance,
        "hardpoints": hardpoints,
        "pivots": pivots,
        "colliders": {
            "names": list(colliders.get("names") or []),
            "status": colliders.get("status", "missing"),
            "triangle_count": len(colliders.get("triangles") or []),
        },
        "liveries": liveries,
        "dropped_duplicate_names": list(extracted.get("dropped_duplicate_names") or []),
    }


def _gap(surface, points):
    status = None if surface is None else surface.get("status")
    if status == "triangle_cap_exceeded":
        return {
            "status": "triangle_cap_exceeded",
            "distance_m": None,
            "dynamic": False,
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    if status != "ok":
        return {
            "status": "not_measured",
            "distance_m": None,
            "reason": status or "missing",
            "dynamic": False,
            "dynamic_clearance": DYNAMIC_CLEARANCE,
        }
    return distances_to_triangles(points, surface.get("triangles") or [])


def bounds_of(points):
    if not points:
        return None
    mins = [min(point_xyz[axis] for point_xyz in points) for axis in range(3)]
    maxs = [max(point_xyz[axis] for point_xyz in points) for axis in range(3)]
    return mins, maxs


def ortho_scale(mins, maxs, margin=1.2):
    extent = max(maxs[axis] - mins[axis] for axis in range(3))
    return max(extent * margin, 0.5)


def center_of(mins, maxs):
    return tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
