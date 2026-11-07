#!/usr/bin/env python3
"""Limit the unchanged shared encoder to two codec threads."""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[5]
binary = root / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"
args = sys.argv[1:]
if "--threads" in args:
    args[args.index("--threads") + 1] = "2"
elif args and args[0] == "create":
    args[1:1] = ["--threads", "2"]
os.execv(str(binary), [str(binary), *args])
