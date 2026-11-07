"""Real process-boundary probes for cancellation, timeout, and exclusive evidence."""
import json
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[5]
RUN=Path(__file__).with_name('run.py')
OUT=ROOT/'assets/renders/hulls/mule-round4-current'
OWN=Path('/tmp/p1-e12-t02-mule-r4.cpu.ownership')

def check(mode):
    attempt='runner-held-contention' if mode=='contention' else 'runner-supervised-b-'+mode
    assert not (OUT/attempt).exists()
    if mode=='contention':
        # Hold the actual lane lock here; do not race an unrelated workload's exit.
        with open('/tmp/p1-e12-t02-mule-r4.cpu.lock','a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result=subprocess.run([sys.executable,str(RUN),attempt,'--','/usr/bin/true'],capture_output=True,text=True,timeout=10)
            assert result.returncode!=0 and not (OUT/attempt).exists()
            proof={'mode':mode,'exit':result.returncode,'log_created':False,'held_actual_lane_lock':True,'tail':result.stderr.splitlines()[-5:]}
            with (OUT/'contention-proof.json').open('x') as f:json.dump(proof,f,indent=2)
            return proof
    # The grandchild ignores TERM; the lane must escalate and reap its direct parent.
    code="import subprocess,sys,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(120)']); print('CHILD_READY',flush=True); time.sleep(120)"
    p=subprocess.Popen([sys.executable,str(RUN),'--wall','3' if mode=='timeout' else '45',attempt,'--',sys.executable,'-c',code],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        log=OUT/attempt/'output.log'
        if log.exists() and 'CHILD_READY' in log.read_text():break
        if p.poll() is not None:raise RuntimeError(p.communicate()[0])
        time.sleep(.1)
    else: p.terminate();raise RuntimeError('start deadline')
    if mode=='sigterm':p.send_signal(signal.SIGTERM)
    elif mode=='repeated-sigint':
        for _ in range(3):p.send_signal(signal.SIGINT);time.sleep(.15)
    output=p.communicate(timeout=30)[0]
    receipt=json.loads((OUT/attempt/'receipt.json').read_text())
    assert p.returncode==1 and receipt['status']=='FAIL' and receipt['remaining_group']==[] and not OWN.exists(),(output,{k:receipt.get(k) for k in ['status','exit','reason','remaining_group','leader_reaped','cleanup_errors']})
    return {'mode':mode,'exit':p.returncode,'reaped':True,'remaining_group':receipt['remaining_group'],'reason':receipt['reason']}

mode=sys.argv[1]
if mode=='suite':
    results=[]
    for case in ['sigterm','repeated-sigint','timeout']:
        result=check(case);results.append(result);print(json.dumps(result),flush=True)
    with (OUT/'runner-supervised-b-suite.json').open('x') as f:json.dump(results,f,indent=2)
else:
    print(json.dumps(check(mode),indent=2))
