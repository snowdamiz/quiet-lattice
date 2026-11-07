import os,signal,sys,subprocess,time,json,hashlib,shutil
from pathlib import Path
S=Path(__file__).resolve().parent; R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13')
D=S/'lifecycle-root/packages/tools/blender/e08t08';D.mkdir(parents=True);src=R/'packages/tools/blender/e08t08/stage.py';dst=D/'stage.py';shutil.copyfile(src,dst)
assert src.read_bytes()==dst.read_bytes()
marker=S/'owned-child.json'; child=None; wrapper=None
result={'stageSHA256':hashlib.sha256(dst.read_bytes()).hexdigest()}
def alive(pid):
 p=subprocess.run(['ps','-p',str(pid),'-o','pid=,ppid=,pgid=,stat=,command='],capture_output=True,text=True)
 return p.stdout.strip()
try:
 code="import os,time,json;from pathlib import Path;Path("+repr(str(marker))+").write_text(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp()}));time.sleep(20)"
 with (S/'stage-interrupted.stdout').open('x') as log:
  wrapper=subprocess.Popen([sys.executable,str(dst),'interrupted',sys.executable,'-c',code],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
  until=time.monotonic()+5
  while not marker.exists() and time.monotonic()<until and wrapper.poll() is None:time.sleep(.02)
  assert marker.exists(),(wrapper.poll(),(S/'stage-interrupted.stdout').read_text())
  child=json.loads(marker.read_text())['pid'];assert child!=wrapper.pid
  result['wrapperPID']=wrapper.pid;result['childPID']=child
  result['beforeSignal']=alive(child);wrapper.send_signal(signal.SIGTERM);result['wrapperExit']=wrapper.wait(timeout=3)
  time.sleep(.1);result['childAfterWrapperExit']=alive(child);result['terminalReceiptExists']=(D/'reports/interrupted.json').exists()
  assert result['childAfterWrapperExit'];assert not result['terminalReceiptExists']
  result['secondStageCommand']=[sys.executable,str(dst),'next_lane',sys.executable,'-c','pass']
  next_run=subprocess.run(result['secondStageCommand'],capture_output=True,text=True,timeout=5,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
  (S/'stage-second.stdout').write_text(next_run.stdout+next_run.stderr);result['secondStageExit']=next_run.returncode
  result['originalChildDuringSecondStage']=alive(child);assert next_run.returncode==0 and result['originalChildDuringSecondStage']
finally:
 if wrapper and wrapper.poll() is None:wrapper.terminate();wrapper.wait(timeout=3)
 if child and alive(child):
  os.kill(child,signal.SIGTERM)
  end=time.monotonic()+3
  while alive(child) and time.monotonic()<end:time.sleep(.05)
  if alive(child):os.kill(child,signal.SIGKILL)
 result['cleanupRemainingChild']=alive(child) if child else None
 (S/'stage-interrupt-result.json').write_text(json.dumps(result,indent=2)+'\n')
assert not result['cleanupRemainingChild'];print(json.dumps(result,indent=2));print('REPRODUCED: wrapper cancellation releases lane with live child and no terminal receipt; reviewer cleaned child')
