"""Blender-free decisions for bounded, explicitly incomplete Lark evidence."""

import argparse
import math
from pathlib import Path

SCHEMA = "lark-evidence-prep/2"
SOURCE_REVISION = "6445c7ec07aa2a08b722aeca22d56132154ea32c"
SOURCE_SHA256 = "d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba"
DYNAMIC_CLEARANCE = "not_measured"
STATURE_M = 1.85
STATURE_TOL_M = 0.02
MAX_WIDTH, MAX_HEIGHT = 960, 540
MAX_PIXELS = MAX_WIDTH * MAX_HEIGHT
MAX_SAMPLES, MAX_IMAGES, THREADS = 16, 3, 2
GPU_DENOISERS = frozenset({"OPTIX"})
MATERIALS = ("Lark_Hull", "Lark_Accent", "Lark_Trim")
ALT_IMAGES = {"compact": "lark_livery_compact", "working": "lark_livery_working"}

# These are missing verification capabilities, not switches a caller can attest away.
PROOF_GAPS = {
    "seated-closed-canopy": [
        "production actor/rig identity and measured 1.85m standing stature",
        "evaluated seated joint pose, seat contact and actor world transform",
        "authored closed canopy target, tolerances and evaluated glass/frame transforms",
        "full body/head versus canopy intersection and containment inspection",
    ],
    "boarding-clearance": [
        "posed production body along boarding route with tread/handhold contacts",
        "body/collider intersections, containment and continuous reachability",
    ],
    "mounted-axis-clearance": [
        "authored module identity, socket binding, dimensions and forward-axis convention",
        "evaluated mounted geometry versus hull/colliders across authored limits",
    ],
}


def num(value):
    return None if value is None else round(float(value), 6)


def point(value):
    return None if value is None else [num(x) for x in value]


def output_allowed(out, blend):
    out_path, blend_path = Path(out).resolve(), Path(blend).resolve()
    return out_path != blend_path and not blend_path.is_relative_to(out_path)


def claim_output(out, blend):
    """Atomically reserve a fresh directory; existing files/dirs/symlinks are never reused."""
    out = Path(out).absolute()
    if not output_allowed(out, blend):
        raise ValueError("output directory contains source")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.mkdir(exist_ok=False)
    return out


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--out", required=True, help="new directory, must not exist")
    parser.add_argument("--variant", choices=("lark",), default="lark")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--samples", type=int, default=8)
    args = vars(parser.parse_args(argv[1:] if argv[:1] == ["--"] else argv))
    errors = gate_render({"engine": "CYCLES", "device": "CPU", "denoising_use_gpu": False,
                          "use_denoising": False, "threads": THREADS, "images_already": 0,
                          **{k: args[k] for k in ("width", "height", "samples")}})
    if errors:
        parser.error(f"bounds refused: {errors}")
    return args


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


def world_points(vertices, matrix):
    """Affine object-to-world transform; both dimensions and display use this frame."""
    result = [tuple(sum(matrix[i][j] * v[j] for j in range(3)) + matrix[i][3]
                    for i in range(3)) for v in vertices]
    if any(not math.isfinite(x) for p in result for x in p):
        raise ValueError("nonfinite world geometry")
    return result


def base_scope(paths):
    """Collection paths under the lark asset; ignore WIP and separate variant/LOD ownership."""
    scopes = set()
    for path in paths:
        if not path or path[0] != "lark" or any(name.startswith("_") for name in path):
            continue
        if any(("_LOD" in name and name != "lark_LOD0") or
               name in ("lark_damaged", "lark_husked") for name in path):
            scopes.add("other_variant_or_lod")
        else:
            scopes.add("base_lod0" if "lark_LOD0" in path else "shared_asset")
    if "other_variant_or_lod" in scopes and len(scopes) > 1:
        raise ValueError("object shared across conflicting variant/LOD collection paths")
    return "base_lod0" if "base_lod0" in scopes else "shared_asset" if "shared_asset" in scopes else "excluded"


