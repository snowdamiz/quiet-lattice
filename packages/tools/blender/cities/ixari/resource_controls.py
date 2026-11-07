"""Exercise the actual CPU lane's timeout, exclusive receipt and scratch-file race handling."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[5]
TASK=ROOT/'assets/blend/cities/ixari'
RUN=[sys.executable,str(ROOT/'packages/tools/blender/cities/ixari/run_cpu.py')]
results=[]


def run(name,seconds,code):
    proc=subprocess.run(RUN+['--attempt',name,'--seconds',str(seconds),'--',sys.executable,'-c',code],
                        cwd=ROOT,capture_output=True,text=True,timeout=20)
    receipt=json.loads((TASK/'receipts'/name/'process.json').read_text())
    return proc,receipt


proc,receipt=run('control-timeout-r1',1,'import time; time.sleep(10)')
assert proc.returncode==124 and receipt['stoppedBy']=='wall limit' and receipt['reaped']
assert 'SIGINT' in receipt['signals']
results.append(dict(control='timeout interrupts and reaps before releasing lock',status='PASS',receipt=receipt))
lock=(TASK/'.cpu-lane.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
proc,receipt=run('control-lock-r1',5,'raise RuntimeError("must never run")')
assert proc.returncode==124 and 'BlockingIOError' in receipt['stoppedBy'] and receipt['exitCode'] is None
lock.close()
results.append(dict(control='second lane owner is rejected before launch',status='PASS',receipt=receipt))
code='''from pathlib import Path
import time
p=Path("assets/blend/cities/ixari/receipts/control-churn-r1/scratch.txt")
end=time.monotonic()+2
while time.monotonic()<end:
    p.write_bytes(b"cpu scratch"*100)
    p.unlink()
'''
proc,receipt=run('control-churn-r1',10,code)
assert proc.returncode==0 and receipt['reaped'] and receipt['stoppedBy'] is None
results.append(dict(control='scratch create/delete race survives monitoring',status='PASS',receipt=receipt))
old=(TASK/'receipts/control-churn-r1/process.json').read_bytes()
proc=subprocess.run(RUN+['--attempt','control-churn-r1','--seconds','5','--',sys.executable,'-c','pass'],
                    cwd=ROOT,capture_output=True,text=True,timeout=10)
assert proc.returncode!=0 and 'FileExistsError' in proc.stderr
assert old==(TASK/'receipts/control-churn-r1/process.json').read_bytes()
results.append(dict(control='existing receipt cannot be overwritten',status='PASS',failureTail=proc.stderr.splitlines()[-20:]))
out=TASK/'receipts/resource-controls.json'
with out.open('x') as f:json.dump(results,f,indent=2);f.write('\n')
print('PASS: timeout, lane lock, scratch churn, exclusive receipt')
