"""Run one owned Blender job with two threads and a finite process-group deadline.

python3 run_cpu.py LOG SECONDS /Applications/Blender.app/Contents/MacOS/Blender ...
"""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
log=sys.argv[1]; seconds=int(sys.argv[2]); cmd=sys.argv[3:]
assert 1<=seconds<=1800
assert Path(cmd[0]).name in ('Blender','blender')
assert '-t' in cmd and cmd[cmd.index('-t')+1]=='2'
lock_path=Path(__file__).resolve().parents[5]/'.claude/pause/P1-E05-T03/blender.lock'
lock_path.parent.mkdir(parents=True,exist_ok=True)
lock=lock_path.open('w')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
Path(log).parent.mkdir(parents=True,exist_ok=True)
env={**os.environ,'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2','ART_KTX_JOBS':'1'}
with open(log,'w') as f:
 p=subprocess.Popen(cmd,stdout=f,stderr=subprocess.STDOUT,env=env,start_new_session=True)
 print(f'owned pid={p.pid} deadline={seconds}s log={log}',flush=True)
 try: code=p.wait(timeout=seconds)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=8)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=124
 print(f'exit={code}',flush=True)
 sys.exit(code)
