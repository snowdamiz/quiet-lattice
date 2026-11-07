#!/usr/bin/env python3
"""Task-local encoder wrapper: keep KTX subprocesses at two threads too."""
import os
import sys

args=sys.argv[1:]
if '--threads' in args:
    args[args.index('--threads')+1]='2'
binary=os.environ['EFFECTS_KTX_BINARY']
os.execv(binary,[binary,*args])
