"""Freeze exact current artifacts and future single-stage capture commands; never launches capture."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"


def binding(path):
    path = Path(path)
    if not path.is_absolute():
        path = ROOT / path
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}


promotions = json.loads((BASE / "canonical_promotion.json").read_text())
inputs = [binding(r["canonical_path"]) for r in promotions]
inputs += [binding(r["path"]) for r in json.loads((BASE / "shared_input_bindings.json").read_text())]
inputs += [binding(p) for p in sorted((BASE / "current/review_copies").glob("*.glb"))]
inputs += [binding("assets/blend/stations/_authoring/review_assembled.ts")]
hashes = {r["path"]: r["sha256"] for r in inputs}
stages = []
for kit, asset in (("waystation", "ws_fabricator"), ("scrapyard", "sy_rock")):
    out = f"assets/renders/stations/round4/engine/attempt01/standard/{kit}"
    # No call is made here. Parent's bounded runner must check inputs and the separate GPU grant before exec.
    code = "const { captureReview } = await import('./packages/tools/src/capture/capture.ts');" + f" const files = await captureReview('stations/{kit}', {{ asset: '{asset}', outDir: '{out}' }}); for (const f of files) console.log('wrote ' + f);"
    stages.append({"id": f"standard-{kit}-{asset}", "kind": "standard", "kit": kit, "asset": asset,
                   "argv": ["pnpm", "exec", "tsx", "--eval", f"(async()=>{{{code}}})().then(()=>process.exit(0),e=>{{console.error(e);process.exit(1)}});"],
                   "out_path": f"{out}/{asset}", "standard_scene_settings_changed": False,
                   "performance_scope": "Raw standard readout remains unqualified; E14.T13 owns measurement qualification"})
replacements = {
    "assets/renders/stations/round3/capture_readiness/review_copies/uncut_figures.glb": "assets/renders/stations/round4/current/review_copies/waystation_uncut_figures.glb",
    "assets/renders/stations/round3/capture_readiness/review_copies/cutaway_figures.glb": "assets/renders/stations/round4/current/review_copies/waystation_cutaway_figures.glb",
    "assets/renders/stations/round3/followon_readiness/review_copies/assembled_figures_lark.glb": "assets/renders/stations/round4/current/review_copies/scrapyard_assembled_figures_lark.glb",
    "assets/renders/stations/round3/followon_readiness/review_copies/cutaway_figures_lark.glb": "assets/renders/stations/round4/current/review_copies/scrapyard_cutaway_figures_lark.glb",
}
for kit in ("waystation", "scrapyard"):
    previous = json.loads((ROOT / f"assets/renders/stations/review_round3/{kit}/metadata/supplemental_views.json").read_text())
    for row in previous:
        if row["id"] == "supplement-ws-ring":
            continue  # Exact unchanged module-bound images remain at their original source/metadata paths.
        argv = []
        for arg in row["argv"]:
            arg = replacements.get(arg, arg)
            argv.append(arg.replace("assets/renders/stations/round3/engine/attempt01/", "assets/renders/stations/round4/engine/attempt01/"))
        out = argv[argv.index("--out") + 1]
        stages.append({"id": row["id"], "kind": "supplement", "kit": kit, "argv": argv, "out_path": out,
                       "requested_shots": [argv[i + 1] for i, arg in enumerate(argv) if arg == "--shot"],
                       "request_matches_prior": True, "camera_request_actual_equivalence_claimed": False,
                       "standard_placement_or_performance_evidence": False})
for row in stages:
    assert not (ROOT / row["out_path"]).exists()
plan = {"task": "P1.E11.T01", "submission_round": 4, "GPU_GATE": "CLOSED; separate explicit parent resource grant required",
        "input_bindings": inputs, "input_sha256": hashes, "stages": stages,
        "stage_policy": "One bounded stage, inspect outputs and drain all owned processes/profile/port before another stage. Parent may hold at each boundary.",
        "preserved_limits": ["Standard rock/ring night occlusion and 100m cropping/intersection remain coverage limits",
                             "Requested explicit eyes/FOV are not reported as actual camera values; retain both in new metadata",
                             "No qualified 60fps, traversal, door-animation or continuous-LOD claim"],
        "bake": "No pending channel/AO bakes in validated exports; no bake job required"}
(BASE / "capture_readiness.json").write_text(json.dumps(plan, indent=2) + "\n")
(BASE / "HOLD_GPU").write_text("CPU preparation only. Parent must explicitly grant GPU resources before any capture stage.\n")
reuse = []
for record in json.loads((BASE / "export_module_bindings_final.json").read_text()):
    kit = record["kit"]
    prior_manifest = json.loads((ROOT / f"assets/renders/stations/review_round3/{kit}/manifest.json").read_text())
    standard = json.loads((ROOT / f"assets/renders/stations/review_round3/{kit}/metadata/standard_modules.json").read_text())
    for module in record["modules"]:
        if not module["exact_export_module_match"]:
            continue
        name = module["module"]
        static = [r for r in prior_manifest["static_artifacts"] if f"/{kit}_{name}_" in r["path"]]
        for item in static:
            assert binding(item["path"])["sha256"] == item["sha256"]
        reuse.append({"kit": kit, "asset": name, "module_fingerprint": module["current_fingerprint"],
                      "binding_proof": binding(BASE / "export_module_bindings_final.json"),
                      "original_static_artifacts": static,
                      "original_standard_module": next(r for r in standard if r["asset"] == name),
                      "capture_provenance": "Original third-submission paths, hashes and original whole-export metadata retained; visual module equality verified separately",
                      "old_perf_current_measurement": False})
assert len(reuse) == 13
(BASE / "reused_module_evidence.json").write_text(json.dumps(reuse, indent=2) + "\n")
print("FROZEN CAPTURE READINESS", len(stages), "unlaunched GPU stages;13 exact module evidence reuses")
