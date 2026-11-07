#!/usr/bin/env python3
"""Bound the stock encoder's per-image threads without changing shared pipeline code."""
import os,sys
real='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx'
args=sys.argv[1:]
if '--threads' in args:args[args.index('--threads')+1]='2'
os.execv(real,[real,*args])
