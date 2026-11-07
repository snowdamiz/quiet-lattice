"""Reap this lane's isolated process group even if its supervisor is interrupted."""
import json,os,signal,subprocess,sys,time
from pathlib import Path
owner,group,limit=int(sys.argv[1]),int(sys.argv[2]),float(sys.argv[3]);receipt=Path(sys.argv[4]);start=time.monotonic();reason=None
def members():
    rows=subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,command='],text=True)
    return [{'pid':int(v[0]),'ppid':int(v[1]),'pgid':int(v[2]),'command':v[3]} for line in rows.splitlines() if len(v:=line.strip().split(None,3))==4 and int(v[2])==group]
def send(sig):
    if not members():return
    try:os.killpg(group,sig)
    except ProcessLookupError:pass
first=members()
while members():
    if os.getppid()!=owner:reason='supervisor exited'
    if time.monotonic()-start>limit:reason='wall limit'
    if reason:
        send(signal.SIGTERM)
        for _ in range(20):
            if not members():break
            time.sleep(.25)
        if members():send(signal.SIGKILL)
        break
    time.sleep(.25)
remaining=members()
with receipt.open('x') as f:json.dump({'owner_pid':owner,'process_group':group,'first_members':first,'termination_reason':reason,'remaining_members':remaining,'elapsed_seconds':time.monotonic()-start},f,indent=2);f.write('\n')
assert not remaining,remaining
