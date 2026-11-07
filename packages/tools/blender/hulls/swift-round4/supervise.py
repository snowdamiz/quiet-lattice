"""Own dispatch and drain the pinned child group even if process-table reads fail."""
import json
import os
import select
import signal
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

from lane import ROOT, durable_json, error_fact, output_usage, processes


def main():
    fd, parent = map(int, sys.argv[1:])
    job = Path(os.environ['SWIFT_JOB'])
    launch = json.loads((job / 'launch.json').read_text())
    child = None
    failure = None
    peak = 0
    actions = []
    observation_errors = []
    drain_errors = []
    signal_attempts = []
    signal_not_needed = []
    primary_failed = False
    child_reaped = False
    remaining = None
    primary_remaining = secondary_remaining = None
    started = time.monotonic()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, signal.SIG_IGN)

    def members(phase, secondary=False, timeout=1):
        nonlocal primary_failed
        try:
            return [r for r in processes(timeout=timeout, executable='/bin/ps' if secondary else 'ps')
                    if child is not None and int(r[2]) == child.pid]
        except Exception as exc:
            observation_errors.append(error_fact(phase + (' /bin/ps secondary' if secondary else ' ps primary'), exc))
            if not secondary:
                primary_failed = True
            return None

    def exit_without_reaping():
        # Retain the actual direct child's PID (even as a zombie) until all signals
        # are finished. A recycled numeric PGID can never become a cleanup target.
        return os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)

    def message(timeout=0):
        ready, _, _ = select.select([fd], [], [], timeout)
        return os.read(fd, 4096) if ready else None

    try:
        durable_json(job / 'supervisor-launch.json', {
            'pid': os.getpid(), 'parentPid': parent, 'command': launch['command'],
            'timeout': launch['timeout'], 'rssLimitMiB': launch['rssLimitMiB'],
            'inputs': launch['inputs'], 'cwd': str(ROOT)})
        first = message(min(10, launch['timeout']))
        if first != b'start\n':
            raise RuntimeError('runner disappeared' if first == b'' else 'startup handshake refused')
        if message() is not None:
            raise RuntimeError('runner disappeared before dispatch')
        child = subprocess.Popen(launch['command'], cwd=ROOT, start_new_session=True)
        durable_json(job / 'dispatch.json', {'pid': child.pid, 'pgid': child.pid, 'supervisorPid': os.getpid()})
        while exit_without_reaping() is None:
            data = message()
            if data is not None:
                failure = 'runner disappeared' if not data else data.decode(errors='replace').strip()
            left = launch['timeout'] - (time.monotonic() - started)
            if left <= .1:
                failure = failure or 'wall limit'
                break
            rows = members('monitor', timeout=min(5, left))
            if rows is None:
                failure = failure or 'process observation failed'
                break
            peak = max(peak, sum(int(r[3]) for r in rows))
            if peak > launch['rssLimitMiB'] * 1024:
                failure = failure or 'RSS limit'
            if time.monotonic() - started > launch['timeout']:
                failure = failure or 'wall limit'
            total, count, image_bytes = output_usage()
            if count > 48 or image_bytes > 512 * 1024**2:
                failure = failure or 'image budget'
            if total > 8 * 1024**3:
                failure = failure or 'output size limit'
            if (job / 'process.log').stat().st_size > 16 * 1024**2:
                failure = failure or 'log limit'
            if shutil.disk_usage(ROOT).free < 6 * 1024**3:
                failure = failure or 'disk floor'
            if failure:
                break
            time.sleep(.1)
    except BaseException as exc:
        failure = failure or str(exc)
        drain_errors.append(error_fact('producer setup/monitor', exc))
        traceback.print_exc()
    finally:
        if child is not None:
            for sig, limit in [(signal.SIGTERM, 5), (signal.SIGKILL, 10)]:
                # No process-table observation is required to attempt the signal.
                # Verify only our unreaped direct-child ownership, never a looked-up PID.
                try:
                    already_exited = exit_without_reaping() is not None
                except Exception as exc:
                    drain_errors.append(error_fact('verify unreaped owned child before signal', exc))
                    break
                if already_exited:
                    observed = members('before signal for exited child', secondary=primary_failed, timeout=.5)
                    if observed is not None and not [r for r in observed if int(r[0]) != child.pid]:
                        signal_not_needed.append({'pgid': child.pid, 'ownedChildExitedUnreaped': True, 'otherObservedMembers': [], 'observer': 'secondary' if primary_failed else 'primary'})
                        break
                attempt = {'pgid': child.pid, 'signal': signal.Signals(sig).name, 'ownedChildPinned': True}
                try:
                    os.killpg(child.pid, sig)
                    attempt['sent'] = True
                    actions.append(signal.Signals(sig).name)
                except ProcessLookupError as exc:
                    attempt.update(sent=False, absent=True, error=error_fact('signal owned group', exc))
                except Exception as exc:
                    attempt.update(sent=False, error=error_fact('signal owned group', exc))
                    drain_errors.append(attempt['error'])
                signal_attempts.append(attempt)
                until = time.monotonic() + limit
                rows = None
                ended = False
                while time.monotonic() < until:
                    observation_budget = until - time.monotonic()
                    if observation_budget < .25:
                        break  # Escalate; do not manufacture a doomed short observer call.
                    rows = members('drain', secondary=primary_failed, timeout=min(.5, observation_budget))
                    try:
                        ended = exit_without_reaping() is not None
                    except Exception as exc:
                        drain_errors.append(error_fact('observe owned child exit during drain', exc))
                        break
                    # Only the pinned zombie may remain before our wait/reap.
                    if rows is not None and ended and not [r for r in rows if int(r[0]) != child.pid]:
                        break
                    if rows is None:
                        break  # Do not burn another observer timeout before escalation.
                    time.sleep(.05)
                else:
                    continue
                if rows is not None and ended and not [r for r in rows if int(r[0]) != child.pid]:
                    break
            try:
                child.wait(timeout=1)
                child_reaped = True
            except Exception as exc:
                drain_errors.append(error_fact('wait/reap actual direct child', exc))
            # No further signals after reaping: the numeric PID is no longer pinned.
            primary_remaining = members('final drain proof', timeout=.5)
            if primary_remaining is None:
                secondary_remaining = members('final drain proof', secondary=True, timeout=.5)
            remaining = primary_remaining if primary_remaining is not None else secondary_remaining
        else:
            remaining = []
            primary_remaining = []
            child_reaped = True
        group_empty = child_reaped and remaining == []
        if observation_errors or drain_errors:
            failure = failure or 'cleanup/observation error; inspect raw facts'
        alias = Path(os.environ['SWIFT_TEMP_ALIAS'])
        if group_empty and alias.is_symlink():
            try:
                assert os.readlink(alias) == str(job / 'scratch')
                alias.unlink()
            except Exception as exc:
                drain_errors.append(error_fact('remove owned temporary alias', exc))
                failure = failure or 'owned alias cleanup failed'
        try:
            os.close(fd)
        except Exception as exc:
            drain_errors.append(error_fact('close liveness pipe', exc))
            failure = failure or 'liveness pipe close failed'
        report = {
            'format': 3, 'reason': failure or 'normal runner completion', 'failureReason': failure,
            'parentPid': parent, 'supervisorPid': os.getpid(), 'commandGroup': child.pid if child else None,
            'commandExit': child.returncode if child else None, 'signals': actions, 'signalAttempts': signal_attempts, 'signalNotNeededProof': signal_not_needed,
            'childGroupEmpty': group_empty, 'ownedChildReaped': child_reaped, 'remaining': remaining,
            'primaryRemaining': primary_remaining, 'secondaryRemaining': secondary_remaining,
            'observationErrors': observation_errors, 'drainErrors': drain_errors,
            'cleanupProof': 'primary' if primary_remaining == [] else 'secondary' if secondary_remaining == [] else 'UNPROVEN',
            'peakRssKiB': peak, 'seconds': round(time.monotonic() - started, 3)}
        # The log keeps raw failure/drain facts even if the receipt write itself fails.
        print(json.dumps({'drain': report}), flush=True)
        durable_json(job / 'guardian.json', report)
    return 0 if group_empty else 1


if __name__ == '__main__':
    sys.exit(main())
