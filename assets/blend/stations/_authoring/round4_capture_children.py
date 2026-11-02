"""Owned child lifecycle for the station round-four capture controller, on macOS."""
import ctypes
import errno
import os
import signal
import subprocess
import time


class UnsafeCaptureGroup(RuntimeError):
    pass


class BsdInfo(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in ("flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid", "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
    _fields_ += [(n, ctypes.c_uint32) for n in ("nfiles", "pgid", "jobc", "tdev", "tpgid")]
    _fields_ += [("nice", ctypes.c_int32), ("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64)]


LIBPROC = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
LIBPROC.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
LIBPROC.proc_pidinfo.restype = ctypes.c_int


def identity(pid):
    if pid <= 0:
        raise UnsafeCaptureGroup(f"Invalid PID {pid}")
    data = BsdInfo()
    ctypes.set_errno(0)
    count = LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(data), ctypes.sizeof(data))
    if count == 0 and ctypes.get_errno() == errno.ESRCH:
        return None
    if count != ctypes.sizeof(data):
        raise OSError(ctypes.get_errno(), f"proc_pidinfo({pid}) returned {count}")
    return {"pid": data.pid, "ppid": data.ppid, "pgid": data.pgid, "birth": [data.start_sec, data.start_usec],
            "status": data.status, "uid": data.uid}


def process_rows():
    rows = []
    result = subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,stat=,command="], text=True, timeout=3)
    for line in result.splitlines():
        p = line.strip().split(None, 4)
        if len(p) == 5:
            rows.append({"pid": int(p[0]), "ppid": int(p[1]), "pgid": int(p[2]), "stat": p[3], "command": p[4]})
    return rows


class CaptureChildren:
    def __init__(self, direct, state, persist=lambda: None, snapshot=process_rows, group_signal=os.killpg, pid_signal=os.kill):
        self.direct = direct
        self.state = state
        self.persist = persist
        self.snapshot = snapshot
        self.group_signal = group_signal
        self.pid_signal = pid_signal
        self.known = {}
        self.groups = set()
        for key, default in (("exits", {}), ("events", []), ("signals", []), ("errors", [])):
            state.setdefault(key, default)
        self.poll_exits()
        for child in direct.values():
            if child.returncode is None:
                info = identity(child.pid)
                if info is not None:
                    self.register(info)
        self.save()

    def save(self):
        try:
            self.persist()
        except Exception as error:
            message = f"Persistence failed: {type(error).__name__}: {error}"
            if message not in self.state["errors"]:
                self.state["errors"].append(message)

    def event(self, kind, **values):
        self.state["events"].append({"kind": kind, "monotonic": time.monotonic(), **values})
        self.save()

    def error(self, error):
        message = f"{type(error).__name__}: {error}"
        if message not in self.state["errors"]:
            self.state["errors"].append(message)
            self.save()

    def poll_exits(self):
        for role, child in self.direct.items():
            code = child.poll()
            if code is not None and role not in self.state["exits"]:
                # Persist immediately after poll/wait reaps, before any observer or signal operation.
                self.state["exits"][role] = code
                self.event("direct_child_reaped", role=role, pid=child.pid, exit=code)
        return dict(self.state["exits"])

    def register(self, info):
        self.check_group_number(info["pgid"])
        if info["uid"] != os.getuid():
            raise UnsafeCaptureGroup(f"Foreign UID for owned PID {info['pid']}")
        old = self.known.get(info["pid"])
        if old is not None and old["birth"] != info["birth"]:
            raise UnsafeCaptureGroup(f"Reused PID {info['pid']}")
        self.known[info["pid"]] = info
        self.groups.add(info["pgid"])

    def add_direct(self, role, child):
        self.direct[role] = child
        self.poll_exits()
        if child.returncode is None:
            info = identity(child.pid)
            if info is not None:
                self.register(info)
        self.save()

    def watch(self, seconds, observe, interval=0.5):
        deadline = time.monotonic() + seconds
        while "capture" not in self.poll_exits():
            if time.monotonic() >= deadline:
                self.event("capture_timeout", seconds=seconds)
                return "timed_out"
            try:
                observe()
            except Exception as error:
                self.error(error)
                self.poll_exits()
                return "observer_failed"
            self.poll_exits()
            time.sleep(min(interval, max(0, deadline - time.monotonic())))
        return "completed"

    @staticmethod
    def check_group_number(pgid):
        if pgid <= 0 or pgid in (3340, os.getpgrp()):
            raise UnsafeCaptureGroup(f"Refuse invalid or protected group {pgid}")

    def current(self, pid):
        info = identity(pid)
        if info is None:
            return None
        old = self.known.get(pid)
        if old is None or old["birth"] != info["birth"] or old["uid"] != info["uid"]:
            raise UnsafeCaptureGroup(f"Unowned or reused PID {pid}")
        return info

    def refresh(self):
        for attempt in range(3):
            self.poll_exits()
            rows = self.snapshot()
            verified = set()
            for row in rows:
                if row["pid"] in self.known and self.current(row["pid"]) is not None:
                    verified.add(row["pid"])
            changed = True
            while changed:
                changed = False
                for row in rows:
                    if row["pid"] not in verified and row["ppid"] in verified:
                        info = identity(row["pid"])
                        if info is not None:
                            self.register(info)
                            verified.add(row["pid"])
                            changed = True
            unknown = [r["pid"] for r in rows if r["pgid"] in self.groups and r["pid"] not in verified]
            if not unknown:
                return [row for row in rows if row["pid"] in verified]
            if all(pid in self.known and self.current(pid) is None for pid in unknown):
                # A sampled process exited before the identity read. Reap and require a fresh snapshot.
                self.event("observer_exit_race_recheck", pids=unknown, attempt=attempt)
                continue
            raise UnsafeCaptureGroup(f"Unverified members in capture groups: {unknown}")
        raise UnsafeCaptureGroup(f"Unverified members persisted after fresh snapshots: {unknown}")

    def members(self, pgid):
        self.check_group_number(pgid)
        if pgid not in self.groups:
            raise UnsafeCaptureGroup(f"Unknown capture group {pgid}")
        self.poll_exits()
        rows = [r for r in self.snapshot() if r["pgid"] == pgid]
        for row in rows:
            info = self.current(row["pid"])
            if info is None:
                continue  # Exited between the snapshot and kernel identity read. Refresh before signalling.
            if info["pgid"] != pgid:
                raise UnsafeCaptureGroup(f"Group membership changed for PID {row['pid']}")
        # A second snapshot closes the snapshot/identity-read gap without treating an unknown member as owned.
        latest = [r for r in self.snapshot() if r["pgid"] == pgid]
        for row in latest:
            info = self.current(row["pid"])
            if info is not None and info["pgid"] != pgid:
                raise UnsafeCaptureGroup(f"Group membership changed for PID {row['pid']}")
        return latest

    def signal_group(self, pgid, sig):
        self.poll_exits()
        rows = self.members(pgid)
        if not rows:
            self.event("verified_group_drained", pgid=pgid)
            return
        if all(r["stat"].startswith("Z") for r in rows):
            self.event("exited_members_await_reap", pgid=pgid, pids=[r["pid"] for r in rows])
            return  # Retained as remaining until actually reaped; never reported drained here.
        self.event("verified_group_signal_attempt", pgid=pgid, signal=sig.name, pids=[r["pid"] for r in rows])
        try:
            self.group_signal(pgid, sig)
        except (PermissionError, ProcessLookupError):
            self.poll_exits()
            if not self.members(pgid):
                self.event("signal_exit_race_group_drained", pgid=pgid, signal=sig.name)
                return
            raise
        self.state["signals"].append({"pgid": pgid, "signal": sig.name})
        self.save()

    def signal_pid(self, pid, sig):
        self.poll_exits()
        info = self.current(pid)
        if info is None:
            return
        if pid <= 0 or pid == os.getpid():
            raise UnsafeCaptureGroup(f"Refuse invalid PID {pid}")
        if info["status"] == 5:
            self.event("exited_pid_await_reap", pid=pid)
            return
        self.event("verified_pid_signal_attempt", pid=pid, birth=info["birth"], signal=sig.name)
        try:
            self.pid_signal(pid, sig)
        except (PermissionError, ProcessLookupError):
            self.poll_exits()
            if self.current(pid) is None:
                self.event("signal_exit_race_pid_drained", pid=pid)
                return
            raise
        self.state["signals"].append({"pid": pid, "signal": sig.name})
        self.save()

    def remaining(self):
        try:
            return self.refresh(), True
        except Exception as error:
            self.error(error)
            found = []
            for pid in self.known:
                try:
                    info = self.current(pid)
                    if info is not None:
                        found.append({**info, "stat": "Z" if info["status"] == 5 else "?", "command": "kernel identity fallback"})
                except Exception as inner:
                    self.error(inner)
            return found, False

    def drain(self, seconds=60):
        deadline = time.monotonic() + seconds
        natural_end = min(deadline, time.monotonic() + min(3, seconds / 4))
        active, observed = self.remaining()
        while active and time.monotonic() < natural_end:
            time.sleep(0.02)
            active, observed = self.remaining()
        for sig in (signal.SIGTERM, signal.SIGKILL):
            active, observed = self.remaining()
            if not active:
                break
            if observed:
                for pgid in sorted({r["pgid"] for r in active}):
                    try:
                        self.signal_group(pgid, sig)
                    except Exception as error:
                        self.error(error)  # Continue draining every other known owned group.
            else:
                for row in active:
                    try:
                        self.signal_pid(row["pid"], sig)
                    except Exception as error:
                        self.error(error)
            until = min(deadline, time.monotonic() + max(0, (deadline - time.monotonic()) / (2 if sig == signal.SIGTERM else 1)))
            while active and time.monotonic() < until:
                time.sleep(0.02)
                active, observed = self.remaining()
        self.poll_exits()
        active, observed = self.remaining()
        self.state.update(remaining=active, snapshot_verified=observed, drained=not active and observed,
                          clean=not active and observed and not self.state["errors"],
                          identities={str(pid): info for pid, info in self.known.items()}, groups=sorted(self.groups))
        self.save()
        return self.state
