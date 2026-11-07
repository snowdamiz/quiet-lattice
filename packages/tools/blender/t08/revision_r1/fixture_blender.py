"""Run exact stock export code with inert geometry/codec dependencies, never Blender."""

import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import sys
import time
from types import ModuleType, SimpleNamespace as NS

ROOT = Path(os.environ["T08_FIXTURE_ROOT"])
CASE = os.environ["T08_CASE"]
if "--only" in sys.argv and sys.argv[sys.argv.index("--only") + 1] == "loot_pod":
    CASE = "ok"
(ROOT / "producer.pid").write_text(str(os.getpid()))
script = Path(sys.argv[sys.argv.index("-P") + 1])
sys.path.insert(0, str(script.resolve().parent))


def module(name, **values):
    m = ModuleType(name)
    m.__dict__.update(values)
    sys.modules[name] = m
    return m


def noop(*args, **kwargs):
    return None


def object_new(*args):
    return NS(children_recursive=[], parent=None, hide_set=noop, select_set=noop)


def write_geometry(**kwargs):
    Path(kwargs["filepath"]).write_bytes(b"CPU-DEPENDENCY-FIXTURE-NOT-ART")


module(
    "bpy",
    data=NS(collections=NS(new=lambda name: NS()), objects=NS(new=object_new)),
    context=NS(
        scene=NS(collection=NS(children=NS(link=noop), objects=NS(link=noop))),
        view_layer=NS(objects=NS(active=None), update=noop),
    ),
)


# _write iterates objects; a small iterable with the real active attribute suffices.
class Objects(list):
    active = None


sys.modules["bpy"].context.view_layer.objects = Objects()
sys.modules["bpy"].ops = NS(export_scene=NS(gltf=write_geometry))
module("mathutils", Matrix=NS(), Vector=lambda v: v)

rules = {"families": {"props": {}, "sites": {}}, "output": "{family}/{stem}.glb"}
module(
    "artlib.rules",
    load=lambda: rules,
    SOURCES=ROOT / "assets/blend",
    MODELS=ROOT / "packages/client/public/models",
    rel=lambda p: str(p),
)
for name in ["bake", "lods", "materials", "scene", "checks"]:
    module("artlib." + name)
module("artlib.glb", finalize=noop)
for name in ["ktx", "meshopt"]:
    module(
        "artlib." + name,
        settings=lambda *a: {"compress": True},
        jobs=lambda: 1,
        compress=lambda src, dst, *a: shutil.copyfile(src, dst),
    )


def report(status="PASS"):
    asset = NS(
        name=sys.argv[sys.argv.index("--only") + 1],
        class_override=None,
        holder=None,
        extras=[],
        variants={},
    )
    return NS(status=status, error=None, model=NS(assets=[asset]))


def validate_path(*args, **kwargs):
    return report()


def report_path(family, path, directory):
    return Path(directory) / (family + "__" + Path(path).name + ".json")


def write_report(check, path, **kwargs):
    path.parent.mkdir(parents=True, exist_ok=True)
    status = (
        "FAIL"
        if CASE == "stock_fail" and path.name.endswith("glb.json")
        else check.status
    )
    path.write_text(json.dumps({"status": status, "CPUDependencyFixture": True}) + "\n")


def run_checks(*args, **kwargs):
    source = kwargs["source"]
    (ROOT / "validation-entered").write_text("ready")
    if CASE in ["term", "int", "deny", "outer_term", "cohort"]:
        if CASE == "cohort":
            import subprocess

            subprocess.Popen(
                [sys.executable, "-B", "-c", "import time; time.sleep(60)"]
            )
        else:
            deadline = time.monotonic() + 60
            while not (ROOT / "release").exists():
                if time.monotonic() > deadline:
                    raise TimeoutError("fixture barrier")
                time.sleep(0.02)
    if CASE == "source_change":
        source.write_bytes(b"SOURCE-MUTATED")
    elif CASE == "source_alias":
        target = source.with_name("same-bytes.blend")
        target.write_bytes(source.read_bytes())
        source.unlink()
        source.symlink_to(target)
    elif CASE == "source_unreadable_after":
        source.chmod(0)
    elif CASE == "new_unreadable":
        Path(kwargs["glb"]).chmod(0)
    elif CASE == "signal_exit":
        os.kill(os.getpid(), signal.SIGTERM)
    return report()


module(
    "artlib.core",
    validate_path=validate_path,
    write_and_print=write_report,
    report_path=report_path,
    load=noop,
    run_checks=run_checks,
)
real_move = shutil.move


def move(src, dst, *args, **kwargs):
    value = real_move(src, dst, *args, **kwargs)
    with (ROOT / "stock-moves.jsonl").open("a") as f:
        f.write(json.dumps({"source": str(src), "destination": str(dst)}) + "\n")
    (ROOT / "stock-move.json").write_text(
        json.dumps({"source": str(src), "destination": str(dst)})
    )
    if CASE == "child_fail":
        raise SystemExit(7)
    return value


shutil.move = move
runpy.run_path(str(script), run_name="__main__")
