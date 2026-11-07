"""Reproduce loss of the runner and verify its independent watchdog terminates the command group."""
import json,os,signal,subprocess,sys,time
from pathlib import Path
lane=Path(__file__).with_name('lane.py');root=lane.resolve().parents[5];lock=lane.with_name('.lane-lock');label=sys.argv[1] if len(sys.argv)>1 else '28-runner-loss-proof';job=root/'assets/renders/hulls/swift-round4-current'/label
p=subprocess.Popen([sys.executable,str(lane),'--label',label,'--timeout','30','--',sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print("ready",flush=True);time.sleep(120)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(80):
 if (job/'process.log').exists() and 'ready' in (job/'process.log').read_text():break
 time.sleep(.1)
else:raise RuntimeError('command did not start')
time.sleep(.3);p.kill();p.wait(timeout=5)
for _ in range(160):
 if (job/'guardian.json').exists():break
 time.sleep(.1)
else:raise RuntimeError('guardian did not finish')
assert not (Path('/tmp')/f'swift-r4-{p.pid}').is_symlink(),'temporary alias leaked'
r=json.loads((job/'guardian.json').read_text());assert r['reason']=='runner disappeared' and r['childGroupEmpty']
assert not [line for line in subprocess.check_output(['ps','-axo','pgid='],text=True).splitlines() if line.strip()==str(r['commandGroup'])]
# Take over the orphaned lock only after proving both owner death and empty command group.
assert json.loads((lock/'owner.json').read_text())['pid']==p.pid
with (lock/'recovery-owner.json').open('x') as f:json.dump({'pid':os.getpid(),'previousOwnerPid':p.pid,'reason':'test verified guardian group cleanup'},f)
with (job/'test-result.json').open('x') as f:json.dump({'status':'PASS','runnerExit':p.returncode,**r},f,indent=2)
(lock/'recovery-owner.json').unlink();(lock/'owner.json').unlink();lock.rmdir();print('PASS runner loss: command group empty, abandoned lock safely released')
