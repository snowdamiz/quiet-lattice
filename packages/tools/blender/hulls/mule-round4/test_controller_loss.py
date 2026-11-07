"""SIGKILL the real foreground controller; its isolated owner must settle children."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from run import EVIDENCE,group_alive
attempt='controller-loss-a'
out=EVIDENCE/attempt
assert not out.exists()
code="import subprocess,sys,time,signal,os,json;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(120)']);print(json.dumps({'leader':os.getpid(),'grandchild':p.pid}),flush=True);time.sleep(120)"
command=[sys.executable,str(HERE/'run.py'),'--wall','45',attempt,'--',sys.executable,'-c',code]
controller=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
try:
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        log=out/'output.log'
        if log.exists() and log.stat().st_size:break
        if controller.poll() is not None:raise RuntimeError(controller.communicate()[0])
        time.sleep(.1)
    else:raise RuntimeError('child launch timeout')
    child=json.loads(log.read_text().splitlines()[0]);started=json.loads((out/'started.json').read_text())
    killed=time.monotonic();controller.kill();assert controller.wait(timeout=3)==-signal.SIGKILL
    deadline=killed+30
    while time.monotonic()<deadline:
        receipt=out/'receipt.json'
        if receipt.exists() and not Path('/tmp/p1-e12-t02-mule-r4.cpu.ownership').exists():break
        time.sleep(.1)
    else:raise RuntimeError('supervisor failed finite settlement')
    r=json.loads(receipt.read_text())
    assert r['status']=='FAIL' and r['reason']=='controller lost',r
    assert r['leader_reaped'] and r['remaining_group']==[] and not r['cleanup_errors'],r
    assert not group_alive(started['pgid'])
    for pid in child.values():
        try:os.kill(pid,0)
        except ProcessLookupError:pass
        else:raise AssertionError(('child remains',pid))
    result={'status':'PASS','command':command,'controller_exit':controller.returncode,'controller_waitpid':True,'supervisor_pid':started['supervisor_pid'],'workload_leader_waitpid_by_supervisor':r['leader_reaped'],'descendants':'observed absent, no waitpid claim for adopted grandchildren','settlement_seconds':time.monotonic()-killed,'primary_error':r['reason'],'remaining_group':r['remaining_group']}
    with (EVIDENCE/'controller-loss-test.json').open('x') as f:json.dump(result,f,indent=2)
    print(json.dumps(result,indent=2),flush=True)
finally:
    if controller.poll() is None:controller.terminate();controller.wait(timeout=35)
