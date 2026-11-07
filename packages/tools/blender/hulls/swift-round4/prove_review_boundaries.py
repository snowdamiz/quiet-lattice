"""Real lightweight processes and isolated promotion destinations; no Blender or codec."""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
TOOLS = Path(__file__).parent
EVIDENCE = ROOT / 'assets/renders/hulls/swift-round4-current'
LABEL = sys.argv[1] if len(sys.argv) > 1 else 'current-green'
assert LABEL and Path(LABEL).name == LABEL
OUT = EVIDENCE / '87-source-review-tooling' / LABEL
ENV = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2'}
RESULTS = []


def wait_for(check, seconds=22):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(.05)
    raise RuntimeError('bounded observation deadline')


def group(pid):
    return [r for r in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,command='], text=True, timeout=5).splitlines() if int(r.split()[2]) == pid]


def fixture(name, assets=False):
    root = OUT / name
    code = root / 'packages/tools/blender/hulls/swift-round4'
    code.mkdir(parents=True)
    for filename in ['lane.py', 'supervise.py', 'guardian.py', 'promote.py', 'check_lane.py', 'check_guardian.py']:
        shutil.copyfile(TOOLS / filename, code / filename)
    (root / 'assets/renders/hulls/swift-round4-current').mkdir(parents=True)
    if assets:
        for filename in ['assets/blend/hulls/swift.blend', 'packages/client/public/models/hulls/swift.glb']:
            dst = root / filename
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / filename, dst)
    return root, code


def run(command, cwd, logfile, expected=0, env=ENV, timeout=35):
    started = time.monotonic()
    with logfile.open('xb') as log:
        p = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            result = p.wait(timeout=timeout)
        finally:
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
                p.wait(timeout=20)
    record = {'command': list(map(str, command)), 'cwd': str(cwd), 'exit': result, 'seconds': round(time.monotonic() - started, 3), 'log': str(logfile.relative_to(ROOT))}
    RESULTS.append(record)
    assert result == expected, record
    return record


def lane(code, label, command, wall=20, rss=512):
    return [sys.executable, '-B', str(code / 'lane.py'), '--label', label, '--timeout', str(wall), '--rss-mib', str(rss), '--', *command]


