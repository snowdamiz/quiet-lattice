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
    """Retired ancestry-only interface. It cannot establish a complete launch boundary."""
    def __init__(self, *args, **kwargs):
        raise UnsafeCaptureGroup("Sampled ancestry is not a release boundary; use the handshake-gated StationJob")
