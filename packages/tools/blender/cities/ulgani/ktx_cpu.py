#!/usr/bin/env python3
"""Serialize even stock-validator transcodes; cap the stock encoder's CPU threads at two."""

import fcntl
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[5]
with open(root / "assets/blend/cities/ulgani/.codec.lock", "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    args = sys.argv[1:]
    if "--threads" in args:
        args[args.index("--threads") + 1] = "2"
    started = time.time()
    result = subprocess.run([os.environ["ULGANI_KTX_REAL"], *args], check=False)
    if os.environ.get("ULGANI_CODEC_LOG"):
        with open(os.environ["ULGANI_CODEC_LOG"], "a") as journal:
            journal.write(
                json.dumps(
                    {
                        "args": args,
                        "started": started,
                        "ended": time.time(),
                        "exit": result.returncode,
                        "wrapperSHA256": hashlib.sha256(
                            Path(__file__).read_bytes()
                        ).hexdigest(),
                    }
                )
                + "\n"
            )
    sys.exit(result.returncode)
