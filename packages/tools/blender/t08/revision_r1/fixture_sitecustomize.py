"""CPU test dependencies only, copied as sitecustomize.py into private fixtures."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys

root = Path(os.environ["T08_FIXTURE_ROOT"])
real_popen = subprocess.Popen


class CpuPopen(real_popen):
    def __init__(self, args, *pos, **kw):
        requested = list(args) if isinstance(args, (list, tuple)) else args
        if (
            isinstance(requested, list)
            and requested[0] == "/Applications/Blender.app/Contents/MacOS/Blender"
        ):
            args = [
                sys.executable,
                "-B",
                str(root / "fixture_blender.py"),
                *requested[1:],
            ]
            with (root / "substitution.jsonl").open("a") as f:
                f.write(json.dumps({"requested": requested, "actual": args}) + "\n")
        super().__init__(args, *pos, **kw)
        if isinstance(requested, list) and any(
            str(x).endswith("/t08/run.py") for x in requested
        ):
            (root / "runner.pid").write_text(str(self.pid))


subprocess.Popen = CpuPopen
if os.environ.get("T08_DENY_KILL"):

    def denied(*args):
        raise PermissionError(1, "controlled killpg EPERM")

    os.killpg = denied

# Never acquire or touch the real task's host-wide lock from a fixture.
import builtins

real_open = builtins.open


def private_open(file, *args, **kwargs):
    if str(file) == "/tmp/space-t08-cpu.lock":
        file = root.parent / "fixture-cpu.lock"
    return real_open(file, *args, **kwargs)


builtins.open = private_open

case = os.environ.get("T08_CASE")
real_replace = os.replace
receipt_fault_used = False


def replace(src, dst, *args, **kwargs):
    global receipt_fault_used
    if case == "rename_denied" and str(src).endswith(
        "public/models/props/cargo_pod.glb"
    ):
        raise PermissionError(13, "controlled canonical rename denial")
    result = real_replace(src, dst, *args, **kwargs)
    if (
        case == "receipt_after_replace"
        and Path(dst).name == "binding.json"
        and not receipt_fault_used
    ):
        receipt_fault_used = True
        raise OSError(5, "controlled error after receipt replacement")
    if case == "final_source_change" and Path(src).name == "promotion.glb":
        (root / "assets/blend/props/cargo_pod.blend").write_bytes(
            b"FINAL-SOURCE-MUTATION"
        )
    if case == "signal_during_binding" and Path(dst).name == "binding.json":
        os.kill(os.getpid(), signal.SIGTERM)
    if case == "signal_during_result" and Path(dst).name == "result.json":
        os.kill(os.getpid(), signal.SIGTERM)
    return result


os.replace = replace
if case == "readlink_error":
    real_readlink = os.readlink

    def readlink(path, *args, **kwargs):
        if Path(path).name == "cargo_pod.glb":
            raise PermissionError(13, "controlled readlink denial")
        return real_readlink(path, *args, **kwargs)

    os.readlink = readlink
if case == "observation_failure":
    real_output = subprocess.check_output

    def output(command, *args, **kwargs):
        if command[0] == "ps":
            raise OSError(5, "controlled process observation failure")
        return real_output(command, *args, **kwargs)

    subprocess.check_output = output
