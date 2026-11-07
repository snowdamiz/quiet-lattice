"""Own producer dispatch and bounded cleanup before the runner can create any work."""
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

from lane import ROOT, durable_json, output_usage, processes


def main():
    fd, parent = map(int, sys.argv[1:])
    job = Path(os.environ['SWIFT_JOB'])
    launch = json.loads((job / 'launch.json').read_text())
    child = None
    failure = None
    peak = 0
    actions = []
    started = time.monotonic()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, signal.SIG_IGN)

    def members():
        return [r for r in processes() if child is not None and int(r[2]) == child.pid]

    def message(timeout=0):
        ready, _, _ = select.select([fd], [], [], timeout)
        return os.read(fd, 4096) if ready else None

    try:
        # Exclusive, fsynced ownership record precedes the real producer Popen.
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
        while child.poll() is None:
            data = message()
            if data is not None:
                failure = 'runner disappeared' if not data else data.decode(errors='replace').strip()
            rss = sum(int(r[3]) for r in members())
            peak = max(peak, rss)
            if rss > launch['rssLimitMiB'] * 1024:
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
        traceback.print_exc()
    finally:
        remaining = []
        if child is not None:
            for sig, limit in [(signal.SIGTERM, 5), (signal.SIGKILL, 10)]:
                child.poll()
                if not members():
                    break
                try:
                    os.killpg(child.pid, sig)
                    actions.append(signal.Signals(sig).name)
                except ProcessLookupError:
                    pass
                until = time.monotonic() + limit
                while time.monotonic() < until:
                    child.poll()
                    if not members():
                        break
                    time.sleep(.05)
            child.wait(timeout=1)
            remaining = members()
        alias = Path(os.environ['SWIFT_TEMP_ALIAS'])
        if not remaining and alias.is_symlink():
            assert os.readlink(alias) == str(job / 'scratch')
            alias.unlink()
        os.close(fd)
        durable_json(job / 'guardian.json', {
            'format': 2, 'reason': failure or 'normal runner completion',
            'failureReason': failure, 'parentPid': parent, 'supervisorPid': os.getpid(),
            'commandGroup': child.pid if child else None,
            'commandExit': child.returncode if child else None, 'signals': actions,
            'childGroupEmpty': not remaining, 'remaining': remaining,
            'peakRssKiB': peak, 'seconds': round(time.monotonic() - started, 3)})
    return 1 if remaining else 0


if __name__ == '__main__':
    sys.exit(main())
