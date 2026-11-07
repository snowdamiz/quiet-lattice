from pathlib import Path
import datetime,json,os,subprocess,time
root=Path.cwd();out=root/'assets/renders/characters/validate/ulgani5-launch-retirement';utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
job={'scope':'Bounded CPU-only retirement verification;no browser,GPU,Blender,render,bake,export or capture','controller_pid':os.getpid(),'controller_pgid':os.getpgrp(),'controller_sid':os.getsid(0),'start_utc':utc(),'commands':[],'recorded_processes':[],'live_jobs':[],'assertions_created':False}
seen={}
def snapshot():
 result=subprocess.run(['ps','-axo','pid=,ppid=,pgid=,lstart=,comm='],capture_output=True,text=True,check=True,timeout=3);rows={}
 for line in result.stdout.splitlines():
  a=line.strip().split(None,8)
  if len(a)==9:rows[int(a[0])]={'pid':int(a[0]),'ppid':int(a[1]),'pgid':int(a[2]),'fingerprint':' '.join(a[3:8]),'executable':a[8]}
 return rows
jobs=[('unit',['pnpm','exec','vitest','run','packages/client/src/characters/sharedRig.test.js','packages/client/src/dev/review.test.js','packages/tools/src/capture/classes.test.ts','--maxWorkers=1','--no-file-parallelism']),('client-typecheck',['pnpm','--filter','@astra/client','typecheck']),('tools-typecheck',['pnpm','--filter','@astra/tools','typecheck']),('lint',['pnpm','exec','eslint','packages/client/src/characters/sharedRig.js','packages/client/src/characters/sharedRig.test.js','packages/client/test/characters/loadActualRig.js','packages/client/src/dev/review.js','packages/client/src/dev/review.test.js','packages/tools/src/capture/capture.ts','packages/tools/src/capture/classes.ts','packages/tools/src/capture/classes.test.ts']),('retirement-bindings',['python3','assets/renders/characters/validate/ulgani5-launch-retirement/verify-retirement.py.txt']),('diff-check',['git','diff','--check','00eed30402686fd717d8dd84d09e409dfd093ec9'])]
env=dict(os.environ,OMP_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',SHARED_RIG_PROOF_PATH=str(out/'unit-actual-proof.json'))
for name,argv in jobs:
 entry={'name':name,'argv':argv,'started_utc':utc(),'log':str((out/(name+'.log.txt')).relative_to(root))};path=out/(name+'.log.txt')
 with path.open('w') as log:
  child=subprocess.Popen(argv,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);entry.update(pid=child.pid,pgid=os.getpgid(child.pid),sid=os.getsid(child.pid));deadline=time.monotonic()+120
  while child.poll() is None:
   rows=snapshot();owned={child.pid}
   while True:
    descendants={p for p,x in rows.items() if x['ppid'] in owned}
    if descendants<=owned:break
    owned|=descendants
   for pid in owned:
    if pid in rows:seen[(pid,rows[pid]['fingerprint'])]=rows[pid]
   if time.monotonic()>deadline:raise TimeoutError((name,child.pid))
   time.sleep(.05)
  entry['exit_code']=child.wait(timeout=2)
 entry['ended_utc']=utc();rows=snapshot();entry['recorded_group_rows_after_wait']=[x for x in rows.values() if x['pgid']==entry['pgid']];job['commands'].append(entry);job['recorded_processes']=list(seen.values());(out/'checks-job.json').write_text(json.dumps(job,indent=2)+'\n');print(name,entry['exit_code'],entry['started_utc'],entry['ended_utc'],flush=True)
 assert entry['exit_code']==0 and not entry['recorded_group_rows_after_wait'],entry
job['ended_utc']=utc();job['status']='PASS_CPU_CHECKS_ALL_COMMANDS_REAPED';job['recorded_processes']=list(seen.values());(out/'checks-job.json').write_text(json.dumps(job,indent=2)+'\n');print('CPU_CHECKS_END',job['ended_utc'],flush=True)
