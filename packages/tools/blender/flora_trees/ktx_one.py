#!/usr/bin/env python3
"""KTX process boundary: keep stock codec settings, enforce the lane's one-thread cap."""
import os
import sys
import fcntl

args=sys.argv[1:]
if args and args[0]=='create':
    index=args.index('--threads') if '--threads' in args else None
    if index is None:
        args+=['--threads','1']
    else:
        args[index+1]='1'
binary=os.environ['T04_KTX_REAL']
# Stock decode submits two workers even with ART_KTX_JOBS=1. Keep the lock through
# exec so only one actual codec runs; process exit or lane cleanup releases it.
lock=open(os.environ['T04_CODEC_LOCK'],'a')
fcntl.flock(lock,fcntl.LOCK_EX)
os.set_inheritable(lock.fileno(),True)
os.execv(binary,[binary,*args])
