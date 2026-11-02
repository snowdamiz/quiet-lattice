"""Bind refreshed review assemblies to saved sources and verify references, lights and literal cuts."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"


def file_info(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}


def load(path):
    raw = path.read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + length])
    binary = raw[28 + length:]
    sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def accessor(index):
        a = doc["accessors"][index]
        v = doc["bufferViews"][a["bufferView"]]
        assert "EXT_meshopt_compression" not in v.get("extensions", {}), "Review copies use retained PNG/plain geometry"
        size = sizes[a["componentType"]] * widths[a["type"]]
        stride = v.get("byteStride", size)
        offset = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        payload = b"".join(binary[offset + i * stride:offset + i * stride + size] for i in range(a["count"]))
        return {"type": a["type"], "componentType": a["componentType"], "count": a["count"],
                "payload_sha256": hashlib.sha256(payload).hexdigest()}

    meshes = {}
    for n in doc["nodes"]:
        if "mesh" not in n:
            continue
        states = []
        bounds = []
        for p in doc["meshes"][n["mesh"]]["primitives"]:
            states.append({key: accessor(value) for key, value in p["attributes"].items()})
            a = doc["accessors"][p["attributes"]["POSITION"]]
            bounds.append([a.get("min"), a.get("max")])
        meshes[n["name"]] = {"attributes": states, "bounds": bounds}
    lights = [{"name": n["name"], "extras": n.get("extras"), "translation": n.get("translation"),
               "rotation": n.get("rotation"), "matrix": n.get("matrix")}
              for n in doc["nodes"] if n.get("name", "").startswith("Light_")]
    references = {n["name"]: {k: v for k, v in n.items() if k not in ("mesh", "children")}
                  for n in doc["nodes"] if n.get("name", "").startswith(("biped_", "lark0_"))}
    counts = {}
    for n in doc["nodes"]:
        if n.get("name", "").startswith("assembled_LOD"):
            children = [doc["nodes"][i].get("name", "") for i in n.get("children", [])]
            counts[n["name"]] = {"bipeds": sum(x.startswith("biped_") for x in children),
                                  "lark_body": sum(x.startswith("lark0_Body") for x in children)}
    return {"meshes": meshes, "light_markers": lights, "references": references, "lod_counts": counts,
            "punctual_lights": doc.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])}


schedule = [
    ("waystation", "uncut", "assemble-waystation-uncut", "waystation_uncut_figures.glb", "capture_readiness/review_copies/uncut_figures.glb"),
    ("waystation", "cutaway", "assemble-waystation-cutaway", "waystation_cutaway_figures.glb", "capture_readiness/review_copies/cutaway_figures.glb"),
    ("scrapyard", "uncut", "assemble-scrapyard-uncut", "scrapyard_assembled_figures_lark.glb", "followon_readiness/review_copies/assembled_figures_lark.glb"),
    ("scrapyard", "cutaway", "assemble-scrapyard-cutaway", "scrapyard_cutaway_figures_lark.glb", "followon_readiness/review_copies/cutaway_figures_lark.glb"),
]
reports = []
for kit, kind, stage, filename, previous in schedule:
    source = BASE / "current/sources/stations" / f"{kit}.blend"
    export = BASE / "current/models/stations" / f"{kit}.glb"
    current = BASE / "current/review_copies" / filename
    prior = ROOT / "assets/renders/stations/round3" / previous
    a, b = load(prior), load(current)
    assert a["light_markers"] == b["light_markers"]
    assert a["punctual_lights"] == b["punctual_lights"]
    assert a["references"] == b["references"]
    assert a["lod_counts"] == b["lod_counts"] and len(b["lod_counts"]) == 4
    larks = [n for n in a["meshes"] if n.startswith("lark0_")]
    assert all(a["meshes"][n]["attributes"] == b["meshes"][n]["attributes"] for n in larks)
    bipeds = [n for n in a["meshes"] if n.startswith("biped_")]
    assert all(a["meshes"][n]["attributes"] == b["meshes"][n]["attributes"] for n in bipeds)
    biped_heights = [max(v[1][1] for v in b["meshes"][n]["bounds"]) - min(v[0][1] for v in b["meshes"][n]["bounds"]) for n in bipeds]
    assert all(abs(height - 1.85) < 0.001 for height in biped_heights)
    cut = None
    if kind == "cutaway":
        prefix, axis, maximum = ("ws_hangar_", 1, 15.0001) if kit == "waystation" else ("sy_rock_", 0, 0.0001)
        cut_bounds = {n: v["bounds"] for n, v in b["meshes"].items() if n.startswith(prefix)}
        assert cut_bounds and all(bounds[1][axis] <= maximum for rows in cut_bounds.values() for bounds in rows)
        cut = {"literal_argv": json.loads((BASE / f"jobs/{stage}.json").read_text())["argv"],
               "verified_position_accessor_bounds": cut_bounds,
               "cut_rule": "hangar Blender z>15 only, no cap" if kit == "waystation" else "rock Blender x>0 only, capped; mouth uncut"}
    job = json.loads((BASE / f"jobs/{stage}.json").read_text())
    assert job["exit"] == 0 and not job["remaining_owned"]
    assert any(i["sha256"] == file_info(source)["sha256"] for i in job["input_bindings"])
    reports.append({"kit": kit, "kind": kind, "source": file_info(source), "export": file_info(export),
                    "review_copy": file_info(current), "previous_copy": file_info(prior), "build_job": file_info(BASE / f"jobs/{stage}.json"),
                    "light_markers_exact": True, "punctual_light_count": len(b["punctual_lights"]), "punctual_lights_exact": True,
                    "reference_transforms_exact": True, "lark_mesh_attribute_buffers_exact": len(larks),
                    "biped_mesh_attribute_buffers_exact": len(bipeds), "biped_height_m": biped_heights,
                    "references_per_lod": b["lod_counts"], "cut": cut,
                    "evidence_scope": "Review-only refreshed geometry; no render, bake, browser, traversal or performance run"})
(BASE / "review_copy_audit.json").write_text(json.dumps(reports, indent=2) + "\n")
print("REVIEW COPIES PASS", [(r["kit"], r["kind"], r["punctual_light_count"]) for r in reports])
