"""Bounded real-process controls for the second tooling review; never starts art tools."""
import importlib.util
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
TOOLS = Path(__file__).parent
EVIDENCE = ROOT / 'assets/renders/hulls/swift-round4-current/88-observation-publication'
LABEL = sys.argv[1]
assert LABEL and Path(LABEL).name == LABEL
OUT = EVIDENCE / LABEL


def observation(r, name, mode='exit', deny=None):
    root, _ = r.fixture(name)
    r.prepare(root)
    bindir = root / 'bin'
    bindir.mkdir()
    shim = bindir / 'ps'
    failure = 'exec /bin/sleep 6' if mode == 'timeout' else 'echo "controlled real ps exit 31" >&2; exit 31'
    shim.write_text('#!/bin/sh\nif [ -n "$SWIFT_JOB" ] && [ -f "$SWIFT_JOB/dispatch.json" ]; then ' + failure + '; fi\nexec /bin/ps "$@"\n')
    shim.chmod(0o700)
    env = {**r.ENV, 'PATH': str(bindir) + ':' + r.ENV['PATH']}
    if mode == 'both':
        # Both observers still launch a real command and return its actual error.
        (root / 'hook/sitecustomize.py').write_text('''import os,subprocess
from pathlib import Path
if Path(__import__('sys').argv[0]).name=='supervise.py':
 real=subprocess.Popen
 class FaultObserver(real):
  def __init__(self,args,*a,**k):
   if isinstance(args,list) and args[0] in ['ps','/bin/ps'] and (Path(os.environ['SWIFT_JOB'])/'dispatch.json').exists():args=[os.environ['FAILED_PS'],*args[1:]]
   super().__init__(args,*a,**k)
 subprocess.Popen=FaultObserver
''')
        env.update(PYTHONPATH=str(root / 'hook'), FAILED_PS=str(shim))
    if deny:
        env = r.hookenv(root, DENY_SIGNAL=deny)
    # Separate process owned by this test, never by the tested supervisor.
    sentinel = subprocess.Popen([r.PY, '-B', '-c', 'import time;time.sleep(45)'], start_new_session=True)
    p = None
    try:
        command = r.lane(root, 'probe', [r.PY, '-B', root / 'producer.py', 'ignore' if deny else 'sleep'], wall=1 if mode == 'timeout' or deny else 10)
        p = r.launch(command, root, root / 'command.log', env)
        code = p.wait(timeout=28)
        r.wait(lambda: (root / r.EV / 'probe/guardian.json').exists())
        snap = r.snapshot(root, 'probe')
        g = snap['guardian.json']
        live = r.group(g['commandGroup'])
        assert code != 0 and sentinel.poll() is None
        assert not (root / r.EV / 'probe/publication.json').exists()
        if deny == 'SIGKILL':
            assert live and not g['childGroupEmpty'] and snap['lockRetained'] and g['drainErrors']
        else:
            assert not live and g['ownedChildReaped']
            assert g['childGroupEmpty'] == (mode != 'both')
        if not deny:
            assert g['observationErrors'] and g['primaryRemaining'] is None
            assert g['secondaryRemaining'] == (None if mode == 'both' else [])
            assert g['signalAttempts'] and all(x['ownedChildPinned'] for x in g['signalAttempts'])
        result = {'case': name, 'controllerExit': code, 'guardian': g, 'groupAfterControllerExit': live,
                  'unownedSentinelPid': sentinel.pid, 'sentinelAliveAfterTestedCleanup': True,
                  'result': 'GREEN; failed job retained, drain facts separate from primary observation'}
        r.write(root / 'result.json', result)
        r.record(result)
    finally:
        if p and p.poll() is None:
            p.terminate()
            p.wait(timeout=20)
        r.cleanup(root)
        sentinel.terminate()
        sentinel.wait(timeout=5)