def reference_extent(vertices):
    if not vertices:
        return None
    lo, hi = bounds_of(vertices)
    band = [v for v in vertices if v[2] <= lo[2] + 0.01]
    return {"lowest_band_center": [sum(v[i] for v in band) / len(band) for i in (0, 1)] + [lo[2]],
            "vertical_extent_m": num(hi[2] - lo[2]),
            "matches_1_85m_extent": abs(hi[2] - lo[2] - STATURE_M) <= STATURE_TOL_M,
            "pose": "saved_reference_mesh; anatomical pose not verified",
            "production_actor": "not_verified"}


def grid_fact(vertices, edges):
    # Only qualify a horizontal lattice from its line positions, not median edge length.
    axes = [set(), set()]
    if not vertices or not edges or max(p[2] for p in vertices) - min(p[2] for p in vertices) > 1e-6:
        return {"matches_1m_lattice": False, "reason": "missing_or_nonhorizontal_grid"}
    for a, b in edges:
        p, q = vertices[a], vertices[b]
        varying = [i for i in (0, 1) if abs(p[i] - q[i]) > 1e-6]
        if len(varying) != 1:
            return {"matches_1m_lattice": False, "reason": "non_axis_aligned_edge"}
        fixed = 1 - varying[0]
        axes[fixed].add(round(p[fixed], 6))
    spacings = [[b-a for a,b in zip(sorted(axis), sorted(axis)[1:])] for axis in axes]
    matches = all(len(gaps) >= 2 and all(abs(g-1.0) <= .01 for g in gaps) for gaps in spacings)
    return {"matches_1m_lattice": matches, "line_spacings_m": spacings,
            "plane_z": num(vertices[0][2]), "reason": "line_spacing_only; ground contact not verified"}


def resolve_liveries(materials, images, graph_gaps=()):
    missing = list(graph_gaps)
    for name in MATERIALS:
        if name not in materials:
            missing.append(f"{name} on rendered LOD0 faces with a resolved base-color image")
    facts = list(materials.values())
    if not facts or any(not f.get("sha256") or not f.get("packed_clean") for f in facts):
        missing.append("packed, clean source base-color images")
    defaults = {(f.get("sha256"), f.get("colorspace"), f.get("alpha_mode")) for f in facts}
    if len(defaults) != 1:
        missing.append("one shared default base-color payload and colour/alpha interpretation for all swapped materials")
    sources = []
    if facts:
        sources.append({"id": "saved-default", **facts[0]})
    for identity, name in ALT_IMAGES.items():
        fact = images.get(name)
        if not fact or not fact.get("sha256") or not fact.get("packed_clean"):
            missing.append(name + " packed clean image payload")
        else:
            sources.append({"id": identity, **fact})
    if len(sources) == 3 and len({s.get("sha256") for s in sources}) != 3:
        missing.append("three distinct image payloads (names/pointers do not prove identity)")
    return {"lineup": not missing, "status": "source_setup_ready" if not missing else "skipped",
            "sources": sources, "missing": missing,
            "order_left_to_right": [s["id"] for s in sources],
            "perceptual_distinction": "not_verified", "runtime_selection": "not_verified"}


def transform_record(item):
    matrix = item["matrix_world"]
    return {"name": item["name"], "matrix_world": matrix,
            "translation_m": point([matrix[i][3] for i in range(3)]),
            "axis_columns_xyz": [[num(matrix[i][j]) for i in range(3)] for j in range(3)],
            "parent_chain": item.get("parent_chain", []),
            "axes": "evaluated world basis, scale/shear retained; not module forward axes"}


