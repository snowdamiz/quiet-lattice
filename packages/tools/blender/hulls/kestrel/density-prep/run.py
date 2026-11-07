"""Read-only, bounded density preparation lane; never starts Blender or image codecs."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("retained_kestrel_lane", HERE.parent / "lane.py")
lane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lane)  # Import bounded cleanup helpers only; never run its main/export cleanup.


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def group_resources(pgid):
    raw = subprocess.check_output(["ps", "-axo", "pid=,pgid=,rss="], text=True, timeout=2)
    members = [(int(pid), int(rss) * 1024) for pid, group, rss in (line.split() for line in raw.splitlines()) if int(group) == pgid]
    return sum(rss for _, rss in members), [pid for pid, _ in members]


def output_bytes(folder):
    return sum(p.stat().st_size for p in folder.rglob("*") if p.is_file())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode", choices=("fixtures", "syntax", "measure", "probe-timeout", "probe-output", "probe-signal"))
    p.add_argument("--label", required=True)
    p.add_argument("--pins", type=Path, default=HERE / "pins.json")
    p.add_argument("--parent-released-export-decode", action="store_true")
    a = p.parse_args()
    if not a.label.replace("-", "").replace("_", "").isalnum():
        p.error("simple unique label required")
    if a.mode == "measure" and not a.parent_released_export_decode:
        p.error("HOLD: parent must release actual compressed-export decoding first")
    measure = a.mode == "measure"
    wall, rss_limit, output_limit = (90, 768 * 1024**2, 32 * 1024**2) if measure else (10, 256 * 1024**2, 1024**2)
    if a.mode == "probe-timeout":
        wall = .25
    if a.mode == "probe-output":
        output_limit = 1024
    folder = HERE / "runs" / a.label
    folder.mkdir(parents=True, exist_ok=False)  # Never replace a prior attempt, even a failure.
    assert a.pins.stat().st_size <= 16384, "pin file too large"
    pins = json.loads(a.pins.read_text())
    canonical = ("assets/blend/hulls/kestrel.blend", "packages/client/public/models/hulls/kestrel.glb")
    candidate = (str(HERE.relative_to(ROOT) / "candidate/source/hulls/kestrel.blend"), str(HERE.relative_to(ROOT) / "candidate/models/hulls/kestrel.glb"))
    assert (pins["source"]["path"], pins["export"]["path"]) in (canonical, candidate), "only the canonical pair or the owned candidate pair may be measured"
    paths = {k: ROOT / pins[k]["path"] for k in ("source", "export")}
    for k, cap in (("source", 512 * 1024**2), ("export", 128 * 1024**2)):
        assert paths[k].stat().st_size == pins[k]["bytes"] <= cap, k + " input size mismatch/limit"
    before = {k: sha(v) for k, v in paths.items()}
    canonical_before = {n: sha(ROOT / n) for n in canonical}
    for k, v in before.items():
        assert v == pins[k]["sha256"] and paths[k].stat().st_size == pins[k]["bytes"], k + " pin mismatch"
    node = str(Path(shutil.which("node")).resolve())
    command = [node, "--single-threaded", "--v8-pool-size=1", "--max-old-space-size=" + ("512" if measure else "96")]
    if measure:
        command += [str(HERE / "measure_export.cjs"), "--parent-released-export-decode", str(a.pins.resolve()), str(folder)]
    elif a.mode == "fixtures":
        command += [str(HERE / "fixtures.cjs")]
    elif a.mode == "syntax":
        command += ["--check", str(HERE / "measure_export.cjs")]
    else:
        # Small inert processes exercise the same supervisor's timeout/output/signal paths.
        js = "setInterval(()=>{},1000)"
        if a.mode == "probe-output":
            js = "process.stdout.write('x'.repeat(2048));setInterval(()=>{},1000)"
        if a.mode == "probe-signal":
            js = "const child=require('node:child_process').spawn(process.execPath,['--single-threaded','--v8-pool-size=1','--max-old-space-size=32','-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(JSON.stringify({childPid:child.pid}));setTimeout(()=>process.kill(process.ppid,'SIGTERM'),50);setInterval(()=>{},1000)"
        command += ["-e", js]
    env = dict(os.environ)
    env.pop("NODE_OPTIONS", None)
    env.update({k: "1" for k in ("UV_THREADPOOL_SIZE", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "BLIS_NUM_THREADS", "ART_KTX_JOBS")})
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    record = {"mode": a.mode, "command": command, "cwd": str(ROOT), "pins": pins,
              "sourceDensity": "NOT MEASURED", "limits": {"wallSeconds": wall, "sampledGroupRSSBytes": rss_limit, "childOutputBytes": output_limit},
              "resourceCaveat": "RSS/output sampled every ~50ms; detection ceilings, not hard OS quotas. Output receipt is outside child cap. Cleanup bounded to 20s after child deadline.",
              "environment": {k: v for k, v in env.items() if k.endswith("NUM_THREADS") or k in ("UV_THREADPOOL_SIZE", "ART_KTX_JOBS")},
              "nodeSha256": sha(Path(node)), "toolHashes": {x.name: sha(x) for x in HERE.iterdir() if x.suffix in (".py", ".cjs")},
              "cleanupHelperSha256": sha(HERE.parent / "lane.py"), "before": before, "canonicalBefore": canonical_before}
    stopped, proc, rc, peak, seen_pids = [], None, 1, 0, set()
    started = time.monotonic()
    with (HERE / ".lane.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock.seek(0)
        held = lock.read()
        if held and lane.alive_group(json.loads(held)["pgid"]):
            raise RuntimeError("prior owned process group not reaped; lane quarantined")
        lock.seek(0); lock.truncate(); lock.flush()
        previous = {s: signal.signal(s, lambda sig, frame: stopped.append(sig)) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        try:
            with (folder / "child.log").open("xb") as log:
                proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                record["pgid"] = proc.pid
                deadline = time.monotonic() + wall
                reason = None
                while True:
                    rss, members = group_resources(proc.pid)
                    peak = max(peak, rss)
                    seen_pids.update(members)
                    if stopped:
                        reason, rc = "signal", 128 + stopped[0]
                    elif time.monotonic() >= deadline:
                        reason, rc = "deadline", 124
                    elif peak > rss_limit:
                        reason, rc = "rss", 125
                    elif output_bytes(folder) > output_limit:
                        reason, rc = "output", 125
                    elif proc.poll() is not None:
                        rc = proc.returncode
                        break
                    if reason:
                        break
                    time.sleep(.05)
                record.update(limitReason=reason, signal=stopped[0] if stopped else None)
        except Exception as exc:
            record["error"] = repr(exc)
            rc = 1
        finally:
            try:
                if proc is not None:
                    lane.reap_group(proc)
                record["ownedGroupReapedBeforeUnlock"] = proc is None or not lane.alive_group(proc.pid)
                assert record["ownedGroupReapedBeforeUnlock"]
            except Exception as exc:
                rc = 1
                record.update(cleanupError=repr(exc), ownedGroupReapedBeforeUnlock=False)
                lock.seek(0); lock.truncate(); json.dump({"pgid": proc.pid, "reason": repr(exc)}, lock); lock.flush()
            record["after"] = {k: sha(v) for k, v in paths.items()}
            record["canonicalAfter"] = {n: sha(ROOT / n) for n in canonical}
            if record["after"] != before or record["canonicalAfter"] != canonical_before:
                record["error"] = "canonical bytes changed"
                rc = 1
            record.update(exitCode=rc, seconds=time.monotonic()-started, peakSampledGroupRSSBytes=peak, sampledGroupPIDs=sorted(seen_pids), childOutputBytes=output_bytes(folder))
            (folder / "receipt.json").write_text(json.dumps(record, indent=2) + "\n")
            for sig, handler in previous.items():
                signal.signal(sig, handler)
    print(json.dumps({k: record.get(k) for k in ("mode", "exitCode", "limitReason", "ownedGroupReapedBeforeUnlock", "seconds", "peakSampledGroupRSSBytes")}))
    return rc


if __name__ == "__main__":
    sys.exit(main())
