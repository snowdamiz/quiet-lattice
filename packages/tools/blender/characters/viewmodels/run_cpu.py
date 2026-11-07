"""Run one owned Blender process group, retaining the lane until bounded cleanup.

python3 run_cpu.py LOG SECONDS /Applications/Blender.app/Contents/MacOS/Blender ...
"""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

TERM_GRACE = 2
KILL_GRACE = 2


def group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def wait_group(process, seconds):
    deadline = time.monotonic() + seconds
    while True:
        process.poll()  # Reap our direct child even while its descendants are exiting.
        if not group_alive(process.pid):
            process.wait(timeout=0)
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(.02)


def stop_group(process):
    for sig, grace in ((signal.SIGTERM, TERM_GRACE), (signal.SIGKILL, KILL_GRACE)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        if wait_group(process, grace):
            return
    raise RuntimeError(f'Owned group {process.pid} did not finish cleanup; lane remains marked unclean')


def main():
    log, seconds, *command = sys.argv[1:]
    seconds = int(seconds)
    assert 1 <= seconds <= 1800
    assert Path(command[0]).name in ('Blender', 'blender')
    assert '-t' in command and command[command.index('-t') + 1] == '2'
    interrupted = 0

    def interrupt(signum, frame):
        nonlocal interrupted
        interrupted = interrupted or signum

    handlers = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGINT, signal.SIGTERM)}
    lock_path = Path(__file__).resolve().parents[5] / '.claude/pause/P1-E05-T03/blender.lock'
    unclean = lock_path.with_suffix('.unclean')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if unclean.exists():
                raise RuntimeError(f'Prior process-group cleanup is unconfirmed; inspect {unclean}')
            if interrupted:
                return 128 + interrupted
            Path(log).parent.mkdir(parents=True, exist_ok=True)
            env = {**os.environ, 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2',
                   'VECLIB_MAXIMUM_THREADS': '2', 'ART_KTX_JOBS': '1'}
            process = None
            # Also fail closed if this wrapper is killed before its cleanup can run.
            unclean.write_text(json.dumps({'runner_pid': os.getpid(), 'phase': 'starting'}) + '\n')
            try:
                with open(log, 'w') as output:
                    process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                                               env=env, start_new_session=True, pass_fds=(lock.fileno(),))
                    unclean.write_text(json.dumps({'runner_pid': os.getpid(), 'pgid': process.pid}) + '\n')
                    print(f'owned pid={process.pid} deadline={seconds}s log={log}', flush=True)
                    deadline = time.monotonic() + seconds
                    while True:
                        if interrupted:
                            code = 128 + interrupted
                            break
                        code = process.poll()
                        if code is not None:
                            break
                        if time.monotonic() >= deadline:
                            code = 124
                            break
                        time.sleep(.02)
            finally:
                # Handlers only record signals, including repeated signals during cleanup.
                # A failed cleanup keeps the marker; a later runner never kills that old PID.
                if process is not None:
                    stop_group(process)
                unclean.unlink()
            print(f'exit={code}', flush=True)
            return code
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
