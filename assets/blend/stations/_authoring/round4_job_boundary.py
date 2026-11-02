"""Station round-four CPU candidate: unique launchd job and kernel coalition ownership.

Actual Chromium/native inheritance is not qualified by these CPU fixtures. This module
does not authorize capture. The sequential entry must enforce the separate boundary gate.
"""
from contextlib import contextmanager
import ctypes
import errno
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

from round4_capture_children import identity, LIBPROC, UnsafeCaptureGroup


class DeadlineExpired(BaseException):
    pass


@contextmanager
def deadline(seconds):
    """Interrupt blocking observers as well as loop bodies; restore any previous timer."""
    previous = signal.getsignal(signal.SIGALRM)
    timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    def expired(*_):
        raise DeadlineExpired('station phase deadline expired')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(.000001, timer[0] - (time.monotonic() - started)), timer[1])


def write(path, value):
    path = Path(path)
    temp = path.with_name(path.name + '.writing')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temp, path)


def coalition(pid):
    # XNU proc_info_private.h: coalition_id[2], then three reserved uint64s.
    data = (ctypes.c_uint64 * 5)()
    ctypes.set_errno(0)
    count = LIBPROC.proc_pidinfo(pid, 20, 0, ctypes.byref(data), ctypes.sizeof(data))
    if count == 0 and ctypes.get_errno() == errno.ESRCH:
        return None
    if count != ctypes.sizeof(data):
        raise OSError(ctypes.get_errno(), f'coalition read PID{pid} returned {count}')
    return list(data)[:2]


