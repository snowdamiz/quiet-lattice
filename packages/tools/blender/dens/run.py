"""One bounded CPU Blender job in the den lane; kills only its owned process group.

python3 .../dens/run.py --seconds 1800 --log /tmp/.../author.log -- -P .../dens/author.py
"""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys

p=argparse.ArgumentParser()
p.add_argument('--seconds',type=int,required=True)
p.add_argument('--log',type=Path,required=True)
p.add_argument('args',nargs=argparse.REMAINDER)
a=p.parse_args()
args=a.args[1:] if a.args and a.args[0]=='--' else a.args
env=dict(os.environ, OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', ART_KTX_JOBS='1')
a.log.parent.mkdir(parents=True,exist_ok=True)
with a.log.open('w') as log:
    child=subprocess.Popen(['/Applications/Blender.app/Contents/MacOS/Blender','-b','-t','2','--factory-startup','--python-exit-code','1',*args],
                           stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
    print(f'owned Blender pid={child.pid}; deadline={a.seconds}s; log={a.log}',flush=True)
    try:
        code=child.wait(timeout=a.seconds)
    except (subprocess.TimeoutExpired,KeyboardInterrupt):
        os.killpg(child.pid,signal.SIGTERM)
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL); child.wait()
        code=124
print('\n'.join(a.log.read_text().splitlines()[-20:]))
sys.exit(code)
