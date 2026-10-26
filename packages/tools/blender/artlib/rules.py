"""families.json: asset classes, per-family rules, and the paths the pipeline reads and writes."""
import json
import os
import re
from fnmatch import fnmatchcase
from pathlib import Path

BLENDER_DIR = Path(__file__).resolve().parent.parent  # packages/tools/blender
REPO = Path(os.environ.get("ART_REPO_ROOT") or BLENDER_DIR.parents[2])
RULES_PATH = BLENDER_DIR / "families.json"
SOURCES = REPO / "assets" / "blend"
MODELS = REPO / "packages" / "client" / "public" / "models"
REPORTS = BLENDER_DIR / "reports"

SUFFIX = re.compile(r"\.\d{3,}$")  # Blender's uniqueness suffix (.001)
LOD = re.compile(r"^(?P<base>.+)_(?P<tag>LOD|lod|Lod)(?P<n>\d+)$")


class RuleError(Exception):
    pass


def load(path=RULES_PATH):
    with open(path, encoding="utf-8") as f:
        rules = json.load(f)
    for fam, spec in rules["families"].items():
        for cls in [spec["class"]] + [r["class"] for r in spec.get("classRules", [])]:
            if cls not in rules["classes"]:
                raise RuleError(f"families.json: family {fam} names unknown class {cls}")
    for name, cls in rules["classes"].items():
        if cls["profile"] not in rules["materialProfiles"]:
            raise RuleError(f"families.json: class {name} names unknown profile {cls['profile']}")
    return rules


def strip(name):
    """A name without Blender's .001 suffix."""
    return SUFFIX.sub("", name)


def match(name, patterns, ci=False):
    """Glob match; ci=True ignores case (marker names: HP_S_nose and hp_s_nose are both hardpoints)."""
    if isinstance(patterns, str):
        patterns = [patterns]
    if ci:
        return any(fnmatchcase(name.lower(), p.lower()) for p in patterns)
    return any(fnmatchcase(name, p) for p in patterns)


def material_name(mat):
    """The name a material exports under: its engine_name custom property (the library's LIB_PaintedPlate carries
    engine_name 'Hull'), else its own name without Blender's .001 suffix."""
    engine = mat.get("engine_name")
    return str(engine) if engine else strip(mat.name)


def lod_parts(name):
    """(base, n, legacy) for '<base>_LOD<n>' names; legacy is True for lower-case '_lod1' (the demo's flora)."""
    m = LOD.match(strip(name))
    if not m:
        return None
    return m.group("base"), int(m.group("n")), m.group("tag") != "LOD"


def family_names(rules, exportable=False):
    return [f for f, s in rules["families"].items() if not exportable or s.get("export", True)]


def infer_family(rules, path):
    """Family of a source or export path, or None. Sources: assets/blend/<family>/*.blend, assets/blend/_library.blend.
    Exports: packages/client/public/models/<family>/*.glb, or the demo's files listed under 'legacy'."""
    p = Path(path).resolve()
    legacy = rules.get("legacy", {})
    if p.name in legacy and p.parent == MODELS.resolve():
        return legacy[p.name]["family"]
    if p.suffix == ".blend" and p.name == "_library.blend":
        return "library"
    parent = p.parent.name
    if parent in rules["families"]:
        return parent
    if p.name in legacy:
        return legacy[p.name]["family"]
    return None


def legacy_entry(rules, path):
    """The families.json 'legacy' entry for one of the demo's exports (not for a family export of the same name)."""
    p = Path(path).resolve()
    entry = rules.get("legacy", {}).get(p.name)
    if not isinstance(entry, dict) or p.parent.name in rules["families"]:
        return None
    return entry


def source_for(rules, family, path):
    """The .blend an export came from: assets/blend/<family>/<stem>.blend."""
    if family == "library":
        return SOURCES / "_library.blend"
    return SOURCES / family / (Path(path).stem + ".blend")


def class_of(rules, family, variant, override=None):
    """Class for a variant: explicit override (asset_class property or --class), then the family's classRules, then
    the family's default class."""
    if override:
        return override
    spec = rules["families"][family]
    for rule in spec.get("classRules", []):
        if match(variant, rule["match"]):
            return rule["class"]
    return spec["class"]


def size_rule(rules, family, cls):
    fam = rules["families"][family].get("size", {})
    return fam.get(cls) or rules["classes"][cls].get("size")


def profile_for(rules, family, cls, *names):
    """Material profile: the family's rules first, then the global materialRules, then the class default. `names` are
    the material's engine name and its own name (a rule on either applies: EngineGlow or LIB_EngineGlow)."""
    spec = rules["families"][family].get("materials", {})
    for rule in spec.get("profiles", []) + rules.get("materialRules", []):
        if any(match(n, rule["match"]) for n in names):
            return rule["profile"]
    return rules["classes"][cls]["profile"]


def is_lfs_pointer(path):
    try:
        with open(path, "rb") as f:
            head = f.read(64)
    except OSError:
        return False
    return head.startswith(b"version https://git-lfs.github.com/spec/")


def rel(path):
    """Repo-relative path for messages (absolute when outside the repo)."""
    try:
        return str(Path(path).resolve().relative_to(REPO.resolve()))
    except ValueError:
        return str(path)
