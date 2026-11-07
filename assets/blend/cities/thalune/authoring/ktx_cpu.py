#!/usr/bin/env python3
"""Task-local adapter: bound the stock encoder's --threads on this shared CPU lane."""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[5]
binary = root / "node_modules/.cache/ktx-software-4.4.2/bin/ktx"
args = list(sys.argv[1:])
if "--threads" in args:
    args[args.index("--threads") + 1] = "2"
os.execv(str(binary), [str(binary), *args])
