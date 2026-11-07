"""Mutate real saved city geometry in memory; demonstrate validator rejection without saving."""
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, rules as R, scene as S

source = ROOT / "assets/blend/cities/thalune_low.blend"
rules = R.load()
results = []
for mutation in ("missing_collider", "missing_lod", "uniform_material", "wrong_reference_height", "under_triangle_budget"):
    core.load(source)
    model = S.collect_source(rules)
    asset = model.assets[0]
    variant = next(iter(asset.variants.values()))
    if mutation == "missing_collider":
        for obj in list(asset.holder.objects):
            if obj.name.startswith("COL_"):
                bpy.data.objects.remove(obj, do_unlink=True)
        expected = "naming"
    elif mutation == "missing_lod":
        bpy.data.collections.remove(bpy.data.collections[variant.id + "_LOD3"])
        expected = "lods"
    elif mutation == "uniform_material":
        mat = bpy.data.materials["LIB_Nacre_SarelunTrim"]
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        for link in list(bsdf.inputs["Base Color"].links):
            mat.node_tree.links.remove(link)
        expected = "materials"
    elif mutation == "wrong_reference_height":
        bpy.data.objects["REF_Biped"].scale.z = .5
        bpy.context.view_layer.update()
        expected = "scale"
    else:
        for obj in list(variant.lods[0])[1:]:
            bpy.data.objects.remove(obj, do_unlink=True)
        S.clear_cache()
        expected = "triangles"
    report = core.run_checks(rules, source, "cities", "source")
    rejected = report.status == "FAIL" and report[expected].status == "FAIL"
    results.append({"mutation": mutation, "expectedGate": expected, "rejected": rejected})
    print(mutation, "REJECTED" if rejected else "MISSED")
out = ROOT / "assets/blend/cities/thalune/receipts/negative-validation.json"
out.write_text(json.dumps(results, indent=2) + "\n")
raise SystemExit(0 if all(r["rejected"] for r in results) else 1)