def assemble_report(extracted):
    biped_raw = extracted.get("biped") or {}
    biped = reference_extent(biped_raw.get("vertices", []))
    grid_raw = extracted.get("grid") or {}
    grid = grid_fact(grid_raw.get("vertices", []), grid_raw.get("edges", []))
    placement = None
    marker = extracted.get("boarding_xyz")
    if biped and grid.get("plane_z") is not None and marker is not None:
        target = [marker[0], marker[1], grid["plane_z"]]
        delta = [target[i] - biped["lowest_band_center"][i] for i in range(3)]
        placement = {"translation_m": delta, "lowest_band_center_m": point(target),
                     "marker_z_minus_grid_m": num(marker[2] - grid["plane_z"]),
                     "meaning": "translated saved standing reference at marker XY; no boarding/contact proof"}
    hardpoints = []
    for item in extracted.get("hardpoints", []):
        hardpoints.append({**transform_record(item), "child_meshes": item.get("child_meshes", []),
                           "mounted_module": "not_verified", "axis_clearance": "not_measured",
                           "reason": "hierarchy and marker origins do not identify mounted equipment"})
    return {"schema": SCHEMA, "review_qualification": "not_claimed", "dynamic_clearance": DYNAMIC_CLEARANCE,
            "scope": "base lark_LOD0 only; no damaged/husked or other LOD qualification",
            "biped": biped, "grid": grid, "standing_reference_placement": placement,
            "seated_pose": "not_verified", "canopy_closed": "not_verified",
            "closed_headroom": "not_measured", "collision_clearance": "not_measured",
            "hardpoints": hardpoints,
            "pivots": [{**transform_record(p), "closed_state": "not_verified", "motion": "not_measured"}
                       for p in extracted.get("pivots", [])],
            "liveries": resolve_liveries(extracted.get("materials", {}), extracted.get("images", {}),
                                        extracted.get("livery_graph_gaps", [])),
            "source_observations": extracted.get("observations", {}),
            "remaining_proofs": PROOF_GAPS}


def plan_shots(extracted, report, width=640, height=480):
    if width < 1 or height < 1 or width > MAX_WIDTH or height > MAX_HEIGHT:
        raise ValueError("still exceeds bounds")
    shots = []
    skipped = [{"id": name, "status": "skipped", "missing": gaps} for name, gaps in PROOF_GAPS.items()]
    has_hull = bool(extracted.get("lod0_meshes"))
    if has_hull and report["standing_reference_placement"]:
        shots.append({"id": "standing-reference-scale", "width": width, "height": height,
                      "direction": (-.9, .35, .26), "margin": 1.8,
                      "label": "Saved standing reference translated to boarding-marker XY; no seated/boarding fit proof"})
    else:
        skipped.append({"id": "standing-reference-scale", "status": "skipped",
                        "missing": ["base LOD0 geometry, exact REF_Biped, horizontal REF_Grid and scoped BoardingFoot"]})
    if has_hull and (extracted.get("collider_names") or extracted.get("hardpoints")):
        shots.append({"id": "colliders-marker-axes", "width": width, "height": height,
                      "direction": (.8, .7, .4), "margin": 1.15,
                      "label": "Collider display and stored marker axes only; mounted modules/clearance unverified"})
    else:
        skipped.append({"id": "colliders-marker-axes", "status": "skipped",
                        "missing": ["base LOD0 geometry with scoped collider/HP objects"]})
    if has_hull and report["liveries"]["lineup"]:
        shots.append({"id": "livery-lineup", "width": 960, "height": 320, "cell_width": 320, "cell_height": 320,
                      "direction": (.72, .62, .32), "margin": 1.15,
                      "label": "Saved default | compact | working; source material preview, runtime selection unverified"})
    else:
        skipped.append({"id": "livery-lineup", "status": "skipped",
                        "missing": report["liveries"]["missing"] or ["base LOD0 geometry"]})
    return {"shots": shots, "skipped": skipped, "max_images": MAX_IMAGES}


def bounds_of(points):
    if not points:
        return None
    mins = [min(point_xyz[axis] for point_xyz in points) for axis in range(3)]
    maxs = [max(point_xyz[axis] for point_xyz in points) for axis in range(3)]
    return mins, maxs


def center_of(mins, maxs):
    return tuple((mins[axis] + maxs[axis]) * 0.5 for axis in range(3))
