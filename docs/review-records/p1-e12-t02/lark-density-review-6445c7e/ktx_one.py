#!/usr/bin/env python3
"""Run the real ktx binary with an exclusive lock so only one codec process runs."""
import fcntl
import os
import sys

lock_path = os.environ["LARK_KTX_LOCK"]
real = os.environ["LARK_KTX_REAL"]
fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
fcntl.flock(fd, fcntl.LOCK_EX)
os.execv(real, [real, *sys.argv[1:]])
