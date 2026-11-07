import sys,subprocess,time,json,hashlib,os
from pathlib import Path
S=Path(__file__).resolve().parent
name,*cmd=sys.argv[1:]; start=time.time()
env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2','MKL_NUM_THREADS':'2','UV_THREADPOOL_SIZE':'2','NODE_COMPILE_CACHE':''}
with (S/(name+'.log')).open('x') as log:
 try:r=subprocess.run(cmd,cwd=S,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=60); code=r.returncode
 except subprocess.TimeoutExpired:code=124
record={'command':cmd,'cwd':str(S),'start':start,'end':time.time(),'exit':code,'log':name+'.log'}
(S/(name+'.receipt.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record));print((S/(name+'.log')).read_text()[-6000:]);sys.exit(code)
