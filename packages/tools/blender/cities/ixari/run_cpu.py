"""Task-local, exclusive, bounded CPU lane. Never launches a render backend other than CPU."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[5]
TASK = ROOT / 'assets/blend/cities/ixari'
THREADS = {k: '2' for k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                          'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS', 'BLIS_NUM_THREADS',
                          'TBB_NUM_THREADS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE')}


def processes(group):
    data = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss=,stat='], text=True)
    return [(int(p), int(r), s) for row in data.splitlines() if len(row.split()) == 4
            for p, g, r, s in [row.split()] if int(g) == group and not s.startswith('Z')]


def file_bytes(paths, unique=False):
    total=0
    seen=set()
    for path in paths:
        try:
            if path.is_file():
                stat=path.stat();identity=(stat.st_dev,stat.st_ino)
                if not unique or identity not in seen:total+=stat.st_size
                seen.add(identity)
        except FileNotFoundError:
            pass  # The one reused render scratch still may be removed between enumeration and stat.
    return total


def artifact_hashes():
    paths = list((ROOT / 'assets/blend/cities').glob('ixari_*.blend'))
    paths += list((ROOT / 'packages/client/public/models/cities').glob('ixari_*.glb'))
    paths += list((TASK / 'inventory').glob('*.json'))
    paths += [ROOT / 'packages/tools/blender/cities/ixari/consumer.test.js',
              ROOT / 'packages/tools/blender/cities/ixari/consumer.config.mjs']
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}


def stop(proc):
    actions = []
    for sig, wait in ((signal.SIGINT, 5), (signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        if not processes(proc.pid):
            break
        try:
            os.killpg(proc.pid, sig)
            actions.append(sig.name)
        except ProcessLookupError:
            break
        end = time.monotonic() + wait
        while time.monotonic() < end and processes(proc.pid):
            proc.poll()
            time.sleep(.1)
    proc.wait(timeout=5)
    if processes(proc.pid):
        raise RuntimeError('Owned process group still alive; lane lock cannot be released')
    return actions


def run(args):
    TASK.mkdir(parents=True, exist_ok=True)
    attempt = TASK / 'receipts' / args.attempt
    attempt.mkdir(parents=True, exist_ok=False)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    env = dict(os.environ, **THREADS, ART_KTX_JOBS='1', PYTHONDONTWRITEBYTECODE='1',
               KTX=str(ROOT / 'packages/tools/blender/cities/ixari/ktx_cpu.py'))
    receipt = dict(command=command, cwd=str(ROOT), backend='CPU iteration; not GPU visual PASS',
                   threadEnv=THREADS, wallLimitSeconds=args.seconds, rssLimitMiB=args.rss_mib,
                   logLimitMiB=32, imageLimit=48, imageBudgetMiB=512, outputLimitMiB=4096,
                   startedUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    receipt['head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    receipt['inputScriptSha256'] = {x: hashlib.sha256((ROOT / x).read_bytes()).hexdigest()
                                    for x in command if x.endswith(('.py','.js','.mjs')) and (ROOT/x).is_file()}
    receipt['evaluatedInputsBefore'] = artifact_hashes()
    start = time.monotonic()
    peak = 0
    proc = None
    stopped = []
    reason = None
    revision = TASK / 'revision-r1/baseline.json'
    baseline = json.loads(revision.read_text()) if revision.exists() else None
    receipt['diskFreeBytesAtAdmission'] = shutil.disk_usage(ROOT).free
    receipt['diskReserveBytes'] = 9 * 1024**3
    receipt['reapedScope'] = 'owned process group; deliberately detached descendants are not covered'
    observed = set()
    lock = (TASK / '.cpu-lane.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if receipt['diskFreeBytesAtAdmission'] < receipt['diskReserveBytes']:
            raise RuntimeError('disk admission: retain 8 GiB reserve plus 1 GiB output allowance')
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, lambda s, f: (_ for _ in ()).throw(InterruptedError(str(s))))
        with (attempt / 'output.txt').open('x') as output:
            proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=output,
                                    stderr=subprocess.STDOUT, start_new_session=True)
            while proc.poll() is None:
                group = processes(proc.pid)
                observed.update(p for p, r, s in group)
                peak = max(peak, sum(r for p, r, s in group))
                elapsed = time.monotonic() - start
                renders = list((ROOT / 'assets/renders/cities/ixari').rglob('*.png'))
                output_paths = list(TASK.rglob('*')) + list((ROOT / 'assets/blend/cities').glob('ixari_*.blend'))
                output_paths += list((ROOT / 'packages/client/public/models/cities').glob('ixari_*.glb'))
                image_bytes = file_bytes(renders)
                new_images = [p for p in renders if baseline and str(p.relative_to(ROOT)) not in baseline['files']]
                if elapsed > args.seconds:
                    reason = 'wall limit'
                elif peak > args.rss_mib * 1024:
                    reason = 'process-group RSS limit'
                elif (attempt / 'output.txt').stat().st_size > 32 * 1024**2:
                    reason = 'log limit'
                elif len(renders) > 48 or image_bytes > 512 * 1024**2:
                    reason = 'compact image budget'
                elif baseline and (len(new_images) > 12 or file_bytes(new_images) > 128 * 1024**2):
                    reason = 'revision compact image budget'
                elif shutil.disk_usage(ROOT).free < 8 * 1024**3:
                    reason = 'disk reserve'
                elif file_bytes(output_paths, unique=True) > 4096 * 1024**2:
                    reason = 'owned artifact output limit'
                if reason:
                    break
                time.sleep(.5)
    except BaseException as exc:
        reason = repr(exc)
    finally:
        if proc is not None:
            stopped = stop(proc)
        receipt.update(exitCode=proc.returncode if proc else None, stoppedBy=reason,
                       signals=stopped, reaped=proc is None or not processes(proc.pid),
                       elapsedSeconds=round(time.monotonic()-start, 3), peakGroupRssKiB=peak)
        receipt['observedGroupPids'] = sorted(observed)
        receipt['evaluatedInputsAfter'] = artifact_hashes()
        if (attempt / 'output.txt').exists():
            receipt['last20Lines'] = (attempt / 'output.txt').read_text(errors='replace').splitlines()[-20:]
        (attempt / 'process.json').write_text(json.dumps(receipt, indent=2)+'\n')
        with (TASK / 'attempts.jsonl').open('a') as ledger:
            ledger.write(json.dumps(dict(attempt=args.attempt, **receipt))+'\n')
        lock.close()
    print(json.dumps(receipt))
    return 124 if reason else receipt['exitCode']


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--attempt', required=True)
    p.add_argument('--seconds', type=int, required=True)
    p.add_argument('--rss-mib', type=int, default=8192)
    p.add_argument('command', nargs=argparse.REMAINDER)
    raise SystemExit(run(p.parse_args()))
