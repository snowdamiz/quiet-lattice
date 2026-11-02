"""Check reopened saved sources against the exact pre-revision object/material fingerprints."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
old = json.loads((BASE / "initial_source_audit.json").read_text())
new = json.loads((BASE / "current_source_audit.json").read_text())
results = []
for kit in ("waystation", "scrapyard"):
    a = next(r for r in old if Path(r["source"]).stem == kit)
    b = next(r for r in new if Path(r["source"]).stem == kit)
    before, after = a["snapshot"], b["snapshot"]
    changed = sorted(n for n in before["objects"].keys() | after["objects"].keys()
                     if before["objects"].get(n) != after["objects"].get(n))
    if kit == "waystation":
        permitted = lambda n: n in {f"ws_fabricator_L{k}" for k in range(4)}
        permitted_materials = set()
    else:
        permitted = lambda n: n in {f"sy_rock_L{k}" for k in range(4)} or n.startswith(("COL_Rock_", "COL_R4Geo_"))
        permitted_materials = {"SY_Rock", "SY_Regolith", "SY_Fracture_R4", "SY_Excavated_R4"}
        inventory = json.loads((ROOT / "assets/renders/stations/review_round3/scrapyard/metadata/source_inventory.json").read_text())
        for name in (f"SY_GeoDust{k}" for k in range(1, 6)):
            users = [o["name"] for o in inventory["objects"] if name in o["materials"]]
            assert users and all(n.startswith("sy_rock_L") for n in users)
            assert name not in after["materials"], "Obsolete zero-user transition material unexpectedly retained"
            permitted_materials.add(name)
    assert all(permitted(n) for n in changed), changed
    materials = sorted(n for n in before["materials"].keys() | after["materials"].keys()
                       if before["materials"].get(n) != after["materials"].get(n))
    assert set(materials) <= permitted_materials
    assert before["collections"] == after["collections"]
    source = ROOT / b["source"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == b["sha256"]
    markers = {n: s for n, s in before["objects"].items() if n.startswith(("Socket_", "Light_", "Interact", "BAY_", "REF_"))}
    assert all(after["objects"].get(n) == s for n, s in markers.items())
    results.append({"kit": kit, "current_source": b["source"], "current_sha256": b["sha256"],
                    "changed_objects": changed, "changed_materials": materials,
                    "zero_user_old_rock_transition_materials_purged_on_save": [n for n in materials if n.startswith("SY_GeoDust")],
                    "unaffected_original_objects_exact": len(set(before["objects"]) - set(changed)),
                    "existing_socket_light_interact_bay_ref_objects_exact": len(markers),
                    "collection_metadata_exact": True})
(BASE / "saved_source_invariants.json").write_text(json.dumps(results, indent=2) + "\n")
print("REOPENED SAVED-SOURCE INVARIANTS PASS", [(r["kit"], r["unaffected_original_objects_exact"]) for r in results])
