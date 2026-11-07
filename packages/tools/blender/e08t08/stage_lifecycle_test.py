"""Serial actual-process regression matrix. Creates exclusive, preserved fixtures.

Only finite Python workers (at most a leader and one sleeping detached leaf).
The full finalize.py caller runs on copies of historical receipts and read-only
asset symlinks. No art execution or dependency import/install is performed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
# Exact F2 commit under revision for F2-R2 late-observation RED.
BASE = 'ccdcb1b6079c4f6d6a64506e889f4a6e170464ba'
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='1',
           OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')


def save(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')


def wait_for(predicate, seconds=7):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(.02)
    raise TimeoutError('fixture barrier did not settle')


def process(pid):
    p = subprocess.run(['ps', '-p', str(pid), '-o', 'pid=,ppid=,pgid=,stat=,args='],
                       capture_output=True, text=True, timeout=2)
    return p.stdout.strip()


def fixture(parent, name, base):
    folder = parent / name
    folder.mkdir()
    root = folder / 'root'
    task = root / 'packages/tools/blender/e08t08'
    (task / 'reports').mkdir(parents=True)
    for name in ['stage.py', 'finalize.py', 'stage_ownership.py', 'stage_processes.py', 'legacy-stages.json']:
        if base and name in ('stage.py', 'finalize.py', 'stage_processes.py'):
            data = subprocess.check_output(['git', 'show', BASE + ':packages/tools/blender/e08t08/' + name], cwd=ROOT)
            (task / name).write_bytes(data)
        else:
            shutil.copyfile(HERE / name, task / name)
    legacy = json.loads((HERE / 'legacy-stages.json').read_text())['stages']
    for files in legacy.values():
        for name, digest in files.items():
            src = HERE / 'reports' / name
            assert hashlib.sha256(src.read_bytes()).hexdigest() == digest
            shutil.copyfile(src, task / 'reports' / name)
    save(folder / 'tool-pins.json', {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in task.iterdir() if p.is_file()})
    return folder, root, task


def call(folder, label, command, cwd=None):
    start = time.time()
    with (folder / (label + '.log')).open('x') as output:
        p = subprocess.run(command, cwd=cwd, env=ENV, stdout=output, stderr=subprocess.STDOUT, timeout=15)
    result = dict(command=command, cwd=str(cwd or ROOT), start=start, end=time.time(), exit=p.returncode)
    save(folder / (label + '.receipt.json'), result)
    return p.returncode


def seed_finalizer(root, task):
    if not (root / 'assets').exists():
        (root / 'assets').symlink_to(ROOT / 'assets', target_is_directory=True)
        (root / 'packages/client/public').mkdir(parents=True)
        (root / 'packages/client/public/models').symlink_to(ROOT / 'packages/client/public/models', target_is_directory=True)
        (root / 'pnpm-lock.yaml').symlink_to(ROOT / 'pnpm-lock.yaml')
        for path in ['node_modules', 'packages/client/node_modules', 'packages/tools/node_modules']:
            (root / path).symlink_to(ROOT / path, target_is_directory=True)
        for name in ['source-contract.json', 'consumer-contract.json', 'codec.jsonl']:
            shutil.copyfile(HERE / 'reports' / name, task / 'reports' / name)
        shutil.copytree(HERE / 'reports/validate-final', task / 'reports/validate-final')


def finalize_fixture(folder, root, task, label):
    seed_finalizer(root, task)
    return call(folder, label, [sys.executable, str(task / 'finalize.py')], root)


def finalizer_cancellation(parent, mode):
    folder, root, task = fixture(parent, mode, False)
    result = dict(mode=mode, assertions={}, workerPIDs=[], start=time.time())
    child = None
    try:
        assert call(folder, 'successful-stage', [sys.executable, str(task / 'stage.py'), 'work', sys.executable, '-c', 'pass'], root) == 0
        seed_finalizer(root, task)
        command = [sys.executable, str(HERE / 'lifecycle_driver.py'), str(task / 'finalize.py'),
                   str(folder), 'finalize_publication', 'candidate']
        result['command'] = command
        with (folder / 'cancelled-finalizer.log').open('x') as log:
            child = subprocess.Popen(command, cwd=root, env=ENV, stdout=log, stderr=subprocess.STDOUT)
            wait_for(lambda: (folder / 'publishing').exists())
            child.send_signal(signal.SIGINT if mode.endswith('sigint') else signal.SIGTERM)
            result['exit'] = child.wait(timeout=3)
        outputs = task / 'reports/finalized'
        partials = {str(p.relative_to(outputs)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in outputs.glob('*/*') if p.is_file()}
        result['partialFiles'] = partials
        result['assertions']['interrupted actual finalizer cannot publish'] = result['exit'] != 0 and bool(partials) and not list(outputs.glob('*/PUBLISHED.json'))
        result['retryExit'] = finalize_fixture(folder, root, task, 'finalizer-retry')
        result['assertions']['retry publishes a new generation'] = result['retryExit'] == 0 and len(list(outputs.glob('*/PUBLISHED.json'))) == 1
        result['assertions']['partial evidence preserved'] = all(hashlib.sha256((outputs/p).read_bytes()).hexdigest() == h for p,h in partials.items())
    except BaseException as error:
        result['harnessError'] = repr(error)
        result['assertions']['harness completed'] = False
    finally:
        if child and child.poll() is None:
            child.kill(); child.wait(timeout=3)
        result.update(end=time.time(), cleanupRemaining=[], passed=all(result['assertions'].values()))
        save(folder / 'result.json', result)
    print(json.dumps({k:result[k] for k in ('mode','passed','assertions')}), flush=True)
    return result


def late_same_group_fork(parent, base):
    """Stale final ps snapshot vs same-pgid child forked before leader reap."""
    folder, root, task = fixture(parent, 'late_same_group_fork', base)
    result = dict(mode='late_same_group_fork', base=base, start=time.time(), assertions={}, workerPIDs=[])
    wrapper = None
    leaf = None

    def check(name, ok):
        result['assertions'][name] = bool(ok)

    try:
        command = [sys.executable, str(HERE / 'lifecycle_driver.py'), str(task / 'stage.py'),
                   str(folder), 'late_same_group_fork', 'base' if base else 'candidate',
                   sys.executable, str(HERE / 'lifecycle_worker.py'), str(folder), 'late-leader']
        result['command'] = command
        with (folder / 'supervisor.log').open('x') as log:
            wrapper = subprocess.Popen(command, cwd=root, env=ENV, stdout=log, stderr=subprocess.STDOUT)
            wait_for(lambda: (folder / 'leader.json').exists())
            wrapper.send_signal(signal.SIGTERM)
            result['supervisorExit'] = wrapper.wait(timeout=12)
        spawned = json.loads((folder / 'spawned.json').read_text())
        leaf = spawned['leaf']
        result['spawned'] = spawned
        result['workerPIDs'] = [spawned['leader'], leaf]
        result['leafAfterSupervisor'] = process(leaf)
        receipt = task / 'reports/work.json'
        result['terminal'] = json.loads(receipt.read_text()) if receipt.is_file() else None
        settled = task / 'reports/runs/work/settled.json'
        result['settled'] = json.loads(settled.read_text()) if settled.is_file() else None
        result['retryExit'] = call(folder, 'retry', [sys.executable, str(task / 'stage.py'),
                                                     'retry', sys.executable, '-c', 'pass'], root)
        result['leafAfterRetry'] = process(leaf)
        result['finalizerExit'] = finalize_fixture(folder, root, task, 'finalize')
        terminal = result['terminal'] or {}
        defect = (bool(result['leafAfterSupervisor']) and bool(result['leafAfterRetry'])
                  and result['retryExit'] == 0 and terminal.get('cleanup') == 'verified'
                  and not terminal.get('remainingProcesses') and terminal.get('directChildReaped'))
        result['defectReproduced'] = defect
        check('late same-group fork cannot seal verified cleanup while leaf lives', not defect)
        check('late leaf drained before admission opens', not result['leafAfterSupervisor'])
        check('cancelled/uncertain run still refused by finalizer', result['finalizerExit'] != 0)
        check('supervisor did not claim success', result['supervisorExit'] != 0)
    except BaseException as error:
        result['harnessError'] = repr(error)
        check('harness completed', False)
    finally:
        if wrapper and wrapper.poll() is None:
            wrapper.kill()
            wrapper.wait(timeout=3)
        for pid in result['workerPIDs']:
            row = process(pid)
            if row and str(folder) in row:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if result['workerPIDs']:
            wait_for(lambda: all(not process(pid) for pid in result['workerPIDs']), 4)
        result['cleanupRemaining'] = [process(pid) for pid in result['workerPIDs']]
        result['end'] = time.time()
        result['passed'] = all(result['assertions'].values())
        save(folder / 'result.json', result)
    print(json.dumps({k: result[k] for k in ('mode', 'passed', 'assertions') if k in result}), flush=True)
    return result


def exercise(parent, mode, base):
    if mode.startswith('finalizer_'):
        return finalizer_cancellation(parent, mode)
    if mode == 'late_same_group_fork':
        return late_same_group_fork(parent, base)
    folder, root, task = fixture(parent, mode, base)
    busy = mode in ('sigterm', 'sigint', 'exception', 'observation_failure', 'leader_loss',
                    'leader_zero', 'supervisor_loss', 'uncertain_cleanup', 'waiter_loss')
    unknown = mode in ('observation_failure', 'uncertain_cleanup', 'supervisor_loss',
                      'receipt_failure', 'seal_failure', 'seal_sync_failure', 'publication_failure', 'admission_failure', 'watch_failure', 'waiter_loss')
    finite = f"from pathlib import Path; Path({str(folder / 'command-ran')!r}).touch(); "
    finite += 'raise SystemExit(7)' if mode == 'failed' else 'import time; time.sleep(10)' if mode == 'watch_failure' else 'print("finite success")'
    cmd = ([sys.executable, str(HERE / 'lifecycle_worker.py'), str(folder), 'leader'] if busy else
           [sys.executable, '-c', finite])
    command = [sys.executable, str(HERE / 'lifecycle_driver.py'), str(task / 'stage.py'),
               str(folder), mode, 'base' if base else 'candidate', *cmd]
    result = dict(mode=mode, base=base, command=command, start=time.time(), assertions={}, workerPIDs=[])
    wrapper = None
    def check(name, ok):
        result['assertions'][name] = bool(ok)
    try:
        with (folder / 'supervisor.log').open('x') as log:
            wrapper = subprocess.Popen(command, cwd=root, env=ENV, stdout=log, stderr=subprocess.STDOUT)
            result['supervisorPID'] = wrapper.pid
            if busy:
                wait_for(lambda: (folder / 'leaf.json').exists())
                worker = json.loads((folder / 'worker.json').read_text())
                result['workerPIDs'] = [worker['pid'], worker['leaf']]
                if not base:
                    owner = task / 'reports/runs/work/owner.json'
                    def observed():
                        if not owner.exists(): return False
                        return any(w['pid'] == worker['leaf'] for w in json.loads(owner.read_text())['knownDescendants'])
                    wait_for(observed)
                else:
                    # Exact old stage samples every .5 seconds; allow it one observation
                    # before forcing leader loss. The regression still uses real PIDs.
                    time.sleep(.6)
                result['beforeAction'] = [process(pid) for pid in result['workerPIDs']]
                if mode == 'leader_loss':
                    os.kill(worker['pid'], signal.SIGKILL)
                elif mode == 'leader_zero':
                    (folder / 'leader-exit').touch()
                elif mode in ('exception', 'observation_failure', 'waiter_loss') or (base and mode == 'uncertain_cleanup'):
                    (folder / 'inject').touch()
                else:
                    wrapper.send_signal(signal.SIGINT if mode == 'sigint' else
                                        signal.SIGKILL if mode == 'supervisor_loss' else signal.SIGTERM)
                if not base and mode not in ('supervisor_loss', 'uncertain_cleanup'):
                    wait_for(lambda: (folder / 'leaf-term').exists())
                else:
                    time.sleep(.1)
                result['leafDuringRetry'] = process(worker['leaf'])
                retry = [sys.executable, str(task / 'stage.py'), 'overlap', sys.executable, '-c', 'pass']
                result['retryWhileOwned'] = call(folder, 'retry-while-owned', retry, root)
                check('retry rejected while descendant alive', result['retryWhileOwned'] != 0 and bool(result['leafDuringRetry']))
                if not base:
                    early = finalize_fixture(folder, root, task, 'finalize-active')
                    check('actual finalizer rejects active/uncertain ownership', early != 0)
            if mode.startswith('publication_'):
                wait_for(lambda: (folder / 'publishing').exists())
                wrapper.send_signal(signal.SIGTERM)
                retry = [sys.executable, str(task / 'stage.py'), 'during_publication', sys.executable, '-c', 'pass']
                result['retryDuringPublication'] = call(folder, 'retry-publication', retry, root)
                check('publication retains admission', result['retryDuringPublication'] != 0)
                (folder / 'publishing-release').touch()
            result['supervisorExit'] = wrapper.wait(timeout=9)
        if mode == 'watch_failure' and (folder / 'watch-child.json').exists():
            result['workerPIDs'] = [json.loads((folder / 'watch-child.json').read_text())['pid']]
            check('Popen handle survives watcher exception', not process(result['workerPIDs'][0]))
        if mode == 'admission_failure':
            check('no dispatch before durable admission', not (folder / 'command-ran').exists())
        result['workersAfterSupervisorExit'] = [process(pid) for pid in result['workerPIDs']]
        receipt = task / 'reports/work.json'
        result['terminal'] = json.loads(receipt.read_text()) if receipt.is_file() else None
        check('terminal or durable unfinished admission exists', receipt.is_file() or (task / 'reports/runs/work').exists())
        outcome = result['terminal'].get('outcome') if result['terminal'] else None
        success = mode in ('valid', 'publication_during', 'publication_after')
        check('supervisor outcome', result['supervisorExit'] == 0 if success else result['supervisorExit'] != 0)
        if result['terminal']:
            if mode in ('seal_failure', 'seal_sync_failure', 'publication_failure'):
                failure = task / 'reports/runs/work/publication-failure.json'
                check('unsealed proposal cannot count as completion',
                      (not (task / 'reports/runs/work/settled.json').is_file()
                       or bool(list((task / 'reports/runs/work').glob('settled.json.*.pending'))))
                      and failure.exists() and json.loads(failure.read_text())['outcome'] == 'publication-failed')
            else:
                check('explicit outcome', outcome == ('success' if success else
                      'uncertain' if mode in ('observation_failure', 'uncertain_cleanup', 'watch_failure', 'waiter_loss') else
                      'cancelled' if mode in ('sigterm', 'sigint', 'publication_before') else 'failed'))
        if not unknown:
            check('cleanup terminal', bool(result['terminal']) and result['terminal'].get('cleanup') == 'verified')
            check('direct child reaped', bool(result['terminal']) and result['terminal'].get('directChildReaped') is True)
            check('no surviving fixture worker', all(not process(pid) for pid in result['workerPIDs']))
        if mode == 'waiter_loss':
            check('known descendants drained despite lost direct waiter', all(not process(pid) for pid in result['workerPIDs']))
            check('lost waiter does not synthesize exit zero', result['terminal']['exit'] is None and not result['terminal']['directChildReaped'])
        result['finalizeExit'] = finalize_fixture(folder, root, task, 'finalize-terminal')
        check('actual finalizer outcome', result['finalizeExit'] == 0 if success else result['finalizeExit'] != 0)
        published = list((task / 'reports/finalized').glob('*/PUBLISHED.json'))
        check('no failed/incomplete promotion', bool(published) if success else not published and not (task / 'C2-report.txt').exists())
        retry = [sys.executable, str(task / 'stage.py'), 'retry', sys.executable, '-c', 'pass']
        result['retryAfterExit'] = call(folder, 'retry-after-exit', retry, root)
        result['workersDuringRetryAfterExit'] = [process(pid) for pid in result['workerPIDs']]
        check('admission after settlement only', result['retryAfterExit'] != 0 if unknown else result['retryAfterExit'] == 0)
        if not base and not success and result['retryAfterExit'] == 0:
            check('successful retry does not erase failed admission',
                  finalize_fixture(folder, root, task, 'finalize-after-retry') != 0)
    except BaseException as error:
        result['harnessError'] = repr(error)
        check('harness completed', False)
    finally:
        if wrapper and wrapper.poll() is None:
            wrapper.kill()
            wrapper.wait(timeout=3)
        # Failure cleanup is outside the system under test and never manufactures
        # its settlement record. Identity includes this exclusive fixture path.
        for pid in result['workerPIDs']:
            row = process(pid)
            if row and str(folder) in row:
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
        wait_for(lambda: all(not process(pid) for pid in result['workerPIDs']), 4)
        result['cleanupRemaining'] = [process(pid) for pid in result['workerPIDs']]
        if not base and unknown:
            retry = [sys.executable, str(task / 'stage.py'), 'after_manual_cleanup', sys.executable, '-c', 'pass']
            check('uncertainty survives manual fixture cleanup', call(folder, 'retry-after-manual-cleanup', retry, root) != 0)
            check('finalizer still rejects unresolved ownership', finalize_fixture(folder, root, task, 'finalize-after-manual-cleanup') != 0)
        result['end'] = time.time()
        result['passed'] = all(result['assertions'].values())
        save(folder / 'result.json', result)
    print(json.dumps({k: result[k] for k in ('mode', 'passed', 'assertions')}), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--base', action='store_true')
    parser.add_argument('--cases', default='valid,sigterm,sigint,exception,observation_failure,leader_loss,leader_zero,waiter_loss,uncertain_cleanup,supervisor_loss,failed,receipt_failure,seal_failure,seal_sync_failure,admission_failure,watch_failure,publication_before,publication_during,publication_after,publication_failure,finalizer_sigterm,finalizer_sigint,late_same_group_fork')
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=False)
    inputs = args.evidence / 'inputs'
    inputs.mkdir()
    for name in ['stage_lifecycle_test.py', 'lifecycle_driver.py', 'lifecycle_worker.py']:
        shutil.copyfile(HERE / name, inputs / name)
    results = [exercise(args.evidence.resolve(), case, args.base) for case in args.cases.split(',')]
    save(args.evidence / 'results.json', dict(base=args.base, cases=len(results), passed=sum(r['passed'] for r in results),
        failures=[r['mode'] for r in results if not r['passed']], allFixtureWorkersExited=all(not any(r['cleanupRemaining']) for r in results)))
    return 0 if all(r['passed'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
