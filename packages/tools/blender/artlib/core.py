"""Loads a .blend or .glb and runs every check on it."""
from pathlib import Path

import bpy

from . import checks as C
from . import materials as M
from . import rules as R
from . import scene as S
from .report import Report

SOURCE_EXT = {".blend"}
EXPORT_EXT = {".glb", ".gltf"}


def mode_of(path):
    ext = Path(path).suffix.lower()
    if ext in SOURCE_EXT:
        return "source"
    if ext in EXPORT_EXT:
        return "export"
    return None


def load(path):
    """Opens a .blend, or imports a .glb into an empty scene."""
    S.clear_cache()
    M.clear_cache()
    if mode_of(path) == "source":
        bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
        _reveal()
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        # no bone-shape helper objects: the importer would add a parentless "Icosphere" next to every armature
        bpy.ops.import_scene.gltf(filepath=str(path), disable_bone_shape=True)
    S.clear_cache()


def _reveal():
    """Includes every collection and unhides every object (in memory only: the .blend is never saved), so LOD
    collections an artist excluded or hid are still evaluated, counted, baked and exported."""

    def walk(lc):
        lc.exclude = False
        lc.hide_viewport = False
        for c in lc.children:
            walk(c)

    for lc in bpy.context.view_layer.layer_collection.children:
        walk(lc)
    for c in bpy.data.collections:
        c.hide_viewport = False
        c.hide_select = False
    for o in bpy.context.view_layer.objects:
        o.hide_viewport = False
        o.hide_select = False
        o.hide_set(False)


def run_checks(rules, path, family, mode, cls=None, source=None, legacy_class=None):
    """Checks whatever is loaded now. `source` is the .blend an export came from (export mode)."""
    report = Report(str(path), family, mode)
    model = S.collect_source(rules) if mode == "source" else S.collect_export(rules)
    S.assign_classes(rules, family, model, cli_class=cls, legacy_class=legacy_class)
    C.naming(rules, family, model, report)
    C.triangles(rules, family, model, report)
    C.lods(rules, family, model, report)
    C.material_set(rules, family, model, report)
    C.scale(rules, family, model, report, source=source)
    report.assets = C.asset_summary(rules, model)
    report.model = model
    return report


def validate_path(rules, path, family=None, cls=None, source=None):
    path = Path(path)
    mode = mode_of(path)
    family = family or R.infer_family(rules, path)
    report = Report(str(path), family, mode or "?")
    if mode is None:
        report.error = f"not a .blend or .glb: {path.name}"
        return report
    if family is None:
        report.error = "cannot tell the family from the path; pass --family <name> (" + ", ".join(R.family_names(rules)) + ")"
        return report
    if family not in rules["families"]:
        report.error = f"unknown family {family} (" + ", ".join(R.family_names(rules)) + ")"
        return report
    if not path.exists():
        report.error = f"file not found: {path}"
        return report
    if R.is_lfs_pointer(path):
        report.error = "the file is a Git LFS pointer, not a .blend; run `git lfs pull`"
        return report
    if rules["families"][family].get("kind") == "cutscene":
        return _validate_cutscene(path, report, mode)
    if cls and cls not in rules["classes"]:
        report.error = f"unknown class {cls} (" + ", ".join(rules["classes"]) + ")"
        return report
    legacy = R.legacy_entry(rules, path) if mode == "export" else None
    if mode == "export" and source is None:
        source = R.source_for(rules, family, path)
    try:
        load(path)
    except Exception as e:  # a corrupt file or a failed import is a validation failure, not a crash
        report.error = f"could not load: {e}"
        return report
    return run_checks(rules, path, family, mode, cls=cls, source=source, legacy_class=(legacy or {}).get("class"))


def report_path(family, path, report_dir=None):
    d = Path(report_dir) if report_dir else R.REPORTS
    p = Path(path)
    return d / f"{family or 'unknown'}__{p.stem}{p.suffix}.json"


def write_and_print(report, json_path=None, verbose=False, quiet=False):
    if json_path:
        report.write(json_path, R.rel)
    if quiet:
        n = len(report.failures())
        why = f"  {report.error}" if report.error else (f"  ({n} failure{'s' if n != 1 else ''})" if n else "")
        print(f"{report.status}  {R.rel(report.path)}{why}")
    else:
        report.print(R.rel, verbose=verbose)
        if json_path:
            print(f"  report: {R.rel(json_path)}")
    return report


def _validate_cutscene(path, report, mode):
    """A cutscene source (families.json kind "cutscene"): export_cutscene.py's naming and marker-grammar checks."""
    if mode != "source":
        report.error = "a cutscene is checked from its .blend; its export is JSON, not a .glb"
        return report
    import export_cutscene  # packages/tools/blender, on the path validate.py and the export scripts set

    try:
        load(path)
    except Exception as e:
        report.error = f"could not load: {e}"
        return report
    export_cutscene.validate_into(report)
    return report
