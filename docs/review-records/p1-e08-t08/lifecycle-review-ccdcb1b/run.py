import os,sys,json,time,subprocess,hashlib
from pathlib import Path
S=Path(__file__).resolve().parent; R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13')
label=sys.argv[1];command=sys.argv[2:];env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','GIT_OPTIONAL_LOCKS':'0','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','VECLIB_MAXIMUM_THREADS':'1'}
start=time.time();samples=[];failure=None
with (S/(label+'.log')).open('x') as log:
 p=subprocess.Popen(command,cwd=R,env=env,stdout=log,stderr=subprocess.STDOUT)
 while p.poll() is None:
  q=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss=,args='],capture_output=True,text=True,timeout=3)
  rows=[x.split(None,3) for x in q.stdout.splitlines() if len(x.split(None,3))==4]
  ids={p.pid}
  while True:
   add={int(x[0]) for x in rows if int(x[1]) in ids}-ids
   if not add:break
   ids.update(add)
  owned=[x for x in rows if int(x[0]) in ids or (str(S) in x[3] and ('lifecycle_worker.py' in x[3] or 'independent_worker.py' in x[3]))]
  rss=sum(int(x[2])*1024 for x in owned)
  samples.append(dict(time=time.time(),rss=rss,processes=owned))
  if time.time()-start>150 or rss>240*1024**2:
   failure='outer time/RSS bound';p.terminate();break
  time.sleep(.1)
 code=p.wait(timeout=10)
result=dict(command=command,cwd=str(R),start=start,end=time.time(),exit=code,limitFailure=failure,maxSampledRSS=max((x['rss'] for x in samples),default=0),samples=samples,tail=(S/(label+'.log')).read_text(errors='replace').splitlines()[-20:])
with (S/(label+'.receipt.json')).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in result.items() if k!='samples'}))
sys.exit(code)
