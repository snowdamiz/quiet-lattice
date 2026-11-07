"""Bounded, exclusive CPU jobs. Each invocation keeps a new immutable attempt directory."""

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
META = ROOT / "assets/blend/cities/ulgani"
LIMITS = {
    "OMP_NUM_THREADS": "2",
    "OPENBLAS_NUM_THREADS": "2",
    "MKL_NUM_THREADS": "2",
    "VECLIB_MAXIMUM_THREADS": "2",
    "NUMEXPR_NUM_THREADS": "2",
    "BLIS_NUM_THREADS": "2",
    "TBB_NUM_THREADS": "2",
    "UV_THREADPOOL_SIZE": "2",
    "ART_KTX_JOBS": "1",
    "OIDN_NUM_THREADS": "2",
    "PYTHONDONTWRITEBYTECODE": "1",
}


def host():
    memory = subprocess.check_output(["memory_pressure", "-Q"], text=True)
    stat = os.statvfs(ROOT)
    return {
        "time": time.time(),
        "load": list(os.getloadavg()),
        "memoryFreePercent": int(re.search(r"free percentage: (\d+)%", memory)[1]),
        "diskFreeBytes": stat.f_bavail * stat.f_frsize,
    }


def group_members(pgid):
    ps = subprocess.check_output(["ps", "-axo", "pid=,pgid=,rss=,stat="], text=True)
    return [
        {"pid": int(p), "rssKiB": int(r), "state": s}
        for line in ps.splitlines()
        for p, g, r, s in [line.split()]
        if int(g) == pgid
    ]


def stop_group(proc):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            proc.poll()
            if not group_members(proc.pid):
                break
            time.sleep(0.2)
    proc.wait()
    return group_members(proc.pid)


def main():
    def interrupted(signum, _frame):
        raise InterruptedError(f"supervisor signal {signum}")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    p = argparse.ArgumentParser()
    p.add_argument("label")
    p.add_argument("--seconds", type=int, default=900)
    p.add_argument("--rss-mib", type=int, default=7000)
    p.add_argument("--log-mib", type=int, default=24)
    p.add_argument("--capacity-seconds", type=int, default=300)
    p.add_argument("--stale", action="append", default=[])
    p.add_argument("command", nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not command:
        p.error("command is required")
    attempt = META / "attempts" / a.label
    attempt.mkdir(parents=True, exist_ok=False)
    receipt = {
        "command": command,
        "cwd": str(ROOT),
        "limits": vars(a),
        "environment": LIMITS,
        "started": time.time(),
        "preflight": host(),
        "samples": [],
    }
    receipt["toolSHA256"] = {
        str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(Path(__file__).parent.iterdir())
        if path.suffix in (".py", ".mjs")
    }
    for name in ("families.json", "export_cities.py", "validate.py"):
        path = ROOT / "packages/tools/blender" / name
        receipt["toolSHA256"][str(path.relative_to(ROOT))] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    env = dict(os.environ, **LIMITS)
    # macOS Unix sockets have short path limits; tsx places its IPC socket under TMPDIR.
    scratch = Path(tempfile.mkdtemp(prefix="ulgani-", dir="/tmp"))
    receipt["scratchDirectory"] = str(scratch)
    env["TMPDIR"] = str(scratch)
    env["ULGANI_CODEC_LOG"] = str(attempt / "codec.jsonl")
    env["KTX"] = str(Path(__file__).with_name("ktx_cpu.py"))
    env["ULGANI_KTX_REAL"] = str(
        ROOT / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"
    )
    proc = None
    rc = 1
    reason = None
    lock = open(META / ".lane.lock", "a")  # noqa: SIM115 - release only after owned group cleanup
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        start = time.monotonic()
        while True:
            sample = host()
            receipt["samples"].append(sample)
            if (
                sample["load"][0] <= 19
                and sample["memoryFreePercent"] >= 25
                and sample["diskFreeBytes"] >= 8 * 1024**3
            ):
                break
            if time.monotonic() - start > a.capacity_seconds:
                raise RuntimeError(
                    "capacity gate: load >19, free memory <25%, or disk <8GiB"
                )
            print("Waiting for CPU capacity", sample, flush=True)
            time.sleep(10)
        logpath = attempt / "output.log"
        receipt["launchToolSHA256"] = {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(Path(__file__).parent.iterdir())
            if path.suffix in (".py", ".mjs")
        }
        with open(logpath, "xb") as log:
            proc = subprocess.Popen(
                command,
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            receipt["pid"] = receipt["pgid"] = proc.pid
            start = time.monotonic()
            peak = 0
            while proc.poll() is None:
                members = group_members(proc.pid)
                rss = sum(m["rssKiB"] for m in members)
                peak = max(peak, rss)
                if (
                    time.monotonic() - start > a.seconds
                    or rss > a.rss_mib * 1024
                    or logpath.stat().st_size > a.log_mib * 1024**2
                ):
                    raise RuntimeError("wall/RSS/output limit exceeded")
                if (
                    len(receipt["samples"]) == 0
                    or time.time() - receipt["samples"][-1]["time"] >= 20
                ):
                    receipt["samples"].append(
                        {**host(), "groupRSSKiB": rss, "members": members}
                    )
                time.sleep(1)
            rc = proc.returncode
            receipt["peakGroupRSSKiB"] = peak
            receipt["wallSeconds"] = time.monotonic() - start
    except BaseException as exc:  # noqa: BLE001 - every failure must drain the owned process group
        reason = repr(exc)
        rc = 1
    finally:
        receipt["remainingGroup"] = stop_group(proc) if proc is not None else []
        if receipt["remainingGroup"]:
            rc = 1
        else:
            receipt["scratchRemovedBytes"] = sum(
                p.stat().st_size for p in scratch.rglob("*") if p.is_file()
            )
            shutil.rmtree(scratch)
        if rc:
            receipt["removedStale"] = []
            for name in a.stale:
                path = (ROOT / name).resolve()
                if (
                    path.parent != ROOT / "packages/client/public/models/cities"
                    or not path.name.startswith("ulgani_")
                ):
                    raise RuntimeError("stale removal outside owned exports")
                if path.exists():
                    path.unlink()
                    receipt["removedStale"].append(name)
        receipt.update(
            {"exit": rc, "error": reason, "ended": time.time(), "postflight": host()}
        )
        output = attempt / "output.log"
        receipt["failureTail"] = (
            output.read_text(errors="replace").splitlines()[-20:]
            if rc and output.exists()
            else []
        )
        (attempt / "process.json").write_text(json.dumps(receipt, indent=2) + "\n")
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
        print(
            json.dumps(
                {
                    "attempt": str(attempt.relative_to(ROOT)),
                    "exit": rc,
                    "error": reason,
                    "remainingGroup": receipt["remainingGroup"],
                }
            ),
            flush=True,
        )
    return rc


if __name__ == "__main__":
    sys.exit(main())
