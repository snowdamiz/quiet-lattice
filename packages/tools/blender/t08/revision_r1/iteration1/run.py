"""Serial CPU supervision with bounded cleanup and truthful terminal receipts.

The publisher calls execute in its own process: no second supervisor can disappear
between producer cleanup and canonical promotion. A surviving cohort blocks the
lane; publishers give it only attempt-private output paths.
"""

import argparse
from contextlib import contextmanager
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


def error_fact(operation, error):
    return {"operation": operation, "type": type(error).__name__,
            "errno": getattr(error, "errno", None), "message": str(error)}


def save_json(path, value):
    """One exclusive receipt, atomically made visible. Failed pending bytes remain."""
    pending = path.with_name(path.name + ".pending")
    if os.path.lexists(path):
        raise FileExistsError(path)
    with pending.open("x") as f:
        json.dump(value, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(pending, path)


class Stop:
    def __init__(self):
        self.signum = None
        self.previous = {}

    def __enter__(self):
        for sig in [signal.SIGTERM, signal.SIGINT]:
            self.previous[sig] = signal.signal(sig, self.handle)
        return self

    def handle(self, signum, frame):
        # Never raise out of cleanup, receipt writes or the Popen ownership handoff.
        if self.signum is None:
            self.signum = signum

    def check(self):
        if self.signum is not None:
            raise InterruptedError(f"received signal {self.signum}")

    def __exit__(self, *args):
        for sig, previous in self.previous.items():
            signal.signal(sig, previous)


@contextmanager
def lane():
    with open("/tmp/space-t08-cpu.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        blocked = HERE / "evidence/.lane-blocked.json"
        if blocked.exists():
            raise RuntimeError(f"unresolved producer cohort; inspect {blocked}")
        yield


def admission():
    disk = os.statvfs(ROOT)
    pressure = subprocess.check_output(["memory_pressure"], text=True, timeout=5)
    pct = int(pressure.split("System-wide memory free percentage: ")[1].split("%")[0])
    facts = {"freeBytes": disk.f_bavail * disk.f_frsize, "memoryFreePercent": pct,
             "load": os.getloadavg(), "cpus": os.cpu_count(),
             "observed": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if facts["freeBytes"] < 25 * 1024**3 or pct < 20 or facts["load"][0] > 24:
        raise RuntimeError(f"CPU admission refused: {facts}")
    return facts


def members(group):
    rows = subprocess.check_output(
        ["ps", "-axo", "pid=,pgid=,rss=,stat=,command="], text=True, timeout=2
    )
    result = []
    for row in rows.splitlines():
        cols = row.split(None, 4)
        if len(cols) == 5 and int(cols[1]) == group:
            result.append({"pid": int(cols[0]), "rssKiB": int(cols[2]),
                           "state": cols[3], "command": cols[4]})
    return result


def observe(proc, result):
    try:
        return members(proc.pid)
    except Exception as error:
        result["errors"].append(error_fact("observe process group", error))
        return None


def drain(proc, result):
    """A denied signal or failed observation cannot skip later attempts or the receipt."""
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        current = observe(proc, result)
        if current == [] and proc.poll() is not None:
            break
        try:
            os.killpg(proc.pid, sig)
            result["cleanupSignals"].append({"signal": sig, "sent": True})
        except ProcessLookupError as error:
            result["cleanupSignals"].append({"signal": sig, "alreadyAbsent": True,
                                              "error": error_fact("killpg", error)})
        except Exception as error:
            result["errors"].append(error_fact(f"killpg {sig}", error))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            proc.poll()  # waitpid on the actual direct child, not a PID-liveness guess
            if observe(proc, result) == [] and proc.returncode is not None:
                break
            time.sleep(0.05)
    try:
        result["childExit"] = proc.wait(timeout=1)
        result["childReaped"] = True
    except Exception as error:
        result["errors"].append(error_fact("wait direct child", error))
    result["remainingGroup"] = observe(proc, result)
    result["terminal"] = result["childReaped"] and result["remainingGroup"] == []


def execute(command, out, stop, wall=1800, rss_gib=8, scratch=None):
    """Caller holds lane and Stop until it has finished any publication transaction."""
    out.mkdir(parents=True, exist_ok=False)
    result = {"command": list(command), "cwd": str(ROOT), "exit": 1, "childExit": None,
              "childReaped": False, "terminal": False, "remainingGroup": None,
              "errors": [], "cleanupSignals": [], "pass": False,
              "peakSampledGroupRSSKiB": 0,
              "limits": {"wallSeconds": wall, "rssGiB": rss_gib, "threads": 2, "codecs": 1}}
    start = time.monotonic()
    proc = None
    log = out / "command.log"
    try:
        result["admission"] = admission()
        assert subprocess.check_output([NODE, "--version"], text=True, timeout=5).strip() == "v22.23.3"
        if scratch is None:
            scratch = Path(tempfile.mkdtemp(prefix="t08-", dir="/tmp"))
        else:
            scratch.mkdir(parents=True, exist_ok=False)
        result["tmpdir"] = str(scratch)
        env = dict(os.environ, TMPDIR=str(scratch), ART_KTX_JOBS="1", OMP_NUM_THREADS="2",
                   OPENBLAS_NUM_THREADS="2", MKL_NUM_THREADS="2", VECLIB_MAXIMUM_THREADS="2",
                   NUMEXPR_NUM_THREADS="2", PYTHONUNBUFFERED="1", PYTHONDONTWRITEBYTECODE="1",
                   ART_NODE=str(NODE), PATH=str(NODE.parent) + ":" + os.environ["PATH"],
                   npm_config_offline="true", npm_config_ignore_scripts="true",
                   npm_config_manage_package_manager_versions="false", KTX=str(HERE / "ktx_cpu.py"))
        command = list(command)
        if command[0] == "blender":
            command = [BLENDER, "-b", "--factory-startup", "-t", "2", "--python-exit-code", "1", *command[1:]]
        elif command[0] == "node":
            command[0] = str(NODE)
        result["command"] = command
        save_json(out / "launch.json", result)
        stop.check()
        with log.open("x") as stream:
            proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            result["pid"] = result["pgid"] = proc.pid
            save_json(out / "child.json", {"pid": proc.pid, "pgid": proc.pid})
            while proc.poll() is None:
                stop.check()
                cohort = observe(proc, result)
                if cohort is None:
                    raise RuntimeError("process-group observation is uncertain")
                rss = sum(p["rssKiB"] for p in cohort)
                result["peakSampledGroupRSSKiB"] = max(result["peakSampledGroupRSSKiB"], rss)
                if time.monotonic() - start > wall or rss > rss_gib * 1024**2:
                    result["limitFailure"] = {"elapsedSeconds": time.monotonic() - start, "members": cohort}
                    result["exit"] = 124
                    raise TimeoutError("owned wall/RSS limit")
                time.sleep(0.1)
            result["childExit"] = proc.returncode
            result["childReaped"] = True
            result["exit"] = proc.returncode if proc.returncode >= 0 else 128 - proc.returncode
            result["unexpectedSurvivors"] = observe(proc, result)
    except Exception as error:
        result["errors"].append(error_fact("execute", error))
    finally:
        if proc is not None:
            try:
                drain(proc, result)
            except Exception as error:
                result["terminal"] = False
                result["errors"].append(error_fact("drain", error))
            if not result["terminal"]:
                try:
                    blocked = HERE / "evidence/.lane-blocked.json"
                    blocked.parent.mkdir(parents=True, exist_ok=True)
                    save_json(blocked, {"producerReceipt": str(out / "result.json"), "pid": proc.pid,
                                        "remainingGroup": result["remainingGroup"], "errors": result["errors"]})
                except Exception as error:
                    result["errors"].append(error_fact("persist unresolved cohort", error))
        result["signal"] = stop.signum
        if stop.signum is not None:
            result["exit"] = 128 + stop.signum
        result["pass"] = (proc is not None and result["exit"] == 0 and result["terminal"]
                          and not result["errors"] and result.get("unexpectedSurvivors") == [])
        if not result["pass"] and result["exit"] == 0:
            result["exit"] = 1
        result["elapsedSeconds"] = time.monotonic() - start
        try:
            result["logSHA256"] = hashlib.sha256(log.read_bytes()).hexdigest()
        except Exception as error:
            result["errors"].append(error_fact("hash command log", error))
            result["pass"] = False
            result["exit"] = result["exit"] or 1
        try:
            save_json(out / "result.json", result)
        except Exception as error:
            result["errors"].append(error_fact("write result receipt", error))
            result["pass"] = False
            result["exit"] = result["exit"] or 1
            try:
                with (out / "result-failure.json").open("x") as f:
                    json.dump(result, f, indent=2)
            except Exception as fallback:
                result["errors"].append(error_fact("write fallback receipt", fallback))
                print(json.dumps(result), file=sys.stderr, flush=True)
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--label", required=True)
    p.add_argument("--wall", type=float, default=1800)
    p.add_argument("--rss-gib", type=float, default=8)
    p.add_argument("command", nargs=argparse.REMAINDER)
    args = p.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    assert command and "/" not in args.label and args.wall > 0 and args.rss_gib > 0
    with Stop() as stop:
        try:
            with lane():
                name = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + args.label
                out = HERE / "evidence" / name
                result = execute(command, out, stop, args.wall, args.rss_gib)
                print(json.dumps(result, indent=2), flush=True)
                return result["exit"]
        except Exception as error:
            print(json.dumps(error_fact("acquire lane", error)), file=sys.stderr)
            return 128 + stop.signum if stop.signum else 75


if __name__ == "__main__":
    sys.exit(main())
