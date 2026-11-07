"""Finite CPU-only subprocess lane; records process-tree RSS and kills only its own group."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import tempfile


def run(command, receipt, seconds, rss_limit_kib=6 * 1024 * 1024, output_limit_bytes=16 * 1024 * 1024):
    receipt = Path(receipt)
    receipt.parent.mkdir(parents=True, exist_ok=True)
    if receipt.exists() or receipt.with_suffix(".txt").exists():
        raise FileExistsError("Process receipts are immutable; choose a fresh receipt name")
    lane = hashlib.sha256(str(Path(__file__).resolve()).encode()).hexdigest()[:16]
    lock = (Path(tempfile.gettempdir()) / ("thalune-cpu-" + lane + ".lock")).open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    started = time.time()
    peak = 0
    samples = []
    env = {**os.environ, "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "VECLIB_MAXIMUM_THREADS": "2", "ART_KTX_JOBS": "1"}
    with receipt.with_suffix(".txt").open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        timed_out = False
        limit = None
        try:
            while process.poll() is None:
                rows = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss="], text=True)
                table = [tuple(map(int, row.split())) for row in rows.splitlines() if row.strip()]
                descendants = {process.pid}
                for _ in range(12):
                    more = {pid for pid, parent, rss in table if parent in descendants}
                    if more <= descendants:
                        break
                    descendants |= more
                rss = sum(rss for pid, parent, rss in table if pid in descendants)
                peak = max(peak, rss)
                if not samples or time.time() - started - samples[-1][0] >= 15:
                    samples.append([round(time.time() - started, 2), rss])
                if time.time() - started > seconds:
                    timed_out = True
                    limit = "wall"
                    break
                if rss > rss_limit_kib or receipt.with_suffix(".txt").stat().st_size > output_limit_bytes:
                    limit = "rss" if rss > rss_limit_kib else "output"
                    break
                time.sleep(.1)
        finally:
            # Reap the entire owned process group even if the root exits first.
            def group_alive():
                rows = subprocess.check_output(["ps", "-axo", "pid=,pgid="], text=True)
                return [int(row.split()[0]) for row in rows.splitlines() if int(row.split()[1]) == process.pid]
            def signal_group(sig):
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    pass  # The owned group can finish between inspection and signalling.
            if group_alive():
                signal_group(signal.SIGTERM)
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    signal_group(signal.SIGKILL)
                    process.wait(timeout=8)
            process.wait(timeout=8)
            cleanup_deadline = time.monotonic() + 8
            while group_alive() and time.monotonic() < cleanup_deadline:
                signal_group(signal.SIGKILL)
                time.sleep(.1)
            remaining = group_alive()
        data = {"command": command, "exit": process.returncode, "deadlineSeconds": seconds,
                "timedOut": timed_out, "elapsedSeconds": round(time.time() - started, 2),
                "peakProcessTreeRssKiB": peak, "rssSamples": samples, "backend": "CPU", "blenderThreads": 2,
                "rssLimitKiB": rss_limit_kib, "outputLimitBytes": output_limit_bytes, "limitExceeded": limit,
                "remainingOwnedPids": remaining, "processTreeReapedBeforeUnlock": not remaining}
        data["cwd"] = os.getcwd()
        data["environment"] = {k: env[k] for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "ART_KTX_JOBS", "KTX", "THALUNE_REPORT") if k in env}
        data["runnerSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        receipt.write_text(json.dumps(data, indent=2) + "\n")
        print(json.dumps(data))
        if remaining:
            raise RuntimeError("Owned process group not reaped: " + str(remaining))
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
        return 124 if limit else process.returncode


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--receipt", required=True)
    p.add_argument("--seconds", type=int, required=True)
    p.add_argument("command", nargs=argparse.REMAINDER)
    a = p.parse_args()
    raise SystemExit(run(a.command[1:] if a.command[:1] == ["--"] else a.command, a.receipt, a.seconds))
