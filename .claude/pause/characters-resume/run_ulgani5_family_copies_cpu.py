from pathlib import Path
import datetime,hashlib,json,os,signal,subprocess,sys,time,traceback
root=Path.cwd();base=root/'.claude/pause/characters-resume';label=sys.argv[1];commands=json.loads(Path(sys.argv[2]).read_text());utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert str(root)=='/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git','branch','--show-current'],text=True).strip()=='task/P1-E05-T01'
assert not (base/'gpu-release-ulgani5-bake').exists()
job_path=base/('ulgani5-'+label+'-job.json');assert not job_path.exists();out=base/'ulgani5-review-cache';out.mkdir(exist_ok=True)
frozen=json.loads((base/'ulgani5-head2-retry2-stage-job.json').read_text())['frozen_canonical_hashes'];frozen['assets/blend/characters/ulgani.blend']='06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b';frozen['packages/client/public/models/characters/ulgani.glb']='9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682';assert all(sha(root/p)==h for p,h in frozen.items())
j={'start_utc':utc(),'controller_pid':os.getpid(),'controller_pgid':os.getpgrp(),'scope':'Bounded CPU2 filtered family review-copy preparation only;no canonical source edits,authoring,bake,export,render,browser/GPU','environment':{'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2','ART_KTX_JOBS':'1','KTX':str(base/'ktx_cpu2.py'),'UV_THREADPOOL_SIZE':'2','BLENDER':str(base/'blender_cpu2.py')},'steps':[],'known_pids':[os.getpid()],'known_pgids':[os.getpgrp()],'frozen_canonical_hashes':frozen,'status':'active'}
def save():
 job_path.write_text(json.dumps(j,indent=2)+'\n');p=base/'ACTIVE_SOL_RESUME.json';a=json.loads(p.read_text());a.update(updated_utc=utc(),status='Ulgani fifth CPU pose '+j['status'],live_jobs=[{'job':str(job_path),'pids':j['known_pids'],'groups':j['known_pgids']}] if j['status']=='active' else []);a['ulgani5_pose_'+label]=j;p.write_text(json.dumps(a,indent=2)+'\n')
try:
 save()
 for i,command in enumerate(commands):
  assert not (base/'gpu-release-ulgani5-bake').exists();log=out/(label+f'-{i}.log');step={'command':command,'start_utc':utc(),'log':str(log),'timeout_seconds':1800};j['steps'].append(step)
  with log.open('xb') as f:
   p=subprocess.Popen(command,cwd=root,env={**os.environ,**j['environment']},stdout=f,stderr=subprocess.STDOUT,start_new_session=True);c=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(p.pid)],start_new_session=True);step.update(pid=p.pid,pgid=p.pid,caffeinate_pid=c.pid,caffeinate_pgid=c.pid);j['known_pids'] += [p.pid,c.pid];j['known_pgids'] += [p.pid,c.pid];save()
   try:
    deadline=time.monotonic()+1800
    while p.poll() is None:
     for row in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,comm='],text=True).splitlines():
      fields=row.strip().split(None,3)
      if len(fields)==4 and int(fields[2])==p.pid and int(fields[0]) not in j['known_pids']:
       j['known_pids'].append(int(fields[0]));step.setdefault('observed_descendants',[]).append({'pid':int(fields[0]),'ppid':int(fields[1]),'pgid':int(fields[2]),'executable':fields[3],'observed_utc':utc()});save()
     if time.monotonic()>deadline:raise subprocess.TimeoutExpired(command,1800)
     time.sleep(.2)
   except subprocess.TimeoutExpired:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=15)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   finally:
    try:c.wait(timeout=10)
    except subprocess.TimeoutExpired:c.terminate();c.wait(timeout=10)
  step.update(exit_code=p.returncode,caffeinate_exit_code=c.returncode,end_utc=utc(),log_sha256=sha(log));save();print('CPU_STEP_END',label,i,p.returncode,flush=True)
  assert p.returncode==0,step
 assert all(sha(root/p)==h for p,h in frozen.items());j.update(status='complete;direct controller/group drain pending',exit_code=0,frozen_canonical_unchanged=True)
except BaseException as e:j.update(status='FAILED;no automatic retry',exit_code=1,error=repr(e),traceback=traceback.format_exc());print(traceback.format_exc(),flush=True)
finally:j['end_utc']=utc();save()
sys.exit(j['exit_code'])
