"""Finite CPU-only subprocess lane; records process-tree RSS and kills only its own group."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def run(command, receipt, seconds):
    receipt = Path(receipt)
    receipt.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    peak = 0
    samples = []
    env = {**os.environ, "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "ART_KTX_JOBS": "1"}
    with receipt.with_suffix(".txt").open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        timed_out = False
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
                    break
                time.sleep(.1)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=8)
        data = {"command": command, "exit": process.returncode, "deadlineSeconds": seconds,
                "timedOut": timed_out, "elapsedSeconds": round(time.time() - started, 2),
                "peakProcessTreeRssKiB": peak, "rssSamples": samples, "backend": "CPU", "blenderThreads": 2}
        receipt.write_text(json.dumps(data, indent=2) + "\n")
        print(json.dumps(data))
        return 124 if timed_out else process.returncode


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--receipt", required=True)
    p.add_argument("--seconds", type=int, required=True)
    p.add_argument("command", nargs=argparse.REMAINDER)
    a = p.parse_args()
    raise SystemExit(run(a.command[1:] if a.command[:1] == ["--"] else a.command, a.receipt, a.seconds))
