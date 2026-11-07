"""One CPU Blender process in this task lane; exclusive receipts and bounded descendants."""
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

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/lark-round3-current'


def digest(path):
    p = ROOT / path
    return {'path': path, 'bytes': p.stat().st_size, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} if p.exists() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('label')
    ap.add_argument('--seconds', type=int, default=1800)
    ap.add_argument('--rss-mib', type=int, default=16000)
    ap.add_argument('args', nargs=argparse.REMAINDER)
    a = ap.parse_args()
    args = a.args[1:] if a.args[:1] == ['--'] else a.args
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    lock = (EVIDENCE / '.lane.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    prefix = EVIDENCE / (stamp + '-' + a.label)
    log = prefix.with_suffix('.log').open('xb')
    scratch = Path(tempfile.mkdtemp(prefix='lr3-',dir='/tmp'))
    scratch.chmod(0o700)
    node = Path('/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node')
    assert subprocess.check_output([str(node),'--version'],text=True).strip()=='v22.23.3'
    env = dict(os.environ, OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2', VECLIB_MAXIMUM_THREADS='2', NUMEXPR_NUM_THREADS='2', BLIS_NUM_THREADS='2', ART_KTX_JOBS='1', PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(scratch), KTX='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx', LARK_NODE=str(node), LARK_ATTEMPT_ID=prefix.name, PATH=str(node.parent)+os.pathsep+os.environ['PATH'])
    cmd = ['/Applications/Blender.app/Contents/MacOS/Blender', '-b', '-t', '2', '--factory-startup', '--python-exit-code', '1'] + args
    assets = ['assets/blend/hulls/lark.blend', 'packages/client/public/models/hulls/lark.glb']
    before = [digest(p) for p in assets]
    code_inputs = [digest(p) for p in args if p.endswith('.py') and (ROOT/p).is_file()]
    head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    start = time.monotonic()
    proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    watchdog_path = prefix.with_suffix('.watchdog.json')
    watchdog = subprocess.Popen([sys.executable,str(Path(__file__).with_name('watchdog.py')),str(os.getpid()),str(proc.pid),str(a.seconds+10),str(watchdog_path)],env=env,start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
    peak = 0
    peak_codecs = 0
    observed = {}
    reason = None
    def signal_group(sig):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS may report EPERM for an already-dead process group. Do not
            # lose the receipt after a successful interrupt and reap.
            if proc.poll() is None:
                proc.send_signal(sig)
    def stop(signum=None, frame=None):
        nonlocal reason
        reason = reason or f'interrupted:{signum}'
        signal_group(signal.SIGTERM)
    old = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        while proc.poll() is None:
            rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,rss=,command='], text=True)
            tree = [(int(v[0]),int(v[1]),int(v[2]),int(v[3]),v[4]) for r in rows.splitlines() if len(v:=r.strip().split(None,4))==5]
            ids = {proc.pid}
            while True:
                more = {p for p, pp, pg, rss, command in tree if pp in ids or pg==proc.pid}
                if more <= ids:
                    break
                ids |= more
            tree_rss = sum(row_rss for p, pp, pg, row_rss, command in tree if p in ids)
            for p,pp,pg,row_rss,command in tree:
                if p in ids and not command.startswith('('):observed[p]={'pid':p,'ppid':pp,'pgid':pg,'command':command}
            peak = max(peak, tree_rss)
            codecs=[p for p,pp,pg,row_rss,command in tree if p in ids and '/ktx ' in command]
            peak_codecs=max(peak_codecs,len(codecs))
            image_sizes = []
            for path in list(EVIDENCE.rglob('*'))+list(scratch.rglob('*')):
                if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.exr'):
                    continue
                try:
                    image_sizes.append(path.stat().st_size)
                except FileNotFoundError:
                    pass
            if time.monotonic() - start > a.seconds:
                reason = 'wall limit'
            if tree_rss > a.rss_mib * 1024:
                reason = 'RSS limit'
            if len(codecs)>1:
                reason = 'codec concurrency limit'
            if log.tell() > 16 * 1024**2:
                reason = 'log limit'
            if len(image_sizes) > 48 or sum(image_sizes) > 512 * 1024**2:
                reason = 'image budget'
            if reason:
                stop()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    signal_group(signal.SIGKILL)
                break
            time.sleep(1)
        code = proc.wait()
    finally:
        signal_group(signal.SIGKILL)
        proc.wait()
        watchdog.wait(timeout=15)
        log.close()
        for s, handler in old.items():
            signal.signal(s, handler)
        receipt = {'command': cmd, 'cwd': str(ROOT), 'head_at_start':head, 'code_inputs':code_inputs, 'lane': 'lark-t2', 'thread_environment': {k: env[k] for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','BLIS_NUM_THREADS','ART_KTX_JOBS']}, 'wall_limit_seconds': a.seconds, 'rss_limit_mib': a.rss_mib, 'elapsed_seconds': round(time.monotonic()-start, 3), 'peak_tree_rss_kib': peak, 'exit_code': proc.returncode, 'termination_reason': reason, 'before': before, 'after': [digest(p) for p in assets], 'log': str(prefix.with_suffix('.log').relative_to(ROOT)), 'private_tmpdir':str(scratch),'tmpdir_mode':oct(scratch.stat().st_mode&0o777),'node':str(node),'node_version':'22.23.3','observed_processes':list(observed.values()),'watchdog_receipt':str(watchdog_path.relative_to(ROOT)),'cleanup':json.loads(watchdog_path.read_text()),'private_tmpdir_preserved':True}
        receipt['peak_codec_processes']=peak_codecs
        receipt['rss_scope']='Blender process group and its descendants; fixed aggregate calculation'
        prefix.with_suffix('.json').write_text(json.dumps(receipt, indent=2)+'\n')
        print(json.dumps(receipt, indent=2))
    return code if not reason else 124


if __name__ == '__main__':
    raise SystemExit(main())
