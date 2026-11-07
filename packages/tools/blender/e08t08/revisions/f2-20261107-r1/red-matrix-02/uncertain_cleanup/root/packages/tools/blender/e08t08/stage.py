"""One bounded CPU lane; preserve output and prove terminal/reap state."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REPORTS = HERE / 'reports'
GIB = 1024 ** 3

def free():
    s = os.statvfs(ROOT)
    return s.f_bavail * s.f_frsize

def payload():
    paths = [HERE, ROOT / 'assets/blend/creatures', ROOT / 'assets/blend/constructs',
             ROOT / 'packages/client/public/models/creatures', ROOT / 'packages/client/public/models/constructs',
             ROOT / 'assets/renders/creatures/e08t08', ROOT / 'assets/renders/constructs/e08t08']
    return sum(p.stat().st_size for path in paths for p in path.rglob('*') if p.is_file() and not p.is_symlink())

def sources():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for family in ('creatures', 'constructs') for p in (ROOT / 'assets/blend' / family).glob('*.blend')}

def exports():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for family in ('creatures', 'constructs') for p in (ROOT / 'packages/client/public/models' / family).glob('*.glb')}

def group(pgid, known=None):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,rss=,comm='], text=True)
    all_rows = []
    for line in rows.splitlines():
        a = line.split(None, 4)
        if len(a) == 5:
            all_rows.append(dict(pid=int(a[0]), ppid=int(a[1]), pgid=int(a[2]), rss=int(a[3]) * 1024, command=a[4]))
    ids={pgid}
    # pnpm starts its script in another process group. Follow parentage as well
    # as the initial group, and retain observed children if they are reparented.
    for p in all_rows:
        if p['pgid']==pgid or (known or {}).get(p['pid'])==p['command']: ids.add(p['pid'])
    while True:
        added={p['pid'] for p in all_rows if p['ppid'] in ids}-ids
        if not added: break
        ids.update(added)
    return [p for p in all_rows if p['pid'] in ids]

name, *cmd = sys.argv[1:]
assert cmd and '/' not in name
REPORTS.mkdir(exist_ok=True)
with (REPORTS / 'lane.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    record = dict(stage=name, cwd=str(ROOT), command=cmd, beforeFree=free(), beforePayload=payload(),
                  beforeSources=sources(), beforeExports=exports(), start=time.time(), samples=[], limitSeconds=2700)
    assert record['beforeFree'] >= 12 * GIB, record['beforeFree']
    assert record['beforePayload'] < 6 * GIB
    env = dict(os.environ, BLENDER=str(HERE / 'bin/blender'), KTX=str(HERE / 'bin/ktx'),
               ART_KTX_JOBS='1', ART_RAW='1', PYTHONUNBUFFERED='1', PYTHONDONTWRITEBYTECODE='1',
               OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2',
               VECLIB_MAXIMUM_THREADS='2', NUMEXPR_NUM_THREADS='2', BLIS_NUM_THREADS='2')
    with (REPORTS / f'{name}.log').open('x') as log:
        child = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        record['pid'] = child.pid
        known={}
        reason = None
        while child.poll() is None:
            owned = group(child.pid,known)
            known.update({p['pid']:p['command'] for p in owned})
            sample = dict(time=time.time(), rss=sum(p['rss'] for p in owned), free=free(), processes=owned)
            record['samples'].append(sample)
            if sample['rss'] > 8 * GIB: reason = 'aggregate RSS exceeded 8 GiB'
            if sample['free'] < 12 * GIB: reason = 'free capacity fell below 12 GiB'
            if sample['time'] - record['start'] > 2700: reason = '45 minute wall bound'
            if len(record['samples']) % 10 == 0 and payload() > 6 * GIB: reason = '6 GiB payload bound'
            if reason:
                os.killpg(child.pid, signal.SIGTERM)
                for p in owned:
                    try: os.kill(p['pid'],signal.SIGTERM)
                    except ProcessLookupError: pass
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    for p in group(child.pid,known):
                        try: os.kill(p['pid'],signal.SIGKILL)
                        except ProcessLookupError: pass
                break
            time.sleep(.5)
        record['exit'] = child.wait()
    record.update(end=time.time(), afterFree=free(), afterPayload=payload(), afterSources=sources(), afterExports=exports(),
                  remainingProcesses=group(child.pid,known), stopReason=reason, sampling='process group and descendant closure')
    record['maxRSS'] = max((s['rss'] for s in record['samples']), default=0)
    (REPORTS / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({k:v for k,v in record.items() if k not in ('samples', 'beforeSources', 'afterSources', 'beforeExports', 'afterExports')}))
    print('\n'.join((REPORTS / f'{name}.log').read_text(errors='replace').splitlines()[-20 if record['exit'] else -3:]))
    sys.exit(record['exit'] or (1 if reason or record['remainingProcesses'] else 0))
