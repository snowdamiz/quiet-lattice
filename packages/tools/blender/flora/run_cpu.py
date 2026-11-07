"""Finite, serial CPU-only Blender runner. Child process group is owned and cleaned up."""

import argparse
import fcntl
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
p = argparse.ArgumentParser()
p.add_argument("--timeout", type=int, default=1200)
p.add_argument("--log", required=True)
p.add_argument("script")
p.add_argument("args", nargs=argparse.REMAINDER)
a = p.parse_args()
env = os.environ.copy()
for key in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
    "TBB_NUM_THREADS",
    "UV_THREADPOOL_SIZE",
):
    env[key] = "2"
env["ART_KTX_JOBS"] = "1"
env["PYTHONDONTWRITEBYTECODE"] = "1"
env["KTX"] = env.get(
    "KTX",
    str(ROOT / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"),
)
env["CUDA_VISIBLE_DEVICES"] = ""
log = ROOT / a.log
log.parent.mkdir(parents=True, exist_ok=True)
cmd = [
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "-b",
    "-t",
    "2",
    "--factory-startup",
    "--python-exit-code",
    "1",
    "-P",
    a.script,
    "--",
    *a.args,
]
with open("/tmp/astra-flora-t05-blender.lock", "w") as lock, log.open("w") as output:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    output.write("COMMAND " + repr(cmd) + "\n")
    output.flush()
    child = subprocess.Popen(
        cmd,
        cwd=ROOT,
        env=env,
        stdout=output,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        code = child.wait(timeout=a.timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        code = 124
    finally:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if child.poll() is None:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    output.write(f"\nEXIT {code}\n")
print(f"{log.relative_to(ROOT)}: exit {code}")
print("\n".join(log.read_text().splitlines()[-18:]))
sys.exit(code)
