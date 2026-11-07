"""Supervise exactly the approved saved-source bake plus CPU source validation."""
from pathlib import Path
import datetime, hashlib, json, os, signal, subprocess, sys, time, traceback
root=Path.cwd()
utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
base=root/'.claude/pause/characters-resume'
job_path=base/'ulgani5-bake2-stage-job.json'
active_path=base/'ACTIVE_SOL_RESUME.json'
manifest_path=root/'assets/renders/characters/validate/ulgani-review5-bake-preparation2.json'
assert root==Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41')
assert subprocess.check_output(['git','branch','--show-current'],text=True).strip()=='task/P1-E05-T01'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='2146782c8f899126aa460442d92d0695a35500ee'
assert sha(manifest_path)=='99c39f8d72d792d253ecb9f52c16735b0f405b55b6c0103204910209913c431f'
manifest=json.loads(manifest_path.read_text())
for item in (manifest['source'],manifest['source_validation'],manifest['bake_helper'],manifest['snapshot_utility'],manifest['pose_inspection'],manifest['guard_controls']):
 assert sha(root/item['path'])==item['sha256'],item
cmd=manifest['exact_command']
release=root/cmd[cmd.index('--release-file')+1]
assert release.exists()
assert not job_path.exists()
run_dir=base/'ulgani5-bake2';run_dir.mkdir(exist_ok=False)
frozen=json.loads((base/'ulgani5-head2-retry2-stage-job.json').read_text())['frozen_canonical_hashes']
assert all(sha(root/p)==h for p,h in frozen.items())
env={**os.environ,**manifest['environment']}
job={'started_utc':utc(),'controller_pid':os.getpid(),'controller_pgid':os.getpgrp(),'scope':'Exact manifest saved-source Skin/SuitA/SuitB Metal-only bake;CPU2 source validation;no authoring/export/render/browser/native recording','manifest_sha256':sha(manifest_path),'frozen_canonical_hashes':frozen,'environment':manifest['environment'],'steps':[],'known_pids':[os.getpid()],'known_pgids':[os.getpgrp()],'status':'active','host_observations':str(run_dir/'host-process-observations.jsonl'),'unrelated_baseline_browser':{'pids':[3340,3341,3342],'pgid':3340,'cwd':'/Users/andreyyurlov/.t3','parent_pid':71847,'start':'Nov1;outside art/native task;not inspected arguments or stopped'}}
def save():
 job_path.write_text(json.dumps(job,indent=2)+'\n')
 active=json.loads(active_path.read_text());active['updated_utc']=utc();active['status']='Ulgani5 authorized saved-source bake active' if job['status']=='active' else job['status'];active['live_jobs']=[{'job':str(job_path),'controller_pid':os.getpid(),'known_pids':job['known_pids'],'known_pgids':job['known_pgids']}] if job['status']=='active' else [];active['ulgani5_bake_stage']=job;active_path.write_text(json.dumps(active,indent=2)+'\n')
def observe():
 with (run_dir/'host-process-observations.jsonl').open('a') as f:
  f.write(json.dumps({'utc':utc(),'loadavg':os.getloadavg(),'processes':subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,%cpu=,rss=,etime=,comm='],text=True).splitlines(),'gpu_observation':'No native recording/utilization trace authorized;Metal selection and bake runtime log are authoritative execution evidence.'})+'\n')
def run(key,command,timeout):
 log=run_dir/(key+'.log');step={'key':key,'start_utc':utc(),'command':command,'log':str(log),'timeout_seconds':timeout}
 job['steps'].append(step);save();p=None;c=None
 try:
  with log.open('xb') as out:
   p=subprocess.Popen(command,cwd=root,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
   step.update(pid=p.pid,pgid=os.getpgid(p.pid));job['known_pids'].append(p.pid);job['known_pgids'].append(os.getpgid(p.pid))
   c=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(p.pid)],start_new_session=True)
   step.update(caffeinate_pid=c.pid,caffeinate_pgid=os.getpgid(c.pid));job['known_pids'].append(c.pid);job['known_pgids'].append(os.getpgid(c.pid));save()
   print('STAGE_START',key,json.dumps(step),flush=True)
   start=time.monotonic();next_observation=0
   while p.poll() is None:
    elapsed=time.monotonic()-start
    if elapsed>=next_observation:observe();next_observation=elapsed+30
    if elapsed>timeout:
     step['timeout_utc']=utc();os.killpg(p.pid,signal.SIGTERM)
     try:p.wait(timeout=15)
     except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
     raise TimeoutError(key)
    time.sleep(1)
  step.update(exit_code=p.returncode,end_utc=utc())
  try:c.wait(timeout=10)
  except subprocess.TimeoutExpired:c.terminate();c.wait(timeout=10)
  step.update(caffeinate_exit_code=c.returncode,log_sha256=sha(log));save();print('STAGE_END',key,p.returncode,step['end_utc'],flush=True)
  if p.returncode:raise RuntimeError(f'{key} failed exit {p.returncode};preserve output;no automatic retry')
 finally:
  if p and p.poll() is None:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  if c and c.poll() is None:
   c.terminate();c.wait(timeout=10)
  if p:step.update(exit_code=p.returncode,end_utc=utc())
  if c:step['caffeinate_exit_code']=c.returncode
  if log.exists():step['log_sha256']=sha(log)
  save()
try:
 save();observe();run('bake',cmd,7200)
 report=json.loads((run_dir/'report.json').read_text());assert len(report['steps'])==3 and all(s.get('completed_utc') for s in report['steps']);assert report.get('authoring_saved_utc')
 output=Path(report['output']);assert sha(output)==report['output_sha256']
 validate=[cmd[0],'-b','--factory-startup','-t','2','--python-exit-code','1','-P','packages/tools/blender/validate.py','--','--family','characters','--report',str(run_dir/'source-validation-baked.json'),str(output)]
 run('validation',validate,600)
 v=json.loads((run_dir/'source-validation-baked.json').read_text());assert v['status']=='PASS' and v['summary']['fail']==v['summary']['warn']==0
 assert all(sha(root/p)==h for p,h in frozen.items());job['frozen_canonical_hashes_unchanged']=True
 job.update(status='Bake/source validation complete;controller exit/drain pending',completed_utc=utc(),exit_code=0,bake_report_sha256=sha(run_dir/'report.json'),output_sha256=sha(output),validator_sha256=sha(run_dir/'source-validation-baked.json'))
except BaseException as exc:
 job.update(status='FAILED;preserved partial evidence;no automatic retry',completed_utc=utc(),exit_code=1,error=repr(exc),traceback=traceback.format_exc());print(traceback.format_exc(),flush=True)
finally:
 save();observe();print('CONTROLLER_END',utc(),job['status'],flush=True)
sys.exit(job['exit_code'])