def user_pids():
    LIBPROC.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
    LIBPROC.proc_listpids.restype = ctypes.c_int
    # Read PID numbers only, never unrelated argv or environment.
    needed = LIBPROC.proc_listpids(4, os.getuid(), None, 0)
    if needed <= 0:
        raise OSError(ctypes.get_errno(), 'proc_listpids size failed')
    data = (ctypes.c_int * (needed // 4 + 1024))()
    count = LIBPROC.proc_listpids(4, os.getuid(), data, ctypes.sizeof(data))
    if count <= 0 or count >= ctypes.sizeof(data):
        raise OSError(ctypes.get_errno(), 'proc_listpids failed or truncated')
    return [pid for pid in data[:count // 4] if pid > 0]


def kernel_tasks(coalition_id):
    # XNU's coalition lock covers both counters in the same resource-usage receipt.
    # The syscall copies MIN(requested size, struct size); only its first 16 bytes are read.
    lib = ctypes.CDLL(None, use_errno=True)
    read = lib.coalition_info_resource_usage
    read.argtypes = [ctypes.c_uint64, ctypes.c_void_p, ctypes.c_size_t]
    read.restype = ctypes.c_int
    data = (ctypes.c_uint64 * 2)()
    ctypes.set_errno(0)
    if read(coalition_id, ctypes.byref(data), 16) != 0:
        if ctypes.get_errno() == errno.ESRCH:
            return {'coalition_absent': True, 'live': 0}
        raise OSError(ctypes.get_errno(), 'kernel coalition task receipt failed')
    assert data[0] >= data[1], 'Invalid kernel coalition counters'
    return {'coalition_absent': False, 'started': data[0], 'exited': data[1], 'live': data[0] - data[1]}


def coalition_members(coalition_id):
    if coalition_id <= 0 or coalition_id == coalition(os.getpid())[0]:
        raise UnsafeCaptureGroup('Refuse absent or supervisor coalition')
    found = []
    for pid in user_pids():
        ids = coalition(pid)
        if ids is not None and ids[0] == coalition_id:
            info = identity(pid)
            if info is not None:
                # Recheck the current kernel boundary; sampled parentage is never authority.
                latest = coalition(pid)
                if latest is not None and latest[0] == coalition_id:
                    assert info['uid'] == os.getuid()
                    found.append({**info, 'coalition': latest})
    return found


class StationJob:
    """One uniquely labelled, handshake-gated job; root stays alive until release."""
    def __init__(self, out, argv, cwd, capture_seconds=600, env=None):
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=False)
        self.scratch = Path(tempfile.mkdtemp(prefix='stations-round4-owned-'))
        self.target = f'gui/{os.getuid()}/local.stations.round4.' + uuid.uuid4().hex
        self.root = None
        self.coalition_id = None
        self.known = {}
        self.state = {'scope': 'CPU_CANDIDATE_BOUNDARY', 'exits': {}, 'errors': [], 'signals': [], 'drained': False, 'clean': False}
        self.registered = False
        # The worker imports only these exact task-local files copied into its private scratch.
        here = Path(__file__).parent
        for name in ('round4_job_boundary.py', 'round4_capture_children.py'):
            (self.scratch / name).write_bytes((here / name).read_bytes())
        request = {'argv': argv, 'cwd': str(cwd), 'capture_seconds': capture_seconds,
                   'env': env or {}, 'scratch': str(self.scratch)}
        write(self.scratch / 'request.json', request)
        spec = {'Label': self.target.split('/')[-1], 'ProgramArguments': [sys.executable,
            str(self.scratch / 'round4_job_boundary.py'), '--worker', str(self.scratch / 'request.json')],
            'RunAtLoad': True, 'KeepAlive': False, 'LaunchOnlyOnce': True, 'ExitTimeOut': 1,
            'StandardOutPath': str(self.scratch / 'stdout.txt'), 'StandardErrorPath': str(self.scratch / 'stderr.txt')}
        (self.scratch / 'job.plist').write_bytes(plistlib.dumps(spec))
        self.save()

    def save(self):
        write(self.out / 'boundary.json', {**self.state, 'target': self.target, 'scratch': str(self.scratch),
            'root': self.root, 'coalition_id': self.coalition_id, 'identities': self.known})

    def start(self):
        boot = subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(self.scratch / 'job.plist')],
                              capture_output=True, text=True, timeout=3)
        write(self.out / 'bootstrap.json', {'exit': boot.returncode, 'stdout': boot.stdout, 'stderr': boot.stderr})
        assert boot.returncode == 0, 'Owned launchd bootstrap failed'
        self.registered = True
        with deadline(5):
            while not (self.scratch / 'worker.json').exists():
                time.sleep(.01)
            self.root = json.loads((self.scratch / 'worker.json').read_text())['root']
            current = identity(self.root['pid'])
            assert current and current['birth'] == self.root['birth'] and current['uid'] == os.getuid()
            ids = coalition(current['pid'])
            assert ids and ids[0] > 0 and ids[0] != coalition(os.getpid())[0]
            self.coalition_id = ids[0]
            assert [r['pid'] for r in self.members()] == [current['pid']], 'Job not isolated before launch'
            self.state['kernel_before_launch'] = kernel_tasks(self.coalition_id)
            assert self.state['kernel_before_launch']['live'] == 1
            self.save()  # Birth/UID/coalition persisted before any exact stage argv can spawn.
            (self.scratch / 'go').touch()
            while not self.status().get('launch_complete'):
                assert identity(self.root['pid']) is not None, 'Worker lost during launch'
                time.sleep(.01)
        return self

    def members(self):
        assert self.coalition_id, 'No durable launch boundary'
        rows = coalition_members(self.coalition_id)
        for row in rows:
            old = self.known.get(str(row['pid']))
            if old is not None and old['birth'] != row['birth']:
                raise UnsafeCaptureGroup('Reused PID in station boundary')
            self.known[str(row['pid'])] = row
        return rows

    def status(self):
        file = self.scratch / 'worker.json'
        value = json.loads(file.read_text()) if file.exists() else {}
        self.state['exits'] = value.get('exits', {})
        current_root = identity(self.root['pid']) if self.root else None
        if self.root and (current_root is None or current_root['birth'] != self.root['birth']):
            missing = [role for role in ('capture', 'caffeinate') if role not in self.state['exits']]
            if missing:
                message = 'worker lost before direct exit receipts: ' + ','.join(missing)
                if message not in self.state['errors']:
                    self.state['errors'].append(message)
                self.state['exits'].update({role: 'UNKNOWN' for role in missing})
        self.save()
        return value

    def signal_pid(self, row, sig):
        pid = row['pid']
        assert pid > 0 and pid != os.getpid() and row['pgid'] != 3340
        info = identity(pid)
        if info is None:
            return
        ids = coalition(pid)
        if info['birth'] != row['birth'] or info['uid'] != os.getuid() or not ids or ids[0] != self.coalition_id:
            raise UnsafeCaptureGroup(f'Current kernel ownership refused PID{pid}')
        if info['status'] == 5:
            return  # Reaping is mandatory; a zombie is not absent.
        try:
            os.kill(pid, sig)
        except (PermissionError, ProcessLookupError):
            current = identity(pid)
            if current is not None:
                raise  # A live denied target is never silently accepted.
        self.state['signals'].append({'pid': pid, 'birth': row['birth'], 'signal': sig.name})
        self.save()

    def wait(self, seconds, observer=lambda: None):
        try:
            with deadline(seconds):
                while 'capture' not in self.status().get('exits', {}):
                    observer()
                    self.members()
                    time.sleep(.02)
                if self.state['exits']['capture'] == 'UNKNOWN':
                    return 'worker_lost'
            return 'completed'
        except DeadlineExpired:
            self.state['errors'].append('capture phase deadline expired')
            self.save()
            return 'timed_out'
        except Exception as error:
            self.state['errors'].append(f'{type(error).__name__}: {error}')
            self.save()
            return 'observer_failed'

    def drain(self, seconds=60, observer=lambda: None):
        started = time.monotonic()
        try:
            with deadline(seconds):
                observer()  # The independent outer phase timer covers blocking observation too.
                while not self.status().get('launch_complete') and identity(self.root['pid']) is not None:
                    time.sleep(.01)
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    until = started + seconds * (.35 if sig == signal.SIGTERM else .8)
                    while True:
                        self.status()  # Worker reaps and persists direct exits before root release.
                        children = [r for r in self.members() if r['pid'] != self.root['pid']]
                        root = identity(self.root['pid'])
                        pinned_root_live = root is not None and root['birth'] == self.root['birth'] and root['status'] != 5
                        tasks = kernel_tasks(self.coalition_id)
                        if not children and tasks['live'] == int(pinned_root_live):
                            break
                        if not children and tasks['live'] > int(pinned_root_live):
                            self.state.setdefault('incomplete_scan_receipts', []).append(
                                {'kernel': tasks, 'pinned_root_live': pinned_root_live})
                            self.save()
                        for row in children:
                            try:
                                self.signal_pid(row, sig)
                            except Exception as error:
                                self.state['errors'].append(f'{type(error).__name__}: {error}')
                        if time.monotonic() >= until:
                            break
                        time.sleep(.01)
                children = [r for r in self.members() if r['pid'] != self.root['pid']]
                root = identity(self.root['pid'])
                pinned_root_live = root is not None and root['birth'] == self.root['birth'] and root['status'] != 5
                self.state['kernel_before_root_release'] = kernel_tasks(self.coalition_id)
                # A classified PID scan is not emptiness proof: a descendant may replace
                # its parent during that scan. Only the owning kernel count can close it.
                if not children and self.state['kernel_before_root_release']['live'] == int(pinned_root_live):
                    (self.scratch / 'release').touch()
                    while kernel_tasks(self.coalition_id)['live'] or self.members() or any(
                        (now := identity(int(pid))) is not None and now['birth'] == old['birth']
                        for pid, old in self.known.items()
                    ):
                        time.sleep(.01)
                    self.status()
                    self.state['kernel_terminal'] = kernel_tasks(self.coalition_id)
                    self.state['drained'] = True
                self.state['remaining'] = self.members()
        except DeadlineExpired:
            self.state['errors'].append('cleanup phase deadline expired; release unproved')
        except Exception as error:
            self.state['errors'].append(f'{type(error).__name__}: {error}')
        self.state['elapsed_cleanup_seconds'] = time.monotonic() - started
        self.state['clean'] = self.state['drained'] and not self.state['errors']
        self.save()
        return self.state

    def archive(self):
        assert self.state['drained'], 'Do not remove proof or job while resources remain'
        result = subprocess.run(['/bin/launchctl', 'bootout', self.target], capture_output=True, text=True, timeout=3)
        check = subprocess.run(['/bin/launchctl', 'print', self.target], capture_output=True, text=True, timeout=3)
        assert check.returncode != 0, 'Owned job registration remains'
        write(self.out / 'unload.json', {'bootout_exit': result.returncode, 'stderr': result.stderr, 'registration_absent': True})
        for path in self.scratch.iterdir():
            if path.is_file():
                (self.out / path.name).write_bytes(path.read_bytes())
                path.unlink()
            elif path.name == '__pycache__':
                shutil.copytree(path, self.out / path.name)
                shutil.rmtree(path)
        self.scratch.rmdir()
        self.registered = False
        # Only profiles named by this exact owned launcher's log, after its whole coalition is absent.
        log = self.out / 'capture_stdout.txt'
        profiles = set(self.state.get('profiles', []))
        if log.exists():
            profiles.update(re.findall(r'--user-data-dir=([^\s\'\"]+)', log.read_text()))
        profiles = sorted(profiles)
        for name in profiles:
            path = Path(name)
            assert path.name.startswith('playwright_chromiumdev_profile-')
            if path.exists():
                shutil.copytree(path, self.out / ('preserved_' + path.name))
                shutil.rmtree(path)
        write(self.out / 'profile_release.json', {'owned_logged_profiles': profiles, 'all_absent': all(not Path(p).exists() for p in profiles)})


def worker(request_file):
    request = json.loads(Path(request_file).read_text())
    scratch = Path(request['scratch'])
    state = {'root': identity(os.getpid()), 'coalition': coalition(os.getpid()), 'exits': {}}
    write(scratch / 'worker.json', state)
    # No capture can escape registration: the root blocks until the external owner records its boundary.
    with deadline(15):
        while not (scratch / 'go').exists():
            if (scratch / 'release').exists():
                return
            time.sleep(.01)
    env = {k: os.environ[k] for k in ('HOME', 'TMPDIR', 'PATH') if k in os.environ}
    env.update(request['env'])
    with (scratch / 'capture_stdout.txt').open('w') as stream:
        capture = subprocess.Popen(request['argv'], cwd=request['cwd'], env=env,
            start_new_session=True, stdout=stream, stderr=subprocess.STDOUT)
        state['capture_launch_identity'] = identity(capture.pid)
        write(scratch / 'worker.json', state)
        caffeinate = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(capture.pid)], start_new_session=True)
        state['caffeinate_launch_identity'] = identity(caffeinate.pid)
        state['launch_complete'] = True  # No further direct children can spawn after this receipt.
        write(scratch / 'worker.json', state)
        while not (scratch / 'release').exists():
            for role, child in (('capture', capture), ('caffeinate', caffeinate)):
                code = child.poll()
                if code is not None and role not in state['exits']:
                    state['exits'][role] = code
                    write(scratch / 'worker.json', state)  # Immediately after reap, before cleanup.
            time.sleep(.01)
        for role, child in (('capture', capture), ('caffeinate', caffeinate)):
            state['exits'][role] = child.wait(timeout=1)
            write(scratch / 'worker.json', state)


if __name__ == '__main__':
    assert sys.argv[1] == '--worker'
    worker(sys.argv[2])
