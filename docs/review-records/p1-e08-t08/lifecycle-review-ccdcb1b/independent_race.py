import os,sys,time,json,subprocess,signal
from pathlib import Path
sys.dont_write_bytecode=True
S=Path(__file__).resolve().parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13');T=R/'packages/tools/blender/e08t08'
sys.path.insert(0,str(T));import stage_lifecycle_test as h
F,root,task=h.fixture(S,'late-same-group-fork',False)
result={};p=None;leaf=None
try:
 command=[sys.executable,str(S/'independent_driver.py'),str(task/'stage.py'),str(F),sys.executable,str(S/'independent_worker.py'),str(F),'leader'];result['command']=command
 with (F/'supervisor.log').open('x') as log:
  p=subprocess.Popen(command,cwd=root,env=h.ENV,stdout=log,stderr=subprocess.STDOUT)
  h.wait_for(lambda:(F/'leader.json').exists())
  p.send_signal(signal.SIGTERM);result['supervisorExit']=p.wait(timeout=7)
 spawned=json.loads((F/'spawned.json').read_text());leaf=spawned['leaf'];result['spawned']=spawned
 result['leafAfterSupervisor']=h.process(leaf)
 result['terminal']=json.loads((task/'reports/work.json').read_text())
 result['settled']=json.loads((task/'reports/runs/work/settled.json').read_text())
 result['retryExit']=h.call(F,'retry',[sys.executable,str(task/'stage.py'),'retry',sys.executable,'-c','pass'],root)
 result['leafAfterRetry']=h.process(leaf)
 result['finalizerExit']=h.finalize_fixture(F,root,task,'finalize')
 result['defectReproduced']=(bool(result['leafAfterSupervisor']) and bool(result['leafAfterRetry']) and result['retryExit']==0 and result['terminal']['cleanup']=='verified' and not result['terminal']['remainingProcesses'] and result['terminal']['directChildReaped'])
 assert result['defectReproduced'],result
finally:
 if p and p.poll() is None:p.kill();p.wait(timeout=3)
 if leaf is None and (F/'spawned.json').exists():leaf=json.loads((F/'spawned.json').read_text())['leaf']
 if leaf:
  row=h.process(leaf)
  if row and str(F) in row:os.kill(leaf,signal.SIGKILL)
  h.wait_for(lambda:not h.process(leaf),4)
 result['cleanupRemaining']=h.process(leaf) if leaf else None
 h.save(F/'result.json',result)
print(json.dumps({k:v for k,v in result.items() if k not in ('terminal','settled')},indent=2))
