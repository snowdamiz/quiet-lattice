"""Exercise the actual codec boundary's thread cap and cross-process exclusion."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
out=ROOT/'assets/blend/flora/trees/evidence'/('codec-test_'+time.strftime('%Y%m%dT%H%M%S'))
out.mkdir()
children=[]
with tempfile.TemporaryDirectory(prefix='codec-contract-',dir=out) as scratch:
    scratch=Path(scratch)
    fake=scratch/'observed_codec.py'
    fake.write_text('#!/usr/bin/env python3\nimport json,os,sys,time\nprint(json.dumps({"start":time.monotonic(),"pid":os.getpid(),"args":sys.argv[1:]}),flush=True)\ntime.sleep(.2)\nprint(json.dumps({"end":time.monotonic(),"pid":os.getpid()}),flush=True)\n')
    fake.chmod(0o755)
    env=os.environ.copy(); env.update(T04_KTX_REAL=str(fake),T04_CODEC_LOCK=str(scratch/'lock'))
    try:
        for _ in range(2):
            children.append(subprocess.Popen([sys.executable,str(HERE/'ktx_one.py'),'create','--threads','99'],env=env,stdout=subprocess.PIPE,text=True,start_new_session=True))
        events=[]
        for p in children:
            text,_=p.communicate(timeout=10)
            assert p.returncode==0
            events.append([json.loads(line) for line in text.splitlines()])
        events.sort(key=lambda pair:pair[0]['start'])
        for start,end in events:
            assert start['args']==['create','--threads','1']
            assert end['pid']==start['pid']
        assert events[1][0]['start']>=events[0][1]['end'],'codec executions overlapped'
    finally:
        for p in children:
            try: os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            p.wait(timeout=10)
with (out/'receipt.json').open('x') as f:
    json.dump({'command':['python3','packages/tools/blender/flora_trees/test_codec.py'],'exit':0,'events':events,'assertions':['threads99 becomes1 at actual exec','two concurrent callers execute serially under inherited lock'],'remaining_owned_children':[]},f,indent=2)
print('PASS: actual exec arguments capped to1; two callers serialized;',out.relative_to(ROOT))