PUBLICATION_HOOK = '''import errno,json,os,sys,time
from pathlib import Path
done=False
def trace(frame,event,arg):
 global done
 if done or event!='line':return trace
 p=Path(frame.f_code.co_filename)
 if p.name!='lane.py':return trace
 v=frame.f_locals;line=p.read_text().splitlines()[frame.f_lineno-1].strip();fault=os.environ['PUBLICATION_FAULT']
 target=Path(v['path']).name if 'path' in v else ''
 hit=frame.f_code.co_name=='durable_json' and target=='receipt.json' and ((fault=='flush' and line=='f.flush()') or (fault=='fsync' and line=='os.fsync(f.fileno())'))
 if frame.f_code.co_name=='sync_directory' and line=='os.fsync(fd)':
  parent=frame.f_back
  if parent and parent.f_code.co_name=='durable_json':
   name=parent.f_locals['path'].name
   hit=hit or (fault=='receipt-directory-sync' and name=='receipt.json') or (fault=='publication-directory-sync' and name=='publication.json')
 hit=hit or (fault=='exit-before-commit' and line=='publication.unlink()')
 hit=hit or (fault=='live-provisional' and line.startswith('print(json.dumps({k: receipt[k]'))
 if hit:
  done=True;Path(os.environ['EVENT']).write_text(json.dumps({'fault':fault,'actualPID':os.getpid(),'function':frame.f_code.co_name,'line':frame.f_lineno,'target':target}))
  if fault=='exit-before-commit':os.kill(os.getpid(),9)
  if fault=='live-provisional':
   deadline=time.monotonic()+15
   while not Path(os.environ['RESUME']).exists() and time.monotonic()<deadline:time.sleep(.02)
   if not Path(os.environ['RESUME']).exists():raise TimeoutError('bounded publication probe')
  else:raise OSError(errno.EIO,'controlled real publication '+fault+' failure')
 return trace
sys.settrace(trace)
'''


def publications(r):
    root, code = r.fixture('publication-boundaries', assets=True)
    (root / 'publish.py').write_text(r.PUBLISH)
    hook = root / 'hook'
    hook.mkdir()
    (hook / 'sitecustomize.py').write_text(PUBLICATION_HOOK)
    labels = {}
    def publish(kind, label, env=None):
        command = r.lane(root, label, [r.PY, '-B', root / 'publish.py', ROOT / r.EV / r.ORIGINS[kind], kind, 'ok'])
        return r.run(command, root, root / (label + '.log'), env)
    def consume(name, audit, accept=False):
        out = root / name
        out.mkdir()
        dest = root / r.DST
        before = {'inode': dest.stat().st_ino, 'sha256': r.sha(dest)}
        command = [r.PY, '-B', code / 'promote.py', labels['stock'], labels['identity'], audit, labels['fit']]
        rc = r.run(command, root, out / 'command.log', {**r.ENV, 'SWIFT_JOB': str(out)})
        after = {'inode': dest.stat().st_ino, 'sha256': r.sha(dest)}
        assert (rc == 0) == accept and (before['inode'] != after['inode']) == accept
        assert before['sha256'] == after['sha256']
        result = {'case': name, 'consumerExit': rc, 'before': before, 'after': after, 'result': 'GREEN'}
        r.write(out / 'result.json', result)
        r.record(result)
    for kind in ['stock', 'identity', 'fit']:
        labels[kind] = kind + '-ok'
        assert publish(kind, labels[kind]) == 0
    for fault in ['flush', 'fsync', 'receipt-directory-sync', 'publication-directory-sync', 'exit-before-commit']:
        label = 'audit-' + fault
        env = {**r.ENV, 'PYTHONPATH': str(hook), 'PUBLICATION_FAULT': fault, 'EVENT': str(root / (fault + '-event.json'))}
        rc = publish('audit', label, env)
        assert rc == (-9 if fault == 'exit-before-commit' else 1)
        stage = root / r.EV / label
        assert (stage / '.publication-open').is_file()
        consume('reject-' + fault, label)
        # An isolated fixture may reclaim its stale admission only after proving
        # actual controller/supervisor/producer exit. Keep the old owner bytes.
        r.cleanup(root)
        lock = code / '.lane-lock'
        if lock.exists():
            lock.rename(root / ('retained-lock-' + fault))
    label = 'audit-live'
    resume = root / 'resume-publication'
    event = root / 'live-publication-event.json'
    env = {**r.ENV, 'PYTHONPATH': str(hook), 'PUBLICATION_FAULT': 'live-provisional', 'EVENT': str(event), 'RESUME': str(resume)}
    command = r.lane(root, label, [r.PY, '-B', root / 'publish.py', ROOT / r.EV / r.ORIGINS['audit'], 'audit', 'ok'])
    p = r.launch(command, root, root / 'audit-live.log', env)
    try:
        r.wait(lambda: event.exists())
        assert p.poll() is None and r.read(root / r.EV / label / 'receipt.json')['exit'] == 0
        consume('reject-readable-live-success', label)
        resume.write_text('continue')
        assert p.wait(timeout=15) == 0
        consume('accept-completed-real-producer-publication', label, True)
    finally:
        if p.poll() is None:
            p.terminate()
            p.wait(timeout=20)
        r.cleanup(root)


