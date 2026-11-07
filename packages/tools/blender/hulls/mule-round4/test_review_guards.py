"""Real process tests for teardown-probe failure and completed-child bounds."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import run
OUT=run.EVIDENCE
OWN=Path('/tmp/p1-e12-t02-mule-r4.cpu.ownership')
results=[]
for mode in ['probe-failure','completed-wall','completed-images','completed-output']:
    attempt='runner-review-v2-'+mode
    opts=[]
    if mode=='probe-failure':
        child="import subprocess,sys,time,signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(120)']);print('CHILD_READY',flush=True);time.sleep(120)"
        wrapper="import sys;sys.path.insert(0,sys.argv.pop(1));import run;original=run.resources\ndef fail():\n p=run.EVIDENCE/sys.argv[1]/'output.log'\n if p.exists() and 'CHILD_READY' in p.read_text():raise RuntimeError('injected resource probe failure')\n return original()\nrun.resources=fail\nsys.exit(run.main())"
        prefix=[sys.executable,'-c',wrapper,str(HERE)]
    else:
        prefix=[sys.executable,str(HERE/'run.py')]
        child='import time;time.sleep(.25)'
    if mode=='completed-wall':opts=['--wall','1']
    if mode=='completed-images':
        count=sum(p.suffix.lower() in ['.png','.jpg','.jpeg','.webp'] for p in OUT.rglob('*') if p.is_file() and 'scratch' not in p.relative_to(OUT).parts)
        opts=['--image-limit',str(count+1)]
        child+=";import base64,os;from pathlib import Path;data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=');[(Path(os.environ['MULE_ATTEMPT'])/('fixture%d.png'%i)).write_bytes(data) for i in range(2)]"
    if mode=='completed-output':
        size=sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file() and 'scratch' not in p.relative_to(OUT).parts)
        opts=['--evidence-mib',str(math.ceil(size/1024**2)+1)]
        child+=";import os;from pathlib import Path;(Path(os.environ['MULE_ATTEMPT'])/'output-fixture.txt').write_text('x'*(2*1024**2))"
    cmd=prefix+opts+[attempt,'--',sys.executable,'-c',child]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=50)
    receipt=json.loads((OUT/attempt/'receipt.json').read_text())
    assert p.returncode==1 and receipt['status']=='FAIL',receipt
    assert receipt['leader_reaped'] and receipt['remaining_group']==[] and not OWN.exists(),receipt
    assert ('probe failure' in receipt['reason'] if mode=='probe-failure' else 'wall limit' in receipt['reason'] if mode=='completed-wall' else 'image/evidence limit' in receipt['reason']),receipt
    if mode!='probe-failure':assert receipt['exit']==0,receipt
    results.append({'test':mode,'rejected':True,'command':cmd,'runner_exit':p.returncode,'child_exit':receipt['exit'],'reason':receipt['reason'],'remaining_group':receipt['remaining_group']})
    print(json.dumps(results[-1]),flush=True)
with (OUT/'runner-review-v2-suite.json').open('x') as f:json.dump(results,f,indent=2)
