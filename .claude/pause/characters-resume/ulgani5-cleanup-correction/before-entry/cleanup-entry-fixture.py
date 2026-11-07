import ast,datetime,hashlib,json,os,re,shutil,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41')
OUT=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/.claude/pause/characters-resume/ulgani5-cleanup-correction/before-entry')
source=(ROOT/'packages/tools/blender/characters/capture_ulgani5.py').read_text()
tree=ast.parse(source)
helper_names=['processes','save','observe','cleanup']
exact='\n\n'.join(ast.get_source_segment(source,n) for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in helper_names)
(OUT/'exact-cleanup-helpers.py.txt').write_text(exact)
results=[]

def run(case):
 jobdir=OUT/('cleanup-'+case);jobdir.mkdir(exist_ok=True)
 utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
 ns=dict(Path=Path,root=ROOT,jobdir=jobdir,report_path=jobdir/'report.json',report={'cleanup':[]},known={},profiles=set(),children=[],observer_events=[],utc=utc,os=os,subprocess=subprocess,time=time,signal=signal,json=json,shutil=shutil,re=re)
 exec(compile(exact,'exact-candidate-helpers','exec'),ns)
 children=ns['children'];known=ns['known'];owned=[]
 result={'case':case,'controller_pid':os.getpid(),'helper_source_sha256':hashlib.sha256(source.encode()).hexdigest()}
 try:
  if case in ['exited-direct','error-exited-plus-resistant-descendant','normal-node-exit-sampler-timeout']:
   target=subprocess.Popen([sys.executable,'-c','import time; time.sleep(.15)'],start_new_session=True);owned.append(target)
   zombie=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(target.pid)],start_new_session=True);children.append(zombie);owned.append(zombie)
   known.update({pid:row for pid,row in ns['processes']().items() if pid in (os.getpid(),zombie.pid)})
   target.wait(timeout=2)
   # Never poll or wait the caffeinate child before invoking exact cleanup.
   time.sleep(.3)
   result['exited_unreaped_pid']=zombie.pid
  if case in ['live-direct','error-exited-plus-resistant-descendant','normal-node-exit-sampler-timeout']:
   marker=jobdir/'descendant.json'
   code="import subprocess,signal,sys,time,json,os; signal.signal(signal.SIGTERM,signal.SIG_IGN); c=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(20)']); open(sys.argv[1],'w').write(json.dumps({'pid':os.getpid(),'descendant':c.pid})); time.sleep(20)"
   live=subprocess.Popen([sys.executable,'-c',code,str(marker)],start_new_session=True);children.append(live);owned.append(live)
   deadline=time.monotonic()+3
   while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
   assert marker.exists(),'fixture failed to start'
   known.update({pid:row for pid,row in ns['processes']().items() if pid in (os.getpid(),live.pid)})
   ns['observe']()
   result['live_fixture']=json.loads(marker.read_text())
  assert all(p.pid in known for p in children)
  result['known_before']=list(known.values())
  if case=='normal-node-exit-sampler-timeout':
   try:live.wait(timeout=5);zombie.wait(timeout=5)
   except subprocess.TimeoutExpired:result['normal_wait_outcome']='sampler timeout skips caffeinate wait'
  try:ns['cleanup']();result['cleanup_result']='completed'
  except BaseException as exc:result.update(cleanup_result='raised',error=repr(exc))
  if case=='normal-node-exit-sampler-timeout' and result['cleanup_result']=='raised':
   try:ns['cleanup']();result['except_cleanup_retry']='completed'
   except BaseException as exc:result['except_cleanup_retry']=repr(exc)
  # ps records state; unlike Popen.poll this does not reap anything.
  ps=subprocess.run(['ps','-axo','pid=,ppid=,pgid=,stat=,comm='],text=True,capture_output=True,check=True).stdout
  result['owned_rows_after_cleanup']=[line.strip() for line in ps.splitlines() if line.split() and int(line.split()[0]) in known and int(line.split()[0])!=os.getpid()]
  result['cleanup_signals']=ns['report']['cleanup']
  result['children_returncodes_before_fixture_drain']=[{'pid':p.pid,'returncode':p.returncode} for p in children]
 finally:
  # Directly reap exited direct children, then drain only fixture-owned group members
  # whose complete identity was recorded before exact cleanup.
  for p in owned:p.poll()
  rows=ns['processes']()
  for group in {p.pid for p in owned}:
   members=[r for r in rows.values() if r['pgid']==group]
   assert all(r['pid'] in known and r['fingerprint']==known[r['pid']]['fingerprint'] for r in members),('unowned group',members)
   if members:
    try:os.killpg(group,signal.SIGKILL)
    except ProcessLookupError:pass
    except PermissionError:
     # Exited direct child can be reaped with wait, without signaling it.
     for p in owned:
      if p.pid==group:p.wait(timeout=2)
  for p in owned:p.wait(timeout=3)
  deadline=time.monotonic()+3
  while True:
   rows=ns['processes']();remaining=[r for pid,r in rows.items() if pid in known and pid!=os.getpid() and r['fingerprint']==known[pid]['fingerprint']]
   if not remaining or time.monotonic()>deadline:break
   time.sleep(.02)
  result['fixture_final_drain']={'remaining':remaining,'direct_children_reaped':[{'pid':p.pid,'exit_code':p.returncode} for p in owned]}
  assert not remaining,result
  (jobdir/'fixture-result.json').write_text(json.dumps(result,indent=2)+'\n');results.append(result)
  print(json.dumps(result),flush=True)
for case in ['normal-node-exit-sampler-timeout']:run(case)
(OUT/'cleanup-entry-fixture.json').write_text(json.dumps(results,indent=2)+'\n')
