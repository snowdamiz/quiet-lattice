"""Bounded Kestrel CPU lane. Each invocation owns one process group and its lock."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / "assets/renders/hulls/kestrel-round3-current"
SOURCE = ROOT / "assets/blend/hulls/kestrel.blend"
EXPORT = ROOT / "packages/client/public/models/hulls/kestrel.glb"
LOCK = Path("/tmp/astra-kestrel-round3-cpu.lock")


def digest(path):
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def alive_group(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # macOS can report EPERM while killed orphan descendants are being reaped.
        # Only ESRCH proves absence; keep the bounded polling/lock in force.
        return True


def reap_group(proc):
    if alive_group(proc.pid):
        try: os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError): pass
    end = time.monotonic() + 4
    while alive_group(proc.pid) and time.monotonic() < end:
        proc.poll()
        time.sleep(.05)
    if alive_group(proc.pid):
        try: os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError): pass
    proc.wait(timeout=8)
    end = time.monotonic() + 8
    while alive_group(proc.pid) and time.monotonic() < end:
        time.sleep(.05)
    if alive_group(proc.pid):
        raise RuntimeError(f"owned process group {proc.pid} still exists after SIGKILL")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--label", required=True)
    p.add_argument("--timeout", type=float, default=1800)
    p.add_argument("--export", action="store_true")
    p.add_argument("command", nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not command or not 0 < a.timeout <= 7200:
        p.error("command and a deadline in (0,7200] required")
    if not a.label.replace("-", "").replace("_", "").isalnum():
        p.error("label must be a simple filename")
    if "blender" in Path(command[0]).name.lower() and not any(command[i:i+2] == ["-t", "2"] for i in range(len(command))):
        p.error("Blender requires -t 2")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Kestrel lane occupied", file=sys.stderr)
            return 75
        lock.seek(0);pending=lock.read()
        if pending:
            quarantined=json.loads(pending)
            if alive_group(quarantined['pgid']):
                print('Kestrel lane held by an unreaped prior owned group',file=sys.stderr)
                return 75
            lock.seek(0);lock.truncate();lock.flush()
        env = dict(os.environ)
        env.update({k: "2" for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "BLIS_NUM_THREADS", "TBB_NUM_THREADS")})
        env.update(ART_KTX_JOBS="1", PYTHONDONTWRITEBYTECODE="1", KTX=str(Path(__file__).with_name("ktx_cpu.py")))
        started = time.time()
        record = {"command": command, "cwd": str(ROOT), "timeoutSeconds": a.timeout, "startedUnix": started, "sourceBefore": digest(SOURCE), "environment": {k:env[k] for k in ("OMP_NUM_THREADS", "ART_KTX_JOBS", "KTX")}}
        stopped = []
        previous = {}
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous[sig] = signal.signal(sig, lambda signum, _frame: stopped.append(signum))
        proc = None
        rc = 1
        try:
            with (EVIDENCE / (a.label + ".log")).open("wb") as log:
                proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                record["pgid"] = proc.pid
                deadline = time.monotonic() + a.timeout
                while proc.poll() is None and not stopped and time.monotonic() < deadline:
                    time.sleep(.1)
                timed_out = proc.poll() is None and not stopped
                if stopped or timed_out:
                    rc = 128 + stopped[0] if stopped else 124
                else:
                    rc = proc.returncode
                record["timedOut"] = timed_out
                record["signal"] = stopped[0] if stopped else None
                reap_group(proc)
                record["ownedGroupReapedBeforeUnlock"] = not alive_group(proc.pid)
            if a.export and digest(SOURCE) != record["sourceBefore"]:
                rc = 1
                record["error"] = "saved source changed during export"
        except Exception as exc:
            rc=1;record['error']=repr(exc)
        finally:
            try:
                if proc is not None and alive_group(proc.pid):reap_group(proc)
                record['ownedGroupReapedBeforeUnlock']=True
            except Exception as exc:
                rc=1;record['cleanupError']=repr(exc);record['ownedGroupReapedBeforeUnlock']=False
                # Keep the logical lane closed if the OS has not proved group absence.
                lock.seek(0);lock.truncate();json.dump({'pgid':proc.pid,'root':str(ROOT),'reason':repr(exc)},lock);lock.flush()
            record.update(exitCode=rc, seconds=round(time.time()-started, 3), sourceAfter=digest(SOURCE))
            if a.export and rc:
                EXPORT.unlink(missing_ok=True)
                (EVIDENCE / "qualification.json").unlink(missing_ok=True)
                record["staleOwnExportRemoved"] = not EXPORT.exists()
            record["exportAfter"] = digest(EXPORT)
            (EVIDENCE / (a.label + ".run.json")).write_text(json.dumps(record, indent=2)+"\n")
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        print(json.dumps(record, indent=2))
        return rc


if __name__ == "__main__":
    sys.exit(main())
