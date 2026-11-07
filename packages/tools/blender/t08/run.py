"""Bounded, serial CPU launcher. Logs and receipts are exclusive, never overwritten."""

import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
NODE = Path.home() / ".local/share/fnm/node-versions/v22.23.3/installation/bin/node"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


def admission():
    disk = os.statvfs(ROOT)
    free = disk.f_bavail * disk.f_frsize
    pressure = subprocess.check_output(["memory_pressure"], text=True)
    pct = int(pressure.split("System-wide memory free percentage: ")[1].split("%")[0])
    load = os.getloadavg()
    facts = {
        "freeBytes": free,
        "memoryFreePercent": pct,
        "load": load,
        "cpus": os.cpu_count(),
        "observed": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if free < 25 * 1024**3 or pct < 20 or load[0] > 24:
        raise RuntimeError(f"CPU admission refused: {facts}")
    return facts


def members(group):
    rows = subprocess.check_output(
        ["ps", "-axo", "pid=,pgid=,rss=,command="], text=True
    )
    result = []
    for row in rows.splitlines():
        cols = row.split(None, 3)
        if len(cols) == 4 and int(cols[1]) == group:
            result.append(
                {"pid": int(cols[0]), "rssKiB": int(cols[2]), "command": cols[3]}
            )
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--label", required=True)
    p.add_argument("--wall", type=int, default=1800)
    p.add_argument("--rss-gib", type=float, default=8)
    p.add_argument("command", nargs=argparse.REMAINDER)
    args = p.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    assert command and "/" not in args.label
    lock = open("/tmp/space-t08-cpu.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    facts = admission()
    assert subprocess.check_output([NODE, "--version"], text=True).strip() == "v22.23.3"
    run_id = (
        datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        + "-"
        + args.label
    )
    out = HERE / "evidence" / run_id
    out.mkdir(parents=True, exist_ok=False)
    scratch = tempfile.mkdtemp(prefix="t08-", dir="/tmp")
    env = dict(
        os.environ,
        TMPDIR=scratch,
        ART_KTX_JOBS="1",
        OMP_NUM_THREADS="2",
        OPENBLAS_NUM_THREADS="2",
        MKL_NUM_THREADS="2",
        VECLIB_MAXIMUM_THREADS="2",
        NUMEXPR_NUM_THREADS="2",
        PYTHONUNBUFFERED="1",
        PYTHONDONTWRITEBYTECODE="1",
        ART_NODE=str(NODE),
        PATH=str(NODE.parent) + ":" + os.environ["PATH"],
        npm_config_offline="true",
        npm_config_ignore_scripts="true",
        npm_config_manage_package_manager_versions="false",
        KTX=str(HERE / "ktx_cpu.py"),
    )
    if command[0] == "blender":
        command = [
            BLENDER,
            "-b",
            "--factory-startup",
            "-t",
            "2",
            "--python-exit-code",
            "1",
        ] + command[1:]
    elif command[0] == "node":
        command[0] = str(NODE)
    result = {
        "command": command,
        "cwd": str(ROOT),
        "admission": facts,
        "limits": {
            "wallSeconds": args.wall,
            "rssGiB": args.rss_gib,
            "threads": 2,
            "codecs": 1,
        },
        "tmpdir": scratch,
        "exit": None,
        "peakSampledGroupRSSKiB": 0,
    }
    (out / "launch.json").write_text(json.dumps(result, indent=2) + "\n")
    print(out.relative_to(ROOT), flush=True)
    start = time.monotonic()
    proc = None
    try:
        with (out / "command.log").open("x") as log:
            proc = subprocess.Popen(
                command,
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            result["pid"] = result["pgid"] = proc.pid
            while proc.poll() is None:
                group = members(proc.pid)
                rss = sum(r["rssKiB"] for r in group)
                result["peakSampledGroupRSSKiB"] = max(
                    result["peakSampledGroupRSSKiB"], rss
                )
                if time.monotonic() - start > args.wall or rss > args.rss_gib * 1024**2:
                    result["limitFailure"] = {
                        "elapsed": time.monotonic() - start,
                        "members": group,
                    }
                    break
                time.sleep(1)
    finally:
        if proc is not None:
            remaining = members(proc.pid)
            if remaining:
                result["cleanupBefore"] = remaining
                os.killpg(proc.pid, signal.SIGTERM)
                deadline = time.monotonic() + 10
                while members(proc.pid) and time.monotonic() < deadline:
                    proc.poll()
                    time.sleep(0.2)
                if members(proc.pid):
                    os.killpg(proc.pid, signal.SIGKILL)
            result["exit"] = proc.wait(timeout=10)
            result["remainingGroup"] = members(proc.pid)
        result["elapsedSeconds"] = time.monotonic() - start
        result["logSHA256"] = hashlib.sha256(
            (out / "command.log").read_bytes()
        ).hexdigest()
        result["pass"] = (
            result["exit"] == 0
            and not result.get("limitFailure")
            and not result.get("remainingGroup")
        )
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2), flush=True)
    if not result["pass"]:
        print("\n".join((out / "command.log").read_text().splitlines()[-20:]))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