def startup(case):
    root, code = fixture(case)
    hook = root / 'probe'
    hook.mkdir()
    (hook / 'sitecustomize.py').write_text('''import os,sys,signal,json
from pathlib import Path
done=False
def trace(frame,event,arg):
 global done
 if done or event!='line': return trace
 path=Path(frame.f_code.co_filename)
 case=os.environ['STARTUP_CASE']; local=frame.f_locals
 line=path.read_text().splitlines()[frame.f_lineno-1].strip() if path.name in ['lane.py','supervise.py'] else ''
 hit=(case=='before-handshake' and path.name=='lane.py' and line=='os.close(read_fd)' and local.get('supervisor') is not None)
 hit=hit or (case=='before-dispatch' and path.name=='supervise.py' and line.startswith('child = subprocess.Popen'))
 hit=hit or (case=='after-dispatch' and path.name=='supervise.py' and line.startswith("durable_json(job / 'dispatch.json'"))
 if hit:
  done=True
  supervisor=local['supervisor'].pid if path.name=='lane.py' else os.getpid()
  parent=os.getpid() if path.name=='lane.py' else local['parent']
  child=local.get('child')
  record={'parentPid':parent,'supervisorPid':supervisor,'commandPid':child.pid if child else None,'case':case,'ownershipRecordExists':(Path(os.environ['SWIFT_JOB'])/'supervisor-launch.json').exists() if path.name=='supervise.py' else None}
  Path(os.environ['STARTUP_PROBE']).write_text(json.dumps(record))
  os.kill(parent,signal.SIGKILL)
 return trace
sys.settrace(trace)
''')
    probe = root / 'interruption.json'
    env = {**ENV, 'PYTHONPATH': str(hook), 'STARTUP_CASE': case, 'STARTUP_PROBE': str(probe)}
    job = root / 'assets/renders/hulls/swift-round4-current/probe'
    cmd = lane(code, 'probe', [sys.executable, '-B', '-c', 'import time;print("producer alive",flush=True);time.sleep(30)'])
    with (root / 'command.log').open('xb') as log:
        p = subprocess.Popen(cmd, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            assert p.wait(timeout=12) == -9
            wait_for(lambda: (job / 'guardian.json').exists())
            report = json.loads((job / 'guardian.json').read_text())
            event = json.loads(probe.read_text())
            wait_for(lambda: not group(event['supervisorPid']))
            assert report['childGroupEmpty'] and (report['commandGroup'] is None or not group(report['commandGroup']))
            assert not (job / 'receipt.json').exists(), 'dead runner must not publish success'
            assert not (Path('/tmp') / f'swift-r4-{p.pid}').is_symlink()
            if case == 'before-handshake':
                assert not (job / 'dispatch.json').exists()
            else:
                assert event['ownershipRecordExists']
            result = {'case': case, 'runnerExit': p.returncode, 'command': cmd, 'event': event, 'guardian': report,
                      'supervisorExited': True, 'commandGroupEmpty': True, 'terminalSuccessAbsent': True}
            (root / 'result.json').write_text(json.dumps(result, indent=2))
            RESULTS.append(result)
        finally:
            previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
            for sig in (signal.SIGTERM, signal.SIGINT):
                signal.signal(sig, signal.SIG_IGN)
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
                p.wait(timeout=20)
            if probe.exists():
                event = json.loads(probe.read_text())
                dispatch = json.loads((job / 'dispatch.json').read_text()) if (job / 'dispatch.json').exists() else {}
                for pid in [event.get('commandPid') or dispatch.get('pid'), event['supervisorPid']]:
                    if pid and group(pid):
                        os.killpg(pid, signal.SIGKILL)
                        wait_for(lambda: not group(pid), 5)
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def promotions():
    root, code = fixture('promotion', assets=True)
    ev = root / 'assets/renders/hulls/swift-round4-current'
    worker = root / 'publish.py'
    worker.write_text('''import hashlib,json,os,shutil,sys,time
from pathlib import Path
origin=Path(sys.argv[1]);kind=sys.argv[2];mode=sys.argv[3];job=Path(os.environ['SWIFT_JOB'])
files={'stock':['source-pin.json','validation/hulls__swift.blend.json','validation/hulls__swift.glb.json','models/hulls/swift.glb'],'identity':['identity.json'],'audit':['audit.json'],'fit':['display-fit.json']}[kind]
for filename in files:
 p=job/filename;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(origin/filename,p)
if mode=='bad-pin':
 p=job/'source-pin.json';d=json.loads(p.read_text());d['glbSha256']='0'*64;p.write_text(json.dumps(d))
print('Published exact existing payloads (not a new Blender validation); mode='+mode,flush=True)
if mode=='live': time.sleep(30)
raise SystemExit(23 if mode=='failed' else 0)
''')
    origins = {'stock': '70-corrected-stock-validation', 'identity': '71-corrected-source-export-identity', 'audit': '66-final-source-world-audit', 'fit': '67-final-display-fit'}
    def publish(kind, mode, expected=0):
        label = kind + '-' + mode
        command = lane(code, label, [sys.executable, '-B', str(worker), str(EVIDENCE / origins[kind]), kind, mode])
        run(command, root, root / (label + '.log'), expected)
        return label
    good = [publish(kind, 'success') for kind in origins]
    dest = root / 'packages/client/public/models/hulls/swift.glb'
    def promote(name, stages, accepted=False):
        out = root / name
        out.mkdir()
        before = dest.stat().st_ino
        digest = hashlib.sha256(dest.read_bytes()).hexdigest()
        command = [sys.executable, '-B', str(code / 'promote.py'), *stages]
        result = run(command, root, out / 'process.log', 0 if accepted else 1, {**ENV, 'SWIFT_JOB': str(out)})
        replaced = dest.stat().st_ino != before
        assert replaced == accepted and (out / 'promotion.json').exists() == accepted
        assert hashlib.sha256(dest.read_bytes()).hexdigest() == digest
        result.update(destinationInodeReplaced=replaced, destinationHashUnchanged=True)
    for index, kind in enumerate(origins):
        failed = publish(kind, 'failed', 23)
        stages = good.copy(); stages[index] = failed
        promote('reject-' + kind + '-terminal-23', stages)
    bad = publish('stock', 'bad-pin')
    promote('reject-stock-pin', [bad, *good[1:]])
    # Actual publication while its producer and supervisor are still alive.
    live = 'stock-live'; job = ev / live
    command = lane(code, live, [sys.executable, '-B', str(worker), str(EVIDENCE / origins['stock']), 'stock', 'live'])
    with (root / 'stock-live.log').open('xb') as log:
        p = subprocess.Popen(command, cwd=root, env=ENV, stdout=log, stderr=subprocess.STDOUT)
        try:
            wait_for(lambda: (job / 'process.log').exists() and 'mode=live' in (job / 'process.log').read_text())
            assert p.poll() is None and not (job / 'receipt.json').exists()
            promote('reject-live-missing-terminal', [live, *good[1:]])
        finally:
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
            assert p.wait(timeout=20) == 1
    promote('reject-cancelled-publication', [live, *good[1:]])
    promote('accept-real-terminal-success', good, True)


def main():
    def cancel(sig, frame):
        raise KeyboardInterrupt(f'proof cancelled by signal {sig}')
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, cancel)
    lock = TOOLS / '.light-proof-lock'
    lock.mkdir()
    (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'purpose': 'bounded lightweight actual process/promotion proofs'}))
    OUT.mkdir()
    complete = False
    try:
        for case in ['before-handshake', 'before-dispatch', 'after-dispatch']:
            startup(case)
        root, code = fixture('established')
        for script, label in [('check_lane.py', 'cancellation'), ('check_guardian.py', 'runner-loss')]:
            run([sys.executable, '-B', str(code / script), label], root, root / (script + '.log'))
        for label, wall, rss, expected_reason in [('wall', 1, 512, 'wall limit'), ('rss', 15, 1, 'RSS limit')]:
            run(lane(code, label, [sys.executable, '-B', '-c', 'import time;time.sleep(30)'], wall, rss), root, root / (label + '.log'), 1)
            report = json.loads((root / 'assets/renders/hulls/swift-round4-current' / label / 'receipt.json').read_text())
            assert report['reason'] == expected_reason and report['childGroupEmpty']
        promotions()
        complete = True
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, signal.SIG_IGN)
        if not complete:
            # Cancel only actual fixture lane owners; independent supervisors reap
            # their producers. Keep failed fixture ownership/evidence intact.
            for owner in OUT.rglob('.lane-lock/owner.json'):
                pid = json.loads(owner.read_text())['pid']
                rows = subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines()
                if any(str(owner.parent.parent / 'lane.py') in row and int(row.split()[0]) == pid for row in rows):
                    os.kill(pid, signal.SIGTERM)
            wait_for(lambda: not any(str(OUT) in row and ('/lane.py' in row or '/supervise.py' in row)
                                    for row in subprocess.check_output(['ps', '-axo', 'command='], text=True).splitlines()), 25)
        (OUT / 'results.json').write_text(json.dumps({'status': 'PASS' if complete else 'FAIL', 'results': RESULTS}, indent=2))
        if complete:
            (lock / 'owner.json').unlink()
            lock.rmdir()
    print(json.dumps({'status': 'PASS', 'results': len(RESULTS), 'output': str(OUT)}))


if __name__ == '__main__':
    main()