def main():
    lock = TOOLS / '.light-proof-lock'
    lock.mkdir()
    (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'phase': LABEL}))
    OUT.mkdir()
    scripts = OUT / 'scripts'
    scripts.mkdir()
    original = EVIDENCE / 'old-red/scripts/review.py'
    shutil.copyfile(original, scripts / 'review-original.py')
    source = original.read_text().replace("'f4fd0ea574bb74fdaac6628556985a55046186f4'", "'working Swift tooling candidate; hashes are authoritative'")
    # Repeated cleanup must never signal a recycled/unrelated recorded PID.
    source = source.replace("        if rows:\n            os.killpg(pid,signal.SIGKILL);", "        if rows:\n            assert all(str(root) in row or row.split()[3].startswith('Z') for row in rows), ('unowned process identity', rows)\n            os.killpg(pid,signal.SIGKILL);")
    (scripts / 'review.py').write_text(source)
    (OUT / 'context.json').write_text(json.dumps({'root': str(ROOT)}))
    spec = importlib.util.spec_from_file_location('swift_boundary_fixtures', scripts / 'review.py')
    r = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(r)
    log = (OUT / 'driver.log').open('x')
    original_record = r.record
    def record(value):
        with contextlib.redirect_stdout(log):
            original_record(value)
    r.record = record
    stop = False
    def cancel(sig, frame):
        nonlocal stop
        stop = True  # Finish the bounded in-flight call; never unwind Popen ownership.
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, cancel)
    original_launch = r.launch
    def launch(*args, **kwargs):
        if stop:
            raise KeyboardInterrupt('cancelled before next producer admission')
        return original_launch(*args, **kwargs)
    r.launch = launch
    complete = False
    try:
        r.promotions()
        publications(r)
        for case in ['before-handshake', 'before-dispatch', 'after-dispatch']:
            r.startup(case)
        r.lifecycle('runner-loss-family', 'family', signal_controller=signal.SIGKILL)
        r.lifecycle('cancel-family', 'family', signal_controller=signal.SIGTERM)
        r.lifecycle('leader-exit-descendant', 'leave-descendant')
        r.lifecycle('wall', wall=1)
        r.lifecycle('rss', rss=1)
        for name in ['supervisor-launch.json', 'dispatch.json', 'guardian.json', 'receipt.json']:
            r.lifecycle('write-' + name.replace('.json', ''), wall=1, block=name)
        for name, mode in [('ps-exit', 'exit'), ('ps-timeout', 'timeout'), ('both-observers-fail', 'both')]:
            observation(r, name, mode)
        observation(r, 'term-denied', deny='SIGTERM')
        observation(r, 'kill-denied', deny='SIGKILL')
        complete = True
    except BaseException:
        traceback.print_exc(file=log)
        log.flush()
        raise
    finally:
        for p in r.HANDLES:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait(timeout=5)
        for root in r.FIXTURES:
            r.cleanup(root)
        (OUT / 'summary.json').write_text(json.dumps({'status': 'PASS' if complete else 'FAIL', 'cases': len(r.RESULTS)}, indent=2))
        log.close()
        if complete:
            (lock / 'owner.json').unlink()
            lock.rmdir()
    print(json.dumps({'status': 'PASS', 'cases': len(r.RESULTS), 'output': str(OUT)}))


if __name__ == '__main__':
    main()
