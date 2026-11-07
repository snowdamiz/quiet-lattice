"""Finite serial CPU lane. Cancellation completes group cleanup before releasing ownership."""

import argparse
import fcntl
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LOCK = Path("/tmp/astra-flora-t05-blender.lock")
THREAD_KEYS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "BLIS_NUM_THREADS",
    "TBB_NUM_THREADS",
    "UV_THREADPOOL_SIZE",
)


def cpu_env():
    env = os.environ.copy()
    env.update(dict.fromkeys(THREAD_KEYS, "2"))
    env.update(ART_KTX_JOBS="1", PYTHONDONTWRITEBYTECODE="1", CUDA_VISIBLE_DEVICES="")
    env.setdefault("KTX", str(ROOT / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"))
    return env


def group_alive(pgid):
    # killpg(0) includes dead descendants awaiting adoption/reaping. Inspect only
    # this owned group, excluding zombies; ps itself has a finite deadline.
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass  # Darwin can report EPERM for a group containing only zombies.
    result = subprocess.run(
        ["ps", "-axo", "pgid=,stat="],
        capture_output=True,
        text=True,
        timeout=2,
        check=True,
    )
    return any(
        len(row) == 2 and row[0] == str(pgid) and not row[1].startswith("Z")
        for row in (line.split() for line in result.stdout.splitlines())
    )


def signal_group(child, sig):
    try:
        os.killpg(child.pid, sig)
    except ProcessLookupError:
        pass
    except PermissionError:
        if group_alive(child.pid):
            raise


def cleanup(child):
    signal_group(child, signal.SIGTERM)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        child.poll()
        if child.returncode is not None and not group_alive(child.pid):
            break
        time.sleep(0.05)
    signal_group(child, signal.SIGKILL)
    child.wait(
        timeout=3
    )  # Reap our direct child even if it exited before its descendants.
    deadline = time.monotonic() + 3
    while group_alive(child.pid):
        if time.monotonic() >= deadline:
            raise RuntimeError(f"owned group {child.pid} did not terminate")
        time.sleep(0.05)


def run(cmd, *, log, timeout, root=ROOT, lock_path=LOCK, env=None):
    """Run one workload; log paths are single-use, including completed attempts."""
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    log, lock_path = Path(log), Path(lock_path)
    blocked = lock_path.with_suffix(".blocked")
    # Open without truncation. Nothing may touch the log until ownership is held.
    with open(str(lock_path), "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("CPU lane already owned", file=sys.stderr)
            return 73
        if blocked.exists():
            raise RuntimeError(f"CPU lane requires cleanup inspection: {blocked}")
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("x") as output:
            cancelled = []

            def cancel(signum, _frame):
                # Never raise from a signal handler: repeated signals must not
                # interrupt termination, reaping, or the terminal receipt.
                if not cancelled:
                    cancelled.append(signum)

            handlers = {
                sig: signal.signal(sig, cancel)
                for sig in (signal.SIGINT, signal.SIGTERM)
            }
            child = None
            code = 1
            try:
                output.write("COMMAND " + repr(cmd) + "\n")
                output.flush()
                child = subprocess.Popen(
                    cmd,
                    cwd=root,
                    env=env or cpu_env(),
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    pass_fds=(lock.fileno(),),
                )
                deadline = time.monotonic() + timeout
                while True:
                    if cancelled:
                        code = 128 + cancelled[0]
                        break
                    if time.monotonic() >= deadline:
                        code = 124
                        break
                    try:
                        code = child.wait(
                            timeout=min(0.1, max(0.001, deadline - time.monotonic()))
                        )
                        break
                    except subprocess.TimeoutExpired:
                        pass
            finally:
                try:
                    if child is not None:
                        cleanup(child)
                except BaseException as error:
                    # Fail closed if OS cleanup cannot be proven. Subsequent
                    # runners refuse the lane even after this process exits.
                    with blocked.open("x") as guard:
                        guard.write(f"pid={getattr(child, 'pid', None)}: {error!r}\n")
                    code = 125
                    raise
                finally:
                    output.write(f"\nEXIT {code}\n")
                    output.flush()
                    os.fsync(output.fileno())
                    for sig, handler in handlers.items():
                        signal.signal(sig, handler)
    print(f"{log}: exit {code}")
    print("\n".join(log.read_text().splitlines()[-18:]))
    return code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=float, default=1200)
    parser.add_argument("--log", required=True)
    parser.add_argument("script")
    parser.add_argument("args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    cmd = [
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "-b",
        "-t",
        "2",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "-P",
        args.script,
        "--",
        *args.args,
    ]
    return run(cmd, log=ROOT / args.log, timeout=args.timeout)


if __name__ == "__main__":
    sys.exit(main())
