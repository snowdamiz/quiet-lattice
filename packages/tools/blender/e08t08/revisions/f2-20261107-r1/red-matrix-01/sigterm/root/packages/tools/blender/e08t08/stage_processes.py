"""macOS process ownership: unreaped direct child and watched descendants.

No PID/command-name adoption after restart. An abandoned admission stays closed.
"""
import ctypes
import errno
import os
import select
import signal
import subprocess


class BSDInfo(ctypes.Structure):
    # sys/proc_info.h, PROC_PIDTBSDINFO. The start pair survives exec and separates
    # PID reuse; kqueue watches the process instance, not a later reused PID.
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid',
        'rgid', 'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in (
        'nfiles', 'pgid', 'jobc', 'tdev', 'tpgid', 'nice')]
    _fields_ += [('start_sec', ctypes.c_uint64), ('start_usec', ctypes.c_uint64)]


LIBPROC = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
LIBPROC.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
LIBPROC.proc_pidinfo.restype = ctypes.c_int


def identity(pid):
    info = BSDInfo()
    count = LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if count == 0 and ctypes.get_errno() in (errno.ESRCH, errno.ENOENT):
        return None
    if count != ctypes.sizeof(info) or info.pid != pid:
        raise OSError(ctypes.get_errno(), 'cannot identify owned process', pid)
    return (int(info.start_sec), int(info.start_usec))


def snapshot():
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid=,rss=,comm='],
                            capture_output=True, text=True, check=True, timeout=2)
    rows = []
    for line in result.stdout.splitlines():
        a = line.split(None, 4)
        if len(a) != 5:
            raise RuntimeError('incomplete process observation')
        rows.append(dict(pid=int(a[0]), ppid=int(a[1]), pgid=int(a[2]),
                         rss=int(a[3]) * 1024, command=a[4]))
    return rows


class ProcessWatch:
    def __init__(self, pid):
        self.pid = pid
        self.birth = identity(pid)
        self.queue = select.kqueue()
        self.ended = self.birth is None
        try:
            if not self.ended:
                self.queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                    fflags=select.KQ_NOTE_EXIT)], 0, 0)
                if identity(pid) != self.birth:
                    raise RuntimeError('process changed while acquiring watch')
        except ProcessLookupError:
            self.ended = True
        except BaseException:
            self.queue.close()
            raise

    def exited(self):
        if not self.ended:
            self.ended = bool(self.queue.control([], 1, 0))
        return self.ended

    def send(self, sig):
        if self.exited():
            return
        if identity(self.pid) != self.birth:
            raise RuntimeError('owned process identity changed; refusing signal')
        try:
            os.kill(self.pid, sig)
        except ProcessLookupError:
            self.ended = True

    def evidence(self):
        return dict(pid=self.pid, birth=self.birth, exitObserved=self.exited())


class OwnedProcesses:
    def __init__(self, child):
        self.child = child  # Retain the actual Popen through every error path.
        self.birth = identity(child.pid)
        self.watches = {}
        self.retired = []
        self.last = []

    def leader_exited(self):
        # WNOWAIT retains the actual child and reserves its PID/process-group
        # identity until every known descendant is terminal. poll() would reap.
        return os.waitid(os.P_PID, self.child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None

    def observe(self):
        rows = snapshot()
        ids = {self.child.pid}
        ids.update(pid for pid, watch in self.watches.items() if not watch.exited())
        ids.update(p['pid'] for p in rows if p['pgid'] == self.child.pid)
        while True:
            added = {p['pid'] for p in rows if p['ppid'] in ids} - ids
            if not added:
                break
            ids.update(added)
        owned = [p for p in rows if p['pid'] in ids]
        for row in owned:
            pid = row['pid']
            if pid in self.watches and self.watches[pid].exited():
                watch = self.watches[pid]
                if identity(pid) not in (None, watch.birth):
                    self.retired.append(watch.evidence())
                    watch.queue.close()
                    del self.watches[pid]
            if pid != self.child.pid and pid not in self.watches:
                self.watches[pid] = ProcessWatch(pid)
        self.last = owned
        return owned

    def signal_all(self, sig):
        # The direct child is deliberately not reaped, even after leader exit.
        # Its reserved PID anchors this group. Detached known children also have
        # individual instance watches, so group termination alone is insufficient.
        if identity(self.child.pid) != self.birth:
            raise RuntimeError('direct-child ownership lost; refusing group signal')
        try:
            os.killpg(self.child.pid, sig)
        except ProcessLookupError:
            pass
        for watch in self.watches.values():
            watch.send(sig)

    def all_exited(self):
        return self.leader_exited() and all(w.exited() for w in self.watches.values())

    def evidence(self):
        return dict(directChild=dict(pid=self.child.pid, birth=self.birth),
                    knownDescendants=self.retired + [w.evidence() for w in self.watches.values()])

    def close(self):
        for watch in self.watches.values():
            watch.queue.close()
