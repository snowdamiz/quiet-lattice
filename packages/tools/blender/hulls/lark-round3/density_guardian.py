"""Register before dispatch, then monitor/reap only the assigned process group."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

owner,group=int(sys.argv[1]),int(sys.argv[2])
limit=float(sys.argv[3]);receipt=Path(sys.argv[4]);registration=Path(sys.argv[5])
started=time.monotonic();reason=None;first=[];remaining=[]

def members():
    rows=subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,command='],text=True,timeout=5)
    return [{'pid':int(v[0]),'ppid':int(v[1]),'pgid':int(v[2]),'command':v[3]} for row in rows.splitlines()
            if len(v:=row.strip().split(None,3))==4 and int(v[2])==group]

def send(sig):
    if not members():return
    try:os.killpg(group,sig)
    except ProcessLookupError:pass

try:
    first=members()
    assert any(p['pid']==group and 'density_dispatch.py' in p['command'] for p in first),first
    with registration.open('x') as f:
        json.dump({'guardian_pid':os.getpid(),'guardian_group':os.getpgrp(),'owner_pid':owner,
                   'process_group':group,'first_members':first,'registered_before_dispatch':True},f,indent=2)
    while members():
        if os.getppid()!=owner:reason='supervisor exited'
        if time.monotonic()-started>limit:reason='guardian wall limit'
        if reason:break
        time.sleep(.1)
except BaseException as e:
    reason=reason or f'guardian error: {type(e).__name__}: {e}'
finally:
    if reason:
        send(signal.SIGTERM)
        deadline=time.monotonic()+5
        while members() and time.monotonic()<deadline:time.sleep(.1)
        if members():send(signal.SIGKILL)
    deadline=time.monotonic()+5
    while members() and time.monotonic()<deadline:time.sleep(.1)
    remaining=members()
    with receipt.open('x') as f:
        json.dump({'guardian_pid':os.getpid(),'guardian_group':os.getpgrp(),'owner_pid':owner,
                   'process_group':group,'first_members':first,'termination_reason':reason,
                   'remaining_members':remaining,'elapsed_seconds':time.monotonic()-started},f,indent=2)
assert not remaining,remaining
