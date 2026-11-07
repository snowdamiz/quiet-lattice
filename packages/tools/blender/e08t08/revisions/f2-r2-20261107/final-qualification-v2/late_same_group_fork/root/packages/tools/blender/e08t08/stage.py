"""One bounded CPU lane, retained until ownership and terminal publication settle."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import traceback
sys.dont_write_bytecode = True

from stage_ownership import admit, lane_lock, settle, write_json
from stage_processes import OwnedProcesses

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REPORTS = HERE / 'reports'
GIB = 1024 ** 3
POLL = .1
TERM_GRACE = 2
KILL_GRACE = 2
CANCEL_SIGNALS = {signal.SIGTERM, signal.SIGINT}


def free():
    s = os.statvfs(ROOT)
    return s.f_bavail * s.f_frsize


def payload():
    paths = [HERE, ROOT / 'assets/blend/creatures', ROOT / 'assets/blend/constructs',
             ROOT / 'packages/client/public/models/creatures', ROOT / 'packages/client/public/models/constructs',
             ROOT / 'assets/renders/creatures/e08t08', ROOT / 'assets/renders/constructs/e08t08']
    return sum(p.stat().st_size for path in paths for p in path.rglob('*') if p.is_file() and not p.is_symlink())


def hashes(folder, extension):
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for family in ('creatures', 'constructs') for p in (ROOT / folder / family).glob('*.' + extension)}


def sources():
    return hashes('assets/blend', 'blend')


def exports():
    return hashes('packages/client/public/models', 'glb')


class Cancellation:
    def __init__(self):
        self.signals = []
        self.committed = False

    def receive(self, signum, _frame):
        # Never unwind Popen, drain, or a persistence operation asynchronously.
        if not self.committed:
            self.signals.append(signum)


def progress(directory, owned):
    write_json(directory / 'owner.json', owned.evidence(), replace=True)


def drain(owned, record):
    """Bounded cleanup, independent of resource sampling or result hashing."""
    deadline = time.monotonic() + TERM_GRACE + KILL_GRACE
    kill_at = time.monotonic() + TERM_GRACE
    verified = not record['observationUncertain']
    while time.monotonic() < deadline:
        try:
            owned.observe()
        except BaseException as error:
            verified = False
            record['errors'].append('cleanup observation: ' + repr(error))
        try:
            if owned.all_exited():
                # A same-pgid child can appear after the snapshot that made
                # all_exited true and before wait(). Re-observe first.
                try:
                    owned.observe()
                except BaseException as error:
                    verified = False
                    record['errors'].append('cleanup confirmation: ' + repr(error))
                    raise
                if not owned.all_exited():
                    pass
                else:
                    record['exit'] = owned.child.wait(timeout=.2)
                    record['directChildReaped'] = True
                    # Darwin keeps the reaped leader's pgid on orphans. killpg is
                    # unsafe after reap (PID reuse); charge leftovers instead.
                    try:
                        leftovers = owned.same_group_leftovers()
                    except BaseException as error:
                        verified = False
                        record['errors'].append('cleanup post-reap observation: ' + repr(error))
                        record['remainingProcesses'] = owned.last
                        return False
                    if leftovers:
                        record['remainingProcesses'] = leftovers
                        for row in leftovers:
                            try:
                                os.kill(row['pid'], signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                            except OSError as error:
                                record['errors'].append('post-reap signal: ' + repr(error))
                        return False
                    record['remainingProcesses'] = []
                    return verified
        except BaseException as error:
            verified = False
            record['errors'].append('cleanup ownership: ' + repr(error))
        try:
            owned.signal_all(signal.SIGKILL if time.monotonic() >= kill_at else signal.SIGTERM)
        except BaseException as error:
            verified = False
            record['errors'].append('cleanup signal: ' + repr(error))
        time.sleep(POLL)
    # Keep the ledger charged even if an OS/process observation cannot settle.
    try:
        if not owned.waiter_lost:
            record['exit'] = owned.child.wait(timeout=.2)
            record['directChildReaped'] = True
    except subprocess.TimeoutExpired:
        pass
    try:
        leftovers = owned.same_group_leftovers()
        record['remainingProcesses'] = leftovers or owned.last
    except BaseException as error:
        verified = False
        record['errors'].append('cleanup final observation: ' + repr(error))
        record['remainingProcesses'] = owned.last
    return False


def publish_terminal(directory, record, cancellation):
    """Cleanup is already terminal. Completion linearizes at this masked decision.

    Signals observed before this decision cancel. Signals during the short local
    persistence transaction are deferred; a successfully sealed completion wins.
    A crash or write/fsync failure leaves the durable admission unresolved.
    """
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, CANCEL_SIGNALS)
    try:
        pending = signal.sigpending() & CANCEL_SIGNALS
        record['cancelSignals'] = sorted(set(cancellation.signals) | {int(s) for s in pending})
        if record['cleanup'] != 'verified':
            record['outcome'] = 'uncertain'
        elif record['cancelSignals']:
            record['outcome'] = 'cancelled'
        elif record['exit'] != 0 or record['errors'] or record['stopReason']:
            record['outcome'] = 'failed'
        else:
            record['outcome'] = 'success'
        receipt = REPORTS / (record['stage'] + '.json')
        write_json(receipt, record)
        if record['cleanup'] == 'verified':
            settle(directory, receipt, record['runId'])
            cancellation.committed = True
        return record['outcome'] == 'success'
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


def run(name, cmd, cancellation):
    with lane_lock(REPORTS):
        before_free, before_payload = free(), payload()
        if before_free < 12 * GIB or before_payload >= 6 * GIB:
            raise RuntimeError('resource admission refused before dispatch')
        directory, admission = admit(REPORTS, name, cmd)
        record = dict(**admission, cwd=str(ROOT), beforeFree=before_free, beforePayload=before_payload,
                      start=time.time(), samples=[], limitSeconds=2700, errors=[], cancelSignals=[],
                      stopReason=None, exit=None, directChildReaped=False, cleanup='unknown',
                      remainingProcesses=[], observationUncertain=False,
                      sampling='process group and instance-watched descendant closure')
        child = None
        owned = None
        dispatch_attempted = False
        result = False
        try:
            record.update(beforeSources=sources(), beforeExports=exports())
            env = dict(os.environ, BLENDER=str(HERE / 'bin/blender'), KTX=str(HERE / 'bin/ktx'),
                       ART_KTX_JOBS='1', ART_RAW='1', PYTHONUNBUFFERED='1', PYTHONDONTWRITEBYTECODE='1',
                       OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2',
                       VECLIB_MAXIMUM_THREADS='2', NUMEXPR_NUM_THREADS='2', BLIS_NUM_THREADS='2')
            with (REPORTS / f'{name}.log').open('x') as log:
                if not cancellation.signals:
                    # The durable admission exists before this potentially ambiguous call.
                    dispatch_attempted = True
                    child = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log,
                                             stderr=subprocess.STDOUT, start_new_session=True)
                    record['pid'] = child.pid
                    owned = OwnedProcesses(child)
                    progress(directory, owned)
                    while not cancellation.signals:
                        try:
                            rows = owned.observe()
                        except BaseException:
                            record['observationUncertain'] = True
                            raise
                        progress(directory, owned)
                        sample = dict(time=time.time(), rss=sum(p['rss'] for p in rows),
                                      free=free(), processes=rows)
                        record['samples'].append(sample)
                        if sample['rss'] > 8 * GIB: record['stopReason'] = 'aggregate RSS exceeded 8 GiB'
                        if sample['free'] < 12 * GIB: record['stopReason'] = 'free capacity fell below 12 GiB'
                        if sample['time'] - record['start'] > 2700: record['stopReason'] = '45 minute wall bound'
                        if len(record['samples']) % 50 == 0 and payload() > 6 * GIB:
                            record['stopReason'] = '6 GiB payload bound'
                        if owned.leader_exited() and not owned.all_exited():
                            record['stopReason'] = 'leader exited with live descendants'
                        if record['stopReason'] or owned.leader_exited():
                            break
                        time.sleep(POLL)
        except BaseException as error:
            record['errors'].append(repr(error))
            traceback.print_exc()
        finally:
            try:
                if owned is not None:
                    if drain(owned, record):
                        record['cleanup'] = 'verified'
                    record['ownership'] = owned.evidence()
                elif child is not None:
                    # Popen returned a real handle, even if watcher setup failed.
                    # Preserve and drain that child; unknown descendants keep admission closed.
                    record['observationUncertain'] = True
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except OSError as error:
                        record['errors'].append('direct-child termination: ' + repr(error))
                    record['exit'] = child.wait(timeout=KILL_GRACE)
                    record['directChildReaped'] = True
                elif not dispatch_attempted:
                    record['cleanup'] = 'verified'
                    record['directChildReaped'] = True  # Proven no child dispatched.
            except BaseException as error:
                record['cleanup'] = 'unknown'
                record['errors'].append('cleanup exception: ' + repr(error))
            finally:
                if owned is not None:
                    try:
                        owned.close()
                    except BaseException as error:
                        record['errors'].append('process watch close: ' + repr(error))
            # Independent finally publication still runs if cleanup/observation failed.
            record.update(end=time.time(), maxRSS=max((s['rss'] for s in record['samples']), default=0))
            for key, get in [('afterFree', free), ('afterPayload', payload),
                             ('afterSources', sources), ('afterExports', exports)]:
                try:
                    record[key] = get()
                except BaseException as error:
                    record['errors'].append(key + ': ' + repr(error))
            try:
                result = publish_terminal(directory, record, cancellation)
            except BaseException as error:
                record['outcome'] = 'publication-failed'
                record['cancelSignals'] = sorted(set(cancellation.signals))
                record['errors'].append('terminal publication failed: ' + repr(error))
                # Never clear/reconstruct admission when terminal persistence is uncertain.
                try:
                    write_json(directory / 'publication-failure.json', record)
                except BaseException:
                    traceback.print_exc()
                print(json.dumps(record), file=sys.stderr)
        print(json.dumps({k: record.get(k) for k in (
            'stage', 'runId', 'outcome', 'exit', 'cleanup', 'errors', 'cancelSignals', 'maxRSS')}))
        return 0 if result else 1


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) < 2 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', args[0]):
        raise ValueError('usage: stage.py <unique-stage-name> <command...>')
    cancellation = Cancellation()
    # This is a process entry point. Retain handlers through interpreter exit so
    # a deferred signal cannot turn a sealed completion into a late -SIGTERM.
    for sig in CANCEL_SIGNALS:
        signal.signal(sig, cancellation.receive)
    try:
        return run(args[0], args[1:], cancellation)
    except BaseException:
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
