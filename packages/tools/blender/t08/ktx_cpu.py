#!/usr/bin/env python3
"""Resource wrapper only: run the stock pinned codec with one encoding thread."""

import os
import fcntl
from pathlib import Path
import sys

args = sys.argv[1:]
codec_lock = open("/tmp/space-t08-ktx.lock", "a")
fcntl.flock(codec_lock, fcntl.LOCK_EX)
os.set_inheritable(codec_lock.fileno(), True)
if "--threads" in args:
    args[args.index("--threads") + 1] = "1"
tool = (
    Path(__file__).resolve().parents[4]
    / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"
)
os.execv(str(tool), [str(tool), *args])
